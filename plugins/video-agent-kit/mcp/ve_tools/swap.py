"""swap.py — whole-person replacement (face + hair + wardrobe) pipeline tools.

Generation goes through ZCode ToolHub (image_generate for storyboards, minimax_h3_video for the
windows; the signed-in ZCode identity, no keys). Reuses the generators submit/poll protocol and
the shot detector's timeline; this module only
adds the swap-specific steps: frame-grid windows, per-shot storyboard preflight, frame-count
assembly, identity and freeze checks.

Design basis: skills/video-swap/references/pitfalls.md (fault modes D1-D12, all measured).
Every failed assertion returns [ERROR] and names the D rule; nothing degrades silently.
"""
from __future__ import annotations

import contextvars
import json
import math
import os
import re
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from .result import ToolResult
from .run_context import RunContext

# ---------------------------------------------------------------- helpers

def _sh(*cmd: str, timeout: int = 600) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)

def _ffprobe_duration(path: str) -> float:
    r = _sh("ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "csv=p=0", path)
    if r.returncode:
        raise RuntimeError(f"ffprobe failed on {path}: {r.stderr[:200]}")
    return float(r.stdout.strip())

def _frame(video: str, t: float, out: str, scale: str | None = None, quality: str = "2") -> None:
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", video,
           "-frames:v", "1", "-q:v", quality]
    if scale:
        cmd += ["-vf", f"scale={scale}"]
    cmd.append(out)
    r = _sh(*cmd)
    if r.returncode:
        raise RuntimeError(f"frame extract failed @{t}: {r.stderr[:200]}")

def _write_json(workdir: str, name: str, obj: Any) -> str:
    p = os.path.join(workdir, name)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    return p

def _read_json(path: str) -> Any:
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def _path(ctx: RunContext, value: Any) -> str:
    """Relative paths are project paths, as in every other tool; the job worker's own cwd is the
    plugin directory, where a relative path found nothing and a default workdir was read-only."""
    return str(ctx.resolve(str(value)))

def _workdir(ctx: RunContext, args: dict, anchor: str) -> str:
    workdir = _path(ctx, args["workdir"]) if args.get("workdir") else os.path.dirname(anchor)
    os.makedirs(workdir, exist_ok=True)
    return workdir

def _cast(ctx: RunContext, cast: Any) -> list[dict]:
    """cast = [{"label": "A", "orig": "...", "card": <character sheet path>, "desc": "..."}, ...].
    label is the character slot used in the labels table's `who`; card is the S3a character sheet."""
    if not isinstance(cast, list) or not cast:
        raise ValueError("cast must be a non-empty list of {label, orig, card}")
    out, seen = [], set()
    for c in cast:
        if not isinstance(c, dict) or not str(c.get("label") or "").strip() or not str(c.get("orig") or "").strip():
            raise ValueError("every cast entry needs label and orig")
        label = str(c["label"]).strip()
        if label in seen or label.lower() in _NO_PERSON or label == "?":
            raise ValueError(f"cast label {label!r} is duplicated or reserved")
        seen.add(label)
        if not c.get("card"):
            raise ValueError(f"cast {label} missing character sheet path `card` (run the S3a card step first)")
        card = _path(ctx, c["card"])
        if not os.path.isfile(card):
            raise ValueError(f"cast {label} character sheet not found: {card} (run the S3a card step first)")
        out.append({**c, "label": label, "card": card})
    return out

# Label vocabulary of the labels table. The Chinese values are what earlier templates asked for.
_NO_PERSON = {"none", "无人"}
_NORMAL = {"normal", "正常"}

def _who_labels(who: Any, labels: list[str]) -> list[str] | None:
    """Cast labels a shot's `who` names, in cast order: "A", "AB", "A+B", "A, B".
    [] for a shot with nobody to replace; None when it names something outside the cast."""
    text = str(who or "").strip()
    if text.lower() in _NO_PERSON:
        return []
    found: list[str] = []
    parts = [p for p in re.split(r"[\s,+/&|;，、]+", text) if p]
    for part in parts:
        rest = part
        while rest:
            hit = next((k for k in sorted(labels, key=len, reverse=True) if rest.startswith(k)), None)
            if hit is None:
                return None
            found.append(hit)
            rest = rest[len(hit):]
    return [k for k in labels if k in found] if found else None

# ---------------------------------------------------------------- swap_scan
# Reads the timeline.json written by detect_shots, extracts one mid-shot frame per shot, tiles
# contact sheets and writes the labels template. The agent labels the people after looking at
# the sheets (no VLM inside the tool): judging what a shot shows is the agent's job.

_LABEL_NOTE = ("Fill every shot after looking at the contact sheets. who = the cast label(s) of the people "
               "to replace in that shot ('A'; several people in one shot: 'AB' or 'A+B'; 'none' when "
               "nobody to replace is visible). size = close-up / medium close-up / medium / wide. "
               "diff = 'normal', or the difficulty: handheld mic / body contact / fast head turn / "
               "close-up singing. swap_plan refuses to run while any who is still '?'.")

