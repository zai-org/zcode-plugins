from __future__ import annotations

import json
import math
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

from .result import ToolResult
from .run_context import RunContext
from .timeline import (
    AUDIO_TRACK_TYPES,
    OVERLAY_TRACK_TYPES,
    STILL_IMAGE_SUFFIXES,
    TEXT_TRACK_TYPES,
    VIDEO_TRACK_TYPES,
    file_sha256,
    load_timeline,
    normalize_clip,
    normalize_track_type,
    timeline_clips,
    validate_timeline,
)


def render_preview(args: dict, ctx: RunContext) -> ToolResult:
    if not args.get("timeline_path"):
        return ToolResult(text="[ERROR] timeline_path is required")
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        return ToolResult(text="[ERROR] ffmpeg/ffprobe not found on PATH")
    timeline_path = ctx.resolve(args["timeline_path"])
    if not timeline_path.is_file():
        return ToolResult(text=f"[ERROR] timeline not found: {timeline_path}")

    try:
        data = load_timeline(timeline_path)
    except Exception as exc:
        return ToolResult(text=f"[ERROR] invalid JSON: {exc}")
    validation = validate_timeline({"timeline_path": str(timeline_path)}, ctx)
    if validation.data.get("status") != "pass":
        return ToolResult(text="[ERROR] timeline validation failed before render", data=validation.data)
    # Every film passes through here, so this is where an unverified take is caught: a
    # hand-written timeline.json reaches render without ever meeting creation_timeline's
    # own gate. See render_gate.
    from .render_gate import refusal
    gate = refusal(data, ctx)
    if gate:
        return ToolResult(text=gate)

    if isinstance(data.get("tracks"), list):
        return render_project_timeline(args, ctx, data, timeline_path)

    clips, unsupported_clips = renderable_timeline_clips(data)
    if unsupported_clips:
        return ToolResult(
            text="[ERROR] unsupported non-video clips in legacy top-level timeline",
            data={"unsupported_clip_count": len(unsupported_clips)},
        )
    if not clips:
        return ToolResult(text="[ERROR] no renderable video clips found in timeline")

    clips = [normalize_clip(c, ctx) for c in clips]
    try:
        target_width, target_height = resolve_render_size(args, clips)
    except RuntimeError as exc:
        return ToolResult(text=f"[ERROR] could not resolve preview canvas size: {exc}")

    default_output = "out/preview.mp4" if timeline_path.name == "timeline.json" else f"out/{timeline_path.stem}_preview.mp4"
    output_path = ctx.resolve(args.get("output_path") or default_output)
    work_dir = ctx.resolve(args.get("work_dir") or f".video_agent/render/{timeline_path.stem}")
    work_dir.mkdir(parents=True, exist_ok=True)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    started = time.time()
    segment_paths = []
    for idx, clip in enumerate(clips):
        seg_path = work_dir / f"seg_{idx:04d}.mp4"
        try:
            cut_clip(clip, seg_path, target_width=target_width, target_height=target_height)
        except Exception as exc:
            return ToolResult(
                text=f"[ERROR] ffmpeg cut failed for clip {idx}: {exc}",
                data={"clip_index": idx, "clip": clip},
            )
        segment_paths.append(seg_path)
    concat_file = work_dir / "concat.txt"
    concat_file.write_text(
        "".join(f"file '{ffconcat_escape(p)}'\n" for p in segment_paths),
        encoding="utf-8",
    )
    cmd = [
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0", "-i", str(concat_file),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "aac", "-movflags", "+faststart",
        str(output_path),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
    except Exception as exc:
        return ToolResult(text=f"[ERROR] ffmpeg concat failed: {exc}", data={"cmd": cmd})
    if proc.returncode != 0:
        return ToolResult(text=f"[ERROR] ffmpeg concat failed: {proc.stderr.strip()}", data={"cmd": cmd})
    report = {
        "timeline_path": str(timeline_path),
        "timeline_sha256": file_sha256(timeline_path),
        "output_path": str(output_path),
        "output_sha256": file_sha256(output_path),
        "segment_count": len(segment_paths),
        "renderer_scope": "legacy sequential top-level clips",
        "output_width": target_width,
        "output_height": target_height,
        "normalization": "each segment is scaled with preserved aspect ratio, padded to the preview canvas, setsar=1, and encoded as yuv420p before concat",
        "elapsed_seconds": round(time.time() - started, 3),
    }
    report_path = output_path.with_suffix(".render_report.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return ToolResult(
        text=f"Preview rendered: {ctx.virtualize(output_path)}",
        data=report,
        artifacts=[str(output_path), str(report_path)],
        video_paths=[str(output_path)],
    )


def render_project_timeline(args: dict, ctx: RunContext, data: dict, timeline_path: Path) -> ToolResult:
    try:
        plan = build_render_plan(args, ctx, data, timeline_path)
    except RuntimeError as exc:
        return ToolResult(text=f"[ERROR] render plan failed: {exc}")
    if not plan["video_clips"]:
        return ToolResult(text="[ERROR] no renderable video clips found in project timeline", data=plan)

    output_path = ctx.resolve(args.get("output_path") or "out/preview.mp4")
    work_dir = ctx.resolve(args.get("work_dir") or f".video_agent/render/{timeline_path.stem}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    started = time.time()
    # 渲染到同目录临时文件, 成功后原子替换: 半途失败/超时不会留下无 moov 的半截
    # preview.mp4
    # 临时名与 work 子目录带 pid+时间戳: 两个并发 render_preview 共用同名临时文件时,
    # 一方的 os.replace 会把另一方半写的文件当成品发布
    job_tag = f"{os.getpid()}-{time.time_ns()}"
    tmp_output = output_path.with_name(f".{output_path.stem}.render_tmp-{job_tag}{output_path.suffix}")
    job_dir = work_dir / f"job-{job_tag}"
    job_dir.mkdir(parents=True, exist_ok=True)
    try:
        cmd, filter_complex = build_project_ffmpeg_command(plan, tmp_output, job_dir)
    except Exception as exc:
        return ToolResult(
            text=f"[ERROR] ffmpeg project render command failed: {exc}",
            data={"plan": public_render_plan(plan)},
        )
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=7200)
    except Exception as exc:
        tmp_output.unlink(missing_ok=True)
        return ToolResult(text=f"[ERROR] ffmpeg project render failed: {exc}", data={"cmd": cmd})
    if proc.returncode != 0:
        tmp_output.unlink(missing_ok=True)
        return ToolResult(
            # 只带 stderr 尾部: 完整 banner + 滤镜图回显可达数 KB, 真正的错误在末尾
            text=f"[ERROR] ffmpeg project render failed: {_stderr_tail(proc.stderr)}",
            data={"cmd": cmd, "filter_complex": filter_complex},
        )
    if not tmp_output.is_file() or not source_has_video(tmp_output):
        tmp_output.unlink(missing_ok=True)
        return ToolResult(text="[ERROR] project render produced no playable video stream", data={"cmd": cmd})
    os.replace(tmp_output, output_path)
    # 成功后清掉本次的文本/音频床中间件 (失败时保留供排查); 命令行里的路径只做记录
    shutil.rmtree(job_dir, ignore_errors=True)
    # 落盘的命令行/滤镜图指向的是临时文件名, 记录时换成最终路径
    cmd = [str(output_path) if c == str(tmp_output) else c for c in cmd]

    report = {
        "timeline_path": str(timeline_path),
        "timeline_sha256": file_sha256(timeline_path),
        "output_path": str(output_path),
        "output_sha256": file_sha256(output_path),
        "renderer_scope": "project tracks: video/main, audio/music/voiceover, subtitle/text, image/overlay",
        "output_width": plan["width"],
        "output_height": plan["height"],
        "output_fps": plan["fps"],
        # QC compares against the timeline canvas unless the size came from output_width/output_height.
        "output_size_source": "render_args" if (args.get("output_width") is not None
                                                 or args.get("output_height") is not None) else "timeline",
        "expected_duration_seconds": plan["duration"],
        "video_clip_count": len(plan["video_clips"]),
        "audio_clip_count": len(plan["audio_clips"]),
        "text_clip_count": len(plan["text_clips"]),
        "overlay_clip_count": len(plan["overlay_clips"]),
        "unsupported_track_count": len(plan["unsupported_tracks"]),
        "normalization": "video clips are placed on a black sequence canvas by timeline_start with end-frame padding; audio is pre-baked into full-length timeline-positioned wav beds before mixing; text/image overlays are composited by enable windows",
        "audio_render_strategy": "prebaked_full_length_audio_beds_no_adelay",
        "video_boundary_strategy": "clone-pad clip tails and extend video overlay enable windows by a few frames",
        "elapsed_seconds": round(time.time() - started, 3),
    }
    report_path = output_path.with_suffix(".render_report.json")
    plan_path = output_path.with_suffix(".render_plan.json")
    decisions_path = output_path.with_suffix(".edit_decisions.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    # render_plan 附带实际 ffmpeg 命令与滤镜图: 三份产物与真实渲染命令可对照
    plan_path.write_text(json.dumps({**public_render_plan(plan), "ffmpeg": {"cmd": cmd, "filter_complex": filter_complex}},
                                    ensure_ascii=False, indent=2), encoding="utf-8")
    decisions_path.write_text(json.dumps(edit_decisions_from_plan(plan), ensure_ascii=False, indent=2), encoding="utf-8")
    return ToolResult(
        text=f"Project preview rendered: {ctx.virtualize(output_path)}",
        data=report,
        artifacts=[str(output_path), str(report_path), str(plan_path), str(decisions_path)],
        video_paths=[str(output_path)],
    )


def build_render_plan(args: dict, ctx: RunContext, data: dict, timeline_path: Path) -> dict:
    tracks = data.get("tracks") or []
    video_clips = []
    audio_clips = []
    text_clips = []
    overlay_clips = []
    unsupported_tracks = []
    for track_index, track in enumerate(tracks):
        if not isinstance(track, dict):
            continue
        track_type = normalize_track_type(track.get("type") or track.get("track_type") or track.get("name") or "")
        if track.get("enabled") is False:
            continue
        if track_type in AUDIO_TRACK_TYPES and track.get("muted") is True:
            continue
        if track_type in (VIDEO_TRACK_TYPES | TEXT_TRACK_TYPES | OVERLAY_TRACK_TYPES) and track.get("visible") is False:
            continue
        clip_cursor = 0.0
        clips = track.get("clips") if isinstance(track.get("clips"), list) else []
        if track_type not in (VIDEO_TRACK_TYPES | AUDIO_TRACK_TYPES | TEXT_TRACK_TYPES | OVERLAY_TRACK_TYPES):
            # 一条轨记一次 (此前在 clip 循环里逐 clip 追加, 10 个 clip 的未知轨在
            # render_plan.json 里出现 10 条同样的记录); 未知轨的 clip 也不再走
            # normalize (它们缺 source/end 时会把整次渲染炸掉)
            unsupported_tracks.append({
                "track_index": track_index,
                "track_type": track_type or str(track.get("name") or ""),
                "clip_count": len(clips),
            })
            continue
        for clip_index, raw_clip in enumerate(clips):
            if not isinstance(raw_clip, dict) or raw_clip.get("enabled") is False:
                continue
            if track_type in AUDIO_TRACK_TYPES and raw_clip.get("muted") is True:
                continue
            if track_type in (VIDEO_TRACK_TYPES | TEXT_TRACK_TYPES | OVERLAY_TRACK_TYPES) and raw_clip.get("visible") is False:
                continue
            try:
                clip = normalize_project_clip(raw_clip, ctx, track, track_index, clip_index, clip_cursor)
            except RuntimeError as exc:
                raise RuntimeError(f"track {track_index} clip {clip_index}: {exc}") from exc
            clip_cursor = max(clip_cursor, clip["timeline_start"] + clip["render_duration"])
            if track_type in VIDEO_TRACK_TYPES:
                video_clips.append(clip)
            elif track_type in AUDIO_TRACK_TYPES:
                audio_clips.append(clip)
            elif track_type in TEXT_TRACK_TYPES:
                text_clips.append(clip)
            elif track_type in OVERLAY_TRACK_TYPES:
                overlay_clips.append(clip)

    video_clips.sort(key=lambda c: (c["track_order"], c["timeline_start"], c["clip_index"]))
    audio_clips.sort(key=lambda c: (c["track_order"], c["timeline_start"], c["clip_index"]))
    text_clips.sort(key=lambda c: (c["track_order"], c["timeline_start"], c["clip_index"]))
    overlay_clips.sort(key=lambda c: (c["track_order"], c["timeline_start"], c["clip_index"]))
    width, height = resolve_project_render_size(args, data, video_clips)
    fps = resolve_project_fps(data)
    duration = resolve_project_duration(data, video_clips, audio_clips, text_clips, overlay_clips)
    if duration <= 0:
        raise RuntimeError("timeline duration is zero")
    return {
        "timeline_path": str(timeline_path),
        "timeline_sha256": file_sha256(timeline_path),
        "crf": int(args.get("crf", 20)),
        "width": width,
        "height": height,
        "fps": fps,
        "duration": duration,
        "video_clips": video_clips,
        "audio_clips": audio_clips,
        "text_clips": text_clips,
        "overlay_clips": overlay_clips,
        "unsupported_tracks": unsupported_tracks,
    }


def render_preflight_issues(data: dict, ctx: RunContext) -> list[dict]:
    """Checks video_render makes after building its plan (track types, audio presence,
    font coverage), reported by timeline_validate so a passing timeline renders."""
    issues: list[dict] = []
    if not isinstance(data, dict):
        return issues
    text_clips = []
    for track_index, track in enumerate(data.get("tracks") or []):
        if not isinstance(track, dict) or track.get("enabled") is False:
            continue
        track_type = normalize_track_type(track.get("type") or track.get("track_type") or track.get("name") or "")
        if track_type in AUDIO_TRACK_TYPES and track.get("muted") is True:
            continue
        if track_type in (VIDEO_TRACK_TYPES | TEXT_TRACK_TYPES | OVERLAY_TRACK_TYPES) and track.get("visible") is False:
            continue
        if track_type not in (VIDEO_TRACK_TYPES | AUDIO_TRACK_TYPES | TEXT_TRACK_TYPES | OVERLAY_TRACK_TYPES):
            continue  # reported by render_support_issues
        cursor = 0.0
        for clip_index, raw_clip in enumerate(track.get("clips") or []):
            if not isinstance(raw_clip, dict) or raw_clip.get("enabled") is False:
                continue
            if track_type in AUDIO_TRACK_TYPES and raw_clip.get("muted") is True:
                continue
            if track_type in (VIDEO_TRACK_TYPES | TEXT_TRACK_TYPES | OVERLAY_TRACK_TYPES) and raw_clip.get("visible") is False:
                continue
            try:
                clip = normalize_project_clip(raw_clip, ctx, track, track_index, clip_index, cursor)
            except (RuntimeError, TypeError, ValueError) as exc:
                issues.append({"severity": "error", "track": track_index, "clip": clip_index, "message": str(exc)})
                continue
            cursor = max(cursor, clip["timeline_start"] + clip["render_duration"])
            if track_type in AUDIO_TRACK_TYPES:
                source = Path(clip["source"])
                if source.is_file() and not (source_has_audio(source) and audio_covers(source, clip["start"])):
                    issues.append({"severity": "error", "track": track_index, "clip": clip_index,
                                   "message": f"audio track source has no audio at {clip['start']:.3f}s: {source}"})
            elif track_type in TEXT_TRACK_TYPES:
                text_clips.append(clip)
            try:
                # Same filter builders as the render: style and position checks stay in one place.
                if track_type in TEXT_TRACK_TYPES:
                    drawtext_filter("in", "out", clip, Path("text.txt"), None)
                elif track_type in OVERLAY_TRACK_TYPES:
                    _position_expr(clip.get("x"), "0", "x", "overlay clip")
                    _position_expr(clip.get("y"), "0", "y", "overlay clip")
            except RuntimeError as exc:
                issues.append({"severity": "error", "track": track_index, "clip": clip_index, "message": str(exc)})
    shared_text = "".join(str(c.get("text") or "") for c in text_clips if not c.get("font_file"))
    if shared_text.strip():
        fontfile = find_fontfile(shared_text)
        uncovered = font_uncovered_characters(fontfile, shared_text)
        if uncovered:
            issues.append({"severity": "error",
                           "message": f"no available font covers the text clips (missing glyphs for "
                                      f"{''.join(uncovered)!r}; fontfile={fontfile}); set style.font_file to a "
                                      "covering font or point VE_FONT_DIRS at one"})
    for clip in text_clips:
        if clip.get("font_file"):
            uncovered = font_uncovered_characters(clip["font_file"], str(clip.get("text") or ""))
            if uncovered:
                issues.append({"severity": "error", "track": clip["track_index"], "clip": clip["clip_index"],
                               "message": f"font_file lacks glyphs for {''.join(uncovered)!r}: {clip['font_file']}"})
    return issues


def normalize_project_clip(
    raw: dict,
    ctx: RunContext,
    track: dict,
    track_index: int,
    clip_index: int,
    clip_cursor: float,
) -> dict:
    source = raw.get("source") or raw.get("input_path") or raw.get("src")
    source_path = str(ctx.resolve(str(source))) if source else ""
    timeline_start = raw.get("timeline_start", raw.get("position"))
    timeline_start_f = clip_cursor if timeline_start is None else float(timeline_start)
    if timeline_start_f < 0 or not math.isfinite(timeline_start_f):
        raise RuntimeError("timeline_start must be finite and >= 0")
    start = float(raw.get("start", raw.get("start_time", raw.get("in", 0.0))))
    if raw.get("end", raw.get("end_time", raw.get("out"))) is not None:
        end = float(raw.get("end", raw.get("end_time", raw.get("out"))))
    elif raw.get("duration") is not None:
        end = start + float(raw["duration"])
    elif not source and raw.get("timeline_end") is not None:
        end = start + float(raw["timeline_end"]) - timeline_start_f
    else:
        end = start
    source_duration = max(0.0, end - start)
    speed = float(raw.get("speed") or 1.0)
    if speed <= 0 or not math.isfinite(speed):
        raise RuntimeError("speed must be finite and > 0")
    render_duration = source_duration / speed if source_duration > 0 else float(raw.get("duration") or 0.0)
    if render_duration <= 0 or not math.isfinite(render_duration):
        raise RuntimeError("clip render duration must be finite and > 0")
    return {
        **raw,
        "source": source_path,
        "start": start,
        "end": end,
        "source_duration": source_duration,
        "render_duration": render_duration,
        "timeline_start": timeline_start_f,
        "timeline_end": timeline_start_f + render_duration,
        "speed": speed,
        "volume": _level(raw, track, "volume"),
        "opacity": _level(raw, track, "opacity"),
        "font_file": _clip_font_file(raw, ctx),
        "muted": bool(raw.get("muted") or track.get("muted")),
        "track_index": track_index,
        "clip_index": clip_index,
        "track_order": int(track["order"]) if track.get("order") is not None else track_index,
        "track_name": str(track.get("name") or track.get("type") or ""),
        "track_type": normalize_track_type(track.get("type") or track.get("track_type") or track.get("name") or ""),
    }


def _level(raw: dict, track: dict, key: str) -> float:
    """Clip value, else track value, else 1.0. An explicit null means "not set": it used to
    become 0 and silently muted the clip or made it fully transparent."""
    for holder in (raw, track):
        value = holder.get(key)
        if value is not None:
            if isinstance(value, bool):
                raise RuntimeError(f"{key} must be a number")
            try:
                return float(value)
            except (TypeError, ValueError):
                raise RuntimeError(f"{key} must be a number") from None
    return 1.0


def _text_style(clip: dict) -> dict:
    """Text options: clip.style supplies defaults, fields on the clip itself win."""
    style = clip.get("style") if isinstance(clip.get("style"), dict) else {}
    return {**style, **{key: value for key, value in clip.items() if value is not None}}


def _clip_font_file(raw: dict, ctx: RunContext) -> str:
    font = _text_style(raw).get("font_file")
    if not font:
        return ""
    path = ctx.resolve(str(font))
    if not path.is_file():
        raise RuntimeError(f"font_file not found: {path}")
    return str(path)


def resolve_project_render_size(args: dict, data: dict, video_clips: list[dict]) -> tuple[int, int]:
    if args.get("output_width") is not None or args.get("output_height") is not None:
        return resolve_render_size(args, video_clips)
    for candidate in (
        data.get("output_canvas"),
        (data.get("sequence") or {}).get("canvas") if isinstance(data.get("sequence"), dict) else None,
        (data.get("sequence") or {}).get("output_canvas") if isinstance(data.get("sequence"), dict) else None,
        # sequence.width/height is the documented form and the one video_qc compares against.
        data.get("sequence"),
    ):
        if isinstance(candidate, dict) and candidate.get("width") and candidate.get("height"):
            return even_dimension(int(candidate["width"])), even_dimension(int(candidate["height"]))
    if not video_clips:
        raise RuntimeError("cannot infer canvas without a video clip")
    return probe_video_size(Path(video_clips[0]["source"]))


def resolve_project_fps(data: dict) -> float:
    for candidate in (
        data.get("output_canvas"),
        (data.get("sequence") or {}).get("canvas") if isinstance(data.get("sequence"), dict) else None,
        (data.get("sequence") or {}).get("output_canvas") if isinstance(data.get("sequence"), dict) else None,
        data.get("sequence"),
    ):
        if isinstance(candidate, dict) and candidate.get("fps"):
            fps = float(candidate["fps"])
            if math.isfinite(fps) and fps > 0:
                return fps
    return 30.0


def resolve_project_duration(data: dict, *clip_groups: list[dict]) -> float:
    if isinstance(data.get("sequence"), dict) and data["sequence"].get("duration"):
        duration = float(data["sequence"]["duration"])
        if math.isfinite(duration) and duration > 0:
            return duration
    max_end = 0.0
    for group in clip_groups:
        for clip in group:
            max_end = max(max_end, float(clip["timeline_end"]))
    return max_end


def build_project_ffmpeg_command(plan: dict, output_path: Path, work_dir: Path) -> tuple[list[str], str]:
    cmd = ["ffmpeg", "-y"]
    input_kinds = []
    for clip in plan["video_clips"]:
        suffix = Path(str(clip["source"])).suffix.lower()
        if suffix == ".gif":
            clip["video_still"] = True
            cmd += ["-stream_loop", "-1", "-t", f"{clip['render_duration']:.6f}", "-i", clip["source"]]
        elif suffix in _STILL_IMAGE_SUFFIXES:
            # A single decoded frame lasted only the tail padding and the rest of the clip was black.
            clip["video_still"] = True
            cmd += ["-loop", "1", "-t", f"{clip['render_duration']:.6f}", "-i", clip["source"]]
        else:
            cmd += ["-ss", f"{clip['start']:.6f}", "-t", f"{clip['source_duration']:.6f}", "-i", clip["source"]]
        input_kinds.append(("video", clip))
    for clip in plan["overlay_clips"]:
        still = overlay_source_is_still(clip["source"])
        clip["overlay_still"] = still
        if Path(str(clip["source"])).suffix.lower() == ".gif":
            # gif demuxer 没有 -loop (只有 ignore_loop); -stream_loop 对单帧/动图都成立
            cmd += ["-stream_loop", "-1", "-t", f"{clip['render_duration']:.6f}", "-i", clip["source"]]
        elif still:
            cmd += ["-loop", "1", "-t", f"{clip['render_duration']:.6f}", "-i", clip["source"]]
        else:
            # -loop 是 image2 demuxer 选项, 对 mp4 等视频源 ffmpeg 直接报
            # "Option loop not found" 退出; b_roll/画中画视频按 start/end 截取
            cmd += ["-ss", f"{clip['start']:.6f}", "-t", f"{clip['source_duration']:.6f}", "-i", clip["source"]]
        input_kinds.append(("overlay", clip))
    for bed_path, clip in bake_project_audio_beds(plan, work_dir):
        cmd += ["-i", str(bed_path)]
        input_kinds.append(("audio_bed", clip))

    filters = [f"color=c=black:s={plan['width']}x{plan['height']}:r={plan['fps']}:d={plan['duration']:.6f}[vbase0]"]
    current_video = "vbase0"
    audio_labels = []
    input_index = 0
    video_overlay_idx = 0
    for kind, clip in input_kinds:
        if kind == "video":
            label = f"vclip{video_overlay_idx}"
            filters.append(video_clip_filter(input_index, clip, plan, label))
            out_label = f"vcomp{video_overlay_idx}"
            filters.append(
                f"[{current_video}][{label}]overlay=0:0:eof_action=pass:shortest=0"
                f":enable='{between_expr(clip, video_end_pad(plan))}'[{out_label}]"
            )
            current_video = out_label
            video_overlay_idx += 1
        elif kind == "overlay":
            label = f"ov{video_overlay_idx}"
            filters.append(overlay_clip_filter(input_index, clip, plan, label))
            # Expressions such as "(W-w)/2" used to fall back to 0 and put the layer top-left.
            x = _position_expr(clip.get("x"), "0", "x", "overlay clip")
            y = _position_expr(clip.get("y"), "0", "y", "overlay clip")
            out_label = f"vcomp{video_overlay_idx}"
            filters.append(
                f"[{current_video}][{label}]overlay=x='{x}':y='{y}':eof_action=pass:shortest=0"
                f":enable='{between_expr(clip)}'[{out_label}]"
            )
            current_video = out_label
            video_overlay_idx += 1
        elif kind == "audio_bed":
            audio_label = f"aud{len(audio_labels)}"
            filters.append(audio_bed_filter(input_index, audio_label))
            audio_labels.append(audio_label)
        input_index += 1

    text_current = current_video
    all_text = "".join(str(clip.get("text") or "") for clip in plan["text_clips"] if not clip.get("font_file"))
    fontfile = find_fontfile(all_text) if plan["text_clips"] else None
    if plan["text_clips"] and all_text.strip():
        uncovered = font_uncovered_characters(fontfile, all_text)
        if uncovered:
            # fontconfig/候选表兜底常给出 DejaVu 这类无 CJK 字形的字体, drawtext 会把
            # 中文渲成方框但 ffmpeg 正常退出、QC 也 pass —— 在渲染前拦下。
            # 本函数返回 tuple, 这里必须抛异常而不是 return ToolResult (否则调用点解包
            # 成 "cannot unpack non-iterable ToolResult", 提示全丢)
            raise RuntimeError(
                "no available font covers the subtitle/title text "
                f"(missing glyphs for {''.join(uncovered)!r}; fontfile={fontfile}); install a CJK font or point "
                "VE_FONT_DIRS at a directory with NotoSansCJK/SourceHanSans/*.ttc"
            )
    for idx, clip in enumerate(plan["text_clips"]):
        text_path = work_dir / f"text_{idx:04d}.txt"
        text_path.write_text(str(clip.get("text") or ""), encoding="utf-8")
        out_label = f"vtext{idx}"
        clip_font = clip.get("font_file") or fontfile
        if clip.get("font_file"):
            uncovered = font_uncovered_characters(clip_font, str(clip.get("text") or ""))
            if uncovered:
                raise RuntimeError(f"font_file lacks glyphs for {''.join(uncovered)!r}: {clip_font}")
        filters.append(drawtext_filter(text_current, out_label, clip, text_path, clip_font))
        text_current = out_label
    filters.append(f"[{text_current}]trim=duration={plan['duration']:.6f},setpts=PTS-STARTPTS[vout]")

    if audio_labels:
        mix_inputs = "".join(f"[{label}]" for label in audio_labels)
        filters.append(
            f"{mix_inputs}amix=inputs={len(audio_labels)}:duration=longest:dropout_transition=0:normalize=0,"
            # levels add up (normalize=0); only peaks above the limit are reduced, with no
            # auto gain and with latency compensated so audio stays in sync
            "alimiter=limit=0.98:level=false:latency=true,"
            f"atrim=0:{plan['duration']:.6f},asetpts=PTS-STARTPTS[aout]"
        )
    else:
        filters.append(f"anullsrc=channel_layout=stereo:sample_rate=48000:d={plan['duration']:.6f}[aout]")
    filter_complex = ";".join(filters)
    cmd += [
        "-filter_complex", filter_complex,
        "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", str(plan["crf"]),
        "-c:a", "aac", "-ar", "48000", "-ac", "2",
        "-movflags", "+faststart",
        str(output_path),
    ]
    return cmd, filter_complex


def bake_project_audio_beds(plan: dict, work_dir: Path) -> list[tuple[Path, dict]]:
    """Render every timeline audio contribution to a full-length wav bed.

    Keeping timeline placement out of the main ffmpeg graph avoids the
    adelay+atrim timestamp interaction that can move delayed audio back to t=0
    or truncate the tail on newer ffmpeg builds. The main render graph then
    only mixes already-positioned, equal-length audio streams.
    """
    beds: list[tuple[Path, dict]] = []
    audio_jobs: list[dict] = []
    for clip in plan["video_clips"]:
        if clip.get("muted"):
            continue
        source = Path(clip["source"])
        if source_has_audio(source) and audio_covers(source, clip["start"]):
            audio_jobs.append(clip)
    for clip in plan["audio_clips"]:
        source = Path(clip["source"])
        if not (source_has_audio(source) and audio_covers(source, clip["start"])):
            # Dropping it silently delivered a film without the requested music/voice.
            raise RuntimeError(f"audio track {clip['track_index']} clip {clip['clip_index']}: "
                               f"source has no audio at {clip['start']:.3f}s: {source}")
        audio_jobs.append(clip)
    audio_dir = work_dir / "audio_beds"
    audio_dir.mkdir(parents=True, exist_ok=True)
    for idx, clip in enumerate(audio_jobs):
        bed_path = audio_dir / f"aud_{idx:04d}.wav"
        render_audio_bed(clip, plan, bed_path)
        if bed_path.is_file() and bed_path.stat().st_size > 1024:
            beds.append((bed_path, clip))
    return beds


def render_audio_bed(clip: dict, plan: dict, output_path: Path) -> None:
    pre = max(0.0, float(clip["timeline_start"]))
    body = max(0.001, float(clip["render_duration"]))
    post = max(0.0, float(plan["duration"]) - pre - body)
    labels: list[str] = []
    filters: list[str] = []
    if pre > 0.001:
        filters.append(f"anullsrc=channel_layout=stereo:sample_rate=48000:d={pre:.6f}[pre]")
        labels.append("[pre]")
    clip_parts = [
        "aresample=48000",
        "aformat=channel_layouts=stereo",
        "asetpts=PTS-STARTPTS",
    ]
    speed = float(clip.get("speed") or 1.0)
    if abs(speed - 1.0) > 0.0001:
        clip_parts.append(atempo_chain(speed))
    volume = max(0.0, float(clip.get("volume", 1.0)))
    clip_parts += [
        f"volume={volume:.6f}",
        *audio_fade_filters(clip, body),
        f"apad=pad_dur={body + 0.25:.6f}",
        f"atrim=0:{body:.6f}",
        "asetpts=PTS-STARTPTS",
    ]
    filters.append("[0:a]" + ",".join(clip_parts) + "[body]")
    labels.append("[body]")
    if post > 0.001:
        filters.append(f"anullsrc=channel_layout=stereo:sample_rate=48000:d={post:.6f}[post]")
        labels.append("[post]")
    if len(labels) == 1:
        filters.append(f"{labels[0]}apad=pad_dur={plan['duration']:.6f},atrim=0:{plan['duration']:.6f},asetpts=PTS-STARTPTS[aout]")
    else:
        filters.append(
            "".join(labels)
            + f"concat=n={len(labels)}:v=0:a=1,"
            + f"apad=pad_dur={plan['duration']:.6f},atrim=0:{plan['duration']:.6f},asetpts=PTS-STARTPTS[aout]"
        )
    cmd = [
        "ffmpeg", "-y",
        "-ss", f"{clip['start']:.6f}",
        "-t", f"{clip['source_duration']:.6f}",
        "-i", clip["source"],
        "-filter_complex", ";".join(filters),
        "-map", "[aout]",
        "-c:a", "pcm_s16le",
        str(output_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or f"failed to render audio bed for {clip.get('source')}")


def audio_fade_filters(clip: dict, body: float) -> list[str]:
    """Clip fades of audio-track clips, in output time (applied after atempo)."""
    if clip.get("track_type") not in AUDIO_TRACK_TYPES:
        return []
    parts = []
    for key, direction in (("transition_in", "in"), ("transition_out", "out")):
        value = clip.get(key)
        if not isinstance(value, dict):
            continue
        duration = min(float(value.get("duration") or 0), body)
        if str(value.get("type") or value.get("name") or "").lower() in {"fade", "crossfade", "dissolve"} and duration > 0:
            start = 0.0 if direction == "in" else max(0.0, body - duration)
            parts.append(f"afade=t={direction}:st={start:.6f}:d={duration:.6f}")
    return parts


def audio_bed_filter(input_index: int, label: str) -> str:
    return f"[{input_index}:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS[{label}]"


def video_clip_filter(input_index: int, clip: dict, plan: dict, label: str) -> str:
    pad = video_end_pad(plan)
    vf = [
        f"scale={plan['width']}:{plan['height']}:force_original_aspect_ratio=decrease",
        f"pad={plan['width']}:{plan['height']}:(ow-iw)/2:(oh-ih)/2",
        f"fps={plan['fps']}",
        "setsar=1",
        "format=yuva420p",
        f"tpad=stop_mode=clone:stop_duration={pad:.6f}",
    ]
    opacity = max(0.0, min(1.0, float(clip.get("opacity", 1.0))))
    if opacity < 1.0:
        vf.append(f"colorchannelmixer=aa={opacity:.6f}")
    if clip.get("video_still"):
        # Looped stills already last render_duration; source speed does not apply.
        clip = {**clip, "speed": 1.0, "source_duration": clip["render_duration"]}
    vf.append(transition_fade_filter(clip))
    vf.append(f"setpts=(PTS-STARTPTS)/{clip['speed']:.8f}+{clip['timeline_start']:.6f}/TB")
    return f"[{input_index}:v]" + ",".join(part for part in vf if part) + f"[{label}]"


def overlay_clip_filter(input_index: int, clip: dict, plan: dict, label: str) -> str:
    width = int(clip.get("width") or clip.get("output_width") or 0)
    height = int(clip.get("height") or clip.get("output_height") or 0)
    parts = []
    if width > 0 and height > 0:
        parts.append(f"scale={even_dimension(width)}:{even_dimension(height)}:force_original_aspect_ratio=decrease")
    parts += [
        f"fps={plan['fps']}",
        "setsar=1",
        "format=yuva420p",
    ]
    opacity = clip.get("opacity")
    if opacity is not None and not isinstance(opacity, bool):
        try:
            alpha = float(opacity)
        except (TypeError, ValueError):
            alpha = 1.0
        if math.isfinite(alpha) and 0.0 <= alpha < 1.0:
            # 此前 opacity 被静默忽略 (例如 logo 叠加图常用 0.85)
            parts.append(f"colorchannelmixer=aa={alpha:.4f}")
    # 视频源叠加层按 speed 重定时; 静态图/循环 gif 已按 render_duration 生成, speed 不适用
    still = clip.get("overlay_still")
    if still is None:
        still = overlay_source_is_still(clip["source"])
    speed = 1.0 if still or Path(str(clip["source"])).suffix.lower() == ".gif" else float(clip.get("speed") or 1.0)
    looped = still or Path(str(clip["source"])).suffix.lower() == ".gif"
    fade = transition_fade_filter({**clip, "speed": 1.0, "source_duration": clip["render_duration"]} if looped else clip)
    if fade:
        parts.append(fade)
    parts.append(f"setpts=(PTS-STARTPTS)/{speed:.8f}+{clip['timeline_start']:.6f}/TB")
    return f"[{input_index}:v]" + ",".join(parts) + f"[{label}]"


_STILL_IMAGE_SUFFIXES = STILL_IMAGE_SUFFIXES


def overlay_source_is_still(source: str) -> bool:
    """叠加层源是静态图 (需 -loop 1 循环成时长) 还是视频 (按 -ss/-t 截取)。
    gif 单独处理 (见 build_project_ffmpeg_command), 这里按视频归类。"""
    path = Path(str(source))
    if path.suffix.lower() in _STILL_IMAGE_SUFFIXES:
        return True
    if path.suffix.lower() == ".gif":
        return False
    # 无扩展名/罕见格式: 探到视频流即当视频; 探不到就按静态图处理 (保持旧行为)
    return not source_has_video(path)


def atempo_chain(speed: float) -> str:
    parts = []
    remaining = speed
    while remaining > 2.0:
        parts.append("atempo=2.0")
        remaining /= 2.0
    while remaining < 0.5:
        parts.append("atempo=0.5")
        remaining /= 0.5
    parts.append(f"atempo={remaining:.8f}")
    return ",".join(parts)


def transition_fade_filter(clip: dict) -> str:
    parts = []
    for key, direction in (("transition_in", "in"), ("transition_out", "out")):
        value = clip.get(key)
        if not isinstance(value, dict):
            continue
        kind = str(value.get("type") or value.get("name") or "").lower()
        duration = float(value.get("duration") or 0)
        if kind in {"fade", "crossfade", "dissolve"} and duration > 0:
            # fade 位于 setpts 之前, 时间轴是源时间: render 里的 d 秒对应源里的
            # d*speed 秒 (speed=2 时若按 render 时长算, 淡出会落在 clip 中段, 后半
            # 段整段透明)
            speed = float(clip.get("speed") or 1.0)
            source_duration = float(clip.get("source_duration") or 0.0) or float(clip["render_duration"]) * speed
            fade_src = min(duration * speed, source_duration)
            if direction == "in":
                parts.append(f"fade=t=in:st=0:d={fade_src:.6f}:alpha=1")
            else:
                start = max(0.0, source_duration - fade_src)
                parts.append(f"fade=t=out:st={start:.6f}:d={fade_src:.6f}:alpha=1")
    return ",".join(parts)


def drawtext_filter(input_label: str, output_label: str, clip: dict, text_path: Path, fontfile: str | None) -> str:
    style = _text_style(clip)
    try:
        fontsize = int(float(style.get("fontsize") or style.get("font_size") or 42))
    except (TypeError, ValueError):
        raise RuntimeError("text clip font_size must be a number") from None
    if fontsize <= 0:
        raise RuntimeError("text clip font_size must be positive")
    fontcolor = filter_string(str(style.get("fontcolor") or style.get("font_color") or "white"))
    boxcolor = filter_string(str(style.get("boxcolor") or style.get("box_color") or "black@0.55"))
    x = _position_expr(style.get("x"), "(w-text_w)/2", "x")
    y = _position_expr(style.get("y"), "h-text_h-72", "y")
    args = [
        f"textfile={filter_path(text_path)}",
        # 字幕文本必须按字面渲染: drawtext 默认 expansion=normal 会把 "100%" 里的 %
        # 当 %{...} 展开语法, 报 "Stray %" 后整条文本渲成空白而 ffmpeg 仍正常退出
        # (e2e 实测), QC 也 pass —— 字幕静默消失
        "expansion=none",
        f"fontcolor={fontcolor}",
        f"fontsize={fontsize}",
        "box=1",
        f"boxcolor={boxcolor}",
        "boxborderw=14",
        f"x='{x}'",
        f"y='{y}'",
        f"enable='{between_expr(clip)}'",
    ]
    if fontfile:
        args.insert(0, f"fontfile={filter_path(Path(fontfile))}")
    return f"[{input_label}]drawtext=" + ":".join(args) + f"[{output_label}]"


def between_expr(clip: dict, end_pad: float = 0.0) -> str:
    end = float(clip["timeline_end"]) + max(0.0, end_pad)
    return f"between(t,{clip['timeline_start']:.6f},{end:.6f})"


def video_end_pad(plan: dict) -> float:
    try:
        fps = float(plan.get("fps") or 30.0)
    except Exception:
        fps = 30.0
    if not math.isfinite(fps) or fps <= 0:
        fps = 30.0
    return max(0.04, min(0.12, 3.0 / fps))


def filter_number(value: object, default: str) -> str:
    if value is None:
        return default
    try:
        parsed = float(value)
    except Exception:
        return default
    if not math.isfinite(parsed):
        return default
    return f"{parsed:.6f}"


_POSITION_EXPR_RE = re.compile(r"^[0-9A-Za-z_+\-*/().,% ]+$")


def _position_expr(value, default: str, name: str, owner: str = "text clip") -> str:
    """drawtext x/y: None/空串用默认; 0 是合法坐标 (此前 `or` 把 0 当假值退回居中);
    只放行由数字/标识符/四则运算组成的表达式, 引号等会破坏滤镜图的字符直接拒绝。"""
    if value is None or (isinstance(value, str) and not value.strip()):
        return default
    if isinstance(value, bool):
        raise RuntimeError(f"{owner} {name} must be a number or ffmpeg expression, not a boolean")
    if isinstance(value, (int, float)):
        if not math.isfinite(float(value)):
            raise RuntimeError(f"{owner} {name} must be finite")
        return f"{float(value):.6f}".rstrip("0").rstrip(".")
    text = str(value).strip()
    if not _POSITION_EXPR_RE.match(text):
        raise RuntimeError(f"{owner} {name}={text!r} contains characters not allowed in a position expression")
    return text


def filter_path(path: Path) -> str:
    """路径/选项值在滤镜图里未加引号使用: ffmpeg 解析两层 (滤镜图层 `\\ ' [ ] , ;` 与
    选项值层 `\\ ' :`), 只转义一层时含逗号/方括号的目录名会报 Invalid argument。"""
    level1 = re.sub(r"([\\':])", r"\\\1", str(path))
    return re.sub(r"([\\'\[\],;])", r"\\\1", level1)


def filter_string(value: str) -> str:
    level1 = re.sub(r"([\\':])", r"\\\1", value)
    return re.sub(r"([\\'\[\],;])", r"\\\1", level1)


def _stderr_tail(text: str | None, limit: int = 1200) -> str:
    lines = [l for l in (text or "").strip().splitlines() if l.strip()]
    # 跳过 banner/配置回显 (以两个空格开头的 configuration/lib 行)
    lines = [l for l in lines if not l.startswith("  ") and not l.startswith("ffmpeg version")]
    tail = "\n".join(lines[-12:])
    return tail[-limit:]


def _font_charset(font_file: str) -> frozenset[int] | None:
    """cmap codepoints of the font (first face of a .ttc); None = unknown (no fontTools)."""
    try:
        from fontTools.ttLib import TTFont

        with TTFont(font_file, fontNumber=0, lazy=True) as font:
            return frozenset(font.getBestCmap())
    except Exception:
        return None


def font_uncovered_characters(font_file: str | None, text: str, limit: int = 12) -> list[str]:
    """Characters ``font_file`` has no glyph for (ignoring whitespace). Empty when
    coverage is complete or cannot be determined (fontTools missing). A missing
    font counts as uncovered when the text has any non-ASCII character."""
    meaningful = [ch for ch in text if not ch.isspace()]
    if not meaningful:
        return []
    if not font_file:
        non_ascii = sorted({ch for ch in meaningful if ord(ch) > 127})
        return non_ascii[:limit]
    charset = _font_charset(font_file)
    if charset is None:
        return []
    missing: list[str] = []
    seen: set[str] = set()
    for ch in meaningful:
        if ch in seen:
            continue
        seen.add(ch)
        if ord(ch) not in charset:
            missing.append(ch)
        if len(missing) >= limit:
            break
    return missing


def _fc_match_font(text: str) -> str | None:
    """fontconfig 兜底: 按文本语言要一个字体文件路径 (无 fc-match 时 None)。"""
    if not shutil.which("fc-match"):
        return None
    lang = "zh" if any("\u4e00" <= ch <= "\u9fff" for ch in text) else "en"
    try:
        proc = subprocess.run(
            ["fc-match", "-f", "%{file}", f":lang={lang}"],
            capture_output=True, text=True, timeout=20, check=False,
        )
    except Exception:
        return None
    path = (proc.stdout or "").strip()
    return path if path and Path(path).is_file() else None


def find_fontfile(text: str = "") -> str | None:
    """Pick a font for drawtext. Candidates: VE_FONT_DIRS / VIDEO_EDIT_FONT_DIRS,
    fontconfig (by text language), then well-known paths. The first candidate whose
    cmap covers ``text`` wins; without fontTools the first existing file wins."""
    candidates: list[str] = []
    from .run_context import clean_env
    font_dirs = clean_env("VE_FONT_DIRS", "VIDEO_EDIT_FONT_DIRS") or ""
    for raw_dir in [p for p in font_dirs.split(os.pathsep) if p.strip()]:
        font_dir = Path(raw_dir)
        if font_dir.is_dir():
            candidates.extend(
                str(p) for p in sorted(font_dir.iterdir())
                if p.is_file() and p.suffix.lower() in {".ttf", ".ttc", ".otf"}
            )
    fc = _fc_match_font(text)
    if fc:
        candidates.append(fc)
    candidates.extend([
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.otf",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
        "/usr/share/fonts/truetype/arphic/uming.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    ])
    existing = [c for c in candidates if Path(c).is_file()]
    if not existing:
        return None
    if text.strip():
        for candidate in existing:
            if not font_uncovered_characters(candidate, text):
                return candidate
    return existing[0]


def public_render_plan(plan: dict) -> dict:
    return {
        key: value for key, value in plan.items()
        if key not in {"cmd", "filter_complex"}
    }


def edit_decisions_from_plan(plan: dict) -> dict:
    return {
        "timeline_path": plan["timeline_path"],
        "timeline_sha256": plan["timeline_sha256"],
        "sequence": {
            "width": plan["width"],
            "height": plan["height"],
            "fps": plan["fps"],
            "duration": plan["duration"],
        },
        "decisions": [
            {
                "kind": "video_clip",
                "track": clip["track_name"],
                "source": clip.get("source"),
                "source_start": clip.get("start"),
                "source_end": clip.get("end"),
                "timeline_start": clip.get("timeline_start"),
                "timeline_end": clip.get("timeline_end"),
                "reason": clip.get("reason"),
                "beat": clip.get("beat"),
            }
            for clip in plan["video_clips"]
        ],
        "rendered_overlays": [
            {
                "kind": "text" if clip in plan["text_clips"] else "overlay",
                "track": clip["track_name"],
                "timeline_start": clip.get("timeline_start"),
                "timeline_end": clip.get("timeline_end"),
                "text": clip.get("text"),
                "source": clip.get("source"),
                "reason": clip.get("reason"),
            }
            for clip in [*plan["text_clips"], *plan["overlay_clips"]]
        ],
        "rendered_audio": [
            {
                "kind": "audio_clip",
                "track": clip["track_name"],
                "source": clip.get("source"),
                "source_start": clip.get("start"),
                "source_end": clip.get("end"),
                "timeline_start": clip.get("timeline_start"),
                "timeline_end": clip.get("timeline_end"),
                "volume": clip.get("volume"),
                "reason": clip.get("reason"),
            }
            for clip in plan["audio_clips"]
        ],
        "unsupported_tracks": plan["unsupported_tracks"],
    }


def ffconcat_escape(path: Path) -> str:
    return path.as_posix().replace("'", "'\\''")


def cut_clip(clip: dict, output_path: Path, *, target_width: int, target_height: int) -> None:
    duration = float(clip["end"]) - float(clip["start"])
    if duration <= 0:
        raise RuntimeError(f"invalid clip duration: {duration}")
    afade = f"afade=t=in:st=0:d=0.03,afade=t=out:st={max(0.0, duration - 0.03):.6f}:d=0.03"
    # 音轨比视频短的源: 窗口起点已过音轨末尾时, -map 0:a:0 + -shortest 会把
    # 分段掐成 0 流空文件 — 按无音轨处理 (补静音), 而不是让下游校验响亮失败
    has_audio = source_has_audio(Path(clip["source"])) and audio_covers(
        Path(clip["source"]), float(clip["start"])
    )
    cmd = [
        "ffmpeg", "-y",
        "-ss", f"{clip['start']:.6f}",
        "-t", f"{duration:.6f}",
        "-i", clip["source"],
    ]
    if has_audio:
        cmd += ["-map", "0:v:0", "-map", "0:a:0"]
    else:
        cmd += [
            "-f", "lavfi", "-t", f"{duration:.6f}",
            "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-map", "0:v:0", "-map", "1:a:0",
        ]
    vf = (
        f"scale={target_width}:{target_height}:force_original_aspect_ratio=decrease,"
        f"pad={target_width}:{target_height}:(ow-iw)/2:(oh-ih)/2,"
        "setsar=1,format=yuv420p"
    )
    cmd += [
        "-vf", vf,
    ]
    if has_audio:
        cmd += ["-af", afade]
    cmd += [
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-c:a", "aac", "-ar", "48000", "-ac", "2",
        "-shortest",
        "-avoid_negative_ts", "make_zero",
        str(output_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "ffmpeg cut failed")
    # 亚帧时长 clip (< 1 帧间隔) 会让 ffmpeg 输出 0 视频帧但 exit 0 — 无视频流
    # 的分段进 concat 会按首文件定流布局, 整条 preview 静默丢视频。此处拦下。
    if not source_has_video(output_path):
        raise RuntimeError(
            f"cut produced no video stream for {clip['start']:.3f}-{clip['end']:.3f}s of "
            f"{clip['source']} — the clip is likely shorter than one source frame interval "
            "(or the source has no decodable video in this range); extend the clip window"
        )


def resolve_render_size(args: dict, clips: list[dict]) -> tuple[int, int]:
    width_arg = args.get("output_width")
    height_arg = args.get("output_height")
    if width_arg is None and height_arg is None:
        return probe_video_size(Path(clips[0]["source"]))
    if width_arg is None or height_arg is None:
        raise RuntimeError("output_width and output_height must be provided together")
    try:
        if isinstance(width_arg, bool) or isinstance(height_arg, bool):
            raise ValueError("render dimensions must not be booleans")
        if (isinstance(width_arg, float) and not width_arg.is_integer()) or (
            isinstance(height_arg, float) and not height_arg.is_integer()
        ):
            # int() 截断 + 取偶双重漂移 (640.7 -> 640): 与 basic_ops.int_arg 同口径拒绝
            raise ValueError("render dimensions must be integers")
        width = int(width_arg)
        height = int(height_arg)
    except Exception as exc:
        raise RuntimeError("output_width/output_height must be integers") from exc
    if width <= 0 or height <= 0:
        raise RuntimeError("output_width/output_height must be positive")
    return even_dimension(width), even_dimension(height)


def probe_video_size(source: Path) -> tuple[int, int]:
    from .observation_media import probe
    info = probe(source)
    if not info.get("width") or not info.get("height"):
        raise RuntimeError("source has no video dimensions")
    return even_dimension(info["width"]), even_dimension(info["height"])


def even_dimension(value: int) -> int:
    if isinstance(value, bool):
        raise RuntimeError("render dimensions must be integers, not booleans")
    value = int(value)
    if not math.isfinite(float(value)) or value <= 0:
        raise RuntimeError("render dimensions must be finite positive integers")
    if value < 2:
        return 2
    return value if value % 2 == 0 else value - 1


def renderable_video_clips(clips: list[dict]) -> tuple[list[dict], list[dict]]:
    renderable: list[dict] = []
    unsupported: list[dict] = []
    for clip in clips:
        # 只看 timeline_clips 映射进来的父轨类型 (untyped 父轨 => "")。契约与
        # validate_timeline 的 check_clip 一致: clip 级 type/track_type 是
        # 编辑标签, 不能把未指定/非视频父轨的 clip 提升为可渲染 — 否则会渲染
        # 契约声明不支持的 timeline, 或对 validator 判过 pass 的字幕 clip
        # 以 source=None 起 ffmpeg 报出无意义错误。
        track_type = normalize_track_type(clip.get("track_type") or "")
        if track_type in VIDEO_TRACK_TYPES:
            renderable.append(clip)
        else:
            unsupported.append(clip)
    return renderable, unsupported


def renderable_timeline_clips(data: dict) -> tuple[list[dict], list[dict]]:
    if not isinstance(data, dict):
        return [], []
    if isinstance(data.get("clips"), list):
        return timeline_clips(data), []
    return renderable_video_clips(timeline_clips(data))


def source_has_audio(source: Path) -> bool:
    return _has_stream(source, "a:0")


def source_has_video(source: Path) -> bool:
    return _has_stream(source, "v:0")


def audio_covers(source: Path, start: float) -> bool:
    from .observation_media import probe
    streams = probe(source).get("audio_streams", [])
    durations = [float(s["duration"]) for s in streams if s.get("duration") not in (None, "N/A")]
    return max(durations) > start + 0.01 if durations else bool(streams)


def _has_stream(source: Path, selector: str) -> bool:
    from .observation_media import probe
    try:
        return probe(source)["has_audio" if selector.startswith("a") else "has_video"]
    except Exception:
        return False
