"""Shared creation production support; media APIs and explicit evidence contracts."""
from __future__ import annotations

import base64
import io
import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import requests

from ve_tools import generators as gens
from ve_tools.result import ToolResult
from ve_tools.run_context import RunContext, clean_env
from ve_tools.creation_planning import (BRIDGE_DURATION_SECONDS, BRIDGE_HANDLE_SECONDS, BRIDGE_METHODS,
                                     INDOOR_MARKERS, KEYFRAMES_MAX_PER_SEQUENCE, LIGHT_MARKERS,
                                     SPEECH_CHARS_PER_SECOND,
                                     VOICE_MIN_SPEECH_SECONDS, WIND_MARKERS, approved_span, digest,
                                     file_digest, nexus_visual_plan, plan_format, shot_plan_digest, validate_plan,
                                     EPISODE_FORMAT)

# --------------------------------------------------------------------- config

# video generator 2.5 accepts 4..30s per task (30s verified against LAS on
# 2026-09-14). This is footage duration, not a minimum editorial shot length.
SHOT_MIN_SECONDS = 4.0
SHOT_MAX_SECONDS = 30.0
# One continuous take per clip: the model never executes hard cuts described
# inside a single prompt ("0-3s 远景 / 3-6s 切中景" renders as one flattened
# camera move). A narrative event may use several separately generated angles;
# reference dependencies and editorial adjacency are independent contracts.
SHOT_RECOMMENDED_MAX = 30.0
# Cut markers inside one prompt mean the agent expects an in-clip hard cut,
# which the model will silently flatten.
CUT_MARKERS = ("切到", "切至", "切回", "闪回", "镜头切换", "下一个镜头")
# SPEECH_CHARS_PER_SECOND / VOICE_MIN_SPEECH_SECONDS / LIGHT_MARKERS / WIND_MARKERS /
# Production contract; see video-creation references for rationale.
# imported above under the same names (rationale comments live there).
DIALOGUE_PADDING_SECONDS = 1.0

REF_ROLES = ("reference_image", "first_frame", "last_frame")
FRAME_ROLES = ("first_frame", "last_frame")
# 官方《素材输入建议》: 图片最多 30 张 (4K 以内), 单次总素材 50 个。10-31 前这里是 9,
# 把可用容量砍掉了三分之二 —— 多角色同场镜头放不下全部身卡 + 场景板 + 关键帧。
# 注意 prof["max_images"] 全仓库没有任何执行点, 真正的闸门只有这个常量。
MAX_REFERENCE_IMAGES = 30

# Style words that make the image model produce photoreal human faces, which
# video generator then refuses as "may contain real person".
PHOTOREAL_MARKERS = (
    "超写实", "写实", "照片级", "照片", "真人", "实拍", "photoreal", "photorealistic",
    "photo-realistic", "realistic photo", "hyperreal", "raw photo", "dslr",
)
# A negated marker is the *desired* wording ("非写实", "无照片真实感"), so it must
# not be flagged — otherwise every correct style card trips the check.
NEGATORS = "非无不去反免"
NEGATING_PREFIXES = ("non-", "not ", "no ", "avoid ")

# Aspect lock. The image generator (ZCode ToolHub, Seedream) takes only a resolution
# tier; the aspect ratio is chosen by the model from the prompt and the references.
# Every image therefore states its orientation in the prompt and is verified after
# download (output.size / the decoded file); a mismatch is flagged for the agent.
ORIENTATIONS = ("landscape", "portrait", "square", "landscape_169", "portrait_916", "auto")
# Plain row labels, not 【】 (that is video generator's subtitle syntax; the two tools share style text).
ORIENTATION_PHRASE = {
    "landscape": "画幅要求：宽幅横构图，画面宽度大于高度；不要竖构图、不要上下排列多视图。",
    "portrait": "画幅要求：竖幅构图，画面高度大于宽度；不要横构图。",
    "square": "画幅要求：正方形构图，宽与高相等。",
    "landscape_169": "画幅要求：16:9 宽幅横构图，与视频画幅一致；不要竖构图。",
    "portrait_916": "画幅要求：9:16 竖幅构图，与竖屏视频画幅一致；不要横构图。",
}
ORIENTATION_FAMILY = {"landscape_169": "landscape", "portrait_916": "portrait"}
# Resolution tiers the image generator accepts (case-insensitive); the server default is 2K.
IMAGE_SIZE_TIERS = ("1K", "1.5K", "2K")
DEFAULT_IMAGE_SIZE = "2K"
# Reference images per request (current image model limit), passed in this order as 图1、图2…
MAX_IMAGE_REFERENCES = 10
IMAGE_GENERATOR_LABEL = "image-generator"
# Multi-image conventions (index + description + how they interact; 多图输入:
# 图一/图二 指代 + 指明参考对象与保留元素). Injected when the item declares reference roles.
REF_ROLE_LINE = "图片 {n}：{role}"
KEYFRAME_PRESERVE_NOTE = ("人物的面部、发型、服装严格以对应参考图为准，不复述、不改动；不新增参考图之外的人物；"
                          "画面中不出现任何文字、字幕、水印。")

# Agent-authored JSON occasionally carries literal \r/\n in id/name/path fields
# Production contract; see video-creation references for rationale.
# lookup, sync and stats. Strip control characters at every tool entry.
_CTRL_RE = re.compile(r"[\x00-\x1f]+")


def _clean_name(value: Any) -> str:
    return _CTRL_RE.sub("", str(value if value is not None else "")).strip()


def _size_tier(requested: Any) -> str:
    """Canonical resolution tier ('1K' / '1.5K' / '2K'); anything else is an input error."""
    raw = _CTRL_RE.sub("", str(requested or "")).strip().upper()
    if not raw:
        return DEFAULT_IMAGE_SIZE
    for tier in IMAGE_SIZE_TIERS:
        if raw == tier.upper():
            return tier
    raise CreationError(f"size must be one of {', '.join(IMAGE_SIZE_TIERS)} (resolution tier; state the "
                        f"aspect ratio with orientation) — got {requested!r}")


# Image suffixes image_generate publishes, and the container each one means. The saved bytes are
# encoded to match the suffix (the provider returns PNG whatever name the caller picked).
IMAGE_SUFFIX_FORMAT = {".png": "PNG", ".jpg": "JPEG", ".jpeg": "JPEG", ".webp": "WEBP"}


def planned_image_name(item: dict, default_background: str = "auto") -> str:
    """The file name image_generate will publish for one item. Shared by the generator and
    the public entry that binds output paths to request signatures: both must agree, or the
    entry looks up a path the generator never produced (KeyError after a generated image).

    - An output_name without an image suffix (.png/.jpg/.jpeg/.webp) gets ".png" appended; a dot
      elsewhere in the name ("hero.v2") is part of the stem, not a suffix to replace.
    - Transparency needs an alpha-capable container, so a transparent .jpg/.jpeg becomes .png.
    """
    kind = str(item.get("kind") or "keyframe")
    name = _clean_name(item.get("output_name")) or f"{kind}_{item.get('id')}.png"
    background = str(item.get("background") or default_background or "auto").strip().lower()
    suffix = Path(name).suffix
    if suffix.lower() not in IMAGE_SUFFIX_FORMAT:
        return name + ".png"
    if background == "transparent" and suffix.lower() not in (".png", ".webp"):
        return name[: -len(suffix)] + ".png"
    return name


def legacy_image_name(item: dict, default_background: str = "auto") -> str:
    """The name the generator published before 2026-11-05 (an output_name without a suffix was
    kept bare). Used only by the entry to adopt an already generated file under its new name."""
    kind = str(item.get("kind") or "keyframe")
    name = _clean_name(item.get("output_name")) or f"{kind}_{item.get('id')}.png"
    background = str(item.get("background") or default_background or "auto").strip().lower()
    if background == "transparent" and not name.lower().endswith((".png", ".webp")):
        name = re.sub(r"\.[^.]+$", "", name) + ".png"
    return name


def encode_for_suffix(raw: bytes, suffix: str) -> bytes:
    """Return image bytes in the container `suffix` names (PNG for anything unknown). Bytes that
    are already in that container come back unchanged; JPEG has no alpha, so transparent pixels
    are flattened onto white."""
    from PIL import Image

    want = IMAGE_SUFFIX_FORMAT.get(suffix.lower(), "PNG")
    with Image.open(io.BytesIO(raw)) as im:
        im.load()
        if (im.format or "").upper() == want:
            return raw
        img = im
        if want == "JPEG" and img.mode not in ("RGB", "L"):
            rgba = img.convert("RGBA")
            flat = Image.new("RGB", rgba.size, (255, 255, 255))
            flat.paste(rgba, mask=rgba.split()[-1])
            img = flat
        buf = io.BytesIO()
        if want == "JPEG":
            img.save(buf, format="JPEG", quality=95)
        elif want == "WEBP":
            img.save(buf, format="WEBP", lossless=True)
        else:
            img.save(buf, format="PNG")
        return buf.getvalue()


def _orientation_phrase_enabled() -> bool:
    """The canvas line (ORIENTATION_PHRASE) is a video-creation convention for keyframes and
    plates. code2video sheets lay several views out on purpose (a 2x2 four-view sheet contradicts
    "不要上下排列多视图"), so the code2video task injects VE_IMAGE_ORIENTATION_PHRASE=0 to drop it.
    The requested size is still pinned either way."""
    return os.environ.get("VE_IMAGE_ORIENTATION_PHRASE", "1").strip() != "0"


