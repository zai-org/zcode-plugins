"""Text-to-speech through the ZCode TTS service (ToolHub, signed-in account, no key).

``request_tts`` is the durable, content-bound request adapter shared by
``tts_generate`` and batch narration (``synthesize_narration``). A lost response
is recorded before a caller can change the output path, voice or model and
accidentally submit the same words again.
"""
from __future__ import annotations

from ve_tools import file_lock
import hashlib
import io
import json
import math
import re
import subprocess
import tempfile
import time
import wave
from pathlib import Path
from urllib.parse import urlsplit

from .creation_planning import file_digest
from .creation_takes import read_object, write_object
from .file_contract import output_locks, protect_outputs, publish_files
from .media import probe_media
from . import audio_identity
from .result import ToolResult
from .run_context import RunContext, clean_env
from .recap_security import private_directory

PROVIDER = "tts"
# Request identity of the ToolHub adapter. A new version starts a fresh reconciliation
# ledger: records of the earlier direct service never block these requests.
VERSION = "zcode-tts-request-v1"
LEDGER_DIR = "recap_tts"
# The service fixes model, format (wav) and sample rate; only text and voice are sent.
MODEL = "zcode-tts"
DEFAULT_VOICE = "zixinnansheng"
# Text per service call: long text is cut at the service's 30 s limit (UNKNOWN) and audio over
# about one minute exceeds the 4 MiB response; sentences are grouped into chunks of this size.
CHUNK_CHARS = 120
MAX_ATTEMPTS = 2
MAX_AUDIO_BYTES = 64 * 1024 * 1024
MAX_TEXT_CHARS = 1000
MAX_INSTRUCTION_CHARS = 500
SAMPLE_RATE = 24000
OUTPUT_FORMATS = {"wav": ".wav", "mp3": ".mp3", "ogg_opus": ".ogg"}
SUFFIX_FORMATS = {"wav": "wav", "mp3": "mp3", "ogg": "ogg_opus", "opus": "ogg_opus"}
TTS_DEFAULT_RETRIES = 3
TTS_MAX_RETRIES = 10

# Timbre self-check on the synthesised line (261102).
#
# Until now nothing compared a freshly synthesised line against the character's voice card: the
# first moment a timbre problem could surface was per-take verification, after the video had
# already been generated from that audio. But both sides here come out of the same TTS engine
# with the same preset voice, so they are the one pair in this pipeline that *must* score high —
# which also makes this the cheapest place to catch a drifting voice, and the one task where the
# current scorer is least bad (measured on a full run: same-vs-different speaker separates at
# AUC 0.651 for TTS-vs-TTS against 0.590 for TTS-vs-generated).
#
# The check is REQUIRED for dialogue, not optional. It shipped optional on 11-02 and the very
# next run called tts_generate 81 times with voice_card on none of them — an ability nothing
# invokes is an ability that does not exist. `voice_card: "none"` is the explicit way out for
# the cases that genuinely have no card (auditions, sound effects, narration by a voice with no
# character behind it), so skipping is a decision on record rather than an omission.
#
# The verdict itself stays advisory: the scorer in use (mean-pooled MFCC x pitch distance)
# rejects a large share of same-speaker pairs at the ledger's 0.80 gate, so failing the call
# here would send good lines back. `voice_card_retries` re-synthesises instead, and the reported
# score is the same number verification will later use, so the two are comparable.
# Thresholds follow the active scorer: 0.55 means "borderline" to mfcc_f0 and "this is the
# speaker" to campp, so a fixed pair would misread two of the three backends. Resolved at
# import, because VE_SPEAKER_SCORER is fixed for a run.
VOICE_CARD_CHECK_FAIL, VOICE_CARD_CHECK_OK = audio_identity.thresholds()
VOICE_CARD_MAX_RETRIES = 5        # cap on re-synthesis attempts driven by the timbre check
# Repairing drift is the point of the check, so it is on by default whenever there is a real
# card to score against. It used to default to 0 — report only — and then v43 showed what that
# costs: the agent had to remember `voice_card_retries` in a batch script, and the one line it
# forgot (S01_vo_3) shipped at 0.263 against its card. Only a `fail` spends budget, so a clean
# run pays nothing for this default.
VOICE_CARD_DEFAULT_RETRIES = 2

# A line's owner is readable from the path SKILL.md step 4 fixes:
# out/creation/voice/<shot_id>_<cast_id>_<n>.wav, and vo/<shot_id>_<owner>_<n>.wav.
_LINE_OWNER = re.compile(r"(?:^|/)S\d+[A-Za-z]?_([a-z][a-z0-9_]*)_\d+\.(?:wav|mp3|m4a|ogg)$")
# `narrator` owns a voice belonging to no one in the story, so no cast member to check against.
VOICE_OWNER_NARRATOR = "narrator"


