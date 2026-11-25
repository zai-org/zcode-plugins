"""Video generator profile and transport (Seedance through ZCode ToolHub).

The plugin compiles one request as the ``content`` list of the video generator
(``text`` / ``image_url`` / ``video_url`` / ``audio_url`` items with roles);
``submit`` converts that list into the ToolHub body at the boundary, uploading
inline images so the 4 MiB request limit holds. Model, resolution (480p), audio
generation and watermark are fixed by ToolHub; duration (4..30 s) and ratio are
the caller's.
"""
from __future__ import annotations

import base64
import binascii
import time
from pathlib import Path
from typing import Any

from ve_tools.run_context import clean_env

SEEDANCE_NOTES = {
    "inner_voice": ("音频说明补充：Audio {n} 是{who}的心声（画外音），只在 Shot {shot} 内响起，不是任何人当场说出的话；"
                    "这段声音响起时{who_short}嘴唇紧闭、不做说话口型，画面中其他人物也不开口。"
                    "Audio {n} 的音色与该角色说台词时的音色是同一个人。"),
    "world_tail": ("参考图说明补充：图片 {n} 为上一段（{upstream}）结尾画面，仅参考其场景布置、光线方向与人物站位；"
                   "不作为首帧，不复制其构图，不把其中人物当作新角色。"),
    "style_bible": "补充说明（全片基准）：{bible}",
    "keyframe_range": "以图片 {a} 至图片 {b} 的顺序作为关键帧，",
    "keyframe_one": "以图片 {a} 作为关键帧，",
    "keyframe_shot": "图片 {a} 是 Shot {m} 的起始画面",
    "picture_only_ref": ("参考视频说明：参考视频只用于延续场景、光线、空间关系与角色状态，"
                         "不采用其中的人声、音色与语气；本镜台词的声音只以参考音频为准。"),
    "no_speech": "无人说话，画面中任何角色都不开口、不做说话的口型。",
    "image_ref": "Image {n}",
    # 官方《参考类（多素材映射）》: 素材的映射和指代关系说明非常重要, 按上传顺序编号逐一绑定,
    # "不建议只在图片里呈现映射信息"。示例原文: 「图片 1 是主角张三，图片 1 使用音频 1 音色」。
    # 10-31 实测 v41 的 12 条 prompt 里 图片N / 音频N / "使用音频N音色" 各 0 次 —— 只写了裸
    # @角色名, 映射全靠上传顺序隐含, 正是文档点名不推荐的写法; 同期量到 TTS↔生成语音的说话人
    # 可分性 AUC 0.545 (贴随机线), 即音色锚没传过去。这条声明就是把绑定写成文字。
    "material_map_head": "素材绑定（按上传顺序）：{items}。",
    "material_map_image": "图片 {n} 是{who}",
    "material_map_image_voice": "图片 {n} 是{who}，{who}使用音频 {a} 的音色",
    "material_map_audio": "音频 {a} 是{who}的台词与音色",
    "material_map_plate": "图片 {n} 是{what}场景参考",
    # 官方《背景音乐约束不生效》: 音频约束在提示词的开头与结尾各写一遍, 并一次性穷举音乐类
    # 同义词, 避免模型替换表述绕过约束。
    "audio_guard_head": ("音频约束（开头声明，结尾重复）：只生成台词人声与画面对应的环境音/动作音；"
                         "不要音乐、不要背景音乐、不要 BGM、不要配乐、不要器乐、不要旋律、"
                         "不要合成器音效、不要氛围铺底音。"),
    # 一刀切禁乐是为了保护台词清晰度, 但它也让全片一个音乐垫都没有 —— argon 在 v43/v45 两轮
    # 都把「缺背景音乐」列进硬伤。所以禁令改成按单元放行: plan 的 unit 写了 music, 就换成这条。
    # 官方提示词规则: 音乐用 ()、音效用 <>、台词用 {}、字幕用 【】。
    "audio_guard_music_head": ("音频约束（开头声明，结尾重复）：只生成台词人声、画面对应的环境音/动作音，"
                               "以及下面这一条明确写出的音乐；不要其他音乐、不要额外配乐、"
                               "不要合成器音效、不要氛围铺底音。"),
    "music_cue": ("音乐：（{cue}）。音乐只作背景垫底，音量明显低于人声；"
                  "有台词时自动压低、不盖住任何一个字；不哼唱、不出现人声演唱、不出现歌词。"),
}
_SEEDANCE_COMMON = {
    "provider": "seedance", "dialect": "seedance", "notes": SEEDANCE_NOTES,
    # ToolHub fixes the model, resolution, audio generation and watermark; seed is not passed.
    "max_images": 9, "seed": False, "native_audio_flag": False,
    # Clips come back WITHOUT an audio track. Reference audio still conditions the
    # performance (mouth rhythm), but the line itself must be laid from the reference
    # audio at assembly; nothing can be heard "in-clip".
    "audio_out": False,
}
PROFILES: dict[str, dict[str, Any]] = {
    # ToolHub video_generate runs Seedance 2.5: 4..30 s, ratios 16:9/4:3/1:1/3:4/9:16/21:9/adaptive,
    # at most 9 images / 3 videos / 3 audios per request (ToolHub caps, below the model's own).
    # Editing (omni_reference_task_type) is not passed through: edit is not available.
    "video-v2.5": {**_SEEDANCE_COMMON, "model": "doubao-seedance-2-5-260628",
                     "max_reference_video_seconds": 30.0,  # total external reference video, soft pre-check
                     "min_seconds": 4, "max_seconds": 30, "max_videos": 3, "max_audio": 3,
                     "max_audio_seconds": 30.0, "audio_min_seconds": 0.0, "audio_needs_visual": False,
                     "timestamps": "seconds", "default_cuts": False, "edit": "not_wired", "task_type_param": False,
                     "default_resolution": "480p", "resolutions": ("480p",),
                     "prompt_soft_chars": None, "multi_view_cards": True},
}
ALIASES = {'seedance-2.5': 'video-v2.5', 'sd25': 'video-v2.5', 'seedance2.5': 'video-v2.5'}
RATIOS = ("16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive")
ENDPOINT_LABEL = "zcode-toolhub:video_generate"
SUBMIT_REPLAYS = 3            # UNKNOWN / CALLING / transport loss: replay the SAME key, never a new one
SUBMIT_REPLAY_DELAY_SECONDS = 6.0
MAX_INLINE_UPLOAD_BYTES = 10 * 1024 * 1024


