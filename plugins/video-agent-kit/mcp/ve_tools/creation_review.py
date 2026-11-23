"""Shared creation production support; media APIs and explicit evidence contracts."""
from __future__ import annotations

import io
import copy
import subprocess
from pathlib import Path

from .creation_planning import (NARRATIVE_FORMATS, digest, file_digest, number, nexus_visual_plan, plan_format,
                             prop_ledger_states, unit_prop_ids, shot_plan_digest, shot_review_context)
from .creation_takes import read_object, write_object
from .result import ToolResult

# Production contract; see video-creation references for rationale.
# cross-shot leaves, reduced to what a dialogue drama shows at a boundary). A cut verdict answers
# each as {verdict: pass|fail|not_applicable, note}; the package carries the planned exit/entry
# states of both sides so props / wardrobe / presence are checked against the plan, not memory.
CUT_CHECKS = ("props", "wardrobe", "presence", "light_direction", "blocking")
PROP_DEFECT_TAGS = ("prop_duplicate", "prop_count_wrong")
PROP_CHECK_QUESTION = "道具与账一致吗：状态、持有者、持有手（左/右/无）、数量（1）和设定卡一致吗？"


def prop_expectations_for(plan: dict, unit: dict) -> dict[str, list[dict]]:
    """T05: derive critical-only expectations from T01's current ledger, without a cache."""
    expected: dict[str, list[dict]] = {"entry_state": [], "exit_state": []}
    if str(plan.get("schema_version")) != "4":
        return expected
    present = unit_prop_ids(plan, unit)
    props = plan.get("props") if isinstance(plan.get("props"), list) else []
    for prop in props:
        if not isinstance(prop, dict) or prop.get("critical") is not True or prop.get("id") not in present:
            continue
        row = next((r for r in prop_ledger_states(plan, prop)
                    if r["unit"].get("sequence_id") == unit.get("sequence_id")), None)
        if row is None:
            continue
        for phase in expected:
            facts = row[phase]
            holder = facts.get("holder")
            expected[phase].append({"id": prop["id"], "label": prop.get("label"),
                                    "state": facts.get("state"), "holder": holder,
                                    "hand": facts.get("hand", "无" if holder == "无" else None),
                                    "count": 1})
    return expected


def _prop_expectation_warnings(plan: dict, unit: dict, expected: dict) -> list[str]:
    """Missing/invalid ledger facts stay visible as reminders; do not guess a hand or state."""
    warnings = []
    props = plan.get("props") if isinstance(plan.get("props"), list) else []
    cast_ids = {c.get("id") for c in plan.get("cast") or [] if isinstance(c, dict) and isinstance(c.get("id"), str)}
    for phase, rows in expected.items():
        for row in rows:
            prop = next((p for p in props if isinstance(p, dict) and p.get("id") == row["id"]), {})
            states = prop.get("states") if isinstance(prop.get("states"), list) else []
            if not isinstance(row["state"], str) or row["state"] not in states:
                warnings.append(f"T05 {unit.get('sequence_id')} {row['id']}.{phase}: 状态未登记或不在 states "
                                "枚举内；补 T01 状态账后重新 prepare (advisory)")
            if not isinstance(row["holder"], str) or row["holder"] not in cast_ids | {"无"}:
                warnings.append(f"T05 {unit.get('sequence_id')} {row['id']}.{phase}: 持有者未登记或不是 cast_id/无；"
                                "补 T01 持有者账后重新 prepare (advisory)")
            if (row["hand"] not in ("左", "右", "无")
                    or (row["holder"] == "无" and row["hand"] != "无")):
                warnings.append(f"T05 {unit.get('sequence_id')} {row['id']}.{phase}: 持有手未登记/与持有者矛盾；"
                                "账中明写 .hand=左/右/无，不猜持有手 (advisory)")
    return warnings


def _frame(path: Path, at: float):
    from PIL import Image

    proc = subprocess.run([
        "ffmpeg", "-v", "error", "-ss", f"{at:.6f}", "-i", str(path),
        "-frames:v", "1", "-vf", "scale=240:136:force_original_aspect_ratio=decrease,pad=240:136:(ow-iw)/2:(oh-ih)/2",
        "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
    ], capture_output=True, timeout=30)
    if proc.returncode or not proc.stdout:
        raise ValueError(f"cannot extract {path.name} at {at:.3f}s: {proc.stderr.decode(errors='replace')[-500:]}")
    return Image.open(io.BytesIO(proc.stdout)).convert("RGB")