def _cast_voice_binding(output: Path, ctx: RunContext, args: dict) -> dict | None:
    """What the plan says this line's character sounds like, or None when it cannot say.

    The card is a free-form argument, and verification reads its own card from the plan's
    `cast[].voice_card` — two sources that were never compared. v43 happened to agree on all
    nine characters because the agent used the skill's fixed path at both ends, but nothing
    enforced it: a second card (`cards/ziyan_v2.wav`), a typo, or another character's card
    would have been scored against silently, and the synthesis-time number would no longer
    mean the same thing as the verification-time one.
    """
    m = _LINE_OWNER.search(str(output).replace("\\", "/"))
    if not m:
        return None
    cast_id = m.group(1)
    if cast_id == VOICE_OWNER_NARRATOR:
        return None
    try:
        from .creation_media import _plan_cast
        members = _plan_cast(ctx, args)
    except Exception:  # noqa: BLE001 — a missing or broken plan must not fail the synthesis
        return None
    for c in members:
        if str(c.get("id") or "") == cast_id:
            return {"cast_id": cast_id, "voice": c.get("voice"), "voice_card": c.get("voice_card")}
    return None


def _check_cast_binding(output: Path, card_arg: object, args: dict, ctx: RunContext) -> list[str]:
    """Refuse a card or voice that disagrees with the plan. Empty list when they agree."""
    declared = _cast_voice_binding(output, ctx, args)
    if not declared:
        return []
    problems = []
    want_card = str(declared.get("voice_card") or "").strip()
    got_card = str(card_arg or "").strip()
    if want_card and got_card and Path(want_card).name != Path(got_card).name:
        problems.append(
            f"voice_card {got_card!r} is not {declared['cast_id']}'s card: the plan declares "
            f"{want_card!r}. Verification scores this line against the plan's card, so a "
            "different one here measures something else and the two numbers stop comparing.")
    want_voice = str(declared.get("voice") or "").strip()
    got_voice = str(args.get("voice") or "").strip()
    if want_voice and got_voice and want_voice != got_voice:
        problems.append(
            f"voice {got_voice!r} is not {declared['cast_id']}'s voice: the plan declares "
            f"{want_voice!r}. One character keeps one preset voice for every line.")
    return problems

VOICE_CARD_NONE = "none"          # explicit "this line has no character card" opt-out
TTS_RETRY_BACKOFF_SECONDS = 3.0
TTS_MAX_TOTAL_BACKOFF_SECONDS = 120.0


# ---------------------------------------------------------------------------
# Preset voices
# ---------------------------------------------------------------------------

VOICE_STYLE_AXES: dict[str, tuple[str, ...]] = {
    "gender": ("male", "female"),
    "age": ("child", "teen", "young adult", "middle-aged", "elderly"),
    "pitch": ("low", "medium", "high"),
    "timbre": ("warm", "bright", "dark", "airy", "raspy", "nasal", "husky", "clean"),
    "weight": ("light", "medium", "heavy"),
    "articulation": ("crisp", "neutral", "lazy", "soft", "clipped"),
    "language": ("zh", "en"),
}


def _tags(label, gender, age, pitch, timbre, weight, articulation, language="zh"):
    return {"label": label, "gender": gender, "age": age, "pitch": pitch, "timbre": timbre,
            "weight": weight, "articulation": articulation, "language": language}


# Voices of the ZCode TTS service (the service's
# system_voices list as published 2026-11-08). Tags are inferred from the voice names only:
# listen to a sample before adopting a voice for a character. Voices without a published
# name keep their id as label; the pinyin ids (…nvsheng) are taken as Chinese female voices,
# the English names as English voices.
PRESET_VOICES: dict[str, dict[str, str]] = {
    "zixinnansheng": _tags("自信男声", "male", "young adult", "medium", "clean", "medium", "crisp"),
    "elegantgentle-female": _tags("气质温婉", "female", "young adult", "medium", "warm", "light", "soft"),
    "livelybreezy-female": _tags("活力轻快", "female", "young adult", "high", "bright", "light", "crisp"),
    "qingshunvsheng": _tags("清纯女声", "female", "young adult", "medium", "clean", "light", "soft"),
    "tianrunnvsheng": _tags("甜润女声", "female", "young adult", "high", "warm", "light", "soft"),
    "vibrant-youth": _tags("Vibrant Youth", "male", "teen", "high", "bright", "light", "crisp", "en"),
    "lively-girl": _tags("Lively Girl", "female", "teen", "high", "bright", "light", "crisp", "en"),
    "magnetic-voiced-male": _tags("Magnetic-voiced Male", "male", "young adult", "low", "warm", "medium", "neutral", "en"),
    "soft-spoken-gentleman": _tags("Soft-spoken Gentleman", "male", "middle-aged", "medium", "warm", "light", "soft", "en"),
    "Alfie": _tags("Alfie", "male", "young adult", "medium", "clean", "medium", "neutral", "en"),
    "Ethan": _tags("Ethan", "male", "young adult", "medium", "clean", "medium", "neutral", "en"),
    "Matthew": _tags("Matthew", "male", "middle-aged", "medium", "warm", "medium", "neutral", "en"),
}

_AXIS_WEIGHT = {"gender": 100, "language": 50, "age": 10, "pitch": 4, "timbre": 2, "weight": 1, "articulation": 1}
_ORDINAL = {"age": VOICE_STYLE_AXES["age"], "pitch": VOICE_STYLE_AXES["pitch"],
            "weight": VOICE_STYLE_AXES["weight"]}