def resolve_name(name: str | None) -> str | None:
    if not name:
        return None
    n = str(name).strip()
    if n in PROFILES:
        return n
    if n.lower() in ALIASES:
        return ALIASES[n.lower()]
    for pname, p in PROFILES.items():
        if p["model"] == n:
            return pname
    return None


def active_name(model: str | None = None) -> str:
    """Profile name for this process: VE_VIDEO_GENERATOR > a known model id > video-v2.5."""
    return resolve_name(clean_env("VE_VIDEO_GENERATOR")) or resolve_name(model) or "video-v2.5"


def profile(name_or_model: str | None = None) -> dict:
    """The profile for a name / model id, else the active one. Returned dict includes `name`."""
    if name_or_model and not resolve_name(name_or_model):
        raise ValueError(f"unknown video generator/model: {name_or_model}")
    configured = clean_env("VE_VIDEO_GENERATOR")
    if configured and not resolve_name(configured):
        raise ValueError(f"unknown VE_VIDEO_GENERATOR: {configured}")
    name = resolve_name(name_or_model) or active_name(name_or_model)
    return {"name": name, **PROFILES[name]}


def plan_profile(plan: dict | None) -> dict:
    """A plan may pin its generator (plan['generator']); otherwise the process's active profile."""
    pinned = resolve_name((plan or {}).get("generator")) if isinstance(plan, dict) else None
    if isinstance(plan, dict) and plan.get("generator") and not pinned:
        raise ValueError(f"unknown plan generator: {plan['generator']}")
    return profile(pinned) if pinned else profile()


def require_channel() -> None:
    """Raise ProviderError when this call cannot reach ToolHub (no ZCode host or identity)."""
    from . import toolhub
    state = toolhub.status()
    if not state["available"]:
        raise ProviderError("video generator unavailable: " + "; ".join(state["reasons"]))


