"""Shared creation production support; media APIs and explicit evidence contracts."""
from __future__ import annotations

import json
import re
import subprocess
from datetime import datetime, timezone
UTC = timezone.utc  # datetime.UTC needs Python 3.11
from pathlib import Path
from typing import Any

from ve_tools import audio_identity, faceqc
from ve_tools.result import ToolResult
from ve_tools.run_context import RunContext

LEDGER_REL = "out/creation/verified.json"
VERIFY_DIR_REL = "out/creation/verify"
GRID_COLS, GRID_ROWS = 4, 4
DEFAULT_FPS = 2.0
BUDGET_NORMAL = 5
BUDGET_HEAD = 10
# Voice auto-fail line for in-clip speech vs a clean voice card. Calibrated 2026-09-17 on
# v6 clips with an ear (gemini audio) as reference: 0.10 and 0.29 were "different person",
# 0.49 and 0.79 were "same person" — so <0.35 is a safe automatic reject; 0.35-0.55 is
# handed to the judge with a warning (emotion shifts — a shout vs a calm reading — live here).
# Both follow the active scorer (VE_SPEAKER_SCORER); the numbers below are mfcc_f0's.
VOICE_AUTO_FAIL, VOICE_SUSPECT = audio_identity.thresholds()
# v9: less speech than this cannot support a voice verdict at all
VOICE_MIN_SPEECH_S = 3.0
# v9.1 (short-span fix). On <3s the MFCC time-mean is dominated by WHICH phonemes were
# said, not by who said them, so the seed score is noise in BOTH directions — it lets
# impostors through and it burns retry budget on good takes. Two changes follow from that:
#   * the seed score no longer auto-fails a thin span (it only warns);
#   * instead we score the span against the shot's OWN TTS line — same words, same clone
#     source — which removes the phonetic-content confound and IS comparable at 1-2s.
# CONTENT_MATCH thresholds are provisional (no ear-calibrated set exists for
# re-performance-vs-TTS yet); they reuse the seed scale deliberately so there is one
# number to recalibrate, not two.
VOICE_CONTENT_MATCH_FAIL = VOICE_AUTO_FAIL   # same words + this far apart = different voice
VOICE_CONTENT_MATCH_OK = VOICE_SUSPECT       # clears the thin gate without a human waiver

CHECKS = (
    "lipsync",          # mouth moves while the line plays; closed-mouth speech fails
    "speaker_identity",  # the line comes out of the scripted speaker, not another face
    "voice",            # timbre matches the character's voice card (objective + ear)
    "identity",         # face/hair/body match the bound cards, shot to shot
    "traits",           # each listed trait visible when the character is in frame
    "wardrobe",         # Production contract; see video-creation references for rationale.
    "props",            # Production contract; see video-creation references for rationale.
    "presence",         # Production contract; see video-creation references for rationale.
    "relations",        # rider on their own mount, bonds hold
    "scale",            # creature/human/prop proportions match physique
    "physics",          # plausible motion: no backwards flight, limbs/wings stable, contact
    "continuity",       # picks up where the upstream segment/keyframe left off
    "motion",           # not a sticker: subject and camera actually move, no frozen spans
)
VERDICTS = ("pass", "mute_audio", "regenerate")
# Production contract; see video-creation references for rationale.
# Production contract; see video-creation references for rationale.
# Production contract; see video-creation references for rationale.
# binding errors, trimmed to what a vertical dialogue drama produces.
DEFECT_TAGS: dict[str, tuple[str, ...]] = {
    "lipsync": ("mouth_closed_while_speaking", "mouth_moves_without_line", "out_of_sync", "mouth_moves_on_inner_line"),
    "speaker_identity": ("line_from_wrong_person", "speaker_not_visible", "speakers_swapped"),
    "voice": ("timbre_mismatch", "register_shift", "wrong_language", "invented_speech", "line_missing"),
    "identity": ("face_changed", "hair_changed", "body_changed", "duplicate_character", "characters_merged",
                 "identities_swapped"),
    "traits": ("trait_missing", "trait_wrong_side", "trait_on_wrong_person"),
    "wardrobe": ("clothing_changed", "accessory_changed", "injury_state_jump", "attribute_on_wrong_person"),
    "props": ("prop_missing", "prop_state_jump", "prop_wrong_holder", "prop_from_nowhere", "prop_design_changed",
              "prop_vanishes"),
    "presence": ("scheduled_character_absent", "extra_character", "lingers_after_exit", "entry_exit_order_wrong"),
    "relations": ("bond_broken", "wrong_mount", "action_on_wrong_target", "eyeline_wrong"),
    "scale": ("size_mismatch", "size_jumps_between_shots"),
    "physics": ("impossible_motion", "limb_distortion", "contact_wrong", "object_passes_through"),
    "continuity": ("layout_changed", "light_direction_flipped", "color_grade_jump", "axis_crossed", "position_jump",
                   "does_not_pick_up_upstream"),
    "motion": ("frozen", "sticker_like", "mechanical_motion", "action_missing", "action_not_in_script"),
}
OTHER_DEFECT_TAG = "other"
_CJK = re.compile(r"[一-鿿]")
_CELL_RE = re.compile(r"(grid\s*\d+|g\d+|网格\s*\d+|cell|格|\d+(\.\d+)?\s*s\b)", re.I)


class VerifyError(RuntimeError):
    pass