def validate_voice_style(style: object) -> list[str]:
    """Return problems ([] = valid). Style is {axis: word} using VOICE_STYLE_AXES words."""
    if not isinstance(style, dict):
        return ["voice_style must be an object {gender, age, pitch, timbre, weight, articulation}"]
    problems = []
    for axis in ("gender", "age", "pitch"):
        if axis not in style:
            problems.append(f"voice_style.{axis} is required")
    for axis, word in style.items():
        if axis not in VOICE_STYLE_AXES:
            problems.append(f"voice_style.{axis!r} is not an axis {list(VOICE_STYLE_AXES)}")
        elif str(word) not in VOICE_STYLE_AXES[axis]:
            problems.append(f"voice_style.{axis}={word!r} not in {VOICE_STYLE_AXES[axis]}")
    return problems


def resolve_voice_style(style: dict, exclude: set[str] | None = None) -> tuple[str, float, list[tuple[str, float]]]:
    """Closest preset voice to a style. Gender is a hard axis (mismatch costs 100), language
    nearly so (50; Chinese unless the style asks for "en"), age/pitch/weight are ordinal
    (distance in steps), timbre/articulation exact-or-not.
    Returns (voice_id, distance, ranked[(voice, distance)])."""
    style = {"language": "zh", **style}

    def dist(tags: dict[str, str]) -> float:
        d = 0.0
        for axis, want in style.items():
            have = tags.get(axis)
            if have is None or axis not in VOICE_STYLE_AXES:
                continue
            if axis in _ORDINAL:
                steps = abs(_ORDINAL[axis].index(str(want)) - _ORDINAL[axis].index(have))\
                    if str(want) in _ORDINAL[axis] and have in _ORDINAL[axis] else 2
                d += _AXIS_WEIGHT[axis] * steps
            elif str(want) != have:
                d += _AXIS_WEIGHT[axis]
        return d
    ranked = sorted(((v, dist(t)) for v, t in PRESET_VOICES.items() if v not in (exclude or set())),
                    key=lambda x: x[1])
    return ranked[0][0], ranked[0][1], ranked


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def tts_config() -> dict:
    """Model (fixed by the service) and the default voice (``VE_TTS_VOICE`` or zixinnansheng)."""
    return {"model": MODEL, "voice": clean_env("VE_TTS_VOICE") or DEFAULT_VOICE}


def tts_status() -> dict:
    """Readiness without synthesizing: the ZCode channel of this call and the voice list."""
    from . import toolhub
    cfg = tts_config()
    state = toolhub.status()
    reasons = list(state["reasons"])
    if cfg["voice"] not in PRESET_VOICES:
        reasons.append(f"VE_TTS_VOICE={cfg['voice']!r} is not a voice of the TTS service")
    return {"available": not reasons, "reasons": reasons, "provider": PROVIDER,
            "model": cfg["model"], "voice": cfg["voice"]}


# ---------------------------------------------------------------------------
# Durable TTS request adapter
# ---------------------------------------------------------------------------