def notes(prof: dict) -> dict:
    return prof.get("notes") or SEEDANCE_NOTES


def assembled_prompt_len(seq: dict, plan: dict, prof: dict) -> int:
    """Length of one sequence's prompt AS THE TOOL ASSEMBLES IT: the plan text plus every
    block video_generate prepends/appends on the agent's behalf — keyframe
    declaration, style bible, inner-monologue (画外音) declaration, upstream tail-frame
    (尾帧) declaration. Consumed by creation_plan_validate as a hard gate on
    prompt_soft_chars, so a prompt the provider would refuse for length dies at plan
    level instead of at submit time.

    计划层估算口径 (与装配代码同式): bible 走 creation_media 的 `bible[:12] not in prompt`
    跳过规则; 图/音编号取一位小值 (与真实编号宽度差 ≤2 字符); 不计 承接状态注入行与
    picture_only_ref (前者由 creation_media 开关控制、百字级, 后者仅 edit/motion 路径) —
    估算略偏保守, 限额内留白足够覆盖。"""
    gnotes = notes(prof)
    base = str(seq.get("prompt") or "")
    total = len(base)
    kfs = seq.get("keyframes") or []
    if kfs:
        decl = (gnotes["keyframe_one"].format(a=1) if len(kfs) == 1
                else gnotes["keyframe_range"].format(a=1, b=len(kfs)))
        total += len(decl) - (len(base) - len(base.lstrip()))  # decl prepends before the lstripped base
    bible = str((plan or {}).get("style_bible") or "").strip()
    if bible and bible[:12] not in base:
        total += 1 + len(gnotes["style_bible"].format(bible=bible))
    narr = seq.get("narration")
    if isinstance(narr, dict) and str(narr.get("speaker") or "").strip():
        who = str(narr.get("speaker"))
        names = [str(c.get("name") or "") for c in (plan or {}).get("cast") or [] if isinstance(c, dict)]
        widest = max(names, key=len) if names else who  # 角色名包装按最长角色名估
        who_full = f"Image 9 中的角色（{widest}）"
        total += 1 + len(gnotes["inner_voice"].format(n=9, who=who_full, who_short=who,
                                                       shot=narr.get("shot") or "对应"))
    upstream = seq.get("continuity_from")
    if upstream:
        total += 1 + len(gnotes["world_tail"].format(n=9, upstream=upstream))
    return total


def resolution_for(prof: dict, requested: str | None) -> str:
    """The resolution the generator produces (fixed by ToolHub; requests cannot change it)."""
    return prof["default_resolution"]


def build_body(prof: dict, model: str, content: list[dict], duration: int, resolution: str | None,
               ratio: str | None, generate_audio: bool = True, task_type: str | None = None,
               frame_mode: bool = False) -> dict:
    """The compiled request: content list, duration and ratio (the fields ToolHub accepts).

    ``model``, ``resolution``, ``generate_audio`` and ``task_type`` are kept in the
    signature for the callers' recipes; ToolHub fixes them. First/last-frame tasks
    take their ratio from the frame image, so no ratio is sent for them.
    """
    dur = int(max(prof["min_seconds"], min(prof["max_seconds"], int(round(duration)))))
    body: dict[str, Any] = {"content": content, "duration": dur}
    if ratio and not frame_mode:
        body["ratio"] = ratio
    return body


class ProviderError(RuntimeError):
    def __init__(self, message: str, *, retry_same_key: bool = False):
        super().__init__(message)
        self.retry_same_key = retry_same_key   # True: the task may exist; replay the same Idempotency-Key


