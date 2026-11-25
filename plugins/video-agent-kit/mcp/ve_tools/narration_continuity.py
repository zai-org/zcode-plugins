"""Continuous paragraph delivery with ASR timing and duration-preserving gain."""
from __future__ import annotations

import hashlib
import json
import math
import re
import subprocess
import wave
from difflib import SequenceMatcher
from pathlib import Path


PROFILE = {
    "version": 2,
    "head_seconds": 0.28,
    "tail_seconds": 0.55,
    "target_lufs": -18.0,
    "instruction": "始终使用同一个自然男声讲述，音色稳定，语气克制连贯。只朗读正文，不模仿人物，不表演对白，不添加字词。",
}
NORMALIZATION_VERSION = 3


def continuity_current(seg: dict, profile: dict) -> bool:
    record = seg.get("continuity", {})
    return (record.get("profile") == profile
            and record.get("normalization_version") == NORMALIZATION_VERSION)


def audio_hash(path: str | Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def alignment_fingerprint(units: list[dict], audio_sha256: str, mode: str,
                          profile: dict | None = None) -> str:
    """Sentence timing depends on spoken boundaries/audio, not shot IDs or subtitles."""
    payload = {"version": 1, "audio_sha256": audio_sha256, "mode": mode,
               "profile": profile,
               "spoken_units": [u.get("spoken_text", u.get("text", "")) for u in units]}
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True)
                          .encode("utf-8")).hexdigest()[:20]


def align_units(units: list[dict], transcript: dict, normalize) -> tuple[list[dict], dict]:
    words = transcript.get("words") or [
        word for row in transcript.get("segments", []) for word in row.get("words", [])
    ]
    heard, times = "", []
    for word in words:
        chars = normalize(word.get("text", ""))
        left, right = float(word["start"]), float(word["end"])
        if not chars or right <= left:
            continue
        heard += chars
        times.extend((left + (right - left) * i / len(chars),
                      left + (right - left) * (i + 1) / len(chars))
                     for i in range(len(chars)))
    targets = [normalize(unit.get("spoken_text", unit.get("text", ""))) for unit in units]
    target = "".join(targets)
    if not target or not heard:
        raise ValueError("Paragraph alignment requires ASR word timestamps")
    matches = {}
    for block in SequenceMatcher(None, target, heard, autojunk=False).get_matching_blocks():
        for offset in range(block.size):
            matches[block.a + offset] = times[block.b + offset]
    rows, cursor, scores = [], 0, []
    for unit, text in zip(units, targets):
        positions = [i for i in range(cursor, cursor + len(text)) if i in matches]
        ratio = len(positions) / max(1, len(text))
        if not positions or ratio < 0.6:
            raise ValueError(f"Unreliable ASR alignment for {unit.get('semantic_unit_id')}: {ratio:.2f}")
        start, end = matches[positions[0]][0], matches[positions[-1]][1]
        if rows and start < rows[-1]["end"] - 0.04:
            raise ValueError("ASR sentence timing is not monotonic")
        rows.append({**unit, "start": round(start, 3), "end": round(end, 3)})
        scores.append(round(ratio, 3))
        cursor += len(text)
    return rows, {"method": "asr_word_alignment", "matched_fraction": round(len(matches) / len(target), 3),
                  "unit_matched_fractions": scores,
                  "note": "Character positions inside multi-character ASR words are interpolated."}


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode:
        raise RuntimeError(result.stderr[-1000:])
    return result


def _loudnorm_report(stderr: str) -> dict:
    """Read the measured object even when FFmpeg appends a muxer footer."""
    numeric = ("input_i", "input_tp", "input_lra", "input_thresh", "output_i",
               "output_tp", "output_lra", "output_thresh", "target_offset")
    reports = []
    decoder = json.JSONDecoder()
    for match in re.finditer(r"(?m)^[ \t]*\{", stderr):
        try:
            value, _ = decoder.raw_decode(stderr[match.end() - 1:])
        except ValueError:
            continue
        if isinstance(value, dict) and set(numeric).issubset(value):
            reports.append(value)
    if len(reports) != 1:
        raise ValueError("Expected one complete FFmpeg loudness report")
    report = reports[0]
    try:
        measurable = all(math.isfinite(float(report[key])) for key in numeric)
    except (TypeError, ValueError):
        measurable = False
    if not measurable or report.get("normalization_type") not in ("linear", "dynamic"):
        raise ValueError("Narration loudness is not measurable")
    return report


