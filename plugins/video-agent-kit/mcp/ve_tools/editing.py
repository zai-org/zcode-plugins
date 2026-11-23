"""Public adapters for shared editing execution with explicit input bindings."""
from __future__ import annotations

import functools
import hashlib
import json
import math
import os
import re
import tempfile
import threading
from contextlib import ExitStack
from pathlib import Path

from . import condense, diarize, qc, render, subtitle, subtitle_scout, timeline
from .observation_media import probe
from .result import ToolResult


def _job(ctx, prefix):
    ctx.output_dir.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix=prefix + "-", dir=ctx.output_dir))


def _args(args):
    result = dict(args)
    if "source" in result:
        result["video_path"] = result.pop("source")
    return result


def _finish(result):
    if result.data.get("status") == "fail":
        result.is_error = True
    for old, new in {
        "condense_index": "speech_index", "condense_plan": "speech_plan",
        "condense_render": "video_render(kind=speech)", "condense_qc": "video_qc(kind=speech)",
        "subtitle_render": "video_render(kind=subtitles)", "subtitle_qc": "video_qc(kind=subtitles)",
        "subtitle_scout": "subtitle_layout", "diarize_audit": "speaker_audit",
        "diarize_relabel": "speaker_relabel", "video_watch_segment": "video_observe",
        "render_preview": "video_render(kind=timeline)", "validate_timeline": "timeline_validate",
        "timeline_diff": "timeline_patch", "video_path": "source", "video_ingest": "video_observe",
    }.items():
        result.text = re.sub(r"(?<![\w/.-])" + re.escape(old) + r"(?![\w.-])", new, result.text)
    return result


_output_locks = {}
_DOCUMENT_LIMIT = 64 * 1024 * 1024
_output_locks_guard = threading.Lock()


def _json_like(path):
    with Path(path).open("rb") as handle:
        return handle.read(64).removeprefix(b"\xef\xbb\xbf").lstrip()[:1] in (b"{", b"[")


class _FailedResult(Exception):
    def __init__(self, result):
        self.result = result