def _image_seed() -> tuple[Path, dict] | None:
    """Debug mode: (seed root, kind -> seeded image path) when the pipeline froze image generation calls
    (VE_PAID_ASSETS=frozen, VE_ASSET_SEED=<mount>, 'images' in VE_ASSET_SEED_STAGES); else None.
    The seed's manifest.json['seed']['images'] maps an item kind to the archived sheet."""
    if (clean_env("VE_PAID_ASSETS") or "").strip().lower() != "frozen":
        return None
    root = clean_env("VE_ASSET_SEED")
    stages = {s.strip() for s in (clean_env("VE_ASSET_SEED_STAGES") or "").split(",") if s.strip()}
    if not root or "images" not in stages:
        return None
    try:
        manifest = json.loads((Path(root) / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        manifest = {}
    return Path(root), dict(((manifest.get("seed") or {}).get("images")) or {})


def _orientation_of(path: Path) -> str | None:
    """Classify a saved image as landscape/portrait/square, or None if unreadable."""
    try:
        from PIL import Image

        with Image.open(path) as im:
            w, h = im.size
    except Exception:
        return None
    if w > h * 1.05:
        return "landscape"
    if h > w * 1.05:
        return "portrait"
    return "square"


def photoreal_hits(style: str) -> list[str]:
    """Photoreal markers in `style` that are not negated."""
    from .creation_style_policy import STYLE_LABEL
    style = style.replace(STYLE_LABEL, "风格化人物")
    lowered = style.lower()
    hits: list[str] = []
    for marker in PHOTOREAL_MARKERS:
        needle = marker.lower()
        start = 0
        while True:
            idx = lowered.find(needle, start)
            if idx == -1:
                break
            prev_char = style[idx - 1] if idx > 0 else ""
            before = lowered[max(0, idx - 6):idx]
            # `prev_char and ...` matters: "" is a substring of every string, so
            # a marker at index 0 would otherwise read as negated and never flag.
            negated = bool(prev_char) and prev_char in NEGATORS or any(
                before.endswith(p) for p in NEGATING_PREFIXES
            )
            if not negated:
                hits.append(marker)
                break
            start = idx + len(needle)
    # Drop shorter markers already covered by a longer overlapping one.
    return [h for h in hits if not any(h != o and h in o for o in hits)]


# ------------------------------------------------------- image generator (ToolHub)
IMAGE_MAX_SUBMITS = 3            # UNKNOWN: new Idempotency-Key, at most 3 submissions per image
IMAGE_RESUBMIT_DELAY_SECONDS = 4.0
IMAGE_MAX_CALLING_RETRIES = 4    # CALLING: the same key is still in flight; retry it later
IMAGE_CALLING_BACKOFF_SECONDS = 5.0
IMAGE_MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024


def _reference_urls(paths: list[Path], cache: dict, lock: threading.Lock) -> list[str]:
    """Upload local reference images once per batch; return their https URLs in order.

    The upload endpoint takes png/jpeg/webp up to 10 MiB, so anything else is
    re-encoded to JPEG first. Identical files share one upload.
    """
    from . import toolhub
    urls = []
    for path in paths:
        digest = file_digest(path)
        with lock:
            cached = cache.get(digest)
        if cached:
            urls.append(cached)
            continue
        source = path
        staged = None
        if path.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp") or path.stat().st_size > toolhub.MAX_UPLOAD_BYTES:
            import tempfile
            from PIL import Image
            handle, name = tempfile.mkstemp(prefix="ref-", suffix=".jpg", dir=str(path.parent))
            os.close(handle)
            staged = Path(name)
            with Image.open(path) as im:
                im = im.convert("RGB")
                for quality in (92, 85, 75):
                    im.save(staged, format="JPEG", quality=quality)
                    if staged.stat().st_size <= toolhub.MAX_UPLOAD_BYTES:
                        break
            source = staged
        try:
            url, _ = toolhub.upload_file(source)
        finally:
            if staged is not None:
                staged.unlink(missing_ok=True)
        with lock:
            cache[digest] = url
        urls.append(url)
    return urls


def _seedream_image(prompt: str, size: str, ref_urls: list[str]) -> tuple[bytes, dict]:
    """One image from the ToolHub image generator; returns (image bytes, provenance).

    UNKNOWN (and a replay without output) means no image can be recovered for that
    key: submit again with a new key, a few seconds apart, at most IMAGE_MAX_SUBMITS
    times. CALLING means the same key is still in flight: retry that key later.
    Raises toolhub.ToolHubError on a final failure.
    """
    from . import toolhub
    body: dict[str, Any] = {"query": prompt, "size": size}
    if ref_urls:
        body["image"] = list(ref_urls)
    last_state = None
    attempts: list[dict] = []   # per submission: state, invocation_id, logid (what ToolHub needs to trace it)
    for submit in range(IMAGE_MAX_SUBMITS):
        if submit:
            time.sleep(IMAGE_RESUBMIT_DELAY_SECONDS)
        key = toolhub.new_idempotency_key()
        transient: list[str] = []   # same-key retries inside this submission and why
        for calling in range(IMAGE_MAX_CALLING_RETRIES + 1):
            for retry in range(3):
                started = time.monotonic()
                try:
                    data, meta = toolhub.invoke(toolhub.PATH_IMAGE, json_body=body, idempotency_key=key,
                                                timeout_seconds=toolhub.IMAGE_TIMEOUT_SECONDS)
                    break
                except toolhub.ToolHubError as exc:
                    if not exc.retry_same_key or retry == 2:
                        raise
                    # the elapsed time tells which hop cut the call (a fixed cutoff = a gateway timeout)
                    transient.append(f"{exc}"[:260] + f" (http {exc.detail.get('http_status')}, "
                                     f"code {exc.detail.get('code')}, logid {exc.detail.get('logid')}, "
                                     f"after {time.monotonic() - started:.1f}s)")
                    time.sleep(5.0 * (2 ** retry))
            last_state = data.get("state")
            if last_state != "CALLING":
                break
            time.sleep(IMAGE_CALLING_BACKOFF_SECONDS * (calling + 1))
        output = data.get("output") if isinstance(data.get("output"), dict) else {}
        attempts.append({"state": last_state, "invocation_id": data.get("invocation_id"),
                         "logid": meta.get("logid"), "replayed": bool(data.get("replayed")),
                         "output_keys": sorted(output), "same_key_retries": transient})
        url = output.get("image_url")
        if last_state == "SUCCEEDED" and isinstance(url, str) and url:
            import tempfile
            with tempfile.TemporaryDirectory(prefix="image-dl-") as tmp:
                raw = toolhub.download(url, Path(tmp) / "image", max_bytes=IMAGE_MAX_DOWNLOAD_BYTES).read_bytes()
            provenance = {"invocation_id": data.get("invocation_id"), "logid": meta.get("logid"),
                          "submissions": submit + 1}
            if output.get("size"):
                provenance["size_actual"] = output["size"]
            return raw, provenance
    raise toolhub.ToolHubError(
        f"the image generator did not return an image after {IMAGE_MAX_SUBMITS} submissions "
        f"(last state {last_state!r}; per submission: "
        + "; ".join(f"{a.get('invocation_id')} state={a.get('state')} replayed={a.get('replayed')} "
                    f"output_keys={a.get('output_keys')} same_key_retries={a.get('same_key_retries') or 'none'}"
                    for a in attempts) + ")",
        {"recoverable": True, "state": last_state, "attempts": attempts})


def _video_cfg() -> tuple[str, None, str]:
    """(endpoint label, None, model label) of the active generator profile (generators.py)."""
    prof = gens.profile()
    return gens.ENDPOINT_LABEL, None, prof["model"]


def _style_preset(explicit: str | None) -> str:
    if explicit and explicit.strip():
        return explicit.strip()
    return (clean_env("VE_CREATION_STYLE_PRESET") or "").strip()


class CreationError(RuntimeError):
    """Deterministic configuration/input failure — not worth retrying."""


class Blocked(RuntimeError):
    """Provider refused the request on content grounds. The agent must restate."""


# ------------------------------------------------------------------ http glue
# Standard HTTP(S)_PROXY / NO_PROXY routing; endpoints never inherit credentials.
_DIRECT = requests.Session()


def _is_content_block(text: str) -> bool:
    lowered = text.lower()
    return any(
        marker in lowered
        for marker in (
            "moderation_blocked", "safety system", "safety_violations",
            "may contain real person", "sensitive", "copyright restri",
        )
    )


# The video generator's copyright filter judges the OUTPUT: a take whose characters look like an
# existing game/anime model is refused after it renders, and the take still counts. Re-submitting
# the same references fails the same way (upd-short-361, twice in two runs), so the failure
# carries the one change that has worked.
COPYRIGHT_HINT = ("copyright filter matched an existing IP's look: do not retry these references. Redraw the "
                  "character cards with image_generate from a text description only (no official art or "
                  "crops of it as references), keeping name, palette and costume motifs, then regenerate")


def _failure_hint(message: str) -> str | None:
    return COPYRIGHT_HINT if "copyright" in str(message).lower() else None


# --------------------------------------------------------------- shotlist io
def _load_json_arg(args: dict, inline_key: str, path_key: str, ctx: RunContext) -> Any:
    if args.get(inline_key) is not None:
        return args[inline_key]
    raw_path = args.get(path_key)
    if not raw_path:
        raise CreationError(f"provide either {inline_key} or {path_key}")
    path = ctx.resolve(raw_path)
    if not path.is_file():
        raise CreationError(f"{path_key} not found: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        raise CreationError(f"cannot read {path_key} {path}: {exc}") from exc


def _num(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    if out != out or out in (float("inf"), float("-inf")):
        return None
    return out


def _dialogue_seconds(shot: dict) -> float:
    """Seconds a shot needs to deliver its spoken lines IN the clip.

    Narration is never counted: v1/v2 ban it outright, and v3 inner monologue is
    a TTS overlay on a silent performance, not in-clip speech.
    """
    chars = 0
    for line in shot.get("dialogue") or []:
        if isinstance(line, dict):
            chars += len(str(line.get("line") or ""))
    if chars == 0:
        return 0.0
    return chars / SPEECH_CHARS_PER_SECOND + DIALOGUE_PADDING_SECONDS


# =========================================================== 1. validate
def validate_creation_plan(args: dict, ctx: RunContext) -> ToolResult:
    """Gate the agent-authored shotlist before any generation call."""
    data = _load_json_arg(args, "shotlist", "shotlist_path", ctx)
    if not isinstance(data, dict):
        raise CreationError("shotlist must be a JSON object")
    effective = nexus_visual_plan(data)
    promoted_nexus = effective is not data
    data = effective
    from .creation_style_policy import resolve_human_style, delivery_fields
    effective, _, _ = resolve_human_style(data)
    resolved_style = effective != data
    data = effective

    target_total = _num(args.get("target_total_seconds"))
    tolerance = _num(args.get("tolerance")) or 0.2
    shot_max = _num(args.get("shot_max_seconds")) or SHOT_RECOMMENDED_MAX
    require_images = bool(args.get("require_reference_images", False))
    serial = str(data.get("schema_version")) in ("3", "4")
    v4 = str(data.get("schema_version")) == "4"  # sequence-based
    # 1012 片型 (creation_planning.plan_format): 单集规矩只管 episode, 剧情片规矩只管 drama/film/episode
    fmt = plan_format(data)
    episode_fmt = fmt == EPISODE_FORMAT
    multi_view_gen = bool(gens.plan_profile(data).get("multi_view_cards"))

    errors: list[str] = []
    warnings: list[str] = []
    from .creation_screenplay import compile_plan_prompts
    compiled = compile_plan_prompts(data)
    if (compiled or promoted_nexus or resolved_style) and args.get("shotlist_path"):
        # blocks are the source; the stored plan carries the compiled prompts so every later
        # reader (generation, review, assembly) sees the same request
        plan_path = ctx.resolve(args["shotlist_path"])
        plan_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    plan_errors, plan_warnings, screen_total = validate_plan(data, ctx)
    errors.extend(plan_errors)
    warnings.extend(plan_warnings)
    # ---- v4: sequence-based validation (multi-shot) ----
    if v4:
        cast_names_v4 = {str(c.get("name")): c for c in data.get("cast", []) if isinstance(c, dict) and c.get("name")}
        narration_count = 0
        for i, seq in enumerate(data.get("sequences", [])):
            if not isinstance(seq, dict):
                continue
            where = f"sequences[{i}]"
            # dialogue line length
            for j, line in enumerate(seq.get("dialogue") or []):
                if isinstance(line, dict):
                    # Production contract; see video-creation references for rationale.
                    #  0.7 chars/s vs 4.1 in real short drama; the binding limits are the 30s audio cap
                    #  at generation and the per-speaker VOICE_MIN_SPEECH_SECONDS floor in validate_plan)
                    speaker = str(line.get("speaker") or "").strip()
                    if speaker and speaker not in cast_names_v4:
                        errors.append(f"{where}.dialogue[{j}].speaker={speaker!r} has no cast entry — dialogue is "
                                      "spoken on screen; an off-screen voice (narrator, interviewer, announcer) "
                                      "goes in the unit's voiceover list instead and needs no cast entry")
            # narration
            narr = seq.get("narration")
            if isinstance(narr, dict) and str(narr.get("line") or "").strip():
                narration_count += 1
                speaker_n = str(narr.get("speaker") or "").strip()
                if speaker_n and speaker_n not in cast_names_v4:
                    errors.append(f"{where}.narration.speaker has no cast entry")
                if len(str(narr.get("line") or "")) > 30:
                    warnings.append(f"{where}.narration.line >30 chars; keep inner lines concise")
            # identity gate data (actual enforcement in creation_takes)
        # report
        report = {
            "ok": not errors,
            "schema_version": str(data.get("schema_version")),
            "episode": data.get("episode"),
            "n_sequences": len(data.get("sequences", [])),
            "n_cast": len(data.get("cast", [])),
            "n_scenes": len(data.get("scenes", [])),
            "n_narration": narration_count,
            "plan_sha256": digest(data),
            "compiled_prompts": sorted(compiled),
            "shot_plan_sha256": {str(u.get("sequence_id")): shot_plan_digest(data, u, ctx) for u in data.get("sequences", []) if isinstance(u, dict)},
            "generator": gens.plan_profile(data)["name"],
            "errors": errors,
            "warnings": warnings,
        }
        out_json = args.get("output_json") or "out/creation/shotlist_validation.json"
        report.update(delivery_fields(data))
        _write_json(ctx, out_json, report)
        head = "PASS" if not errors else f"FAIL ({len(errors)} error(s))"
        return ToolResult(text=f"[{head}] {gens.summary_line(gens.plan_profile(data))}\n"
                               f"v4 sequence plan: {report['n_sequences']} sequences, "
                               f"{narration_count} narration entries. "
                               f"{'; '.join(errors[:3]) if errors else 'All checks passed.'}",
                          data=report, artifacts=[ctx.resolve(out_json)])

    # ---- v2/v3: shot-based validation (existing) ----

    cast = data.get("cast") or []
    scenes = data.get("scenes") or []
    props = data.get("props") or []
    shots = data.get("shots") or []

    if not isinstance(shots, list) or not shots:
        raise CreationError("shotlist.shots must be a non-empty array")

    cast_by_id = {c.get("id"): c for c in cast if isinstance(c, dict) and c.get("id")}
    cast_names = {str(c.get("name")): c for c in cast if isinstance(c, dict) and c.get("name")}
    scene_ids = {s.get("id") for s in scenes if isinstance(s, dict)}
    prop_ids = {p.get("id") for p in props if isinstance(p, dict)}

    style = str(data.get("style_preset") or "")
    hit = photoreal_hits(style)
    if hit:
        # Overridable: a cast with no human-looking characters is genuinely safe
        # photoreal, and the tool cannot tell who is human.
        message = (
            f"style_preset contains photoreal marker(s) {hit}: video generator refuses reference "
            "images that may show a real human face, which rejects most shots with human "
            "characters. Use an explicitly non-photoreal style (工笔重彩/手绘/动画), or pass "
            "allow_photoreal_style=true if no character in this cast looks human."
        )
        warnings.append(message.replace("allow_photoreal_style=true", "a provider-compatible reference treatment"))

    # cast state library: each entry may declare evolving states (受伤/换装/黑化)
    # with their own reference cards, so later shots can anchor to the current
    # look instead of the opening-scene card.
    cast_state_ids: dict[str, set[str]] = {}
    for c in cast:
        if not isinstance(c, dict) or not c.get("id"):
            continue
        state_ids: set[str] = set()
        for k, st in enumerate(c.get("states") or []):
            sid_ = _clean_name(st.get("id")) if isinstance(st, dict) else ""
            if not sid_:
                errors.append(f"cast {c.get('name')!r}.states[{k}] needs an id")
                continue
            if sid_ in state_ids:
                errors.append(f"cast {c.get('name')!r} has duplicate state id {sid_!r}")
            state_ids.add(sid_)
        cast_state_ids[str(c.get("id"))] = state_ids

    # Cast library fields (v7). Each is a defect we shipped without it:
    #   kind      — human|creature|object; creatures need physique, humans need a face-safe card
    #   epithet   — <=40-char visual phrase inlined after every @mention (text redundancy
    #               that survives card pruning; v6 lost cards on 4 shots and drifted)
    #   physique  — numeric size so scale is stated, not adjectival ("山丘般" gave a dragon
    #               that swung between 10x and 40x the rider)
    #   voice_style — casting intent on a controlled vocabulary; `voice` (a TTS preset
    #               voice id) is resolved from it against the preset catalog when absent,
    #               and checked when present
    resolved_voices: dict[str, str] = {}
    from .tts import PRESET_VOICES
    for c in cast:
        if not isinstance(c, dict) or not c.get("id"):
            continue
        cname = str(c.get("name") or c.get("id"))
        kind = str(c.get("kind") or "").strip().lower()
        if kind not in ("human", "creature", "object"):
            errors.append(f"cast {cname!r}.kind must be human|creature|object (drives physique/"
                          "voice/face-safety checks)")
        ep = str(c.get("epithet") or "").strip()
        if not ep:
            errors.append(f"cast {cname!r}.epithet is required: a <=40-char visible-appearance "
                          "phrase (hair/face marks/costume/colour), no name, no personality — it is "
                          "inlined after every @mention in video prompts")
        elif len(ep) > 40:
            errors.append(f"cast {cname!r}.epithet is {len(ep)} chars; keep it <=40 so it can be "
                          "repeated at every mention")
        ph = c.get("physique")
        if kind in ("creature", "human"):
            if not isinstance(ph, dict) or not any(
                    isinstance(ph.get(k), (int, float)) and ph.get(k) > 0
                    for k in ("height_m", "length_m", "body_length_m")):
                msg = (f"cast {cname!r}.physique needs a numeric size (height_m for humans; "
                       "length_m/height_m/wingspan_m/weight_kg for creatures) — proportions between "
                       "cast in the same frame are derived from it and stated in every prompt")
                (errors if kind == "creature" else warnings).append(msg)
        vs = c.get("voice_style")
        if vs is not None:
            try:
                from ve_tools.tts import resolve_voice_style, validate_voice_style
                probs = validate_voice_style(vs)
                if probs:
                    errors += [f"cast {cname!r}.{x}" for x in probs]
                else:
                    best, dist, ranked = resolve_voice_style(vs)
                    resolved_voices[cname] = best
                    cur = str(c.get("voice") or "").strip()
                    if not cur:
                        warnings.append(f"cast {cname!r}: voice_style resolves to {best} "
                                        f"(distance {dist}); set cast.voice={best}")
                    elif cur != best and dist + 4 < dict(ranked).get(cur, 999):
                        warnings.append(f"cast {cname!r}.voice={cur} is far from its voice_style "
                                        f"(closest preset voice: {best}); re-check the casting")
            except Exception as exc:  # noqa: BLE001
                warnings.append(f"voice_style check unavailable: {exc}")
        if c.get("voice") and str(c["voice"]).strip() not in PRESET_VOICES:
            warnings.append(f"cast {cname!r}.voice={c['voice']!r} is not a voice of the TTS service; "
                            f"tts_generate only synthesizes with: {', '.join(PRESET_VOICES)}")
        if c.get("voice") and kind == "creature":
            warnings.append(f"cast {cname!r} is a creature with a voice id — creatures are not "
                            "voice-bound unless they speak")

    # Relations library: 谁骑谁/谁属于谁 must be explicit or the model free-pairs
    # riders and dragons in multi-creature shots (observed live: rider-dragon
    # swap). Relations are dynamic — update them when the story changes them.
    relations: dict[str, list[tuple[str, str]]] = {}
    all_cast_ids = {str(c.get("id")) for c in cast if isinstance(c, dict) and c.get("id")}
    for c in cast:
        if not isinstance(c, dict):
            continue
        for k, rel in enumerate(c.get("relations") or []):
            if not isinstance(rel, dict) or not rel.get("type") or not rel.get("target"):
                errors.append(f"cast {c.get('name')!r}.relations[{k}] needs type and target")
                continue
            tgt = str(rel["target"])
            if tgt not in all_cast_ids:
                errors.append(
                    f"cast {c.get('name')!r}.relations[{k}].target={tgt!r} is not a cast id"
                )
            relations.setdefault(str(c.get("id")), []).append((str(rel["type"]), tgt))

    # cast
    speaking: dict[str, int] = {}
    seen_ids: set[str] = set()
    shots_by_id: dict[str, dict] = {}
    total = 0.0
    dialogue_chars = 0
    narration_chars = 0
    narration_shots = 0

    for idx, shot in enumerate(shots):
        where = f"shots[{idx}]"
        if not isinstance(shot, dict):
            errors.append(f"{where} is not an object")
            continue
        shot_id = shot.get("shot_id")
        if not shot_id:
            errors.append(f"{where}.shot_id is required")
        elif shot_id in seen_ids:
            errors.append(f"{where}.shot_id duplicates an earlier shot: {shot_id}")
        else:
            seen_ids.add(str(shot_id))
            shots_by_id[str(shot_id)] = shot

        dur = _num(shot.get("duration"))
        if dur is None:
            errors.append(f"{where}.duration must be a finite number")
        else:
            total += dur
            if dur < SHOT_MIN_SECONDS:
                errors.append(
                    f"{where}.duration={dur} is below the video generator minimum "
                    f"{SHOT_MIN_SECONDS}s; generate extra footage and use screen_duration for the shorter edit."
                )
            elif dur > gens.plan_profile(data if isinstance(data, dict) else None)["max_seconds"]:
                errors.append(
                    f"{where}.duration={dur} exceeds the generator's per-task maximum "
                    f"{gens.plan_profile(data if isinstance(data, dict) else None)['max_seconds']}s ({gens.plan_profile(data if isinstance(data, dict) else None)['name']}). Plan separate shots; "
                    "chain only when the intended camera take actually continues."
                )
            elif dur > shot_max:
                warnings.append(
                    f"{where}.duration={dur} exceeds the recommended sub-shot ceiling "
                    f"{shot_max}s. One sub-shot per clip keeps cuts real; long takes get "
                    "flattened into a single continuous camera move."
                )

        if not str(shot.get("video_prompt") or "").strip():
            errors.append(f"{where}.video_prompt is required")
        if not str(shot.get("reason") or "").strip():
            errors.append(
                f"{where}.reason is required (the timeline contract needs an editorial reason)"
            )

        sid = shot.get("scene_id")
        if sid and sid not in scene_ids:
            errors.append(f"{where}.scene_id={sid!r} is not defined in shotlist.scenes")
        for cid in shot.get("character_ids") or []:
            if cid not in cast_by_id:
                errors.append(f"{where}.character_ids has unknown id {cid!r}")
        for pid in shot.get("prop_ids") or []:
            if pid not in prop_ids:
                errors.append(f"{where}.prop_ids has unknown id {pid!r}")

        # In-clip cut markers: the model renders one continuous camera move per
        # task and silently flattens any cut described inside the prompt.
        vp = str(shot.get("video_prompt") or "")
        found_markers = [m for m in CUT_MARKERS if m in vp]
        if found_markers:
            errors.append(
                f"{where}.video_prompt contains in-clip cut marker(s) {found_markers}: the "
                "video model cannot hard-cut inside one clip. Make the cut a shot boundary, "
                "or keep the take continuous (a long take may chain via continues_from)."
            )

        # Long-take chaining: this shot continues the previous segment of one
        # continuous event; generation seeds it with that clip's last frame.
        cont = _clean_name(shot.get("continues_from"))
        if cont:
            if cont == str(shot_id):
                errors.append(f"{where}.continues_from must not reference the shot itself")
            elif cont not in shots_by_id:
                errors.append(
                    f"{where}.continues_from={cont!r} must reference an *earlier* shot in the "
                    "list — segments of one take are generated in order."
                )
            else:
                prev = shots_by_id[cont]
                if prev.get("scene_id") != shot.get("scene_id"):
                    warnings.append(
                        f"{where} continues {cont} but changes scene_id — a chained segment "
                        "is the same continuous event; a new scene usually means a real cut."
                    )

        # v12: an inherited world does not inherit its light or its wind. Any shot that
        # names where its world comes from must write both into the prompt itself.
        # (Parked by default since v13 — fires only on world-referenced shots, which
        # the v9 default does not create.)
        if REQUIRE_LIGHT_WIND and any(
                shot.get(k) for k in ("continues_from", "reference_from", "reference_take_id")):
            missing = []
            if not any(m in vp for m in LIGHT_MARKERS):
                missing.append("光位(太阳/月/火光的方位与方向)")
            if not any(m in vp for m in WIND_MARKERS) and not any(m in vp for m in INDOOR_MARKERS):
                missing.append("风向(室外镜头必写，无风也要写明)")
            if missing:
                warnings.append(
                    f"{where}.video_prompt inherits a world reference but states no "
                    f"{' 与 '.join(missing)} — the reference video does NOT carry them "
                    "(2026-09-21 controlled experiment: the key light flipped 180° and the "
                    "cloak blew the other way). Write them into this prompt."
                )

        # Rider-mount pairing: when a rider and their bonded creature are both
        # in frame, the prompt must state the pairing or the model free-pairs.
        bound = set(shot.get("character_ids") or [])
        vp_text = str(shot.get("video_prompt") or "")
        for cid in bound:
            for rtype, tgt in relations.get(cid, []):
                if rtype in ("rider_of", "骑乘", "bonded_to") and tgt in bound:
                    rname = str(cast_by_id.get(cid, {}).get("name") or cid)
                    tname = str(cast_by_id.get(tgt, {}).get("name") or tgt)
                    if rname in vp_text and tname in vp_text:
                        seg = vp_text[max(0, vp_text.find(rname) - 12):
                                      vp_text.find(rname) + len(rname) + 20]
                        if not any(w in seg or w in vp_text[max(0, vp_text.find(tname) - 12):
                                                            vp_text.find(tname) + len(tname) + 20]
                                   for w in ("骑", "驮", "背上", "鞍")):
                            warnings.append(
                                f"{where}: {rname}×{tname} 同框但提示词未写明骑乘绑定"
                                f"(如「@{rname}(骑在@{tname}背上)」)——双龙同框时模型会自由配对。"
                            )
        # Feasibility: a rider written onto a mount that is NOT their bonded one (v6
        # screenplay had the old general leap from his dragon onto the enemy's for a
        # duel; the model then swapped riders for the rest of the act). Error unless
        # the shot declares relation_override with the story reason.
        mounts_in_frame = {cid for cid in bound
                           if str(cast_by_id.get(cid, {}).get("kind") or "") == "creature"}
        for cid in bound:
            own = {tgt for rtype, tgt in relations.get(cid, [])
                   if rtype in ("rider_of", "骑乘", "bonded_to")}
            if not own:
                continue
            rname = str(cast_by_id.get(cid, {}).get("name") or cid)
            for mid in mounts_in_frame - own:
                mname = str(cast_by_id.get(mid, {}).get("name") or mid)
                if re.search(rf"{re.escape(rname)}[^。；]{{0,40}}(骑在|跃上|落在|跳上|踏上|爬上|坐在)[^。；]{{0,8}}@?{re.escape(mname)}",
                             vp_text) or re.search(
                        rf"@?{re.escape(mname)}[^。；]{{0,10}}(背上|颈背)[^。；]{{0,8}}{re.escape(rname)}", vp_text):
                    if str(shot.get("relation_override") or "").strip():
                        warnings.append(f"{where}: {rname} rides {mname} (not their mount) — "
                                        f"allowed by relation_override: {shot.get('relation_override')}")
                    else:
                        errors.append(
                            f"{where}: {rname} is written onto {mname}, but their relation binds "
                            f"them to another mount. Either fix the prompt or set "
                            f"shot.relation_override='<story reason>' (and update cast.relations "
                            "when the story permanently changes who rides what).")

        # Character state mapping: which state card anchors each character here.
        states_map = shot.get("cast_states")
        if states_map is not None:
            if not isinstance(states_map, dict):
                errors.append(f"{where}.cast_states must map character_id -> state_id")
            else:
                for cid, st_id in states_map.items():
                    if cid not in cast_by_id:
                        errors.append(f"{where}.cast_states has unknown character id {cid!r}")
                    elif _clean_name(st_id) not in cast_state_ids.get(str(cid), set()):
                        errors.append(
                            f"{where}.cast_states[{cid!r}]={st_id!r} is not a declared state "
                            "of that cast member — declare it in cast[].states with its own "
                            "reference card first."
                        )
                    elif shot.get("character_ids") and cid not in (shot.get("character_ids") or []):
                        warnings.append(
                            f"{where}.cast_states covers {cid!r} which is not in character_ids"
                        )

        # dialogue: structured only, and every speaker must be castable
        for j, line in enumerate(shot.get("dialogue") or []):
            if not isinstance(line, dict):
                errors.append(f"{where}.dialogue[{j}] must be an object with speaker/line")
                continue
            speaker = str(line.get("speaker") or "").strip()
            text = str(line.get("line") or "").strip()
            dialogue_chars += len(text)
            if not speaker:
                errors.append(f"{where}.dialogue[{j}].speaker is required")
            if not text:
                errors.append(f"{where}.dialogue[{j}].line is required")
            if serial and episode_fmt and len(text) > 15:
                errors.append(
                    f"{where}.dialogue[{j}].line is {len(text)} chars; episode dialogue "
                    "keeps each line within 15 — long lines are inner monologue material"
                )
            if speaker:
                speaking[speaker] = speaking.get(speaker, 0) + 1
                if speaker not in cast_names:
                    errors.append(
                        f"{where}.dialogue[{j}].speaker={speaker!r} has no cast entry. "
                        "Every on-screen speaking role needs a cast member (and a reference image), "
                        "otherwise its look is uncontrolled and drifts between shots. An off-screen "
                        "voice (narrator, interviewer, announcer) goes in the shot's voiceover list "
                        "instead and needs no cast entry."
                    )
                elif shot.get("character_ids") and cast_names[speaker].get("id") not in (
                    shot.get("character_ids") or []
                ):
                    warnings.append(
                        f"{where}.dialogue[{j}] speaker {speaker!r} is not in this shot's "
                        "character_ids, so its reference image will not be attached."
                    )

        # v12: too little speech to be a voice at all. Moves the verifier's
        # VOICE_MIN_SPEECH_S gate forward into planning, where the fix (merge two
        # adjacent lines, or write a longer one) is free.
        shot_speech_chars = sum(
            len(str(line.get("line") or "").strip())
            for line in (shot.get("dialogue") or []) if isinstance(line, dict)
        )
        if ENFORCE_VOICE_FLOOR and shot_speech_chars:
            speech_s = shot_speech_chars / SPEECH_CHARS_PER_SECOND
            if speech_s < VOICE_MIN_SPEECH_SECONDS - 1e-6:
                warnings.append(
                    f"{where}: {shot_speech_chars} char(s) of dialogue is only ~{speech_s:.1f}s "
                    f"of voice, under the {VOICE_MIN_SPEECH_SECONDS:.0f}s a voice verdict needs "
                    "(creation_verify marks it thin_evidence and the model has almost "
                    "nothing to anchor the timbre on). Merge this line with the adjacent one or "
                    "write it longer — v11 had 13 thin shots, and its three-character line "
                    "「为什么？」 (0.5s) came back in a deep male voice and took 3 rounds to fix."
                )

        if not shot.get("dialogue") and not any(m in vp for m in _NO_SPEECH_MARKERS):
            warnings.append(f"{where}: no dialogue but the prompt has no explicit no-speech "
                            "negation (video_generate appends one; stating it yourself "
                            "avoids invented lip-flap)")

        narration = shot.get("narration")
        narr_text = ""
        if isinstance(narration, str):
            narr_text = narration.strip()
        elif isinstance(narration, dict):
            narr_text = str(narration.get("line") or "").strip()
        if narr_text and not serial:
            errors.append(
                f"{where}.narration is not allowed — narration (a character's inner "
                "monologue) is disabled for schema v1/v2 pipelines (2026-09-15). Play the "
                "information as a scene: dialogue, action, or picture. A narrator or any "
                "other off-screen voice goes in the shot's voiceover list instead."
            )
        if narr_text and serial:
            # v3 narration is inner monologue only: it belongs to a cast member,
            # uses that member's voice, and plays over a silent performance.
            speaker_n = str(narration.get("speaker") or "").strip() if isinstance(narration, dict) else ""
            if not speaker_n:
                errors.append(
                    f"{where}.narration needs a speaker — v3 narration is inner "
                    "monologue that belongs to a cast member, never an omniscient voice"
                )
            elif speaker_n not in cast_names:
                errors.append(
                    f"{where}.narration.speaker={speaker_n!r} has no cast entry; inner "
                    "monologue must belong to a declared cast member (and their voice)"
                )
            else:
                if shot.get("character_ids") and cast_names[speaker_n].get("id") not in (
                    shot.get("character_ids") or []
                ):
                    warnings.append(
                        f"{where}: inner monologue of {speaker_n!r} plays over a shot "
                        "they are not in (off-screen inner voice is legal, verify it reads)"
                    )
            if len(narr_text) > 30:
                warnings.append(
                    f"{where}.narration.line is {len(narr_text)} chars; keep inner "
                    "lines within ~30 so the overlay never outruns the shot"
                )
            narr_seconds = len(narr_text) / SPEECH_CHARS_PER_SECOND
            if dur is not None and narr_seconds > dur + 1e-6:
                warnings.append(
                    f"{where}.narration needs ~{narr_seconds:.1f}s but the shot is "
                    f"{dur}s; lengthen the shot or split the line"
                )
        if narr_text and serial:
            narration_shots += 1
        narration_chars += len(narr_text)

        if (
            serial and episode_fmt and dur is not None and dur > 5.0 + 1e-6
            and not (shot.get("character_ids") or [])
            and not (shot.get("dialogue") or [])
            and not narr_text
        ):
            errors.append(
                f"{where} is an empty shot longer than 5s; cut it, populate it, or "
                "cover it with inner monologue"
            )

        # Production contract; see video-creation references for rationale.
        # Production contract; see video-creation references for rationale.
        # follow the official video generator guidance instead — face-only headshot +
        # full-body front per character; multi-view sets read as multiple
        # subjects and worsen identity drift — so the nudge is silenced there,
        # EXCEPT the back card (⑤ 需求拉动): 背面是正面卡的信息盲区 (发型背面/
        # 披风/背部细节), 且仅多视图生成器 (2.5) 挂背卡——2.0/Fast 官方不
        # 建议多视图主体参考, 背面镜漂移靠关键帧兜底或接受。侧视图卡对 serial
        # 永远沉默 (正面+头像可插值补偿, image_side 保持闲置)。serial 侧的背面
        # 镜头从 prompt 文字探测 (v4 序列没有 angle 字段)。状态版本优先: 该序列
        # cast_states 绑定的状态有背卡就不算缺。
        angle = str(shot.get("angle") or "")
        if not serial:
            view_key = "image_back" if "背" in angle else ("image_side" if "侧" in angle else None)
        elif multi_view_gen and any(w in vp for w in ("背影", "背面", "背对")):
            view_key = "image_back"
        else:
            view_key = None
        if view_key:
            for cid in shot.get("character_ids") or []:
                member = cast_by_id.get(cid)
                if member and str(member.get("image") or "").strip():
                    st_id = (states_map or {}).get(cid) if isinstance(states_map, dict) else None
                    active = next((s for s in member.get("states") or []
                                   if isinstance(s, dict) and s.get("id") == st_id), {}) if st_id else {}
                    if not str(active.get(view_key) or member.get(view_key) or "").strip():
                        warnings.append(
                            f"{where} shoots {'a back view' if view_key == 'image_back' else angle} but cast "
                            f"{member.get('name')!r} has no {view_key} card — generate the view card "
                            "(single standalone image, 禁拼图) or the model will invent that side."
                        )

        need = _dialogue_seconds(shot)
        if dur is not None and need > dur + 1e-6:
            errors.append(
                f"{where} needs about {need:.1f}s to deliver its dialogue but duration is "
                f"{dur}s. Move the overflow into the next shot."
            )

    for name, count in speaking.items():
        member = cast_names.get(name)
        if member is None:
            continue
        has_image = bool(str(member.get("image") or "").strip())
        has_prompt = bool(str(member.get("sheet_prompt") or "").strip())
        if require_images and not has_image:
            errors.append(
                f"cast {name!r} speaks in {count} shot(s) but has no reference image; "
                "run image_generate for the cast sheets first."
            )
        elif not has_image and not has_prompt:
            warnings.append(
                f"cast {name!r} speaks in {count} shot(s) but has neither image nor sheet_prompt."
            )
        # One fixed preset voice per speaking character, reused for every line; without it
        # the timbre drifts between shots (shipped v6/v7 defect). voice_card is a sample
        # in that voice, the verifier's voice anchor.
        if not str(member.get("voice") or "").strip():
            guidance = "choose a TTS service voice ID (voice_style resolves one)"
            warnings.append(f"cast {name!r} speaks but has no voice: {guidance} "
                            "and synthesize every line with it.")
        card = str(member.get("voice_card") or "").strip()
        if card and require_images and not ctx.resolve(card).is_file():
            errors.append(f"cast {name!r}.voice_card not found: {card}")

    # v9 motion cards: a 4-6s clip of the character's signature action (dragon
    # flight, sword draw) used as a reference_video for action beats so motion
    # style carries across shots. Optional but validated for existence.
    for c in cast:
        if not isinstance(c, dict):
            continue
        mc = str(c.get("motion_card") or "").strip()
        if mc and require_images and not ctx.resolve(mc).is_file():
            errors.append(f"cast {c.get('name')!r}.motion_card not found: {mc}")

    # Narration is disabled outright (2026-09-15): any narration content is a
    # hard error raised per-shot above. The ratio is kept for report telemetry.
    spoken_total = dialogue_chars + narration_chars
    narration_ratio = narration_chars / spoken_total if spoken_total else 0.0

    if target_total is not None and target_total > 0:
        low, high = target_total * (1 - tolerance), target_total * (1 + tolerance)
        budget_total = screen_total if screen_total is not None else total
        if not (low <= budget_total <= high):
            warnings.append(
                f"planned {'screen' if screen_total is not None else 'footage'} duration {budget_total:.1f}s is outside the target window "
                f"{low:.0f}-{high:.0f}s (target {target_total:.0f}s)."
            )

    # No isolated shots (v11; parked by default since v13 — see the flag block). v9 and v10 both shipped with ZERO pixel-level cross-shot
    # references — continues_from / reference_take_id / edit_from were all 0 across
    # 65 and 72 shots — so the 26-shot aerial battle was 26 independent imaginings of
    # the same fight: nothing connected them and nothing could. The capability existed
    # and was advisory, so it went unused. When armed (creation_media.ENFORCE_NO_ISOLATED_SHOTS), every shot after a
    # name where its world comes from:
    #   continues_from    — same continuous take, upstream last frame seeds this one
    #   reference_take_id — new angle, upstream clip rides along as a world reference
    #   edit_from         — repair of a rejected take
    # A shot may opt out with world_ref="none" plus a reason, for a true jump in time
    # or place inside one scene id.
    if ENFORCE_NO_ISOLATED_SHOTS:
        isolated: list[str] = []
        seen_scene: set = set()
        for shot in shots:
            if not isinstance(shot, dict):
                continue
            scene = shot.get("scene_id") or "__noscene__"
            sid = str(shot.get("shot_id") or "?")
            if scene not in seen_scene:
                seen_scene.add(scene)
                continue                      # scene anchor: nothing to carry over yet
            if str(shot.get("world_ref") or "").strip().lower() == "none":
                if not str(shot.get("world_ref_reason") or "").strip():
                    errors.append(f"shot {sid}: world_ref='none' needs world_ref_reason "
                                  "(a real jump in time or place inside this scene)")
                continue
            # reference_from is the PLAN-level link (storyboard-spec: it compiles to an exact
            # reference_take_id once a candidate is chosen), so it satisfies the gate at plan
            # time just like the compiled forms do.
            if any(shot.get(k) for k in
                   ("continues_from", "reference_from", "reference_take_id", "edit_from")):
                continue
            isolated.append(sid)
        if isolated:
            msg = (f"{len(isolated)} shot(s) have no world reference and would be imagined "
                   f"from scratch: {', '.join(isolated[:12])}"
                   f"{' …' if len(isolated) > 12 else ''}. Give each one continues_from (same "
                   "continuous take) or reference_take_id (new angle on the same world), or "
                   "world_ref='none' with world_ref_reason. This is why the v9/v10 fight "
                   "scenes had no shot-to-shot relationship at all.")
            if bool(args.get("allow_isolated_shots")):
                warnings.append(msg)
            else:
                errors.append(msg)

    report = {
        "ok": not errors,
        "schema_version": str(data.get("schema_version", 1)),
        "episode": data.get("episode") if serial else None,
        "n_shots": len(shots),
        "total_seconds": round(total, 2),
        "planned_screen_seconds": round(screen_total, 2) if screen_total is not None else None,
        "plan_sha256": digest(data),
        "compiled_prompts": sorted(compiled),
        "shot_plan_sha256": {str(s.get("shot_id")): shot_plan_digest(data, s, ctx) for s in shots if isinstance(s, dict)},
        "total_human": f"{int(total // 60)}m{int(total % 60):02d}s",
        "n_cast": len(cast),
        "n_scenes": len(scenes),
        "n_props": len(props),
        "speaking_roles": speaking,
        "cast_without_image": sorted(
            str(c.get("name")) for c in cast
            if isinstance(c, dict) and not str(c.get("image") or "").strip()
        ),
        "style_preset": style,
        "resolved_voices": resolved_voices,
        "narration_ratio": round(narration_ratio, 3),
        "n_narration_shots": narration_shots,
        "n_chained_shots": sum(
            1 for s in shots if isinstance(s, dict) and _clean_name(s.get("continues_from"))
        ),
        "errors": errors,
        "warnings": warnings,
    }
    out_json = args.get("output_json") or "out/creation/shotlist_validation.json"
    report.update(delivery_fields(data))
    written = _write_json(ctx, out_json, report)

    head = "PASS" if not errors else f"FAIL ({len(errors)} error(s))"
    text = (
        f"Shotlist validation {head}: {len(shots)} shots, {report['total_human']} total, "
        f"{len(cast)} cast / {len(scenes)} scenes / {len(props)} props, "
        f"{len(warnings)} warning(s)."
    )
    if errors:
        text += "\n\nErrors:\n" + "\n".join(f"- {e}" for e in errors[:40])
    if warnings:
        text += "\n\nWarnings:\n" + "\n".join(f"- {w}" for w in warnings[:40])
    return ToolResult(text=text, data=report, artifacts=[written])


def _write_json(ctx: RunContext, rel: str, payload: Any) -> str:
    path = ctx.resolve(rel)
    path.parent.mkdir(parents=True, exist_ok=True)
    from .public_surface import public_data
    from .creation_takes import write_object
    write_object(path, public_data(payload))
    return ctx.virtualize(path)


# ====================================================== 2. image generation
def _panel_layout_score(path: Path) -> float | None:
    """Detect comic-panel / grid layouts.

    Only meaningful for keyframes: a keyframe must be one frame, and multi-panel
    output poisons it as a video composition reference. Cast sheets are
    *intentionally* multi-view, so this check must not be applied to them.
    Returns the fraction of interior rows+cols that look like gutters, or None
    when the check cannot run.
    """
    try:
        import numpy as np
        from PIL import Image
    except ImportError:
        return None
    try:
        with Image.open(path) as im:
            small = im.convert("L").resize((384, 256))
        arr = np.asarray(small, dtype=float)
    except Exception:
        return None
    row_std = arr.std(axis=1)
    col_std = arr.std(axis=0)
    flat = 0
    for series in (row_std, col_std):
        mean = float(series.mean()) or 1.0
        interior = series[8:-8]
        flat += int((interior < mean * 0.3).sum())
    return round(flat / (arr.shape[0] + arr.shape[1] - 32), 4)


def generate_images(args: dict, ctx: RunContext) -> ToolResult:
    """Batch text-to-image for cast sheets, scene plates, props and keyframes."""
    items = args.get("items")
    if not isinstance(items, list) or not items:
        raise CreationError("items must be a non-empty array")
    style = _style_preset(args.get("style_preset"))
    bible = _plan_style_bible(ctx, args)          # rides after the style preset on every card/plate/keyframe
    default_orientation = str(args.get("orientation") or "landscape").strip().lower()
    if default_orientation not in ORIENTATIONS:
        raise CreationError(
            f"orientation must be one of {', '.join(ORIENTATIONS)} — got "
            f"'{default_orientation}'"
        )
    size = _size_tier(args.get("size"))
    canvas_orientation = _plan_canvas_orientation(ctx, args)
    out_dir = args.get("output_dir") or "out/creation/images"
    force = bool(args.get("force", False))
    workers = max(1, min(int(_num(args.get("concurrency")) or 3), 8))
    check_panels = bool(args.get("check_panel_layout", True))
    # code2video lays several poses per sheet on purpose, so panel-grid warnings are false
    # positives there. The code2video task injects VE_IMAGE_PANEL_CHECK=0 to suppress them
    # batch-wide, independent of what the model passes in check_panel_layout.
    if os.environ.get("VE_IMAGE_PANEL_CHECK", "1").strip() == "0":
        check_panels = False
    uploads: dict[str, str] = {}     # file sha256 -> uploaded https URL, shared by the batch
    default_background = "auto"      # ToolHub images are always opaque; names follow planned_image_name

    hit = photoreal_hits(style)
    style_warning = (
        f"style_preset contains photoreal marker(s) {hit}; images of human characters will "
        "likely be refused by video generator as 'may contain real person'."
        if hit else None
    )

    results: list[dict] = []
    blocked: list[dict] = []
    lock = threading.Lock()

    def one(item: dict) -> None:
        if not isinstance(item, dict):
            with lock:
                blocked.append({"id": None, "error": "item is not an object"})
            return
        item_id = _clean_name(item.get("id"))
        prompt = str(item.get("prompt") or "").strip()
        kind = _clean_name(item.get("kind")) or "keyframe"
        if not item_id or not prompt:
            with lock:
                blocked.append({"id": item_id or None, "error": "id and prompt are required"})
            return
        orientation = str(item.get("orientation") or default_orientation).strip().lower()
        if orientation not in ORIENTATIONS:
            with lock:
                blocked.append({
                    "id": item_id, "error":
                        f"orientation must be one of {', '.join(ORIENTATIONS)} — got "
                        f"'{orientation}'",
                })
            return
        # Plates and keyframes end up as first_frame / world references of the video: match
        # the film canvas orientation (9:16 / 16:9). Cards keep their own orientation.
        canvas_note = None
        if (kind in ("scene", "keyframe") and canvas_orientation
                and ORIENTATION_FAMILY.get(canvas_orientation) == orientation):
            orientation, canvas_note = canvas_orientation, f"{kind} composed for the film canvas ({canvas_orientation})"
        try:
            item_size = _size_tier(item.get("size") or size)
        except CreationError as exc:
            with lock:
                blocked.append({"id": item_id, "error": str(exc)})
            return
        name = planned_image_name(item, default_background)
        target = ctx.resolve(f"{out_dir}/{name}")
        record = {"id": item_id, "kind": kind, "path": ctx.virtualize(target)}
        if orientation != "auto":
            record["orientation_requested"] = orientation

        def verify() -> None:
            actual = _orientation_of(target)
            if actual:
                record["orientation_actual"] = actual
            record["aspect_mismatch"] = (
                bool(orientation != "auto" and actual
                     and actual != ORIENTATION_FAMILY.get(orientation, orientation))
            )

        if target.is_file() and not force:
            # The public entry already bound this path to the same request signature and
            # bytes; never replace it implicitly (small images included).
            record["reused"] = True
            if check_panels and kind == "keyframe":
                record["panel_score"] = _panel_layout_score(target)
            verify()
            with lock:
                results.append(record)
            return

        record["size_requested"] = item_size
        if canvas_note:
            record["size_note"] = canvas_note
        seeded = _image_seed()
        if seeded is not None:
            # debug mode: the archived sheet for this kind is published under the requested name;
            # nothing is sent to the provider and the agent is answered as if generated
            seed_root, seed_images = seeded
            rel = seed_images.get(kind)
            src = (seed_root / rel) if rel else None
            if src is None or not src.is_file():
                with lock:
                    blocked.append({"id": item_id, "kind": kind, "reason": "frozen_assets",
                                    "provider_message": f"debug mode: the asset seed has no {kind} image; nothing is generated"})
                return
            import tempfile
            from .file_contract import publish_files
            try:
                raw = encode_for_suffix(src.read_bytes(), target.suffix)
                target.parent.mkdir(parents=True, exist_ok=True)
                with tempfile.TemporaryDirectory(prefix='image-stage-', dir=target.parent) as tmp:
                    staged = Path(tmp) / target.name
                    staged.write_bytes(raw)
                    publish_files({target: staged})
            except Exception as exc:  # noqa: BLE001
                with lock:
                    blocked.append({'id': item_id, 'kind': kind, 'reason': 'frozen_assets',
                                    'provider_message': f'debug mode: seeded image unusable: {str(exc)[:200]}'})
                return
            verify()
            # the archived sheet is used as it is: its orientation is not a mismatch of this request
            record["aspect_mismatch"] = False
            record.update(bytes=target.stat().st_size, reused=True, frozen=True, seed_image=rel,
                          size_note="seeded image used as archived")
            with lock:
                results.append(record)
            return
        # reference images (cards / plate) ride with the request, so a keyframe keeps the faces and the
        # room it was planned in (生图→生视频 chain; text alone cannot hold identity). Entries are
        # paths or {path, role}; roles become the 「参考图说明」 block, numbered in the order given.
        ref_paths: list[Path] = []
        ref_roles: list[str] = []
        for raw in item.get("reference_images") or []:
            role = ""
            if isinstance(raw, dict):
                role = str(raw.get("role") or "").strip()
                raw = raw.get("path") or raw.get("url")
            rp = ctx.resolve(_clean_name(raw))
            if not rp.is_file():
                with lock:
                    blocked.append({"id": item_id, "kind": kind, "reason": "reference_missing",
                                    "provider_message": f"reference image not found: {rp}"})
                return
            ref_paths.append(rp)
            ref_roles.append(role)
        core = prompt
        if ref_paths and any(ref_roles) and "参考图说明" not in core:
            lines = [REF_ROLE_LINE.format(n=i, role=r or "参考图") for i, r in enumerate(ref_roles, 1)]
            core = "参考图说明：" + "；".join(lines) + "。\n" + core
            record["reference_roles_declared"] = True
        if ref_paths and kind == "keyframe" and "保持" not in core and "以对应参考图为准" not in core:
            core = core.rstrip("。 \n") + "。" + KEYFRAME_PRESERVE_NOTE
            record["preserve_note"] = True
        full_prompt = f"{style}。{core}" if style else core
        if bible and bible[:12] not in full_prompt:
            full_prompt = f"{full_prompt}。{STYLE_BIBLE_NOTE.format(bible=bible)}"
            record["style_bible"] = True
        if ref_paths:
            record["references_used"] = [ctx.virtualize(p) for p in ref_paths]
        if orientation != "auto" and _orientation_phrase_enabled():
            # State the aspect constraint up front, not only on the retry —
            # Production contract; see video-creation references for rationale.
            full_prompt = f"{ORIENTATION_PHRASE[orientation]}{full_prompt}"
        if len(ref_paths) > MAX_IMAGE_REFERENCES:
            with lock:
                blocked.append({"id": item_id, "kind": kind, "reason": "too_many_references",
                                "provider_message": f"{len(ref_paths)} reference images; the image generator "
                                                    f"accepts at most {MAX_IMAGE_REFERENCES}"})
            return
        from . import toolhub
        try:
            ref_urls = _reference_urls(ref_paths, uploads, lock)
            raw, provenance = _seedream_image(full_prompt, item_size, ref_urls)
        except toolhub.ToolHubError as exc:
            # Per-item failure: the other items' images stay published.
            detail = exc.detail
            reason = ("account_unavailable" if detail.get("code") == 3706
                      else "identity_unavailable" if detail.get("auth_error") or "identity" in str(exc)
                      else "generation_failed" if detail.get("code") == 3703 else "api_error")
            with lock:
                blocked.append({"id": item_id, "kind": kind, "reason": reason,
                                "provider_message": str(exc)[:2000], "logid": detail.get("logid"),
                                "prompt": full_prompt})
            return
        record.update({k: v for k, v in provenance.items() if v is not None})
        target.parent.mkdir(parents=True, exist_ok=True)
        import tempfile
        from PIL import Image
        from .file_contract import publish_files
        try:
            with tempfile.TemporaryDirectory(prefix='image-stage-', dir=target.parent) as tmp:
                staged = Path(tmp) / target.name
                with Image.open(io.BytesIO(raw)) as im:
                    im.load()
                    if im.width <= 0 or im.height <= 0:
                        raise ValueError('invalid image dimensions')
                    # The generator returns JPEG; store it in the format the output name asks for.
                    fmt = {'.png': 'PNG', '.webp': 'WEBP'}.get(target.suffix.lower(), 'JPEG')
                    (im if fmt != 'JPEG' else im.convert('RGB')).save(staged, format=fmt)
                publish_files({target: staged})
        except Exception as exc:
            with lock:
                blocked.append({'id': item_id, 'kind': kind, 'reason': 'invalid_image', 'provider_message': str(exc)[:300]})
            return
        verify()
        record["bytes"] = target.stat().st_size
        record["reused"] = False
        if check_panels and kind == "keyframe":
            record["panel_score"] = _panel_layout_score(target)
        with lock:
            results.append(record)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(one, items))

    order = {str(it.get("id")): i for i, it in enumerate(items) if isinstance(it, dict)}
    results.sort(key=lambda r: order.get(str(r.get("id")), 10**6))

    # Keyframes only — a character sheet is supposed to be multi-view.
    suspect = [
        r for r in results
        if r.get("kind") == "keyframe" and (r.get("panel_score") or 0) >= 0.06
    ]
    mismatches = [r for r in results if r.get("aspect_mismatch")]

    def _batch_value(key: str, default: str) -> str:
        # Items may override the call's default; the summary reports what was actually requested.
        values = {r[key] for r in results if r.get(key)}
        return values.pop() if len(values) == 1 else ("mixed" if values else default)

    report = {
        "model": IMAGE_GENERATOR_LABEL,
        "size": _batch_value("size_requested", size),
        "default_size": size,
        "style_preset": style,
        "orientation": _batch_value("orientation_requested", default_orientation),
        "default_orientation": default_orientation,
        "requested": len(items),
        "generated": sum(1 for r in results if not r.get("reused")),
        "reused": sum(1 for r in results if r.get("reused")),
        "blocked": blocked,
        "items": results,
        "suspect_panel_layout": [r["id"] for r in suspect],
        "aspect_mismatches": [r["id"] for r in mismatches],
    }
    written = _write_json(
        ctx, args.get("output_json") or "out/creation/images.json", report
    )

    text = (
        f"Image generation: {report['generated']} generated, {report['reused']} reused, "
        f"{len(blocked)} not produced ({len(items)} requested)."
    )
    if style_warning:
        text += f"\n\n[style] {style_warning}"
    if blocked:
        # A transient service failure (404 DeploymentNotFound / 429 / 5xx / timeout after the
        # retries) is solved by sending the same request again, not by changing it: 2026-11-05 the
        # agent answered a 404 by switching size and dropping the reference image.
        transient = [b for b in blocked if b.get("reason") == "api_error"]
        frozen = [b for b in blocked if b.get("reason") == "frozen_assets"]
        other = [b for b in blocked if b.get("reason") not in ("api_error", "frozen_assets")]
        if frozen:
            text += (
                "\n\nNot produced (this project uses provided assets; no new images are generated) — use the "
                "images already under out/ instead:\n"
                + "\n".join(f"- {b.get('id')}: {str(b.get('provider_message'))[:200]}" for b in frozen[:20])
            )
        if transient:
            text += (
                f"\n\nNot produced (transient service error after {IMAGE_MAX_SUBMITS} submissions) — call this tool "
                "again with the IDENTICAL arguments (same size, same reference_images, same prompt); do not "
                "change the request or probe the service:\n"
                + "\n".join(
                    f"- {b.get('id')}: {b.get('reason')} — {str(b.get('provider_message'))[:200]}"
                    for b in transient[:20]
                )
            )
        if other:
            text += (
                "\n\nNot produced — restate these prompts yourself and call this tool again "
                "(this tool never rewrites your prompt):\n"
                + "\n".join(
                    f"- {b.get('id')}: {b.get('reason')} — {str(b.get('provider_message'))[:200]}"
                    for b in other[:20]
                )
            )
    if suspect:
        text += (
            "\n\n[panel check] These keyframes look like multi-panel/grid layouts rather than a "
            "single frame. A keyframe must be one frame or it corrupts the video composition "
            "reference. Inspect them and regenerate with an explicit single-frame constraint:\n"
            + "\n".join(f"- {r['id']} (score {r.get('panel_score')})" for r in suspect)
        )
    if mismatches:
        text += (
            "\n\n[aspect] These images came out in the wrong orientation despite the orientation "
            "stated in the prompt (a landscape sheet rendered portrait breaks "
            "the three-view layout and the video composition reference):\n"
            + "\n".join(
                f"- {r['id']}: requested {r.get('orientation_requested')}, got "
                f"{r.get('orientation_actual')} — rewrite the prompt to force the layout "
                "(e.g. 并排/横排, not 上下) and regenerate"
                for r in mismatches[:20]
            )
        )
    # face cards (v17): when a cast headshot / body card was (re)generated, check whether two
    # characters' cards look alike to the face recogniser — verify's per-Shot identity evidence
    # Production contract; see video-creation references for rationale.
    try:
        plan_cast = _plan_cast(ctx, args)
        touched = {str(ctx.resolve(str(r["path"]))) for r in results if r.get("path")}
        card_paths = {str(ctx.resolve(str(c.get(k)))) for c in plan_cast
                      for k in ("headshot", "image") if isinstance(c, dict) and c.get(k)}
        if touched & card_paths:
            from ve_tools import faceqc
            alike = faceqc.card_similarity_notes(ctx, plan_cast)
            if alike:
                report["face_cards_alike"] = alike
                text += (
                    "\n\n[face cards] These characters' face cards look alike to the face recogniser "
                    f"(>= {faceqc.CARD_SIMILAR_WARN}); verify's identity evidence between them will be weak. "
                    "Differentiate face shape / hair / build in the sheet prompt and regenerate one of each pair: "
                    + "; ".join(alike)
                )
    except Exception:  # noqa: BLE001 — best-effort advisory, never blocks image generation
        pass
    return ToolResult(
        text=text, data=report, artifacts=[written],
        image_paths=[str(ctx.resolve(r["path"])) for r in results],
    )


# ====================================================== 3. video generation
def _pad_audio_min(path: Path, min_seconds: float, directory: Path | None = None) -> Path:
    """Source-bound derivation, never write alongside user audio."""
    import tempfile, subprocess
    from .creation_planning import file_digest, digest
    from .creation_takes import read_object, write_object
    dur = _probe_duration(path)
    if dur is None or dur <= 0:
        raise CreationError('reference audio cannot be decoded')
    if dur >= min_seconds:
        return path
    binding = {'source_sha256': file_digest(path), 'min_seconds': min_seconds,
               'sample_rate': 24000, 'channels': 1, 'padding_seconds': .2, 'converter_version': 1}
    directory = directory or Path(tempfile.gettempdir()) / 'video-agent-audio-derivations'
    if any(p.is_symlink() for p in (directory, *directory.parents)):
        raise CreationError('audio derivation directory cannot be a symlink')
    directory.mkdir(parents=True, exist_ok=True)
    out = directory / (digest(binding) + '.wav')
    metadata = out.with_suffix('.json')
    from .file_contract import reuse_frozen_output
    if reuse_frozen_output(out):
        return out
    if out.is_symlink() or metadata.is_symlink():
        raise CreationError('audio derivation target cannot be a symlink')
    cached = read_object(metadata)
    if out.is_file() and cached.get('binding') == binding and cached.get('sha256') == file_digest(out) and (_probe_duration(out) or 0) >= min_seconds:
        return out
    fd, raw = tempfile.mkstemp(prefix='.pad-', suffix='.wav', dir=directory)
    __import__('os').close(fd)
    temporary = Path(raw)
    try:
        subprocess.run(['ffmpeg', '-nostdin', '-y', '-v', 'error', '-i', str(path), '-af', f'apad=whole_dur={min_seconds + .2:.2f}',
                        '-ar', '24000', '-ac', '1', str(temporary)], check=True, capture_output=True, timeout=60)
        if (_probe_duration(temporary) or 0) < min_seconds or file_digest(path) != binding['source_sha256']:
            raise CreationError('audio derivation/source validation failed')
        temporary.replace(out)
        write_object(metadata, {'binding': binding, 'sha256': file_digest(out)})
    finally:
        temporary.unlink(missing_ok=True)
    return out


def _data_url(path: Path, max_bytes: int = 900_000) -> str:
    size = path.stat().st_size
    suffix = path.suffix.lower().lstrip(".")
    if size <= max_bytes:
        mime = {"jpg": "jpeg", "jpeg": "jpeg", "png": "png", "webp": "webp"}.get(suffix, "png")
        return f"data:image/{mime};base64," + base64.b64encode(path.read_bytes()).decode()
    try:
        from PIL import Image

        with Image.open(path) as im:
            rgb = im.convert("RGB")
            buf = io.BytesIO()
            rgb.save(buf, format="JPEG", quality=88, optimize=True)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode()


_CONTENT_INDEX_RE = re.compile(r"content\[(\d+)\]")


def _flagged_reference_indices(message: str, n_refs: int, has_text: bool) -> set[int]:
    """Map a 'may contain real person' complaint onto reference indices."""
    out: set[int] = set()
    for match in _CONTENT_INDEX_RE.finditer(message):
        idx = int(match.group(1))
        ref = idx - 1 if has_text else idx
        if 0 <= ref < n_refs:
            out.add(ref)
    return out


# ---- shadow 提案一: 用户视频素材时长门禁 (先验时长才许挂) ----
# 出处: updream h3-prompt-writing-i22 的 15s 素材门禁 (先验时长->超限不看不听不提取->按稳定标识
# 登记永久拒绝->恢复只有换新文件或改文字描述) + sd25-pe 的 30s 总量软预检。单点接入
# _resolve_refs (外部素材唯一入口)。自产文件 (out/creation/ 与 .video_agent/) 豁免——
# 其时长由生成端保证。当前全自产参考的现状下 gate 不会触发, 属防御式新增。
_VIDEO_SUFFIXES = {".mp4", ".mov", ".webm", ".m4v", ".mkv", ".avi", ".flv", ".ts"}
GATE_HARD_LIMIT_SECONDS = 30.0   # 全档硬上限 (sd25-pe 参考视频总量)


def _load_rejected_materials(ctx: RunContext) -> list:
    import json as _json
    try:
        data = _json.loads(ctx.resolve(".video_agent/rejected_materials.json").read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _save_rejected_materials(ctx: RunContext, rows: list) -> None:
    import json as _json
    p = ctx.resolve(".video_agent/rejected_materials.json")
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(_json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(p)


def _is_pipeline_owned(ctx: RunContext, path) -> bool:
    """自产文件豁免: out/creation/ 与 .video_agent/ 下的流水线产物。"""
    try:
        resolved = str(path.resolve())
    except OSError:
        resolved = str(path)
    for home in ("out/creation", ".video_agent"):
        try:
            base = str(ctx.resolve(home).resolve())
        except OSError:
            continue
        if resolved == base or resolved.startswith(base + "/"):
            return True
    return False


def _material_sha256(path) -> str:
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _material_gate(ctx: RunContext, path, where: str) -> None:
    """通用门禁 (与 profile 无关的硬部分): 登记检查 + 时长可验证 + <=30s。

    行为纪律 (写进 generators.md): 合规前不观看、不抽帧、不转写、不描述其内容。
    """
    if str(path.suffix).lower() not in _VIDEO_SUFFIXES or _is_pipeline_owned(ctx, path):
        return
    rows = _load_rejected_materials(ctx)
    sha = _material_sha256(path)
    for row in rows:
        if row.get("path") == str(path) and row.get("sha256") == sha and row.get("profile") == "all":
            raise CreationError(
                f"{where}: 参考视频 {path.name} 在拒绝登记中 (时长 {row.get('duration_seconds')}s 超限)。"
                "本项目内不得引用该版本或从此前观察提取的任何内容; 恢复只有两条路: "
                "裁剪后提供新文件(重新过门禁), 或改用独立文字描述。")
    dur = _probe_duration(path)
    if dur is None:
        raise CreationError(
            f"{where}: 参考视频 {path.name} 时长无法确认——元数据缺失视为未通过门禁, "
            "先验时长是挂载前置条件; 提供可验证时长的文件后再挂载。")
    if dur > GATE_HARD_LIMIT_SECONDS:
        rows.append({"path": str(path), "sha256": sha, "duration_seconds": round(dur, 3),
                     "limit_seconds": GATE_HARD_LIMIT_SECONDS, "profile": "all",
                     "reason": "exceeds 30s hard gate (sd25-pe total reference budget)",
                     "rejected_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()})
        _save_rejected_materials(ctx, rows)
        raise CreationError(
            f"{where}: 参考视频 {path.name} 时长 {dur:.3f}s 超过硬门禁 30s——已写入拒绝登记; "
            "不得观看/抽帧/转写/提取其内容, 裁剪后提供新文件或改用文字描述。")


def _resolve_refs(ctx: RunContext, shot: dict, prof: dict | None = None) -> list[dict]:
    refs: list[dict] = []
    for entry in shot.get("reference_images") or []:
        if isinstance(entry, str):
            entry = {"path": entry}
        if not isinstance(entry, dict):
            raise CreationError(f"shot {shot.get('shot_id')}: reference_images entries must be objects")
        raw = _clean_name(entry.get("path") or entry.get("url"))
        if not raw:
            raise CreationError(f"shot {shot.get('shot_id')}: reference image needs path or url")
        role = str(entry.get("role") or "reference_image")
        if role not in REF_ROLES:
            raise CreationError(f"shot {shot.get('shot_id')}: bad reference role {role!r}")
        item = {"role": role, "label": entry.get("label")}
        if raw.startswith(("http://", "https://", "data:")):
            item["url"] = raw
            item["source"] = raw
        else:
            path = ctx.resolve(raw)
            if not path.is_file():
                raise CreationError(f"shot {shot.get('shot_id')}: reference image missing: {path}")
            _material_gate(ctx, path, f"shot {shot.get('shot_id')}")
            item["path"] = path
            item["source"] = ctx.virtualize(path)
        refs.append(item)
    # 图片计数闸门按 profile 执行: v2.5=30 (官方《素材输入建议》sd25-pe), v2.0/h3=9 (上游
    # profile 声明值; 官方无数量条文)。此前三处口径不一致: 文档表写 9, PROFILES 写 30/9,
    # 实际只有全局 30 硬限在执行 (max_images 从未生效)。
    img_cap = MAX_REFERENCE_IMAGES
    if prof is not None and prof.get("max_images"):
        img_cap = min(int(prof["max_images"]), MAX_REFERENCE_IMAGES)
    if len(refs) > img_cap:
        raise CreationError(
            f"shot {shot.get('shot_id')}: {len(refs)} reference images exceeds the "
            f"{img_cap} limit" + (f" ({prof['name']})" if prof is not None else "")
        )
    # 外部视频参考的数量与总量按 profile 执行 (P2-5)。h3 的 15s 是单条门禁语义 (h3-i22),
    # 总量求和只对 v2.5 生效 (max_reference_video_seconds=30, sd25-pe 总量预检); 自产
    # take 与远程 url 不计入 (前者时长由生成端保证, 后者不可本地探测)。
    if prof is not None:
        ext_videos = [r["path"] for r in refs
                      if r.get("path") and str(r["path"].suffix).lower() in _VIDEO_SUFFIXES
                      and not _is_pipeline_owned(ctx, r["path"])]
        max_videos = int(prof.get("max_videos") or 0)
        if max_videos and len(ext_videos) > max_videos:
            raise CreationError(
                f"shot {shot.get('shot_id')}: {len(ext_videos)} external reference videos exceed "
                f"{prof['name']}'s {max_videos}-video reference limit")
        cap = prof.get("max_reference_video_seconds")
        if cap and prof.get("dialect") != "h3" and ext_videos:
            total = 0.0
            for path in ext_videos:
                d = _probe_duration(path)
                if d is None:
                    raise CreationError(
                        f"shot {shot.get('shot_id')}: external reference video {path.name} duration unknown — "
                        "cannot verify the total reference budget; provide a file with verifiable duration")
                total += d
            if total > float(cap) + 1e-6:
                raise CreationError(
                    f"shot {shot.get('shot_id')}: external reference videos total {total:.3f}s exceed "
                    f"{prof['name']}'s {cap:g}s reference budget")
    roles = {r["role"] for r in refs}
    if roles & set(FRAME_ROLES) and "reference_image" in roles:
        raise CreationError(
            f"shot {shot.get('shot_id')}: video generator rejects first_frame/last_frame mixed with "
            "reference_image in one request. Pick one mode per shot."
        )
    return refs


# ------------------------------------------------------------------ v7 hard constraints
# Everything below turns a SKILL rule that v6 silently skipped into tool behaviour.
_CARD_VIEW_RE = re.compile(r"^(card_.+?)_(front|side|back)(\.[A-Za-z0-9]+)$")
_MENTION_RE = re.compile(r"@([^\s@（(，,。；;：:、）)]{1,12})")
_NO_SPEECH_MARKERS = ("不开口", "无人说话", "不说话", "没有人说话", "无对白", "不张口", "闭口")
# Framings where the card's studio full-body sheet stops constraining the face and
# hair: v9 shipped four close shots of 卫沉舟 with his hair loose instead of the
# card's high ponytail, because the VIDEO prompt only ever said "@卫沉舟" while the
# keyframe prompt carried the full appearance text. Close framings get the full
# appearance inlined; wider ones get the trait list, which is short.
_CLOSE_SIZES = ("特写", "近景", "中近景")
# Appearance text injected per shot is capped so a four-character wide shot cannot
# push the prompt past what the model reads attentively.
_APPEARANCE_BUDGET = 900

# ---------------------------------------------------------------- v10 rollback
# All three v10 behaviours are OFF; the pipeline is back to v9 semantics. Flip one
# flag to re-enable a single piece once its defect is fixed. What each cost us:
#
# INJECT_APPEARANCE (A1): the framing trigger changed how the agent designed
#   coverage — it made EVERY dialogue shot a close-up to get the full appearance,
#   so lines were split shorter (speech median 4.96s -> 3.22s, 21 shots waived on
#   thin voice evidence vs 7 in v9). It also injected non-subject characters in
#   full: a close-up of one man's eyes carried a whole dragon's body text
#   (146 -> 592 chars). Fix before re-enabling: key off who the SUBJECT is
#   (speaker / required_visuals), never off framing, and never inject a character
#   the shot does not centre on.
# INJECT_CONTINUITY (A3): this one measurably worked (review: injury carry 7->9,
#   continuity 6->8), but it shipped alongside A1 and the two can contradict each
#   other — A3 says "left wing burnt through" while A1 pastes the pristine card
#   text for the same creature. Re-enable it first, on its own, phrased as prose
#   and placed BEFORE the action rather than appended after the reference notes.
# BED_AUTOLEVEL (B1): levelling to the clips' noise floor took the bed from 0.14
#   to 0.499 (~11 dB louder). Cut-to-cut room tone did improve (floor step median
#   4.16 -> 3.41 dB, >6 dB cuts 45% -> 29%), but nothing in the calculation looks
#   at SPEECH, so a bed that continuous can mask dialogue. Re-enable only with a
#   "stay N dB under the voice track" ceiling on top of the floor target.
INJECT_APPEARANCE = False
INJECT_CONTINUITY = False
# Production contract; see video-creation references for rationale.
# allowed_changes} rides in the prompt as a plain 「承接状态：」 line. Her per-shot path above stays
# off; the evidence for turning the idea back on is her own v10 (伤情承接 9) vs v12 (5).
INJECT_SEQUENCE_CONTINUITY = True
BED_AUTOLEVEL = False

# video generator RE-PERFORMS reference audio instead of copying it. Sending the character's
# voice seed as a SECOND reference_audio next to the shot's line therefore does not
# anchor the timbre — it hands the model a second thing to say. v10's ledger: 28 of 46
# speaking shots auto-failed with "after the N-char line the character recites the
# <name> voice-seed sample", and the agent's only way out was to drop the seed, which
# left the film with no cross-shot voice anchor at all. One reference_audio per shot.
PASS_VOICE_REF_TO_SEEDANCE = False
# 官方硬限 (sd25-pe 指南): 参考音频最多 10 段, 全部音频总时长 ≤30s。
MAX_REFERENCE_AUDIO = 10
MAX_REFERENCE_AUDIO_SECONDS = 30.0

# ------------------------------------------------------- v12: silence the world reference
# Same root cause as PASS_VOICE_REF_TO_SEEDANCE, through the video channel. A world
# reference (`continues_from` / `reference_take_id`) sends the upstream CLIP, and that
# clip's audio track carries the PREVIOUS speaker's line. video generator re-performs any
# reference audio, so the upstream voice gets pasted onto this shot's speaker: v11
# logged 37 voice rejections (v10: 28), and the agent itself wrote the diagnosis into
# verified.json — "the context reference video S1_11_T1 carries 梁阙's male dialogue
# audio, and video generator re-performs the line in that voice". v11 traded voice quality
# for continuity; this switch stops that trade.
#
# Decision tree actually walked (2026-09-22, real LAS calls, not guesses):
#   1. Mute locally and inline the clip as a data-uri (`ffmpeg -an -c:v copy`, 74 ms,
#      7.1 MB -> 9.5 MB base64): REJECTED synchronously by the API —
#      HTTP 400 InvalidParameter: "reference_video must be provided as a web url".
#      We have no way to host a muted copy, so the video channel cannot be de-audioed.
#   2. An API field that ignores the reference audio track: none exists. Official
#      guidance controls per-asset USE through the prompt instead ("@视频1 用于动作、
#      运镜或节奏，不采用视频中的人物和场景"), not through a request field.
#   3. Fallback, SHIPPED IN v12, now retired: a SPEAKING shot takes the upstream
#      clip's last frame as one more `reference_image` (never `first_frame` — that
#      would lock the camera) and drops the video reference, so no foreign audio
#      reaches the model. Non-speaking shots keep the full `reference_video`.
#
# v12 verdict (film 35/60 vs v11's 51; spatial 9 -> 5): the fallback is retired. A
# static frame cannot carry the motion dimension of the world — riding posture, size
# ratio and screen direction collapsed the moment the clip became its tail frame
# (赤龙 shrunk to a cub at 00:56; rider/saddle position unreadable at 07:44). The
# machinery stays for tests and for the record; re-arming needs a motion-bearing
# answer to the audio problem, not a still.
MUTE_REFERENCE_VIDEO = False
# The tail-frame fallback needs pixels that can actually carry the world. A 09-21
# experiment fed a WIDE tail frame in and got a completely different young man back:
# the face the shot needed was not in the source pixels at all. So the still-frame
# route is gated, and a shot that fails the gate keeps its video reference plus the
# official prompt-level declaration (worse voice risk, but no invented faces).
TAIL_REF_MIN_SHORT_SIDE = 540          # 720p upstream passes; a 480p one does not
WIDE_SHOT_MARKERS = ("大远景", "远景", "全景", "航拍", "鸟瞰", "俯瞰", "极广角", "大广角")
_TAKE_SUFFIX_RE = re.compile(r"_T\d+$")
# Official control channel for the case where the clip must still travel: state what the
# video reference is for. Row label + full-width colon, never 【】 (official subtitle syntax).
PICTURE_ONLY_REF_NOTE = (
    "参考视频说明：参考视频只用于延续场景、光线、空间关系与角色状态，"
    "不采用其中的人声、音色与语气；本镜台词的声音只以参考音频为准。"
)
# Declaration for a tail frame that rides along as a plain reference image. Official rule
# 「素材逐份负责」: an attached asset the prompt never names is free for the model to
# misread — as a third character card, or as a first frame that locks the camera. This is
# the guide's loose 「参考图片 N 的光影」 form, not 「图片 N 为首帧」.
WORLD_TAIL_REF_NOTE = (
    "参考图说明补充：图片 {n} 为上一段（{upstream}）结尾画面，仅参考其场景布置、光线方向与人物站位；"
    "不作为首帧，不复制其构图，不把其中人物当作新角色。"
)

# Production contract; see video-creation references for rationale.
# A bridge is ONE generation that sees both sides: first_frame = a frame INSIDE the
# outgoing clip (where the timeline will cut it), last_frame = a frame INSIDE the
# Production contract; see video-creation references for rationale.
# Production contract; see video-creation references for rationale.
# (76 between the two scenes), the occluder reached full cover exactly at the stated
# second (frame std 15 vs 60), the whip peaked at 1.75s. So both seams are invisible
# WITHOUT trimming the bridge, and the bridge REPLACES the handles on both sides:
# net screen cost = duration - 2*handle (~1s), not the 4-5s of a bolt-on clip.
# Recipes follow the BV13zMG6CEif notes. 相似构图 (5 composition-locked stills -> one
# world-hop clip) is a multi-keyframe generation, not this.
BRIDGE_DEFAULT_EDGE_TRIM = 1.0       # soft head/tail the timeline drops anyway
BRIDGE_SEAM_MAD_WARN = 6.0           # first/last frame vs anchor (0-255 grey MAD); 7-8 already pops
BRIDGE_SEAM_RETRIES = 0              # one automatic re-roll when a seam is over the line; keep the best
BRIDGE_QUIET_WINDOW = 0.5            # anchor on the calmest frame within ±0.5s of the default point
BRIDGE_AUDIO_XFADE = 0.6             # neighbour-ambience crossfade around the switch point (s)
BRIDGE_TAIL = ("转场自然丝滑，真实电影感，不要跳切，不要人物漂移。人物为正常人眼、不发光。"
               "不要字幕，不额外加入对白字幕。无BGM、无配乐、无器乐、无旋律，只生成环境音与动作音。"
               "无人说话，画面中任何角色都不开口。")


def _bridge_prompt(method: str, duration: int, occluder: str, direction: str,
                   scene_from: str | None, scene_to: str | None, action: str | None) -> str:
    """Template per method, integer-second timeline, switch at duration/2 (2.5 honours
    integer timestamps; the notes' templates rewritten in the official blocked form)."""
    t_sw = max(1, int(round(duration / 2)))
    hold = max(1, t_sw - 1)
    a = "图片 1 的画面" + (f"（{scene_from}）" if scene_from else "")
    b = "图片 2 的场景" + (f"（{scene_to}）" if scene_to else "")
    if method == "occlusion":
        body = (f"图片 1 为首帧，图片 2 为尾帧，生成一段 {duration} 秒的遮挡转场。\n"
                f"0-{hold}s：延续{a}，人物保持原有动作与位置，固定机位不动。\n"
                f"{hold}-{t_sw}s：前景{occluder}{direction}入画，快速走过镜头前方，身体离镜头很近，"
                f"第 {t_sw}s 完全遮住整个画面。\n"
                f"{t_sw}-{t_sw + 1}s：{occluder}继续同向移出画面，露出{b}，人物位置与图片 2 一致。\n"
                f"{t_sw + 1}-{duration}s：画面稳定，与图片 2 完全相同。\n")
    elif method == "whip":
        body = (f"图片 1 为首帧，图片 2 为尾帧，生成一段 {duration} 秒的甩镜转场。\n"
                f"0-{hold}s：延续{a}，固定机位不动。\n"
                f"{hold}-{t_sw}s：镜头快速{direction}甩动，产生强烈的运动模糊，利用模糊隐藏切点；"
                f"第 {t_sw}s 模糊最强时切换到{b}。\n"
                f"{t_sw}-{t_sw + 1}s：镜头继续同方向甩入并逐渐减速。\n"
                f"{t_sw + 1}-{duration}s：画面稳定，与图片 2 完全相同。\n")
    else:  # action match
        act = action or "继续同一个动作"
        body = (f"图片 1 为首帧，图片 2 为尾帧，生成一段 {duration} 秒的动作相似转场。\n"
                f"0-{t_sw}s：延续{a}，人物{act}，动作节奏与运动方向保持连续。\n"
                f"第 {t_sw}s 在动作进行中直接切换到{b}，同一动作在新场景中不间断地继续，人物画面位置一致。\n"
                f"{t_sw}-{duration}s：动作完成，画面稳定，与图片 2 完全相同。\n")
    return body + BRIDGE_TAIL


def _bound_frame_path(clip: Path, out: Path, params: dict) -> tuple[Path, str]:
    """Chain/bridge frames are named by their derivation identity (source clip SHA + extraction
    parameters). A submitted (frozen) frame is reused only under the same identity; a re-rendered
    upstream clip or a moved bridge point lands on a new name instead of the old frame."""
    clip_sha = file_digest(clip)
    ident = digest({"clip_sha256": clip_sha, **params, "extractor_version": 1})[:16]
    return out.with_name(f"{out.stem}.{ident}{out.suffix}"), clip_sha


def _extract_frame_at(clip: Path, t: float, out: Path) -> Path:
    """One frame at t seconds (the handle point) — the bridge's strict first/last frame."""
    import subprocess
    from .file_contract import reuse_frozen_output
    out, clip_sha = _bound_frame_path(clip, out, {"seek": f"{max(0.0, t):.3f}", "mode": "frame_at"})
    if reuse_frozen_output(out):
        return out

    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        proc = subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-ss", f"{max(0.0, t):.3f}", "-i", str(clip),
             "-frames:v", "1", "-update", "1", "-q:v", "2", str(out)],
            capture_output=True, text=True, timeout=120,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise CreationError(f"frame extraction failed at {t:.2f}s of {clip}: {exc}") from exc
    if proc.returncode != 0 or not out.is_file() or out.stat().st_size == 0:
        raise CreationError(f"frame extraction failed at {t:.2f}s of {clip}: {proc.stderr[-200:]}")
    if file_digest(clip) != clip_sha:
        out.unlink(missing_ok=True)
        raise CreationError(f"source clip changed during frame extraction: {clip}")
    return out


def _quiet_time(clip: Path, center: float, half: float = BRIDGE_QUIET_WINDOW, fps: int = 12) -> float:
    """The calmest moment within [center-half, center+half]: least inter-frame motion. Bridges
    anchored on a still frame land exactly (0925: static anchors MAD 2-3, three men mid-stride
    MAD 7-8 and no time shift fixes it) — and a miss on a still frame is less visible anyway."""
    import subprocess
    import tempfile

    try:
        import numpy as np
        from PIL import Image
    except Exception:
        return center
    try:
        with tempfile.TemporaryDirectory(prefix="bridge-quiet-") as td:
            start = max(0.0, center - half)
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.3f}", "-t", f"{2 * half:.3f}",
                            "-i", str(clip), "-vf", f"fps={fps},scale=90:160", f"{td}/f%03d.png"],
                           capture_output=True, timeout=120, check=True)
            arrs = [np.asarray(Image.open(f).convert("L"), dtype=np.float32) for f in sorted(Path(td).glob("f*.png"))]
            if len(arrs) < 3:
                return center
            # motion at frame i = mean of the diffs to both neighbours (a still frame is quiet on both sides)
            best_i, best_m = None, None
            for i in range(1, len(arrs) - 1):
                m = float(np.abs(arrs[i] - arrs[i - 1]).mean() + np.abs(arrs[i + 1] - arrs[i]).mean()) / 2
                if best_m is None or m < best_m - 1e-6:
                    best_i, best_m = i, m
            return round(start + best_i / fps, 3) if best_i is not None else center
    except Exception:
        return center


def _bed_windows(dur_a: float, from_time: float, dur_b: float, to_time: float,
                 len_a: float, len_b: float) -> tuple[float, float]:
    'bed windows.'
    start_a = float(from_time)
    if dur_a and dur_a - start_a < len_a:
        start_a = max(0.0, dur_a - len_a)
    start_b = max(0.0, float(to_time) - len_b)
    return start_a, start_b


def _bridge_audio_bed(bridge: Path, clip_a: Path, from_time: float, clip_b: Path, to_time: float,
                      duration: float, switch_t: float | None, keep_original: Path) -> bool:
    """Replace the bridge's own video generator soundtrack with the neighbours' ambience.

    The bridge's audio is a third room tone spliced between two others — audible as a
    layer change at both seams even when the picture is seamless. The picture logic is
    "A's world continues, switch, B's world": the sound follows it. First part = A from
    the cut point onward (the handle we removed — silent of dialogue by the planning
    rule), second part = B up to its in-point, crossfaded over BRIDGE_AUDIO_XFADE at the
    measured switch. The original file is kept beside it for inspection.
    """
    import shutil
    import subprocess
    import tempfile

    # bed length follows the REAL clip (4.064s, not the nominal 4): -shortest below must never
    # clip the video — its last frame is the seam.
    duration = _probe_duration(bridge) or duration
    sw = float(switch_t) if switch_t and 0.3 < float(switch_t) < duration - 0.3 else duration / 2.0
    xf = BRIDGE_AUDIO_XFADE
    len_a = sw + xf / 2.0
    len_b = duration - sw + xf / 2.0
    dur_a = _probe_duration(clip_a) or 0.0
    dur_b = _probe_duration(clip_b) or 0.0
    start_a, start_b = _bed_windows(dur_a, from_time, dur_b, to_time, len_a, len_b)
    try:
        with tempfile.TemporaryDirectory(prefix="bridge-bed-") as td:
            a_wav, b_wav, bed = Path(td) / "a.wav", Path(td) / "b.wav", Path(td) / "bed.wav"
            # A: the ambience window ending no later than A's end (_bed_windows); apad only
            # guards a clip shorter than the window itself
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{start_a:.3f}", "-t", f"{len_a:.3f}", "-i", str(clip_a),
                            "-vn", "-af", f"apad=whole_dur={len_a:.3f}", "-ac", "2", "-ar", "48000", str(a_wav)],
                           capture_output=True, timeout=120, check=True)
            # B: the window leading into the in-point, shifted to start at 0 when the in-point is early
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{start_b:.3f}", "-t", f"{len_b:.3f}", "-i", str(clip_b),
                            "-vn", "-af", f"apad=whole_dur={len_b:.3f}", "-ac", "2", "-ar", "48000", str(b_wav)],
                           capture_output=True, timeout=120, check=True)
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(a_wav), "-i", str(b_wav), "-filter_complex",
                            f"[0:a][1:a]acrossfade=d={xf:.2f}:c1=tri:c2=tri,atrim=0:{duration + 0.1:.3f},apad=whole_dur={duration + 0.1:.3f}[a]",
                            "-map", "[a]", str(bed)], capture_output=True, timeout=120, check=True)
            if not bed.is_file() or bed.stat().st_size < 1000:
                return False
            shutil.copyfile(bridge, keep_original)
            out = Path(td) / "muxed.mp4"
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(bridge), "-i", str(bed), "-map", "0:v:0", "-map", "1:a:0",
                            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", str(out)],
                           capture_output=True, timeout=120, check=True)
            if not out.is_file() or out.stat().st_size < 10240:
                return False
            shutil.move(str(out), str(bridge))
            return True
    except Exception:
        return False


