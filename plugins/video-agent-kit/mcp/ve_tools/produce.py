"""produce_film — 电影解说六步流程第 5 步的一条命令(自动成片链)。

两种配画模式(fit_mode):
  - legacy(兼容): arrange(anchor) → synthesize_narration → arrange(refit)
      → arrange(anchor·换锚) → bind_narration → render_narrated → qc_preview
    bind 用磁带 DP 把镜头**切成窗口**严丝合缝对齐旁白时长——会在镜头中间下刀,
    是"切镜闪一下"(残帧)的根源之一。
  - whole_shot(默认): arrange(anchor) → synthesize_narration → picture_fit
      → render_narrated → qc_preview
    picture_fit 做**事件级整镜头配画**:刀只落镜头边界,绝不切半截;画面比旁白
    长就当呼吸留白。根除残帧闪(老炮儿 A/B:legacy 4 残帧 / whole_shot 0 残帧)。
    工具新增的补镜(fill)/长镜取段(partial)**不得直接定稿**——picture_fit 返回
    needs_review 时,本工具渲染待审事件的局部预览,交模型复核;通过则
    approve_segments 重调,不通过则 avoid_shot_ids_by_seg 重配(每事件≤3 轮,
    达上限 picture_fit 自判 cannot_fill,返回"无法可靠补齐")。

关键设计:
  - 关键参数全部内置默认(音色/逐句/回验/垫底归零), agent 不再逐个传参 ——
    弱模型漏抄手册参数的教训(GLM 三次漏传 style_instructions)。
  - v6 音频先行(legacy): TTS 之后每拍真实配音时长精确已知, refit 回到该拍
    时间窗按音频重新取卷, 然后在新卷上重跑 anchor 换锚、把新锚 patch 回
    script_tts(音频/文本不变, 全部缓存命中)。
  - 任一步返回"可行动错误"(over_budget / refit_shortage / footage_shortage /
    duration_mismatch / cannot_fill / verify fail / script_invalid)即停, 原样
    透传该步的结构化 data 给 agent 改稿/复核; 改完重调本工具, 底下各层缓存
    保证只重做被改动的部分。
  - avoid_shot_ids 透传给 bind/picture_fit(四档抽查发现矛盾/无关镜头后重绑重渲)。
工具不调任何模型(TTS/ASR 是语音服务, 非 LLM 决策;补镜复核由 agent 驱动)。
"""
from __future__ import annotations

import json
import os

from . import arrange, narrate_tts, narration_bind, picture_fit, qc, render_narrated
from .result import ToolResult
from .run_context import RunContext
from .picture_preflight import preflight_picture
from .picture_windows import enabled as movie_profile
from .recap_runtime_state import stage_run, RuntimeBusy
from .movie_refinement import timeline_name

# movie recap 的成片默认值(可被 args 覆盖, 但正常调用一个都不用传)
DEFAULTS = {
    "provider": "tts",
    "continuous_delivery": True,
    "fit_mode": "whole_shot",
    "bed_volume": 0.0,
    # Original audio is supplied only through explicitly reviewed scenes.
    "tail_volume": 0.0,
    "bgm": False,
}
DEFAULT_STYLE = ("用跟朋友闲聊讲电影的口气解说，自然随意，有讲故事的起伏，"
                 "整体保持匀速讲故事的节奏，不要字正腔圆的播音腔。"
                 "严格按照标点断句，逗号处停顿换气。")
# 复核状态机上限(与 picture_fit.FIT_REVIEW_MAX_ROUNDS 一致, 仅用于回话术)
FIT_REVIEW_MAX_ROUNDS = 3
FIT_REVIEW_PATH = "out/fit_review.json"


def _err(step: str, r: ToolResult) -> ToolResult:
    return ToolResult(text=f"[ERROR] produce_film/{step}: {r.text}",
                      data={**(r.data or {}), "failed_step": step},
                      artifacts=r.artifacts)