def _digest(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                    separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def _error(code: str, *, retryable: bool = False, unknown: bool = False,
           request_id: str | None = None, status_code: int | None = None,
           detail: str | None = None) -> ToolResult:
    # detail says why (e.g. the ZCode channel's reasons); the code alone cannot tell
    # "not signed in" from "this session carries no identity at all".
    return ToolResult("[ERROR] TTS: " + code + (f" — {detail}" if detail else ""), is_error=True,
                      data={"error_code": code, "retryable": retryable,
                            "completion_unknown": unknown, "request_id": request_id,
                            "status_code": status_code, "provider": PROVIDER,
                            **({"detail": detail} if detail else {})})


def _wav_duration(content: bytes) -> float:
    with wave.open(io.BytesIO(content), "rb") as audio:
        frames, rate = audio.getnframes(), audio.getframerate()
        expected = frames * audio.getnchannels() * audio.getsampwidth()
        if not rate or len(audio.readframes(frames)) != expected:
            raise ValueError("truncated_audio")
        duration = frames / rate
        if duration < 0.05:
            raise ValueError("empty_audio")
        return duration


_SENTENCE_END = re.compile(r"(?<=[。！？!?；;…])|(?<=[.](?=\s))")


def _chunks(text: str, limit: int = CHUNK_CHARS) -> list[str]:
    """Group whole sentences into chunks of at most ``limit`` characters (long sentences split at commas)."""
    pieces: list[str] = []
    for sentence in (x for x in _SENTENCE_END.split(text) if x.strip()):
        while len(sentence) > limit:
            cut = max(sentence.rfind(mark, 0, limit) for mark in "，,、 ")
            cut = cut + 1 if cut > 0 else limit
            pieces.append(sentence[:cut])
            sentence = sentence[cut:]
        if sentence.strip():
            pieces.append(sentence)
    chunks: list[str] = []
    for piece in pieces:
        if chunks and len(chunks[-1]) + len(piece) <= limit:
            chunks[-1] += piece
        else:
            chunks.append(piece)
    return [c.strip() for c in chunks if c.strip()]


class _TTSFailure(RuntimeError):
    def __init__(self, code: str, *, retryable: bool = False, unknown: bool = False, rejected: bool = False,
                 detail: str | None = None):
        super().__init__(code)
        self.code, self.retryable, self.unknown, self.rejected = code, retryable, unknown, rejected
        self.detail = detail


def _synthesize_chunk(text: str, voice: str) -> bytes:
    """One service call (new Idempotency-Key): the wav bytes, or _TTSFailure."""
    import base64
    from . import toolhub
    try:
        data, _ = toolhub.invoke_with_retries(toolhub.PATH_TTS, json_body={"text": text, "voice": voice},
                                              idempotency_key=toolhub.new_idempotency_key(),
                                              timeout_seconds=toolhub.TTS_TIMEOUT_SECONDS)
    except toolhub.ToolHubError as exc:
        if exc.detail.get("auth_error") or exc.code == 3706 or "identity" in str(exc):
            raise _TTSFailure("identity_unavailable", rejected=True, detail=str(exc)[:300]) from None
        if exc.code == 3002:
            raise _TTSFailure("rate_limited", retryable=True) from None
        if exc.code == 2007:
            # Includes responses over 4 MiB; the chunk size keeps normal speech below it.
            raise _TTSFailure("service_failure", retryable=True) from None
        if exc.code == 3703:
            raise _TTSFailure("request_failed") from None
        raise _TTSFailure("completion_unknown", retryable=exc.retry_same_key, unknown=True) from None
    output = data.get("output") if isinstance(data.get("output"), dict) else {}
    if data.get("state") != "SUCCEEDED" or not output.get("audio_base64"):
        # UNKNOWN (or a replay): a same-key replay never returns the audio; a new request may.
        raise _TTSFailure("completion_unknown", retryable=True, unknown=True)
    try:
        return base64.b64decode(output["audio_base64"], validate=True)
    except (ValueError, TypeError):
        raise _TTSFailure("invalid_audio_response") from None


def _join_wavs(parts: list[bytes]) -> bytes:
    """Concatenate wav chunks of the same format into one wav."""
    params, frames = None, []
    for part in parts:
        with wave.open(io.BytesIO(part), "rb") as audio:
            current = (audio.getnchannels(), audio.getsampwidth(), audio.getframerate())
            if params is None:
                params = current
            elif current != params:
                raise ValueError("chunk_format_mismatch")
            frames.append(audio.readframes(audio.getnframes()))
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(params[0]); out.setsampwidth(params[1]); out.setframerate(params[2])
        out.writeframes(b"".join(frames))
    return buffer.getvalue()


def _apply_speed(content: bytes, speed: float) -> bytes:
    """Tempo change without pitch change (ffmpeg atempo, 0.5..2); the service has no speed control."""
    with tempfile.TemporaryDirectory(prefix="tts-speed-") as tmp:
        source, target = Path(tmp) / "in.wav", Path(tmp) / "out.wav"
        source.write_bytes(content)
        proc = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(source),
                               "-filter:a", f"atempo={speed:g}", "-ar", str(SAMPLE_RATE), str(target)],
                              capture_output=True, text=True, timeout=600)
        if proc.returncode != 0:
            raise ValueError("speed_change_failed")
        return target.read_bytes()