def _safe(handler):
    @functools.wraps(handler)
    def call(args, ctx):
        folder = None
        try:
            a = dict(args)
            name = handler.__name__
            # Allocate defaults before checking/locking the complete publication.
            folder = _job(ctx, name)
            defaults = {
                'timeline_validate': {'output_json': 'validation.json'},
                'timeline_patch': {'output_json': 'patch.json'},
                'subtitle_layout': {'output_json': 'layout.json', 'frames_dir': 'frames'},
                'subtitle_build': {'output_json': 'subtitles.json'},
                'speech_index': {'output_json': 'index.json', 'output_table': 'index.md', 'frames_dir': 'frames'},
                'speech_plan': {'output_json': 'plan.json', 'timeline_json': 'timeline.json', 'script_md': 'script.md', 'output_transcript': 'transcript.json', 'redline_json': 'redline.json'},
                'speaker_audit': {'output_json': 'audit.json'},
                'speaker_relabel': {'output_path': 'transcript.json'},
                'video_render': {'output_path': 'video.mp4'},
                'video_qc': {'output_json': 'report.json', 'frames_dir': 'frames'},
            }
            for key, filename in defaults.get(name, {}).items():
                a.setdefault(key, str(folder / filename))
            from .file_contract import OUTPUT_KEYS, input_paths, protect_outputs, protect_directories, output_locks, rollback_outputs
            paths = [ctx.resolve(a[key]) for key in OUTPUT_KEYS if key not in {'output_dir', 'output_name'} and a.get(key)]
            if name == 'subtitle_build':
                output = ctx.resolve(a['output_json'])
                for key, suffix in [('output_ass', '.ass'), ('output_srt', '.srt')]:
                    if not a.get(key):
                        a[key] = str(output.with_suffix(suffix))
                        paths.append(ctx.resolve(a[key]))
            if name == 'video_render':
                output = ctx.resolve(a['output_path'])
                suffixes = ('.subtitle_render_report.json',) if a.get('kind') == 'subtitles' else ('.render_report.json', '.render_plan.json', '.edit_decisions.json', '.transcript.json')
                paths += [output.with_suffix(s) for s in suffixes]
                if a.get('kind') == 'subtitles':
                    if a.get('subtitles_path'):
                        package = ctx.resolve(a['subtitles_path'])
                        try:
                            recorded = json.loads(package.read_text(encoding='utf-8'))
                        except (OSError, ValueError):
                            recorded = {}
                        for key, suffix in [('ass_path', '.ass'), ('srt_path', '.srt')]:
                            if not a.get(key):
                                # Rebuild the sidecars the package was built with; a custom
                                # output_ass/output_srt otherwise went stale after cue edits.
                                known = recorded.get(key) if isinstance(recorded, dict) else None
                                a[key] = str(ctx.resolve(known)) if isinstance(known, str) and known else str(package.with_suffix(suffix))
                                paths.append(ctx.resolve(a[key]))
                    paths.append(output.with_name(output.stem + '_softsubs' + output.suffix))
            inputs = input_paths(a, ctx)
            # Follow input documents to their source media, without treating outputs as inputs.
            for path in list(inputs):
                try:
                    # Only JSON documents are followed; reading a multi-GB source as text
                    # just to fail decoding cost its full size in memory on every call.
                    if path.stat().st_size > _DOCUMENT_LIMIT or not _json_like(path):
                        continue
                    inputs.update(input_paths(json.loads(path.read_text(encoding="utf-8")), ctx))
                except (ValueError, UnicodeError, OSError):
                    pass
            protect_outputs(paths, inputs)
            for key in ('output_json', 'timeline_json', 'redline_json', 'output_transcript'):
                target = ctx.resolve(a[key]) if a.get(key) else None
                if target is not None and target.is_file() and target.stat().st_size and not _json_like(target):
                    # Reports are kept even when the verdict is a failure, so they must never
                    # replace media or other non-report files that happen to share the path.
                    raise ValueError(f"{key} would overwrite an existing non-JSON file: {target}")
            protect_directories([ctx.resolve(a['frames_dir'])] if a.get('frames_dir') else [], inputs)
            if name == 'timeline_patch' and a.get('apply'):
                paths.append(ctx.resolve(a['timeline_path']))
            with _output_locks_guard:
                locks = [_output_locks.setdefault(str(path.resolve()), threading.RLock()) for path in sorted(set(paths))]
            with ExitStack() as stack:
                for lock in locks:
                    stack.enter_context(lock)
                stack.enter_context(output_locks(ctx, paths))
                stack.enter_context(rollback_outputs(p for p in paths if not p.is_dir()))
                result = handler(a, ctx)
                if result.failed and not _is_verdict(name, result, a, ctx):
                    # Trigger rollback while retaining the original tool error.
                    raise _FailedResult(result)
                return result
        except _FailedResult as exc:
            return exc.result
        except (OSError, ValueError, TypeError, KeyError, RuntimeError) as exc:
            return ToolResult(f"[ERROR] {exc}", is_error=True)
        finally:
            _drop_empty(folder)
    return call


# A failing check is this tool's product: rolling it back deleted the report the result
# points to, or restored an earlier passing report over the current failure. A rejected
# patch never touches the timeline, so its diff report is kept the same way.
def _is_verdict(name, result, a, ctx):
    if not a.get('output_json') or not ctx.resolve(a['output_json']).is_file():
        return False
    if name == 'timeline_patch':
        return result.data.get('after_validation_status') == 'fail'
    return (name in {'timeline_validate', 'video_qc'} and result.data.get('status') == 'fail'
            and not result.text.startswith('[ERROR]'))


def _drop_empty(folder):
    """Remove a default job directory (and its empty children) that received no output."""
    if folder is None:
        return
    for directory in sorted((p for p in folder.rglob('*') if p.is_dir()), reverse=True):
        try:
            directory.rmdir()
        except OSError:
            pass
    try:
        folder.rmdir()
    except OSError:
        pass


def _check_files(bindings):
    for path, digest in bindings.items():
        if not Path(path).is_file() or timeline.file_sha256(Path(path)) != digest:
            raise ValueError(f"input changed: {path}; regenerate dependent outputs")