def _patch_tts_anchors(ctx: RunContext) -> int:
    """把二次锚定(refit 卷)的句级锚/事件池 patch 回 script_tts.json。

    音频与文本不变, 只换 anchor_shot_ids/event_ids/claim_ids —— 避免为换锚
    重跑 TTS(段级缓存指纹含 semantic_units, 直接重跑会全体失效并重回验)。
    semantic_unit_id 由句序确定性生成, 两次锚定同稿必同 id, 按 id 对齐。
    """
    ns_path = ctx.resolve("out/narration_script.json")
    tts_path = ctx.resolve("out/script_tts.json")
    ns = json.loads(ns_path.read_text(encoding="utf-8"))
    tts = json.loads(tts_path.read_text(encoding="utf-8"))
    units = {u["semantic_unit_id"]: u for seg in ns
             for u in seg.get("semantic_units", [])
             if isinstance(u, dict) and u.get("semantic_unit_id")}
    n = 0
    for seg in tts:
        if not isinstance(seg, dict):
            continue
        for s in seg.get("sentences", []) or []:
            u = units.get(s.get("semantic_unit_id")) if isinstance(s, dict) else None
            if u is None:
                continue
            s["anchor_shot_ids"] = list(u.get("anchor_shot_ids", []))
            # 写手纯引用链/信息点分镜单独保存:refit 重跑只认它们——
            # anchor_shot_ids 在这里已混入磁带分配,回灌当引用链会把违规
            # 计数/节奏打花(踩过)
            s["cited_shot_ids"] = list(u.get("cited_shot_ids", []))
            s["storyboard"] = list(u.get("storyboard", []))
            s["event_ids"] = list(u.get("event_ids", []))
            s["claim_ids"] = list(u.get("claim_ids", []))
            from .picture_semantics import POLICY_FIELDS
            for key in POLICY_FIELDS:
                if key in u:
                    s[key] = u[key]
                else:
                    s.pop(key, None)
            n += 1
    tts_path.write_text(json.dumps(tts, ensure_ascii=False, indent=1),
                        encoding="utf-8")
    return n


def _apply_fit_review(ctx: RunContext, args: dict, review_path: str) -> dict:
    """把 agent 的批准/驳回写进 fit_review.json, 再交给 picture_fit 消费。

    - approve_segments: [seg_id] 或 {seg_id: chain_fp}。批准的是上一轮 picture_fit
      实际生成的链——chain_fp 缺省时从上一份 out/fit_report.json 取。批准后该事件
      的链指纹与 picture_fit 重算结果一致 → is_approved → 退出复核队列。
    - avoid_shot_ids_by_seg: {seg_id: [shot_id]}。驳回这些补镜 → rounds+1 且清掉
      approved_chain;picture_fit 带 avoid 重配出新链, 仍需复核;rounds 达上限
      (3)picture_fit 自判 cannot_fill。
    复核状态(每事件 rounds/approved_chain)持久化在 fit_review.json, 跨调用累加。
    """
    p = ctx.resolve(review_path)
    review: dict = {}
    if p.is_file():
        try:
            review = json.loads(p.read_text(encoding="utf-8"))
            if not isinstance(review, dict):
                review = {}
        except Exception:
            review = {}
    # 上一份 fit_report 的链指纹(批准时缺省 chain_fp 用)
    prev_fp: dict = {}
    fr = ctx.resolve("out/fit_report.json")
    if fr.is_file():
        try:
            for e in json.loads(fr.read_text(encoding="utf-8")).get("events", []):
                if isinstance(e, dict) and e.get("seg_id"):
                    prev_fp[e["seg_id"]] = e.get("chain_fp")
        except Exception:
            pass
    approved = args.get("approve_segments") or []
    if isinstance(approved, dict):
        items = approved.items()
    else:
        items = [(sid, None) for sid in approved]
    for seg_id, fp in items:
        fp = fp or prev_fp.get(str(seg_id))
        if not fp:
            continue   # 没有可批准的链指纹(上一轮没生成)→ 跳过
        ent = review.setdefault(str(seg_id), {})
        ent["approved_chain"] = fp
    rejected = args.get("avoid_shot_ids_by_seg") or {}
    if isinstance(rejected, dict):
        for seg_id in rejected:
            ent = review.setdefault(str(seg_id), {})
            ent["rounds"] = int(ent.get("rounds", 0)) + 1
            ent["approved_chain"] = None
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(review, ensure_ascii=False, indent=1),
                 encoding="utf-8")
    return review