def _bridge_seam_check(clip: Path, first_anchor: Path, last_anchor: Path) -> dict:
    """Objective seam evidence: grey MAD of the bridge's first/last frame vs the two anchor
    frames (<8 = same frame), plus the lowest-contrast frame (full occlusion / blur peak)."""
    import subprocess
    import tempfile

    try:
        import numpy as np
        from PIL import Image
    except Exception:
        return {}
    try:
        with tempfile.TemporaryDirectory(prefix="bridge-seam-") as td:
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(clip), "-vf", "fps=4,scale=180:320",
                            f"{td}/f%03d.png"], capture_output=True, timeout=120, check=True)
            frames = sorted(Path(td).glob("f*.png"))
            if not frames:
                return {}
            grey = lambda p: np.asarray(Image.open(p).convert("L").resize((180, 320)), dtype=np.float32)  # noqa: E731
            arrs = [grey(f) for f in frames]
            a, b = grey(first_anchor), grey(last_anchor)
            std = [float(x.std()) for x in arrs]
            i_min = int(min(range(len(std)), key=std.__getitem__))
            return {"seam_first_mad": round(float(np.abs(arrs[0] - a).mean()), 1),
                    "seam_last_mad": round(float(np.abs(arrs[-1] - b).mean()), 1),
                    "switch_t": round(i_min / 4.0, 2), "min_frame_std": round(std[i_min], 1)}
    except Exception:
        return {}