def swap_scan(args: dict, ctx: RunContext) -> ToolResult:
    video = _path(ctx, args["video"])
    timeline = _path(ctx, args["timeline_path"])       # detect_shots output (timeline contract)
    if not os.path.isfile(timeline):
        return ToolResult(text=f"[ERROR] timeline not found: {timeline} (run detect_shots first)", is_error=True)
    if not os.path.isfile(video):
        return ToolResult(text=f"[ERROR] video not found: {video}", is_error=True)
    workdir = _workdir(ctx, args, timeline)
    out_dir = os.path.join(workdir, "swap_frames")
    os.makedirs(out_dir, exist_ok=True)
    tl = _read_json(timeline)
    segs = tl.get("shots") or []
    if not segs:
        return ToolResult(text=f"[ERROR] timeline has no shots: {timeline}", is_error=True)
    fps = tl.get("fps") or 24.0
    # Close micro gaps (D3): a segment under 0.05 s joins the previous shot, every cut is kept,
    # and the table must cover the film without holes.
    merged: list[dict] = []
    for s in segs:
        a, b = float(s["start"]), float(s["end"])
        if merged and (b - a) < 0.05:
            merged[-1]["end"] = b
        else:
            merged.append({"start": a, "end": b})
    gaps = [(merged[i]["end"], merged[i + 1]["start"])
            for i in range(len(merged) - 1) if merged[i + 1]["start"] - merged[i]["end"] > 0.001]
    if gaps:
        return ToolResult(text=f"[ERROR] D3 timeline gaps remain: {gaps[:5]}", is_error=True)
    rows, thumb_paths = [], []
    for i, s in enumerate(merged, 1):
        mid = (s["start"] + s["end"]) / 2
        full = os.path.join(out_dir, f"s{i:03d}.jpg")
        thumb = os.path.join(out_dir, f"th{i:03d}.jpg")
        _frame(video, mid, full, quality="2")
        _frame(video, mid, thumb, scale="320:180", quality="3")
        rows.append({"id": i, "t0": round(s["start"], 3), "t1": round(s["end"], 3),
                     "dur": round(s["end"] - s["start"], 3),
                     "who": "?", "size": "?", "diff": "?"})
        thumb_paths.append(thumb)
    # Contact sheets: 12 numbered frames per sheet, 4x3.
    sheets = []
    from PIL import Image, ImageDraw
    n_per = 12
    for si in range(math.ceil(len(rows) / n_per)):
        idxs = range(si * n_per + 1, min((si + 1) * n_per, len(rows)) + 1)
        sheet = Image.new("RGB", (1280, 580), "white")
        d = ImageDraw.Draw(sheet)
        for j, k in enumerate(idxs):
            x, y = (j % 4) * 320, (j // 4) * 190
            sheet.paste(Image.open(os.path.join(out_dir, f"th{k:03d}.jpg")), (x, y + 10))
            d.text((x + 6, y), f"#{k}", fill="red")
        sp = os.path.join(out_dir, f"sheet{si + 1}.jpg")
        sheet.save(sp, quality=82)
        sheets.append(sp)
    table_path = _write_json(workdir, "swap_labels.template.json",
                             {"fps": fps, "note": _LABEL_NOTE, "shots": rows})
    return ToolResult(
        text=(f"[OK] swap_scan: {len(rows)} shots (micro gaps closed), {len(sheets)} contact sheet(s), labels "
              "template written. Read the sheets, fill who/size/diff for every shot (see the template's note), "
              "save the table and pass it to swap_plan as labels_path."),
        data={"n_shots": len(rows), "table": ctx.virtualize(table_path),
              "sheets": [ctx.virtualize(s) for s in sheets]},
        artifacts=[table_path] + sheets)

# ---------------------------------------------------------------- swap_plan
# Authoritative frame table F=round(24*t) + windows + exception register + coverage assertion (D3/D4/D5).

# One H3 request takes a reference video of at most 15 s (ToolHub minimax_h3_video).
_MAX_WINDOW_LIMIT = 14.0

def swap_plan(args: dict, ctx: RunContext) -> ToolResult:
    labels_path = _path(ctx, args["labels_path"])      # the filled labels table
    if not os.path.isfile(labels_path):
        return ToolResult(text=f"[ERROR] labels table not found: {labels_path}", is_error=True)
    workdir = _workdir(ctx, args, labels_path)
    # min_window: a window shorter than this must merge with a neighbour. max_window: grouping
    # target; a window may exceed it by 0.5 s (a single shot or a merged tail) and a merge by 1 s.
    # Both were accepted and then ignored (3.5 / 7.0 / 7.5 were fixed numbers), so a planner
    # blocked on a 3.4 s tail or a 7.7 s shot could not be unblocked by any argument.
    min_w, max_w = float(args.get("min_window", 3.5)), float(args.get("max_window", 6.5))
    if not (0 < min_w < max_w <= _MAX_WINDOW_LIMIT):
        return ToolResult(text=f"[ERROR] need 0 < min_window < max_window <= {_MAX_WINDOW_LIMIT:g} "
                               "(one generation request takes at most 15 s of reference video)", is_error=True)
    long_cap, merge_cap = max_w + 0.5, max_w + 1.0
    lab = _read_json(labels_path)
    rows = lab["shots"]
    unknown = [r["id"] for r in rows if r["who"] == "?"]
    if unknown:
        return ToolResult(text=f"[ERROR] unlabeled shots block planning (S1 gate): {unknown}", is_error=True)
    # Authoritative frame table: the labelled shots must be contiguous.
    frames = [(round(24 * r["t0"]), round(24 * r["t1"])) for r in rows]
    for i in range(len(frames) - 1):
        if frames[i][1] != frames[i + 1][0]:
            return ToolResult(text=f"[ERROR] D3 frame table discontinuous at shot {i + 1}: {frames[i]} {frames[i + 1]}", is_error=True)
    # Group greedily up to max_window; a short tail joins its neighbour; a single shot that is
    # too long is registered as an exception (the planner never cuts inside a shot).
    wins, cur, exceptions = [], [], []
    for r in rows:
        d = sum(x["dur"] for x in cur) + r["dur"]
        if cur and d > max_w:
            wins.append(cur)
            cur = [r]
        else:
            cur.append(r)
    if cur:
        if wins and sum(x["dur"] for x in cur) < min_w:
            wins[-1].extend(cur)
        else:
            wins.append(cur)
    out = []
    for w in wins:
        dur = w[-1]["t1"] - w[0]["t0"]
        if dur > long_cap and len(w) > 1:
            half = (w[0]["t0"] + w[-1]["t1"]) / 2
            k = min(range(1, len(w)), key=lambda i: abs(w[i]["t0"] - half))
            for part in (w[:k], w[k:]):
                if sum(x["dur"] for x in part) < min_w:
                    exceptions.append({"type": "short_half_window", "blocking": False,
                                       "t0": part[0]["t0"], "t1": part[-1]["t1"]})
                out.append(part)
        elif dur > long_cap:
            exceptions.append({"type": "single_shot_too_long", "blocking": True,
                               "t0": w[0]["t0"], "t1": w[-1]["t1"], "dur": round(dur, 2)})
            out.append(w)
        else:
            out.append(w)
    # Isolated short windows: merge with a neighbour when the pair stays within merge_cap,
    # otherwise register a blocking exception.
    def wdur(w):
        return w[-1]["t1"] - w[0]["t0"]
    merged2 = []
    i = 0
    while i < len(out):
        w = out[i]
        if wdur(w) < min_w and merged2 and wdur(merged2[-1]) + wdur(w) <= merge_cap:
            merged2[-1].extend(w)
            i += 1
            continue
        if wdur(w) < min_w and i + 1 < len(out) and wdur(w) + wdur(out[i + 1]) <= merge_cap:
            out[i + 1] = w + out[i + 1]
            i += 1
            continue
        if wdur(w) < min_w and (not merged2 or wdur(merged2[-1]) + wdur(w) > merge_cap):
            exceptions.append({"type": "isolated_short_window", "blocking": True,
                               "t0": w[0]["t0"], "t1": w[-1]["t1"], "dur": round(wdur(w), 2)})
        merged2.append(w)
        i += 1
    out = merged2
    wj = []
    for i, w in enumerate(out, 1):
        f0, f1 = round(24 * w[0]["t0"]), round(24 * w[-1]["t1"])
        wj.append({"win": i, "f0": f0, "f1": f1, "t0": round(f0 / 24, 3), "t1": round(f1 / 24, 3),
                   "dur": round((f1 - f0) / 24, 3), "shots": [x["id"] for x in w],
                   "hard": [x["id"] for x in w if str(x.get("diff") or "").strip().lower() not in _NORMAL]})
    for i in range(len(wj) - 1):
        if wj[i]["f1"] != wj[i + 1]["f0"]:
            return ToolResult(text=f"[ERROR] D5 window frame grid discontinuous at W{i + 1}", is_error=True)
    blocking = [e for e in exceptions if e["blocking"]]
    table_path = _write_json(workdir, "swap_windows.json", {"windows": wj, "exceptions": exceptions})
    if blocking:
        listed = "; ".join(f"{e['type']} {e['dur']}s at {e['t0']}-{e['t1']}s" for e in blocking)
        return ToolResult(
            text=(f"[ERROR] swap_plan blocked by {len(blocking)} window(s): {listed}. Decide per window and rerun: "
                  f"raise max_window (now {max_w:g}, at most {_MAX_WINDOW_LIMIT:g}) to keep a long single shot as "
                  f"one window; lower min_window (now {min_w:g}) to accept a short window; or edit the shot rows "
                  "in the labels table where a cut inside the shot is acceptable. The flagged draft is in "
                  f"{ctx.virtualize(table_path)}; do not generate from it."),
            is_error=True, data={"blocking": blocking, "windows": ctx.virtualize(table_path)})
    return ToolResult(text=f"[OK] swap_plan: {len(wj)} windows, grid {wj[0]['f0']}-{wj[-1]['f1']}, exceptions {len(exceptions)}",
                      data={"n_windows": len(wj), "windows": ctx.virtualize(table_path)}, artifacts=[table_path])

# ---------------------------------------------------------------- swap_storyboards
# One replaced storyboard per shot (Seedream multi-image edit) + preflight: every shot with a
# person to replace must have its own image (D2, hard stop).

_WHO_PROMPT = {
    "multi": ("Keep the framing, lighting, set and the performers' poses and any microphone positions "
              "exactly. Replace {repl} Photorealistic, match the original lighting and grain. "
              "Natural skin, no beauty smoothing."),
    "single": ("Keep the framing, lighting, set and the performer's pose exactly. Replace {repl} "
               "Photorealistic, match the original grade."),
}

def _seedream_edit(image_paths: list[str], prompt: str, size: str, cache: dict, lock: threading.Lock) -> bytes:
    """Seedream multi-image edit through ToolHub image_generate (the same channel as the creation
    tools). The images are uploaded once per call batch (``cache``); the first one is the frame
    to edit, so its aspect ratio is the storyboard's."""
    from . import creation_media
    urls = creation_media._reference_urls([Path(p) for p in image_paths], cache, lock)
    # The leading phrase tells Seedream which of the images to edit ("edit the first image").
    data, _ = creation_media._seedream_image(
        f"编辑第一张图: {prompt} Keep the first image's aspect ratio and composition.", size, urls)
    return data

def _shot_labels(rows: dict, cm: dict) -> tuple[dict, list]:
    """{shot id: cast labels to replace} and the `who` values that name nobody in the cast."""
    by_shot, bad = {}, []
    for sid, r in rows.items():
        if r["who"] == "?":
            continue
        labels = _who_labels(r["who"], list(cm))
        if labels is None:
            bad.append(r["who"])
        elif labels:
            by_shot[sid] = labels
    return by_shot, bad

def swap_storyboards(args: dict, ctx: RunContext) -> ToolResult:
    video = _path(ctx, args["video"])
    labels_path, windows_path = _path(ctx, args["labels_path"]), _path(ctx, args["windows_path"])
    workdir = _workdir(ctx, args, windows_path)
    from . import creation_media, toolhub
    try:
        size = creation_media._size_tier(args.get("size"))
    except creation_media.CreationError as exc:
        return ToolResult(text=f"[ERROR] {exc}", is_error=True)
    try:
        cast = _cast(ctx, args["cast"])     # reference image = the character sheet (D11 main defence)
    except ValueError as exc:
        return ToolResult(text=f"[ERROR] {exc}", is_error=True)
    hub = toolhub.status()
    if not hub["available"]:
        return ToolResult(text="[ERROR] ToolHub image generation is unavailable: " + "; ".join(hub["reasons"]),
                          is_error=True)
    upload_cache, upload_lock = {}, threading.Lock()
    lab = _read_json(labels_path)
    rows = {r["id"]: r for r in lab["shots"]}
    sb_dir = os.path.join(workdir, "swap_sb")
    os.makedirs(sb_dir, exist_ok=True)
    cm = {c["label"]: c for c in cast}
    made, reused = [], []
    by_shot, bad = _shot_labels(rows, cm)
    if bad:
        return ToolResult(text=f"[ERROR] shot labels {sorted(set(map(str, bad)))} not in cast {sorted(cm)} — relabel with "
                               "cast labels ('AB' or 'A+B' for several people in one shot, 'none' for nobody)", is_error=True)
    for sid, labels_here in by_shot.items():
        r = rows[sid]
        out = os.path.join(sb_dir, f"sb_s{r['id']}.jpg")
        if os.path.exists(out):
            reused.append(r["id"])
            continue
        src = os.path.join(sb_dir, f"src_s{r['id']}.jpg")
        _frame(video, (r["t0"] + r["t1"]) / 2, src, quality="2")
        imgs = [src] + [cm[k]["card"] for k in labels_here]
        # D12: the anchor/sheet rides only as a reference image; the prompt binds by image
        # position and never restates the appearance in words.
        repl = "; ".join(f"{cm[k]['orig']} entirely with the person from image {2 + i} "
                         "(fully consistent with that image: face, hair, wardrobe)"
                         for i, k in enumerate(labels_here))
        prompt = _WHO_PROMPT["multi" if len(labels_here) > 1 else "single"].format(repl=repl)
        # _seedream_image already resubmits UNKNOWN results; one more round covers a transient
        # upload/transport failure. A final refusal (bad input, auth) stops at once.
        for attempt in range(2):
            try:
                data = _seedream_edit(imgs, prompt, size, upload_cache, upload_lock)
                with open(out + ".part", "wb") as fh:
                    fh.write(data)
                os.replace(out + ".part", out)
                made.append(r["id"])
                break
            except Exception as e:
                # "no image after N submissions" already carries its own resubmits: do not multiply them
                final = isinstance(e, toolhub.ToolHubError) and (not e.detail.get("recoverable", False)
                                                                  or "state" in e.detail)
                if attempt == 1 or final:
                    return ToolResult(text=f"[ERROR] storyboard failed for shot {r['id']}: {e}", is_error=True,
                                      data={"made": made, "reused": reused, "dir": ctx.virtualize(sb_dir)})
                time.sleep(4)
    # Preflight (D2): every shot with a person to replace, in every window, has its image.
    wj = _read_json(windows_path)["windows"]
    missing = []
    for w in wj:
        for s in w["shots"]:
            if s in by_shot and not os.path.exists(os.path.join(sb_dir, f"sb_s{s}.jpg")):
                missing.append((w["win"], s))
    if missing:
        return ToolResult(text=f"[ERROR] D2 preflight: shots without storyboards {missing[:8]}", is_error=True)
    return ToolResult(
        text=(f"[OK] swap_storyboards: {len(made)} made, {len(reused)} reused, preflight passed (every shot with a "
              "person to replace is covered). Look at the storyboards before generating."),
        data={"made": len(made), "reused": len(reused), "dir": ctx.virtualize(sb_dir)})

# ---------------------------------------------------------------- swap_generate
# One H3 request per window: short edit prompt + character sheets + per-shot storyboards.
# Requested duration = window rounded up; staggered submits; resumable.

_SWAP_PROMPT = ("Edit reference video 1: replace {repl}; when a shot shows only some of these people, keep "
                "each binding. Preserve the source framing, camera movement, choreography, cut "
                "times and action timing exactly, including any microphones in the same hands. "
                "No on-screen text or lyrics.")

# minimax_h3_video limits (ToolHub doc): 4-15 s per request, <= 9 reference images, a reference
# clip of 2-15 s (H.264, 23.976-60 fps). The clip and images travel as uploaded https links.
H3_MIN_SECONDS, H3_MAX_SECONDS, H3_MAX_IMAGES, H3_MIN_CLIP_SECONDS = 4, 15, 9, 2.0
H3_POLL_SECONDS, H3_POLL_TIMEOUT = 10, 1800
H3_MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024
# failure.code -> what the agent should change before a rerun (a rerun submits a new task)
_H3_FAILURE_HINTS = {
    "MINIMAX_CONTENT_REJECTED": "content moderation refused it; change the prompt or the reference media",
    "MINIMAX_INVALID_INPUT": "the provider rejected the parameters or media; fix them",
    "MINIMAX_TASK_FAILED": "provider-side failure; a rerun may succeed",
    "MINIMAX_TASK_CANCELED": "cancelled upstream; rerun",
    "WATERMARK_FAILED": "generated but watermarking failed; rerun",
    "RESULT_EXPIRED": "the result link expired before download; rerun",
    "task_not_found": "the task is unknown to ToolHub (expired or another account); rerun",
}


def _cut_clip(video: str, t0: float, dur: float, clip: str) -> None:
    """Cut the window's reference clip (H.264, no audio) small enough for the ToolHub upload."""
    from . import toolhub
    for crf in ("20", "26", "32"):
        r = _sh("ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", str(t0), "-i", video, "-t", str(dur), "-an",
                "-c:v", "libx264", "-preset", "fast", "-crf", crf, "-pix_fmt", "yuv420p",
                "-movflags", "+faststart", clip + ".part.mp4", timeout=300)
        if r.returncode:
            raise RuntimeError(f"clip cut failed: {r.stderr[:150]}")
        if os.path.getsize(clip + ".part.mp4") <= toolhub.MAX_UPLOAD_BYTES:
            os.replace(clip + ".part.mp4", clip)
            return
    os.remove(clip + ".part.mp4")
    raise RuntimeError(f"the {dur:g}s reference clip stays above the {toolhub.MAX_UPLOAD_BYTES // 2**20} MiB "
                       "upload limit even at crf 32; plan shorter windows")


def swap_generate(args: dict, ctx: RunContext) -> ToolResult:
    from . import creation_media, generators as gens, toolhub
    video, windows_path = _path(ctx, args["video"]), _path(ctx, args["windows_path"])
    labels_path = _path(ctx, args["labels_path"])
    workdir = _workdir(ctx, args, windows_path)
    resolution = args.get("resolution", "768P")
    hub = toolhub.status()
    if not hub["available"]:
        return ToolResult(text="[ERROR] ToolHub video generation is unavailable: " + "; ".join(hub["reasons"]),
                          is_error=True)
    try:
        cast = _cast(ctx, args["cast"])
    except ValueError as exc:
        return ToolResult(text=f"[ERROR] {exc}", is_error=True)
    cm = {c["label"]: c for c in cast}
    # D12: character sheets take the reference slots (image 1..n); the prompt binds by image
    # position and never restates the appearance.
    repl = "; ".join(f"{c['orig']} throughout with the person from image {1 + i}" for i, c in enumerate(cast))
    prompt = args.get("prompt") or _SWAP_PROMPT.format(repl=repl)
    rows = {r["id"]: r for r in _read_json(labels_path)["shots"]}
    by_shot, bad = _shot_labels(rows, cm)
    if bad:
        return ToolResult(text=f"[ERROR] shot labels {sorted(set(map(str, bad)))} not in cast {sorted(cm)}", is_error=True)
    wj = _read_json(windows_path)["windows"]
    wins = [args["windows"]] if isinstance(args.get("windows"), int) else None
    sb_dir = os.path.join(workdir, "swap_sb")
    clip_dir, out_dir = os.path.join(workdir, "swap_clips"), os.path.join(workdir, "swap_out")
    os.makedirs(clip_dir, exist_ok=True)
    os.makedirs(out_dir, exist_ok=True)
    # Ledger per window: {"key": Idempotency-Key, "body": request, "task_id": ...}. Key and body are
    # stored BEFORE the submit, so a timeout or a cancelled call replays the same request (ToolHub
    # answers with the existing task) instead of creating a second one; a known task id is only
    # polled.
    ledger_path = os.path.join(out_dir, "tasks.json")
    ledger = _read_json(ledger_path) if os.path.isfile(ledger_path) else {}
    ledger_lock = threading.Lock()
    upload_cache, upload_lock = {}, threading.Lock()

    def entry(win) -> dict:
        with ledger_lock:
            e = ledger.get(str(win))
        return e if isinstance(e, dict) else ({"task_id": str(e)} if e else {})

    def remember(win, value: dict | None):
        with ledger_lock:       # submit and poll threads share the ledger file
            if value is None:
                ledger.pop(str(win), None)
            else:
                ledger[str(win)] = value
            _write_json(out_dir, "tasks.json", ledger)

    def job_of(w):
        out = os.path.join(out_dir, f"W{w['win']}.mp4")
        req = int(w["dur"]) + (1 if w["dur"] > int(w["dur"]) + 0.05 else 0)
        return w, out, int(max(H3_MIN_SECONDS, min(H3_MAX_SECONDS, req)))

    def images_of(w) -> list[str]:
        # sheets first, matching the prompt's image numbers, then this window's storyboards
        return [c["card"] for c in cast] + [os.path.join(sb_dir, f"sb_s{s}.jpg") for s in w["shots"] if s in by_shot]

    def submit_one(job):
        w, out, req = job
        known = entry(w["win"])
        if known.get("task_id"):
            return w, out, known["task_id"]
        if known.get("key") and isinstance(known.get("body"), dict):
            # an earlier submit ended without a known outcome: replay exactly that request
            # (same key + a different body = 409; the uploaded links stay valid for about 24 h)
            key, body = known["key"], known["body"]
            return _submit(w, out, key, body)
        clip = os.path.join(clip_dir, f"W{w['win']}.mp4")
        try:
            if not os.path.exists(clip):
                _cut_clip(video, w["t0"], w["dur"], clip)
            clip_url, _ = toolhub.upload_file(Path(clip))
        except toolhub.ToolHubError as exc:
            if exc.code == 3707:
                raise RuntimeError(f"W{w['win']}: ToolHub refused the reference clip upload (empty, too large "
                                   f"or a type it does not accept): {exc}") from exc
            raise RuntimeError(f"W{w['win']} clip upload failed: {exc}") from exc
        except RuntimeError as exc:
            raise RuntimeError(f"W{w['win']} {exc}") from exc
        try:
            image_urls = creation_media._reference_urls([Path(p) for p in images_of(w)], upload_cache, upload_lock)
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"W{w['win']} reference image upload failed: {str(exc)[:300]}") from exc
        body = {"query": prompt, "duration": req, "resolution": resolution,
                "videos": [clip_url], "images": image_urls}
        key = toolhub.new_idempotency_key()
        remember(w["win"], {"key": key, "body": body})
        return _submit(w, out, key, body)

    def _submit(w, out, key, body):
        try:
            tid = gens.submit_request(toolhub.PATH_H3_SUBMIT, body, key)
        except gens.ProviderError as exc:
            if not exc.retry_same_key:
                remember(w["win"], None)        # refused, no task: a rerun submits with a new key
            raise RuntimeError(f"W{w['win']} submit refused: {str(exc)[:300]}") from exc
        remember(w["win"], {"key": key, "task_id": tid})
        return w, out, tid

    def poll_one(w, out, tid):
        t0, last = time.time(), ""
        while time.time() - t0 < H3_POLL_TIMEOUT:
            try:
                st = gens.poll({}, tid, toolhub.PATH_H3_QUERY)
            except Exception as exc:        # a failed status read is retried; a failed task is not
                last = str(exc)[:200]
                time.sleep(H3_POLL_SECONDS)
                continue
            if st["status"] == "succeeded":
                if not st.get("video_url"):
                    raise RuntimeError(f"W{w['win']} succeeded without a video url (task {tid})")
                toolhub.download(st["video_url"], Path(out), max_bytes=H3_MAX_DOWNLOAD_BYTES)
                return
            if st["status"] == "failed":
                remember(w["win"], None)        # a rerun submits this window again (new key)
                err = st.get("error") or {}
                code = str(err.get("code") or "")
                raise RuntimeError(f"W{w['win']} failed (task {tid}, {code or 'no code'}): "
                                   f"{_H3_FAILURE_HINTS.get(code, 'see the message')}; "
                                   f"{str(err.get('message') or '')[:200]}")
            time.sleep(H3_POLL_SECONDS)
        raise RuntimeError(f"W{w['win']} still not finished after {H3_POLL_TIMEOUT}s (task {tid}"
                           + (f", last status error: {last}" if last else "")
                           + "); rerun swap_generate later to collect it without submitting again")

    todo = []
    for w in wj:
        if wins and w["win"] not in wins:
            continue
        missing = [s for s in w["shots"] if s in by_shot and not os.path.exists(os.path.join(sb_dir, f"sb_s{s}.jpg"))]
        if missing:
            return ToolResult(text=f"[ERROR] D2 preflight: W{w['win']} shots without storyboards {missing[:8]}; "
                                   "run swap_storyboards first", is_error=True)
        n_images = len(images_of(w))
        if n_images > H3_MAX_IMAGES:
            return ToolResult(text=f"[ERROR] W{w['win']} needs {n_images} reference images (cast sheets + storyboards), "
                                   f"over the generator's {H3_MAX_IMAGES}; replan with smaller windows", is_error=True)
        if w["dur"] < H3_MIN_CLIP_SECONDS:
            return ToolResult(text=f"[ERROR] W{w['win']} is {w['dur']}s; the reference clip must be at least "
                                   f"{H3_MIN_CLIP_SECONDS:g}s — replan with a larger min_window", is_error=True)
        _, out, _ = job_of(w)
        if not os.path.exists(out):
            todo.append(job_of(w))
    results, failed = [], []
    with ThreadPoolExecutor(max_workers=int(args.get("concurrency", 6))) as ex:
        futs = []
        for i, job in enumerate(todo):
            # each worker runs in a copy of this job's context, so it carries the call's ZCode identity
            futs.append(ex.submit(contextvars.copy_context().run, submit_one, job))
            time.sleep(min(3, 1 + i))          # stagger submits (the provider rate limit is account-wide)
        tids = []
        for f in futs:
            try:
                tids.append(f.result())
            except Exception as e:
                failed.append(str(e)[:400])
        polls = {ex.submit(contextvars.copy_context().run, poll_one, w, out, tid): (w["win"]) for w, out, tid in tids}
        for f in polls:
            try:
                f.result()
                results.append(polls[f])
            except Exception as e:
                failed.append(str(e)[:400])
    msg = f"[OK] swap_generate: {len(results)}/{len(todo)} windows done" if not failed else \
          f"[ERROR] swap_generate partial: ok={results} failed={failed}"
    return ToolResult(text=msg, is_error=bool(failed),
                      data={"done": results, "failed": failed, "out_dir": ctx.virtualize(out_dir)})