def _inline_image(url: str, uploads: dict) -> str:
    """``data:image/...;base64,`` -> uploaded https URL (the request body is capped at 4 MiB)."""
    from . import toolhub
    if not url.startswith("data:"):
        return url
    header, _, payload = url.partition(",")
    if ";base64" not in header or not header.startswith("data:image/"):
        return url
    if payload in uploads:
        return uploads[payload]
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ProviderError(f"inline reference image is not valid base64: {exc}") from None
    suffix = {"png": ".png", "jpeg": ".jpg", "jpg": ".jpg", "webp": ".webp"}.get(
        header[len("data:image/"):].split(";", 1)[0].lower(), ".png")
    import tempfile
    with tempfile.TemporaryDirectory(prefix="video-ref-") as tmp:
        path = Path(tmp) / ("reference" + suffix)
        path.write_bytes(raw)
        if path.stat().st_size > MAX_INLINE_UPLOAD_BYTES or suffix not in (".png", ".jpg", ".webp"):
            from PIL import Image
            with Image.open(path) as im:
                converted = path.with_suffix(".jpg")
                im.convert("RGB").save(converted, format="JPEG", quality=90)
            path = converted
        try:
            uploaded, _ = toolhub.upload_file(path)
        except toolhub.ToolHubError as exc:
            raise ProviderError(f"reference image upload failed: {exc}") from exc
    uploads[payload] = uploaded
    return uploaded


def _inline_audio(url: str, uploads: dict) -> str:
    """``data:audio/...;base64,`` -> uploaded https URL (keeps the JSON body under 4 MiB)."""
    from . import toolhub
    if not url.startswith("data:"):
        return url
    header, _, payload = url.partition(",")
    if ";base64" not in header or not header.startswith("data:audio/"):
        return url
    if payload in uploads:
        return uploads[payload]
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ProviderError(f"inline reference audio is not valid base64: {exc}") from None
    kind = header[len("data:audio/"):].split(";", 1)[0].lower()
    suffix = ".wav" if kind in ("wav", "x-wav", "wave") else ".mp3"
    if len(raw) > MAX_INLINE_UPLOAD_BYTES:
        raise ProviderError(f"reference audio is {len(raw):,d} B, over the {MAX_INLINE_UPLOAD_BYTES:,d} B upload limit")
    import tempfile
    with tempfile.TemporaryDirectory(prefix="video-ref-") as tmp:
        path = Path(tmp) / ("reference" + suffix)
        path.write_bytes(raw)
        try:
            uploaded, _ = toolhub.upload_file(path)
        except toolhub.ToolHubError as exc:
            raise ProviderError(f"reference audio upload failed: {exc}") from exc
    uploads[payload] = uploaded
    return uploaded


def toolhub_body(body: dict) -> dict:
    """Convert a compiled content-list body into the ToolHub video_generate body."""
    uploads: dict[str, str] = {}
    query: list[str] = []
    out: dict[str, Any] = {"duration": body.get("duration")}
    if body.get("ratio"):
        out["ratio"] = body["ratio"]
    for item in body.get("content") or []:
        kind, role = item.get("type"), item.get("role")
        if kind == "text":
            query.append(str(item.get("text") or ""))
        elif kind == "image_url":
            url = _inline_image(str((item.get("image_url") or {}).get("url") or ""), uploads)
            if role in ("first_frame", "last_frame"):
                out[role] = url
            else:
                out.setdefault("images", []).append(url)
        elif kind == "video_url":
            url = str((item.get("video_url") or {}).get("url") or "")
            if url.startswith("data:"):
                raise ProviderError("reference videos must be https URLs (the generator accepts no inline video)")
            out.setdefault("videos", []).append(url)
        elif kind == "audio_url":
            out.setdefault("audios", []).append(_inline_audio(str((item.get("audio_url") or {}).get("url") or ""), uploads))
    out["query"] = "\n".join(q for q in query if q.strip())
    if not out["query"]:
        raise ProviderError("the video prompt is empty")
    if ("first_frame" in out or "last_frame" in out) and (out.get("images") or out.get("videos") or out.get("audios")):
        raise ProviderError("first/last frame and reference media cannot be combined in one request")
    if "last_frame" in out and "first_frame" not in out:
        raise ProviderError("last_frame requires first_frame")
    if "first_frame" in out:
        out.pop("ratio", None)   # the output ratio follows the first frame
    return out


def submit(prof: dict, body: dict) -> str:
    """Create the task; returns its id. Raises ProviderError when no task id can be obtained."""
    from . import toolhub
    return submit_request(toolhub.PATH_VIDEO_SUBMIT, toolhub_body(body))