def _apply_bridge_handles(shots: list, clips_doc: dict) -> list[str]:
    """creation_timeline_build helper: a bridge row must sit between its two sides, and the
    sides are cut exactly at the frames the bridge was anchored to (from_time / to_time).
    Fills missing trims; refuses trims that disagree — the seam only works at that frame."""
    rows = clips_doc.get("clips") if isinstance(clips_doc, dict) else clips_doc
    bridges = {str(r.get("shot_id")): r.get("bridge") for r in (rows or [])
               if isinstance(r, dict) and isinstance(r.get("bridge"), dict)}
    notes: list[str] = []
    for i, shot in enumerate(shots):
        if not isinstance(shot, dict):
            continue
        meta = bridges.get(str(shot.get("shot_id")))
        if not meta:
            continue
        prev = shots[i - 1] if i > 0 and isinstance(shots[i - 1], dict) else None
        nxt = shots[i + 1] if i + 1 < len(shots) and isinstance(shots[i + 1], dict) else None
        if prev is None or nxt is None or str(prev.get("shot_id")) != meta.get("from") or str(nxt.get("shot_id")) != meta.get("to"):
            raise CreationError(f"bridge {shot.get('shot_id')} must sit between {meta.get('from')} and {meta.get('to')} in the timeline")
        for side, key, want in ((prev, "trim_end", meta.get("from_time")), (nxt, "trim_start", meta.get("to_time"))):
            want = _num(want)
            have = _num(side.get(key))
            if want is None:
                continue
            if have is not None and have > 0 and abs(have - want) > 0.05:
                raise CreationError(f"{side.get('shot_id')}.{key}={have} but bridge {shot.get('shot_id')} was anchored at "
                                 f"{want:.3f}s — cut the side exactly at the anchor frame (or regenerate the bridge)")
            side[key] = round(want, 3)
            notes.append(f"{side.get('shot_id')}.{key} <- {want:.3f}s (bridge {shot.get('shot_id')} handle)")
        shot.setdefault("trim_start", 0.0)
        shot.pop("trim_end", None)          # the bridge always plays whole: both ends are the seams
        shot["speech_in_clip"] = False
    return notes

# ------------------------------------------------------- v13: back to v9 defaults
# User decision 2026-10-02, after watching all four films: v9's voice/consistency
# balance is still the best of them, so the pipeline ships v9 planning semantics
# again. The three switches below park the v11/v12 behaviour changes; each is a real
# finding whose side effect cost more than its gain:
#
# ENFORCE_NO_ISOLATED_SHOTS (v11): mandating a world reference on every scene
#   non-first shot took spatial 6 -> 9 and readability to 10, but the reference
#   CLIP's audio track rides along and video generator re-performs it onto this shot's
#   speaker: 37 voice rejections (v9: 4). The user heard that trade and reversed it.
#   Re-arm only with the audio problem solved at the source: prefer a SPEECH-FREE
#   upstream clip as the reference (the agent itself found this in v12 E03), or
#   replace the clip audio at assembly (mute_audio + TTS overlay already exist).
# ENFORCE_VOICE_FLOOR (v12): the one clean v12 win (thin_evidence 13 -> 0), parked
#   anyway so a default run is exactly v9 — it is advisory text the agent reads and
#   acts on, i.e. a behaviour change. creation_evidence's thin_evidence marking is NOT
#   parked: v9 shipped with it. Cheap to re-arm on its own.
# REQUIRE_LIGHT_WIND (v12): a real measured effect (key light flipped 180° across a
#   context reference), but it only ever fires on world-referenced shots, which the
#   v9 default does not create. Parked with its sibling.
ENFORCE_NO_ISOLATED_SHOTS = False
ENFORCE_VOICE_FLOOR = False
REQUIRE_LIGHT_WIND = False


def _load_cast(ctx: RunContext, args: dict) -> dict:
    """cast entries by name AND by id from the shotlist (default out/creation/shotlist.json)."""
    raw = args.get("shotlist_path") or "out/creation/shotlist.json"
    p = ctx.resolve(raw)
    if not p.is_file():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    out: dict = {}
    for c in (data.get("cast") or []) if isinstance(data, dict) else []:
        if isinstance(c, dict):
            for key in (c.get("name"), c.get("id")):
                if key:
                    out[str(key)] = c
    out["__shots__"] = {s.get("shot_id"): s for s in (data.get("shots") or [])
                        if isinstance(data, dict) and isinstance(s, dict)}
    out["__order__"] = [s.get("shot_id") for s in (data.get("shots") or [])
                        if isinstance(data, dict) and isinstance(s, dict) and s.get("shot_id")]
    # v4 sequences alongside v2/v3 shots, for lookups that only need the plan unit itself
    # (narration, speakers). Kept out of __shots__ on purpose: the appearance / continuity
    # injectors were tuned on per-shot plans and must not start rewriting sequence prompts.
    out["__plan__"] = data
    out["__units__"] = {}
    if isinstance(data, dict):
        for s in (data.get("shots") or []) + (data.get("sequences") or []):
            if isinstance(s, dict) and (s.get("shot_id") or s.get("sequence_id")):
                out["__units__"][str(s.get("shot_id") or s.get("sequence_id"))] = s
        out["__unit_order__"] = [str(s.get("sequence_id")) for s in (data.get("sequences") or [])
                                 if isinstance(s, dict) and s.get("sequence_id")]
    return out


def _plan_shot_id(shot: dict) -> str:
    """The directing-plan shot id, which is NOT the shot_id in versioned runs.

    `generate_takes` submits each take under its immutable take id, so anything that
    needs the plan (framing, continuity, dialogue/speaker) must look through it.
    """
    return _clean_name(shot.get("plan_shot_id")) or _clean_name(shot.get("shot_id"))


def _speakers_of(shot: dict, cast: dict) -> list[str]:
    sp = shot.get("speaker") or shot.get("speakers")
    if isinstance(sp, str) and sp.strip():
        return [sp.strip()]
    if isinstance(sp, list):
        return [str(x) for x in sp if x]
    sl_shot = (cast.get("__shots__") or {}).get(_plan_shot_id(shot)) or\
        (cast.get("__units__") or {}).get(_plan_shot_id(shot)) or {}
    names = [str(d.get("speaker")) for d in sl_shot.get("dialogue") or []
             if isinstance(d, dict) and d.get("speaker")]
    narr = sl_shot.get("narration")
    if isinstance(narr, dict) and narr.get("speaker") and str(narr["speaker"]) not in names:
        names.append(str(narr["speaker"]))  # inner monologue rides in-clip: its speaker anchors the voice too
    return names


def _resolve_voice_ref(ctx: RunContext, shot: dict, cast: dict) -> tuple[Path | None, str | None]:
    """Explicit shot.voice_ref wins; otherwise the speaker's cast.voice_card. Returns
    (path, error). A speaking shot without any voice anchor is an error, not a silent
    fallback — v6 shipped 44 speaking shots with voice_ref=None and the timbre drifted
    per shot."""
    vr_raw = _clean_name(shot.get("voice_ref"))
    if vr_raw:
        vr = ctx.resolve(vr_raw)
        return (vr, None) if vr.is_file() else (None, f"voice_ref not found: {vr}")
    speakers = _speakers_of(shot, cast)
    for name in speakers:
        entry = cast.get(name) or {}
        # voice_card: a sample in the character's fixed preset voice (TTS test line or
        # best verified take).
        card = entry.get("voice_card")
        if card:
            p = ctx.resolve(str(card))
            if p.is_file():
                return p, None
            return None, f"voice_card of {name} not found: {p}"
    if speakers:
        return None, (f"speaking shot ({'/'.join(speakers)}) has no voice_ref and the cast has no "
                      "voice_card for the speaker — set cast[].voice_card (TTS test line or best "
                      "verified take) or pass voice_ref; establish a valid voice reference before generation")
    return None, ("speaking shot but the speaker is unknown (no shot.speaker and no shotlist "
                  "dialogue) — cannot resolve a voice card; pass voice_ref or speaker")


def _flat(v: Any) -> str:
    if isinstance(v, (list, tuple)):
        return "、".join(str(x) for x in v)
    return str(v)


def _state_appearance(entry: dict, state_id: Any) -> str:
    """Appearance text for a cast member, honouring the shot's declared state.

    A character with a `states` library (exile/armour/wounded) must not be
    described by the default sheet once the shot says they are in another state.
    """
    if state_id:
        for st in entry.get("states") or []:
            if isinstance(st, dict) and str(st.get("id")) == str(state_id):
                txt = str(st.get("appearance") or st.get("note") or "").strip()
                if txt:
                    return txt
    return str(entry.get("appearance") or "").strip()


def _appearance_block(prompt: str, names: list[str], cast: dict,
                      sl_shot: dict) -> tuple[str, list[str]]:
    """Spell the bound characters' looks out IN THE VIDEO PROMPT (v10/A1).

    The keyframe prompt already carries every character's full appearance; the
    video prompt carried nothing but `@Name`. Close framings therefore had only
    a neutral full-body studio card constraining the face and hair, and drifted.

    TODO (0922 官方指南对齐, 重开前必做): 本函数注入的是「【形象锁定】…」行首标签,
    但【】是 video generator 官方的**字幕语法** (四符号全被占用: () 音乐 / <> 音效 /
    {} 台词 / 【】 字幕)。INJECT_APPEARANCE 重新打开之前, 必须把 head 改成无括号
    的行首标签 (例如「形象锁定：…」), 否则整段会被当成要烧进画面的字幕。
    """
    size = str(sl_shot.get("shot_size") or "")
    close = any(k in size for k in _CLOSE_SIZES)
    raw_states = sl_shot.get("cast_states")
    states = raw_states if isinstance(raw_states, dict) else {}
    lines: list[str] = []
    notes: list[str] = []
    used = 0
    for name in names:
        c = cast.get(name)
        if not isinstance(c, dict):
            continue
        sid = states.get(str(c.get("id") or "")) or states.get(name)
        traits = "、".join(str(t) for t in (c.get("traits") or []) if t)
        text = (_state_appearance(c, sid) if close else traits) or traits
        if not text:
            text = str(c.get("epithet") or "").strip()
        if not text or text[:14] in prompt:
            continue
        if used + len(text) > _APPEARANCE_BUDGET:
            text = traits or text
            if not text or used + len(text) > _APPEARANCE_BUDGET:
                notes.append(f"appearance for {name} dropped (budget)")
                continue
        lines.append(f"{name}：{text}")
        used += len(text)
    if not lines:
        return "", notes
    head = "【形象锁定】以下描述优先于参考卡的姿态与背景，人物相貌、发型、服装、随身物必须与之逐项一致："
    notes.append(f"appearance inlined for {len(lines)} ({'close' if close else 'wide'})")
    return head + "；".join(lines) + "。", notes


def _continuity_block(sl_shot: dict, prev_shot: dict | None) -> tuple[str, list[str]]:
    'continuity block.'
    cont = sl_shot.get("continuity") if isinstance(sl_shot.get("continuity"), dict) else {}
    entry = cont.get("entry_state") if isinstance(cont.get("entry_state"), dict) else {}
    if not entry:
        return "", []
    allowed = [str(a) for a in (cont.get("allowed_changes") or []) if a]
    scene_change = str(cont.get("cut_type") or "") == "scene_change"
    prev_cont = (prev_shot or {}).get("continuity") if isinstance(prev_shot, dict) else {}
    prev_exit = (prev_cont or {}).get("exit_state") if isinstance(prev_cont, dict) else {}
    prev_exit = prev_exit if isinstance(prev_exit, dict) else {}
    keep, fresh = [], []
    for k, v in entry.items():
        vs = _flat(v)
        if not scene_change and k in prev_exit and _flat(prev_exit[k]) == vs:
            keep.append(f"{k}={vs}")
        else:
            fresh.append(f"{k}={vs}")
    bits = []
    if keep:
        bits.append("与上一镜完全一致、不得改变：" + "；".join(keep))
    if fresh:
        bits.append(("本场起始状态：" if scene_change else "本镜起始状态：") + "；".join(fresh))
    if allowed:
        bits.append("本镜内允许发生的变化仅限：" + "；".join(allowed))
    else:
        bits.append("本镜内不发生任何服装、伤痕、光线或环境状态的变化")
    return "承接状态：" + "；".join(bits) + "。", [
        f"continuity injected ({len(keep)} kept / {len(fresh)} declared)"]


_STATE_SYNTAX_RE = re.compile(r"[{}<>（）()【】]")


def _music_cue(unit: dict) -> str:
    """The unit's music cue, or "" when this unit gets no music.

    Accepts a bare string or `{cue|text|description}`; anything else is treated as absent
    rather than guessed at, because a wrong cue is worse than none — it would lift the ban
    and then ask the generator for music nobody described.
    """
    raw = (unit or {}).get("music")
    if isinstance(raw, str):
        return raw.strip()
    if isinstance(raw, dict):
        for k in ("cue", "text", "description"):
            v = raw.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()
    return ""


def _order_cards_by_entrance(refs: list[dict], unit: dict, cast: dict) -> tuple[list[dict], list[str]]:
    """Re-order the character cards into the order those characters first speak.

    The guide's FAQ on 角色对应错误 says to upload references in order of first appearance and
    keep the prompt's numbering in step, or the model swaps who is who. v41 uploaded cards in
    cast-declaration order instead: in U11 燕姨娘 was Image 1 but the fifth character to appear,
    while 沈夫人 was Image 3 and the first — and the audio slots were numbered off the dialogue,
    so image N and audio N pointed at different people.

    Reads the plan's unit for the same reason _audio_speakers does: the caller's shots[] row
    carries no `dialogue`, so asking it for the speaking order silently returns nothing.

    Only the `card:` entries move, and only relative to each other; plates, keyframes and frame
    roles keep their positions. Cards for characters with no line keep their relative order
    behind the speaking ones.
    """
    cards = [(i, r) for i, r in enumerate(refs)
             if r.get("role") == "reference_image" and str(r.get("label") or "").startswith("card:")]
    if len(cards) < 2:
        return refs, []
    order: list[str] = []
    for line in unit.get("dialogue") or []:
        if isinstance(line, dict):
            who = str(line.get("speaker") or "").strip()
            if who and who not in order:
                order.append(who)
    if not order:
        return refs, []
    id_of = {str(m.get("name") or ""): str(m.get("id") or "")
             for m in cast.values() if isinstance(m, dict)}
    rank = {id_of[w]: n for n, w in enumerate(order) if id_of.get(w)}
    if not rank:
        return refs, []
    slots = [i for i, _ in cards]
    before = [str(r.get("label") or "") for _, r in cards]
    ranked = sorted(cards, key=lambda pair: (rank.get(str(pair[1].get("label") or "")[5:], len(rank)),
                                             slots.index(pair[0])))
    after = [str(r.get("label") or "") for _, r in ranked]
    if before == after:
        return refs, []
    out = list(refs)
    for slot, (_, r) in zip(slots, ranked):
        out[slot] = r
    return out, [f"cards re-ordered by first line: {before} -> {after}"]


def _audio_speakers(unit: dict, n_audio: int, inner_decl: dict | None) -> list[str]:
    """Who each reference_audio belongs to, in upload order.

    Read from the PLAN's unit, not from the shots[] row the caller passed. Both describe the
    same shot, but the caller's row carries only what generation needs — on 11-02 it held
    `dialogue_audio` (the paths) and no `dialogue` (who speaks them), so deriving owners from
    it found nobody, the count never matched, and every sequence declared its images with
    `audio owners unresolved`. The plan unit is where the cast speaks.

    The convention this relies on is the one the upload loop implements: one file per speaking
    character, in the order the characters first speak, with the inner monologue (when
    attached) last. Returns [] when the counts do not line up, so a wrong binding is never
    declared — a missing declaration is recoverable, a wrong one is not.
    """
    speakers: list[str] = []
    for line in unit.get("dialogue") or []:
        if not isinstance(line, dict):
            continue
        who = str(line.get("speaker") or "").strip()
        if who and who not in speakers:
            speakers.append(who)
    if inner_decl is not None:
        inner_who = str(inner_decl.get("speaker") or "").strip()
        tail = inner_who or "（心声）"
        expected = len(speakers) + 1
        if expected != n_audio:
            return []
        return speakers + [tail]
    return speakers if len(speakers) == n_audio else []


def _material_map(refs: list[dict], dialogue_audios: list, unit: dict, cast: dict,
                  inner_decl: dict | None, gnotes: dict) -> tuple[str, list[str]]:
    """The official 素材绑定 sentence: every image/audio numbered and bound to a character.

    Written because the guide calls this out as 非常重要 and warns against leaving the mapping
    implicit in upload order — which is exactly what we were doing. Only bindings that can be
    derived are declared; anything unresolved is simply left out of the sentence.
    """
    items: list[str] = []
    notes: list[str] = []
    name_of = {str(m.get("id")): str(m.get("name") or m.get("id") or "")
               for m in cast.values() if isinstance(m, dict) and m.get("id")}
    audio_speakers = _audio_speakers(unit, len(dialogue_audios), inner_decl)
    voice_slot = {who: i + 1 for i, who in enumerate(audio_speakers)}
    img_no = 0
    seen: set[str] = set()
    for r in refs:
        if r.get("role") != "reference_image":
            continue
        img_no += 1
        label = str(r.get("label") or "")
        if label.startswith("card:"):
            who = name_of.get(label[5:]) or label[5:]
            if not who or who in seen:
                continue
            seen.add(who)
            slot = voice_slot.get(who)
            items.append(gnotes["material_map_image_voice"].format(n=img_no, who=who, a=slot)
                         if slot else gnotes["material_map_image"].format(n=img_no, who=who))
        elif label.startswith("plate:"):
            items.append(gnotes["material_map_plate"].format(n=img_no, what=label[6:] or "该"))
    for i, who in enumerate(audio_speakers, 1):
        if inner_decl is not None and i == len(audio_speakers):
            continue          # the inner monologue gets its own, more specific declaration
        items.append(gnotes["material_map_audio"].format(a=i, who=who))
    if not items:
        return "", notes
    bound = sum(1 for x in items if "音频" in x or "Audio" in x)
    notes.append(f"material map declared: {img_no} image(s), {len(dialogue_audios)} audio, "
                 f"{bound} image/audio voice binding(s)"
                 + ("" if audio_speakers or not dialogue_audios
                    else " — audio owners unresolved, images only"))
    return gnotes["material_map_head"].format(items="；".join(items)), notes


def _sequence_continuity_note(unit: dict, prev_unit: dict | None) -> tuple[str, list[str]]:
    """The planned world state of a v4 sequence as one plain prompt line.

    「与上一段结尾一致」 for facts that match the previous same-scene sequence's exit_state,
    「本段开场时」 for the rest, 「本段内只允许以下变化」 from allowed_changes, 「本段结束时」 for
    exit facts that differ from the entry — the official skill's own segment shape (开始状态 →
    事件 → 结束时可观察状态) and its 「全过程保持…连续」 wording. Only declared facts are stated
    (the official skill: do not add constraints nobody asked for). Braces, angle brackets and
    parentheses are stripped from the values: they are the official dialogue / sound / music
    syntax and would be performed.
    """
    cont = unit.get("continuity") if isinstance(unit.get("continuity"), dict) else {}
    entry = cont.get("entry_state") if isinstance(cont.get("entry_state"), dict) else {}
    exit_ = cont.get("exit_state") if isinstance(cont.get("exit_state"), dict) else {}
    allowed = [str(a).strip() for a in (cont.get("allowed_changes") or []) if str(a or "").strip()]
    if not entry and not exit_:
        return "", []

    def clean(v: object) -> str:
        s = str(v).replace("（", "，").replace("(", "，")      # keep the aside readable: 攥紧（不戴上）→ 攥紧，不戴上
        return _STATE_SYNTAX_RE.sub("", s).strip().strip("，").rstrip("。；;")

    same_world = (isinstance(prev_unit, dict) and prev_unit.get("scene_id") == unit.get("scene_id")
                  and cont.get("cut_type") not in ("ellipsis", "scene_change"))
    prev_cont = (prev_unit or {}).get("continuity") if same_world else None
    prev_cont = prev_cont if isinstance(prev_cont, dict) else {}
    # where the previous sequence ENDS: its entry state updated by its exit state
    prev_exit = {**(prev_cont.get("entry_state") if isinstance(prev_cont.get("entry_state"), dict) else {}),
                 **(prev_cont.get("exit_state") if isinstance(prev_cont.get("exit_state"), dict) else {})}
    keep = [k for k in entry if k in prev_exit and clean(prev_exit[k]) == clean(entry[k])]
    fresh = [k for k in entry if k not in keep]
    ends = [k for k in exit_ if clean(exit_[k]) != clean(entry.get(k, ""))]
    bits: list[str] = []
    if keep:
        bits.append("与上一段结尾一致、不得改变：" + "；".join(f"{k}：{clean(entry[k])}" for k in keep))
    if fresh:
        bits.append("本段开场时：" + "；".join(f"{k}：{clean(entry[k])}" for k in fresh))
    if allowed:
        bits.append("本段内只允许以下变化：" + "；".join(clean(a) for a in allowed))
    if ends:
        bits.append("本段结束时：" + "；".join(f"{k}：{clean(exit_[k])}" for k in ends))
    if entry:
        bits.append("除此之外，上述状态全段保持不变" if (allowed or ends) else "以上状态全段保持不变")
    return "承接状态：" + "；".join(bits) + "。", [
        f"sequence continuity injected ({len(keep)} carried / {len(fresh)} declared / {len(ends)} exit)"]


def _augment_prompt(prompt: str, shot: dict, cast: dict, has_dialogue: bool) -> tuple[str, list[str]]:
    """Text-level identity redundancy and constraints that cost nothing:
    1. epithet inline — every `@Name` that is not already followed by a parenthesised
       description gets `（epithet）` appended (character epithet; survives card pruning);
    2. explicit no-speech negation for non-dialogue shots (models otherwise invent lip flap);
    3. numeric scale sentence when two cast members with `physique` share the frame
       (v6 dragon/rider proportions swung shot to shot with only adjectives to go on)."""
    notes: list[str] = []
    mentioned: list[str] = []
    # Match against the real cast names, longest first. The old generic pattern read
    # "@卫沉舟骑在" as one name (it only stops at punctuation, a space or another @)
    # and then failed the cast lookup — so on real prompts, which write
    # "@卫沉舟骑在@绯梭背上", the epithet was never inlined at all.
    names = sorted((n for n in cast if not n.startswith("__")), key=len, reverse=True)
    new = prompt
    for name in names:
        c = cast.get(name)
        if not isinstance(c, dict) or f"@{name}" not in new:
            continue
        if name not in mentioned:
            mentioned.append(name)
        ep = str(c.get("epithet") or "").strip()
        if not ep:
            continue
        pieces = new.split(f"@{name}")
        rebuilt = pieces[0]
        for tail in pieces[1:]:
            rebuilt += (f"@{name}" if tail[:1] in ("（", "(") else f"@{name}（{ep}）") + tail
        new = rebuilt
    if new != prompt:
        notes.append("epithet inlined")
    # cast bound via character_ids also count for scale even if not @-mentioned
    sl_shot = (cast.get("__shots__") or {}).get(_plan_shot_id(shot)) or {}
    for cid in sl_shot.get("character_ids") or []:
        c = cast.get(str(cid))
        if c and c.get("name") and c["name"] not in mentioned:
            mentioned.append(c["name"])
    def _size(c: dict) -> float | None:
        ph = c.get("physique") or {}
        for k in ("height_m", "length_m", "body_length_m"):
            v = ph.get(k)
            if isinstance(v, (int, float)) and v > 0:
                return float(v)
        return None
    sized = [(n, _size(cast[n])) for n in mentioned if cast.get(n) and _size(cast[n])]
    if len(sized) >= 2 and "尺度" not in new:
        parts = []
        for n, s in sized:
            ph = cast[n].get("physique") or {}
            dims = [f"{k.replace('_m', '')}{v}米" for k, v in ph.items()
                    if k.endswith("_m") and isinstance(v, (int, float))]
            parts.append(f"{n}{'/'.join(dims) if dims else ''}")
        big, small = max(sized, key=lambda x: x[1]), min(sized, key=lambda x: x[1])
        ratio = round(big[1] / small[1], 1)
        new = new.rstrip("。 ") + f"。尺度：{'，'.join(parts)}；{big[0]}约为{small[0]}的{ratio}倍，比例全程保持不变。"
        notes.append(f"scale sentence added ({big[0]}:{small[0]}={ratio})")
    if not has_dialogue and not any(m in new for m in _NO_SPEECH_MARKERS):
        new = new.rstrip("。 ") + "。无人说话，画面中任何角色都不开口、不做说话的口型。"
        notes.append("no-speech negation added")
    # A1: the looks themselves, not just the label (close framings get the full
    # appearance, wider ones the trait list).
    if INJECT_APPEARANCE:
        app, app_notes = _appearance_block(new, mentioned, cast, sl_shot)
        notes.extend(app_notes)
        if app:
            new = new.rstrip("。 ") + "。" + app
    # A3: the planned world state carried across the cut.
    if INJECT_CONTINUITY:
        order = cast.get("__order__") or []
        sid = _plan_shot_id(shot)
        prev_shot = None
        if sid in order:
            i = order.index(sid)
            if i > 0:
                prev_shot = (cast.get("__shots__") or {}).get(order[i - 1])
        cont, cont_notes = _continuity_block(sl_shot, prev_shot)
        notes.extend(cont_notes)
        if cont:
            new = new.rstrip("。 ") + "。" + cont
    return new, notes


def _alternate_card(ref: dict, used: set[str]) -> dict | None:
    """When video generator flags a card as a real person, swap in the same character's other
    view (side/back) instead of generating with no card at all."""
    path = ref.get("path")
    if not isinstance(path, Path):
        return None
    m = _CARD_VIEW_RE.match(path.name)
    if not m:
        return None
    stem, cur, ext = m.group(1), m.group(2), m.group(3)
    for view in ("side", "back", "front"):
        if view == cur:
            continue
        cand = path.with_name(f"{stem}_{view}{ext}")
        if cand.is_file() and str(cand) not in used:
            return {"role": ref["role"], "path": cand, "label": f"{ref.get('label') or stem}:{view}",
                    "source": str(cand)}
    return None


def _ledger(ctx: RunContext) -> dict:
    try:
        from ve_tools.creation_evidence import load_ledger
        return load_ledger(ctx)
    except Exception:  # noqa: BLE001
        return {}


def _ledger_final(ledger: dict, sid: str) -> bool:
    e = ledger.get(sid)
    return isinstance(e, dict) and (e.get("status") or e.get("verdict")) in ("pass", "mute_audio")


def _extract_last_frame(clip: Path, out: Path) -> Path:
    """Grab the final frame of a rendered clip as the seed for a chained segment.

    The previous segment's closing pixels are the strongest possible condition
    for visual continuity — stronger than any reference sheet.
    """
    import subprocess
    from .file_contract import reuse_frozen_output
    out, clip_sha = _bound_frame_path(clip, out, {"mode": "last_frame", "sseof": ["-0.25", "-1.0"]})
    if reuse_frozen_output(out):
        return out

    out.parent.mkdir(parents=True, exist_ok=True)
    for seek in ("-0.25", "-1.0"):
        try:
            proc = subprocess.run(
                ["ffmpeg", "-y", "-v", "error", "-sseof", seek, "-i", str(clip),
                 "-frames:v", "1", "-update", "1", "-q:v", "2", str(out)],
                capture_output=True, text=True, timeout=120,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise CreationError(f"last-frame extraction failed for {clip.name}: {exc}") from exc
        if proc.returncode == 0 and out.is_file() and out.stat().st_size > 1024:
            if file_digest(clip) != clip_sha:
                out.unlink(missing_ok=True)
                raise CreationError(f"source clip changed during last-frame extraction: {clip.name}")
            return out
    raise CreationError(
        f"last-frame extraction produced no frame for {clip.name}: {proc.stderr[:200]}"
    )


def _image_short_side(path: Path) -> int | None:
    """Short side in pixels, or None when the image cannot be read."""
    try:
        from PIL import Image

        with Image.open(path) as im:
            return min(im.size)
    except Exception:
        pass
    try:
        import subprocess

        proc = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
             "stream=width,height", "-of", "csv=p=0:s=x", str(path)],
            capture_output=True, text=True, timeout=60,
        )
        w, h = (int(v) for v in proc.stdout.strip().split("x")[:2])
        return min(w, h)
    except Exception:
        return None


def _plan_canvas_orientation(ctx: RunContext, args: dict) -> str | None:
    """'portrait_916' / 'landscape_169' from the shotlist canvas, None when unknown or near-square."""
    path = ctx.resolve(str(args.get("shotlist_path") or "out/creation/shotlist.json"))
    if not path.is_file():
        return None
    try:
        canvas = (json.loads(path.read_text(encoding="utf-8")) or {}).get("canvas") or {}
    except (OSError, ValueError):
        return None
    w, h = canvas.get("width"), canvas.get("height")
    if not isinstance(w, (int, float)) or not isinstance(h, (int, float)) or not w or not h:
        return None
    if h >= w * 1.3:
        return "portrait_916"
    if w >= h * 1.3:
        return "landscape_169"
    return None