def request_tts(args: dict, ctx: RunContext) -> ToolResult:
    """Synthesize once per request; restore successful audio without a service call.

    args: text, voice (or speaker), speed, instruction, output_path (.wav). The service
    takes only text and voice: speed is applied locally (tempo, pitch kept) and an
    instruction is recorded as ignored.
    """
    text = str(args.get("text") or "").strip()
    instruction = str(args.get("instruction") or "").strip()
    if not text or len(text) > MAX_TEXT_CHARS or len(instruction) > MAX_INSTRUCTION_CHARS:
        return _error("invalid_text_or_instruction_length")
    config = tts_config()
    voice = str(args.get("speaker") or args.get("voice") or config["voice"])
    if voice not in PRESET_VOICES:
        return _error("voice_not_available")
    payload = {"text": text, "voice": voice, "model": config["model"]}
    if args.get("speed") is not None:
        speed = args["speed"]
        if isinstance(speed, bool) or not isinstance(speed, (int, float)) or not math.isfinite(speed) or not 0.5 <= speed <= 2:
            return _error("speed_out_of_range")
        if float(speed) != 1.0:
            payload["speed"] = float(speed)
    request_id = _digest({"version": VERSION, "payload": payload})
    # This scope deliberately excludes execution choices and voice changes.
    # A terminal/unknown request for these words must be reconciled first.
    scope = _digest({"version": VERSION, "text": text})
    directory = ctx.work_dir / LEDGER_DIR
    output = ctx.resolve(args.get("output_path") or f"out/tts_{request_id[:16]}.wav")
    if output.suffix.lower() != ".wav":
        return _error("wav_output_required")
    record_path = directory / "requests" / request_id / "state.json"
    cached_audio = record_path.with_name("audio.wav")
    scope_path = directory / "scopes" / (scope + ".json")
    meta = {"model": payload["model"], "voice": voice}
    if instruction:
        meta["instruction_ignored"] = True
    try:
        private_directory(directory)
        scope_path.parent.mkdir(parents=True, exist_ok=True)
        if output.is_relative_to(directory.resolve()):
            return _error("output_overlaps_request_cache")
        scope_lock = scope_path.with_suffix('.lock')
        known_scope = scope_lock.exists()
        with output_locks(ctx, [output]), scope_lock.open("a") as lock:
            file_lock.flock(lock, file_lock.LOCK_EX | file_lock.LOCK_NB)
            ledger = read_object(scope_path)
            if scope_path.exists():
                if (ledger.get('version') != VERSION or not isinstance(ledger.get('requests'), list)
                        or not ledger['requests']):
                    return _error('request_ledger_invalid')
            elif known_scope:
                # Losing a scope file must not turn an existing submission into
                # a fresh request under another output path or voice.
                for previous in (directory / 'requests').glob('*/state.json'):
                    saved_scope = read_object(previous)
                    if not saved_scope or saved_scope.get('scope') == scope:
                        return _error('request_ledger_missing', unknown=True)
                for previous in (directory / 'requests').glob('*'):
                    if previous.is_dir() and not (previous / 'state.json').is_file():
                        return _error('request_ledger_missing', unknown=True)
            for prior in ledger.get("requests", []):
                # Only internal SHA identities may be resolved through the ledger.
                if not isinstance(prior, str) or len(prior) != 64 or any(c not in "0123456789abcdef" for c in prior):
                    return _error("request_ledger_invalid")
                saved = read_object(directory / "requests" / prior / "state.json")
                if (not saved or saved.get("request_id") != prior or saved.get("scope") != scope
                        or saved.get("status") == "submitting"):
                    return _error("completion_unknown", unknown=True, request_id=prior)
                if (saved.get("status") == "failed" and not saved.get("retryable")
                        and not saved.get("rejected")):
                    return _error(saved.get("error_code", "request_failed"),
                                  unknown=bool(saved.get("completion_unknown")), request_id=prior,
                                  status_code=saved.get("status_code"))
                if saved.get("status") not in ("failed", "completed"):
                    return _error("request_ledger_invalid", request_id=prior)
            saved = read_object(record_path)
            if saved and request_id not in ledger.get("requests", []):
                return _error("request_ledger_missing", request_id=request_id)
            if saved.get("status") == "completed":
                if not cached_audio.is_file() or file_digest(cached_audio) != saved.get("audio_sha256"):
                    return _error("successful_audio_missing_or_changed", request_id=request_id)
                protect_outputs([output], [record_path, scope_path, cached_audio])
                publish_files({output: cached_audio})
                return ToolResult("Reused TTS audio", artifacts=[str(output)],
                                  data={"output_path": str(output), "request_id": request_id, **meta,
                                        "provider": PROVIDER, "cache_hit": True,
                                        "duration_seconds": saved["duration_seconds"]})
            from . import toolhub
            channel = toolhub.status()
            if not channel["available"]:
                return _error("identity_unavailable", request_id=request_id,
                              detail="; ".join(channel["reasons"]))
            attempts = 0 if saved.get("rejected") else int(saved.get('attempts', 0))
            if attempts >= MAX_ATTEMPTS:
                return _error('retry_limit_reached', request_id=request_id)
            # A surviving request directory without its ledger is not a fresh take.
            if record_path.parent.exists() and not saved:
                return _error("completion_unknown", unknown=True, request_id=request_id)
            requests_for_scope = ledger.get("requests", [])
            if request_id not in requests_for_scope:
                requests_for_scope.append(request_id)
            write_object(scope_path, {"version": VERSION, "requests": requests_for_scope})
            record = {"version": VERSION, "request_id": request_id, "scope": scope,
                      "status": "submitting", "started_at": time.time(), "attempts": attempts + 1}
            write_object(record_path, record)

            def failed(code, *, retryable=False, unknown=False, status_code=None, rejected=False, detail=None):
                write_object(record_path, {**record, "status": "failed", "error_code": code,
                                          "retryable": retryable, "completion_unknown": unknown,
                                          "status_code": status_code, "rejected": rejected})
                return _error(code, retryable=retryable, unknown=unknown,
                              request_id=request_id, status_code=status_code, detail=detail)

            chunks = _chunks(text)
            try:
                parts = [_synthesize_chunk(chunk, voice) for chunk in chunks]
                content = _join_wavs(parts) if len(parts) > 1 else parts[0]
                if "speed" in payload:
                    content = _apply_speed(content, payload["speed"])
                if len(content) > MAX_AUDIO_BYTES:
                    return failed("audio_response_too_large")
                duration = _wav_duration(content)
            except _TTSFailure as exc:
                return failed(exc.code, retryable=exc.retryable, unknown=exc.unknown, rejected=exc.rejected,
                              detail=exc.detail)
            except (EOFError, wave.Error, ValueError):
                return failed("invalid_audio_response")
            # Publish the durable artifact before marking the request completed.
            publish_files({cached_audio: content})
            write_object(record_path, {**record, "status": "completed", "completed_at": time.time(),
                                      "audio_sha256": file_digest(cached_audio), "duration_seconds": duration,
                                      "chunks": len(chunks)})
            protect_outputs([output], [record_path, scope_path, cached_audio])
            publish_files({output: cached_audio})
            return ToolResult("Generated TTS audio", artifacts=[str(output)],
                              data={"output_path": str(output), "request_id": request_id, **meta,
                                    "provider": PROVIDER, "cache_hit": False, "duration_seconds": duration,
                                    "chunks": len(chunks)})
    except BlockingIOError:
        return _error("request_in_progress", retryable=True, request_id=request_id)
    except (OSError, ValueError, KeyError, TypeError):
        return _error("request_state_unavailable", request_id=request_id)


