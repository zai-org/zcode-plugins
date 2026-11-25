"""Match-mode adapters for the existing arrangement, narration and render tools.

The soccer and game kernels retain their established window/placement grammar.
This boundary owns source identities, shared speech, validation and publication.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
from pathlib import Path
import re
import tempfile
from functools import wraps

from . import match_games, match_review, match_soccer, tts
from .creation_planning import file_digest
from .file_contract import output_locks, protect_outputs, publish_files
from .result import ToolResult

SPORTS = {"soccer", "basketball", "lol"}
BASKETBALL_KINDS = {"score": "kill", "possession": "objective", "run": "fight", "turning_point": "tower"}
VERSION = "match-recap-v1"


def _public(function):
    @wraps(function)
    def call(args, ctx):
        from .recap_security import redact_error_result
        try:
            return redact_error_result(function(args, ctx))
        except (ValueError, KeyError, TypeError) as error:
            return redact_error_result(ToolResult("[ERROR] match input: " + str(error), is_error=True,
                                                  data={"error_code": "invalid_match_input", "detail": str(error)}))
    return call


def _load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _write(path, data):
    publish_files({Path(path): (json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode()})


def _number(value, name, minimum=0):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < minimum:
        raise ValueError(f"{name} must be a finite number >= {minimum}")
    return float(value)


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def _bindings(paths):
    return {str(Path(p).resolve()): file_digest(p) for p in sorted({Path(p) for p in paths})}


def _verify(bindings):
    if not bindings:
        raise ValueError("missing match input bindings; regenerate this stage")
    for raw, expected in bindings.items():
        path = Path(raw)
        if not path.is_file() or file_digest(path) != expected:
            raise ValueError(f"input changed; regenerate its downstream stages: {path}")


def _checked(result):
    if result.data.get("status") in {"outline_invalid", "over_budget", "placement_invalid", "qc_failed", "check"}:
        result.is_error = True
    return result


def _allowed(args, keys):
    extra = sorted(set(args) - set(keys))
    if extra:
        raise ValueError("arguments not used in this match mode/action: " + ", ".join(extra))


def _match(path, ctx):
    data = _load(path)
    if data.get("sport") not in SPORTS:
        raise ValueError("match.json needs sport=soccer, basketball or lol; run match ingest")
    parts = data.get("halves" if data["sport"] == "soccer" else "games")
    if not parts:
        raise ValueError("match has no source parts")
    for part in parts.values():
        part["video"] = str(ctx.resolve(part["video"]))
        _number(part["duration"], "part.duration", 0.001)
    _verify(data.get("input_sha256"))
    return data, parts


def _outline(data, match, parts):
    data = copy.deepcopy(data)
    beats = data.get("beats")
    if not isinstance(beats, list) or not beats:
        raise ValueError("outline.beats must be a non-empty array")
    if not all(data.get("teams_cn", {}).get(side) for side in ("home", "away")):
        raise ValueError("outline.teams_cn.home and away are required")
    ids = [b["idx"] for b in beats]
    if any(isinstance(i, bool) or not isinstance(i, int) for i in ids) or len(set(ids)) != len(ids):
        raise ValueError("beat idx values must be unique integers")
    if data.get("transition", "cut") not in {"cut", "dissolve"}:
        raise ValueError("transition must be cut or dissolve")
    if match["sport"] != "soccer" and "transition" in data:
        raise ValueError("transition is only used for soccer")
    previous = (0, -1.0)
    event_map = {e["id"]: e for e in match.get("events", [])}
    for b in beats:
        if match["sport"] == "basketball":
            b["kind"] = BASKETBALL_KINDS.get(b["kind"], b["kind"])
        if b["kind"] == "open":
            continue
        if match["sport"] == "soccer":
            if b["kind"] == "ending":
                part = str(b.get("half", max(map(int, parts))))
                t = _number(b.get("whistle_t"), "whistle_t")
            else:
                event, error = match_soccer._resolve_beat_event(b, event_map)
                if error:
                    raise ValueError(error)
                part, t = str(event["half"]), _number(event["t"], "event.t")
        else:
            part, t = str(b.get("game", 1)), _number(b.get("t"), "beat.t")
        if part not in parts or t > parts[part]["duration"]:
            raise ValueError(f"beat {b['idx']}: time or part outside the match")
        key = (int(part), t)
        if key < previous:
            raise ValueError("beats must follow part order and source time within each part")
        previous = key
        for field in ("in_t", "out_t"):
            if field in b:
                _number(b[field], field)
        if "in_t" in b and b["in_t"] > t or "out_t" in b and not t < b["out_t"] <= parts[part]["duration"]:
            raise ValueError("beat window must contain the event and remain inside its source")
    return data


def _script(data):
    rows = []
    seen = set()
    for beat in data.get("beats", []):
        idx = beat["idx"]
        if not isinstance(idx, int) or isinstance(idx, bool) or idx in seen:
            raise ValueError("script beat idx values must be unique integers")
        seen.add(idx)
        for i, row in enumerate(beat.get("sentences", [])):
            row = dict(row)
            if not isinstance(row.get("text"), str) or not row["text"].strip():
                raise ValueError("each sentence needs non-empty text")
            if row.get("tier", 0) not in (0, 1, 2):
                raise ValueError("sentence tier must be 0, 1 or 2")
            if "t" in row:
                _number(row["t"], "sentence.t")
            if "offset" in row:
                if not math.isfinite(float(row["offset"])):
                    raise ValueError("sentence offset must be finite")
            if row.get("anchor", "flow") not in {"flow", "event", "bridge", "post"}:
                raise ValueError("unknown sentence anchor")
            row.update(beat=idx, sentence_id=f"{idx}:{i}")
            rows.append(row)
    if not rows:
        raise ValueError("script needs beats with sentences")
    return rows


@_public
def arrange(args, ctx):
    action = args.get("action")
    keys = {
        "ingest": {"action", "sport", "parts", "home", "away", "event_title", "labels_path", "out_dir"},
        "dialogue": {"action", "match_path", "transcript_paths", "out_dir"},
        "arrange": {"action", "match_path", "outline_path", "shots_paths", "events_path", "script_path", "out_dir"},
        "review_prepare": {"action", "render_report_path"},
        "review_import": {"action", "review_path"},
    }
    if action not in keys:
        raise ValueError("match action must be ingest, dialogue, arrange, review_prepare or review_import")
    _allowed(args, keys[action])
    if action == "review_prepare":
        return match_review.prepare(args, ctx)
    if action == "review_import":
        return match_review.collect(args, ctx)
    out = ctx.resolve(args.get("out_dir", "out"))
    with output_locks(ctx, [out]):
        out.mkdir(parents=True, exist_ok=True)
        if action == "ingest":
            return _ingest(args, ctx, out)
        path = ctx.resolve(args["match_path"])
        match, parts = _match(path, ctx)
        if action == "dialogue":
            return _dialogue(args, ctx, out, path, match, parts)
        return _arrange(args, ctx, out, path, match, parts)


def _ingest(args, ctx, out):
    sport = args.get("sport")
    if sport not in SPORTS:
        raise ValueError("sport must be soccer, basketball or lol")
    source_parts = args.get("parts")
    if not isinstance(source_parts, list) or not source_parts:
        raise ValueError("parts must list the full source videos in match order")
    if not args.get("home") or not args.get("away"):
        raise ValueError("home and away are required")
    parts, inputs = {}, []
    for i, p in enumerate(source_parts, 1):
        video = ctx.resolve(p["video"])
        if not video.is_file():
            raise ValueError(f"source video missing: {video}")
        duration = _number(match_games._dur_of(video), "video duration", 0.001)
        parts[str(i)] = {"video": str(video), "video_lowres": str(video), "name": p.get("name", str(i)), "duration": duration}
        inputs.append(video)
    events = []
    if args.get("labels_path"):
        if sport != "soccer":
            raise ValueError("labels_path is only used for soccer")
        labels = ctx.resolve(args["labels_path"])
        inputs.append(labels)
        last, score = {}, {"home": 0, "away": 0}
        for e in sorted(_load(labels)["annotations"], key=lambda a: (int(a["gameTime"].split(" - ")[0]), float(a["position"]))):
            if e["label"] not in match_soccer.EVENT_WINDOWS:
                continue
            half = int(e["gameTime"].split(" - ")[0])
            t = _number(float(e["position"]) / 1000, "annotation time")
            if str(half) not in parts or t > parts[str(half)]["duration"]:
                raise ValueError("annotation outside supplied source part")
            key = (half, e["label"], e.get("team", ""))
            if t - last.get(key, -10) < 3:
                continue
            last[key] = t
            if e["label"] == "Goal" and e.get("team") in score:
                score[e["team"]] += 1
            events.append({"id": f"E{len(events)}", "half": half, "t": t, "label": e["label"],
                           "minute": int(e["gameTime"].split(" - ")[1].split(":")[0]) + (45 if half == 2 else 0),
                           "team": e.get("team", ""), "score_after": f"{score['home']}-{score['away']}"})
    path = out / "match.json"
    protect_outputs([path], inputs)
    data = {"version": VERSION, "sport": sport, "source": "video", "home": args["home"], "away": args["away"],
            "event_title": args.get("event_title", ""), "events": events,
            "halves" if sport == "soccer" else "games": parts, "input_sha256": _bindings(inputs)}
    _write(path, data)
    return ToolResult("Match sources indexed", data={"match_path": str(path), "parts": parts, "sport": sport}, artifacts=[str(path)])


def _dialogue(args, ctx, out, match_path, match, parts):
    paths = args.get("transcript_paths") or {}
    if set(paths) != set(parts):
        raise ValueError("transcript_paths must map every match part to its transcript")
    rows, inputs = [], [match_path, *match["input_sha256"]]
    for part in parts:
        path = ctx.resolve(paths[part])
        inputs.append(path)
        transcript = _load(path)
        if transcript.get("source_video_sha256") != file_digest(Path(parts[part]["video"])):
            raise ValueError("transcript is not bound to this source; transcribe the current source")
        for s in transcript.get("segments", []):
            if not s.get("text", "").strip():
                continue
            start, end = _number(s["start"], "transcript start"), _number(s["end"], "transcript end")
            if not start <= end <= parts[part]["duration"] + 0.1:
                raise ValueError("transcript range outside its source part")
            rows.append({"id": f"C{len(rows):04d}", "part": part, "source": parts[part]["video"],
                         "start": s["start"], "end": s["end"], "text": s["text"]})
    if not rows:
        raise ValueError("no commentary found; inspect the source before choosing a narration workflow")
    axis, index = out / "commentary_axis.txt", out / "commentary_index.json"
    protect_outputs([axis, index], inputs)
    text = "\n".join(f"{r['id']} [part {r['part']} {r['start']:.2f}s] {r['text']}" for r in rows)
    _write(index, {"lines": rows, "input_sha256": _bindings(inputs)})
    publish_files({axis: (text + "\n").encode()})
    return ToolResult("Match commentary axis ready", data={"axis_path": str(axis), "index_path": str(index)}, artifacts=[str(axis), str(index)])


def _arrange(args, ctx, out, match_path, match, parts):
    outline_path = ctx.resolve(args["outline_path"])
    outline = _outline(_load(outline_path), match, parts)
    inputs = [match_path, outline_path, *match["input_sha256"]]
    shots = {str(k): str(ctx.resolve(v)) for k, v in (args.get("shots_paths") or {}).items()}
    inputs.extend(shots.values())
    if match["sport"] == "soccer":
        if args.get("events_path") or args.get("script_path"):
            raise ValueError("soccer arrangement uses outline events and precedes synthesis")
    else:
        if shots:
            raise ValueError("shots_paths is only used by soccer match arrangement")
        issues = match_games._validate_outline(outline)
        if issues:
            raise ValueError("; ".join(issues))
        script_path = ctx.resolve(args["script_path"])
        script = _load(script_path)
        _verify(script.get("input_sha256"))
        inputs.extend([script_path, *script["input_sha256"], *script["audio_sha256"]])
        _verify(script["audio_sha256"])
        sents = {}
        by = {b["idx"]: b for b in outline["beats"]}
        beat_order = {b["idx"]: i for i, b in enumerate(outline["beats"])}
        previous_beat, previous_times = -1, {}
        for row in script["sentences"]:
            if row["beat"] not in by:
                raise ValueError("script refers to a beat absent from the outline")
            b = by[row["beat"]]
            if beat_order[row["beat"]] < previous_beat:
                raise ValueError("script beat order differs from the outline")
            previous_beat = beat_order[row["beat"]]
            if b["kind"] != "open":
                t = _number(row.get("t"), "sentence.t")
                if t >= parts[str(b.get("game", 1))]["duration"]:
                    raise ValueError("sentence.t outside source part")
                if t < previous_times.get(row["beat"], 0):
                    raise ValueError("sentence times regress within a beat")
                previous_times[row["beat"]] = t
            sents.setdefault(row["beat"], []).append(row)
        events = []
        if args.get("events_path"):
            event_path = ctx.resolve(args["events_path"])
            inputs.append(event_path)
            events = _load(event_path)
            for e in events:
                p = str(e.get("game", 1))
                a, b = _number(e["src_start"], "src_start"), _number(e["src_end"], "src_end")
                if p not in parts or not a < b <= parts[p]["duration"]:
                    raise ValueError("event range outside its source part")
                if "event_t" in e and not a <= _number(e["event_t"], "event_t") <= b:
                    raise ValueError("event_t must be within its event range")
    names = ("reel.json", "writing_brief.txt", "brief.json") if match["sport"] == "soccer" else (
        "reel.json", "coverage_report.txt")
    diagnostic = out / "coverage_report.failed.txt"
    protect_outputs([*[out / name for name in names], diagnostic], inputs)
    before = _bindings(inputs)
    with tempfile.TemporaryDirectory(prefix=".arrange-", dir=out) as temp:
        stage = Path(temp)
        engine_args = {"match_path": str(match_path), "outline_path": str(outline_path),
                       "shots_paths": shots, "out_dir": str(stage)}
        if match["sport"] == "soccer":
            result = match_soccer.soccer_arrange(engine_args, ctx)
        else:
            result = match_games._arrange_script_mode(stage, engine_args, match, outline, sents, events)
        result = _checked(result)
        _verify(before)
        if result.failed:
            reports = {diagnostic: stage / "coverage_report.txt"} if (stage / "coverage_report.txt").is_file() else {}
            publish_files(reports)
            result.artifacts = [str(path) for path in reports]
            for key in ("reel_path", "brief_path"):
                result.data.pop(key, None)
            return result
        reel_path = stage / "reel.json"
        reel = _load(reel_path)
        _validate_reel(reel, parts)
        reel.update(version=VERSION, sport=match["sport"], input_sha256=before)
        _write(reel_path, reel)
        publish_files({out / name: stage / name for name in names})
        result.text = result.text.replace(str(stage), str(out))
        for key in ("reel_path", "brief_path"):
            if key in result.data:
                result.data[key] = str(out / Path(result.data[key]).name)
        result.artifacts = [str(out / name) for name in names]
        return result


def _validate_reel(reel, parts):
    for row in reel.get("plan", []):
        if not 0 <= row["start"] < row["start"] + row["dur"] <= reel["total"]:
            raise ValueError("narration cannot fit around the action; shorten the buildup or combine beats")
    for clip in [*reel["flashes"], *reel["segs"]]:
        part = str(clip.get("half", clip.get("game", 1)))
        if part not in parts or not 0 <= clip["in"] < clip["out"] <= parts[part]["duration"]:
            raise ValueError("selected clip lies outside its source; adjust the outline")
        if "event_t" in clip and not clip["in"] <= clip["event_t"] <= clip["out"]:
            raise ValueError("selected clip excludes its action anchor")


@_public
def synthesize(args, ctx):
    _allowed(args, {"script_path", "output_json", "audio_dir", "voice", "rate"})
    path = ctx.resolve(args["script_path"])
    out = ctx.resolve(args.get("output_json", "out/script_tts.json"))
    cache = ctx.resolve(args.get("audio_dir", ".video_agent/match_tts"))
    protect_outputs([out], [path])
    with output_locks(ctx, [out, cache]):
        before = _bindings([path])
        rows = _script(_load(path))
        config = tts.tts_config()
        voice = args.get("voice") or config["voice"]
        rate = args.get("rate", "+0%")
        if not re.fullmatch(r"[+-]?\d+(?:\.\d+)?%", rate):
            raise ValueError("rate must be a percentage such as +0% or -10%")
        base_speed = 1 + float(rate[:-1]) / 100
        cache.mkdir(parents=True, exist_ok=True)
        voiced = []
        for row in rows:
            speed = base_speed * (1.0, 1.06, 1.12)[row.get("tier", 0)]
            if not 0.5 <= speed <= 2:
                raise ValueError("rate and tier produce a TTS speed outside 0.5..2")
            fingerprint = _digest({"text": row["text"], "voice": voice, "speed": speed,
                                   "model": config["model"], "endpoint": config["endpoint"]})
            audio = cache / (fingerprint + ".wav")
            result = tts.tts_generate({"text": row["text"], "voice": voice, "speed": speed,
                                       "output_path": str(audio), "output_format": "wav"}, ctx)
            if result.failed:
                return result
            duration = _number(match_games._dur_of(audio), "audio duration", 0.001)
            voiced.append({**row, "audio": str(audio), "dur": duration})
        _verify(before)
        _write(out, {"version": VERSION, "provider": "tts", "voice": voice, "sentences": voiced,
                     "input_sha256": before, "audio_sha256": _bindings([s["audio"] for s in voiced])})
        return ToolResult("Match narration synthesized", data={"script_tts_path": str(out), "n_sentences": len(voiced)}, artifacts=[str(out)])


@_public
def render(args, ctx):
    _allowed(args, {"reel_path", "narration_path", "outline_path", "output_path", "work_dir", "subtitle_position"})
    reel_path, speech_path, outline_path = [ctx.resolve(args[k]) for k in ("reel_path", "narration_path", "outline_path")]
    reel, speech = _load(reel_path), _load(speech_path)
    if reel.get("version") != VERSION or speech.get("version") != VERSION:
        raise ValueError("reel and speech must come from current match arrangement/synthesis")
    position = args.get("subtitle_position", "lower")
    if position not in {"top", "middle", "lower", "bottom"}:
        raise ValueError("invalid subtitle_position")
    _verify(reel.get("input_sha256"))
    _verify(speech.get("input_sha256"))
    _verify(speech.get("audio_sha256"))
    if str(outline_path) not in reel["input_sha256"]:
        raise ValueError("outline_path is not the outline used for this reel")
    if reel["sport"] != "soccer" and str(speech_path) not in reel["input_sha256"]:
        raise ValueError("narration_path is not the measured narration used for this reel")
    beats = {b["idx"] for b in _load(outline_path)["beats"]}
    if not speech.get("sentences") or any(s["beat"] not in beats for s in speech["sentences"]):
        raise ValueError("narration sentences do not belong to this outline")
    output = ctx.resolve(args.get("output_path", "out/final.mp4"))
    if output.suffix.lower() != ".mp4":
        raise ValueError("match rendering requires an .mp4 output")
    inputs = [reel_path, speech_path, outline_path, *reel["input_sha256"], *speech["input_sha256"], *speech["audio_sha256"]]
    report_path = output.with_suffix(".render_report.json")
    qc_path, placement_path = output.with_suffix(".qc.json"), output.with_suffix(".placement.json")
    failure_paths = {"qc.json": output.with_suffix(".failed.qc.json"),
                     "placement.json": output.with_suffix(".failed.placement.json")}
    targets = [output, report_path, qc_path, placement_path, *failure_paths.values()]
    protect_outputs(targets, inputs)
    work = ctx.resolve(args.get("work_dir", ".video_agent/match_render"))
    with output_locks(ctx, [*targets, work]):
        before = _bindings(inputs)
        work.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="render-", dir=work) as temp:
            folder = Path(temp)
            call = {"reel_path": str(reel_path), "script_tts_path": str(speech_path),
                    "outline_path": str(outline_path), "output_path": str(folder / "final.mp4"), "out_dir": str(folder),
                    "subtitle_position": args.get("subtitle_position", "lower")}
            engine = match_soccer if reel["sport"] == "soccer" else match_games
            result = _checked((engine.soccer_render if reel["sport"] == "soccer" else engine.lol_render)(call, ctx))
            if result.failed:
                # Keep the published cut and its reports together; failed attempts
                # have separate diagnostics, never the previous attempt's reports.
                diagnostics = {dst: folder / name for name, dst in failure_paths.items() if (folder / name).is_file()}
                publish_files(diagnostics)
                result.video_paths = []
                result.artifacts = [str(path) for path in diagnostics]
                result.data.pop("output_path", None)
                return result
            _verify(before)
            report = {"kind": "match", "sport": reel["sport"], "version": VERSION,
                      "input_sha256": before, "output_sha256": file_digest(folder / "final.mp4"),
                      "output_path": str(output), "duration": reel["total"],
                      "reel_path": str(reel_path), "outline_path": str(outline_path),
                      "narration_path": str(speech_path), "qc_sha256": file_digest(folder / "qc.json"),
                      "placement_sha256": file_digest(folder / "placement.json"),
                      "review_policy": match_review.POLICY}
            publish_files({output: folder / "final.mp4", qc_path: folder / "qc.json",
                           placement_path: folder / "placement.json",
                           report_path: (json.dumps(report, indent=2) + "\n").encode()})
        return ToolResult("Match recap rendered; prepare one consolidated sampled review with arrange_footage mode=match action=review_prepare",
                          data={"output_path": str(output), "duration": reel["total"], "qc_path": str(qc_path),
                                "render_report_path": str(report_path), "review_policy": match_review.POLICY,
                                "next_action": {"tool": "arrange_footage", "mode": "match",
                                                "action": "review_prepare", "render_report_path": str(report_path)}},
                          artifacts=[str(p) for p in (output, qc_path, placement_path, report_path)], video_paths=[str(output)])