def submit_request(path: str, request: dict, key: str | None = None) -> str:
    """Submit one ToolHub video task body to ``path``; returns its task id.

    One Idempotency-Key per submission (pass ``key`` to replay a stored one). A
    lost response, UNKNOWN or CALLING is replayed with the SAME key (a new key
    would create another task); a replay reports the task id in
    ``upstream_req_id``.
    """
    from . import toolhub
    key = key or toolhub.new_idempotency_key()
    last = None
    for attempt in range(SUBMIT_REPLAYS + 1):
        if attempt:
            time.sleep(SUBMIT_REPLAY_DELAY_SECONDS)
        try:
            data, meta = toolhub.invoke_with_retries(path, json_body=request, idempotency_key=key,
                                                     timeout_seconds=toolhub.SUBMIT_TIMEOUT_SECONDS)
        except toolhub.ToolHubError as exc:
            if exc.retry_same_key and attempt < SUBMIT_REPLAYS:
                last = str(exc)
                continue
            raise ProviderError(f"video generator refused the task: {exc}",
                                retry_same_key=bool(exc.retry_same_key)) from exc
        output = data.get("output") if isinstance(data.get("output"), dict) else {}
        task_id = output.get("task_id") or (data.get("upstream_req_id") if data.get("replayed") else None)
        if data.get("state") == "SUCCEEDED" and task_id:
            return str(task_id)
        last = f"state {data.get('state')!r} (logid {meta.get('logid')})"
    raise ProviderError(f"video submission outcome unknown after {SUBMIT_REPLAYS + 1} same-key replays ({last}); "
                        f"the task may exist upstream — do not resubmit it with a new request (Idempotency-Key {key})",
                        retry_same_key=True)


def poll(prof: dict, task_id: str, query_path: str | None = None) -> dict:
    """One status read: {status: queued|running|succeeded|failed, video_url, error, usage, raw}."""
    from . import toolhub
    try:
        raw, _ = toolhub.invoke_with_retries(query_path or toolhub.PATH_VIDEO_QUERY, json_body={"task_id": task_id},
                                             timeout_seconds=toolhub.QUERY_TIMEOUT_SECONDS, attempts=2)
    except toolhub.ToolHubError as exc:
        if exc.code == 3704:
            return {"status": "failed", "video_url": None, "usage": None, "raw": exc.detail,
                    "error": {"code": "task_not_found", "message": str(exc)}}
        if exc.retry_same_key:
            # Transient: report it as still running so the caller keeps polling the same task.
            return {"status": "running", "video_url": None, "error": None, "usage": None, "raw": exc.detail}
        raise ProviderError(f"video task query failed: {exc}") from exc
    status = str(raw.get("status") or "").lower()
    if status not in ("queued", "running", "succeeded", "failed"):
        status = "running"
    output = raw.get("output") if isinstance(raw.get("output"), dict) else {}
    return {"status": status, "video_url": output.get("video_url") if status == "succeeded" else None,
            "expires_at": output.get("expires_at"), "error": raw.get("failure") if status == "failed" else None,
            "usage": raw.get("usage"), "raw": raw}


def summary_line(prof: dict) -> str:
    """One line for tool texts / the SKILL: what this generator allows."""
    return (f"generator {prof['name']}: {prof['min_seconds']}-{prof['max_seconds']}s per request, "
            f"<= {prof['max_images']} images / {prof['max_videos']} videos / {prof['max_audio']} audio refs "
            f"(audio total <= {prof['max_audio_seconds']:g}s"
            + (f"; external reference video gate: {prof['max_reference_video_seconds']:g}s" if prof.get("max_reference_video_seconds") else "")
            + (", each >= 2s, must ride with an image or video" if prof["audio_needs_visual"] else "")
            + f"); timestamps: {prof['timestamps']}; dialect: {prof['dialect']}")


def effective_ratio(plan, requested=None):
    if requested:
        return requested
    canvas = (plan or {}).get('canvas') or {}
    w, h = canvas.get('width'), canvas.get('height')
    if not isinstance(w, (int, float)) or not isinstance(h, (int, float)) or w <= 0 or h <= 0:
        return 'adaptive'
    ratios = {'1:1': 1, '16:9': 16/9, '9:16': 9/16, '4:3': 4/3, '3:4': 3/4, '21:9': 21/9}
    return min(ratios, key=lambda k: abs(ratios[k] - w/h))