# ---------------------------------------------------------------------------
# Public tool
# ---------------------------------------------------------------------------

def _voice_card_check(output: Path, card_arg: object, ctx: RunContext) -> dict:
    """Score the synthesised line against the character's voice card.

    Always returns a verdict. When the question cannot be answered — the card file is missing,
    the scorer blew up — that is reported as `unknown` with the reason, never as silence, so a
    caller can tell "checked and fine" from "could not check".
    """
    try:
        card = ctx.resolve(str(card_arg))
    except (OSError, ValueError):
        return {"status": "unknown", "reason": "voice_card path could not be resolved"}
    if not card.is_file():
        return {"status": "unknown", "reason": f"voice_card not found: {card_arg}"}
    try:
        from .audio_identity import voice_similarity
        r = voice_similarity({"audio_a": str(output), "audio_b": str(card)}, ctx)
        sim = (r.data or {}).get("similarity")
    except Exception as exc:  # noqa: BLE001 — a scorer problem must not fail the synthesis
        return {"status": "unknown", "reason": f"{type(exc).__name__}: {str(exc)[:100]}"}
    if sim is None:
        return {"status": "unknown", "reason": str(r.text)[:120]}
    sim = round(float(sim), 3)
    status = "fail" if sim < VOICE_CARD_CHECK_FAIL else (
        "suspect" if sim < VOICE_CARD_CHECK_OK else "ok")
    return {"status": status, "similarity": sim, "voice_card": ctx.virtualize(card),
            "fail_below": VOICE_CARD_CHECK_FAIL, "ok_at": VOICE_CARD_CHECK_OK}


CREATION_VOICE_DIR = "out/creation/voice"


def _is_creation_voice(output: Path, ctx: RunContext) -> bool:
    """A line written where video creation keeps its cast's voices (cards, dialogue, vo)."""
    try:
        output.resolve().relative_to(ctx.resolve(CREATION_VOICE_DIR).resolve())
        return True
    except (ValueError, OSError):
        return False


def tts_generate(args: dict, ctx: RunContext) -> ToolResult:
    try:
        fmt = output_format(args)
        output = output_path_for(args, ctx, fmt)
        card_arg = args.get("voice_card")
        if not str(card_arg or "").strip():
            if not _is_creation_voice(output, ctx):
                # Narration for an edit, a recap or a code2video piece has no cast and no
                # card; the check is a video-creation contract, not a property of TTS.
                with output_locks(ctx, [output]):
                    return _tts_generate(dict(args), ctx, fmt, output)
            raise ValueError(
                "voice_card is required for a video-creation line: pass this character's voice card audio so the line can "
                "be scored against it (the two come from the same preset voice, so a low score "
                f"means the synthesis drifted). For a line with no character behind it — an "
                f"audition, a sound effect, narration in a one-off voice — pass "
                f"voice_card=\"{VOICE_CARD_NONE}\" to skip the check on the record.")
        skip = str(card_arg).strip().lower() == VOICE_CARD_NONE
        if skip:
            declared = _cast_voice_binding(output, ctx, args)
            if declared and str(declared.get("voice_card") or "").strip():
                raise ValueError(
                    f"voice_card=\"{VOICE_CARD_NONE}\" but this line belongs to "
                    f"{declared['cast_id']}, whose card the plan declares as "
                    f"{declared['voice_card']!r}. A named character's line is scored against "
                    "that card; pass it. \"none\" is for a line with no character behind it.")
        else:
            problems = _check_cast_binding(output, card_arg, args, ctx)
            if problems:
                raise ValueError(" ".join(problems))
        retries = args.get("voice_card_retries")
        if retries is None:
            budget = 0 if skip else VOICE_CARD_DEFAULT_RETRIES
        elif isinstance(retries, bool) or not isinstance(retries, int) \
                or not 0 <= retries <= VOICE_CARD_MAX_RETRIES:
            raise ValueError(f"voice_card_retries must be an integer in [0, {VOICE_CARD_MAX_RETRIES}]")
        else:
            budget = retries
        args = {k: v for k, v in args.items() if k not in ("voice_card", "voice_card_retries")}
        with output_locks(ctx, [output]):
            if skip:
                res = _tts_generate(dict(args), ctx, fmt, output)
                if not res.failed and isinstance(res.data, dict):
                    res.data["voice_card_check"] = {"status": "skipped",
                                                    "reason": "voice_card=none (declared cardless)"}
                return res
            attempts: list[dict] = []
            for attempt in range(budget + 1):
                res = _tts_generate(dict(args), ctx, fmt, output)
                if res.failed or not isinstance(res.data, dict):
                    return res
                check = _voice_card_check(output, card_arg, ctx)
                check["attempt"] = attempt + 1
                attempts.append(check)
                # Re-synthesising only helps when the engine actually produced a different voice;
                # "suspect" is as likely to be the scorer as the audio, so it is not worth budget.
                if check["status"] != "fail" or attempt >= budget:
                    break
            last = attempts[-1]
            res.data["voice_card_check"] = {**last, "attempts": attempts} if len(attempts) > 1 else last
            note = (f" | voice card: {last['status']}"
                    + (f" (similarity {last['similarity']})" if last.get("similarity") is not None
                       else f" ({last.get('reason')})")
                    + (f", re-synthesised {len(attempts) - 1}x" if len(attempts) > 1 else ""))
            if last["status"] == "fail":
                note += (f" — this line does not sound like {Path(str(card_arg)).name}; "
                         "check the cast's voice/voice_card binding before using it")
            return ToolResult(text=res.text + note, data=res.data, artifacts=res.artifacts)
    except (OSError, ValueError) as exc:
        return ToolResult('[ERROR] ' + str(exc), data={'param_error': True}, is_error=True)