def _plan_cast(ctx: RunContext, args: dict) -> list[dict]:
    """The shotlist's cast list; [] when the plan is absent or unreadable."""
    path = ctx.resolve(str(args.get("shotlist_path") or "out/creation/shotlist.json"))
    if not path.is_file():
        return []
    try:
        plan = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    cast = plan.get("cast") if isinstance(plan, dict) else None
    return [c for c in cast if isinstance(c, dict)] if isinstance(cast, list) else []


def _plan_style_bible(ctx: RunContext, args: dict) -> str:
    """The shotlist's style_bible (explicit args.style_bible wins); '' when absent."""
    explicit = str(args.get("style_bible") or "").strip()
    if explicit:
        return explicit
    path = ctx.resolve(str(args.get("shotlist_path") or "out/creation/shotlist.json"))
    if not path.is_file():
        return ""
    try:
        plan = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return ""
    return str(plan.get("style_bible") or "").strip() if isinstance(plan, dict) else ""


STYLE_BIBLE_NOTE = "补充说明（全片基准）：{bible}"
# Inner monologue in-clip (official grammar: a speaker can sit 画外; audio references carry
# timbre + lines). Declared right after the agent's 音频说明 so Audio N has an owner and a
# rule: heard, not spoken by any mouth on screen.
INNER_VOICE_NOTE = (
    "音频说明补充：Audio {n} 是{who}的心声（画外音），只在 Shot {shot} 内响起，不是任何人当场说出的话；"
    "这段声音响起时{who_short}嘴唇紧闭、不做说话口型，画面中其他人物也不开口。"
    "Audio {n} 的音色与该角色说台词时的音色是同一个人。"
)


def _selected_clip_path(ctx: RunContext, out_dir: str, sid: str) -> Path:
    """The clip that stands for `sid` today: the row in out/creation/clips.json (selected take,
    e.g. SEQ2_take4.mp4) when present, else the plain <out_dir>/<sid>.mp4."""
    clips_doc = ctx.resolve("out/creation/clips.json")
    if clips_doc.is_file():
        try:
            rows = json.loads(clips_doc.read_text(encoding="utf-8"))
            rows = rows.get("clips") if isinstance(rows, dict) else rows
            for row in rows or []:
                if isinstance(row, dict) and str(row.get("shot_id") or row.get("sequence_id") or "") == sid:
                    cand = ctx.resolve(str(row.get("clip") or ""))
                    if cand.is_file():
                        return cand
        except (OSError, ValueError):
            pass
    return ctx.resolve(f"{out_dir}/{sid}.mp4")


def _plan_prompt_of(ctx: RunContext, args: dict, sid: str) -> str:
    """The shotlist prompt of shot/sequence `sid` (video_prompt for shots[], prompt for
    sequences[]), '' when unknown — feeds the wide-shot gate of the tail-frame reference."""
    path = ctx.resolve(str(args.get("shotlist_path") or "out/creation/shotlist.json"))
    if not path.is_file():
        return ""
    try:
        plan = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return ""
    for item in (plan.get("shots") or []) + (plan.get("sequences") or []):
        if isinstance(item, dict) and str(item.get("shot_id") or item.get("sequence_id") or "") == sid:
            return str(item.get("video_prompt") or item.get("prompt") or "")
    return ""


_SHOT_BLOCK_RE = re.compile(r"Shot\s*\d+\s*[（(]")
_PROMPT_SECTION_RE = re.compile(r"\n(参考图说明|音频说明|补充说明|尺度|画幅|人物为|不要字幕|无BGM|以图片)")


def _last_shot_block(prompt: str) -> str:
    'last shot block.'
    text = prompt or ""
    hits = list(_SHOT_BLOCK_RE.finditer(text))
    if not hits:
        return text
    block = text[hits[-1].start():]
    cut = _PROMPT_SECTION_RE.search(block)
    return block[:cut.start()] if cut else block


def _silent_world_reference(ctx: RunContext, out_dir: str, upstream_id: str,
                            shot_id: str, upstream_prompt: str,
                            clip_path: Path | None = None) -> tuple[dict | None, str]:
    """A speaking shot's world reference, with no audio attached (v12 / MUTE_REFERENCE_VIDEO).

    Returns ({reference_image entry}, note) when the upstream clip's last frame can
    stand in for the clip, or (None, reason) when the gate refuses it and the caller
    must keep the video reference. `clip_path` overrides the default <out_dir>/<id>.mp4
    (v4 sequences keep their selected take under a _takeN name).
    """
    hit = [m for m in WIDE_SHOT_MARKERS if m in _last_shot_block(upstream_prompt or "")]
    if hit:
        return None, (f"upstream {upstream_id} is a wide shot {hit} in its last Shot block; its last "
                      "frame has no usable face pixels (09-21: a wide tail frame produced a different person)")
    prev_clip = clip_path or ctx.resolve(f"{out_dir}/{upstream_id}.mp4")
    if not prev_clip.is_file():
        return None, f"upstream clip {upstream_id}.mp4 is not on disk"
    try:
        tail = _extract_last_frame(
            prev_clip, ctx.resolve(f"{out_dir}/chain_seeds/{shot_id}_world_ref_tail.png"))
    except CreationError as exc:
        return None, f"last-frame extraction failed: {str(exc)[:120]}"
    short = _image_short_side(tail)
    if short is not None and short < TAIL_REF_MIN_SHORT_SIDE:
        return None, (f"upstream tail frame is {short}px on the short side "
                      f"(<{TAIL_REF_MIN_SHORT_SIDE}); too coarse to carry the world")
    return ({"role": "reference_image", "path": tail,
             "label": f"world_tail:{upstream_id}", "source": ctx.virtualize(tail)},
            f"world reference muted: {upstream_id} last frame as reference_image "
            "(the upstream clip's audio carried the previous speaker's line)")


def _download_video(url: str, target: Path, expected_seconds: float | None) -> None:
    """Stream a complete clip to a temporary file, verify bytes/duration, then publish atomically."""
    import tempfile
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, raw = tempfile.mkstemp(prefix='.download-', suffix=target.suffix, dir=target.parent)
    __import__('os').close(fd)
    part = Path(raw)
    routes: list[tuple[str, requests.Session, dict | None]] = [("direct", _DIRECT, None)]
    proxy = clean_env("VE_DOWNLOAD_PROXY", "HTTPS_PROXY", "HTTP_PROXY")
    if proxy:
        forced = requests.Session()
        forced.trust_env = False
        routes.append(("configured download proxy", forced, {"http": proxy, "https": proxy}))
    last = "no route attempted"
    for label, session, proxies in routes:
        try:
            # Fast-fail beats patience here: a stalled TLS handshake to the CDN
            # once held batches for 900s each and starved the whole session's
            # continuation rounds. Fail in seconds; the retry/rescue layers own
            # recovery.
            with session.get(url, timeout=(30, 60), stream=True, proxies=proxies) as resp:
                resp.raise_for_status()
                expected_bytes = int(resp.headers.get("Content-Length") or 0)
                with open(part, "wb") as fh:
                    for chunk in resp.iter_content(1 << 20):
                        fh.write(chunk)
            size = part.stat().st_size
            if expected_bytes and size != expected_bytes:
                last = f"{label}: truncated at {size}/{expected_bytes} bytes"
                continue
            dur = _probe_duration(part)
            if not dur or (expected_seconds and dur < expected_seconds * 0.5):
                last = f"{label}: clip unreadable or too short (probe={dur})"
                continue
            part.replace(target)
            return
        except Exception as exc:  # noqa: BLE001 — every route failure must fall through
            last = f"{label}: {str(exc)[:200]}"
            continue
        finally:
            part.unlink(missing_ok=True)
    part.unlink(missing_ok=True)
    raise CreationError(f"clip download failed on all routes; last: {last}")


def _persist_task_id(ctx: RunContext, out_dir: str, shot_id: str, task_id: str) -> None:
    """Sidecar map shot_id -> latest task_id, so a later call can re-fetch the
    upstream's presigned URL (24h) and keep chains in video_ref mode even when
    the upstream clip was reused from disk. Caller holds the batch lock."""
    path = ctx.resolve(f"{out_dir}/task_ids.json")
    from .creation_takes import read_object, write_object
    data = read_object(path)  # Corrupt evidence must remain intact and block resubmission.
    if any(not isinstance(v, str) or not v for v in data.values()):
        raise ValueError(f"invalid task id ledger: {path}")
    data[shot_id] = task_id
    write_object(path, data)
    takes_path = path.with_name("takes.json")
    book = read_object(takes_path)
    record = book.get("takes", {}).get(shot_id)
    if record is not None:
        record.update(task_id=task_id, status="submitted")
        write_object(takes_path, book)


def _poll(prof: dict, task_id: str) -> dict:
    """One status read of a submitted video task; transport failures become CreationError."""
    try:
        return gens.poll(prof, task_id)
    except gens.ProviderError as exc:
        raise CreationError(str(exc)) from None


def _url_from_task_id(task_id: str, prof: dict | None = None) -> str | None:
    try:
        st = _poll(prof or gens.profile(), task_id)
    except CreationError:
        return None
    return st.get("video_url") if st.get("status") == "succeeded" else None


def _await_existing_task(prof: dict, task_id: str,
                         max_wait: float, poll_interval: float) -> tuple[str | None, str, str | None]:
    """Collect an already submitted task: poll it like a fresh submission until it is
    ready, terminal or the wait budget ends. Returns (video_url, failure_stage, error)."""
    deadline = time.time() + max_wait
    while True:
        try:
            st = _poll(prof, task_id)
        except CreationError as exc:
            return None, "poll", f"status poll failed: {str(exc)[:300]}; retry this take to keep collecting task {task_id}"
        status = str(st.get("status") or "").lower()
        if status == "succeeded":
            if st.get("video_url"):
                return st["video_url"], "download", None
            return None, "download", "succeeded without video_url"
        if status in ("failed", "cancelled", "canceled", "expired"):
            err = st.get("error")
            detail = err if isinstance(err, str) else json.dumps(err, ensure_ascii=False)
            return None, "generate", (f"submitted task {task_id} ended {status}: {str(detail)[:400]}; "
                                      "this take cannot be recovered, use a new take_id")
        if time.time() >= deadline:
            return None, "poll", (f"task {task_id} still {status or 'pending'} after {max_wait:g}s; "
                                  "retry this take to keep collecting it")
        time.sleep(poll_interval)

def generate_video_candidates(args: dict, ctx: RunContext) -> ToolResult:
    """Versioned candidates for new runs; preserve the legacy call shape."""
    shots = args.get("shots")
    if isinstance(shots, list) and any(isinstance(s, dict) and s.get("take_id") for s in shots):
        from ve_tools.creation_takes import generate_takes

        prepared = dict(args, model=args.get("model") or _video_cfg()[2])
        try:
            return generate_takes(prepared, ctx, _generate_video_candidates)
        except (ValueError, OSError) as exc:
            raise CreationError(str(exc)) from exc
    if ctx.resolve(f"{args.get('output_dir') or 'out/creation/clips'}/takes.json").is_file():
        raise CreationError("this output_dir is versioned; supply take_id and the existing run budget on every request")
    return _generate_video_candidates(args, ctx)


def _swap_state_cards(ctx: RunContext, refs: list[dict], unit: dict, cast: dict,
                      aug_notes: list[str]) -> list[dict]:
    """⑤ 状态卡替换挂载: 计划单元 cast_states 绑定的状态有自己的卡时, 请求
    reference_images 里同角色的**基础身卡/背卡**被就地替换为状态版——不叠加、
    不占新参考位。头像永不替换 (脸靠头像锁, 状态不改变身份)。agent 直接挂
    状态卡路径时本函数天然 no-op (路径对不上基础卡就不动)。"""
    states = unit.get("cast_states") if isinstance(unit, dict) else None
    if not isinstance(states, dict) or not states or not refs:
        return refs
    swapped: list[str] = []
    for r in refs:
        label = str(r.get("label") or "")
        cid = label[5:] if label.startswith("card:") else ""
        member = cast.get(cid) if cid else None
        if not isinstance(member, dict) or not r.get("path"):
            continue
        st = next((s for s in member.get("states") or []
                   if isinstance(s, dict) and str(s.get("id")) == str(states.get(cid))), None)
        if not st:
            continue
        for kind in ("image", "image_side", "image_back"):  # 身卡与背卡; 头像不参与
            base = member.get(kind)
            if not base:
                continue
            try:
                if ctx.resolve(str(base)) != r["path"]:
                    continue
            except Exception:
                continue
            new = st.get(kind)
            if not new:
                continue
            newp = ctx.resolve(str(new))
            if newp.is_file():
                r["path"] = newp
                r["source"] = ctx.virtualize(newp)
                swapped.append(f"{member.get('name')}{'背卡' if kind == 'image_back' else '身卡'}->{st.get('id')}")
    if swapped:
        aug_notes.append("state cards swapped per cast_states: " + ", ".join(swapped))
    return refs


def _unit_clip_target(ctx: RunContext, out_dir: str, unit_id: str) -> Path:
    """<out_dir>/<unit_id>.mp4, refused unless it lands directly inside output_dir."""
    from .creation_planning import safe_unit_id
    target = ctx.resolve(f"{out_dir}/{safe_unit_id(unit_id)}.mp4")
    if target.parent != ctx.resolve(out_dir):
        raise CreationError(f"clip target escapes output_dir: {unit_id!r}")
    return target