def _bound_transcript(path, source, ctx):
    data = json.loads(ctx.resolve(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("transcript requires a source-bound object; transcribe or explicitly import the current source")
    if isinstance(data, dict):
        declared = data.get("source_media") or data.get("source_video")
        if declared and ctx.resolve(declared) != source:
            raise ValueError("transcript belongs to another source; remap or transcribe the current output")
        if str(data.get("provider") or "").startswith("remapped_from:") and not declared:
            raise ValueError("planned output transcript has not been bound to a render; render speech first")
        if data.get("plan_path"):
            if timeline.file_sha256(ctx.resolve(data["plan_path"])) != data.get("plan_sha256"):
                raise ValueError("transcript belongs to an earlier speech plan")
        digest = data.get("source_video_sha256")
        if not digest:
            raise ValueError("transcript lacks a source byte binding; transcribe the current source")
        if digest != timeline.file_sha256(source):
            raise ValueError("transcript belongs to an earlier source version")
        from .transcript import collect_segments
        if any(s.get("partial") for s in collect_segments(data)):
            raise ValueError("remapped transcript contains partial units; repair text/timing or transcribe the output")


@_safe
def timeline_validate(args, ctx):
    a = dict(args)
    return _finish(timeline.validate_timeline(a, ctx))


@_safe
def timeline_patch(args, ctx):
    a = dict(args)
    result = timeline.timeline_diff(a, ctx)
    if result.data.get("after_validation_status") == "fail":
        result.is_error = True
    return _finish(result)


@_safe
def subtitle_layout(args, ctx):
    a = _args(args)
    return _finish(subtitle_scout.subtitle_scout(a, ctx))


@_safe
def subtitle_build(args, ctx):
    a = _args(args)
    if not a.get("video_path") or not a.get("transcript_path"):
        return ToolResult("[ERROR] source and transcript_path are required")
    _bound_transcript(a["transcript_path"], ctx.resolve(a["video_path"]), ctx)
    if not ctx.resolve(a["video_path"]).is_file():
        return ToolResult("[ERROR] source not found")
    result = subtitle.subtitle_build(a, ctx)
    if not result.failed:
        package = json.loads(ctx.resolve(a["output_json"]).read_text(encoding="utf-8"))
        package["transcript_sha256"] = timeline.file_sha256(ctx.resolve(a["transcript_path"]))
        condense._write_text_atomic(ctx.resolve(a["output_json"]), json.dumps(package, ensure_ascii=False, indent=2))
        result.data["transcript_sha256"] = package["transcript_sha256"]
    return _finish(result)


@_safe
def speech_index(args, ctx):
    a = _args(args)
    if not a.get("transcript_path") or not a.get("video_path"):
        return ToolResult("[ERROR] source and transcript_path are required; call transcribe if needed")
    _bound_transcript(a["transcript_path"], ctx.resolve(a["video_path"]), ctx)
    return _finish(condense.condense_index(a, ctx))


@_safe
def speech_plan(args, ctx):
    a = _args(args)
    if not a.get("index_path"):
        return ToolResult("[ERROR] index_path is required")
    index = json.loads(ctx.resolve(a["index_path"]).read_text(encoding="utf-8"))
    _check_files({str(ctx.resolve(index["transcript_path"])): index["transcript_sha256"]})
    result = condense.condense_plan(a, ctx)
    if not result.failed:
        plan_path = ctx.resolve(a["output_json"])
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        plan["output_transcript"] = str(ctx.resolve(a["output_transcript"]))
        condense._write_text_atomic(plan_path, json.dumps(plan, ensure_ascii=False, indent=2))
        remapped = json.loads(ctx.resolve(a["output_transcript"]).read_text(encoding="utf-8"))
        remapped.update(plan_path=str(plan_path), plan_sha256=timeline.file_sha256(plan_path))
        condense._write_text_atomic(ctx.resolve(a["output_transcript"]), json.dumps(remapped, ensure_ascii=False, indent=2))
    return _finish(result)


@_safe
def speaker_audit(args, ctx):
    a = dict(args)
    return _finish(diarize.diarize_audit(a, ctx))


@_safe
def speaker_relabel(args, ctx):
    a = dict(args)
    if ctx.resolve(a["output_path"]) == ctx.resolve(a["transcript_path"]):
        return ToolResult("[ERROR] output_path must preserve the source transcript; choose a different path")
    return _finish(diarize.diarize_relabel(a, ctx))


def _project(data):
    data = timeline.as_project(data)
    # Reject metadata effects the renderer would silently ignore (same rules timeline_validate reports).
    issues = timeline.render_support_issues(data)
    if issues:
        raise ValueError(issues[0]["message"])
    return data


def _portable_paths(value, old, new):
    """Replace a path inside parsed JSON; a text replace misses JSON-escaped quotes/backslashes."""
    if isinstance(value, dict):
        return {key: _portable_paths(item, old, new) for key, item in value.items()}
    if isinstance(value, list):
        return [_portable_paths(item, old, new) for item in value]
    if isinstance(value, str):
        return value.replace(old, new)
    return value


# kind=narrated renders a movie-recap narration EDL with its own engine (render_narrated):
# public argument -> engine argument.
_NARRATED_ARGS = {
    "source": "video_path", "edl_path": "edl_path", "shots_path": "timeline_path",
    "narration_path": "script_path", "output_path": "output_path", "work_dir": "work_dir",
    "burn_subtitles": "subtitle", "subtitle_position": "sub_pos", "bgm": "bgm", "bgm_dir": "bgm_dir",
    "bgm_volume": "bgm_volume", "bed_volume": "bed_volume", "tail_volume": "tail_volume",
    "narration_gain": "narration_gain",
}
_NARRATED_ONLY = set(_NARRATED_ARGS) - {"source", "output_path", "work_dir"}
_NARRATED_REQUIRED = ("source", "edl_path", "shots_path", "narration_path")


def _video_render_dispatch(args, ctx):
    """video_render: kind=narrated -> render_narrated; other kinds -> shared renderer."""
    if args.get("kind") == "match":
        from . import match_recap, movie_handlers
        return movie_handlers._invoke(match_recap.render, {k: v for k, v in args.items() if k != "kind"}, ctx)
    misplaced_match = sorted(set(args) & {"reel_path", "outline_path"})
    if misplaced_match:
        return ToolResult("[ERROR] " + ", ".join(misplaced_match) + ": only used with kind=match", is_error=True)
    if args.get("kind") == "narrated":
        unused = sorted(set(args) - set(_NARRATED_ARGS) - {"kind"})
        if unused:
            return ToolResult("[ERROR] kind=narrated does not use: " + ", ".join(unused), is_error=True)
        missing = [key for key in _NARRATED_REQUIRED if not args.get(key)]
        if missing:
            return ToolResult("[ERROR] kind=narrated requires " + ", ".join(missing), is_error=True)
        output = ctx.resolve(args.get("output_path") or "out/final.mp4")
        if output.suffix.lower() != ".mp4":
            return ToolResult("[ERROR] video_render currently delivers .mp4; choose an MP4 output path", is_error=True)
        from . import movie_handlers
        return movie_handlers.render_narrated({_NARRATED_ARGS[k]: v for k, v in args.items() if k != "kind"}, ctx)
    misplaced = sorted(_NARRATED_ONLY & set(args))
    if misplaced:
        return ToolResult("[ERROR] " + ", ".join(misplaced) + ": only used with kind=narrated", is_error=True)
    return _render_shared(args, ctx)


@_safe
def video_render(args, ctx):
    folder = _job(ctx, "render")
    try:
        return _render(args, ctx, folder)
    finally:
        # Published files are copies: leaving staged media doubled every render inside out/.
        for staged in folder.glob("staged*"):
            if staged.is_file():
                staged.unlink(missing_ok=True)
        _drop_empty(folder)


# The public tool is the dispatcher; the decorated shared renderer keeps its name for _safe.
_render_shared = video_render
video_render = _video_render_dispatch
video_render.__name__ = video_render.__qualname__ = "video_render"


def _render(args, ctx, folder):
    a = _args(args)
    kind = a.get("kind")
    output = ctx.resolve(a["output_path"])
    if output.suffix.lower() != ".mp4":
        raise ValueError("video_render currently delivers .mp4; choose an MP4 output path")
    quality = a.get("crf", 20)
    if isinstance(quality, bool) or not isinstance(quality, int) or not 0 <= quality <= 51:
        raise ValueError("crf must be an integer between 0 and 51")
    if a.get("video_path") and output == ctx.resolve(a["video_path"]):
        return ToolResult("[ERROR] output_path must differ from source")
    if kind == "subtitles":
        if not a.get("subtitles_path") or not a.get("video_path"):
            return ToolResult("[ERROR] source and subtitles_path are required")
        package_path = ctx.resolve(a["subtitles_path"])
        package = json.loads(package_path.read_text(encoding="utf-8"))
        bindings = {str(package_path): timeline.file_sha256(package_path),
                    str(ctx.resolve(a["video_path"])): timeline.file_sha256(ctx.resolve(a["video_path"]))}
        if package.get("transcript_sha256"):
            bindings[str(ctx.resolve(package["transcript_path"]))] = package["transcript_sha256"]
        _check_files(bindings)
        if package.get("source_video_sha256") != timeline.file_sha256(ctx.resolve(a["video_path"])):
            return ToolResult("[ERROR] subtitles belong to another source version; rebuild for current source")
        from . import subtitle_style
        cue_text = "".join(str(c.get("text", "")) + str(c.get("speaker_prefix") or "")
                           + "".join(str(line) for line in c.get("translation_lines") or [])
                           for c in package.get("cues", []) if isinstance(c, dict))
        missing = subtitle_style.uncovered_characters(cue_text, package["style"])
        if missing:
            candidate = subtitle_style.find_cjk_font(cue_text)
            hint = "" if candidate.startswith("[ERROR]") else f"; a covering font is available: {candidate}"
            raise ValueError("subtitle font " + str(package["style"].get("font_file")) + " lacks glyphs: " + "".join(missing)
                             + ". Rebuild with subtitle_build style.font_file set to a font covering the cue text, "
                             "speaker names and translation_lines, then reapply the cue edits" + hint)
        from .render_provenance import verify_render, report_candidates
        source = ctx.resolve(a["video_path"])
        parent_files = None
        if any(p.is_file() for p in report_candidates(source)):
            parent_files = verify_render(source, ctx)
            bindings.update(parent_files)
        from .file_contract import protect_outputs
        protect_outputs([output, output.with_name(output.stem + "_softsubs" + output.suffix),
                         output.with_suffix(".subtitle_render_report.json")], bindings)
        # Stage outputs so an encoder failure preserves existing deliverables.
        staging = dict(a, output_path=str(folder / 'staged.mp4'), ass_path=str(folder / 'staged.ass'), srt_path=str(folder / 'staged.srt'))
        result = subtitle.subtitle_render(staging, ctx)
        if result.failed:
            return _finish(result)
        _check_files(bindings)
        delivered = {}
        publications = {}
        for mode, path in result.data["outputs"].items():
            target = output if mode == "burned" else output.with_name(output.stem + "_softsubs" + output.suffix)
            target.parent.mkdir(parents=True, exist_ok=True)
            publications[target] = Path(path)
            delivered[mode] = str(target)
        result.data["outputs"] = delivered
        result.data["input_sha256"] = bindings
        if parent_files is not None:
            result.data.update(source_video=str(source), parent_provenance_sha256=parent_files)
        result.data["source_video_sha256"] = timeline.file_sha256(ctx.resolve(a["video_path"]))
        report = output.with_suffix(".subtitle_render_report.json")
        result.data.pop("ass_path", None)
        for key, suffix in [('ass_path', '.ass'), ('srt_path', '.srt')]:
            staged_sidecar = folder / ('staged' + suffix)
            if staged_sidecar.is_file():
                publications[ctx.resolve(a[key])] = staged_sidecar
                # Report the published sidecar, not the staging file removed after publication.
                result.data[key] = str(ctx.resolve(a[key]))
        publications[report] = json.dumps(result.data, ensure_ascii=False, indent=2).encode()
        from .file_contract import publish_files
        publish_files(publications)
        result.artifacts = [str(report), *delivered.values()]
        result.video_paths = list(delivered.values())
        result.text = "Subtitles rendered: " + ", ".join(delivered.values())
        return _finish(result)
    if kind not in {"timeline", "speech"}:
        return ToolResult("[ERROR] kind must be timeline, subtitles, or speech")
    if kind == "speech":
        if not a.get("plan_path"):
            return ToolResult("[ERROR] plan_path is required")
        plan_path = ctx.resolve(a["plan_path"])
        plan_bytes = plan_path.read_bytes()
        plan = json.loads(plan_bytes)
        source = ctx.resolve(plan["video_path"])
        plan_digest = hashlib.sha256(plan_bytes).hexdigest()
        index_path = ctx.resolve(plan["index_path"])
        index = json.loads(index_path.read_text(encoding="utf-8"))
        _check_files({str(index_path): plan["index_sha256"],
                      str(ctx.resolve(index["transcript_path"])): index["transcript_sha256"]})
        if not plan.get("clips"):
            raise ValueError("speech plan has no clips")
        if any(not math.isclose(float(c["duration"]), float(c["end"]) - float(c["start"]), abs_tol=0.002)
               for c in plan["clips"]):
            raise ValueError("speech clip duration differs from source interval")
        if not math.isclose(sum(c["duration"] for c in plan["clips"]), plan["output_duration"], abs_tol=.002):
            raise ValueError("speech output duration differs from planned clip sum")
        remapped_path = ctx.resolve(plan["output_transcript"])
        remapped = json.loads(remapped_path.read_text(encoding="utf-8"))
        if remapped.get("plan_sha256") != plan_digest:
            raise ValueError("planned transcript differs from current speech plan")
        if timeline.file_sha256(source) != plan.get("video_sha256"):
            return ToolResult("[ERROR] source changed since speech planning; index and plan again")
        if not probe(source).get("has_video"):
            # The shared renderer composes onto a video canvas; say so instead of "no video dimensions".
            return ToolResult("[ERROR] speech render needs a source with a video stream; audio-only sources "
                              "are not rendered by video_render (cut the audio with the plan's clips instead)")
        data = {"project": {"task": "selected speech"}, "assets": [{"source": str(source)}],
                "sequence": {"fps": probe(source).get("fps") or 30.0},
                "tracks": [{"type": "video", "clips": [
            {"source": str(source), "start": c["start"], "end": c["end"], "reason": "selected speech"}
            for c in plan["clips"]]}]}
        timeline_path = folder / "timeline.json"
        timeline_path.write_text(json.dumps(data), encoding="utf-8")
    else:
        if not a.get("timeline_path"):
            return ToolResult("[ERROR] timeline_path is required")
        timeline_path = ctx.resolve(a["timeline_path"])
        timeline_bytes = timeline_path.read_bytes()
        data = json.loads(timeline_bytes)
    digest = timeline.file_sha256(timeline_path) if kind == "speech" else hashlib.sha256(timeline_bytes).hexdigest()
    validation = timeline.validate_timeline({"timeline_path": str(timeline_path), "output_json": str(folder / "validation.json")}, ctx)
    if validation.data.get("status") != "pass":
        # Name the blocking issues in the result itself, not only in the report file.
        errors = [i.get("message", "") for i in validation.data.get("issues", []) if i.get("severity") == "error"]
        if errors:
            validation.text += ": " + "; ".join(errors[:5]) + ("" if len(errors) <= 5 else f"; +{len(errors) - 5} more")
        return _finish(validation)
    if kind != "speech":
        # Only a failed pre-render validation is reported; the speech job directory stays
        # because its generated timeline is a bound render input.
        (folder / "validation.json").unlink(missing_ok=True)
    project = _project(data)
    execution = render.build_render_plan(a, ctx, project, timeline_path)
    skipped = [t for t in execution["unsupported_tracks"] if t.get("clip_count")]
    if skipped:
        raise ValueError("track type is not rendered: " + ", ".join(
            f"tracks[{t['track_index']}]={t['track_type'] or 'untyped'}" for t in skipped)
            + "; use video/audio/text/overlay track types or disable the track")
    sources = {str(c["source"]): timeline.file_sha256(Path(c["source"]))
               for key in ("video_clips", "audio_clips", "overlay_clips") for c in execution[key]
               if c.get("source")}
    if str(output) in sources:
        return ToolResult("[ERROR] output_path must preserve timeline source media")
    inputs = {**sources, str(timeline_path): digest}
    if kind == "speech":
        inputs[str(source)] = plan["video_sha256"]
        inputs.update({str(plan_path): plan_digest, str(index_path): plan["index_sha256"],
                       str(ctx.resolve(index["transcript_path"])): index["transcript_sha256"],
                       str(remapped_path): timeline.file_sha256(remapped_path)})
    from .file_contract import protect_outputs
    protect_outputs([output, *[output.with_suffix(suffix) for suffix in
                              (".render_report.json", ".render_plan.json", ".edit_decisions.json", ".transcript.json")]], inputs)
    staging_output = folder / "staged.mp4"
    # T22: 公开渲染入口与 render_preview 走同一审核门(此前该公开路由不经 gate)。
    from . import render_gate
    _tl_path = Path(timeline_path)
    if _tl_path.suffix.lower() == ".json" and _tl_path.is_file():
        try:
            _tl = json.loads(_tl_path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001 — a garbled timeline will fail validation below anyway
            _tl = None
        if isinstance(_tl, dict):
            _gate = render_gate.refusal(_tl, ctx)
            if _gate:
                return ToolResult("[ERROR] render gate: " + _gate)
    result = render.render_project_timeline(dict(a, output_path=str(staging_output)), ctx, project, timeline_path)
    if result.failed:
        return _finish(result)
    _check_files(inputs)
    output.parent.mkdir(parents=True, exist_ok=True)
    publications = {output: staging_output}
    # Publish sidecars only after verifying all source and plan snapshots.
    artifacts = [str(output)]
    for suffix in (".render_plan.json", ".edit_decisions.json"):
        sidecar = staging_output.with_suffix(suffix)
        target = output.with_suffix(suffix)
        relocated = _portable_paths(json.loads(sidecar.read_text(encoding="utf-8")), str(staging_output), str(output))
        publications[target] = json.dumps(relocated, ensure_ascii=False, indent=2).encode()
        artifacts.append(str(target))
    result.data.update(output_path=str(output), input_sha256=inputs)
    if kind == "speech":
        cursor = 0.0
        joins = []
        for c in plan["clips"][:-1]:
            cursor += c["duration"]
            joins.append(cursor)
        result.data.update(plan_path=str(plan_path), plan_sha256=plan_digest,
                           join="hard", expected_duration=plan["output_duration"],
                           fps=probe(staging_output).get("fps") or 30.0, output_join_times=joins)
        remapped.update(source_media=str(output), source_video_sha256=timeline.file_sha256(staging_output))
        bound_path = output.with_suffix(".transcript.json")
        publications[bound_path] = json.dumps(remapped, ensure_ascii=False, indent=2).encode()
        artifacts.append(str(bound_path))
        result.data["output_transcript"] = str(bound_path)
    report_path = output.with_suffix(".render_report.json")
    publications[report_path] = json.dumps(result.data, ensure_ascii=False, indent=2).encode()
    from .file_contract import publish_files
    publish_files(publications)
    result.artifacts = [*artifacts, str(report_path)]
    result.video_paths = [str(output)]
    result.text = "Video rendered: " + str(output)
    return _finish(result)


@_safe
def video_qc(args, ctx):
    a = _args(args)
    kind = a.get("kind", "video")
    if kind == "video":
        if a.get("timeline_path") and a.get("video_path"):
            from .render_provenance import verify_render
            verify_render(a["video_path"], ctx, a["timeline_path"])
        return _finish(qc.qc_preview(a, ctx))
    if kind == "subtitles":
        if a.get("video_path"):
            output = ctx.resolve(a["video_path"])
            if a.get('render_report_path'):
                report_path = ctx.resolve(a['render_report_path'])
                binding = json.loads(report_path.read_text())
            else:
                from .render_provenance import matching_report
                report_path, binding = matching_report(output, ctx)
            if timeline.file_sha256(output) not in binding.get("output_sha256", {}).values() or binding.get("subtitles_sha256") != timeline.file_sha256(ctx.resolve(a["subtitles_path"])):
                return ToolResult("[ERROR] subtitle render binding differs from current output/package")
            _check_files(binding.get("input_sha256", {}))
            if binding.get("parent_provenance_sha256") is not None:
                from .render_provenance import verify_render
                verify_render(output, ctx)
            if binding.get("mode") == "soft" or str(output) == binding.get("outputs", {}).get("soft"):
                # Check the muxed timed text, including additional tracks on source videos.
                from .observation_media import _ffmpeg, parse_srt
                from . import subtitle_style
                package = json.loads(ctx.resolve(a["subtitles_path"]).read_text(encoding="utf-8"))
                expected = parse_srt(subtitle_style.build_srt(package["cues"], package["style"]))
                matched = False
                for stream in probe(output)["subtitle_streams"]:
                    raw = _ffmpeg(["-i", str(output), "-map", f"0:{stream}", "-f", "srt", "pipe:1"])
                    actual = parse_srt(raw.stdout.decode("utf-8"))
                    if len(actual) == len(expected) and all(
                        x["text"] == y["text"] and abs(x["start_time"] - y["start_time"]) < .05
                        and abs(x["end_time"] - y["end_time"]) < .05 for x, y in zip(actual, expected)):
                        matched = True
                        break
                if not matched:
                    return ToolResult("[ERROR] expected timed subtitle track is missing or differs from cues")
                a.pop("video_path")
                result = subtitle.subtitle_qc(a, ctx)
                result.data.update(mux_verified=True, output_path=str(output), output_sha256=timeline.file_sha256(output))
                result.data["visual_evidence_scope"] = "soft subtitles require player review"
                ctx.resolve(a["output_json"]).write_text(json.dumps(result.data, ensure_ascii=False, indent=2), encoding="utf-8")
                return _finish(result)
        elif a.get("subtitles_path"):
            # Data-only check: the package must still describe the transcript and source it was built from.
            package = json.loads(ctx.resolve(a["subtitles_path"]).read_text(encoding="utf-8"))
            unverified = []
            for label, path_key, digest_key in (("transcript", "transcript_path", "transcript_sha256"),
                                                ("source", "source_video", "source_video_sha256")):
                recorded, digest = package.get(path_key), package.get(digest_key)
                if not recorded or not digest:
                    continue
                current = ctx.resolve(recorded)
                if not current.is_file():
                    unverified.append(label)
                elif timeline.file_sha256(current) != digest:
                    return ToolResult(f"[ERROR] subtitle package is stale: its {label} changed ({current}); rebuild with subtitle_build")
            result = subtitle.subtitle_qc(a, ctx)
            if unverified:
                result.data["binding_unverified"] = unverified
                report_path = ctx.resolve(a["output_json"])
                if report_path.is_file():
                    report_path.write_text(json.dumps(result.data, ensure_ascii=False, indent=2), encoding="utf-8")
            return _finish(result)
        return _finish(subtitle.subtitle_qc(a, ctx))
    if kind == "speech":
        if not a.get("plan_path") or not a.get("video_path"):
            return ToolResult("[ERROR] plan_path and source (rendered output) are required")
        output = ctx.resolve(a["video_path"])
        binding_path = ctx.resolve(a.get("render_report_path") or output.with_suffix(".render_report.json"))
        binding = json.loads(binding_path.read_text(encoding="utf-8"))
        if binding.get("output_sha256") != timeline.file_sha256(output) or binding.get("plan_sha256") != timeline.file_sha256(ctx.resolve(a["plan_path"])):
            return ToolResult("[ERROR] speech render binding differs from current output/plan")
        _check_files(binding.get("input_sha256", {}))
        result = condense.condense_qc(a, ctx)
        technical = qc.qc_preview({"video_path": str(output), "output_json": str(ctx.resolve(a["output_json"]).with_suffix(".technical.json"))}, ctx)
        result.data["technical_qc"] = technical.data
        result.artifacts.extend(technical.artifacts)
        if technical.data.get("status") == "fail" or technical.failed:
            result.is_error = True
            result.data["status"] = "fail"
        ctx.resolve(a["output_json"]).write_text(json.dumps(result.data, ensure_ascii=False, indent=2), encoding="utf-8")
        return _finish(result)
    return ToolResult("[ERROR] kind must be video, subtitles, or speech")
