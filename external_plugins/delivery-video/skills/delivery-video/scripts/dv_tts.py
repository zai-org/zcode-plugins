#!/usr/bin/env python3
"""Narration synthesis, the TTS cache and the subtitle clock.

The cache is content-addressed (tts/<id>.<key>.mp3/.json, key = text + voice +
rate), so an edited narration can never reuse stale audio and nothing has to be
deleted by hand.
"""

from __future__ import annotations

import asyncio
import dataclasses
import json
import math
import os
from pathlib import Path

from dv_core import (
    FPS,
    LATIN_WIDTH,
    LEAD,
    MAX_LINE,
    TAIL,
    RenderError,
    check_edge_tts_version,
    content_sha256,
    duration,
)

BREAK_AFTER = set("。！？；!?;")
SOFT_BREAK = set("，、,")
CACHE_KEY_LENGTH = 16


@dataclasses.dataclass
class Narration:
    mp3: Path
    seconds: float
    chars: list


def segment_seconds(audio_duration: float) -> float:
    """Frame-aligned segment length: narration plus lead-in and tail."""
    return math.ceil((audio_duration + LEAD + TAIL) * FPS) / FPS


def cache_files(build: Path, segment_id: str, text: str, voice: str,
                rate: str) -> tuple[Path, Path]:
    key = content_sha256([text, voice, rate])[:CACHE_KEY_LENGTH]
    root = build / "tts"
    return root / f"{segment_id}.{key}.mp3", root / f"{segment_id}.{key}.json"


def read_clock(clock: Path, text: str) -> list:
    """Thread a cached word clock through the text; unusable caches fail loud."""
    try:
        cached = json.loads(clock.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RenderError(
            f"corrupt TTS clock cache {clock.name}: {exc}; delete it to re-synthesize"
        ) from exc
    if not isinstance(cached, dict) or not isinstance(cached.get("words"), list):
        raise RenderError(
            f"corrupt TTS clock cache {clock.name}: no word boundaries; "
            "delete it to re-synthesize"
        )
    return align_clock(text, cached["words"])


async def synthesize(segment_id: str, text: str, voice: str,
                     rate: str) -> tuple[bytes, list]:
    """Call edge-tts; service and network failures become a clean RenderError."""
    check_edge_tts_version()
    import edge_tts
    words, content = [], bytearray()
    try:
        stream = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
        async for chunk in stream.stream():
            if chunk["type"] == "audio":
                content.extend(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                words.append({"char": chunk["text"],
                              "start_ms": chunk["offset"] // 10000,
                              "end_ms": (chunk["offset"] + chunk["duration"]) // 10000})
    except Exception as exc:
        raise RenderError(
            f"narration synthesis failed for {segment_id}: {type(exc).__name__}: {exc} "
            "-- check the network and the voice, then rerun; "
            "finished segments stay cached"
        ) from exc
    if not words or not content:
        raise RenderError(
            f"narration synthesis failed for {segment_id}: "
            "no audio or word boundaries came back"
        )
    return bytes(content), words


def write_cache(mp3: Path, clock: Path, audio: bytes, record: dict) -> None:
    """Both halves are replaced atomically; a crash between them leaves a plain cache miss."""
    mp3.parent.mkdir(parents=True, exist_ok=True)
    audio_part = mp3.with_name(mp3.name + ".part")
    clock_part = clock.with_name(clock.name + ".part")
    audio_part.write_bytes(audio)
    clock_part.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(audio_part, mp3)
    os.replace(clock_part, clock)


async def synth(segment: dict, voice: str, rate: str, build: Path) -> Narration:
    text = segment["text"]
    mp3, clock = cache_files(build, segment["id"], text, voice, rate)
    if mp3.is_file() and clock.is_file():
        chars = read_clock(clock, text)
    else:
        if mp3.exists() or clock.exists():
            print(f"NOTE {segment['id']}: incomplete narration cache, re-synthesizing",
                  flush=True)
        audio, words = await synthesize(segment["id"], text, voice, rate)
        chars = align_clock(text, words)
        write_cache(mp3, clock, audio,
                    {"text": text, "voice": voice, "rate": rate, "words": words})
    return Narration(mp3, segment_seconds(duration(mp3)), chars)


def align_clock(text: str, words: list[dict]) -> list[dict]:
    """Expand TTS word boundaries into character clocks using the original text.

    edge-tts WordBoundary events omit punctuation. Re-threading their timings
    through the source narration preserves commas and sentence ends so subtitle
    grouping can break where a viewer expects it to.
    """
    if not words:
        return []
    chars: list[dict] = []
    cursor = 0
    previous_end = 0
    for word in words:
        token = str(word.get("char") or "")
        if not token:
            continue
        index = text.find(token, cursor)
        if index < 0:
            raise RenderError(
                f"TTS word boundary {token!r} is not present in narration {text!r}; "
                "rewrite the segment without symbols, emoji or mixed scripts"
            )
        gap = text[cursor:index]
        for char in gap:
            if char.isspace():
                continue
            chars.append({"char": char, "start_ms": previous_end, "end_ms": previous_end})
        if (
            any(char.isspace() for char in gap)
            and token[0].isascii()
            and token[0].isalnum()
        ):
            chars.append(
                {"char": " ", "start_ms": previous_end, "end_ms": previous_end}
            )

        start = int(word.get("start_ms") or 0)
        end = max(start + 1, int(word.get("end_ms") or 0))
        for offset, char in enumerate(token):
            char_start = round(start + (end - start) * offset / len(token))
            char_end = round(start + (end - start) * (offset + 1) / len(token))
            chars.append({"char": char, "start_ms": char_start, "end_ms": char_end,
                          "word": offset == 0})
        cursor = index + len(token)
        previous_end = end

    for char in text[cursor:]:
        if not char.isspace():
            chars.append(
                {"char": char, "start_ms": previous_end, "end_ms": previous_end}
            )
    return chars


def line_weight(line: list) -> float:
    """Width in subtitle units: a CJK char is one, a latin char a bit over half."""
    return sum(LATIN_WIDTH if char["char"].isascii() else 1.0 for char in line)


def word_cut(line: list) -> int:
    """Where to cut a line that grew too long: before the word being spoken, unless
    that word is the whole line."""
    word_starts = [position for position, item in enumerate(line) if item.get("word")]
    if word_starts and word_starts[-1] > 0:
        return word_starts[-1]
    return len(line)


def group_lines(chars: list[dict], max_line: int = MAX_LINE) -> list[list[dict]]:
    """Split word-clock chars into subtitle lines. No spoken word is cut in half:
    a line ends after sentence punctuation, at soft punctuation once it is long,
    or when the length cap moves the word being spoken to the next line. A Latin
    run is broken only when wider than a whole line."""
    lines, current = [], []
    for index, char in enumerate(chars):
        current.append(char)
        nxt = chars[index + 1]["char"] if index + 1 < len(chars) else ""
        if char["char"].isascii() and char["char"].isalnum() \
                and nxt.isascii() and nxt.isalnum():
            if line_weight(current) >= max_line + 2:
                cut = word_cut(current)
                lines.append(current[:cut])
                current = current[cut:]
            continue
        sentence_end = char["char"] in BREAK_AFTER
        soft = char["char"] in SOFT_BREAK
        if sentence_end or len(current) >= max_line + 2 \
                or (len(current) >= max_line and soft):
            cut = len(current) if sentence_end or soft else word_cut(current)
            lines.append(current[:cut])
            current = current[cut:]
    if current:
        lines.append(current)
    return lines