def _generate_video_candidates(args: dict, ctx: RunContext) -> ToolResult:
    'drama video generate.'
    shots = args.get("shots")
    if not isinstance(shots, list) or not shots:
        raise CreationError("shots must be a non-empty array")
    # Unit ids become file names (<out_dir>/<id>.mp4, chain_seeds/<id>_*.png); the legacy
    # no-take_id path must reject `../` and separators before any path is built.
    from .creation_planning import safe_unit_id
    for shot in shots:
        if not isinstance(shot, dict):
            continue
        bridge = shot.get("bridge") if isinstance(shot.get("bridge"), dict) else {}
        for raw in (shot.get("shot_id"), shot.get("continues_from"), bridge.get("from"), bridge.get("to")):
            if _clean_name(raw):
                try:
                    safe_unit_id(_clean_name(raw))
                except ValueError as exc:
                    raise CreationError(f"{exc}: {_clean_name(raw)!r}") from exc
    prof = gens.profile(args.get("model"))
    base = gens.ENDPOINT_LABEL
    default_model = prof["model"]
    try:
        gens.require_channel()
    except gens.ProviderError as exc:
        raise CreationError(str(exc)) from None
    model = args.get("model") or default_model
    prof = gens.profile(model) if gens.resolve_name(model) else gens.profile()
    gnotes = gens.notes(prof)
    resolution = gens.resolution_for(prof, args.get("resolution") or prof["default_resolution"])
    # ratio 优先级: 调用方显式 > shotlist canvas 推断 > adaptive (官方默认)。
    # 旧默认硬编码 16:9 — 短剧(9:16)管线忘传参就出横屏, 与 prompt 约束打架。
    from .creation_takes import read_object
    ratio = gens.effective_ratio(read_object(ctx.resolve(args.get('shotlist_path') or 'out/creation/shotlist.json')), args.get('ratio'))
    # Default off: per-clip model audio has no cross-shot voice identity and no
    # continuous music bed. Route dialogue through tts_generate instead.
    # Default true: video generator's per-clip audio is the ambient/SFX bed. Dialogue still comes
    # from TTS; SKILL rule 5 gates any clip whose audio carries intelligible speech.
    # The video generator (ZCode ToolHub) produces silent clips; audio generation is fixed off.
    generate_audio = False
    out_dir = args.get("output_dir") or "out/creation/clips"
    force = bool(args.get("force", False))
    workers = max(1, min(int(_num(args.get("concurrency")) or 4), 10))
    poll_interval = _num(args.get("poll_interval_seconds")) or 10.0
    max_wait = _num(args.get("timeout_seconds")) or 2400.0
    # v7 hard constraints (see helpers above). Each has an explicit override so a
    # deliberate exception is visible in the call, never a silent default.
    cast = _load_cast(ctx, args)
    ledger = _ledger(ctx)
    allow_missing_voice_ref = False
    allow_cardless = False
    allow_unverified_upstream = False
    force_budget = False
    augment = bool(args.get("augment_prompt", True))

    results: list[dict] = []
    failures: list[dict] = []
    url_by_shot: dict[str, str] = {}  # fresh presigned video_url per generated shot
    lock = threading.Lock()

    def bridge_one(shot: dict, shot_id: str, bridge: dict) -> bool:
        """Scene-change bridge (see BRIDGE_* above): strict first/last frame from the two
        neighbours' handle points, templated prompt, no cards, no audio refs."""
        def fail(err: str, **extra) -> bool:
            with lock:
                failures.append({"shot_id": shot_id, "stage": "bridge", "error": err, **extra})
            return False
        method = str(bridge.get("method") or "occlusion")
        if method not in BRIDGE_METHODS:
            return fail(f"bridge.method must be one of {list(BRIDGE_METHODS)} "
                        "(相似构图 is a multi-keyframe world-hop, not a two-clip bridge)")
        frm, to = _clean_name(bridge.get("from")), _clean_name(bridge.get("to"))
        if not frm or not to or frm == to:
            return fail("bridge.from / bridge.to must name the outgoing and incoming shots (two different ids)")
        clip_a, clip_b = _selected_clip_path(ctx, out_dir, frm), _selected_clip_path(ctx, out_dir, to)
        for sid, cp in ((frm, clip_a), (to, clip_b)):
            if not cp.is_file():
                return fail(f"bridge side {sid}: no clip on disk ({cp}) — generate and select BOTH neighbours "
                            "first; bridges are Phase 5.5, after the sequences they join")
        dur_a, dur_b = _probe_duration(clip_a), _probe_duration(clip_b)
        if not dur_a or not dur_b:
            return fail("cannot probe the neighbour clips' durations")
        handle = float(_num(bridge.get("handle_seconds")) or BRIDGE_HANDLE_SECONDS)
        duration = int(round(_num(shot.get("duration")) or BRIDGE_DURATION_SECONDS))
        duration = max(int(SHOT_MIN_SECONDS), min(8, duration))
        if 2 * handle >= duration - 0.5:
            return fail(f"handle {handle}s x2 leaves no room for the switch in a {duration}s bridge")
        anchor_notes: list[str] = []
        from_time = _num(bridge.get("from_time"))
        if from_time is None:
            want = dur_a - BRIDGE_DEFAULT_EDGE_TRIM - handle
            from_time = min(_quiet_time(clip_a, want), dur_a - 0.1)
            if abs(from_time - want) > 0.02:
                anchor_notes.append(f"from_time snapped {want:.2f}s -> {from_time:.2f}s (calmest frame)")
        to_time = _num(bridge.get("to_time"))
        if to_time is None:
            want = BRIDGE_DEFAULT_EDGE_TRIM + handle
            to_time = max(_quiet_time(clip_b, want), 0.1)
            if abs(to_time - want) > 0.02:
                anchor_notes.append(f"to_time snapped {want:.2f}s -> {to_time:.2f}s (calmest frame)")
        if not 0 <= from_time < dur_a - 0.05:
            return fail(f"from_time {from_time:.2f}s is outside {frm} ({dur_a:.2f}s)")
        if not 0.05 < to_time <= dur_b:
            return fail(f"to_time {to_time:.2f}s is outside {to} ({dur_b:.2f}s)")
        target = _unit_clip_target(ctx, out_dir, shot_id)
        seeds = ctx.resolve(f"{out_dir}/chain_seeds")
        try:
            frame_a = _extract_frame_at(clip_a, from_time, seeds / f"{shot_id}_from_{frm}.png")
            frame_b = _extract_frame_at(clip_b, to_time, seeds / f"{shot_id}_to_{to}.png")
        except CreationError as exc:
            return fail(str(exc)[:300])
        occluder = str(bridge.get("occluder") or "一名穿深色衣服的路人的背影")
        direction = str(bridge.get("direction") or ("向右" if method == "whip" else "从左向右"))
        prompt = str(shot.get("prompt") or "").strip() or _bridge_prompt(
            method, duration, occluder, direction, bridge.get("scene_from"), bridge.get("scene_to"), bridge.get("action"))
        meta = {"from": frm, "to": to, "method": method, "from_time": round(from_time, 3),
                "to_time": round(to_time, 3), "handle_seconds": handle,
                "from_clip": ctx.virtualize(clip_a), "to_clip": ctx.virtualize(clip_b),
                "first_frame": ctx.virtualize(frame_a), "last_frame": ctx.virtualize(frame_b)}
        if target.is_file() and target.stat().st_size > 10240 and not force and _probe_duration(target):
            with lock:
                results.append({"shot_id": shot_id, "clip": ctx.virtualize(target), "duration": duration,
                                "reused": True, "dropped_refs": [], "bridge": meta})
            return True
        content = [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": _data_url(frame_a)}, "role": "first_frame"},
            {"type": "image_url", "image_url": {"url": _data_url(frame_b)}, "role": "last_frame"},
        ]
        # Production contract; see video-creation references for rationale.
        body = gens.build_body(prof, model, content, duration, resolution, None, generate_audio, frame_mode=True)
        def roll(attempt: int) -> tuple[dict | None, str, dict, str]:
            """One submission -> (state, url, seams, task_id) with the clip landed at `target`,
            or raises CreationError / Blocked."""
            try:
                tid = gens.submit(prof, body)
            except gens.ProviderError as exc:
                raise CreationError(str(exc)[:600])
            with lock:
                _persist_task_id(ctx, out_dir, shot_id, tid)
            deadline = time.time() + max_wait
            polls = 0
            while time.time() < deadline:
                st = _poll(prof, tid)
                state = {**(st.get("raw") or {}), "usage": st.get("usage"), "error": st.get("error")}
                polls += 1
                status = st.get("status")
                if status == "succeeded":
                    url = st.get("video_url")
                    if not url:
                        raise CreationError("succeeded without video_url")
                    target.parent.mkdir(parents=True, exist_ok=True)
                    _download_video(url, target, duration)
                    state["_polls"] = polls
                    return state, url, _bridge_seam_check(target, frame_a, frame_b), tid
                if status == "failed":
                    err = state.get("error")
                    raise CreationError(str(err if isinstance(err, str) else json.dumps(err, ensure_ascii=False))[:600])
                time.sleep(poll_interval)
            raise CreationError(f"timed out after {max_wait}s")

        def worst(seams: dict) -> float:
            return max(float(seams.get("seam_first_mad", 0) or 0), float(seams.get("seam_last_mad", 0) or 0))

        best: tuple | None = None          # (state, url, seams, task_id)
        rolls: list[str] = []
        last_err: str | None = None
        for attempt in range(1 + BRIDGE_SEAM_RETRIES):
            try:
                got = roll(attempt)
            except Blocked as exc:
                return fail("content_blocked", provider_message=str(exc)[:600])
            except CreationError as exc:
                last_err = str(exc)[:600]
                if best is not None:
                    break
                continue
            rolls.append(f"roll {attempt + 1}: seams {got[2].get('seam_first_mad')}/{got[2].get('seam_last_mad')}")
            # every roll lands at `target`; keep the best one aside so a worse re-roll cannot overwrite it
            if best is None or (got[2] and worst(got[2]) < worst(best[2])):
                best = got
                best_copy = target.with_name(f"{shot_id}_best.mp4")
                best_copy.write_bytes(target.read_bytes())
            if not got[2] or worst(got[2]) <= BRIDGE_SEAM_MAD_WARN:
                break                       # seams clean (or unmeasurable): no re-roll
        if best is None:
            return fail(last_err or "bridge generation failed")
        state, url, seams, task_id = best
        best_file = target.with_name(f"{shot_id}_best.mp4")
        if best_file.is_file():
            best_file.replace(target)       # the winning roll is what ships under the shot id
        # sound follows the picture logic: A's ambience -> crossfade at the switch -> B's ambience.
        # The bridge's own video generator track (a third room tone) would be heard as a layer change.
        bed_ok = _bridge_audio_bed(target, clip_a, from_time, clip_b, to_time, float(duration),
                                   seams.get("switch_t") if seams else None,
                                   target.with_name(f"{shot_id}_generated_audio.mp4"))
        meta["audio"] = "neighbour_bed" if bed_ok else "generated"
        notes = anchor_notes + [
            f"bridge {method}: {frm}@{from_time:.2f}s -> {to}@{to_time:.2f}s, handle {handle}s, "
            f"net screen +{duration - 2 * handle:.1f}s; cut {frm} at {from_time:.2f}s and start {to} at {to_time:.2f}s"]
        if len(rolls) > 1:
            notes.append("seam re-roll: " + "; ".join(rolls) + " — kept the best")
        notes.append("audio: neighbours' ambience crossfaded at the switch (video generator track kept in "
                     f"{shot_id}_generated_audio.mp4)" if bed_ok else
                     "audio: neighbour bed failed, bridge keeps its own video generator track — expect a room-tone step")
        if seams and worst(seams) > BRIDGE_SEAM_MAD_WARN:
            notes.append(f"SEAM WARNING: bridge ends drift from the anchor frames {seams} after {len(rolls)} roll(s) — "
                         "the cut will show; regenerate with a stiller anchor (from_time/to_time) or hard-cut")
        record = {"shot_id": shot_id, "clip": ctx.virtualize(target), "duration": duration,
                  "reused": False, "task_id": task_id, "polls": state.get("_polls"), "dropped_refs": [],
                  "refs_used": 2, "usage": state.get("usage"),
                  "bridge": {**meta, **seams, "from_time": round(from_time, 3), "to_time": round(to_time, 3)},
                  "prompt_notes": notes}
        with lock:
            results.append(record)
            url_by_shot[shot_id] = url
        return True

    def one(shot: dict, chain_seed: Path | None = None,
            chain_video_url: str | None = None) -> bool:
        from .creation_planning import effective_cast
        current_cast = dict(cast)
        current_cast["__base_cast__"] = cast
        unit = current_cast.get("__units__", {}).get(_plan_shot_id(shot)) or {} if isinstance(shot, dict) else {}
        for member in effective_cast(current_cast.get("__plan__", {}), unit):
            for key in (member.get("id"), member.get("name")):
                if key:
                    current_cast[str(key)] = member
        return one_effective(shot, current_cast, chain_seed, chain_video_url)

    def one_effective(shot: dict, cast: dict, chain_seed: Path | None = None,
                      chain_video_url: str | None = None) -> bool:
        if not isinstance(shot, dict):
            with lock:
                failures.append({"shot_id": None, "error": "shot is not an object"})
            return False
        shot_id = _clean_name(shot.get("shot_id"))
        if shot_id and isinstance(shot.get("bridge"), dict):
            return bridge_one(shot, shot_id, shot["bridge"])
        prompt = str(shot.get("prompt") or shot.get("video_prompt") or "").strip()
        if not shot_id or not prompt:
            with lock:
                failures.append({"shot_id": shot_id or None,
                                 "error": "shot_id and prompt are required"})
            return False
        cont = _clean_name(shot.get("continues_from"))
        duration = _num(shot.get("duration")) or 5.0
        if duration > prof["max_seconds"] + 1e-6:
            with lock:
                failures.append({"shot_id": shot_id, "stage": "duration",
                                 "error": f"{duration:g}s asked but {prof['name']} generates at most "
                                          f"{prof['max_seconds']}s per request — split the sequence at a Shot boundary"})
            return False
        duration = max(float(prof["min_seconds"]), min(float(prof["max_seconds"]), round(duration)))
        target = _unit_clip_target(ctx, out_dir, shot_id)

        # Ledger-driven regeneration: a `regenerate` verdict means the file on disk is
        # the rejected take — it must not be reused. `exhausted` means the retry budget
        # Creation production support.
        led = ledger.get(shot_id) if isinstance(ledger.get(shot_id), dict) else {}
        led_status = led.get("status") or led.get("verdict")
        shot_force = force
        if led_status == "exhausted" and not force_budget:
            with lock:
                failures.append({"shot_id": shot_id, "stage": "budget",
                                 "error": f"retry budget exhausted after {led.get('rounds')} rounds "
                                          "(verified.json); reselect, edit or replan; this candidate remains failed"})
            return False
        if led_status == "regenerate" and target.is_file() and shot.get("take_id"):
            with lock:
                failures.append({"shot_id": shot_id, "error": "candidate failed review; preserve this take and create a new take_id"})
            return False
        if led_status == "regenerate" and target.is_file():
            rnd = int(led.get("rounds") or 0)
            backup = target.with_name(f"{shot_id}_r{rnd}.mp4")
            if not backup.exists():
                target.rename(backup)
            else:
                target.unlink(missing_ok=True)
            shot_force = True

        # Speech-with-picture mode (v5): the shot's synthesized dialogue audio
        # rides along as reference_audio, so video generator renders the character
        # Production contract; see video-creation references for rationale.
        # spoken verbatim, male TTS voice kept, mouth tracks the rhythm).
        # One file per speaking character, in the prompt's Audio order (official cap: 10
        # references, 30s total); a single path is still accepted. Each file becomes its own
        # reference_audio below — the SKILL's Audio 1/2/3 numbering needs separate uploads
        # Production contract; see video-creation references for rationale.
        dialogue_audios: list[Path] = []
        _da_field = shot.get("dialogue_audio")
        _da_items = _da_field if isinstance(_da_field, list) else ([_da_field] if _da_field else [])
        for _da_item in _da_items:
            da_raw = _clean_name(_da_item)
            if not da_raw:
                continue
            da_path = ctx.resolve(da_raw)
            if da_path.is_file():
                dialogue_audios.append(da_path)
            else:
                with lock:
                    failures.append({"shot_id": shot_id,
                                     "error": f"dialogue_audio not found: {da_path}"})
                return False
        # Inner monologue rides IN-CLIP (the official 画外 slot). The plan's narration.audio (the
        # TTS inner line, same seed as the character's lines) becomes one more reference_audio,
        # declared below as the speaker's 心声/画外音 with lips closed, so video generator performs it in
        # Production contract; see video-creation references for rationale.
        # Production contract; see video-creation references for rationale.
        # the same man's in-clip speech (another register of an unstable clone). Per-shot
        # opt-out inner_in_clip=false keeps the legacy overlay path.
        inner_decl: dict | None = None
        _unit = (cast.get("__units__") or {}).get(_plan_shot_id(shot)) or {}
        _narr = _unit.get("narration") if isinstance(_unit.get("narration"), dict) else None
        _inner_raw = _clean_name(shot.get("inner_audio")) or (_clean_name(_narr.get("audio")) if _narr else "")
        _inner_on = str(shot.get("inner_in_clip", True)).lower() not in ("false", "0", "no")
        if _inner_raw and _inner_on:
            if not _narr or not str(_narr.get("line") or "").strip():
                with lock:
                    failures.append({"shot_id": shot_id, "stage": "inner_audio",
                                     "error": "inner_audio given but the plan declares no narration for this "
                                              "shot — declare shotlist narration {speaker, line, shot, audio} first"})
                return False
            _inner_p = ctx.resolve(_inner_raw)
            if not _inner_p.is_file():
                with lock:
                    failures.append({"shot_id": shot_id, "stage": "inner_audio",
                                     "error": f"inner monologue audio not found: {_inner_p}"})
                return False
            dialogue_audios.append(_inner_p)
            inner_decl = {"index": len(dialogue_audios), "speaker": str(_narr.get("speaker") or ""),
                          "shot": _narr.get("shot"), "line": str(_narr.get("line") or "").strip()}
        if len(dialogue_audios) > prof["max_audio"]:
            with lock:
                failures.append({"shot_id": shot_id,
                                 "error": f"{len(dialogue_audios)} dialogue_audio files — {prof['name']} accepts "
                                          f"at most {prof['max_audio']} reference audios (incl. an in-clip inner "
                                          "monologue): concatenate two speakers' lines or split the sequence"})
            return False
        dialogue_audio: Path | None = dialogue_audios[0] if dialogue_audios else None
        voice_ref: Path | None = None
        if dialogue_audio is not None:
            voice_ref, vr_err = _resolve_voice_ref(ctx, shot, cast)
            if voice_ref is None and not allow_missing_voice_ref:
                with lock:
                    failures.append({"shot_id": shot_id, "stage": "voice_ref", "error": vr_err})
                return False
        if augment:
            prompt, aug_notes = _augment_prompt(prompt, shot, cast, dialogue_audio is not None)
        else:
            aug_notes = []
        edit_from = _clean_name(shot.get("edit_from"))
        if edit_from:
            # Edit channel: the rejected take itself becomes the reference video and the
            # prompt asks for a correction, so composition/scene/identity carry over and
            # only the named defect changes. Cheaper and more stable than a fresh roll.
            sidecar = ctx.resolve(f"{out_dir}/task_ids.json")
            from .creation_takes import read_object
            tid = read_object(sidecar).get(edit_from)
            edit_url = _url_from_task_id(tid, prof) if tid else None
            if not edit_url:
                with lock:
                    failures.append({"shot_id": shot_id, "stage": "edit_from",
                                     "error": f"edit_from={edit_from}: no reusable server-side URL "
                                              "(task id missing/expired) — regenerate instead"})
                return False
            chain_video_url = edit_url
            chain_seed = None
            prompt = ("以参考视频为基础做编辑修正：保持其场景、构图、光线、角色造型与运镜不变，"
                      "只修正下述内容。" + prompt)
            aug_notes.append(f"edit_from {edit_from}")

        motion_ref = _clean_name(shot.get("motion_ref"))
        if motion_ref and chain_video_url is None:
            # v9 motion card: a previously generated signature-action clip rides
            # along as reference_video so the character MOVES the same way across
            # independent shots (how the dragon flies, how the blade is drawn).
            # Only one video reference is used per request: chaining/edit_from
            # win; a motion_ref alongside them is skipped with a note.
            sidecar_mc = ctx.resolve(f"{out_dir}/task_ids.json")
            from .creation_takes import read_object
            tid_mc = read_object(sidecar_mc).get(motion_ref)
            mc_url = _url_from_task_id(tid_mc, prof) if tid_mc else None
            if mc_url:
                chain_video_url = mc_url
                aug_notes.append(f"motion_ref {motion_ref}")
            else:
                with lock:
                    failures.append({"shot_id": shot_id, "stage": "motion_ref",
                                     "error": f"motion_ref={motion_ref}: no reusable server-side "
                                              "URL — generate the motion card first (or drop the "
                                              "field and rely on cards/keyframe)"})
                return False
        elif motion_ref:
            aug_notes.append(f"motion_ref {motion_ref} skipped (chained/edited shot uses its own video reference)")

        if target.is_file() and target.stat().st_size > 10240 and not shot_force:
            # Size alone is not integrity: a truncated download passes >10KiB.
            if _probe_duration(target):
                with lock:
                    results.append({"shot_id": shot_id, "clip": ctx.virtualize(target),
                                    "duration": duration, "reused": True, "dropped_refs": [],
                                    **({"chained_from": cont} if cont else {})})
                return True
            target.unlink(missing_ok=True)  # corrupt leftover — regenerate

        # A prior call may have generated this shot server-side without landing
        # the file (download route down). Reuse that result instead of
        # regenerating it.
        if not shot_force:
            sidecar = ctx.resolve(f"{out_dir}/task_ids.json")
            from .creation_takes import read_object
            prev_tid = read_object(sidecar).get(shot_id) or shot.get('_recover_task_id')
            if prev_tid and shot.get("take_id"):
                # Immutable candidate with a submitted task: keep polling that task (it may
                # still be queued/running after an earlier poll failure); never resubmit.
                url, stage, err = _await_existing_task(prof, prev_tid, max_wait, poll_interval)
                if not url:
                    with lock:
                        failures.append({"shot_id": shot_id, "stage": stage, "task_id": prev_tid,
                                         "error": err})
                    return False
            elif prev_tid:
                url = _url_from_task_id(prev_tid, prof)
            if prev_tid:
                if url:
                    with lock:
                        url_by_shot[shot_id] = url
                    target.parent.mkdir(parents=True, exist_ok=True)
                    try:
                        _download_video(url, target, duration)
                    except CreationError as exc:
                        with lock:
                            failures.append({"shot_id": shot_id, "stage": "download",
                                             "task_id": prev_tid, "generated": True,
                                             "error": str(exc)[:300]})
                        return True
                    with lock:
                        results.append({"shot_id": shot_id, "clip": ctx.virtualize(target),
                                        "duration": duration, "reused": True,
                                        "task_id": prev_tid, "dropped_refs": [],
                                        **({"chained_from": cont} if cont else {})})
                    return True
                if shot.get("take_id"):
                    with lock:
                        failures.append({"shot_id": shot_id, "stage": "resume", "task_id": prev_tid,
                                         "error": "existing task has no ready URL; retry this take to poll/recover, or use a new take_id after confirming task failure"})
                    return False

        # v12: a SPEAKING shot must not receive a second voice. The world reference is
        # the upstream CLIP, whose audio track holds the previous speaker's line, and
        # video generator re-performs reference audio instead of copying it (v11: 37 voice
        # rejections). The clip cannot be muted in flight — the API refuses an inlined
        # data-uri ("reference_video must be provided as a web url", HTTP 400, verified
        # 2026-09-22) and exposes no ignore-audio field — so the world travels as the
        # upstream's last frame instead, as `reference_image` (NOT `first_frame`: the
        # camera must stay free). edit_from / motion_ref keep their clip: the video IS
        # the instruction there; they only get the official picture-only declaration.
        world_tail: dict | None = None
        muted_ref = False
        if (MUTE_REFERENCE_VIDEO and chain_video_url is not None
                and dialogue_audio is not None):
            source_id = edit_from or motion_ref or cont
            if edit_from or motion_ref:
                prompt = gnotes["picture_only_ref"] + "\n" + prompt
                aug_notes.append(
                    f"picture-only declaration (video reference {source_id} is the edit/motion instruction)")
            else:
                up_prompt = ((cast.get("__shots__") or {}).get(
                    _TAKE_SUFFIX_RE.sub("", source_id)) or {}).get("video_prompt") or ""
                try:
                    declared = _resolve_refs(ctx, shot, prof)
                except CreationError:
                    declared = []
                if any(r["role"] in FRAME_ROLES for r in declared) or len(declared) >= MAX_REFERENCE_IMAGES:
                    # No room (or first_frame mode, which excludes reference images).
                    world_tail, why = None, ("this shot's own reference images leave no slot "
                                             "for the upstream tail frame")
                else:
                    world_tail, why = _silent_world_reference(
                        ctx, out_dir, source_id, shot_id, str(up_prompt))
                if world_tail is not None:
                    chain_video_url = None
                    muted_ref = True
                    aug_notes.append(why)
                else:
                    prompt = gnotes["picture_only_ref"] + "\n" + prompt
                    aug_notes.append(
                        f"world reference kept unmuted, picture-only declaration only: {why}")

        if chain_video_url is not None:
            # Continuation via the upstream clip itself (verified: identity 10/10
            # vs 6/10 for a bare last-frame seed) — the video carries world and
            # motion, the declared cards keep identity pinned. Both may travel
            # in one request (unlike first_frame, which excludes references).
            try:
                refs = _resolve_refs(ctx, shot, prof)
            except CreationError:
                refs = []
            refs = [r for r in refs if r["role"] == "reference_image"][:3]
            refs = _swap_state_cards(ctx, refs, _unit, cast.get("__base_cast__", cast), aug_notes)
            declared_refs = 0
        elif chain_seed is not None:
            # Fallback continuation: upstream clip has no reachable URL (reused
            # from disk, task expired). video generator rejects first_frame mixed with
            # reference_image, so identity lives in the prompt text alone.
            refs = [{
                "role": "first_frame", "path": chain_seed,
                "label": "prev_last_frame", "source": ctx.virtualize(chain_seed),
            }]
            declared_refs = len(shot.get("reference_images") or [])
        else:
            declared_refs = 0
            try:
                refs = _resolve_refs(ctx, shot, prof)
                refs = _swap_state_cards(ctx, refs, _unit, cast.get("__base_cast__", cast), aug_notes)
            except CreationError as exc:
                with lock:
                    failures.append({"shot_id": shot_id, "error": str(exc)})
                return False
        if world_tail is not None:
            # The muted world reference rides with the cards (checked for room above).
            refs.append(world_tail)
        # Cross-act continuity: a chain head may cite the previous act's closing shot;
        # its last frame rides along as one more reference image (not first_frame, so
        # the cards still travel) — the world/lighting/prop state carries over instead
        # of restarting from a keyframe painted in isolation (v6 A2S01: dragon flew
        # back to the tower it had just left; the fisherman vanished).
        # Keyframes (official 多关键帧参考, strict form): ordered stills ride after the agent's
        # cards/plate as reference_image and the prompt's FIRST sentence declares the range —
        # 「以图片 x 至图片 y 的顺序作为关键帧」. Only for staging-critical sequences (validate_plan
        # nags otherwise); a chained first_frame take cannot carry them (mixed roles are refused).
        kf_raw = shot.get("keyframes") or []
        if kf_raw:
            if chain_seed is not None or any(r["role"] in FRAME_ROLES for r in refs):
                with lock:
                    failures.append({"shot_id": shot_id, "stage": "keyframes",
                                     "error": "keyframes need reference_image mode; this shot is a first_frame chain segment"})
                return False
            kf_paths: list[Path] = []
            kf_shots: list["int | None"] = []
            for raw in kf_raw:
                shot_no: "int | None" = None
                path_raw: object = raw
                if isinstance(raw, dict):
                    # {shot, image}: 稀疏覆盖的显式归属 — path 取 image, 镜号记 shot
                    shot_no = raw.get("shot")
                    path_raw = raw.get("image")
                rp = ctx.resolve(_clean_name(path_raw))
                if not rp.is_file():
                    with lock:
                        failures.append({"shot_id": shot_id, "stage": "keyframes", "error": f"keyframe not found: {rp}"})
                    return False
                kf_paths.append(rp)
                kf_shots.append(shot_no if isinstance(shot_no, int) and not isinstance(shot_no, bool) else None)
            if len(kf_paths) > KEYFRAMES_MAX_PER_SEQUENCE:
                # 1012: 计划期这只是提醒 (6 是经验值, 不是服务限制), 生成期原先却判失败;
                # 真正的硬限制是下面的参考图总张数
                aug_notes.append(f"{len(kf_paths)} keyframes > {KEYFRAMES_MAX_PER_SEQUENCE} (advisory): many stills "
                                 "constrain the model; keep only the staging-critical Shots if takes look over-fit")
            room = MAX_REFERENCE_IMAGES - len(refs) - (1 if _clean_name(shot.get("continuity_from")) else 0)
            if len(kf_paths) > room:
                with lock:
                    failures.append({"shot_id": shot_id, "stage": "keyframes",
                                     "error": f"{len(kf_paths)} keyframes do not fit: {len(refs)} cards/plates already attached "
                                              f"(limit {MAX_REFERENCE_IMAGES} images incl. tail frame)"})
                return False
            first_no = sum(1 for r in refs if r["role"] == "reference_image") + 1
            for i, rp in enumerate(kf_paths, 1):
                refs.append({"role": "reference_image", "path": rp, "label": f"keyframe:{i}", "source": ctx.virtualize(rp)})
            last_no = first_no + len(kf_paths) - 1
            if all(s is not None for s in kf_shots):
                # 逐张归属 (稀疏覆盖): 首句逐张声明哪张图是哪个 Shot 的起始画面,
                # 而不是只给范围 — 图数<镜数时范围声明会让模型瞎猜归属
                decl = "；".join(gnotes["keyframe_shot"].format(a=first_no + j, m=s)
                                 for j, s in enumerate(kf_shots)) + "。"
                aug_notes.append(f"{len(kf_paths)} keyframe(s) attached as 图片 {first_no}-{last_no}, "
                                 f"per-Shot attribution declared in the first sentence")
            else:
                decl = (gnotes["keyframe_one"].format(a=first_no) if first_no == last_no
                        else gnotes["keyframe_range"].format(a=first_no, b=last_no))
                aug_notes.append(f"{len(kf_paths)} keyframe(s) attached as 图片 {first_no}-{last_no}, declared in the first sentence")
            prompt = decl + prompt.lstrip()
        # 素材绑定 + 开头的音频约束, 都必须落在提示词最前面 (官方: 映射关系说明非常重要;
        # 音频约束开头与结尾各写一遍)。放在关键帧声明之后、其余增补之前。
        # 先按首次出场重排角色卡 —— 编号必须和出场顺序一致, 否则绑定声明本身就是错的。
        # 说话人只能从 plan 的 unit 取: 调用方传的 shots[] 行没有 dialogue 字段。
        refs, _ord_notes = _order_cards_by_entrance(refs, _unit, cast)
        aug_notes.extend(_ord_notes)
        _map_line, _map_notes = _material_map(refs, dialogue_audios, _unit, cast, inner_decl, gnotes)
        if _map_line and "素材绑定" not in prompt:
            prompt = _map_line + "\n" + prompt.lstrip()
            aug_notes.extend(_map_notes)
        # Music is banned per unit unless the plan asks for it. The blanket ban protected
        # dialogue clarity, and it worked — too well: argon listed 「缺背景音乐」 as a hard
        # defect on both v43 and v45. A unit that declares `music` gets a permitting guard
        # plus the cue, written with the official prompt syntax (music in (), effects in <>,
        # lines in {}, titles in 【】) and a duck-under-speech constraint.
        # A generator that returns silent clips renders neither: no guard, no cue — the
        # prompt keeps its length for the picture, and music comes in as bgm at assembly.
        _audio_out = prof.get("audio_out", True)
        _cue = _music_cue(_unit) if _audio_out else ""
        if not _audio_out and _music_cue(_unit):
            aug_notes.append("music cue not sent: the generator returns silent clips "
                             "(add the music as bgm in creation_timeline_build)")
        _guard = gnotes.get("audio_guard_music_head" if _cue else "audio_guard_head") if _audio_out else None
        if _guard and "音频约束" not in prompt:
            prompt = _guard + "\n" + prompt.lstrip()
            aug_notes.append("audio guard declared at the head (repeated at the tail)"
                             + (" — music permitted" if _cue else ""))
        if _cue and "音乐：" not in prompt:
            prompt = prompt.rstrip("\n") + "\n" + gnotes["music_cue"].format(cue=_cue)
            aug_notes.append(f"music cue declared: {_cue[:40]}")
        # Style bible: the film's locked visual language rides in every sequence's 补充说明 block
        # (official: 贯穿始终的细节放结尾). Skipped when the agent already wrote it in.
        _bible = _plan_style_bible(ctx, args)
        if _bible and _bible[:12] not in prompt:
            prompt = prompt.rstrip("\n") + "\n" + gnotes["style_bible"].format(bible=_bible)
            aug_notes.append("style_bible appended")
        if inner_decl is not None:
            _who = inner_decl["speaker"] or "主角"
            _cid = str((cast.get(_who) or {}).get("id") or "")
            _img_no = None
            for _i, _r in enumerate([r for r in refs if r.get("role") == "reference_image"], 1):
                if _cid and str(_r.get("label") or "") == f"card:{_cid}":
                    _img_no = _i
                    break
            if _img_no:
                _who_full = f"Image {_img_no} 中的角色（{_who}）"
            else:
                _who_full = _who
            prompt = prompt.rstrip("\n") + "\n" + gnotes["inner_voice"].format(
                n=inner_decl["index"], who=_who_full, who_short=_who, shot=inner_decl["shot"] or "对应")
            aug_notes.append(f"inner monologue of {_who} attached as Audio {inner_decl['index']} "
                             f"(画外音, lips closed on Shot {inner_decl['shot']})")
        # 承接状态 (v4 sequences only; the agent may also write the line itself)
        if INJECT_SEQUENCE_CONTINUITY and _unit.get("sequence_id") and "承接状态" not in prompt:
            _order = cast.get("__unit_order__") or []
            _pid = _plan_shot_id(shot)
            _prev_u = None
            if _pid in _order and _order.index(_pid) > 0:
                _prev_u = (cast.get("__units__") or {}).get(_order[_order.index(_pid) - 1])
            _state_line, _state_notes = _sequence_continuity_note(_unit, _prev_u)
            if _state_line:
                prompt = prompt.rstrip("\n") + "\n" + _state_line
                aug_notes.extend(_state_notes)
        # Production contract; see video-creation references for rationale.
        # same hall, new angle) — the guide's loose 「参考图片 N 的光影」 form. Three changes:
        # the upstream is the SELECTED take (clips.json), the frame goes through the v12
        # wide-shot / resolution gates, and the prompt DECLARES the image (an undeclared
        # tail frame is the one asset the model may read as a card or a locked first frame).
        # A missing upstream is an error, not a note: same-scene chains generate in order.
        cty = _clean_name(shot.get("continuity_from"))
        if cty and chain_video_url is None and chain_seed is None:
            prev_clip = (Path(shot["_continuity_clip"]) if shot.get("_continuity_clip")
                         else _selected_clip_path(ctx, out_dir, cty))
            if not prev_clip.is_file():
                with lock:
                    failures.append({"shot_id": shot_id, "error": (
                        f"continuity_from {cty}: no clip on disk ({prev_clip}) — generate and select the "
                        "upstream take first (same-scene chains run in order), or drop continuity_from")})
                return False
            if len(refs) >= MAX_REFERENCE_IMAGES:
                aug_notes.append(f"continuity_from {cty} skipped: all {MAX_REFERENCE_IMAGES} reference image slots taken")
            else:
                world_tail_cty, why = _silent_world_reference(
                    ctx, out_dir, cty, shot_id, _plan_prompt_of(ctx, args, shot.get("_continuity_unit") or cty),
                    clip_path=prev_clip)
                if world_tail_cty is None:
                    aug_notes.append(f"continuity_from {cty} not attached: {why}")
                else:
                    world_tail_cty["label"] = f"prev_act_tail:{cty}"
                    refs.append(world_tail_cty)
                    img_no = sum(1 for r in refs if r["role"] == "reference_image")
                    prompt = prompt.rstrip("\n") + "\n" + gnotes["world_tail"].format(n=img_no, upstream=cty)
                    aug_notes.append(f"continuity tail frame from {cty} attached as 图片 {img_no} (declared)")
        n_cards_declared = sum(1 for r in refs if r["role"] == "reference_image")

        dropped: list[str] = []
        substituted: list[str] = []
        used_paths = {str(r.get("path")) for r in refs if r.get("path")}
        # Which reference images video generator judges to be real people is not fully
        # predictable, but the error names the offending content[N]. Prune those
        # and retry rather than losing the shot.
        for _attempt in range(1):
            content: list[dict] = [{"type": "text", "text": prompt}]
            if chain_video_url is not None:
                content.append({
                    "type": "video_url", "video_url": {"url": chain_video_url},
                    "role": "reference_video",
                })
            for ref in refs:
                url = ref.get("url") or _data_url(ref["path"])
                content.append({
                    "type": "image_url", "image_url": {"url": url}, "role": ref["role"],
                })
            # 官方硬限: 参考音频最多 10 段、总时长 ≤30s (单个 [2,30]s)。
            # 每路 wav 是该角色整个序列的台词拼接 — 台词密度一高就贴线/超限
            # Production contract; see video-creation references for rationale.
            actual_audios = []
            audio_provenance = []
            for source_audio in dialogue_audios:
                _da = _pad_audio_min(source_audio, prof['audio_min_seconds'], ctx.resolve('.video_agent/audio_derivations')) if prof['audio_min_seconds'] else source_audio
                actual_audios.append(_da)
                audio_provenance.append({'source': ctx.virtualize(source_audio), 'source_sha256': file_digest(source_audio),
                                         'submitted': ctx.virtualize(_da), 'submitted_sha256': file_digest(_da)})
                suffix = _da.suffix.lower().lstrip(".") or "mp3"
                mime = "wav" if suffix == "wav" else "mp3"
                content.append({
                    "type": "audio_url",
                    "audio_url": {"url": f"data:audio/{mime};base64,"
                                  + base64.b64encode(_da.read_bytes()).decode()},
                    "role": "reference_audio",
                })
            if dialogue_audio is not None:
                # A second reference_audio is NOT a timbre anchor: video generator re-performs
                # reference audio rather than copying it, so the seed sample gets spoken
                # too (v10: 28/46 speaking shots failed reciting it). Off by default.
                if (PASS_VOICE_REF_TO_SEEDANCE and voice_ref is not None
                        and voice_ref.resolve() not in {p.resolve() for p in dialogue_audios}):
                    source_voice = voice_ref
                    voice_ref = _pad_audio_min(voice_ref, prof['audio_min_seconds'], ctx.resolve('.video_agent/audio_derivations')) if prof['audio_min_seconds'] else voice_ref
                    actual_audios.append(voice_ref)
                    audio_provenance.append({'source': ctx.virtualize(source_voice), 'source_sha256': file_digest(source_voice),
                                             'submitted': ctx.virtualize(voice_ref), 'submitted_sha256': file_digest(voice_ref)})
                    vsuffix = voice_ref.suffix.lower().lstrip(".") or "mp3"
                    vmime = "wav" if vsuffix == "wav" else "mp3"
                    content.append({
                        "type": "audio_url",
                        "audio_url": {"url": f"data:audio/{vmime};base64,"
                                      + base64.b64encode(voice_ref.read_bytes()).decode()},
                        "role": "reference_audio",
                    })
            actual_seconds = [_probe_duration(p) for p in actual_audios]
            if any(d is None or d <= 0 or d < prof['audio_min_seconds'] or d > prof['max_audio_seconds'] for d in actual_seconds) or sum(actual_seconds) > prof['max_audio_seconds'] + 1e-6:
                with lock:
                    failures.append({'shot_id': shot_id, 'error': 'actual submitted audio exceeds generator duration limits'})
                return False
            frozen_audio_sha = {str(ctx.resolve(row['submitted'])): row['submitted_sha256'] for row in audio_provenance}
            wire_audio_sha = [__import__('hashlib').sha256(base64.b64decode(c['audio_url']['url'].split(',', 1)[1])).hexdigest() for c in content if c['type'] == 'audio_url']
            if wire_audio_sha != [row['submitted_sha256'] for row in audio_provenance]:
                raise CreationError('audio bytes changed while compiling; no task was sent')
            # 官方 (2.5): 显式任务类型把参数不匹配的异步报错前置成同步校验; other generators get
            # only the fields their API accepts (generators.build_body)
            body = gens.build_body(prof, model, content, int(duration), resolution, ratio, generate_audio,
                                   task_type=str(args.get("omni_reference_task_type") or "auto"))
            # T08: inspect the final submitted visual set, after every automatic attachment.
            # Audio and an unresolvable reference id are not visual anchors. All current
            # formats require one; no format-only exemption silently bypasses this gate.
            visual_anchors = [c for c in body["content"] if any(
                c.get("type") == kind and (c.get(kind) or {}).get("url")
                for kind in ("image_url", "video_url"))]
            if not visual_anchors:
                from .creation_planning import plan_format
                fmt = plan_format(cast.get("__plan__"))
                hint = {"ad": "产品/场景参考图", "interview": "受访者/场景参考图",
                        "documentary": "主体/环境参考图", "explainer": "讲解对象/场景参考图"}.get(
                            fmt, "角色/场景参考图、关键帧或上游视频")
                with lock:
                    failures.append({"shot_id": shot_id, "stage": "visual_anchors",
                                     "error": f"T08 format={fmt}: 最终视觉集合为空；每条请求至少一个视觉锚，"
                                              f"请提供{hint} (at least one reference image or video)"})
                return False
            if any(r["role"] in FRAME_ROLES for r in refs) or chain_video_url is not None:
                # First/last-frame tasks derive the output ratio from the frame
                # image; continuation prompts with a reference_video get classified
                # as "video extension" — both reject an explicit ratio
                # (InvalidParameter.TaskTypeConstraint). The output follows the
                # conditioning media, which is exactly what a chained segment wants.
                body.pop("ratio", None)
            try:
                with lock:
                    if shot.get('take_id'):
                        from .creation_takes import read_object, write_object
                        ledger_path = ctx.resolve(f'{out_dir}/takes.json')
                        request_book = read_object(ledger_path)
                        record = request_book.get('takes', {}).get(shot_id)
                        if record is not None:
                            record['submitted_body_sha256'] = digest(body)
                            record['submitted_body'] = {**body, 'content': [{k:v for k,v in c.items() if k not in ('image_url','audio_url','video_url')} for c in body['content']]}
                            record['submitted_reference_sha256'] = {**{ctx.virtualize(r['path']): file_digest(r['path']) for r in refs if r.get('path')}, **{ctx.virtualize(p): sha for p, sha in ((Path(raw), sha) for raw, sha in frozen_audio_sha.items())}, **{row['source']: row['source_sha256'] for row in audio_provenance}}
                            record['submitted_audio_provenance'] = audio_provenance
                            record['submitted_payload_sha256'] = [__import__('hashlib').sha256(base64.b64decode(c[k]['url'].split(',', 1)[1])).hexdigest() for c in body['content'] for k in ('image_url','audio_url') if k in c and c[k]['url'].startswith('data:')]
                            write_object(ledger_path, request_book)
                for raw, expected in {**args.get('_dependency_sha256', {}), **frozen_audio_sha}.items():
                    if not Path(raw).is_file() or file_digest(Path(raw)) != expected:
                        raise CreationError('generation input changed before submission; no new task was sent')
                task_id = gens.submit(prof, body)
            except gens.ProviderError as exc:
                _msg = str(exc)
                with lock:
                    failures.append({"shot_id": shot_id, "stage": "submit",
                                     "error": ("content_blocked" if "sensitive" in _msg.lower() else _msg[:600]),
                                     "provider_message": _msg[:600], "dropped_refs": dropped})
                return False
            except Blocked as exc:
                message = str(exc)
                if "may contain real person" in message and (refs or chain_video_url):
                    # content[] = text, then (optional) upstream video, then images:
                    # map flagged indices back through that layout.
                    n_leading = 1 + (1 if chain_video_url is not None else 0)
                    flagged = set()
                    for m in _CONTENT_INDEX_RE.finditer(message):
                        flagged.add(int(m.group(1)))
                    video_flagged = chain_video_url is not None and 1 in flagged
                    bad = {i - n_leading for i in flagged
                           if 0 <= i - n_leading < len(refs)}
                    if video_flagged:
                        dropped.append("prev_video")
                        chain_video_url = None
                    if not bad and not video_flagged:
                        bad = {i for i, r in enumerate(refs)
                               if r["role"] == "reference_image"} or {0}
                    new_refs: list[dict] = []
                    for i, r in enumerate(refs):
                        if i not in bad:
                            new_refs.append(r)
                            continue
                        alt = _alternate_card(r, used_paths) if r["role"] == "reference_image" else None
                        if alt is not None:
                            used_paths.add(str(alt["path"]))
                            substituted.append(f"{r.get('label') or r.get('source')} -> {alt['label']}")
                            new_refs.append(alt)
                        else:
                            dropped.append(str(r.get("label") or r.get("source")))
                    refs = new_refs
                    if (n_cards_declared and not allow_cardless
                            and not any(r["role"] == "reference_image" for r in refs)):
                        # Every declared card is gone. Generating anyway means an
                        # unanchored character (v6: four shots shipped this way and
                        # were passed). Fail loudly; the agent must redraw the card in
                        # a less photoreal style or restate the character via epithet.
                        with lock:
                            failures.append({"shot_id": shot_id, "stage": "submit",
                                             "error": "all_cards_pruned", "dropped_refs": dropped,
                                             "substituted_refs": substituted,
                                             "hint": "video generator flagged every card of this shot as a real "
                                                     "person; redraw the card (more stylised face, "
                                                     "3/4 angle) or generate a compatible character card"})
                        return False
                    continue
                with lock:
                    failures.append({"shot_id": shot_id, "error": "content_blocked",
                                     "stage": "submit", "provider_message": message[:600],
                                     "dropped_refs": dropped})
                return False
            except CreationError as exc:
                with lock:
                    failures.append({"shot_id": shot_id, "error": str(exc)[:600],
                                     "stage": "submit"})
                return False

            # Persist immediately: a timeout must not turn a retry into a second
            # submission under the same candidate id.
            with lock:
                _persist_task_id(ctx, out_dir, shot_id, task_id)

            deadline = time.time() + max_wait
            polls = 0
            while time.time() < deadline:
                try:
                    st = _poll(prof, task_id)
                except CreationError as exc:
                    # The task exists and its id is persisted: report this shot as
                    # recoverable instead of aborting the whole batch.
                    with lock:
                        failures.append({"shot_id": shot_id, "stage": "poll", "task_id": task_id,
                                         "error": f"status poll failed: {str(exc)[:300]}"})
                    return False
                state = {**(st.get("raw") or {}), "usage": st.get("usage"), "error": st.get("error")}
                polls += 1
                status = st.get("status")
                if status == "succeeded":
                    url = st.get("video_url")
                    if not url:
                        with lock:
                            failures.append({"shot_id": shot_id, "stage": "download",
                                             "error": "succeeded without video_url"})
                        return False
                    # Capture the URL and task id BEFORE attempting the download:
                    # chain children only need the URL (reference_video), and the
                    # file itself can be rescued out-of-band by task id when the
                    # container's CDN route is down.
                    with lock:
                        url_by_shot[shot_id] = url
                        _persist_task_id(ctx, out_dir, shot_id, task_id)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    try:
                        _download_video(url, target, duration)
                    except CreationError as exc:
                        with lock:
                            failures.append({"shot_id": shot_id, "stage": "download",
                                             "task_id": task_id, "generated": True,
                                             "error": str(exc)[:400]})
                        # Generation succeeded — downstream chain segments proceed
                        # on the URL; the local file arrives via rescue/reuse.
                        return True
                    record = {
                        "shot_id": shot_id, "clip": ctx.virtualize(target),
                        "duration": duration, "reused": False, "task_id": task_id,
                        "polls": polls, "dropped_refs": dropped,
                        "substituted_refs": substituted,
                        "refs_used": len(refs),
                        "usage": state.get("usage"),
                        **({"prompt_notes": aug_notes} if aug_notes else {}),
                        **({"voice_ref": ctx.virtualize(voice_ref)} if voice_ref is not None else {}),
                    }
                    if cont:
                        record["chained_from"] = cont
                        record["chain_mode"] = (
                            "video_ref" if chain_video_url is not None else
                            "muted_tail_ref" if muted_ref else
                            "first_frame" if chain_seed is not None else "cards_only"
                        )
                    if muted_ref:
                        # v12 telemetry: how often the world had to travel as a still
                        # so the upstream voice could not ride along with it.
                        record["reference_video_muted"] = True
                    if dialogue_audio is not None:
                        record["speech_in_clip"] = True
                        record["reference_audios"] = len(dialogue_audios)
                        # A silent generator only performs to these files; assembly lays them back.
                        record["speech_audio"] = [
                            {"audio": ctx.virtualize(a), "sha256": file_digest(a),
                             "kind": "inner" if inner_decl is not None and n == inner_decl["index"] else "dialogue"}
                            for n, a in enumerate(dialogue_audios, 1)]
                        if inner_decl is not None:
                            record["inner_in_clip"] = True
                            record["inner_audio_index"] = inner_decl["index"]
                            record["inner_line"] = inner_decl["line"]
                    record["clip_audio"] = "generated" if prof.get("audio_out", True) else "silent"
                    if chain_seed is not None:
                        record["chain_seed"] = ctx.virtualize(chain_seed)
                        if declared_refs:
                            record["note"] = (
                                f"{declared_refs} declared reference image(s) skipped: "
                                "first_frame fallback cannot carry reference images."
                            )
                    with lock:
                        results.append(record)
                        url_by_shot[shot_id] = url
                    return True
                if status in ("failed", "cancelled", "canceled", "expired"):  # terminal: stop waiting
                    err = state.get("error")
                    message = err if isinstance(err, str) else json.dumps(
                        err, ensure_ascii=False
                    )
                    with lock:
                        failures.append({"shot_id": shot_id, "stage": "generate",
                                         "task_id": task_id,
                                         "error": str(message)[:600] if err else f"task {status}",
                                         "dropped_refs": dropped,
                                         **({"hint": _failure_hint(message)} if _failure_hint(message) else {})})
                    return False
                time.sleep(poll_interval)
            with lock:
                failures.append({"shot_id": shot_id, "stage": "poll", "task_id": task_id,
                                 "error": f"timed out after {max_wait}s"})
            return False

        with lock:
            failures.append({"shot_id": shot_id, "error": "exhausted reference pruning",
                             "dropped_refs": dropped})
        return False

    # Chain orchestration: shots with continues_from run after their upstream
    # segment, seeded with its last frame. Independent chains run concurrently.
    def id_of(shot: Any) -> str:
        return _clean_name(shot.get("shot_id")) if isinstance(shot, dict) else ""

    batch_ids = {id_of(s) for s in shots if isinstance(s, dict) and id_of(s)}
    children: dict[str, list[dict]] = {}
    heads: list[Any] = []
    for s in shots:
        parent = _clean_name(s.get("continues_from")) if isinstance(s, dict) else ""
        if parent and parent in batch_ids and parent != id_of(s):
            children.setdefault(parent, []).append(s)
        else:
            # Includes shots continuing a clip generated by a *previous* call:
            # run_chain resolves the upstream clip from disk.
            heads.append(s)

    processed: set[str] = set()

    def fail_subtree(sid: str, reason: str) -> None:
        for child in children.get(sid, []):
            cid = id_of(child)
            with lock:
                failures.append({"shot_id": cid, "stage": "chain", "error": reason})
                processed.add(cid)
            fail_subtree(cid, f"upstream segment {cid} failed: {reason}")

    def run_chain(head: Any) -> None:
        queue: list[Any] = [head]
        while queue:
            s = queue.pop(0)
            sid = id_of(s)
            if sid:
                with lock:
                    processed.add(sid)
            cont = _clean_name(s.get("continues_from")) if isinstance(s, dict) else ""
            seed: Path | None = None
            chain_url: str | None = None
            take_referenced = isinstance(s, dict) and bool(s.get("take_id")) and cont == s.get("reference_take_id")
            if cont and cont != sid:
                # `take_referenced` exists to skip the v1 shot-ledger gate below (v2
                # keyed its ledger by plan shot id, not take id). It must NOT skip the
                # URL lookup that follows: hanging it on the outer branch meant every
                # take-mode reference_take_id silently came out as chain_mode
                # "cards_only" — the upstream clip was never sent, so v2's whole
                # world-reference channel did nothing (measured 2026-09-21: the
                # requests for a context-mode shot and a no-reference shot were
                # field-for-field identical apart from the seed).
                if not take_referenced and not allow_unverified_upstream\
                        and not _ledger_final(ledger, cont) and cont not in batch_ids:
                    # Cross-batch continuation from a clip nobody has verified: a
                    # defect in the head compounds down the whole chain (v5: wing loss
                    # rode 10 links). Verify the upstream (drama_clip_verify_*) first.
                    with lock:
                        failures.append({
                            "shot_id": sid, "stage": "gate",
                            "error": f"continues_from={cont} is not verified pass/mute_audio in "
                                     f"out/creation/verified.json (status="
                                     f"{(ledger.get(cont) or {}).get('status') if isinstance(ledger.get(cont), dict) else None}); "
                                     "run creation_verify/record on it first, or pass "
                                     "review the upstream candidate first",
                        })
                        processed.add(sid)
                    fail_subtree(sid, f"upstream {cont} unverified")
                    continue
                with lock:
                    chain_url = url_by_shot.get(cont)
                if chain_url is None:
                    # Cross-batch chain: re-fetch the upstream's presigned URL by
                    # its persisted task id (valid 24h) to stay in video_ref mode.
                    sidecar = ctx.resolve(f"{out_dir}/task_ids.json")
                    try:
                        tid = (json.loads(sidecar.read_text(encoding="utf-8"))
                               if sidecar.is_file() else {}).get(cont)
                    except Exception:
                        tid = None
                    if tid:
                        chain_url = _url_from_task_id(tid, prof)
                        if chain_url:
                            with lock:
                                url_by_shot[cont] = chain_url
                if chain_url is None and s.get("reference_mode", "continuation") == "continuation":
                    # Last resort: seed with the upstream clip's last frame.
                    from .creation_takes import read_object
                    parent = read_object(ctx.resolve(f"{out_dir}/takes.json")).get("takes", {}).get(cont, {})
                    prev_clip = ctx.resolve(parent.get("clip") or f"{out_dir}/{cont}.mp4")
                    if not prev_clip.is_file():
                        with lock:
                            failures.append({
                                "shot_id": sid, "stage": "chain",
                                "error": f"continues_from={cont}: upstream clip not available",
                            })
                        fail_subtree(sid, f"upstream segment {sid} was never generated")
                        continue
                    try:
                        seed = _extract_last_frame(
                            prev_clip, ctx.resolve(f"{out_dir}/chain_seeds/{sid}_seed.png")
                        )
                    except CreationError as exc:
                        with lock:
                            failures.append({"shot_id": sid, "stage": "chain",
                                             "error": str(exc)[:300]})
                        fail_subtree(sid, f"upstream segment {sid} failed: {exc}")
                        continue
            if one(s, seed, chain_url):
                queue.extend(children.get(sid, []))
            else:
                fail_subtree(sid, f"upstream segment {sid} failed")

    with ThreadPoolExecutor(max_workers=workers) as pool:
        from contextvars import copy_context
        contexts = [copy_context() for _ in heads]
        list(pool.map(lambda pair: pair[0].run(run_chain, pair[1]), zip(contexts, heads)))

    for s in shots:
        sid = id_of(s)
        if sid and sid not in processed:
            failures.append({
                "shot_id": sid, "stage": "chain",
                "error": "unreachable: continues_from forms a cycle in this batch",
            })

    order = {str(s.get("shot_id")): i for i, s in enumerate(shots) if isinstance(s, dict)}
    results.sort(key=lambda r: order.get(str(r.get("shot_id")), 10**6))
    failures.sort(key=lambda r: order.get(str(r.get("shot_id")), 10**6))

    pruned = [r for r in results if r.get("dropped_refs")]
    chained = [r for r in results if r.get("chained_from")]
    report = {
        "model": model,
        "resolution": resolution,
        "ratio": ratio,
        "generate_audio": generate_audio,
        "requested": len(shots),
        "generated": sum(1 for r in results if not r.get("reused")),
        "reused": sum(1 for r in results if r.get("reused")),
        "failed": len(failures),
        "chained": len(chained),
        "muted_world_refs": sum(1 for r in results if r.get("reference_video_muted")),
        "clips": results,
        "failures": failures,
    }
    written = _write_json(
        ctx, args.get("output_json") or "out/creation/clips.json", report
    )

    text = (
        f"video generator {prof['name']}: {report['generated']} generated, {report['reused']} reused, "
        f"{report['failed']} failed ({len(shots)} requested"
        + (f", {len(chained)} chained segment(s)" if chained else "")
        + ")."
    )
    if pruned:
        text += (
            "\n\n[reference pruning] video generator judged some reference images to show real "
            "people and they were dropped, so these shots lost identity anchoring:\n"
            + "\n".join(f"- {r['shot_id']}: dropped {r['dropped_refs']}" for r in pruned[:20])
        )
    if failures:
        text += "\n\nFailed shots:\n" + "\n".join(
            f"- {f.get('shot_id')} [{f.get('stage', '?')}] {str(f.get('error'))[:200]}"
            + (f"\n  → {f['hint']}" if f.get("hint") else "")
            for f in failures[:20]
        )
    return ToolResult(
        text=text, data=report, artifacts=[written],
        video_paths=[str(ctx.resolve(r["clip"])) for r in results],
    )