def _samples(start: float, end: float) -> list[float]:
    return [start + (end - start) * fraction for fraction in (0.1, 0.5, 0.9)]


def _sheet(edge: dict, ctx, output: Path) -> None:
    from PIL import Image, ImageDraw

    sheet = Image.new("RGB", (720, 330), "#171717")
    draw = ImageDraw.Draw(sheet)
    for row, key in enumerate(("left", "right")):
        item = edge[key]
        label = f"{key}: {item['segment_id']} / {item.get('take_id') or 'legacy'}"
        # Paths/ids can be Unicode; the evidence JSON retains the full label.
        draw.text((5, row * 165 + 2), label.encode("ascii", "replace").decode(), fill="white")
        for col, at in enumerate(item["sample_times"]):
            frame = _frame(ctx.resolve(item["evidence_source"]), at)
            sheet.paste(frame, (col * 240, row * 165 + 18))
            draw.text((col * 240 + 4, row * 165 + 145), f"{at:.3f}s", fill="white", stroke_width=1, stroke_fill="black")
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output)


def creation_review_package(args: dict, ctx) -> ToolResult:
    timeline_path = ctx.resolve(args.get("timeline_path") or "out/timeline.json")
    timeline = read_object(timeline_path)
    if not timeline:
        raise ValueError("timeline is missing or empty")
    shotlist_path = ctx.resolve(args["shotlist_path"]) if args.get("shotlist_path") else None
    if shotlist_path is None and ctx.resolve("out/creation/shotlist.json").is_file():
        shotlist_path = ctx.resolve("out/creation/shotlist.json")
    plan = nexus_visual_plan(read_object(shotlist_path)) if shotlist_path else {}
    planned = {s["shot_id"]: s for s in plan.get("shots", [])}
    # v4 sequence plans: continuity / scene come from sequences[] (the timeline clip's shot_id is
    # the sequence id). Kept apart from `planned`, which also drives plan digests for v2/v3.
    units = {str(s.get("sequence_id")): s for s in plan.get("sequences", []) or []
             if isinstance(s, dict) and s.get("sequence_id")}
    render_path = ctx.resolve(args["render_path"]) if args.get("render_path") else None
    window = number(args.get("window_seconds", 0.5))
    if window is None or not 0.1 <= window <= 2:
        raise ValueError("window_seconds must be in [0.1, 2]")
    from .render import build_render_plan
    execution = build_render_plan({}, ctx, timeline, timeline_path)
    track_indices = sorted({clip['track_index'] for clip in execution['video_clips']})
    if args.get('track_id'):
        track_indices = [i for i in track_indices if timeline['tracks'][i].get('id') == args['track_id']]
    if len(track_indices) != 1:
        raise ValueError('choose track_id when the timeline has multiple active video tracks')
    raw = [clip for clip in execution['video_clips'] if clip['track_index'] == track_indices[0]]
    raw.sort(key=lambda c: (c['timeline_start'], c['clip_index']))
    if not raw:
        raise ValueError("selected video track has no clips")
    assets = {a["id"]: a.get("path") or a.get("source") for a in timeline.get("assets", [])}
    asset_hashes = {a["id"]: a.get("source_sha256") for a in timeline.get("assets", [])}
    files: dict[str, str] = {}

    def register(path: Path) -> str:
        rel = ctx.virtualize(path)
        if rel not in files:
            files[rel] = file_digest(path)
        return files[rel]

    register(timeline_path)
    if shotlist_path:
        register(shotlist_path)
    if render_path:
        register(render_path)
        from .render_provenance import verify_render
        for path, sha in verify_render(render_path, ctx, timeline_path).items():
            files[ctx.virtualize(path)] = sha
    # Include audio/music/overlay inputs as well as the primary pictures.
    for clips_in_execution in (execution['video_clips'], execution['audio_clips'], execution['overlay_clips']):
        for clip in clips_in_execution:
            source = clip.get("source") or assets.get(clip.get("asset_id"))
            if source:
                sha = register(ctx.resolve(source))
                expected = clip.get("source_sha256") or asset_hashes.get(clip.get("asset_id"))
                if expected and expected != sha:
                    raise ValueError("timeline input asset changed; rebuild/review before preparing evidence")
    cursor = 0.0
    clips = []
    prop_warnings = []
    ids = set()
    for index, raw_clip in enumerate(raw):
        clip = dict(raw_clip)
        sid = str(clip.get("id") or f"segment{index + 1}")
        if sid in ids:
            raise ValueError(f"duplicate segment id {sid}")
        ids.add(sid)
        source = clip.get("source") or assets.get(clip.get("asset_id"))
        if not source:
            raise ValueError(f"{sid}: source is missing")
        sha = register(ctx.resolve(source))
        if clip.get("source_sha256") and clip["source_sha256"] != sha:
            raise ValueError(f"{sid}: timeline refers to replaced candidate bytes; rebuild/review the selection")
        speed = number(clip.get("speed", 1))
        start = number(clip.get("start", 0))
        end = number(clip.get("end"))
        duration = number(clip.get("duration"))
        at = number(clip.get("timeline_start", cursor))
        if speed is None or speed <= 0 or start is None or start < 0 or at is None or at < 0:
            raise ValueError(f"{sid}: invalid timing or speed")
        if end is None and duration is not None:
            end = start + duration
        if end is None or end <= start:
            raise ValueError(f"{sid}: invalid source range")
        actual_duration = (end - start) / speed
        if duration is not None and abs(end - start - duration) > 0.05:
            raise ValueError(f"{sid}: source range disagrees with source duration")
        if at < cursor - 0.01:
            raise ValueError("overlapping primary clips need a transition-specific review; hard-cut package would be misleading")
        if index and abs(at - cursor) > 0.01:
            raise ValueError("primary track has a gap; repair it before cut review")
        shot_id = str(clip.get("shot_id") or sid)
        shot = planned.get(shot_id) or units.get(shot_id, {})
        if clip.get("shot_plan_sha256") and clip["shot_plan_sha256"] != shot_plan_digest(plan, shot, ctx):
            raise ValueError(f"{sid}: directing plan changed; rebuild/review selected spans")
        for path, expected in shot_review_context(plan, shot, ctx)["reference_files"].items():
            if expected is None:
                raise ValueError(f"review reference is missing: {path}")
            register(ctx.resolve(path))
        if not render_path and any(clip.get(k) for k in ("transition_in", "transition_out", "crop", "transform", "filters")):
            raise ValueError("transformed clips require render_path so the evidence shows the actual edit")
        prop_expected = prop_expectations_for(plan, shot)
        prop_warnings.extend(_prop_expectation_warnings(plan, shot, prop_expected))
        clips.append({**clip, "segment_id": sid, "shot_id": shot_id,
                      "source": ctx.virtualize(ctx.resolve(source)), "source_sha256": sha,
                      "start": start, "end": end, "speed": speed, "duration": end - start,
                      "screen_duration": actual_duration,
                      "timeline_start": at,
                      "scene_id": shot.get("scene_id") or (units.get(shot_id) or {}).get("scene_id") or clip.get("scene_id"),
                      "continuity": (shot.get("continuity") or (units.get(shot_id) or {}).get("continuity")
                                     or clip.get("continuity", {})),
                      "required_visuals": shot.get("required_visuals", []),
                      "prop_expectations": prop_expected})
        cursor = at + actual_duration
    edges = []
    for index, (left, right) in enumerate(zip(clips, clips[1:])):
        edge = {"cut_id": f"cut{index + 1:04d}", "cut_time": right["timeline_start"],
                "same_scene": left["scene_id"] == right["scene_id"] if left["scene_id"] and right["scene_id"] else None}
        for key, clip in (("left", left), ("right", right)):
            item = dict(clip)
            if render_path:
                a = max(clip["timeline_start"], edge["cut_time"] - window) if key == "left" else edge["cut_time"]
                b = edge["cut_time"] if key == "left" else min(clip["timeline_start"] + clip["screen_duration"], edge["cut_time"] + window)
                item["evidence_source"] = ctx.virtualize(render_path)
            else:
                a = max(clip["start"], clip["end"] - window * clip["speed"]) if key == "left" else clip["start"]
                b = clip["end"] if key == "left" else min(clip["end"], clip["start"] + window * clip["speed"])
                item["evidence_source"] = clip["source"]
            item["sample_times"] = _samples(a, b)
            edge[key] = item
        _lc = left.get("continuity") if isinstance(left.get("continuity"), dict) else {}
        _rc = right.get("continuity") if isinstance(right.get("continuity"), dict) else {}
        # left side ENDS in its entry state updated by its exit state
        _lx = {**(_lc.get("entry_state") if isinstance(_lc.get("entry_state"), dict) else {}),
               **(_lc.get("exit_state") if isinstance(_lc.get("exit_state"), dict) else {})}
        _re = _rc.get("entry_state") if isinstance(_rc.get("entry_state"), dict) else {}
        if _lx or _re:
            edge["state_handoff"] = {
                "left_end": _lx, "right_entry": _re,
                "mismatched": sorted(k for k in _lx.keys() & _re.keys() if str(_lx[k]).strip() != str(_re[k]).strip()),
                "not_carried": sorted(set(_lx) - set(_re)),
            }
        left_props = left["prop_expectations"]["exit_state"]
        right_props = right["prop_expectations"]["entry_state"]
        if left_props or right_props:
            edge["prop_handoff"] = {"left_end": left_props, "right_entry": right_props}
        edge["signature"] = digest(edge)
        edges.append(edge)
    # 1012: 跨切点的连续性词表 (道具/服装/在场/光向/站位) 是分段生成剧情片的检查; 纪录片的跨地点
    # 空镜、鬼畜/MV 的故意跳切不适用 —— 非剧情片型只要求每个切点的判决与观察记录
    fmt = plan_format(plan) if plan else "drama"
    cut_checks = list(CUT_CHECKS) if fmt in NARRATIVE_FORMATS else []
    from .creation_evidence import DEFECT_TAGS
    package = {"version": 3, "format": fmt, "cut_checks": cut_checks, "timeline_path": ctx.virtualize(timeline_path),
               "shotlist_path": ctx.virtualize(shotlist_path) if shotlist_path else None,
               "render_path": ctx.virtualize(render_path) if render_path else None,
               "files": files, "clips": clips, "cuts": edges, "beats": plan.get("beats", []),
               "window_seconds": window,
               "check_questions": {"props": PROP_CHECK_QUESTION},
               "defect_tags": {"props": list(dict.fromkeys((*DEFECT_TAGS["props"], *PROP_DEFECT_TAGS)))},
               "warnings": list(dict.fromkeys(prop_warnings))}
    package["signature"] = digest(package)
    directory = ctx.resolve(args.get("output_dir") or "out/creation/review")
    from .file_contract import input_paths, protect_outputs, protect_directories
    protected = input_paths(args, ctx) | {ctx.resolve(path) for path in files}
    signature_directory = directory / package['signature'][:16]
    protect_directories([signature_directory], protected)
    planned = [signature_directory / f"{edge['cut_id']}.jpg" for edge in edges]
    protect_outputs(planned, protected)
    for edge in edges:
        image_path = directory / package["signature"][:16] / f"{edge['cut_id']}.jpg"
        _sheet(edge, ctx, image_path)
        edge["image"] = ctx.virtualize(image_path)
        edge["image_sha256"] = file_digest(image_path)
    # Detect concurrent edits while FFmpeg was reading; never issue evidence
    # under a fingerprint that no longer describes its inputs.
    if any(file_digest(ctx.resolve(path)) != sha for path, sha in files.items()):
        raise ValueError("review inputs changed during extraction; rebuild the package")
    output = ctx.resolve(args.get("output_json") or "out/creation/review_package.json")
    write_object(output, package)
    handoffs = sum(1 for e in edges if e.get("state_handoff"))
    check_note = (f"Every cut verdict answers checks {{{', '.join(cut_checks)}}} as "
                  "{verdict: pass|fail|not_applicable, note}; " if cut_checks else
                  f"format={fmt}: no per-cut continuity checklist — each cut still needs its verdict and notes; ")
    return ToolResult(text=(f"Prepared {len(edges)} actual timeline cuts; read every cut image and the full film before "
                            f"writing verdicts. {check_note}"
                            f"{handoffs} cut(s) carry state_handoff (planned end of the left side vs start of the right) — compare the "
                            f"frames against it. T05 {PROP_CHECK_QUESTION} Use prop_expectations / prop_handoff "
                            f"and defect_tags.props. {len(package['warnings'])} prop ledger reminder(s)."),
                      data=package, artifacts=[ctx.virtualize(output)] + [e["image"] for e in edges],
                      image_paths=[str(ctx.resolve(e["image"])) for e in edges])