def finish_paragraph(seg: dict, transcript: dict, units: list[dict], normalize,
                     profile: dict, output: Path) -> None:
    finished = continuity_current(seg, profile)
    previously_finished = bool(seg.get("continuity"))
    transcript_hash = transcript.get("_audio_sha256")
    on_final_audio = finished and transcript_hash == audio_hash(seg["audio_path"])
    source = seg["raw_audio_path"] if previously_finished and not on_final_audio else seg["audio_path"]
    if previously_finished and not finished and not Path(source).is_file():
        raise ValueError("Original paragraph audio is required to repair legacy normalization timing")
    source_hash = audio_hash(source)
    if transcript_hash != source_hash:
        raise ValueError("ASR transcript does not match the current audio")
    expected_raw_hash = seg.get("continuity", {}).get("source_audio_sha256")
    if previously_finished and not on_final_audio and expected_raw_hash and source_hash != expected_raw_hash:
        raise ValueError("Raw paragraph changed after normalization; align against the final audio")
    rows, alignment = align_units(units, transcript, normalize)
    head, tail = float(profile["head_seconds"]), float(profile["tail_seconds"])
    if finished:
        # Re-segmenting the same paragraph changes word alignment, never its
        # normalized waveform. Reusing raw ASR times also avoids adding head
        # padding twice on each resume.
        shift = 0 if on_final_audio else head
        for row in rows:
            row["start"] = round(row["start"] + shift, 3)
            row["end"] = round(row["end"] + shift, 3)
        seg["sentences"] = rows
        seg["speech_dur"] = rows[-1]["end"]
        seg["delivery_pause_sec"] = round(seg["audio_dur"] - rows[-1]["end"], 3)
        seg["continuity"]["alignment"] = alignment
        by_id = {row["semantic_unit_id"]: row for row in rows}
        for unit in seg.get("semantic_units", []):
            row = by_id.get(unit.get("semantic_unit_id"))
            if row:
                unit["tts_start"], unit["tts_end"] = row["start"], row["end"]
        return
    duration = float(seg["audio_dur"])
    if previously_finished:
        # Repair local processing from the original waveform, retaining its ASR
        # and TTS identity. The old final duration already included padding.
        duration = float(_run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                               "-of", "default=noprint_wrappers=1:nokey=1", source]).stdout)
    target_samples = round((duration + head + tail) * 24000)
    # Two-pass normalization controls loudness and peaks without changing playback speed.
    measure = _run(["ffmpeg", "-nostdin", "-hide_banner", "-i", source, "-af",
                    "loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"])
    loudness = _loudnorm_report(measure.stderr)
    level, peak = float(loudness["input_i"]), float(loudness["input_tp"])
    if not math.isfinite(level) or not math.isfinite(peak):
        raise ValueError("Narration loudness is not measurable")
    output.parent.mkdir(parents=True, exist_ok=True)
    norm = (f"loudnorm=I={profile['target_lufs']}:TP=-1.5:LRA=11:"
            f"measured_I={loudness['input_i']}:measured_TP={loudness['input_tp']}:"
            f"measured_LRA={loudness['input_lra']}:measured_thresh={loudness['input_thresh']}:"
            f"offset={loudness['target_offset']}:linear=true:print_format=json")
    filt = (f"{norm},afade=t=in:d=0.008,"
            f"afade=t=out:st={max(0, duration - 0.012):.6f}:d=0.012,"
            f"adelay={round(head * 1000)}:all=1,apad,aresample=24000,"
            f"atrim=end_sample={target_samples},asetpts=N/SR/TB")
    result = _run(["ffmpeg", "-nostdin", "-hide_banner", "-y", "-i", source,
          "-af", filt, "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", str(output)])
    measured_output = _loudnorm_report(result.stderr)
    with wave.open(str(output)) as audio:
        if (audio.getframerate() != 24000 or audio.getnchannels() != 1
                or audio.getnframes() != target_samples):
            raise ValueError("Normalized paragraph duration differs from the planned sample count")
    for row in rows:
        row["start"] = round(row["start"] + head, 3)
        row["end"] = round(row["end"] + head, 3)
    seg["raw_audio_path"] = source
    seg["audio_path"] = str(output.resolve())
    seg["audio_dur"] = round(target_samples / 24000, 3)
    seg["speech_dur"] = round(rows[-1]["end"], 3)
    seg["delivery_pause_sec"] = round(seg["audio_dur"] - rows[-1]["end"], 3)
    seg["sentences"] = rows
    by_id = {row["semantic_unit_id"]: row for row in rows}
    for unit in seg.get("semantic_units", []):
        row = by_id.get(unit.get("semantic_unit_id"))
        if row:
            unit["tts_start"], unit["tts_end"] = row["start"], row["end"]
    seg["continuity"] = {"profile": profile, "alignment": alignment,
                         "normalization_version": NORMALIZATION_VERSION,
                         "source_audio_sha256": source_hash,
                         "input_lufs": level,
                         "output_lufs": float(measured_output['output_i']),
                         "output_true_peak": float(measured_output['output_tp']),
                         "normalization": measured_output['normalization_type']}