def _render_fit_preview(ctx: RunContext, pending_seg_ids: list, video_path: str,
                        timeline_path: str, args: dict) -> ToolResult | None:
    """渲染待复核事件的局部预览(子集 EDL), 供模型看补镜对不对旁白。

    共享 work_dir 让片段缓存复用——正式渲染时这些待审事件的片段不重切。
    """
    edl_path = ctx.resolve("out/edl.json")
    if not edl_path.is_file():
        return None
    edl = json.loads(edl_path.read_text(encoding="utf-8"))
    rows = edl.get("segments") if isinstance(edl, dict) else edl
    want = set(pending_seg_ids)
    sub = [e for e in rows if isinstance(e, dict) and e.get("seg_id") in want]
    if not sub:
        return None
    sub_path = ctx.resolve("out/edl_fit_preview.json")
    sub_path.write_text(json.dumps(sub, ensure_ascii=False, indent=1),
                        encoding="utf-8")
    return render_narrated.render_narrated({
        "edl_path": "out/edl_fit_preview.json",
        "video_path": video_path,
        "timeline_path": timeline_path,
        "script_path": "out/script_tts.json",
        "output_path": "out/fit_preview.mp4",
        'preview_only': True,
        "work_dir": args.get("work_dir") or ".video_agent/render_narrated",
        "bgm": False,
        "bed_volume": float(args.get("bed_volume", DEFAULTS["bed_volume"])),
        "tail_volume": float(args.get("tail_volume", DEFAULTS["tail_volume"])),
        "subtitle": bool(args.get("subtitle", True)),
        "narration_gain": args.get("narration_gain"),
        "breath_every": int(args.get("breath_every", 0) or 0),
    }, ctx)


def prepare_film_inputs(args: dict, ctx: RunContext, *, require_reviews: bool = True) -> ToolResult:
    """Shared deterministic anchor and script gate, with no synthesis or rendering."""
    for k in ("video_path", "script_path"):
        if not args.get(k):
            return ToolResult(text=f"[ERROR] {k} is required "
                              "(script_path = out/writer_script.json)")
    video_path = args["video_path"]
    title = str(args.get("title") or "")
    timeline_path = args.get("timeline_path") or 'out/' + timeline_name(ctx.resolve('out'))
    reel_path = args.get("reel_path") or "out/reel.json"

    fit_mode = str(args.get("fit_mode") or DEFAULTS["fit_mode"]).lower()
    if fit_mode not in ("legacy", "whole_shot"):
        return ToolResult(text=f"[ERROR] fit_mode must be 'legacy' or "
                              f"'whole_shot', got {fit_mode!r}")
    original_scenes, original_reserved = [], set()
    if args.get("original_audio_path"):
        try:
            from .recap_original_audio import load_scenes, validate_scene_captions
            original_scenes, original_reserved = load_scenes(
                ctx.resolve(args["original_audio_path"]),
                json.loads(ctx.resolve(timeline_path).read_text()))
            validate_scene_captions(ctx.resolve('out'), original_scenes)
        except Exception as exc:
            return ToolResult(text=f"[ERROR] original_audio: {exc}")

    # 1. anchor —— over_budget / script_invalid 即停
    r = arrange.arrange_footage({
        "action": "anchor",
        "reel_path": reel_path,
        "plan_path": args.get("plan_path") or "out/plan.json",
        "script_path": args["script_path"],
        "shots_path": timeline_path,
        "title": title,
    }, ctx)
    if r.text.startswith("[ERROR]"):
        return _err("anchor", r)
    anchor_summary = r.text.split("\n")[0]
    # Recorded soften/drop decisions apply to the production narration only;
    # the reviewed manuscript stays unchanged.
    from .picture_windows import apply_resolution_file
    try:
        resolved = apply_resolution_file(ctx.resolve('out'))
    except (OSError, ValueError) as exc:
        return ToolResult(text=f"[ERROR] sentence resolutions: {exc}", data={'failed_step': 'resolutions'})

    if require_reviews and movie_profile(ctx.resolve('out')):
        from .recap_checks import review_gaps
        gaps = review_gaps(ctx.resolve('out'), 'script_workflow')
        if gaps:
            return ToolResult(text='[ERROR] produce_film/script_review: ' + '; '.join(gaps),
                              data={'failed_step': 'script_review', 'issues': gaps})
    return ToolResult(text=anchor_summary, data={'anchor_summary': anchor_summary,
        'original_scenes': original_scenes, 'original_reserved': sorted(original_reserved),
        **({'resolved_sentences': resolved} if resolved else {})})