# ---------------------------------------------------------------- swap_assemble
# Trim by frame count (N=f1-f0) -> concat -> lay the original audio under it -> zero-drift assertion (D5).

def _has_audio(path: str) -> bool:
    r = _sh("ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
            "-of", "csv=p=0", path)
    return r.returncode == 0 and bool(r.stdout.strip())

def _video_frames(path: str) -> int:
    """Frame count of the first video stream (the container duration also counts padded audio)."""
    r = _sh("ffprobe", "-v", "error", "-select_streams", "v:0", "-count_packets",
            "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", path)
    try:
        return int(r.stdout.strip().split(",")[0])
    except ValueError:
        raise RuntimeError(f"ffprobe could not count frames in {path}: {r.stderr[:200]}") from None

def swap_assemble(args: dict, ctx: RunContext) -> ToolResult:
    video, windows_path = _path(ctx, args["video"]), _path(ctx, args["windows_path"])
    workdir = _workdir(ctx, args, windows_path)
    out_name = args.get("out_name", "swap_final.mp4")
    wj = _read_json(windows_path)["windows"]
    cuts = []
    for w in wj:
        src = os.path.join(workdir, "swap_out", f"W{w['win']}.mp4")
        if not os.path.exists(src):
            return ToolResult(text=f"[ERROR] missing window output W{w['win']}", is_error=True)
        n = w["f1"] - w["f0"]
        cf = os.path.join(workdir, f"cut_W{w['win']}.mp4")
        r = _sh("ffmpeg", "-nostdin", "-v", "error", "-y", "-i", src, "-frames:v", str(n),
                "-an", "-r", "24", "-c:v", "libx264", "-preset", "fast", "-crf", "18", cf, timeout=900)
        if r.returncode:
            return ToolResult(text=f"[ERROR] trim failed W{w['win']}: {r.stderr[:200]}", is_error=True)
        got_n = _video_frames(cf)
        if got_n != n:
            return ToolResult(text=f"[ERROR] D5 W{w['win']} output has {got_n} frames at 24 fps, its window needs {n} "
                                   "(the generated clip is shorter than the window); regenerate that window",
                              is_error=True)
        cuts.append(os.path.basename(cf))
    lst = os.path.join(workdir, "swap_concat.txt")
    with open(lst, "w") as f:
        for c in cuts:
            f.write(f"file '{c}'\n")
    merged = os.path.join(workdir, "swap_merged.mp4")
    r = _sh("ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "concat", "-safe", "0",
            "-i", lst, "-c", "copy", merged, timeout=900)
    if r.returncode:
        return ToolResult(text=f"[ERROR] concat failed: {r.stderr[:200]}", is_error=True)
    final = os.path.join(workdir, out_name)
    want = (wj[-1]["f1"] - wj[0]["f0"]) / 24
    # The picture is the master: the output runs exactly the grid length. `-shortest` cut the
    # picture back to a source audio track that ends a few frames early, and the D5 assertion
    # then failed on a correctly assembled picture; the audio is padded with silence instead.
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", merged]
    if _has_audio(video):
        cmd += ["-ss", str(wj[0]["t0"]), "-i", video, "-map", "0:v", "-map", "1:a",
                "-af", "apad", "-c:a", "aac", "-b:a", "160k"]
    else:
        cmd += ["-map", "0:v"]
    cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "19", "-t", f"{want:.6f}",
            "-movflags", "+faststart", final]
    r = _sh(*cmd, timeout=1800)
    if r.returncode:
        return ToolResult(text=f"[ERROR] audio mux failed: {r.stderr[:200]}", is_error=True)
    # The padded audio makes the container as long as the target whatever the picture is, so the
    # assertion counts the picture's frames as well.
    got, frames, want_frames = _ffprobe_duration(final), _video_frames(final), wj[-1]["f1"] - wj[0]["f0"]
    if abs(got - want) > 0.05 or frames != want_frames:
        return ToolResult(text=f"[ERROR] D5 assembly deviation {got:.3f}s vs {want:.3f}s "
                               f"(picture {frames} frames vs {want_frames})", is_error=True)
    return ToolResult(text=f"[OK] swap_assemble: {got:.3f}s == grid target (dev < 0.05s)",
                      data={"duration": got, "target": want, "output": ctx.virtualize(final)},
                      video_paths=[final], artifacts=[final])