# --------------------------------------------------------------------------- ledger
def _generation_budget_spent(ctx: RunContext) -> bool:
    """True when the bound generation budget has no take left (.video_agent/creation_budget.json
    vs the reserved count in out/creation/clips/takes.json)."""
    try:
        bound = json.loads(ctx.resolve(".video_agent/creation_budget.json").read_text(encoding="utf-8"))
        book = json.loads(ctx.resolve("out/creation/clips/takes.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    caps = bound.get("budget") if isinstance(bound.get("budget"), dict) else {}
    max_gen = caps.get("max_total_generations")
    max_sec = caps.get("max_total_generated_seconds")
    used_gen = book.get("reserved_generations")
    used_sec = book.get("reserved_seconds")
    if isinstance(max_gen, (int, float)) and isinstance(used_gen, (int, float)) and used_gen >= max_gen:
        return True
    return bool(isinstance(max_sec, (int, float)) and isinstance(used_sec, (int, float)) and used_sec >= max_sec)


def load_ledger(ctx: RunContext) -> dict:
    p = ctx.resolve(LEDGER_REL)
    if not p.is_file():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_ledger(ctx: RunContext, ledger: dict) -> Path:
    p = ctx.resolve(LEDGER_REL)
    p.parent.mkdir(parents=True, exist_ok=True)
    from .creation_takes import write_object
    write_object(p, ledger)
    return p


def ledger_status(ledger: dict, shot_id: str) -> str | None:
    """'pass' | 'mute_audio' | 'regenerate' | 'pending' | 'exhausted' | None."""
    e = ledger.get(shot_id)
    if not isinstance(e, dict):
        return None
    return e.get("status") or e.get("verdict")


def is_final(ledger: dict, shot_id: str) -> bool:
    return ledger_status(ledger, shot_id) in ("pass", "mute_audio")


def budget_for(is_head: bool) -> int:
    return BUDGET_HEAD if is_head else BUDGET_NORMAL


# --------------------------------------------------------------------------- media helpers
def _run(cmd: list[str], timeout: float = 300) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def probe_duration(path: Path) -> float | None:
    from .observation_media import probe
    try:
        return probe(path).get("duration")
    except (OSError, ValueError, RuntimeError):
        return None


def _font_file() -> str | None:
    for cand in ("/usr/local/share/fonts/video-edit/NotoSansCJK-Regular.ttc",
                 "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        if Path(cand).is_file():
            return cand
    return None


def make_grids(clip: Path, out_dir: Path, fps: float = DEFAULT_FPS,
               cell_w: int = 480, cell_h: int = 270) -> list[dict]:
    """Extract frames at `fps`, burn the timestamp into each, tile 4x4 per grid.

    Returns [{"path", "index", "start_s", "end_s", "cells": n}] in order. A 12 s clip at
    2 fps is 24 frames = 2 grids; a 30 s chain segment is 60 frames = 4 grids. Every cell
    carries its own time label so a verdict can cite "grid 2 cell 7 (t=11.5s)".
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("grid_*.jpg"):
        old.unlink()
    frames_dir = out_dir / "_frames"
    frames_dir.mkdir(exist_ok=True)
    for old in frames_dir.glob("*.jpg"):
        old.unlink()
    font = _font_file()
    label = (f"drawtext=fontfile={font}:" if font else "drawtext=") +\
        "text='%{pts\\:hms}':x=8:y=h-th-8:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=4"
    vf = f"fps={fps},scale={cell_w}:{cell_h},{label}"
    r = _run(["ffmpeg", "-y", "-v", "error", "-i", str(clip), "-vf", vf, "-q:v", "3",
              str(frames_dir / "f_%04d.jpg")])
    if r.returncode != 0 and "drawtext" in (r.stderr or ""):
        # 无 drawtext 滤镜的 ffmpeg (精简构建): 降级为无时间戳网格 — 证据仍在,
        # 只是 verdict 引用格子时没有烧录时间 (用 grid index + 帧序推算)。
        vf = f"fps={fps},scale={cell_w}:{cell_h}"
        r = _run(["ffmpeg", "-y", "-v", "error", "-i", str(clip), "-vf", vf, "-q:v", "3",
                  str(frames_dir / "f_%04d.jpg")])
    if r.returncode != 0:
        raise VerifyError(f"frame extraction failed: {r.stderr[-300:]}")
    frames = sorted(frames_dir.glob("f_*.jpg"))
    if not frames:
        raise VerifyError("no frames extracted")
    per = GRID_COLS * GRID_ROWS
    grids: list[dict] = []
    for gi in range(0, len(frames), per):
        chunk = frames[gi:gi + per]
        # pad the last grid with black cells so the layout stays 4x4 (cell numbering is stable)
        inputs: list[str] = []
        for f in chunk:
            inputs += ["-i", str(f)]
        n_pad = per - len(chunk)
        filt_in = "".join(f"[{i}:v]" for i in range(len(chunk)))
        pad_src = ""
        if n_pad:
            for k in range(n_pad):
                inputs += ["-f", "lavfi", "-i", f"color=c=black:s={cell_w}x{cell_h}:d=1"]
                filt_in += f"[{len(chunk) + k}:v]"
        filt = f"{filt_in}xstack=inputs={per}:layout=" + "|".join(
            f"{(i % GRID_COLS) * cell_w}_{(i // GRID_COLS) * cell_h}" for i in range(per)
        ) + "[v]"
        out = out_dir / f"grid_{gi // per + 1:02d}.jpg"
        r = _run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", filt + pad_src,
                  "-map", "[v]", "-frames:v", "1", "-q:v", "3", str(out)])
        if r.returncode != 0:
            raise VerifyError(f"grid tiling failed: {r.stderr[-300:]}")
        start_s = (gi) / fps
        end_s = (gi + len(chunk)) / fps
        grids.append({"path": str(out), "index": gi // per + 1, "start_s": round(start_s, 2),
                      "end_s": round(end_s, 2), "cells": len(chunk),
                      "cell_seconds": round(1.0 / fps, 3)})
    return grids


def motion_profile(clip: Path, fps: float = 2.0) -> dict:
    """Mean absolute inter-frame difference per sample (0-255 scale) plus blank-frame
    detection. Used for two objective flags: frozen spans (sticker feel / static plate)
    and blank/grey frames (render gap, fog whiteout, black cut)."""
    import numpy as np

    r = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(clip), "-vf", f"fps={fps},scale=160:90,format=gray",
         "-f", "rawvideo", "-"], capture_output=True, timeout=300)
    buf = r.stdout
    n = len(buf) // (160 * 90)
    if n < 2:
        return {"samples": n, "frozen_spans": [], "blank_frames": [], "mean_motion": None}
    arr = np.frombuffer(buf[: n * 160 * 90], dtype=np.uint8).reshape(n, 90, 160).astype(np.int16)
    diffs = [float(np.abs(arr[i] - arr[i - 1]).mean()) for i in range(1, n)]
    stds = [float(arr[i].std()) for i in range(n)]
    frozen: list[dict] = []
    run_start = None
    for i, d in enumerate(diffs):
        t = (i + 1) / fps
        if d < 1.2:
            if run_start is None:
                run_start = t - 1 / fps
        else:
            if run_start is not None and t - run_start >= 2.5:
                frozen.append({"start_s": round(run_start, 2), "end_s": round(t, 2)})
            run_start = None
    if run_start is not None and n / fps - run_start >= 2.5:
        frozen.append({"start_s": round(run_start, 2), "end_s": round(n / fps, 2)})
    blank = [{"t_s": round(i / fps, 2), "std": round(s, 1)} for i, s in enumerate(stds) if s < 6.0]
    return {"samples": n, "fps": fps, "mean_motion": round(sum(diffs) / len(diffs), 2),
            "frozen_spans": frozen, "blank_frames": blank}


def cjk_overlap(want: str, got: str) -> float:
    from .creation_takes import speech_verdict_detail
    return speech_verdict_detail(want, got)["similarity"]


def _extract_wav(clip: Path, out: Path) -> Path | None:
    r = _run(["ffmpeg", "-y", "-v", "error", "-i", str(clip), "-vn", "-ac", "1", "-ar", "16000", str(out)])
    return out if r.returncode == 0 and out.is_file() and out.stat().st_size > 1000 else None


def _speech_only_wav(wav: Path, segments: list[dict], out: Path, pad: float = 0.12) -> tuple[Path | None, float]:
    """Concatenate only the ASR-timed speech spans. A 1 s line inside 6 s of wind and
    water gave voice_compare 0.09 against a clean voice card when fingerprinted on the
    whole clip — the ambience, not the voice, was being compared. Returns (path, seconds)."""
    from .creation_takes import _speech_only_wav as extract
    return extract(wav, segments, out, pad)


_AUDIO_EXTS = (".wav", ".mp3", ".m4a", ".ogg")
# The one place synthesised speech lives, fixed by SKILL.md step 4 the same way the skill
# already fixes out/screenplay, out/timeline and out/creation/shotlist.
#
# This was a list of five candidate directories for one day, because the agent picked the
# path and picked a different one every run — out/creation/voice, then out/voices/lines, then
# out/creation/tts_lines across three runs of the same skill. Guessing cannot win that race:
# the lookup found nothing, the content-matched score was silently absent, and nothing said so.
# Naming the path in the skill ends it. Auditions and voice cards sit in their own subdirectories
# so a shot-id scan never mistakes them for a line.
VOICE_ROOT = "out/creation/voice"
# Narration lives in its own subdirectory, like cards/ and auditions/, so a shot-id scan
# never mistakes it for an in-clip line. `_vo_` is still recognised by name for runs that
# predate the subdirectory.
VOICE_VO_DIR = "vo"


def _is_voiceover_stem(stem: str) -> bool:
    return "_vo_" in stem or stem.endswith("_vo")


def _line_audio_candidates(ctx: RunContext, shot_id: str) -> list[Path]:
    """Synthesised lines belonging to this shot, from the fixed voice directory.

    A file belongs to the shot when its stem is the shot id or starts with `<shot_id>_` —
    `S02_moshu_1.wav` and `S02.wav` both match S02, `S020_x.wav` does not. Subdirectories
    (cards/, auditions/, vo/) are not scanned: a voice card is not a line of dialogue, and
    neither is narration.

    Voice-over is excluded on purpose. It is laid over the cut in post, so the generated
    clip never contains it — scoring a take's own speech against it measures nothing, and
    on 11-03 it actively misfired: `S01_vo_3.wav` was scored against a character's card and
    came back 0.263 "fail" for a narration line that character never speaks on screen.
    Legacy runs wrote `<shot_id>_vo_<n>.wav` into this directory before `vo/` existed, so
    the `_vo_` stems are skipped here too rather than only by living elsewhere.
    """
    try:
        root = ctx.resolve(VOICE_ROOT)
    except (OSError, ValueError):
        return []
    if not root.is_dir():
        return []
    out = []
    for p in sorted(root.iterdir()):
        if not p.is_file() or p.suffix.lower() not in _AUDIO_EXTS:
            continue
        stem = p.stem
        if stem == shot_id or stem.startswith(f"{shot_id}_"):
            if _is_voiceover_stem(stem):
                continue
            out.append(p)
    return out


def _line_audio_for(ctx: RunContext, shot_id: str, shot: dict, work: Path) -> Path | None:
    """The shot's own synthesized dialogue audio — the CONTENT-MATCHED reference.

    video generator was handed this file as `dialogue_audio` and re-performed it, so it holds the
    same words in the character's cloned timbre. Comparing a span against it (instead of against
    the generic voice seed) cancels the phonetic-content confound, and it is the only per-take
    measure of how far the generator drifted while re-performing the line. Resolution order: the
    shot's explicit `dialogue_audio`, then the fixed VOICE_ROOT the skill mandates, by filename.
    Several lines are concatenated.
    """
    cands: list[Path] = []
    for explicit in _dialogue_audio_items(shot):
        p = ctx.resolve(explicit)
        if p.is_file():
            cands.append(p)
    if not cands:
        cands = _line_audio_candidates(ctx, shot_id)
    return _concat_audio(cands, work / "line_audio.wav")



def _dialogue_audio_items(shot: dict) -> list[str]:
    """`dialogue_audio` is a path or a list of paths (one per speaker, Audio order)."""
    raw = shot.get("dialogue_audio")
    items = raw if isinstance(raw, list) else ([raw] if raw else [])
    return [str(x).strip() for x in items if str(x or "").strip()]


def _safe_stem(value: str) -> str:
    return re.sub(r"[^\w\-]+", "_", str(value or "")).strip("_") or "x"


def _concat_audio(cands: list[Path], out: Path) -> Path | None:
    if not cands:
        return None
    if len(cands) == 1:
        return cands[0]
    inputs: list[str] = []
    for p in cands:
        inputs += ["-i", str(p)]
    filt = "".join(f"[{i}:a]" for i in range(len(cands))) +\
        f"concat=n={len(cands)}:v=0:a=1[out]"
    r = _run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", filt,
              "-map", "[out]", "-ac", "1", "-ar", "16000", str(out)])
    return out if r.returncode == 0 and out.is_file() else cands[0]


def _line_audio_for_speaker(ctx: RunContext, shot_id: str, shot: dict, cast_entry: dict,
                            work: Path) -> Path | None:
    """ONE speaker's own TTS line(s) in a multi-speaker shot — the content-matched reference
    for that speaker. Matched by the cast id / name inside the filename under the fixed
    VOICE_ROOT, or the explicit dialogue_audio entry."""
    cid = str(cast_entry.get("id") or "").strip()
    name = str(cast_entry.get("name") or "").strip()

    def _mine(p: Path) -> bool:
        stem = p.stem
        rest = stem[len(shot_id) + 1:] if stem.startswith(f"{shot_id}_") else stem
        return bool((cid and cid in rest) or (name and name in rest))

    cands = [p for p in (ctx.resolve(x) for x in _dialogue_audio_items(shot))
             if p.is_file() and _mine(p)]
    if not cands:
        cands = [p for p in _line_audio_candidates(ctx, shot_id) if _mine(p)]
    return _concat_audio(cands, work / f"line_audio_{_safe_stem(cid or name)}.wav")


def _clip_row_flag(ctx: RunContext, shot_id: str, clip: Path, key: str) -> bool:
    """A generation-time flag (e.g. inner_in_clip) for this clip, from out/creation/clips.json or
    out/creation/clips/takes.json — matched by shot/sequence id and, when several takes exist, by
    the clip path or take id."""
    rows: list[dict] = []
    for rel in ("out/creation/clips.json", "out/creation/clips/takes.json"):
        p = ctx.resolve(rel)
        if not p.is_file():
            continue
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(d, dict):
            got = d.get("clips") or d.get("records") or d.get("takes")
            if isinstance(got, dict):
                got = list(got.values())
            if not isinstance(got, list):
                got = [v for v in d.values() if isinstance(v, dict)]
        else:
            got = d
        rows.extend(r for r in (got or []) if isinstance(r, dict))
    stem = clip.stem
    for r in rows:
        sid = str(r.get("shot_id") or r.get("sequence_id") or "")
        tid = str(r.get("take_id") or "")
        same_clip = Path(str(r.get("clip") or "")).name == clip.name
        if (sid == shot_id and (same_clip or not r.get("clip") or tid in ("", stem))) or tid == stem or same_clip:
            if r.get(key):
                return True
    return False


# --------------------------------------------------------------------------- cast lookup
def _load_shotlist(ctx: RunContext, args: dict) -> dict:
    p = ctx.resolve(args.get("shotlist_path") or "out/creation/shotlist.json")
    if not p.is_file():
        return {}
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def expectations_for(shotlist: dict, shot_id: str) -> dict:
    """Pull what the judge must compare against: bound cast (cards, epithet, traits,
    physique, voice), relations among them, dialogue speakers/lines, chain parent.

    序列制适配 (v4): sequences[] 与 shots[] 同查 — clip 键在 v4 下是
    sequence_id。"""
    shots = {s.get("shot_id") or s.get("sequence_id"): s
             for s in (shotlist.get("shots") or []) + (shotlist.get("sequences") or [])
             if isinstance(s, dict)}
    cast = {c.get("id"): c for c in shotlist.get("cast") or [] if isinstance(c, dict)}
    shot = shots.get(shot_id) or {}
    from .creation_planning import effective_cast, resolved_beat
    bound = effective_cast(shotlist, shot)
    beat = resolved_beat(shotlist, shot)
    exp: dict[str, Any] = {
        "shot_found": bool(shot),
        "continues_from": shot.get("continues_from"),
        "variant_id": shot.get("variant_id"),
        "is_chain_head": not shot.get("continues_from"),
        "beat_id": shot.get("beat"),
        "beat": beat,
        "video_prompt": shot.get("prompt") or shot.get("video_prompt"),
        "required_visuals": list(dict.fromkeys((beat.get("required_visuals") or []) + (shot.get("required_visuals") or []))),
        "intent": shot.get("intent") or beat.get("intent"),
        "cause": shot.get("cause") or beat.get("cause"),
        "effect": shot.get("effect") or beat.get("effect"),
        "intended_effect": shot.get("intended_effect") or beat.get("intended_effect"),
        "dialogue": shot.get("dialogue") or [],
        "narration": shot.get("narration") if isinstance(shot.get("narration"), dict) else None,
        "continuity": shot.get("continuity") if isinstance(shot.get("continuity"), dict) else None,
        # 1012: 计划声明的有意静止 (空镜/静物/档案照式/固定机位) 与允许的环境人声
        "static": bool(shot.get("static")),
        "ambient_speech_ok": bool(shot.get("ambient_speech_ok")),
        # 画外声不在片内音轨上, 只给裁判知道它存在 (不进 ASR 台词核对)
        "voiceover": [v for v in (shot.get("voiceover") if isinstance(shot.get("voiceover"), list)
                                  else [shot.get("voiceover")]) if isinstance(v, dict)],
        "cast": [],
        "relations": [],
        "scale_pairs": [],
    }
    for c in bound:
        exp["cast"].append({
            "id": c.get("id"), "name": c.get("name"), "kind": c.get("kind"),
            "epithet": c.get("epithet"), "traits": c.get("traits") or [],
            "physique": c.get("physique"), "voice": c.get("voice"),
            "appearance": c.get("appearance"), "styling": c.get("styling"), "state": c.get("state"),
            "voice_card": c.get("voice_card"),
            "cards": {k: c.get(k) for k in ("image", "image_side", "image_back") if c.get(k)},
        })
        for rel in c.get("relations") or []:
            if isinstance(rel, dict) and rel.get("target") in {b.get("id") for b in bound}:
                exp["relations"].append({"from": c.get("name"), "type": rel.get("type"),
                                         "to": cast.get(rel["target"], {}).get("name")})
    # ⑦ plan-level bindings: 两端都在本镜(含本镜 props)时, 关系说明进核对清单
    # (谁骑谁/谁抱着谁/谁押着什么) — 错配可被验片逐条抓出
    _props_by_id = {q.get("id"): q for q in shotlist.get("props") or [] if isinstance(q, dict)}
    _frame_ids = {c.get("id") for c in bound} | set(shot.get("prop_ids") or [])
    def _name_of(eid):
        if eid in cast:
            return cast[eid].get("name")
        return (_props_by_id.get(eid) or {}).get("name") or eid
    for b in shotlist.get("bindings") or []:
        if (isinstance(b, dict) and b.get("phrase")
                and b.get("a") in _frame_ids and b.get("b") in _frame_ids):
            exp["relations"].append({
                "from": _name_of(b.get("a")), "type": "binding",
                "to": _name_of(b.get("b")),
                "note": b.get("note"), "phrase": b.get("phrase"),
            })
    # scale expectations: every human/creature pair in frame with physique numbers
    def _h(c: dict) -> float | None:
        ph = c.get("physique") or {}
        for k in ("height_m", "length_m", "body_length_m"):
            v = ph.get(k)
            if isinstance(v, (int, float)) and v > 0:
                return float(v)
        return None
    for i, a in enumerate(bound):
        for b in bound[i + 1:]:
            ha, hb = _h(a), _h(b)
            if ha and hb:
                big, small = (a, b) if ha >= hb else (b, a)
                exp["scale_pairs"].append({
                    "big": big.get("name"), "small": small.get("name"),
                    "ratio": round(max(ha, hb) / min(ha, hb), 1),
                    "statement": f"{big.get('name')} 约为 {small.get('name')} 的 "
                                 f"{round(max(ha, hb) / min(ha, hb), 1)} 倍长/高",
                })
    return exp


def _voice_check_multi_speaker(ctx: RunContext, shot_id: str, shot_raw: dict, wav: Path,
                               asr_segments: list[dict], dialogue: list,
                               cards_by_speaker: dict[str, tuple[Path, dict]], vdir: Path,
                               objective: dict, auto_fail: list[str], warnings: list[str]) -> None:
    'voice check multi speaker.'
    from ve_tools.audio_identity import voice_similarity
    from ve_tools.creation_takes import assign_asr_speakers

    assign = assign_asr_speakers(asr_segments, dialogue)
    rows: list[dict] = []
    for name, (card, c) in cards_by_speaker.items():
        cid = str(c.get("id") or name)
        spans = assign["spans"].get(name) or []
        segs = [{"start": a, "end": b} for a, b in spans]
        sw, ss = _speech_only_wav(wav, segs, vdir / f"speech_only_{_safe_stem(cid)}.wav")
        row: dict[str, Any] = {"speaker": name, "cast_id": cid, "speech_seconds": round(ss, 2),
                               "asr_labels": assign["labels_of"].get(name) or []}
        if sw is None or ss < 0.6:
            row["status"] = "no_speech"
            warnings.append(f"{name}: no ASR span could be attributed to this speaker — voice "
                            "unverified; confirm by listening that the line comes from this face")
            rows.append(row)
            continue
        vs = voice_similarity({"audio_a": str(sw), "audio_b": str(card)}, ctx)
        sim = (vs.data or {}).get("similarity")
        row["similarity"] = sim
        # 261102: score the speaker against their OWN TTS line for every take, not only when the
        # span is short. This is the per-take measure of how far the generator drifted while
        # re-performing the line — the drift the card score cannot see (see the single-speaker
        # branch for the run-level numbers that motivated this).
        line_audio = _line_audio_for_speaker(ctx, shot_id, shot_raw, c, vdir)
        cm_sim = None
        if line_audio is not None:
            cm = voice_similarity({"audio_a": str(sw), "audio_b": str(line_audio)}, ctx)
            cm_sim = (cm.data or {}).get("similarity")
            row["content_matched"] = {"similarity": cm_sim, "reference": ctx.virtualize(line_audio)}
            if cm_sim is not None:
                row["content_matched_ok"] = cm_sim >= VOICE_CONTENT_MATCH_OK
        if ss < VOICE_MIN_SPEECH_S:
            row["thin_evidence"] = True
            if cm_sim is not None and cm_sim < VOICE_CONTENT_MATCH_FAIL:
                row["status"] = "suspect"
                warnings.append(f"{name}: content_matched voice_similarity={cm_sim} < "
                                 f"{VOICE_CONTENT_MATCH_FAIL} vs this speaker's own TTS line (on "
                                 f"{ss:.1f}s of speech): heuristic mismatch; compare actual voices by listening")
            else:
                row["status"] = "thin"
                warnings.append(f"{name}: only {ss:.1f}s of speech (<{VOICE_MIN_SPEECH_S}s); the seed "
                                f"score {sim} is unreliable"
                                + (f", content-matched {cm_sim}" if cm_sim is not None
                                   else ", and no TTS line audio to compare against — listen"))
        elif cm_sim is not None and cm_sim < VOICE_CONTENT_MATCH_FAIL:
            row["status"] = "suspect"
            warnings.append(f"{name}: content_matched voice_similarity={cm_sim} < "
                            f"{VOICE_CONTENT_MATCH_FAIL} vs this speaker's own TTS line (on "
                            f"{ss:.1f}s of speech): the generator re-performed the line in a "
                            "different voice; listen before deciding")
        elif sim is not None and sim < VOICE_AUTO_FAIL:
            row["status"] = "suspect"
            warnings.append(f"{name}: voice_similarity={sim} < {VOICE_AUTO_FAIL} vs voice card "
                             f"{card.name} (on {ss:.1f}s of isolated speech): heuristic mismatch; listen before deciding")
        elif sim is not None and sim < VOICE_SUSPECT:
            row["status"] = "suspect"
            warnings.append(f"{name}: voice_similarity={sim} suspect ({VOICE_AUTO_FAIL}-{VOICE_SUSPECT}) — "
                            "answer 'voice' from listening")
        else:
            row["status"] = "pass"
        rows.append(row)
    firm = [r["similarity"] for r in rows if r.get("similarity") is not None and not r.get("thin_evidence")]
    thin_rows = [r for r in rows if r.get("thin_evidence")]
    objective["voice"] = {
        "multi_speaker": True, "basis": "speech_spans_by_speaker", "speakers": rows,
        "similarity": min(firm) if firm else None,
        "speech_seconds": round(sum(float(r.get("speech_seconds") or 0) for r in rows), 2),
        "asr_label_map": assign.get("label_map") or {},
        "unassigned_segments": len(assign.get("unassigned") or []),
    }
    if thin_rows:
        objective["voice"]["thin_evidence"] = True
        objective["voice"]["content_matched_ok"] = all(r.get("content_matched_ok") for r in thin_rows)
    if assign.get("off_script"):
        objective["off_script_segments"] = assign["off_script"]
        warnings.append(f"{len(assign['off_script'])} ASR segment(s) are not any scripted line (off-script speech): "
                        + "; ".join(f"{u['start']:.1f}-{u['end']:.1f}s {u['speaker']} {u['text'][:12]!r}" for u in assign["off_script"][:3])
                        + " — trim them out of usable_spans or regenerate if the speaker mouths them")
    if assign.get("unassigned"):
        warnings.append(f"{len(assign['unassigned'])} ASR segment(s) could not be attributed to any "
                        "scripted speaker (interjections / off-script speech): "
                        + "; ".join(f"{u['start']:.1f}-{u['end']:.1f}s {u['text'][:12]!r}"
                                    for u in assign["unassigned"][:3]))


# --------------------------------------------------------------------------- prepare
def prepare_clip_evidence(args: dict, ctx: RunContext) -> ToolResult:
    # v9 batch mode: shot_ids=[...] prepares each and returns one merged result —
    # the caller can hand the batch to a single verifier subagent (or fan the
    # grids out) instead of one round-trip per clip.
    batch = args.get("shot_ids")
    if isinstance(batch, list) and batch:
        if not all(isinstance(x, str) and x.strip() for x in batch):
            return ToolResult(text="[ERROR] shot_ids must be an array of shot ids")
        merged: dict = {"shots": []}
        arts: list[str] = []
        imgs: list[str] = []
        lines: list[str] = []
        for sid in batch:
            sub = {k: v for k, v in args.items() if k != "shot_ids"}
            sub["shot_id"] = sid.strip()
            r = prepare_clip_evidence(sub, ctx)
            ok = not r.text.startswith("[ERROR]")
            merged["shots"].append({"shot_id": sid.strip(), "ok": ok,
                                    "data": r.data if ok else None,
                                    "error": None if ok else r.text})
            arts += list(r.artifacts or [])
            imgs += list(r.image_paths or [])
            lines.append(r.text if ok else f"[{sid.strip()}] {r.text}")
        return ToolResult(text="\n\n".join(lines), data=merged, artifacts=arts, image_paths=imgs, is_error=any(not r["ok"] for r in merged["shots"]))
    shot_id = str(args.get("shot_id") or "").strip()
    if not shot_id:
        return ToolResult(text="[ERROR] shot_id (or shot_ids[]) is required")
    clip = ctx.resolve(args.get("clip") or f"out/creation/clips/{shot_id}.mp4")
    if not clip.is_file():
        return ToolResult(text=f"[ERROR] clip not found: {clip}")
    fps = float(args.get("fps") or DEFAULT_FPS)
    shotlist = _load_shotlist(ctx, args)
    exp = expectations_for(shotlist, shot_id)
    evidence_id = str(args.get("evidence_id") or shot_id)
    vdir = ctx.resolve(f"{VERIFY_DIR_REL}/{evidence_id}")
    if args.get('_review_revision'):
        vdir = vdir / f"revision-{int(args['_review_revision'])}"
    vdir.mkdir(parents=True, exist_ok=True)

    duration = probe_duration(clip)
    try:
        grids = make_grids(clip, vdir, fps=fps)
    except VerifyError as exc:
        return ToolResult(text=f"[ERROR] {exc}")
    motion = motion_profile(clip, fps=min(fps, 4.0))

    objective: dict[str, Any] = {"duration_s": duration, "motion": motion}
    auto_fail: list[str] = []
    warnings: list[str] = []

    # speech: ASR overlap with the scripted line(s)
    lines = [d.get("line") for d in exp["dialogue"] if isinstance(d, dict) and d.get("line")]
    speakers = [d.get("speaker") for d in exp["dialogue"] if isinstance(d, dict)]
    voice_lines = [d for d in exp["dialogue"] if isinstance(d, dict)]
    # inner monologue performed in-clip (Audio N, 画外音): scripted speech for ASR and for the
    # per-speaker voice check; the judge must additionally see the speaker's lips CLOSED.
    narr = exp.get("narration") or {}
    if narr.get("line") and _clip_row_flag(ctx, shot_id, clip, "inner_in_clip"):
        lines.append(str(narr["line"]))
        speakers.append(narr.get("speaker"))
        voice_lines = voice_lines + [{"speaker": narr.get("speaker"), "line": narr["line"]}]
        exp["inner_in_clip"] = {"speaker": narr.get("speaker"), "line": narr["line"], "shot": narr.get("shot")}
        objective["inner_in_clip"] = True
    wav = _extract_wav(clip, vdir / "audio16k.wav")
    if wav is None and lines:
        from ve_tools import generators as _gens
        if not _gens.profile().get("audio_out", True):
            # Silent generator output: no in-clip speech to transcribe or fingerprint.
            objective["clip_audio"] = "silent_generator"
            warnings.append(
                "the video generator returns silent clips: the scripted line is laid from its reference "
                "audio (the TTS line) at assembly. Judge 'lipsync' on the frames (mouth moving in the "
                "line's rhythm, closed for inner monologue); 'voice' is the TTS voice and needs no listening")
    asr_text = None
    if wav is not None and not args.get("skip_asr"):
        try:
            from ve_tools.media import transcribe
            out_json = vdir / "asr.json"
            res = transcribe({"input_path": str(wav), "output_json": str(out_json)}, ctx)
            if not res.failed and out_json.is_file():
                payload = json.loads(out_json.read_text(encoding="utf-8"))
                asr_text = (payload.get("text") or " ".join(u.get("text", "") for u in payload.get("segments", []))).strip()
            elif res.text.startswith("[ERROR]"):
                warnings.append(f"ASR unavailable: {res.text[:120]}")
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"ASR failed: {str(exc)[:120]}")
    objective["asr"] = asr_text
    asr_segments: list[dict] = []
    if args.get("skip_asr"):
        warnings.append("ASR skipped; speech and speaker review require actual listening")
    try:
        if not args.get("skip_asr") and asr_text is not None and (vdir / "asr.json").is_file():
            asr_segments = json.loads((vdir / "asr.json").read_text(encoding="utf-8")).get("segments") or []
    except (OSError, ValueError):
        asr_segments = []
    if lines:
        ov = cjk_overlap("".join(lines), asr_text or "") if asr_text is not None else None
        objective["asr_overlap"] = ov
        if ov is not None and ov < 0.5:
            auto_fail.append(f"asr_overlap={ov} < 0.5: the scripted line is not audibly spoken in-clip")
        # video generator sometimes keeps talking past the reference audio and invents lines
        # (v6 A5S03 re-roll: a 7-char line came back with 30 chars of made-up dialogue).
        # Coverage alone (asr_overlap) cannot see that; compare lengths.
        want_n = len(_CJK.findall("".join(lines)))
        got_n = len(_CJK.findall(asr_text or ""))
        objective["asr_extra_chars"] = max(0, got_n - want_n)
        if asr_text is not None and want_n and got_n >= want_n * 1.5 + 6:
            auto_fail.append(f"ASR heard {got_n} CJK chars for a {want_n}-char line ({asr_text[:40]!r}…): "
                             "the character speaks invented dialogue beyond the script — regenerate "
                             "(shorten duration to audio+1.5s, restate 说完即闭口)")
    else:
        # non-dialogue shot: intelligible words (>=3 CJK chars beyond interjections) = stray speech
        interj = set("呀哎啊嗯哦唉喂嘿哈呃嗨噢")
        words = set(_CJK.findall(asr_text or "")) - interj
        objective["stray_speech_chars"] = len(words)
        if len(words) >= 3 and exp.get("ambient_speech_ok"):
            warnings.append(f"non-dialogue shot, ASR heard {asr_text!r} — the plan declares ambient speech "
                            "here (crowd/background vocals); pass is fine if nobody on screen mouths a line")
        elif len(words) >= 3:
            warnings.append(f"non-dialogue shot but ASR heard {asr_text!r}: verdict must be "
                            "mute_audio or regenerate, not pass")

    # voice fingerprint against the speaker's voice_card (a sample in the fixed preset
    # voice every TTS line of that character uses)
    distinct_speakers = list(dict.fromkeys(str(s) for s in speakers if s))
    cards_by_speaker: dict[str, tuple[Path, dict]] = {}
    for c in exp["cast"]:
        if c.get("name") in distinct_speakers and c.get("voice_card"):
            p = ctx.resolve(str(c.get("voice_card")))
            if p.is_file():
                cards_by_speaker[str(c["name"])] = (p, c)
    voice_card = next(iter(cards_by_speaker.values()))[0] if cards_by_speaker else None
    shot_raw = next((s for s in (shotlist.get("shots") or []) + (shotlist.get("sequences") or [])
                     if isinstance(s, dict) and (s.get("shot_id") or s.get("sequence_id")) == shot_id), {})
    if lines and wav is None and objective.get("clip_audio") == "silent_generator" and cards_by_speaker:
        # The clip is silent and the line heard in the film is each speaker's TTS line, laid in
        # at assembly; the clip was performed to that same audio. Score it against the card so
        # 'voice' rests on a number on the scorer's own scale, as an in-clip score would.
        try:
            from ve_tools.audio_identity import voice_similarity
            rows = []
            for name, (card, entry) in cards_by_speaker.items():
                line_audio = _line_audio_for_speaker(ctx, shot_id, shot_raw, entry, vdir)
                if line_audio is None:
                    warnings.append(f"silent clip: no TTS line audio found for {name} in {shot_id}; "
                                    "'voice' is unverified for this speaker")
                    continue
                vs = voice_similarity({"audio_a": str(line_audio), "audio_b": str(card)}, ctx)
                data = vs.data or {}
                if data.get("similarity") is None:
                    warnings.append(f"silent clip: voice check of {name}'s TTS line failed: {vs.text[:120]}")
                    continue
                rows.append({**data, "speaker": name, "line_audio": ctx.virtualize(line_audio)})
            if rows:
                worst = min(rows, key=lambda r: r["similarity"])
                objective["voice"] = {**worst, "basis": "tts_line", "by_speaker": rows}
                for r in rows:
                    if r["similarity"] < r["fail_below"]:
                        auto_fail.append(f"{r['speaker']}'s TTS line scores {r['similarity']} < {r['fail_below']} "
                                         f"against the voice card ({r['scorer']}): the line heard in the film is "
                                         "not this character — re-synthesise the line, then regenerate the take "
                                         "so the mouth follows the new line")
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"silent-clip voice check failed: {str(exc)[:120]}")
    if lines and wav is not None and len(distinct_speakers) > 1 and cards_by_speaker:
        # v4 sequences: several characters speak in one clip — score each speaker alone
        try:
            _voice_check_multi_speaker(ctx, shot_id, shot_raw, wav, asr_segments, voice_lines,
                                       cards_by_speaker, vdir, objective, auto_fail, warnings)
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"per-speaker voice check failed: {str(exc)[:120]}")
        missing_cards = [s for s in distinct_speakers if s not in cards_by_speaker]
        if missing_cards:
            warnings.append(f"no voice card for speaker(s) {missing_cards} — their voice is unverified")
    elif lines and wav is not None and voice_card is not None and voice_card.is_file():
        # Single speaker: every ASR segment is theirs by default, so an off-script segment
        # (the generator voicing an action note — 11-06 S09: 「哦，没有回头」 from 「始终不回头」)
        # would otherwise pass silently when it is too short to trip the invented-dialogue
        # length gate. Name it with its timing so the judge can cut it out of usable_spans.
        try:
            from ve_tools.creation_takes import assign_asr_speakers as _assign
            _probe = _assign(asr_segments, voice_lines)
            _off = [u for u in (_probe.get("unassigned") or []) + (_probe.get("off_script") or [])
                    if len(_CJK.findall(u.get("text") or "")) >= 3]
            if _off:
                objective["off_script_segments"] = [{"start": u["start"], "end": u["end"], "text": u["text"]} for u in _off]
                warnings.append(f"{len(_off)} ASR segment(s) are not any scripted line (off-script speech): "
                                + "; ".join(f"{u['start']:.1f}-{u['end']:.1f}s {u['text'][:12]!r}" for u in _off[:3])
                                + " — trim them out of usable_spans or regenerate if the speaker mouths them")
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"off-script scan failed: {str(exc)[:80]}")
        try:
            from ve_tools.audio_identity import voice_similarity
            speech_wav, speech_s = _speech_only_wav(wav, asr_segments, vdir / "speech_only.wav")
            basis = "speech_spans" if speech_wav is not None and speech_s >= 0.6 else "full_clip"
            probe = speech_wav if basis == "speech_spans" else wav
            vs = voice_similarity({"audio_a": str(probe), "audio_b": str(voice_card)}, ctx)
            objective["voice"] = {**(vs.data or {"text": vs.text}), "basis": basis,
                                  "speech_seconds": speech_s}
            sim = (vs.data or {}).get("similarity")
            thin = basis == "speech_spans" and speech_s < VOICE_MIN_SPEECH_S
            # v9: <3s of speech cannot support a voice verdict — the score on a
            # 1-2s span under ambience is noise (calibration: worst confusions
            # were all short spans). Mark thin; record refuses a plain pass.
            # v9.1: and fall back to the content-matched reference, which IS
            # comparable at this length because both sides say the same words.
            # 261102: the content-matched score is no longer a thin-only fallback. It answers a
            # question the card score cannot — "how far did the generator drift while
            # re-performing THIS line" — and that drift is the whole audio problem: measured
            # across a full run, TTS-vs-generated separates same from different speaker at
            # AUC 0.545-0.590, i.e. the timbre anchor is not arriving. Scoring it only on short
            # spans is why we never had that number per take.
            cm_sim = None
            line_audio = _line_audio_for(ctx, shot_id, shot_raw, vdir)
            if line_audio is not None and speech_wav is not None:
                cm = voice_similarity({"audio_a": str(speech_wav),
                                       "audio_b": str(line_audio)}, ctx)
                cm_sim = (cm.data or {}).get("similarity")
                objective["voice"]["content_matched"] = {
                    "similarity": cm_sim, "reference": ctx.virtualize(line_audio),
                    "note": "same words as the clip (the TTS line video generator re-performed)",
                }
                if cm_sim is not None:
                    objective["voice"]["content_matched_ok"] = cm_sim >= VOICE_CONTENT_MATCH_OK
            if thin:
                objective["voice"]["thin_evidence"] = True
                if cm_sim is None:
                    warnings.append(
                        f"only {speech_s:.1f}s of speech (<{VOICE_MIN_SPEECH_S}s) and no TTS line "
                        f"audio for {shot_id} to compare against: the voice score below is noise "
                        "in both directions — judge 'voice' by listening")
                else:
                    warnings.append(
                        f"only {speech_s:.1f}s of speech (<{VOICE_MIN_SPEECH_S}s): seed score is "
                        f"unreliable, judging on the content-matched reference instead "
                        f"(same words: {cm_sim})")
            if cm_sim is not None and cm_sim < VOICE_CONTENT_MATCH_FAIL:
                # same words, same clone source, still this far apart — the strongest
                # short-span evidence available, and the one confusion the seed score misses
                warnings.append(
                    f"content_matched voice_similarity={cm_sim} < {VOICE_CONTENT_MATCH_FAIL} vs the "
                    f"shot's own TTS line (on {speech_s}s of speech): the in-clip speaker is not "
                    "this character; listen before deciding")
            elif sim is not None and sim < VOICE_AUTO_FAIL and basis == "speech_spans" and not thin:
                warnings.append(f"voice_similarity={sim} < {VOICE_AUTO_FAIL} vs voice card "
                                 f"{voice_card.name} (on {speech_s}s of speech): different voice — "
                                 "regenerate with voice_ref (or a better voice card)")
            elif sim is not None and sim < VOICE_AUTO_FAIL and thin:
                # NOT an auto-fail: a seed score below the fail line on <3s is as likely to be a good
                # take scored on unlucky phonemes as a real impostor (that asymmetry cost
                # retry budget). The thin gate on record still blocks a silent pass.
                warnings.append(f"voice_similarity={sim} vs the seed on only {speech_s:.1f}s — "
                                "too short to reject on; decide from the content-matched score "
                                "above and from listening")
            elif sim is not None and sim < VOICE_AUTO_FAIL:
                warnings.append(f"voice_similarity={sim} on the full clip (no ASR spans to isolate "
                                "speech) — unreliable under ambience; listen before judging 'voice'")
            elif sim is not None and sim < VOICE_SUSPECT:
                # Generated speech re-voices the line, so a real match often lands between the
                # scorer's two lines; the voice rule passes it (verification.md). Say so here
                # instead of asking for a listen the judge cannot do.
                warnings.append(f"voice_similarity={sim} ({audio_identity.active_scorer()}) between "
                                f"{VOICE_AUTO_FAIL} and {VOICE_SUSPECT}: usual for generated speech; "
                                f"at or above {VOICE_AUTO_FAIL} it passes 'voice' — state the score")
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"voice_similarity failed: {str(exc)[:120]}")
    elif lines:
        warnings.append("speaking shot but no voice card resolvable for the speaker — "
                        "voice check skipped (fix cast.voice_card)")

    if motion.get("frozen_spans"):
        spans = motion["frozen_spans"]
        total = sum(s["end_s"] - s["start_s"] for s in spans)
        objective["frozen_total_s"] = round(total, 2)
        if duration and total >= max(3.0, 0.4 * duration) and exp.get("static"):
            # 计划声明了有意静止: 冻结是设计不是事故, 不自动判失败; 裁判仍须看画面是不是
            # 计划要的那种静止 (而不是该动的主体糊成一张贴纸)
            warnings.append(f"frozen for {total:.1f}s of {duration:.1f}s ({spans}) — the plan declares this "
                            "unit static; judge 'motion' against the intended stillness, not as a defect by itself")
        elif duration and total >= max(3.0, 0.4 * duration):
            auto_fail.append(f"frozen for {total:.1f}s of {duration:.1f}s ({spans}): static plate / sticker "
                             "(if stillness is the intent — empty shot, still life, archive-photo look — declare "
                             "static: true on the unit in the plan)")
        else:
            warnings.append(f"frozen span(s) {spans} — check 'motion' honestly")
    if motion.get("blank_frames"):
        warnings.append(f"blank/near-uniform frame(s) at {[b['t_s'] for b in motion['blank_frames']][:6]}s "
                        "— render gap or whiteout; judge 'continuity'")

    # face evidence (v17): every face >=120px matched against the cast face cards (ArcFace) and
    # aggregated per Shot against the schedule — evidence for identity / presence /
    # speaker_identity, never an auto-verdict (a back or profile Shot legitimately shows no face).
    # Best-effort: without onnxruntime + the two model files it says so and moves on.
    if not args.get("skip_face_qc"):
        fq, fq_warn = faceqc.run_for_clip(ctx, clip, shot_raw, shotlist.get("cast") or [], duration,
                                          dump_to=vdir / "face_qc.json")
        if fq is not None:
            objective["face_qc"] = fq
        warnings += fq_warn

    ledger = load_ledger(ctx)
    prev = ledger.get(evidence_id) if isinstance(ledger.get(evidence_id), dict) else {}
    round_no = int(prev.get("rounds") or 0) + 1
    is_head = bool(args.get("is_chain_head", exp.get("is_chain_head")))
    budget = budget_for(is_head)
    auto_verdict = "regenerate" if auto_fail else None
    entry = {
        "status": "pending", "rounds": round_no, "budget": budget, "is_chain_head": is_head,
        "clip": ctx.virtualize(clip), "prepared_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "objective": objective, "auto_verdict": auto_verdict, "auto_fail": auto_fail,
        "grids": [g["path"] for g in grids], "history": prev.get("history") or [],
    }
    ledger[evidence_id] = entry
    save_ledger(ctx, ledger)
    evidence = {"shot_id": shot_id, "clip": str(clip), "grids": grids, "expectations": exp,
                "objective": objective, "auto_fail": auto_fail, "warnings": warnings,
                "round": round_no, "budget": budget, "required_checks": list(CHECKS), "defect_tags": DEFECT_TAGS}
    (vdir / "evidence.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=1), encoding="utf-8")

    cast_lines = []
    for c in exp["cast"]:
        cast_lines.append(f"  - {c['name']}({c.get('kind') or '?'}): {c.get('epithet') or '(no epithet)'}"
                          f" | traits: {', '.join(c.get('traits') or []) or '-'}"
                          + (f" | physique: {c['physique']}" if c.get('physique') else ""))
    text = [
        f"verify {shot_id} round {round_no}/{budget}: {len(grids)} grid(s) at {fps} fps "
        f"({GRID_COLS}x{GRID_ROWS} cells, {1/fps:.1f}s per cell, timestamps burned in). "
        f"READ EVERY GRID before recording a verdict:",
        *[f"  grid {g['index']}: {g['path']}  [{g['start_s']}-{g['end_s']}s]" for g in grids],
        "expectations:",
        f"  dialogue: {exp['dialogue'] or 'none — nobody may speak'}",
        *([f"  inner monologue IN-CLIP (Audio 画外音): {exp['inner_in_clip']['speaker']} 「{exp['inner_in_clip']['line']}」 "
           f"over Shot {exp['inner_in_clip']['shot']} — it must be HEARD while that speaker's lips stay CLOSED "
           "(lipsync: no mouth movement during this line; speaker_identity: same voice as their spoken lines)"]
          if exp.get("inner_in_clip") else []),
        *([f"  承接状态 (judge wardrobe / props / presence against it): "
           f"entry {(exp['continuity'] or {}).get('entry_state') or '-'} | "
           f"allowed {(exp['continuity'] or {}).get('allowed_changes') or '-'} | "
           f"exit {(exp['continuity'] or {}).get('exit_state') or '-'}"]
          if exp.get("continuity") else []),
        *cast_lines,
        f"  relations: {exp['relations'] or '-'}",
        f"  scale: {[p['statement'] for p in exp['scale_pairs']] or '-'}",
        f"  continues_from: {exp.get('continues_from') or '(chain head)'}",
        "objective:",
        f"  duration={duration}s asr={asr_text!r} asr_overlap={objective.get('asr_overlap')} "
        f"voice={objective.get('voice', {}).get('similarity') if isinstance(objective.get('voice'), dict) else None} "
        f"mean_motion={motion.get('mean_motion')} frozen={motion.get('frozen_spans')} blank={[b['t_s'] for b in motion.get('blank_frames', [])][:5]}",
    ]
    if isinstance(objective.get("voice"), dict) and objective["voice"].get("multi_speaker"):
        text.append("  voice by speaker: " + "; ".join(
            f"{r['speaker']}={r.get('similarity')} ({r.get('status')}, {r.get('speech_seconds')}s"
            f"{', labels ' + '/'.join(r['asr_labels']) if r.get('asr_labels') else ''})"
            for r in objective["voice"]["speakers"]))
    if isinstance(objective.get("face_qc"), dict):
        text += faceqc.format_lines(objective["face_qc"])
    if auto_fail:
        text.append("AUTO-FAIL (cannot be overruled; verdict must be regenerate):")
        text += [f"  ! {a}" for a in auto_fail]
    if warnings:
        text.append("warnings:")
        text += [f"  - {w}" for w in warnings]
    text.append(
        "Then call creation_verify with checks={" + ", ".join(CHECKS) +
        "} — each {ok, evidence:'grid N cell M (t=..s): what you saw'}; a failed check also carries "
        "tags from its closed list (see the tool description) — and overall.")
    from .public_surface import source_fragments
    return ToolResult(text="\n".join(text), data=evidence, protected_texts=source_fragments(exp) + source_fragments(shotlist) + source_fragments({'asr': asr_text}) + ([asr_text[:40], repr(asr_text[:40])[1:-1]] if asr_text else []), artifacts=[str(vdir / "evidence.json")],
                      image_paths=[g["path"] for g in grids])


# --------------------------------------------------------------------------- record
def record_clip_verdict(args: dict, ctx: RunContext) -> ToolResult:
    shot_id = str(args.get("shot_id") or "").strip()
    if not shot_id:
        return ToolResult(text="[ERROR] shot_id is required")
    overall = str(args.get("overall") or "").strip()
    if overall not in VERDICTS:
        return ToolResult(text=f"[ERROR] overall must be one of {VERDICTS}")
    checks = args.get("checks")
    if not isinstance(checks, dict):
        return ToolResult(text="[ERROR] checks must be an object keyed by check name")
    ledger = load_ledger(ctx)
    entry = ledger.get(shot_id)
    if not isinstance(entry, dict) or entry.get("status") != "pending":
        return ToolResult(text=f"[ERROR] {shot_id} has no pending evidence — call "
                          "creation_verify first (verdicts without evidence are not accepted)")
    problems: list[str] = []
    missing = [c for c in CHECKS if c not in checks]
    if missing:
        problems.append(f"missing checks: {missing} (every check must be answered; use "
                        "{ok:true, evidence:'n/a: <why not applicable>'} when a check does not apply)")
    failed_checks: list[str] = []
    for name, item in checks.items():
        if name not in CHECKS:
            problems.append(f"unknown check {name!r}")
            continue
        if not isinstance(item, dict) or not isinstance(item.get("ok"), bool):
            problems.append(f"checks.{name} must be {{ok: bool, evidence: str}}")
            continue
        ev = str(item.get("evidence") or "")
        if len(ev) < 8:
            problems.append(f"checks.{name}.evidence too short — cite grid/cell/time and what you saw")
        elif not item["ok"] and not _CELL_RE.search(ev):
            problems.append(f"checks.{name} failed but evidence cites no grid/cell/time: {ev[:60]!r}")
        if not item["ok"]:
            failed_checks.append(name)
            allowed_tags = DEFECT_TAGS.get(name, ())
            tags = item.get("tags")
            if not isinstance(tags, list) or not [t for t in tags if isinstance(t, str) and t.strip()]:
                problems.append(f"checks.{name} failed without tags — pick >=1 from "
                                f"{list(allowed_tags) + [OTHER_DEFECT_TAG]}")
            else:
                unknown = [t for t in tags if t not in allowed_tags and t != OTHER_DEFECT_TAG]
                if unknown:
                    problems.append(f"checks.{name}.tags {unknown} are not in the closed list "
                                    f"{list(allowed_tags)} (use '{OTHER_DEFECT_TAG}' and describe it in evidence)")
    if entry.get("auto_verdict") == "regenerate" and overall != "regenerate":
        problems.append(f"objective auto-fail stands ({entry.get('auto_fail')}); overall must be regenerate")
    if failed_checks and overall == "pass":
        problems.append(f"checks {failed_checks} failed but overall=pass; choose regenerate "
                        "(or mute_audio if the only failure is stray ambient speech)")
    # v9.1: thin speech evidence cannot back a plain voice pass. Three ways past it, in
    # order of preference: (1) the content-matched score cleared — objective, no human in
    # the loop; (2) the judge listened and says so in notes AND sets the flag — the flag
    # alone used to be enough, which made it a self-serve waiver of exactly the check that
    # catches short-span impostors; (3) nothing — rejected.
    vobj = (entry.get("objective") or {}).get("voice") or {}
    notes_raw = str(args.get("notes") or "").strip()
    if overall == "pass" and vobj.get("thin_evidence") and not vobj.get("content_matched_ok"):
        cm = (vobj.get("content_matched") or {}).get("similarity")
        waived = bool(args.get("allow_thin_voice_evidence")) and len(notes_raw) >= 20
        if not waived:
            problems.append(
                f"voice evidence is thin (<{VOICE_MIN_SPEECH_S}s of speech"
                + (f", content-matched score {cm} did not clear {VOICE_CONTENT_MATCH_OK}"
                   if cm is not None else ", and no TTS line audio to compare against")
                + "): a pass needs allow_thin_voice_evidence=true TOGETHER WITH notes (>=20 chars) "
                  "stating what you heard when you listened to the clip — the flag on its own is "
                  "not evidence")
    if overall == "mute_audio" and any(c not in ("voice", "lipsync") for c in failed_checks):
        problems.append("mute_audio only covers audio defects; visual failures need regenerate")
    round_no = int(entry.get("rounds") or 1)
    budget = int(entry.get("budget") or BUDGET_NORMAL)
    change_plan = str(args.get("change_plan") or "").strip()
    if overall == "regenerate" and round_no >= 2 and len(change_plan) < 15:
        problems.append("round >= 2 regenerate needs change_plan (>=15 chars): what will differ — "
                        "prompt wording, swapped/added cards, edit_from the failed clip, new keyframe, "
                        "shorter duration. Resubmitting the same request is not a retry.")
    if problems:
        return ToolResult(text="[ERROR] verdict rejected:\n- " + "\n- ".join(problems),
                          data={"problems": problems})

    now = datetime.now(UTC).isoformat(timespec="seconds")
    hist = list(entry.get("history") or [])
    failed_tags = {n: list(checks[n].get("tags") or []) for n in failed_checks
                   if isinstance(checks.get(n), dict)}
    hist.append({"round": round_no, "verdict": overall, "failed": failed_checks,
                 "failed_tags": failed_tags,
                 "at": now, "change_plan": change_plan or None,
                 "notes": str(args.get("notes") or "")[:400]})
    status = overall
    exhausted = False
    if overall == "regenerate" and (round_no >= budget or _generation_budget_spent(ctx)):
        # Either the review rounds are used up or the PROJECT's generation budget is: no new
        # take can be made, so the ledger records the best take as shipped with its defect
        # on record (the state the assembly gate documents as "exhausted … may then be laid").
        status = "exhausted"
        exhausted = True
    entry.update({
        "status": status, "verdict": overall, "checks": checks, "failed": failed_checks,
        "failed_tags": failed_tags,
        "notes": str(args.get("notes") or "")[:400], "change_plan": change_plan or None,
        "at": now, "history": hist,
    })
    ledger[shot_id] = entry
    path = save_ledger(ctx, ledger)
    text = f"{shot_id}: {overall} (round {round_no}/{budget})"
    if failed_checks:
        text += f" failed={failed_checks}"
    if exhausted:
        text += "\nReview budget exhausted. This candidate remains failed; reselect, edit or replan and report the unresolved defect."
    elif overall == "regenerate":
        text += f"\nregenerate: {budget - round_no} round(s) left. change_plan: {change_plan or '-'}"
    return ToolResult(text=text, data={"shot_id": shot_id, "entry": entry}, artifacts=[str(path)])


def creation_evidence_status(args: dict, ctx: RunContext) -> ToolResult:
    """Summarize the ledger: which shots are final, pending, need regeneration, exhausted."""
    ledger = load_ledger(ctx)
    wanted = args.get("shot_ids")
    ids = [s for s in wanted] if isinstance(wanted, list) and wanted else sorted(ledger)
    buckets: dict[str, list[str]] = {}
    for sid in ids:
        st = ledger_status(ledger, sid) or "unverified"
        buckets.setdefault(st, []).append(sid)
    text = "\n".join(f"{k} ({len(v)}): {', '.join(v)}" for k, v in sorted(buckets.items()))
    return ToolResult(text=text or "ledger empty", data={"buckets": buckets, "ledger_path": LEDGER_REL})


def collect_voice_consistency(args: dict, ctx: RunContext) -> ToolResult:
    """v9: within-character pairwise voice consistency across the whole film.

    The per-clip voice check anchors each clip to its voice seed; two clips can
    each clear that bar while audibly differing from each other (the shipped
    "16-20s vs 30-35s old man" defect). This tool clusters every prepared clip's
    speech_only.wav by speaker and flags clips whose similarity to their own
    character's other clips is low — a relative check the absolute threshold
    cannot provide. Advisory: act on flagged shots (regenerate, or re-bind the
    voice seed) before assembly.
    """
    shotlist = _load_shotlist(ctx, args)
    by_shot = {(s.get("shot_id") or s.get("sequence_id")): s
               for s in (shotlist.get("shots") or []) + (shotlist.get("sequences") or [])
               if isinstance(s, dict)}
    cast_by_name = {str(c.get("name")): c for c in shotlist.get("cast") or [] if isinstance(c, dict)}
    ledger = load_ledger(ctx)
    per_char: dict[str, list[str]] = {}
    wav_of: dict[str, Path] = {}
    thin_clips: dict[str, float] = {}
    unavailable = {}
    from .creation_planning import file_digest
    for sid in sorted(ledger):
        shot = by_shot.get((ledger.get(sid) or {}).get("shot_id") or sid) or {}
        speakers = list(dict.fromkeys(str(d.get("speaker")) for d in shot.get("dialogue") or []
                                      if isinstance(d, dict) and d.get("speaker")))
        if not speakers:
            continue
        entry = ledger[sid]
        from .creation_planning import digest
        canonical = dict(entry)
        signature = canonical.pop('verdict_signature', None)
        if signature is None:
            signature = canonical.pop('evidence_signature', None)
        if not signature or digest(canonical) != signature:
            unavailable[sid] = 'evidence ledger changed/unbound; prepare again'
            continue
        revision = entry.get('review_revision')
        clip = ctx.resolve(entry.get('clip') or '')
        if not revision or not clip.is_file() or file_digest(clip) != entry.get('source_sha256'):
            unavailable[sid] = 'missing/current source binding changed; prepare again'
            continue
        from .creation_planning import shot_plan_digest
        if shot_plan_digest(shotlist, shot, ctx) != entry.get('shot_plan_sha256'):
            unavailable[sid] = 'plan/reference context changed; prepare again'
            continue
        revision_root = f'{VERIFY_DIR_REL}/{sid}/revision-{revision}'
        bindings = entry.get('evidence_audio_sha256') or {}
        # v4 multi-speaker clips: prepare wrote one speech_only_<cast_id>.wav per speaker;
        # single-speaker clips keep speech_only.wav. Pool keys: "<sid>" or "<sid>/<speaker>".
        pool: list[tuple[str, str, Path]] = []
        if len(speakers) == 1:
            wav = ctx.resolve(f"{revision_root}/speech_only.wav")
            pool.append((speakers[0], sid, wav))
        else:
            for name in speakers:
                cid = str((cast_by_name.get(name) or {}).get("id") or name)
                wav = ctx.resolve(f"{revision_root}/speech_only_{_safe_stem(cid)}.wav")
                pool.append((name, f"{sid}/{name}", wav))
        if not pool:
            unavailable[sid] = 'current revision speech audio missing; prepare again'
        for name, key, wav in pool:
            if not wav.is_file() or bindings.get(str(wav)) != file_digest(wav):
                unavailable[key] = 'current revision audio changed/unbound; prepare again'
                continue
            # v9.1: a <3s span scores as noise, so it cannot serve as anyone's "closest
            # peer" — one short clip in the pool could otherwise vouch for an impostor
            # (or drag a good clip below the line). Report it, do not compare it.
            dur = probe_duration(wav)
            if dur is None or dur <= 0:
                unavailable[key] = 'audio duration unavailable'
                continue
            if dur < VOICE_MIN_SPEECH_S:
                thin_clips[key] = round(dur, 2)
                continue
            per_char.setdefault(name, []).append(key)
            wav_of[key] = wav

    import numpy as np

    def _pair(a: str, b: str) -> float | None:
        # The active scorer, so the score is on the scale VOICE_SUSPECT was taken from.
        try:
            return audio_identity.similarity(str(wav_of[a]), str(wav_of[b]))[0]
        except Exception:  # noqa: BLE001
            return None

    report: list[dict] = []
    flagged_total = 0
    for char in sorted(per_char):
        clips = per_char[char]
        if len(clips) < 2:
            report.append({"character": char, "clips": clips,
                           "note": "fewer than 2 speech clips — pairwise check not applicable"})
            continue
        medians: dict[str, float] = {}
        rows: list[dict] = []
        for a in clips:
            sims = [s for b in clips if b != a for s in [_pair(a, b)] if s is not None]
            # best peer, not median: with few clips an outlier drags everyone's
            # median down; a consistent clip always has ONE close peer, an
            # outlier's closest peer is still far.
            best = float(np.max(sims)) if sims else None
            med = float(np.median(sims)) if sims else None
            medians[a] = med if med is not None else 0.0
            flagged = best is not None and best < VOICE_SUSPECT
            rows.append({"shot": a,
                         "median_to_peers": None if med is None else round(med, 3),
                         "best_peer": None if best is None else round(best, 3),
                         "flagged": flagged})
            if flagged:
                flagged_total += 1
        report.append({"character": char, "clips": len(clips),
                       "cluster_median": round(float(np.median(list(medians.values()))), 3),
                       "rows": rows})
    text_lines = [f"voice consistency across {sum(len(v) for v in per_char.values())} speech clips, "
                  f"{flagged_total} flagged (best same-character peer < {VOICE_SUSPECT}):"]
    for r in report:
        if "rows" not in r:
            text_lines.append(f"  {r['character']}: {r['note']}")
            continue
        marks = ", ".join(f"{x['shot']}(best={x['best_peer']}{'!' if x['flagged'] else ''})"
                          for x in r["rows"])
        text_lines.append(f"  {r['character']} (cluster med {r['cluster_median']}): {marks}")
    if thin_clips:
        text_lines.append(
            f"excluded ({len(thin_clips)}) — under {VOICE_MIN_SPEECH_S}s of speech, too short to "
            f"compare in either direction: "
            + ", ".join(f"{s}({d}s)" for s, d in sorted(thin_clips.items()))
            + ". Judge these by listening, or lengthen the line and regenerate.")
    text_lines.append("flagged clips audibly differ from their own character — regenerate them "
                      "(or re-check the voice seed binding) before assembly.")
    return ToolResult(text="\n".join(text_lines),
                      data={"characters": report, "flagged": flagged_total,
                            "excluded_thin": thin_clips, "unavailable": unavailable})


def verify_evidence_files(entry, ctx):
    from .creation_planning import file_digest, digest
    frozen = dict(entry)
    expected_signature = frozen.pop('verdict_signature', None)
    if not expected_signature or digest(frozen) != expected_signature:
        raise ValueError('review verdict changed; prepare and record again')
    if not entry.get('grid_sha256') or not entry.get('evidence_signature'):
        raise ValueError('review lacks bound evidence; prepare and record again')
    for path, expected in {**entry['grid_sha256'], **entry.get('evidence_audio_sha256', {})}.items():
        source = ctx.resolve(path)
        if not source.is_file() or file_digest(source) != expected:
            raise ValueError('review evidence changed; prepare and record again')