def _picture_reservations(ctx, original_reserved):
    profile_path = ctx.resolve('out/production_profile.json')
    if profile_path.is_file() and json.loads(profile_path.read_text()).get('editorial_policy') == 'movie-editorial-v1':
        # The movie interval helper subtracts the exact reserved source ranges.
        return set()
    return set(original_reserved)


def preflight_film(args: dict, ctx: RunContext, original_reserved=()) -> ToolResult:
    return preflight_picture({'reel_path': args.get('reel_path') or 'out/reel.json',
        'timeline_path': args.get('timeline_path') or 'out/' + timeline_name(ctx.resolve('out')),
        'avoid_shot_ids': sorted(set(args.get('avoid_shot_ids') or []) | _picture_reservations(ctx, original_reserved)),
        'avoid_shot_ids_by_seg': args.get('avoid_shot_ids_by_seg'),
        'shot_ranges_path': args.get('shot_ranges_path'), 'chars_per_second': args.get('chars_per_second')}, ctx)


def _produce_film(args: dict, ctx: RunContext) -> ToolResult:
    args = dict(args)
    args.setdefault('continuous_delivery', DEFAULTS['continuous_delivery'])
    if args.get('continuous_delivery'):
        args.setdefault('tail_volume', 0.0)
        args.setdefault('narration_gain', 1.0)
    prepared = prepare_film_inputs(args, ctx)
    if prepared.failed:
        return prepared
    video_path = args['video_path']
    title = str(args.get('title') or '')
    timeline_path = args.get('timeline_path') or 'out/' + timeline_name(ctx.resolve('out'))
    reel_path = args.get('reel_path') or 'out/reel.json'
    fit_mode = str(args.get('fit_mode') or DEFAULTS['fit_mode']).lower()
    anchor_summary = prepared.data['anchor_summary']
    original_scenes = prepared.data['original_scenes']
    original_reserved = set(prepared.data['original_reserved'])
    from .production_ready import validate_ready
    readiness = validate_ready(ctx, args)
    if readiness is not None:
        return readiness
    if fit_mode == 'whole_shot':
        r = preflight_film(args, ctx, original_reserved)
        if r.failed:
            return _err('picture_preflight', r)

    # 2. TTS: continuous movie paragraphs share one ASR check with alignment.
    style = str(args.get("style_instructions") or "").strip() \
        or os.environ.get("VE_TTS_STYLE_DEFAULT", "").strip() or DEFAULT_STYLE
    r = narrate_tts.synthesize_narration({
        "script_path": "out/narration_script.json",
        "provider": args.get("provider") or DEFAULTS["provider"],
        "voice": args.get("voice"),
        "by_sentence": not bool(args.get("continuous_delivery", False)),
        "continuous_delivery": bool(args.get("continuous_delivery", False)),
        "flatten_quotes": True,
        "verify": "asr",
        "style_instructions": style,
    }, ctx)
    if r.text.startswith("[ERROR]"):
        return _err("tts", r)
    verify = (r.data or {}).get("verify") or {}
    if not verify or verify.get("unverified_seg_ids"):
        return ToolResult(
            text=("[ERROR] produce_film/tts_verify: ASR verification is incomplete; "
                  "restore ASR and retry using the cached audio."),
            data={"failed_step": "tts_verify", "verify": verify})
    if verify.get("failed_seg_ids"):
        from .movie_speech_verification import POLICY as movie_speech_policy
        if verify.get('policy') == movie_speech_policy:
            return ToolResult(
                text=("[ERROR] produce_film/tts_verify: unresolved paragraphs "
                      f"{verify['failed_seg_ids']}. Keep the current manuscript and cached audio. "
                      "Inspect the indicated ASR/alignment or listen to these paragraphs; "
                      "correct confirmed errors only. Automatic same-text speech repair is limited "
                      "to one attempt. Other eligible paragraphs can continue with prepare-segments."),
                data={'failed_step': 'tts_verify', 'verify': verify})
        # 不许带病渲染: 把坏句透传给 agent 改写(死穴句通常是内嵌引语/拟声)
        return ToolResult(
            text=("[ERROR] produce_film/tts_verify: failed segments "
                  f"{verify.get('failed_seg_ids')} — rewrite the failed "
                  "sentences in the writer script (remove embedded quotes / "
                  "onomatopoeia), then call produce_film again (cache makes "
                  "unchanged segments free)."),
            data={"failed_step": "tts_verify", "verify": verify})
    tts_summary = r.text.split("\n")[0]
    readiness = validate_ready(ctx, args)
    if readiness is not None:
        return readiness
    if movie_profile(ctx.resolve('out')):
        from .picture_semantics import audit_script_binding
        issues = audit_script_binding(json.loads(ctx.resolve('out/narration_script.json').read_text()),
                                      json.loads(ctx.resolve('out/script_tts.json').read_text()))
        if issues:
            return ToolResult(text='[ERROR] produce_film: TTS records omit or change anchored narration',
                              data={'failed_step': 'tts_script_binding', 'issues': issues})

    # ---- 配画: legacy(refit+bind 切窗口) / whole_shot(picture_fit 整镜头) ----
    if fit_mode == "whole_shot":
        fit_review_path = args.get("fit_review_path") or FIT_REVIEW_PATH
        try:
            _apply_fit_review(ctx, args, fit_review_path)
        except Exception as exc:
            return ToolResult(text=f"[ERROR] produce_film/fit_review: {exc}",
                              data={"failed_step": "fit_review"})
        pf_args = {
            "script_path": "out/script_tts.json",
            "graph_path": args.get("graph_path") or "out/graph.json",
            "timeline_path": timeline_path,
            "reel_path": reel_path,
            "output_edl": "out/edl.json",
            "qc_json": "out/edl_qc.json",
            "fit_report": "out/fit_report.json",
            "fit_review_path": fit_review_path,
        }
        if args.get("avoid_shot_ids") or original_reserved:
            pf_args["avoid_shot_ids"] = sorted(set(args.get("avoid_shot_ids") or []) | _picture_reservations(ctx, original_reserved))
        if args.get("shot_ranges_path"):
            pf_args["shot_ranges_path"] = args["shot_ranges_path"]
        if args.get("avoid_shot_ids_by_seg"):
            pf_args["avoid_shot_ids_by_seg"] = args["avoid_shot_ids_by_seg"]
        r = picture_fit.picture_fit(pf_args, ctx)
        pf_data = r.data or {}
        # footage_shortage / duration_mismatch / edl_qc_failed: text 以 [ERROR] 起
        if r.text.startswith("[ERROR]"):
            return _err("picture_fit", r)
        # cannot_fill: text 以 [PictureFit] 起但 data.error=cannot_fill
        if pf_data.get("error") == "cannot_fill" or pf_data.get("status") == "cannot_fill":
            cannot = [x for x in pf_data.get("needs_review", [])
                      if x.get("status") == "cannot_fill"]
            return ToolResult(
                text=("[ERROR] produce_film/picture_fit: cannot_fill — "
                      f"{len(cannot)} 个事件的补镜复核达上限"
                      f"({FIT_REVIEW_MAX_ROUNDS}轮)仍未通过, 无法可靠补齐。"
                      "换素材(改句子的 cited_shot_ids)或缩短该事件配音, 然后重调: "
                      + ",".join(c["seg_id"] for c in cannot[:8])),
                data={**pf_data, "failed_step": "picture_fit",
                      "fit_mode": "whole_shot"})
        fit_summary = r.text.split("\n")[0]

        # 待复核 → 渲染局部预览, 交模型审补镜(工具新增素材不直接定稿)
        if pf_data.get("status") == "needs_review":
            pending = [x for x in pf_data.get("needs_review", [])
                       if x.get("status") == "pending"]
            seg_ids = [p["seg_id"] for p in pending]
            prv = _render_fit_preview(ctx, seg_ids, video_path, timeline_path, args)
            prv_ok = prv is not None and not prv.text.startswith("[ERROR]")
            prv_path = "out/fit_preview.mp4" if prv_ok else None
            lines = [
                f"produce_film/whole_shot 配画完成, {len(pending)} 个事件含工具新增"
                f"补镜/长镜取段, 须复核后才定稿。",
                f"- picture_fit: {fit_summary}",
            ]
            if prv_ok:
                lines.append(f"- 局部预览: {prv_path}(待审事件按序拼接, 含字幕)")
            else:
                lines.append("- 局部预览渲染失败(见 data.preview_error), 可直接看 "
                             "out/edl.json 的待审窗口 + 抽帧复核")
            lines.append(
                "Next: 看预览逐事件判画面是否对得上旁白。通过→ approve_segments="
                "[seg_id,...] 重调 produce_film;不通过→ avoid_shot_ids_by_seg="
                "{seg_id:[坏镜头id]} 重调(每事件≤"
                f"{FIT_REVIEW_MAX_ROUNDS}轮, 达上限自动 cannot_fill)。")
            return ToolResult(
                text="\n".join(lines),
                data={"status": "needs_review", "fit_mode": "whole_shot",
                      "verify": {k: verify.get(k) for k in
                                 ("failed_seg_ids", "warn_seg_ids") if k in verify},
                      "picture_fit": pf_data.get("status"),
                      "needs_review": pf_data.get("needs_review", []),
                      "fit_report": pf_data.get("fit_report"),
                      "preview": prv_path,
                      "preview_error": (prv.text[:300] if prv and
                                        prv.text.startswith("[ERROR]") else None),
                      "rhythm": pf_data.get("rhythm"),
                      "n_spine_shots": pf_data.get("n_spine_shots"),
                      "n_fill_shots": pf_data.get("n_fill_shots"),
                      "edl": "out/edl.json"},
                artifacts=([str(ctx.resolve("out/edl.json"))] +
                           ([str(ctx.resolve(prv_path))] if prv_ok else [])))

        # 全部通过(或无补镜)→ 落到共享 render 段
        fit_meta = {
            "anchor": pf_data.get("rhythm"),
            "citations": {"n_spine_shots": pf_data.get("n_spine_shots"),
                          "n_fill_shots": pf_data.get("n_fill_shots")},
            "citation_violations": [],
        }
        refit_summary = "(whole_shot: 整镜头配画, 无 refit)"
        bind_summary = fit_summary
    else:
        # 3. refit —— 音频先行: 画面向真实配音时长看齐(拍窗物理装不下才报错)
        refit_args = {
            "action": "refit",
            "reel_path": reel_path,
            "tts_path": "out/script_tts.json",
            "shots_path": timeline_path,
            "script_path": args["script_path"],
            "output_reel": "out/reel_fit.json",
        }
        r = arrange.arrange_footage(refit_args, ctx)
        if r.text.startswith("[ERROR]"):
            return _err("refit", r)
        refit_summary = r.text.split("\n")[0]
        refit_data = r.data or {}

        # 3b. 二次锚定 —— 新卷重算句级锚与事件池(文本不变, 预算已由 refit 兑现),
        #     然后把新锚 patch 回 script_tts(不重跑 TTS)。
        r = arrange.arrange_footage({
            "action": "anchor",
            "reel_path": "out/reel_fit.json",
            "plan_path": args.get("plan_path") or "out/plan.json",
            "script_path": args["script_path"],
            "shots_path": timeline_path,
            "title": title,
            "budget_check": False,
        }, ctx)
        if r.text.startswith("[ERROR]"):
            return _err("anchor_refit", r)
        try:
            _patch_tts_anchors(ctx)
        except Exception as exc:
            return ToolResult(text=f"[ERROR] produce_film/patch_anchors: {exc}",
                              data={"failed_step": "patch_anchors"})

        # 4. bind —— footage_shortage 即停(refit 之后应仅剩约束性无解的罕见情况)
        bind_args = {
            "script_path": "out/script_tts.json",
            "graph_path": args.get("graph_path") or "out/graph.json",
            "timeline_path": timeline_path,
            "reel_path": "out/reel_fit.json",
        }
        if args.get("avoid_shot_ids"):
            bind_args["avoid_shot_ids"] = args["avoid_shot_ids"]
        r = narration_bind.bind_narration(bind_args, ctx)
        if r.text.startswith("[ERROR]"):
            return _err("bind", r)
        bind_data = r.data or {}
        bind_summary = r.text.split("\n")[0]
        fit_meta = {
            "anchor": bind_data.get("anchor"),
            "citations": {k: refit_data.get(k) for k in
                          ("n_dup_citations", "n_out_of_order_citations",
                           "n_anchors_behind_cursor")},
            "citation_violations": refit_data.get("citation_violations") or [],
        }

    readiness = validate_ready(ctx, args)
    if readiness is not None:
        return readiness
    if original_scenes:
        try:
            from .recap_original_audio import insert_scenes
            from .picture_source import load_context
            edl_path = ctx.resolve("out/edl.json")
            packet_path = ctx.resolve('out/writing_packet.json')
            caption_sources = json.loads(packet_path.read_text()).get('sources', {}) if packet_path.is_file() else {}
            source_timeline_path = ctx.resolve(timeline_path)
            source_timeline = json.loads(source_timeline_path.read_text())
            proof, clock = load_context(source_timeline_path.parent, source_timeline)
            source_args = {'source_edit_proof': proof, 'source_clock': clock}
            edited = insert_scenes(json.loads(edl_path.read_text()), original_scenes,
                                   source_timeline,
                                   json.loads(ctx.resolve("out/dialogue_index.json").read_text()),
                                   sources=caption_sources, **source_args)
            # Inserting original audio changes the EDL after picture_fit/bind audited it.
            final_audit = narration_bind.audit_edl(
                edited, fps=float(source_timeline['fps']), **source_args)
            narration_bind.save_audited_edl(edited, final_audit, edl_path,
                                           ctx.resolve("out/edl_qc.json"))
        except Exception as exc:
            return ToolResult(text=f"[ERROR] original_audio: {exc}")

    profile_path = ctx.resolve('out/production_profile.json')
    profile = json.loads(profile_path.read_text()) if profile_path.is_file() else {}
    if profile.get('duration_policy') == 'target-window-v1':
        from .narration_budget import duration_status
        edited = json.loads(ctx.resolve('out/edl.json').read_text())
        rows = edited.get('segments', []) if isinstance(edited, dict) else edited
        # 与渲染同一规则计时: 段画面 + 呼吸段(breath_every>0 时插入)
        duration = duration_status(profile, render_narrated.planned_duration(
            rows, int(args.get("breath_every", 0) or 0)) / render_narrated.SPEEDUP)
        if duration['status'] != 'within_target':
            return ToolResult(text='[ERROR] produce_film/actual_duration_outside_target: '
                              'revise story allocation using actual speech timing; keep reusable audio',
                              data={'failed_step': 'duration', 'status': 'needs_revision',
                                    'duration': duration})

    # render=False: 到 EDL 为止(四档抽查看 EDL 和抽帧, 不需要成品 mp4)。
    # 跑批容器核少渲染慢, 先抽查修完再一次性渲染, 省掉对将废 EDL 的渲染。
    if not bool(args.get("render", True)):
        return ToolResult(
            text=(f"produce_film assembled (render skipped, fit_mode={fit_mode}) "
                  "→ out/edl.json\n"
                  f"- anchor: {anchor_summary}\n"
                  f"- tts: {tts_summary}\n"
                  f"- refit: {refit_summary}\n"
                  f"- bind: {bind_summary}\n"
                  "Next: four-tier spot-check on the EDL; rebind with "
                  "avoid_shot_ids if needed, then call produce_film again "
                  "with render=true (all previous steps hit cache)."),
            data={"verify": {k: verify.get(k) for k in
                             ("failed_seg_ids", "warn_seg_ids") if k in verify},
                  "fit_mode": fit_mode,
                  "anchor_hit": fit_meta.get("anchor"),
                  "citations": fit_meta.get("citations"),
                  "citation_violations": fit_meta.get("citation_violations"),
                  "edl": "out/edl.json", "render_skipped": True},
            artifacts=[str(ctx.resolve("out/edl.json"))])

    # 5. render —— bgm 关, 垫底归零(解说时无原声;留白/拍尾透原声)
    r = render_narrated.render_narrated({
        "edl_path": "out/edl.json",
        "video_path": video_path,
        "timeline_path": timeline_path,
        "script_path": "out/script_tts.json",
        "bgm": bool(args.get("bgm", DEFAULTS["bgm"])),
        "work_dir": args.get("work_dir") or ".video_agent/render_narrated",
        "bed_volume": float(args.get("bed_volume", DEFAULTS["bed_volume"])),
        "tail_volume": float(args.get("tail_volume", DEFAULTS["tail_volume"])),
        "narration_gain": args.get("narration_gain"),
        "breath_every": int(args.get("breath_every", 0) or 0),
    }, ctx)
    if r.text.startswith("[ERROR]"):
        return _err("render", r)
    render_summary = r.text.split("\n")[0]
    render_warnings = list((r.data or {}).get("warnings") or [])
    if not (r.data or {}).get("subtitle_burned", True):
        # 字幕静默降级曾把 v5/冒烟全线成片弄成无字幕——降级必须喊出来
        render_warnings.insert(0, "narration subtitles were NOT burned "
                               "(font detection failed?) — check warnings")
    seam = (r.data or {}).get("seam_scan") or {}
    if seam.get("status") == "residual_frames":
        render_warnings.insert(0, f"seam scan: {seam.get('n_bad')}/{seam.get('n_seams')} "
                               "cuts carry residual frames (visible flash)")

    # 6. qc_preview(带 timeline 才有哈希追溯链)
    r = qc.qc_preview({
        "video_path": "out/final.mp4",
        "timeline_path": timeline_path,
    }, ctx)
    if r.failed:
        return _err("qc", r)
    qc_summary = r.text.split("\n")[0] if not r.text.startswith("[ERROR]") else r.text[:200]
    readiness = validate_ready(ctx, args)
    if readiness is not None:
        return readiness

    return ToolResult(
        text=(f"produce_film complete (fit_mode={fit_mode}) → out/final.mp4\n"
              f"- anchor: {anchor_summary}\n"
              f"- tts: {tts_summary}\n"
              f"- refit: {refit_summary}\n"
              f"- bind: {bind_summary}\n"
              f"- render: {render_summary}\n"
              + (f"- render warnings: {'; '.join(render_warnings[:4])}\n"
                 if render_warnings else "")
              + f"- qc: {qc_summary}\n"
              + (f"- seam scan: {seam.get('n_seams', 0) - seam.get('n_bad', 0)}"
                 f"/{seam.get('n_seams', 0)} 切点干净(0 残帧)\n"
                 if seam.get("n_seams") else "")
              + "Next: directed spot-check (step 6) — verify sentence/picture "
              "with the four-tier verdicts; on contradiction/irrelevant "
              "windows call produce_film again with avoid_shot_ids."),
        data={"verify": {k: verify.get(k) for k in
                         ("failed_seg_ids", "warn_seg_ids") if k in verify},
              "fit_mode": fit_mode,
              "anchor_hit": fit_meta.get("anchor"),
              # 写手引用纪律: legacy 走 refit 曝光的违规计数;whole_shot 走脊柱/补镜数
              "citations": fit_meta.get("citations"),
              "citation_violations": fit_meta.get("citation_violations"),
              "seam_scan": seam,
              "final": "out/final.mp4"},
        artifacts=[str(ctx.resolve("out/final.mp4"))])


def produce_film(args: dict, ctx: RunContext) -> ToolResult:
    try:
        with stage_run(ctx.project_dir, 'production', inputs={'arguments': args,
                       'script': ctx.resolve(args['script_path']) if args.get('script_path') else None}, outputs=[]) as stage:
            result = _produce_film(args, ctx)
            if result.failed or (result.data or {}).get('status') == 'needs_review':
                stage.fail((result.data or {}).get('failed_step') or 'needs_review')
            else:
                stage.complete()
            return result
    except RuntimeBusy:
        return ToolResult(text='[ERROR] produce_film: active writer or occupied resource; retry after the owner finishes',
                          data={'failed_step': 'ownership', 'status': 'busy', 'retryable': True})
    except (ValueError, OSError, KeyError, TypeError) as exc:
        return ToolResult(text=f'[ERROR] produce_film input/state: {exc}', data={'failed_step': 'input'})