def output_format(args: dict) -> str:
    fmt = str(args.get("format") or "").strip().lower()
    out_fmt = str(args.get("output_format") or "").strip().lower()
    if fmt and out_fmt and fmt != out_fmt:
        raise ValueError(f"output_format={out_fmt} conflicts with format={fmt}; provide only one")
    requested = out_fmt or fmt
    if not requested and args.get("output_path"):
        suffix = Path(str(args["output_path"])).suffix.lower().lstrip(".")
        requested = SUFFIX_FORMATS.get(suffix, suffix)
    requested = requested or "wav"
    if requested not in OUTPUT_FORMATS:
        raise ValueError(f"unsupported TTS output format: {requested}; expected wav, mp3, or ogg_opus")
    return requested


def output_path_for(args: dict, ctx: RunContext, fmt: str) -> Path:
    suffix = OUTPUT_FORMATS[fmt]
    if not args.get("output_path"):
        return ctx.output_dir / f"tts_{time.time_ns()}{suffix}"
    path = ctx.resolve(args["output_path"])
    current = path.suffix.lower().lstrip(".")
    if not current:
        # An output path without a suffix gets the selected format's suffix.
        return path.with_name(path.name + suffix)
    if current not in SUFFIX_FORMATS:
        allowed = ", ".join(f".{ext}" for ext in sorted(SUFFIX_FORMATS))
        raise ValueError(f"TTS output_path suffix must be one of: {allowed}")
    if SUFFIX_FORMATS[current] != fmt:
        raise ValueError(f"TTS output_path suffix .{current} conflicts with output_format={fmt}")
    return path


def coerce_retry_count(value: object) -> int:
    if value is None:
        return TTS_DEFAULT_RETRIES
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) \
            or int(value) != value:
        raise ValueError("retries must be an integer")
    if not 0 <= int(value) <= TTS_MAX_RETRIES:
        raise ValueError(f"retries must be in [0, {TTS_MAX_RETRIES}]")
    return int(value)


def sample_text(text: str) -> str:
    return text[: min(len(text), 260)]