# ---------------------------------------------------------------- swap_verify
# Identity check (insightface, degrades when missing) + freeze detection (motion energy) +
# the list of weak hits a person has to close.

def swap_verify(args: dict, ctx: RunContext) -> ToolResult:
    compare_path = _path(ctx, args["compare_path"]) if args.get("compare_path") else None
    # compare_path: original on top, generated below, stacked (used by the freeze check)
    window_outputs = [_path(ctx, p) for p in args["window_outputs"]]      # per-window generated files
    refs = {k: _path(ctx, v) for k, v in args["face_refs"].items()}
    # face_refs: {"orig_a":path,"orig_b":path,"new_a":path,"new_b":path}
    step = float(args.get("sample_step", 0.5))
    report: dict[str, Any] = {"identity": None, "freeze": None}
    notes = []
    try:
        import cv2
        import numpy as np
        from insightface.app import FaceAnalysis
        app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        app.prepare(ctx_id=0, det_size=(640, 640))

        def lfe(p):
            img = cv2.imread(p)
            fs = [f for f in app.get(img) if f.det_score > 0.35]
            if not fs:
                return None
            f = max(fs, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
            return f.normed_embedding

        R = {k: lfe(v) for k, v in refs.items()}
        R = {k: v / np.linalg.norm(v) for k, v in R.items() if v is not None}
        if len(R) < 4:
            return ToolResult(text="[ERROR] face refs unusable (detection failed)", is_error=True)
        from collections import Counter
        total, leaks, weak = Counter(), [], []
        tmp = "/tmp/swap_verify_frame.jpg"
        for g in window_outputs:
            L = _ffprobe_duration(g)
            t = 0.0
            while t < L:
                _frame(g, t, tmp, quality="3")
                img = cv2.imread(tmp)
                faces = [f for f in app.get(img) if f.det_score > 0.4]
                faces.sort(key=lambda f: -(f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
                for f in faces[:2]:
                    if f.bbox[2] - f.bbox[0] < 30:
                        continue
                    e = f.normed_embedding
                    e = e / np.linalg.norm(e)
                    sims = {k: float(np.dot(e, v)) for k, v in R.items()}
                    best = max(sims, key=sims.get)
                    second = sorted(sims.values())[-2]
                    total[best] += 1
                    if best in ("orig_a", "orig_b"):
                        (leaks if (sims[best] > 0.30 and sims[best] - second > 0.05) else weak).append(
                            {"clip": os.path.basename(g), "t": round(t, 1), "as": best, "sim": round(sims[best], 2)})
                t += step
        report["identity"] = {"counts": dict(total), "strong_leaks": leaks, "weak_hits_need_human": weak}
        if leaks:
            return ToolResult(text=f"[ERROR] strong original-face leaks: {leaks[:5]}", is_error=True,
                              data=report)
        notes.append(f"identity: {dict(total)}, strong leaks 0, weak hits {len(weak)} (each needs a human check)")
        # D11 safety net: pairwise consistency of the storyboards (the character sheet is the
        # main defence; this catches outliers).
        sb_dir = os.path.dirname(window_outputs[0]).replace("swap_out", "swap_sb")
        sbs = [os.path.join(sb_dir, f) for f in sorted(os.listdir(sb_dir))
               if f.startswith("sb_s") and f.endswith(".jpg")] if os.path.isdir(sb_dir) else []
        if len(sbs) >= 3:
            embs = []
            for p in sbs:
                e = lfe(p)
                if e is not None:
                    embs.append((os.path.basename(p), e / np.linalg.norm(e)))
            outliers = []
            for i, (name, e) in enumerate(embs):
                sims = [float(np.dot(e, o)) for j, (n2, o) in enumerate(embs) if j != i]
                avg = sum(sims) / max(len(sims), 1)
                if avg < 0.12:      # measured on 71 images: same person across scenes 0.14-0.30, true outliers <0.06
                    outliers.append({"storyboard": name, "avg_sim": round(avg, 3)})
            report["storyboard_pairwise"] = {"n": len(embs), "outliers": outliers}
            if outliers:
                notes.append(f"pairwise: storyboard outliers {outliers} (D11, regenerate them with the character sheet)")
    except ImportError:
        notes.append("insightface unavailable — identity gate degraded; the full-speed human review is required")
    if compare_path:
        try:
            import numpy as np
            from PIL import Image
            outdir = "/tmp/swap_verify_mot"
            os.makedirs(outdir, exist_ok=True)
            _sh("ffmpeg", "-nostdin", "-v", "error", "-y", "-i", compare_path, "-vf",
                "fps=2,scale=427:-2", os.path.join(outdir, "f%03d.jpg"), timeout=600)
            files = sorted(os.listdir(outdir))
            frames = [np.asarray(Image.open(os.path.join(outdir, f)).convert("L"), dtype=float) for f in files]
            h = frames[0].shape[0] // 2
            te = [float(np.abs(frames[i + 1][:h] - frames[i][:h]).mean()) for i in range(len(frames) - 1)]
            be = [float(np.abs(frames[i + 1][h:] - frames[i][h:]).mean()) for i in range(len(frames) - 1)]
            frozen = [round((i + 1) * 0.5, 1) for i in range(len(te)) if te[i] > 3 and be[i] / max(te[i], 0.1) < 0.35]
            report["freeze"] = {"suspected_times": frozen}
            if frozen:
                notes.append(f"freeze: suspected frozen picture at {frozen} (D9, regenerate those windows)")
            else:
                notes.append("freeze: none")
        except Exception as e:
            notes.append(f"freeze check skipped: {e}")
    rp = _write_json(os.path.dirname(window_outputs[0]) or ".", "swap_verify_report.json", report)
    return ToolResult(text="[OK] swap_verify: " + "; ".join(notes)
                           + " — a human review at full speed with the audio track is still required",
                      data=report, artifacts=[rp])

# ---------------------------------------------------------------- registration

_CAST_SCHEMA = {
    "type": "array", "minItems": 1,
    "description": "One entry per person to replace. label = the slot used in the labels table's who "
                   "(A, B, ...); orig = how the original performer looks in the source, in a few words; "
                   "card = path of that character's sheet image (made in the S3a step).",
    "items": {"type": "object", "properties": {
        "label": {"type": "string"}, "orig": {"type": "string"},
        "card": {"type": "string"}, "desc": {"type": "string"}},
        "required": ["label", "orig", "card"]}}

SWAP_SCHEMAS: dict[str, dict] = {
    "swap_scan": {"description": "Person-swap step 1: shot table, contact sheets and labels template. Reads the "
                                 "detect_shots timeline, closes micro gaps (D3), extracts one frame per shot, tiles "
                                 "numbered contact sheets and writes swap_labels.template.json for the agent to fill "
                                 "(who/size/diff per shot; '?' blocks planning). Relative paths are project paths; "
                                 "workdir defaults to the timeline's directory.",
                  "inputSchema": {"type": "object", "properties": {
        "video": {"type": "string"}, "timeline_path": {"type": "string", "description": "output_json of detect_shots"},
        "workdir": {"type": "string"}},
        "required": ["video", "timeline_path"]}},
    "swap_plan": {"description": "Person-swap step 2: authoritative 24 fps frame grid and generation windows aligned "
                                 "to the cuts. A window shorter than min_window (default 3.5 s) merges with a "
                                 "neighbour; grouping targets max_window (default 6.5 s, at most 14). A single shot "
                                 "longer than max_window+0.5 s or a short window that cannot merge blocks the plan "
                                 "with [ERROR]; adjust min_window/max_window or the shot rows and rerun. Writes "
                                 "swap_windows.json next to the labels table (or in workdir).",
                  "inputSchema": {"type": "object", "properties": {
        "labels_path": {"type": "string", "description": "the filled labels table"}, "workdir": {"type": "string"},
        "min_window": {"type": "number", "exclusiveMinimum": 0},
        "max_window": {"type": "number", "exclusiveMinimum": 0, "maximum": _MAX_WINDOW_LIMIT}},
        "required": ["labels_path"]}},
    "swap_storyboards": {"description": "Person-swap step 3: one replaced storyboard per shot with people to replace "
                                        "(source frame + the cast's character sheets, edited by the ToolHub image "
                                        "generator). Existing storyboards are reused. D2 preflight: every such shot in "
                                        "every window must have its storyboard. workdir defaults to the windows "
                                        "file's directory; images go to <workdir>/swap_sb.",
                         "inputSchema": {"type": "object", "properties": {
        "video": {"type": "string"}, "labels_path": {"type": "string"},
        "windows_path": {"type": "string"}, "size": {"enum": ["1K", "1.5K", "2K"],
                                                     "description": "resolution tier, default 2K; the aspect follows the source frame"},
        "workdir": {"type": "string"}, "cast": _CAST_SCHEMA},
        "required": ["video", "labels_path", "windows_path", "cast"]}},
    "swap_generate": {"description": "Person-swap step 4: one H3 request per window (reference clip + character "
                                     "sheets + that window's storyboards, short edit prompt). Requested duration is "
                                     "the window rounded up; submits are staggered; finished windows are skipped and "
                                     "submitted task ids are kept in <workdir>/swap_out/tasks.json, so a rerun "
                                     "collects them instead of submitting again. windows = one window number to run "
                                     "only that window. Runs on ZCode ToolHub (minimax_h3_video) with the signed-in "
                                     "account; the reference clip and images are uploaded as https links.",
                      "inputSchema": {"type": "object", "properties": {
        "video": {"type": "string"}, "windows_path": {"type": "string"},
        "labels_path": {"type": "string"}, "cast": _CAST_SCHEMA,
        "resolution": {"enum": ["768P", "2K"]}, "concurrency": {"type": "integer", "minimum": 1},
        "windows": {"type": "integer"}, "prompt": {"type": "string"}, "workdir": {"type": "string"}},
        "required": ["video", "windows_path", "labels_path", "cast"]}},
    "swap_assemble": {"description": "Person-swap step 5: trim each window to its frame count (N=f1-f0), concatenate, "
                                     "lay the original audio from the first window's start under the picture and "
                                     "assert the length against the frame grid (<0.05 s). Writes <workdir>/<out_name> "
                                     "(default swap_final.mp4); it covers the planned windows only.",
                      "inputSchema": {"type": "object", "properties": {
        "video": {"type": "string"}, "windows_path": {"type": "string"},
        "workdir": {"type": "string"}, "out_name": {"type": "string"}},
        "required": ["video", "windows_path"]}},
    "swap_verify": {"description": "Person-swap acceptance gate: insightface identity check on the window outputs (no "
                                   "strong hit of the original performers; weak hits are listed for a human), freeze "
                                   "detection by motion energy on compare_path (original stacked above the generated "
                                   "picture), and a pairwise storyboard consistency check (D11). Without insightface "
                                   "the identity check is skipped and reported as degraded. face_refs = "
                                   "{orig_a, orig_b, new_a, new_b} image paths.",
                    "inputSchema": {"type": "object", "properties": {
        "window_outputs": {"type": "array", "items": {"type": "string"}},
        "face_refs": {"type": "object"}, "compare_path": {"type": "string"},
        "sample_step": {"type": "number"}},
        "required": ["window_outputs", "face_refs"]}},
}

SWAP_IMPLEMENTATIONS = {
    "swap_scan": swap_scan, "swap_plan": swap_plan, "swap_storyboards": swap_storyboards,
    "swap_generate": swap_generate, "swap_assemble": swap_assemble, "swap_verify": swap_verify,
}