# ======================================================== 4. build timeline
def _has_audio_stream(path: Path) -> bool:
    """False only when ffprobe positively reports no audio stream (unknown counts as audio)."""
    import subprocess
    try:
        proc = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries",
                               "stream=index", "-of", "csv=p=0", str(path)],
                              capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return True
    return proc.returncode != 0 or bool(proc.stdout.strip())


def _clip_speech_audio(ctx: RunContext, shot: dict, candidate: dict, clips_doc: Path,
                       clip: Path) -> list[dict]:
    """The line audio a speaking clip was generated against: [{audio: Path, kind}].

    Order: the take record (takes.json), the edit entry itself, the clips.json row of
    this clip, then the entry's dialogue_audio / inner_audio paths.
    """
    rows = candidate.get("speech_audio") if isinstance(candidate.get("speech_audio"), list) else None
    if rows is None and isinstance(shot.get("speech_audio"), list):
        rows = shot["speech_audio"]
    if rows is None and clips_doc.is_file():
        try:
            doc = json.loads(clips_doc.read_text(encoding="utf-8"))
            for row in (doc.get("clips") if isinstance(doc, dict) else doc) or []:
                if (isinstance(row, dict) and isinstance(row.get("speech_audio"), list)
                        and ctx.resolve(str(row.get("clip") or "")) == clip):
                    rows = row["speech_audio"]
                    break
        except (OSError, ValueError):
            pass
    if rows is None:
        raw = shot.get("dialogue_audio")
        rows = [{"audio": a, "kind": "dialogue"} for a in (raw if isinstance(raw, list) else [raw] if raw else [])]
        if shot.get("inner_audio"):
            rows.append({"audio": shot["inner_audio"], "kind": "inner"})
    out = []
    for row in rows:
        rel = _clean_name(row.get("audio") if isinstance(row, dict) else row)
        if not rel:
            continue
        path = ctx.resolve(rel)
        if not path.is_file():
            raise CreationError(f"reference line audio missing: {path}")
        if isinstance(row, dict) and row.get("sha256") and file_digest(path) != row["sha256"]:
            raise CreationError(f"reference line audio changed since generation: {path}")
        out.append({"audio": path, "kind": "inner" if isinstance(row, dict) and row.get("kind") == "inner" else "dialogue"})
    return out


def _probe_duration(path: Path) -> float | None:
    from .observation_media import probe
    try:
        return probe(path).get("duration")
    except (OSError, ValueError, RuntimeError):
        return None


# video generator edit mode needs an explicit trigger verb; a plain description makes
# the call a *reference* task (generate-something-like) instead of an edit.
EDIT_TRIGGER_WORDS = (
    "edit video", "edit the", "change ", "remove ", "delete ", "add ", "insert ",
    "modify ", "replace ", "编辑", "修改", "删除", "移除", "替换", "添加",
)


def edit_video_candidate(args: dict, ctx: RunContext) -> ToolResult:
    'drama video edit.'
    _early = gens.profile(args.get("model")) if gens.resolve_name(args.get("model")) else gens.profile()
    if _early["provider"] != "seedance":
        raise CreationError(
            f"video_generate action=edit is not available on {_early['name']} in this pipeline yet (its editing runs "
            "through a different task shape, not wired): fix the defect by trimming, drawing/generating "
            "another take, or regenerating the sequence with the change stated")
    from ve_tools.creation_takes import generation_lock, read_object, write_object

    source_id = _clean_name(args.get("source_take_id"))
    new_id = _clean_name(args.get("take_id"))
    instruction = str(args.get("edit_instruction") or "").strip()
    if not source_id or not new_id:
        raise CreationError("video_generate needs source_take_id and a new take_id")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,119}", new_id):
        raise CreationError("take_id must be a safe immutable identifier")
    if source_id == new_id:
        raise CreationError("an edited result is a new candidate: pick a fresh take_id")
    if not instruction:
        raise CreationError("edit_instruction is required — an A-to-B change with an explicit scope")
    lowered = instruction.lower()
    if not any(w in lowered or w in instruction for w in EDIT_TRIGGER_WORDS):
        raise CreationError(
            "edit_instruction lacks an edit trigger verb (edit/change/remove/add/modify/"
            "replace or 编辑/修改/删除/添加) — plain descriptions create a reference task, not an edit"
        )
    caps = {k: _num(args.get(k)) for k in ("max_total_generations", "max_total_generated_seconds")}
    if any(v is None or v <= 0 for v in caps.values()) or caps["max_total_generations"] != int(caps["max_total_generations"]):
        raise CreationError("video_generate requires the same run budget caps as video_generate")
    prof = gens.profile(args.get("model"))
    base = gens.ENDPOINT_LABEL
    default_model = prof["model"]
    model = args.get("model") or default_model
    eprof = gens.profile(model) if gens.resolve_name(model) else gens.profile()
    if eprof.get("edit") == "not_wired":
        raise CreationError(
            f"video_generate action=edit is not available on {eprof['name']} (the video generator does not "
            "expose its edit task type): fix the defect by trimming, drawing/generating another take, or "
            "regenerating the sequence with the change stated")
    try:
        gens.require_channel()
    except gens.ProviderError as exc:
        raise CreationError(str(exc)) from None
    resolution = gens.resolution_for(eprof, args.get("resolution") or eprof["default_resolution"])
    out_dir = args.get("output_dir") or "out/creation/clips"
    directory = ctx.resolve(out_dir)
    timeout_seconds = _num(args.get("timeout_seconds")) or 2400.0
    poll_interval = _num(args.get("poll_interval_seconds")) or 10.0

    recipe = {"kind": "surgical_edit", "source_take_id": source_id,
              "edit_instruction": instruction,
              "settings": {"model": model, "resolution": resolution}}
    plan_path = ctx.resolve(args.get('shotlist_path') or 'out/creation/shotlist.json')
    plan = read_object(plan_path)
    recipe['provider'] = {k: eprof[k] for k in ('name', 'model', 'dialect')}
    recipe['endpoint'] = base
    signature = None

    with generation_lock(directory):
        book = read_object(directory / "takes.json") or {"version": 2, "takes": {}}
        records = book["takes"]
        if not isinstance(records.get(source_id), dict) or not records[source_id].get("shot_id"):
            raise CreationError(f"source take {source_id!r} not found in takes.json")
        source = records[source_id]
        source_path = ctx.resolve(source.get("clip") or str(directory / f"{source_id}.mp4"))
        if not source_path.is_file() or file_digest(source_path) != source.get("source_sha256"):
            raise CreationError("source candidate bytes changed or missing")
        unit = next((u for u in (plan.get('sequences') or plan.get('shots') or []) if str(u.get('sequence_id') or u.get('shot_id')) == source['shot_id']), {})
        recipe.update(source_sha256=source['source_sha256'], source_request_sha256=source.get('request_sha256'), plan_unit_sha256=shot_plan_digest(plan, unit, ctx))
        signature = digest(recipe)
        target = directory / f"{new_id}{'.mov' if eprof.get('task_type_param') else '.mp4'}"
        existing = records.get(new_id)
        if target.exists() and not existing:
            raise CreationError('untracked edit target exists; choose a new take_id')
        if existing and existing.get("request_sha256") != signature:
            raise CreationError(
                f"take {new_id!r} already exists with a different request; edited candidates "
                "are immutable — pick another id"
            )
        if book.get("budget") and book["budget"] != caps:
            raise CreationError("run budget differs from takes.json; pass the same caps as the generate calls")
        book["budget"] = caps
        count = len(records) + (0 if existing else 1)
        # Reserved seconds of the new take: the source's reserved seconds (legacy records may
        # hold a missing/measured value instead; never let that break the accounting).
        edit_seconds = (_num(source.get("duration")) or _num(source.get("measured_duration"))
                        or _probe_duration(source_path) or 0)
        seconds = sum(_num(r.get("duration")) or 0 for r in records.values()) + (0 if existing else edit_seconds)
        if count > caps["max_total_generations"] or seconds > caps["max_total_generated_seconds"]:
            raise CreationError("generation budget exhausted; revise the directing plan")
        if not existing:
            records[new_id] = {"shot_id": source["shot_id"], "take_id": new_id,
                               "duration": edit_seconds,
                               "request_sha256": signature,
                               "parent_take_id": source_id, "status": "reserved", "effective_recipe": recipe, "plan_unit_sha256": recipe["plan_unit_sha256"]}
        # Same cumulative summary as generate batches: edits share the project budget.
        book["reserved_generations"] = count
        book["reserved_seconds"] = seconds
        write_object(directory / "takes.json", book)
        shot_id = source["shot_id"]
        existing_task = (existing or {}).get("task_id")

    target = directory / f"{new_id}{'.mov' if eprof.get('task_type_param') else '.mp4'}"
    if target.is_file() and existing and existing.get("source_sha256") != file_digest(target):
        raise CreationError("edited candidate bytes changed; choose a new take_id")
    if target.is_file() and target.stat().st_size > 10240 and _probe_duration(target):
        return ToolResult(text=f"[OK] reused edited take {new_id} ({shot_id})",
                          data={"shot_id": shot_id, "take_id": new_id, "clip": ctx.virtualize(target),
                                "edited_from": source_id, "reused": True})

    submitted_body = None
    if existing_task:
        task_id = existing_task
    else:
        if existing:
            raise CreationError("prior edit has no recoverable task; choose a new take_id")
        src_task = (source.get("task_id")
                    or read_object(directory / "task_ids.json").get(source_id))
        url = _url_from_task_id(src_task, prof) if src_task else None
        if not url:
            raise CreationError(
                f"cannot recover a fresh URL for {source_id!r} (no provider task on record; "
                "presigned links expire). Regenerate the shot, or re-run generation with the "
                "same take_id to reuse its task."
            )
        body = {"model": model,
                "content": [
                    {"type": "video_url", "video_url": {"url": url}, "role": "reference_video"},
                    {"type": "text", "text": instruction},
                ],
                "ratio": "adaptive", "duration": -1, "resolution": resolution, "watermark": False}
        if eprof.get("task_type_param"):
            # 2.5 only: the locked edit task (output keeps the source's frame count) and MOV output
            body.update({"omni_reference_task_type": "edit", "output_format": "mov"})
        submitted_body = body
        try:
            task_id = gens.submit(eprof, body)
        except (gens.ProviderError, CreationError, Blocked) as exc:
            # The reservation stays counted (the request may have reached the provider), but
            # the ledger states the outcome instead of an indefinite "reserved".
            with generation_lock(directory):
                book = read_object(directory / "takes.json")
                if new_id in book.get("takes", {}):
                    book["takes"][new_id].update(status="failed", error=str(exc)[:300])
                    write_object(directory / "takes.json", book)
            raise CreationError(f"edit submission failed: {str(exc)[:300]}") from exc

    with generation_lock(directory):
        book = read_object(directory / "takes.json")
        book["takes"][new_id].update(task_id=task_id, status="submitted")
        if submitted_body is not None:
            book['takes'][new_id].update(submitted_body_sha256=digest(submitted_body), submitted_body={**submitted_body, 'content':[c for c in submitted_body['content'] if c['type']=='text']}, submitted_reference_sha256={ctx.virtualize(source_path): recipe['source_sha256']})
        write_object(directory / "takes.json", book)
    _persist_task_id(ctx, out_dir, new_id, task_id)

    deadline = time.time() + timeout_seconds
    polls = 0
    video_url = None
    usage = None
    while time.time() < deadline:
        polls += 1
        st = _poll(eprof, task_id)
        state = {**(st.get("raw") or {}), "error": st.get("error")}
        status = st.get("status")
        usage = st.get("usage") if isinstance(st.get("usage"), dict) else usage
        if status == "succeeded":
            video_url = st.get("video_url")
            break
        if status in ("failed", "cancelled"):
            with generation_lock(directory):
                book = read_object(directory / "takes.json")
                if new_id in book["takes"]:
                    book["takes"][new_id]["status"] = "failed"
                    write_object(directory / "takes.json", book)
            raise CreationError(
                f"edit task {task_id} ended {status}: "
                f"{str(state.get('error') or state)[:300]}"
            )
        time.sleep(poll_interval)
    if not video_url:
        raise CreationError(f"edit task {task_id} timed out after {timeout_seconds:g}s (status {status})")

    target.parent.mkdir(parents=True, exist_ok=True)
    def check_edit_dependencies():
        current = read_object(plan_path)
        current_unit = next((u for u in (current.get('sequences') or current.get('shots') or []) if str(u.get('sequence_id') or u.get('shot_id')) == shot_id), {})
        if shot_plan_digest(current, current_unit, ctx) != recipe['plan_unit_sha256'] or file_digest(source_path) != recipe['source_sha256']:
            raise CreationError('edit dependencies changed during execution; preserve submitted task and restore dependencies')
    check_edit_dependencies()
    import tempfile
    from .file_contract import publish_files
    with tempfile.TemporaryDirectory(prefix='edit-download-', dir=directory) as stage_dir:
        staged = Path(stage_dir) / target.name
        _download_video(video_url, staged, None)
        check_edit_dependencies()
        publish_files({target: staged})
    _persist_task_id(ctx, out_dir, new_id, task_id)
    with generation_lock(directory):
        book = read_object(directory / "takes.json")
        rec = book["takes"].get(new_id)
        if isinstance(rec, dict):
            # `duration` stays the reserved budget seconds; the measured length is separate
            # so cumulative accounting never drifts (or breaks on an unprobeable file).
            rec.update({"status": "generated", "clip": ctx.virtualize(target),
                        "source_sha256": file_digest(target), "measured_duration": _probe_duration(target),
                        "task_id": task_id, "edited_from": source_id})
            # An edit re-renders the SOURCE take, so its audio declarations still hold: the
            # in-clip inner monologue flag (and the reference-audio count) ride along, or
            # creation_verify treats the edited clip as a no-dialogue shot and condemns the
            # planned inner line as stray speech (11-06 S07_t2: "verdict must be mute_audio").
            src = book["takes"].get(source_id) or {}
            for key in ("inner_in_clip", "reference_audios"):
                if key in src and key not in rec:
                    rec[key] = src[key]
        write_object(directory / "takes.json", book)
    return ToolResult(
        text=f"[OK] surgical edit {new_id} of {source_id} ({shot_id}) done in {polls} polls",
        data={"shot_id": shot_id, "take_id": new_id, "clip": ctx.virtualize(target),
              "edited_from": source_id, "task_id": task_id, "polls": polls,
              "usage": usage, "instruction": instruction},
    )