def _tts_generate(args: dict, ctx: RunContext, fmt: str, output: Path) -> ToolResult:
    text = str(args.get("text") or "").strip()
    if not text:
        return ToolResult("[ERROR] text is required", data={"param_error": True}, is_error=True)
    sample_mode = args.get("sample_mode", False)
    if not isinstance(sample_mode, bool):
        raise ValueError("sample_mode must be a boolean")
    if sample_mode:
        text = sample_text(text)
    if len(text) > MAX_TEXT_CHARS:
        raise ValueError(f"text exceeds {MAX_TEXT_CHARS} characters; split it into several calls")
    style = str(args.get("style_instructions") or "").strip()
    if len(style) > MAX_INSTRUCTION_CHARS:
        raise ValueError(f"style_instructions exceeds {MAX_INSTRUCTION_CHARS} characters")
    speed = args.get("speed")
    if speed is not None and (isinstance(speed, bool) or not isinstance(speed, (int, float))
                              or not math.isfinite(speed) or not 0.5 <= speed <= 2):
        raise ValueError("speed must be a finite number in [0.5, 2]")
    voice = args.get("voice")
    if voice is not None and (not isinstance(voice, str) or voice not in PRESET_VOICES):
        raise ValueError("voice must be one of the TTS service voices: " + ", ".join(PRESET_VOICES))
    retries = coerce_retry_count(args.get("retries", args.get("retry_count")))
    backoff = args.get("retry_backoff_seconds", TTS_RETRY_BACKOFF_SECONDS)
    if isinstance(backoff, bool) or not isinstance(backoff, (int, float)) or not math.isfinite(backoff) or backoff < 0:
        raise ValueError("retry_backoff_seconds must be a finite number >= 0")
    from .file_contract import input_paths
    protect_outputs([output], input_paths(args, ctx))

    request = {"text": text, "voice": voice, "instruction": style, "speed": speed}
    started = time.time()
    attempts = []
    slept = 0.0
    with tempfile.TemporaryDirectory(prefix="tts-stage-", dir=_stage_parent(output)) as stage:
        staged_wav = Path(stage) / "speech.wav"
        for attempt in range(retries + 1):
            result = request_tts(dict(request, output_path=str(staged_wav)), ctx)
            if not result.failed:
                break
            attempts.append({"attempt": attempt + 1, "error": result.text,
                             "retryable": result.data.get("retryable") is True})
            if result.data.get("retryable") is not True or attempt >= retries:
                result.data["attempts"] = attempts
                return result
            delay = min(float(backoff) * (2 ** attempt), max(0.0, TTS_MAX_TOTAL_BACKOFF_SECONDS - slept))
            if delay <= 0 and backoff > 0:
                break
            time.sleep(delay)
            slept += delay
        if result.failed:
            result.data["attempts"] = attempts
            return result
        delivered = staged_wav
        if fmt != "wav":
            delivered = Path(stage) / ("speech" + OUTPUT_FORMATS[fmt])
            codec = ["-c:a", "libmp3lame", "-q:a", "2"] if fmt == "mp3" else ["-c:a", "libopus", "-b:a", "64k"]
            proc = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(staged_wav), *codec,
                                   str(delivered)], capture_output=True, text=True, timeout=600)
            if proc.returncode != 0:
                return ToolResult(f"[ERROR] TTS audio could not be encoded as {fmt}: {proc.stderr.strip()[-400:]}",
                                  is_error=True, data={"provider": PROVIDER})
        extra = {key: result.data.get(key) for key in ("model", "voice", "request_id", "cache_hit",
                                                        "instruction_ignored", "chunks") if key in result.data}
        extra.update(voice_in_catalog=extra.get("voice") in PRESET_VOICES, retry_attempts=len(attempts),
                     elapsed_seconds=round(time.time() - started, 3), output_format=fmt,
                     sample_rate=SAMPLE_RATE)
        verified = finish_tts(ctx, delivered, PROVIDER, extra)
        if verified.failed:
            return verified
        protect_outputs([output], input_paths(args, ctx))
        publish_files({output: delivered})
    verified.text = verified.text.replace(ctx.virtualize(delivered), ctx.virtualize(output))
    verified.data["output_path"] = str(output)
    verified.artifacts = [str(output)]
    return verified


def _stage_parent(output: Path) -> Path:
    output.parent.mkdir(parents=True, exist_ok=True)
    return output.parent


def finish_tts(ctx: RunContext, output_path: Path, provider: str, extra: dict) -> ToolResult:
    probe = probe_media({
        "input_path": str(output_path),
        "output_json": str(output_path.with_name(f"{output_path.stem}_media.json")),
    }, ctx)
    if probe.text.startswith("[ERROR]"):
        return ToolResult(
            text=f"[ERROR] TTS generated with {provider}, but media probe failed: {probe.text}",
            data={"provider": provider, "output_path": str(output_path), "probe_error": probe.text, **extra},
            artifacts=[str(output_path)],
        )
    if not probe.data.get('audio_streams'):
        return ToolResult('[ERROR] generated TTS media has no audio stream', is_error=True)
    duration = probe.data.get("duration_seconds")
    if not isinstance(duration, (int, float)) or not math.isfinite(float(duration)) or float(duration) <= 0:
        return ToolResult(
            text=f"[ERROR] TTS generated with {provider}, but ffprobe did not return a valid audio duration",
            data={"provider": provider, "output_path": str(output_path),
                  "audio_duration_seconds": duration, "media": probe.data, **extra},
            artifacts=[str(output_path)],
        )
    requested_format = output_path.suffix.lstrip(".").lower()
    probed_format = str(probe.data.get("format_name") or "")
    probed_names = {x.strip().lower() for x in probed_format.split(",") if x.strip()}
    expected_names = {"mp3": {"mp3"}, "wav": {"wav"}, "ogg": {"ogg"}, "opus": {"ogg"}}.get(requested_format)
    format_mismatch = bool(probed_names and expected_names and not (probed_names & expected_names))
    data = {
        "provider": provider,
        "output_path": str(output_path),
        "audio_duration_seconds": float(duration),
        "format": requested_format,
        "probed_format_name": probed_format or None,
        **extra,
    }
    if format_mismatch:
        return ToolResult(
            text=f"[ERROR] TTS generated with {provider}, but the file is '{probed_format}' while "
                 f".{requested_format} was requested: {ctx.virtualize(output_path)}",
            data={**data, "format_mismatch": True},
            artifacts=[str(output_path)],
        )
    return ToolResult(
        text=f"TTS generated with {provider}: {ctx.virtualize(output_path)}",
        data=data,
        artifacts=[str(output_path)],
    )