def creation_review_validate(args: dict, ctx) -> ToolResult:
    package_path = ctx.resolve(args.get("package_path") or "out/creation/review_package.json")
    verdicts_path = ctx.resolve(args.get("verdicts_path") or "out/creation/edit_verdicts.json")
    package, verdicts = read_object(package_path), read_object(verdicts_path)
    errors, failed, uncertain = [], [], []
    canonical = copy.deepcopy(package)
    signature = canonical.pop("signature", None)
    for cut in canonical.get("cuts", []):
        cut.pop("image", None)
        cut.pop("image_sha256", None)
    if not package or digest(canonical) != signature:
        errors.append("review package signature is missing or invalid")
    if not package.get("render_path"):
        errors.append("final acceptance requires a package sampled from the rendered film")
    for path, sha in package.get("files", {}).items():
        p = ctx.resolve(path)
        if not p.is_file() or file_digest(p) != sha:
            errors.append(f"stale review input: {path}")
    if verdicts.get("package_signature") != signature:
        errors.append("verdicts refer to a different review package")
    by_id = {}
    for row in verdicts.get("cuts", []):
        if not isinstance(row, dict) or not row.get("cut_id"):
            errors.append("every cut verdict needs cut_id")
            continue
        if row["cut_id"] in by_id:
            errors.append(f"duplicate verdict: {row['cut_id']}")
        by_id[row["cut_id"]] = row

    def decision(row: dict, name: str, allow_na: bool = True):
        status = row.get("verdict")
        if status not in ("pass", "fail", "uncertain", "not_applicable"):
            errors.append(f"{name}: missing/unknown verdict")
        if not isinstance(row.get("notes"), str) or not row["notes"].strip():
            errors.append(f"{name}: concrete visual/audio observations are required in notes")
        if status == "fail":
            failed.append(name)
            if row.get("repair") not in ("reselect", "edit", "regenerate", "replan"):
                errors.append(f"{name}: choose a repair route instead of blindly regenerating the downstream shot")
        elif status == "uncertain":
            uncertain.append(name)
        elif status == "not_applicable" and (not allow_na or not row.get("exemption")):
            errors.append(f"{name}: not_applicable needs an explicit exemption")

    expected = set()
    for edge in package.get("cuts", []):
        cid = edge["cut_id"]
        expected.add(cid)
        row = by_id.get(cid, {})
        if row.get("signature") != edge.get("signature"):
            errors.append(f"{cid}: missing/stale cut verdict")
        image = ctx.resolve(edge.get("image") or "missing")
        if not image.is_file() or file_digest(image) != edge.get("image_sha256"):
            errors.append(f"{cid}: image evidence is missing or changed")
        decision(row, cid)
        for key in package.get("cut_checks") or ():
            item = (row.get("checks") or {}).get(key) if isinstance(row.get("checks"), dict) else None
            if not isinstance(item, dict) or item.get("verdict") not in ("pass", "fail", "not_applicable"):
                errors.append(f"{cid}.checks.{key}: answer {{verdict: pass|fail|not_applicable, note}}")
                continue
            if item["verdict"] in ("fail", "not_applicable") and not str(item.get("note") or "").strip():
                errors.append(f"{cid}.checks.{key}: {item['verdict']} needs a note (what differs / why it does not apply)")
            if item["verdict"] == "fail" and row.get("verdict") == "pass":
                errors.append(f"{cid}: checks.{key} failed but the cut verdict is pass")
    if set(by_id) - expected:
        errors.append("verdict file includes cuts not present in the current timeline")
    film = verdicts.get("film") or {}
    decision(film, "film", allow_na=False)
    if film.get("verdict") == "pass":
        checks = film.get("checks") or {}
        narrative_pkg = package.get("format", "drama") in NARRATIVE_FORMATS
        for key in ("story_clarity", "pacing", "intended_effect", "audio_coherence"):
            if checks.get(key) == "pass":
                continue
            if key == "story_clarity" and not narrative_pkg and checks.get(key) == "not_applicable":
                continue  # 无剧情的鬼畜/意象 MV: 故事清晰度不适用 (1012)
            errors.append(f"film.{key} needs an explicit passing review"
                          + ("" if narrative_pkg or key != "story_clarity" else
                             " (or not_applicable for a format without a story)"))
    files = dict(package.get("files", {}))
    for path in (package_path, verdicts_path):
        if path.is_file():
            files[ctx.virtualize(path)] = file_digest(path)
    report = {"ok": not errors and not failed and not uncertain,
              "status": "invalid" if errors else "needs_repair" if failed else "needs_review" if uncertain else "pass",
              "package_signature": signature, "cuts_checked": len(expected),
              "files": files, "errors": errors, "failed": failed, "uncertain": uncertain}
    output = ctx.resolve(args.get("output_json") or "out/creation/review_validation.json")
    write_object(output, report)
    return ToolResult(text=f"Drama edit review: {report['status']}; {len(expected)} cuts, {len(errors)} contract errors.",
                      data=report, artifacts=[ctx.virtualize(output)])