def crop_reference_image(args: dict, ctx: RunContext) -> ToolResult:
    """Deterministic headshot crop from a body card, bbox supplied by the agent.

    Identity guarantee: the headshot IS the body card's face — same pixels,
    derived, never generated. Two 0919 lessons baked in: same-text
    regeneration drifts the face (two independent samples), and haar-style
    face detection misfires on stylized/non-photoreal art (wrong boxes). So
    the agent — which can actually see the card — reports the head box (all
    hair included, down to mid-neck, no shoulders), and this tool only crops:
    margin, clamp, 2x Lanczos upscale, return the crop inline for a
    look-and-adjust retry.
    """
    from PIL import Image

    resample = getattr(Image, "Resampling", Image).LANCZOS
    src = _clean_name(args.get("source"))
    out = _clean_name(args.get("output"))
    if not src or not out:
        raise CreationError("image_crop needs source (the body card) and output paths")
    src_path = ctx.resolve(src)
    if not src_path.is_file():
        raise CreationError(f"source card not found: {src_path}")
    coords = {}
    for k in ("x1", "y1", "x2", "y2"):
        v = _num(args.get(k))
        if v is None or v != int(v):
            raise CreationError(f"{k} must be an integer pixel coordinate")
        coords[k] = int(v)
    try:
        with Image.open(src_path) as im:
            W, H = im.size
            image = im.convert("RGB")
    except Exception as exc:  # noqa: BLE001
        raise CreationError(f"cannot open source card: {exc}") from exc
    x1, y1, x2, y2 = coords["x1"], coords["y1"], coords["x2"], coords["y2"]
    if not (0 <= x1 < x2 <= W and 0 <= y1 < y2 <= H):
        raise CreationError(
            f"bbox ({x1},{y1})-({x2},{y2}) is invalid or out of bounds for the "
            f"{W}x{H} source image; x/y are pixels of this image file (a video_observe frame file "
            "is a downscaled copy, not the source video's resolution)"
        )
    if (x2 - x1) * (y2 - y1) < 0.005 * W * H:
        raise CreationError(
            "bbox covers under 0.5% of the card — the head is a prominent region; "
            "you likely mistyped the coordinates"
        )
    margin = _num(args.get("margin_ratio"))
    margin = 0.08 if margin is None else max(0.0, min(margin, 0.25))
    mh, mv = int((x2 - x1) * margin), int((y2 - y1) * margin)
    box = (max(0, x1 - mh), max(0, y1 - mv), min(W, x2 + mh), min(H, y2 + mv))
    upscale = _num(args.get("upscale")) or 2
    upscale = max(1, min(int(upscale), 3))
    crop = image.crop(box)
    if upscale > 1:
        crop = crop.resize((crop.width * upscale, crop.height * upscale), resample)
    out_path = ctx.resolve(out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    crop.save(out_path)
    return ToolResult(
        text=(
            f"[OK] headshot cropped from {src} box={box} -> {out} "
            f"({crop.width}x{crop.height}). Verify the crop: full hair in frame, "
            "lower edge at mid-neck, no shoulders; adjust the bbox and retry if off."
        ),
        data={"source": src, "output": out, "bbox": list(box), "margin_ratio": margin,
              "size": [crop.width, crop.height], "source_size": [W, H], "upscale": upscale},
        artifacts=[out],
        image_paths=[str(out_path)],
    )


def _wrap_subtitle(text: str, canvas_width: int, fontsize: int = 42) -> str:
    """Hard-wrap a cue so drawtext never overflows the frame.

    drawtext does no wrapping of its own: a 47-char CJK line at fontsize 42 is
    ~2000px wide on a 1280px canvas (v3 opening shipped like that). Wrap to the
    canvas with side margins; cap at 3 lines.
    """
    text = text.strip()
    max_chars = max(8, int((canvas_width - 200) / fontsize))
    if len(text) <= max_chars:
        return text
    return "\n".join(text[i:i + max_chars] for i in range(0, len(text), max_chars))[
        : max_chars * 3 + 3
    ]


def _noise_floor_db(path: Path, max_seconds: float = 45.0) -> float | None:
    """10th-percentile short-time RMS in dBFS — the asset's room tone.

    Peak or mean loudness says nothing about whether two cuts share a floor; the
    audible "the room changed" step at a cut is a step in this number.
    """
    import array
    import math
    import subprocess

    try:
        proc = subprocess.run(
            ["ffmpeg", "-v", "error", "-t", f"{max_seconds:.2f}", "-i", str(path),
             "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
            capture_output=True, timeout=180,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0 or not proc.stdout:
        return None
    a = array.array("h")
    a.frombytes(proc.stdout[: len(proc.stdout) // 2 * 2])
    n = 800  # 50 ms at 16 kHz
    vals = []
    for s in range(0, len(a) - n, n):
        seg = a[s:s + n]
        m = sum(float(x) * x for x in seg) / n
        vals.append(20 * math.log10(max(1e-9, math.sqrt(m) / 32768.0)))
    if not vals:
        return None
    vals.sort()
    return vals[int(len(vals) * 0.10)]


def _integrated_lufs(path: Path) -> "float | None":
    """First-pass loudnorm measurement of integrated loudness (mixbgm.sh 同式)."""
    import subprocess
    try:
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-nostdin", "-i", str(path),
             "-af", "loudnorm=print_format=json", "-f", "null", "-"],
            capture_output=True, text=True, timeout=300)
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    s = proc.stderr
    i, j = s.rfind("{"), s.rfind("}")
    if i < 0 or j <= i:
        return None
    try:
        import math
        val = float(json.loads(s[i:j + 1]).get("input_i"))
    except (ValueError, KeyError, TypeError):
        return None
    return val if math.isfinite(val) else None


# 校准曲库随插件分发: 容器里插件根目录在 claude (--plugin-dir / headless) 与 codex 下都挂载,
# 仓库根的 assets/ 则从不进容器 —— 1012 前曲库放在仓库根, agent 在容器里按 SKILL 写的
# assets/bgm/ 根本找不到 (val1004 五部成片 has_bgm 全为 false)。
BGM_LIBRARY_DIR = Path(__file__).resolve().parents[2] / "assets" / "bgm"
_AUDIO_SUFFIXES = (".m4a", ".mp3", ".wav", ".aac", ".flac", ".ogg", ".opus")


def _resolve_bgm(ctx: RunContext, bgm: str) -> Path:
    """`bgm` 参数 -> 实际文件。工程内路径照旧; `assets/bgm/<曲名>` 或裸曲名落到插件曲库,
    连同 bgm_calibration.json 拷进 out/creation/bgm_library/ (成片工程自包含, 本地重渲不依赖
    容器挂载路径; 单独目录, 免得 agent 自建的环境声床被当成曲库曲做电平校准)。"""
    path = ctx.resolve(bgm)
    if path.is_file():
        return path
    raise CreationError(f"bgm file not found: {path}; provide an explicit project audio file")


def _calibrated_bed_gain(bed: Path, warnings: list[str]) -> "tuple[float | None, dict]":
    """BGM 床的校准系数（0921 用户试听拍板，mixbgm.sh 进产线版）。

    只对「与 bgm_calibration.json 同目录」的床生效（即插件曲库 assets/bgm, 经 _resolve_bgm
    拷进 out/creation/bgm_library/ 的副本）：
    表内曲直接用校准系数，表外曲实测 LUFS 反推——床落在 target_mixed_lufs
    （-23.64 = 三部成片人声轨电平实测，混入后与人声等电平）。这正是
    BED_AUTOLEVEL 注释里要求的"人声天花板"：绝对落点而非相对底噪，
    不越过台词。库外床（环境声 loop 等）一律走原逻辑，行为不变。
    """
    cal = bed.parent / "bgm_calibration.json"
    if not cal.is_file():
        return None, {}
    try:
        data = json.loads(cal.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        warnings.append(f"bgm: unreadable calibration file next to {bed.name}; ignoring it")
        return None, {}
    target = float(data.get("target_mixed_lufs", -23.64))
    entry = (data.get("tracks") or {}).get(bed.name)
    if isinstance(entry, dict) and entry.get("volume") is not None:
        vol = float(entry["volume"])
        meta = {"source": "bgm_calibration", "target_lufs": target,
                "track_lufs": entry.get("lufs"), "volume": vol}
    else:
        lufs = _integrated_lufs(bed)
        if lufs is None:
            warnings.append("bgm: calibration table miss and loudness unmeasurable "
                            "(no ffmpeg); falling back to the legacy bed volume")
            return None, {}
        vol = round(10 ** ((target - lufs) / 20.0), 3)
        meta = {"source": "bgm_calibration_measured", "target_lufs": target,
                "track_lufs": lufs, "volume": vol}
    track_lufs = meta.get("track_lufs")
    warnings.append(
        f"bgm calibrated to voice-track level: {bed.name} -> volume {vol} "
        f"(bed {track_lufs} LUFS -> target {target} LUFS); non-library ambience beds "
        f"keep their own levelling")
    return vol, meta


def _bed_gain(bed: Path, video_clips: list[dict], ctx: RunContext,
              warnings: list[str]) -> tuple[float, dict]:
    """Level the music/ambient bed to the shots' own room tone (B1).

    v9 laid the bed at a fixed 0.14-0.18, which put it ~10 dB BELOW the shots'
    noise floor: it masked nothing and every cut still stepped. Measured on three
    v9 shots, matching the bed's floor to the clips' median floor +3 dB halves the
    step across a cut (6.5 dB -> 3.4 dB); a 0.2 s audio crossfade only helps once
    this is in place (3.4 -> 3.0), and hurts without it.
    """
    floors: list[float] = []
    for c in video_clips:
        if c.get("muted") or not c.get("source"):
            continue
        p = ctx.resolve(str(c["source"]))
        if not p.is_file():
            continue
        f = _noise_floor_db(p, 20.0)
        if f is not None and f > -90:
            floors.append(f)
        if len(floors) >= 12:
            break
    bed_floor = _noise_floor_db(bed, 45.0)
    if not floors or bed_floor is None:
        warnings.append("bgm: noise floors unmeasurable (no ffmpeg or silent assets); "
                        "using the legacy 0.18 bed volume")
        return 0.18, {}
    median = floors[len(floors) // 2]
    target = median + 3.0
    gain = max(0.05, min(1.5, round(10 ** ((target - bed_floor) / 20.0), 3)))
    warnings.append(
        f"bgm leveled to room tone: clip floor median {median:.1f} dBFS, bed floor "
        f"{bed_floor:.1f} dBFS, target {target:.1f} dBFS -> volume {gain}")
    return gain, {"clip_floor_median_db": round(median, 1),
                  "bed_floor_db": round(bed_floor, 1),
                  "target_floor_db": round(target, 1),
                  "measured_clips": len(floors), "volume": gain}


def build_creation_timeline(args: dict, ctx: RunContext) -> ToolResult:
    """Lay generated clips (and optional voice audio) into out/timeline.json.

    Cue times come from the real duration of each rendered asset, so subtitles
    stay aligned with the audio actually produced instead of an even split.
    """
    shots = args.get("shots")
    if not isinstance(shots, list) or not shots:
        raise CreationError("shots must be a non-empty array")

    versioned = any(isinstance(s, dict) and s.get("take_id") for s in shots)
    plans: dict[str, dict] = {}
    reviews: dict[str, dict] = {}
    candidates: dict[str, dict] = {}
    if versioned:
        from ve_tools.creation_takes import read_object

        if not args.get("shotlist_path") or not args.get("verdicts_path"):
            raise CreationError("versioned assembly requires shotlist_path and verdicts_path")
        plan = read_object(ctx.resolve(args["shotlist_path"]))
        errors, _, _ = validate_plan(plan, ctx)
        if str(plan.get("schema_version")) not in ("2", "3", "4") or errors:
            raise CreationError("versioned assembly needs a valid v2/v3/v4 directing plan: " + "; ".join(errors[:5]))
        plans = {str(s.get("shot_id") or s.get("sequence_id")): s for s in (plan.get("shots") or plan.get("sequences") or [])}
        reviews = read_object(ctx.resolve(args["verdicts_path"])).get("takes", {})
        candidates = read_object(ctx.resolve(args.get("takes_path") or "out/creation/clips/takes.json")).get("takes", {})

    canvas_in = args.get("canvas") if isinstance(args.get("canvas"), dict) else {}
    width = int(_num(canvas_in.get("width")) or 1280)
    height = int(_num(canvas_in.get("height")) or 720)
    fps = _num(canvas_in.get("fps")) or 24.0
    title = str(args.get("title") or "drama")
    use_probe = True

    # Assembly gate (v7): every clip laid on the timeline must carry a final verdict in
    # out/creation/verified.json — pass, mute_audio, or exhausted (budget spent, best take
    # shipped with the defect on record). There is no waiver: an `allow_unverified=true`
    # escape used to exist here and on 2026-10-29 a run passed it with shots stripped of
    # their take_id, laying 38 unjudged takes into a film that then scored argon 5.8 against
    # 6.4 for the run that kept its gate. Budget spent is recorded as `exhausted`, which this
    # gate accepts; "not judged yet" is not a state a film may be built from.
    if not versioned:
        ledger = _ledger(ctx)
        blocked: list[str] = []
        for shot in shots:
            if not isinstance(shot, dict):
                continue
            sid = str(shot.get("shot_id") or "")
            e = ledger.get(sid) if isinstance(ledger.get(sid), dict) else {}
            st = e.get("status") or e.get("verdict")
            if st not in ("pass", "mute_audio", "exhausted"):
                blocked.append(f"{sid}:{st or 'unverified'}")
        if blocked:
            raise CreationError(
                f"{len(blocked)} clip(s) lack a final verdict in out/creation/verified.json — "
                f"{', '.join(blocked[:12])}{' …' if len(blocked) > 12 else ''}. Run "
                "creation_verify prepare + record on each and regenerate what fails; a take "
                "whose budget is spent is recorded as 'exhausted' and may then be laid."
            )

    # 1012: 计划声明了台词、成片里却没有一处承载它 (既没标 speech_in_clip, 也没挂配音轨,
    # 也没写 mute_reason) —— 那几句台词只会以 0.3 的环境音量躺在片内音轨上, 被音乐床盖住,
    # 或根本没生成。按 shot_id 汇总 (一个镜头拆成多段时只要有一段承载就算), 收尾统一提醒。
    speech_carried: dict[str, bool] = {}
    speech_muted: dict[str, str] = {}
    voice_by_shot: dict[str, list[dict]] = {}
    voiceover_entries: list[dict] = []
    for entry in args.get("voice_clips") or []:
        if not isinstance(entry, dict):
            continue
        # 1012 画外声 (旁白/画外采访者/广告口播): 不属于某个镜头的同期声, 单独一条配音轨,
        # 可以压在有片内台词的镜头上、可以跨镜头 —— 下面主循环之后统一排布
        if str(entry.get("kind") or "") == "voiceover":
            voiceover_entries.append(entry)
            continue
        sid = str(entry.get("segment_id") or entry.get("shot_id") or "")
        if sid:
            voice_by_shot.setdefault(sid, []).append(entry)
    segment_starts: dict[str, float] = {}

    assets: list[dict] = []
    asset_ids: dict[str, str] = {}

    def asset_for(rel: str, kind: str) -> str:
        if rel in asset_ids:
            return asset_ids[rel]
        aid = f"{kind[:1]}{len(assets) + 1:03d}"
        assets.append({"id": aid, "path": rel, "type": kind,
                       "source_sha256": file_digest(ctx.resolve(rel))})
        asset_ids[rel] = aid
        return aid

    video_clips: list[dict] = []
    voice_track_clips: list[dict] = []
    subtitle_clips: list[dict] = []
    warnings: list[str] = []
    playhead = 0.0
    ledger_all = _ledger(ctx)
    segment_ids: set[str] = set()
    used_ranges: dict[str, list[tuple[str, float, float]]] = {}
    # clip digest -> segment id that already laid it; catches the same footage arriving
    # under two shot_ids / take ids, which the per-take range check cannot see.
    seen_source_hashes: dict[str, str] = {}

    # Production contract; see video-creation references for rationale.
    _clips_doc_path = ctx.resolve(str(args.get("clips_path") or "out/creation/clips.json"))
    # Bridges are not part of the versioned contract; a legacy clips.json must not rewrite
    # the trims of reviewed take selections.
    if not versioned and _clips_doc_path.is_file():
        try:
            for _n in _apply_bridge_handles(shots, json.loads(_clips_doc_path.read_text(encoding="utf-8"))):
                warnings.append(_n)
        except (OSError, ValueError):
            pass
    for idx, shot in enumerate(shots):
        if not isinstance(shot, dict):
            raise CreationError(f"shots[{idx}] is not an object")
        shot_id = str(shot.get("shot_id") or f"S{idx + 1:03d}")
        segment_id = str(shot.get("segment_id") or shot_id)
        if segment_id in segment_ids:
            raise CreationError(f"duplicate segment id {segment_id}; give multiple ranges of one shot distinct segment_id values")
        segment_ids.add(segment_id)
        rel = _clean_name(shot.get("clip") or shot.get("source"))
        if not rel:
            raise CreationError(f"shots[{idx}] ({shot_id}) has no clip path")
        path = ctx.resolve(rel)
        if not path.is_file():
            raise CreationError(f"shots[{idx}] ({shot_id}) clip not found: {path}")

        declared = _num(shot.get("duration"))
        actual = _probe_duration(path) if use_probe else None
        dur = actual or declared
        if dur is None or dur <= 0:
            raise CreationError(f"shots[{idx}] ({shot_id}) has no usable duration")
        if actual and declared and abs(actual - declared) > 0.5:
            warnings.append(
                f"{shot_id}: rendered clip is {actual:.2f}s but the shotlist declared "
                f"{declared:.2f}s; the timeline uses the rendered duration."
            )

        # Editorial trim: cut dead opening/closing frames instead of shipping the
        # generated take wall-to-wall (30s+30s hard concat was a v3 pacing defect).
        trim_start = _num(shot.get("trim_start", 0.0))
        if trim_start is None or trim_start < 0:
            raise CreationError("trim_start must be finite and nonnegative")
        trim_end_raw = _num(shot.get("trim_end"))
        src_end = trim_end_raw if "trim_end" in shot else dur
        if src_end is None or src_end > dur + 1e-6:
            raise CreationError("trim_end must lie within the measured clip")
        # 1012: 非版本化装配原先要求 >=1.0s, 鬼畜/卡点的亚秒切做不出来; 与版本化一致改为 1 帧
        minimum = 1.0 / fps
        if src_end - trim_start < minimum - 1e-6:
            raise CreationError(
                f"shots[{idx}] ({shot_id}) trim window [{trim_start}, {src_end}] leaves "
                f"under {minimum:.4f}s of footage — check trim_start/trim_end."
            )
        speed = _num(shot.get("speed", 1))
        if speed is None or not 0.1 <= speed <= 8:
            raise CreationError(f"{segment_id}: speed must be in [0.1, 8]")
        if bool(shot.get("speech_in_clip")) and abs(speed - 1.0) > 1e-6:
            warnings.append(f"{segment_id}: speed {speed} on a speaking clip — lips and the in-clip line drift apart; "
                            "vary speed only on silent shots (0.8-1.2x for pacing)")
        used = (src_end - trim_start) / speed
        if used < 1.0 / fps - 1e-6:
            raise CreationError(f"{segment_id}: selected screen duration is shorter than one frame")
        source_hash = file_digest(path)
        review: dict = {}
        if versioned:
            tid = shot.get("take_id")
            candidate = candidates.get(tid, {})
            review = reviews.get(tid, {})
            if not tid or candidate.get("shot_id") != shot_id or candidate.get("source_sha256") != source_hash:
                raise CreationError(f"{segment_id}: candidate identity/content does not match takes.json")
            if shot_id not in plans:
                raise CreationError(f"{segment_id}: shot_id is not in the directing plan")
            try:
                from .creation_evidence import verify_evidence_files
                verify_evidence_files(review, ctx)
                approved_span(review, shot_plan_digest(plan, plans[shot_id], ctx), source_hash, trim_start, src_end)
            except ValueError as exc:
                raise CreationError(f"{segment_id}: {exc}") from exc
            # Laying the same source range twice repeats its action and line on screen.
            for other_id, a, b in used_ranges.get(tid, []):
                if trim_start < b - 1e-6 and a < src_end - 1e-6:
                    raise CreationError(f"{segment_id}: source range overlaps {other_id} from the same take; "
                                        "each part of a take may appear once")
            used_ranges.setdefault(tid, []).append((segment_id, trim_start, src_end))
        # The same source bytes may also arrive under two shot_ids / two take ids (a
        # re-downloaded candidate, a duplicated plan row). Range bookkeeping above is per
        # take, so that repeat goes unseen; compare the file digest and the laid ranges.
        # Distinct takes of one scene are legitimately different bytes, so an exact
        # overlap here means the same footage was laid twice: report it loudly rather
        # than refuse, because a test render or a deliberately re-used establishing
        # shot must still assemble.
        for other_id, a, b in seen_source_hashes.get(source_hash, []):
            if trim_start < b - 1e-6 and a < src_end - 1e-6:
                warnings.append(
                    f"{segment_id}: lays the same footage range as {other_id} ({rel}); the same "
                    "action will play twice — replace one segment or use a different take")
            else:
                warnings.append(f"{segment_id}: re-uses the clip of {other_id} over a disjoint range; "
                                "check that the action is not visibly repeated on screen")
        seen_source_hashes.setdefault(source_hash, []).append((segment_id, trim_start, src_end))
        if segment_id != shot_id and voice_by_shot.get(shot_id):
            raise CreationError(f"{shot_id}: split-shot voice_clips must bind segment_id to avoid repeated dialogue")
        if versioned and str(plan.get("schema_version")) == "3":
            declared_inner = str(((plans.get(shot_id) or {}).get("narration") or {}).get("line") or "").strip()
            inner_entries = [e for e in voice_by_shot.get(segment_id, []) if e.get("kind") == "inner"]
            inner_rode_in_clip = bool(candidate.get("inner_in_clip") or shot.get("inner_in_clip"))
            if declared_inner and not inner_rode_in_clip and not any(
                str(e.get("text") or e.get("line") or "").strip() == declared_inner
                for e in inner_entries
            ):
                raise CreationError(
                    f"{segment_id}: the plan declares inner monologue {declared_inner!r} but the "
                    "assembly has no matching inner voice entry (voice_clips kind=inner, same text) "
                    "— synthesize it with tts_generate and bind it, or drop it from the plan"
                )
            if not declared_inner and inner_entries:
                raise CreationError(
                    f"{segment_id}: inner voice entry has no declared narration in the plan; "
                    "declare it in shotlist narration first so it is review-covered"
                )
        if trim_start > 0 or src_end < dur:
            warnings.append(
                f"{shot_id}: trimmed to [{trim_start:.2f}s, {src_end:.2f}s] "
                f"({used:.2f}s used of {dur:.2f}s)."
            )

        reason = str(shot.get("reason") or "").strip() or (
            f"Generated shot {shot_id} advances the scripted beat."
        )
        speech_in_clip = bool(shot.get("speech_in_clip"))
        # 承载方式三条 (1012 R2 实测补第三条): 标 speech_in_clip / 挂配音轨 /
        # 显式把片段音量开到接近满档 (agent 自己混音、自建字幕轨的路子, R2 实测台词峰值
        # -2 dB 清晰可闻)。只有三条都没有, 片内台词才会停在环境档 0.3 被音乐床盖住。
        _vol_explicit = _num(shot.get("volume"))
        if (speech_in_clip or voice_by_shot.get(segment_id)
                or (_vol_explicit is not None and _vol_explicit >= 0.9)):
            speech_carried[shot_id] = True
        else:
            speech_carried.setdefault(shot_id, False)
        if str(shot.get("mute_reason") or "").strip():
            speech_muted[shot_id] = str(shot["mute_reason"]).strip()
        clip_entry = {
            "id": segment_id,
            "shot_id": shot_id,
            "asset_id": asset_for(ctx.virtualize(path), "video"),
            "source": ctx.virtualize(path),
            "start": round(trim_start, 3),
            "end": round(src_end, 3),
            "duration": round(src_end - trim_start, 3),
            "screen_duration": round(used, 3),
            "timeline_start": round(playhead, 3),
            "reason": reason,
            "beat": str(shot.get("beat") or ""),
            "source_sha256": source_hash,
            "speed": speed,
        }
        led_entry = ledger_all.get(shot.get("take_id") or shot_id) if isinstance(ledger_all.get(shot.get("take_id") or shot_id), dict) else {}
        ledger_muted = (led_entry.get("status") or led_entry.get("verdict")) == "mute_audio"
        if ledger_muted and "muted" not in shot and "volume" not in shot:
            # Verifier said the clip's own audio carries stray speech: honour it here so
            # the verdict cannot be forgotten at assembly. Dead air is the next risk —
            # the caller should reuse this scene's ambient bed under muted clips.
            clip_entry["muted"] = True
            warnings.append(f"{shot_id}: muted per verified.json (mute_audio).")
        if shot.get("take_id"):
            clip_entry["take_id"] = shot["take_id"]
        if plans.get(shot_id):
            clip_entry["scene_id"] = plans[shot_id].get("scene_id")
            clip_entry["continuity"] = plans[shot_id].get("continuity", {})
            clip_entry["shot_plan_sha256"] = shot_plan_digest(plan, plans[shot_id], ctx)
        elif shot.get("scene_id"):
            clip_entry["scene_id"] = shot["scene_id"]
        muted = bool(shot.get("muted")) or ledger_muted or review.get("verdict") == "mute_audio"
        if muted:
            warnings.append(f"T21 {segment_id}: mute 片段铺同场景环境床，从该场景已有素材提取并核对对白/配乐；"
                            "不要拿跨场景声音或 BGM 代替。没有可用环境床则明确保留静音；不新增生成调用 (advisory)")
        if speech_in_clip and muted:
            # 剧情片里静音一句台词通常是事故; 鬼畜/MV 把说话片段静音后铺音乐、纪录片换掉同期声
            # 是正当剪法 —— 写明 mute_reason 即放行 (1012)
            if not str(shot.get("mute_reason") or "").strip():
                raise CreationError(f"{segment_id}: muted speech needs a deliberate fallback audio edit — "
                                 "state mute_reason on this shot if dropping its in-clip speech is intended")
            warnings.append(f"{segment_id}: in-clip speech muted on purpose ({shot.get('mute_reason')})")
        clip_entry["volume"] = 0.0 if muted else (_num(shot.get("volume")) if shot.get("volume") is not None else 0.3)
        if speech_in_clip:
            # The dialogue was generated INTO this clip (reference_audio mode):
            # its audio carries the line with synced lips — full volume, no TTS
            # overlay. Captions are split per sentence and paced by character count
            # across the spoken window (one caption parked for 13 s over a whole
            # take was a v6 defect), rather than one block for the entire clip.
            clip_entry["volume"] = 0.0 if muted else 1.0
            if shot.get("subtitle_text"):
                raise CreationError("in-clip subtitles require timed ASR; build subtitles after editing with the shared subtitle tools")
            if not muted and not _has_audio_stream(path):
                # The generator returns silent clips: it performed to the line audio but the
                # line is not in the file. Lay that same audio back, aligned to the clip start.
                lines = _clip_speech_audio(ctx, shot, candidate if versioned else {}, _clips_doc_path, path)
                if not lines:
                    raise CreationError(
                        f"{segment_id}: speech_in_clip, but the clip has no audio track (the video generator "
                        "returns silent clips) and no reference line audio is recorded for it — drop "
                        "speech_in_clip and bind the line as voice_clips (TTS overlay)")
                if len(lines) > 1:
                    raise CreationError(
                        f"{segment_id}: silent clip generated against {len(lines)} line audios (one per "
                        "speaker / inner voice); how they interleave is not recorded — drop speech_in_clip "
                        "and bind each line as voice_clips in spoken order")
                line_path, kind = lines[0]["audio"], lines[0]["kind"]
                a_dur = _probe_duration(line_path)
                if not a_dur or a_dur <= 0:
                    raise CreationError(f"{segment_id}: reference line audio has no readable duration: {line_path}")
                if trim_start >= a_dur - 0.05:
                    raise CreationError(f"{segment_id}: trim_start {trim_start:.2f}s is past the end of its "
                                        f"{a_dur:.2f}s line; the line would be dropped — trim less or mark mute_reason")
                laid = min(a_dur - trim_start, used)
                if a_dur - trim_start > used + 1e-3:
                    warnings.append(f"{segment_id}: the trim cuts {a_dur - trim_start - used:.2f}s off the end of its line")
                voice_track_clips.append({
                    "id": f"{shot_id}_line{len(voice_track_clips) + 1}",
                    "asset_id": asset_for(ctx.virtualize(line_path), "audio"),
                    "source": ctx.virtualize(line_path),
                    "start": round(trim_start, 3),
                    "duration": round(laid, 3),
                    "timeline_start": round(playhead, 3),
                    "kind": kind,
                    "reason": "Line laid from the reference audio the silent generator performed to.",
                })
                clip_entry["speech_audio_laid"] = ctx.virtualize(line_path)
        video_clips.append(clip_entry)
        segment_starts.setdefault(segment_id, playhead)
        segment_starts.setdefault(shot_id, playhead)

        # Voice + subtitles: position sequentially inside the shot using each
        # audio file's real duration.
        cursor = playhead
        if speech_in_clip and voice_by_shot.get(segment_id):
            raise CreationError(f"{segment_id}: in-clip speech cannot also have a TTS overlay")
        for line in voice_by_shot.get(segment_id, []):
            audio_rel = _clean_name(line.get("audio") or line.get("path"))
            text = str(line.get("text") or line.get("line") or "").strip()
            if not audio_rel:
                raise CreationError("voice_clips require an audio file")
            audio_path = ctx.resolve(audio_rel)
            if not audio_path.is_file():
                raise CreationError(f"voice audio missing: {audio_path}")
            a_dur = _probe_duration(audio_path)
            if not a_dur or a_dur <= 0:
                raise CreationError(f"voice audio has no readable duration: {audio_rel}")
            if cursor + a_dur > playhead + used + 1e-6:
                if versioned:
                    raise CreationError(f"{segment_id}: voice line exceeds selected screen duration; revise the edit")
                warnings.append(
                    f"{shot_id}: voice line overruns the shot by "
                    f"{cursor + a_dur - (playhead + used):.2f}s; shorten the line or lengthen "
                    "the shot."
                )
            inner = bool(line.get("kind") == "inner")
            voice_track_clips.append({
                "id": f"{shot_id}_v{len(voice_track_clips) + 1}",
                "asset_id": asset_for(ctx.virtualize(audio_path), "audio"),
                "source": ctx.virtualize(audio_path),
                "start": 0.0,
                "duration": round(a_dur, 3),
                "timeline_start": round(cursor, 3),
                "kind": "inner" if inner else "dialogue",
                "reason": (
                    f"Inner monologue of {line.get('speaker') or 'the lead'}."
                    if inner else
                    f"Dialogue delivered by {line.get('speaker') or 'narration'}."
                ),
            })
            if text:
                # Plain ASR-style caption: no speaker prefix (the voice carries
                # who is speaking), hard-wrapped to the canvas. Inner monologue
                # is bracketed so viewers never read it as spoken dialogue.
                subtitle_clips.append({
                    "id": f"{shot_id}_sub{len(subtitle_clips) + 1}",
                    "text": _wrap_subtitle(f"「{text}」" if inner else text, width),
                    "start": round(cursor, 3),
                    "end": round(cursor + a_dur, 3),
                    "duration": round(a_dur, 3),
                    "timeline_start": round(cursor, 3),
                    "reason": (
                        "Caption timed to the inner monologue voice line."
                        if inner else
                        "Caption timed to the synthesized voice line."
                    ),
                })
            cursor += a_dur

        playhead += used

    # 1012 voiceover track: anchored at `at` (absolute timeline seconds) or `offset` seconds after its
    # segment's start (default 0); may run across cuts. Overlapping voiceover lines are pushed later
    # rather than cut short (truncating a narrator mid-sentence is worse than a late start); anything
    # still past the end of the film is trimmed with a warning.
    voiceover_clips: list[dict] = []
    vo_cursor = 0.0
    for k, entry in enumerate(sorted(voiceover_entries, key=lambda e: (
            _num(e.get("at")) if _num(e.get("at")) is not None
            else segment_starts.get(str(e.get("segment_id") or e.get("shot_id") or ""), 0.0)
            + (_num(e.get("offset")) or 0.0)))):
        audio_rel = _clean_name(entry.get("audio") or entry.get("path"))
        text = str(entry.get("text") or entry.get("line") or "").strip()
        if not audio_rel:
            raise CreationError(f"voiceover[{k}] requires audio")
        audio_path = ctx.resolve(audio_rel)
        if not audio_path.is_file():
            raise CreationError(f"voiceover audio missing: {audio_path}")
        a_dur = _probe_duration(audio_path)
        if not a_dur or a_dur <= 0:
            raise CreationError(f"voiceover has no readable duration: {audio_rel}")
        anchor_id = str(entry.get("segment_id") or entry.get("shot_id") or "")
        if _num(entry.get("at")) is not None:
            start = max(0.0, _num(entry.get("at")))
        elif anchor_id in segment_starts:
            start = segment_starts[anchor_id] + max(0.0, _num(entry.get("offset")) or 0.0)
        else:
            warnings.append(f"voiceover {audio_rel}: segment {anchor_id!r} is not on the timeline and no `at` "
                            "given; placed after the previous voiceover line")
            start = vo_cursor
        if start < vo_cursor:
            warnings.append(f"voiceover {audio_rel}: pushed from {start:.2f}s to {vo_cursor:.2f}s to clear the "
                            "previous voiceover line")
            start = vo_cursor
        if start >= playhead or start + a_dur > playhead + 1e-6:
            raise CreationError(f"voiceover {audio_rel} exceeds film duration; revise timing or extend the edit")
        use = a_dur
        voiceover_clips.append({
            "id": f"vo{len(voiceover_clips) + 1}",
            "asset_id": asset_for(ctx.virtualize(audio_path), "audio"),
            "source": ctx.virtualize(audio_path),
            "start": 0.0,
            "duration": round(use, 3),
            "timeline_start": round(start, 3),
            "kind": "voiceover",
            "reason": f"Off-screen voice ({entry.get('speaker') or 'narrator'}).",
        })
        if text:
            subtitle_clips.append({
                "id": f"vo_sub{len(voiceover_clips)}",
                "text": _wrap_subtitle(text, width),
                "start": round(start, 3),
                "end": round(start + use, 3),
                "duration": round(use, 3),
                "timeline_start": round(start, 3),
                "reason": "Caption timed to the voiceover line.",
            })
        vo_cursor = start + use + 0.05
    subtitle_clips.sort(key=lambda c: c["timeline_start"])

    # 对账: 计划里有台词的单元, 成片里必须有一处承载 (片内台词 / 配音轨 / 明确静音)
    _plan_units = plans or {}
    if not _plan_units:
        _sl_path = ctx.resolve(str(args.get("shotlist_path") or "out/creation/shotlist.json"))
        if _sl_path.is_file():
            try:
                _sl = json.loads(_sl_path.read_text(encoding="utf-8"))
                _plan_units = {str(u.get("shot_id") or u.get("sequence_id")): u
                               for u in (_sl.get("shots") or []) + (_sl.get("sequences") or [])
                               if isinstance(u, dict)}
            except (OSError, ValueError):
                _plan_units = {}
    _silent_lines: list[str] = []
    for _sid, carried in sorted(speech_carried.items()):
        if carried or _sid in speech_muted:
            continue
        _lines = [str(d.get("line") or "").strip()
                  for d in ((_plan_units.get(_sid) or {}).get("dialogue") or [])
                  if isinstance(d, dict) and str(d.get("line") or "").strip()]
        if _lines:
            _silent_lines.append(f"{_sid} ({len(_lines)} line(s), e.g. 「{_lines[0][:14]}」)")
    if _silent_lines:
        warnings.append(
            f"{len(_silent_lines)} unit(s) declare dialogue but nothing on the timeline carries it: "
            + "; ".join(_silent_lines[:6]) + (" …" if len(_silent_lines) > 6 else "")
            + ". Their clip audio stays at the ambient level (0.3) under the bed, so the lines are "
            "buried or absent. Fix per unit: speech_in_clip=true and timed ASR subtitles when the line was "
            "generated into the clip (full volume + per-sentence captions), or an explicit "
            "volume >=0.9 if you are mixing and captioning the film yourself, or a voice_clips "
            "entry (TTS overlay), or mute_reason if dropping the line is intended.")

    # Same-track cues must never overlap or validation rejects the timeline —
    # an overrunning voice line (warned above) would otherwise collide with the
    # next shot's first cue. Clamp each cue to the next cue's start.
    clamped = 0
    clamped_ids: list[str] = []
    voice_track_clips.sort(key=lambda c: c['timeline_start'])
    for previous, following in zip(voice_track_clips, voice_track_clips[1:]):
        if previous['timeline_start'] + previous['duration'] > following['timeline_start'] + 1e-6:
            raise CreationError('voice clips overlap; revise timing without truncating audio')
    for track_clips in (subtitle_clips,):
        for i in range(len(track_clips) - 1):
            end = track_clips[i]["timeline_start"] + track_clips[i]["duration"]
            nxt = track_clips[i + 1]["timeline_start"]
            if end > nxt - 0.02:
                new_dur = round(max(0.2, nxt - 0.04 - track_clips[i]["timeline_start"]), 3)
                track_clips[i]["duration"] = new_dur
                if "end" in track_clips[i]:
                    track_clips[i]["end"] = round(
                        track_clips[i].get("start", 0.0) + new_dur, 3)
                clamped += 1
                clamped_ids.append(str(track_clips[i].get("id") or "?"))
    if clamped:
        warnings.append(
            f"{clamped} cue(s) clamped to avoid same-track overlap: {', '.join(clamped_ids[:8])}"
            + (" …" if len(clamped_ids) > 8 else "")
            + ". Subtitle cues share one track, so an overlapping caption is shortened rather "
            "than dropped — offset the voiceover (at/offset) or the line if the shortened cue matters.")

    tracks: list[dict] = [{
        "id": "v1", "name": "shots", "type": "video", "track_type": "video",
        "order": 0, "clips": video_clips,
    }]
    if voice_track_clips:
        tracks.append({
            "id": "a1", "name": "voice", "type": "voiceover", "track_type": "voiceover",
            "order": 1, "clips": voice_track_clips,
        })
    if voiceover_clips:
        tracks.append({
            "id": "a3", "name": "voiceover", "type": "voiceover", "track_type": "voiceover",
            "order": 1, "clips": voiceover_clips,
        })
    bgm = str(args.get("bgm") or "").strip()
    bed_meta: dict = {}
    if bgm:
        bgm_path = _resolve_bgm(ctx, bgm)
        bgm_vol = _num(args.get("bgm_volume"))
        if bgm_vol is None:
            bgm_vol, bed_meta = _calibrated_bed_gain(bgm_path, warnings)
            if bgm_vol is None:
                if BED_AUTOLEVEL:
                    bgm_vol, bed_meta = _bed_gain(bgm_path, video_clips, ctx, warnings)
                else:
                    bgm_vol = 0.18
        tracks.append({
            "id": "a2", "name": "music", "type": "music", "track_type": "music",
            "order": 2,
            "clips": [{
                "id": "bgm1",
                "asset_id": asset_for(ctx.virtualize(bgm_path), "audio"),
                "source": ctx.virtualize(bgm_path),
                "start": 0.0,
                "duration": round(playhead, 3),
                "timeline_start": 0.0,
                "volume": bgm_vol,
                "reason": "Continuous music bed unifying independently generated shots.",
            }],
        })
    if versioned:
        laid = {str(s.get("shot_id")) for s in shots if isinstance(s, dict)}
        missing = [sid for sid in plans if sid not in laid]
        if missing:
            warnings.append(f"plan units not on the timeline: {', '.join(missing[:12])}; cut them from the plan "
                            "on purpose or the story skips those events")
    if subtitle_clips:
        tracks.append({
            "id": "s1", "name": "subtitles", "type": "subtitle",
            "track_type": "subtitle", "order": 3, "clips": subtitle_clips,
        })

    timeline = {
        "version": "1.0",
        "task": "video-creation",
        "project": {
            "name": title,
            "kind": "generated-video",
            "note": (
                "Every clip is a generated sub-shot; cuts between clips are the intended "
                "hard cuts."
            ),
        },
        "sequence": {
            "name": title,
            "fps": fps,
            "duration": round(playhead, 3),
            "canvas": {"width": width, "height": height, "fps": fps},
        },
        "output_canvas": {"width": width, "height": height, "fps": fps},
        "assets": assets,
        "tracks": tracks,
        "metadata": {
            "n_shots": len(video_clips),
            "n_voice_lines": len(voice_track_clips),
            "n_subtitles": len(subtitle_clips),
            "has_bgm": bool(bgm),
            "bgm_level": bed_meta,
            "warnings": warnings,
        },
    }
    written = _write_json(ctx, args.get("output_json") or "out/timeline.json", timeline)
    text = (
        f"Timeline built: {len(video_clips)} shot clips, {round(playhead, 1)}s "
        f"({int(playhead // 60)}m{int(playhead % 60):02d}s), {len(voice_track_clips)} voice "
        f"lines, {len(subtitle_clips)} subtitle cues, bgm={'yes' if bgm else 'no'}.\n"
        "Next: timeline_validate -> video_render -> video_qc."
    )
    if warnings:
        text += "\n\nWarnings:\n" + "\n".join(f"- {w}" for w in warnings[:20])
    return ToolResult(
        text=text,
        data={
            "timeline_path": written,
            "duration_seconds": round(playhead, 3),
            "n_shots": len(video_clips),
            "n_voice_lines": len(voice_track_clips),
            "n_subtitles": len(subtitle_clips),
            "warnings": warnings,
        },
        artifacts=[written],
    )
