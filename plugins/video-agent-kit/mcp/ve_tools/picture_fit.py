"""picture_fit — 按事件统一配画，以实际配音时间决定画面槽。

短镜头整取；长镜头可取与句子证据对应的片段，但内部取段必须经过局部
预览复核。余量由呼吸留白吸收，真实重叠、倒退和未计划的重复仍由硬质检拦截。
Movie Recap 可以加载独立验证的内部自然切点，保留原父镜头和证据编号，按
真实源帧区分可用片段。没有有效证明时保留原有父镜头重复规则。

事件内统一配画(不是逐句凑):
  1. 先登记**全篇主镜头**(写手在各句 cited/anchor 点名的镜头),按事件归属;
     后面事件的主镜头不会被前面事件的补镜抢走。
  2. 每个事件: 把该事件所有句子 + 配音时长 + 主镜头汇总,在事件镜头池里
     排一条整镜头链——主镜头是脊柱,脊柱之间用池内整镜头(补镜)按原片顺序
     填补到盖住配音时长。
  3. 一个镜头连续覆盖两句不算重复(它本就是一条整镜头);离开成片再出现才算
     重复(全片镜头不重复账本)。

单调性分层:
  - 事件内链按原片顺序(镜头 start 递增);
  - 事件间按大纲顺序(冷开场/回叙合法,走独立账本);
  - 全片只查镜头不重复。

三种失败出口(返回结构化 error,交回写稿/选镜层,工具不硬凑):
  - footage_shortage: 事件池整镜头总时长盖不住配音 → 缩稿/找素材;
  - duration_mismatch: 主镜头本身就超配音太多,整镜头组合对不上 → 换主镜头/改稿;
  - cannot_fill: 补镜候选反复未过模型复核(达重试上限)→ 换素材/改表达。

补镜复核(用户硬规则,见记忆 shot-fill-review-rule):
  工具新增的补镜不得直接定稿。本工具把每个事件的补镜清单 + 局部预览写进
  fit_report,交模型复核;不通过的事件带 avoid 重跑,达上限返回 cannot_fill。

纯确定性,无任何 LLM 调用。产出 EDL 契约与 bind 逐字段一致(schema 3.2-reel),
render_narrated / qc_preview / audit_edl 直接复用。
"""
from __future__ import annotations

import math

from .result import ToolResult
from .run_context import RunContext
from .picture_semantics import policy, map_intervals, audit_requirements
from .picture_preflight import apply_reveal_limits
from .movie_intervals import constrain_pool, pool_report
from .picture_source import load_context, edit_ranges, span_metadata, referenced_spans
from .source_usage import normalize_window, verified_pool
from .narration_bind import (
    REEL_SCHEMA_VERSION, DEFAULT_FPS, MIN_WINDOW_SEC, TAIL_MAX_SEC, audit_edl, normalize_emotion, load_json, save_json, save_audited_edl,
)

# 整镜头链时长上限 = 配音 + 此余量(呼吸留白);超出就削补镜
FIT_TAIL_CAP_SEC = TAIL_MAX_SEC
# 链时长低于配音此值即判素材不足(整镜头盖不住配音)
FIT_SHORTAGE_EPS = 0.30
# 补镜复核重试上限(每事件,含首审 = 最多改两次)
FIT_REVIEW_MAX_ROUNDS = 3
# 事件窗内整镜头盖不住配音时,允许越窗向后顺延的上限(与 refit 同源);
# 后序事件的主镜头已被 reserved 保护,顺延只吃它们的补镜(补镜是可替换的)
FIT_TOPUP_EXTRA = 20.0
# 长镜头阈值:超过此秒数的镜头不整取(整取会让一个镜头盖住整段、节奏死板),
# 只取盖住句槽的一段。长镜头内部切出是"触发条件非许可"(用户定),取段标
# partial → 进模型复核查动作截断/信息完整。段内切点不产生残帧(连续素材,
# 无相邻镜头可漏);相邻句续用同一长镜头则帧连续无缝。
LONG_SHOT_SEC = 9.0


# ---------------------------------------------------------------------------
# 事件镜头池
# ---------------------------------------------------------------------------

def _event_pool(win: dict, shots: list[dict], shot_starts: list[float],
                reserved_later: set[str], used_global: set[str],
                avoid: set[str], topup: float = 0.0, *,
                source_edit_proof: dict | None = None, source_clock: dict | None = None,
                used_edit_spans: set[str] | None = None,
                reserved_edit_spans: set[str] | None = None) -> list[dict]:
    """事件窗口 [t0, t1+topup] 内的整镜头池(原片顺序)。

    剔除: 已被前序事件用掉的(全片不重复)、被后序事件登记为主镜头的(防抢)、
    四档抽查判矛盾要回避的。冷开场事件由调用方传独立账本,不走 used_global。
    topup>0 时窗口尾向后顺延(窗内整镜头盖不住配音的兜底,与 refit 同源)。
    """
    t0 = float(win.get("t0", 0.0))
    t1 = float(win.get("t1", 0.0)) + max(0.0, topup)
    if t1 <= t0:
        return []
    lo = max(0, __import__("bisect").bisect_left(shot_starts, t0) - 1)
    pool = []
    for s in shots[lo:]:
        st, en = float(s["start"]), float(s["end"])
        if st >= t1:
            break
        sid = s["shot_id"]
        if sid in avoid:
            continue
        if sid in reserved_later and not (source_edit_proof is not None
                and sid in source_edit_proof['shots'] and reserved_edit_spans is not None):
            # A verified internal reservation is enforced below at its actual
            # span; legacy or ambiguous callers keep the whole-parent ban.
            continue
        row = {"shot_id": sid, "start": st, "end": en,
               "dur": en - st, "boundary_in": s.get("boundary_in", "hard"),
               "reviewed_span": s.get("reviewed_span")}
        if source_edit_proof is not None and sid in source_edit_proof['shots']:
            row = verified_pool([row], source_clock['binding']['fps'],
                                source_edit_proof=source_edit_proof, source_clock=source_clock)[0]
            blocked = (used_edit_spans or set()) | (reserved_edit_spans or set())
            spans = [span for span in edit_ranges(row)
                     if t0 <= (span['span_start'] + span['span_end']) / 2 < t1
                     and span['edit_span_id'] not in blocked]
            # Callers without the per-span ledger retain the parent-level ban.
            if not spans or (sid in used_global and used_edit_spans is None):
                continue
            row['effective_spans'] = [(span['start'], span['end']) for span in spans]
        elif sid in used_global or not t0 <= (st + en) / 2 < t1:
            continue
        pool.append(row)
    return pool


def _collect_main_shots(seg: dict, pool_ids: set[str]) -> dict[str, list[str]]:
    """每句(semantic_unit)写手点名的主镜头 = cited_shot_ids ∪ anchor_shot_ids,
    只保留落在本事件池内的(窗外引用是笔误/剧透,丢弃)。返回 unit_id → [shot_id]。"""
    mains: dict[str, list[str]] = {}
    for u in seg.get("semantic_units", []) or []:
        if not isinstance(u, dict):
            continue
        uid = u.get("semantic_unit_id")
        if not uid:
            continue
        cited = [str(x) for x in (u.get("cited_shot_ids") or [])]
        anchor = [str(x) for x in (u.get("anchor_shot_ids") or [])]
        # 写手引用优先;引用为空才用位置锚兜底
        picks = [x for x in (u.get('required_shot_ids') or []) +
                 (u.get('candidate_shot_ids') or cited or anchor) if x in pool_ids]
        mains[uid] = list(dict.fromkeys(picks))
    return mains


# ---------------------------------------------------------------------------
# 整镜头链装配(单事件)
# ---------------------------------------------------------------------------

def _build_chain_greedy(pool: list[dict], mains_by_unit: dict[str, list[str]],
                 sentences: list[dict], audio_dur: float,
                 tail_cap: float, fps: float = DEFAULT_FPS) -> tuple[list[dict], dict]:
    """按句驱动的配画链装配(事件内统一配画),时间游标只进不退。

    逐句结账:每句的画面槽 = [槽起点, 下一句槽起点)(首句从 0 起,含引导静音;
    末句到 audio_dur),槽含句间停顿。从事件池按原片顺序取料盖住每个槽:
      - 主镜头(写手点名)优先作脊柱;
      - 短镜头(≤LONG_SHOT_SEC)整取(刀落镜头边界,无残帧);
      - 长镜头(>LONG_SHOT_SEC)只取盖住槽的一段(partial),相邻句续用同一
        长镜头则帧连续无缝——长镜头内部切出是复核触发项,不是许可。
    每槽盖满即停,全事件累计超出 = 呼吸留白。

    返回 (chain, info)。chain 元素 = {shot_id,start,end,dur,partial,boundary_in},
    原片顺序。info: {spine,fill,duration,shortage,mismatch,overshoot,n_partial}。
    """
    by_id = {p["shot_id"]: p for p in pool}
    pool_sorted = sorted(pool, key=lambda p: p["start"])
    if not pool_sorted:
        return [], {"spine": [], "fill": [], "duration": 0.0, "shortage": True,
                    "mismatch": False, "overshoot": 0.0, "n_partial": 0}
    n = len(pool_sorted)
    min_win = MIN_WINDOW_SEC

    chain: list[dict] = []
    seen_ids: set[str] = set()
    cursor_t = pool_sorted[0]["start"]
    pi = 0                      # 指向第一个 end > cursor_t 的池镜头

    def _advance_pi() -> None:
        nonlocal pi
        while pi < n and pool_sorted[pi]["end"] <= cursor_t + 1e-6:
            pi += 1

    def _take(p: dict, need: float) -> dict | None:
        """从镜头 p 的 max(cursor_t, p.start) 起取一段盖住 need。
        短镜头整取;长镜头取段(至多 need,但不短于 min_win)。"""
        spans = [(max(cursor_t, row['start']), row['end'], row)
                 for row in edit_ranges(p) if row['end'] > cursor_t + 1e-6]
        if not spans:
            return None
        st, limit, source_span = spans[0]
        if p['dur'] > LONG_SHOT_SEC:
            from .movie_picture import cue_starts
            output_start = sum(piece['dur'] for piece in chain)
            if 'edit_spans' in p:
                viable = []
                for a, b, row in spans:
                    cues = [cue for cue in s.get('picture_cues', [])
                            if cue['shot_id'] == p['shot_id'] and 'sample_span' in cue
                            and cue['sample_span'][0] < b and cue['sample_span'][1] >= a]
                    starts = cue_starts({**p, 'start': row['start']},
                                        [{**s, 'picture_cues': cues}], output_start, fps)
                    for start in starts:
                        if start < b:
                            # Adjacent speech may continue one real span. A cue
                            # later in that span does not license a source jump.
                            contiguous = bool(chain and chain[-1].get('edit_span_id') == row['edit_span_id']
                                              and abs(a - chain[-1]['end']) < 1e-6)
                            viable.append((a if contiguous else max(a, start), b, row))
            else:
                starts = cue_starts(p, [s], output_start, fps)
                viable = [(max(a, start), b, row) for a, b, row in spans for start in starts if a <= start < b]
            if viable:
                st, limit, source_span = min(viable, key=lambda item: (item[0], item[1]))
        natural_duration = source_span['span_end'] - source_span['span_start']
        if p.get("reviewed_span") or natural_duration <= LONG_SHOT_SEC:
            en = limit
        else:
            en = min(limit, st + max(need, min_win))
        piece = {"shot_id": p["shot_id"], "start": round(st, 6),
                 "end": round(en, 6), "dur": en - st,
                 "partial": en < p["end"] - 1e-6 or st > p["start"] + 1e-6,
                 "boundary_in": p.get("boundary_in", "hard"), **span_metadata(source_span)}
        return piece

    frame_tolerance = 0.5 / fps
    for si, s in enumerate(sentences):
        slot_end = (float(sentences[si + 1]["start"]) if si + 1 < len(sentences)
                    else audio_dur)
        di = max(slot_end - sum(piece["dur"] for piece in chain), 0.0)
        if di <= frame_tolerance:
            continue
        covered = 0.0
        # 1) 本句主镜头(原片序):跳到镜头起点取料,盖住 di 即停
        smains = sorted((m for m in s.get("mains", []) if m in by_id),
                        key=lambda m: by_id[m]["start"])
        if s.get('required_shot_ids'):
            mandatory = [m for m in smains if m in s['required_shot_ids']]
            if mandatory:
                smains = mandatory + [m for m in smains if by_id[m]['start'] > by_id[mandatory[-1]]['start']]
        for m in smains:
            if covered >= di - frame_tolerance:
                break
            p = by_id[m]
            if p["end"] <= cursor_t + 1e-6:
                continue                        # 已被前句消费,跳过
            if p["start"] > cursor_t:
                cursor_t = p["start"]           # 向前跳到主镜头(跳切,边界对齐)
                _advance_pi()
            piece = _take(p, di - covered)
            if piece is None:
                continue
            chain.append(piece)
            seen_ids.add(piece["shot_id"])
            covered += piece["dur"]
            cursor_t = piece["end"]
            _advance_pi()
        # 2) 补镜垫付(原片序,从游标起)直到盖住 di
        while covered < di - frame_tolerance and pi < n:
            if 'allowed_shot_ids' in s:
                eligible = next((j for j in range(pi, n) if pool_sorted[j]['shot_id'] in s['allowed_shot_ids']), None)
                if eligible is None:
                    break
                pi = eligible
            p = pool_sorted[pi]
            piece = _take(p, di - covered)
            if piece is None:
                pi += 1
                continue
            chain.append(piece)
            seen_ids.add(piece["shot_id"])
            covered += piece["dur"]
            cursor_t = piece["end"]
            _advance_pi()

    dur = sum(p["dur"] for p in chain)

    # 兜底盖满 audio_dur:长镜头取段的浮点取整可能差几十毫秒,链短于配音会让
    # render 截断配音。先延长末尾取段(长镜头有余量),仍不够再从游标续补整镜头。
    if chain and dur < audio_dur - frame_tolerance:
        deficit = audio_dur - dur
        last = chain[-1]
        src = by_id.get(last["shot_id"])
        if src is not None and last["end"] < src["end"] - 1e-6:
            allowed_end = next((row['end'] for row in edit_ranges(src)
                                if row['start'] <= last['start'] < last['end'] <= row['end'] + 1e-6
                                and row.get('edit_span_id') == last.get('edit_span_id')), last['end'])
            new_end = min(allowed_end, last["end"] + deficit)
            last["dur"] += new_end - last["end"]
            last["end"] = round(new_end, 6)
            cursor_t = last["end"]
            _advance_pi()
            dur = sum(p["dur"] for p in chain)
        while dur < audio_dur - frame_tolerance and pi < n:
            p = pool_sorted[pi]
            if sentences and 'allowed_shot_ids' in sentences[-1] and p['shot_id'] not in sentences[-1]['allowed_shot_ids']:
                pi += 1
                continue
            piece = _take(p, audio_dur - dur)
            if piece is None:
                pi += 1
                continue
            chain.append(piece)
            seen_ids.add(piece["shot_id"])
            dur += piece["dur"]
            cursor_t = piece["end"]
            _advance_pi()

    # 超出配音太多 → 削**尾部**补镜(绝不动主镜头/长镜头取段),拉回 audio+cap;
    # 削完必须仍 ≥ audio_dur,否则停手把超出当呼吸留白(整镜头粒度盖不严丝合缝)。
    spine_set = {m for s in sentences for m in s.get("mains", [])}
    cap = audio_dur + tail_cap
    while dur > cap:
        drop_i = None
        for i in range(len(chain) - 1, -1, -1):
            if (chain[i]["shot_id"] not in spine_set
                    and not chain[i]["partial"]):
                drop_i = i
                break
        if drop_i is None:
            break
        if dur - chain[drop_i]["dur"] < audio_dur:
            break
        dur -= chain[drop_i]["dur"]
        chain.pop(drop_i)

    spine = [p["shot_id"] for p in chain if p["shot_id"] in spine_set]
    fill = [p["shot_id"] for p in chain if p["shot_id"] not in spine_set]
    n_partial = sum(1 for p in chain if p["partial"])
    info = {
        "spine": spine, "fill": fill, "duration": round(dur, 3),
        # 链必须盖住配音(render 否则截断配音);兜底续补后仍不够 = 池真枯竭
        "shortage": dur < audio_dur - frame_tolerance - 1e-6,
        "overshoot": round(max(0.0, dur - audio_dur), 3),
        "n_partial": n_partial,
        # 主镜头/长镜头本身就超配音 1.5 倍且无补镜可削:整镜头组合对不上
        "mismatch": (dur > audio_dur * 1.5 and not fill),
    }
    return chain, info


def _build_chain(pool: list[dict], mains_by_unit: dict[str, list[str]],
                 sentences: list[dict], audio_dur: float,
                 tail_cap: float, fps: float = DEFAULT_FPS, *,
                 source_edit_proof: dict | None = None,
                 source_clock: dict | None = None) -> tuple[list[dict], dict]:
    """Keep a valid greedy chain; search alternatives when it loses pictures."""
    from .picture_chain_search import chain_issues, search_chain

    source_args = {'source_edit_proof': source_edit_proof, 'source_clock': source_clock}
    pool = verified_pool(pool, fps, **source_args)
    chain, info = _build_chain_greedy(pool, mains_by_unit, sentences, audio_dur, tail_cap, fps)
    issues = chain_issues(chain, sentences, fps, **source_args)
    if not issues and not info["shortage"] and not info["mismatch"] and info["overshoot"] <= tail_cap:
        return chain, info
    replacement, search = search_chain(pool, sentences, audio_dur, fps,
                                       LONG_SHOT_SEC, MIN_WINDOW_SEC, tail_cap, **source_args)
    info["selection"] = search
    if replacement is None:
        return chain, info
    replacement_dur = sum(p["dur"] for p in replacement)
    # An already valid chain should only be replaced to reduce excess silence.
    if not issues and not info["shortage"] and not info["mismatch"] and replacement_dur >= info["duration"]:
        return chain, info
    spine_ids = {sid for s in sentences for sid in s.get("mains", [])}
    spine = [p["shot_id"] for p in replacement if p["shot_id"] in spine_ids]
    fill = [p["shot_id"] for p in replacement if p["shot_id"] not in spine_ids]
    return replacement, {"spine": spine, "fill": fill, "duration": round(replacement_dur, 3),
                         "shortage": replacement_dur < audio_dur - 0.5 / fps - 1e-6,
                         "overshoot": round(max(0, replacement_dur - audio_dur), 3),
                         "n_partial": sum(p["partial"] for p in replacement),
                         "mismatch": replacement_dur > audio_dur * 1.5 and not fill,
                         "selection": search}


def _assign_units(chain: list[dict], sentences: list[dict], fps: float,
                  audio_dur: float) -> tuple[list[dict], list[dict]]:
    """Keep windows intact; record all actual sentence overlaps in semantic_map.

    The singular semantic_unit_id remains a compatibility label for the greatest
    overlap. Coverage consumers must use sentence_overlaps / semantic_map.
    """
    windows: list[dict] = []
    cursor = 0.0
    for p in chain:
        dur = p["dur"]
        row = None
        overlap = [(max(0, min(cursor + dur, s['end']) - max(cursor, s['start'])), s)
                   for s in sentences]
        if overlap:
            seconds, candidate = max(overlap, key=lambda pair: pair[0])
            if seconds > 1e-9:
                row = candidate
        sf = int(round(p["start"] * fps))
        ef = int(round(p["end"] * fps))
        w = {
            "shot_id": p["shot_id"], "start_frame": sf, "end_frame": ef,
            "start": round(p["start"], 6), "end": round(p["end"], 6),
            "semantic_unit_id": row["unit_id"] if row else "",
            "claim_ids": row["claim_ids"] if row else [],
            "tts_start": round(row["start"], 3) if row else round(audio_dur, 3),
            "tts_end": round(row["end"], 3) if row else round(audio_dur, 3),
            "purpose": (row["text"][:160] if row else "呼吸留白"),
            "evidence_level": ("anchor" if row and p["shot_id"] in row["mains"]
                               else "tail" if row is None else "event"),
            "engine": "whole_shot",
            "boundary_in": p.get("boundary_in", "hard"),
            **span_metadata(p),
        }
        if p.get("partial"):
            w["partial"] = True       # 长镜头取段:复核触发项(查动作截断/信息完整)
        if row is None:
            w["tail"] = True
        windows.append(w)
        cursor += dur

    semantic_map = map_intervals(windows, sentences, fps)
    return windows, semantic_map


# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------

def _picture_fit(args: dict, ctx: RunContext) -> ToolResult:
    for key in ("script_path", "graph_path", "timeline_path", "reel_path"):
        if not args.get(key):
            return ToolResult(text=f"[ERROR] {key} is required")
    paths = {k: ctx.resolve(args[k]) for k in
             ("script_path", "graph_path", "timeline_path", "reel_path")}
    for k, p in paths.items():
        if not p.is_file():
            return ToolResult(text=f"[ERROR] {k} not found: {p}")
    out_path = ctx.resolve(args.get("output_edl") or "out/edl.json")
    qc_path = ctx.resolve(args.get("qc_json") or "out/edl_qc.json")
    report_path = ctx.resolve(args.get("fit_report") or "out/fit_report.json")
    review_path = (ctx.resolve(args["fit_review_path"])
                   if args.get("fit_review_path") else None)

    avoid_ids = args.get("avoid_shot_ids") or []
    if not isinstance(avoid_ids, list) or not all(isinstance(x, str) for x in avoid_ids):
        return ToolResult(text="[ERROR] avoid_shot_ids must be an array of strings")
    avoid_global = set(avoid_ids)
    from . import picture_windows
    window_policy = picture_windows.enabled(ctx.resolve('out'))
    swaps = picture_windows.load_swaps(ctx.resolve('out')) if window_policy else {}
    gap_path = ctx.resolve('out/visual_coverage_gaps.json')
    if gap_path.is_file():
        avoid_global.update(sid for gap in load_json(gap_path) for sid in gap.get('shot_ids', []))
    # 每事件单独回避(复核驳回的补镜): {seg_id: [shot_id,...]}
    avoid_by_seg = {str(k): set(v) for k, v in
                    (args.get("avoid_shot_ids_by_seg") or {}).items()}

    try:
        reel = load_json(paths["reel_path"])
        segs = load_json(paths["script_path"])
        graph = load_json(paths["graph_path"])
        timeline = load_json(paths["timeline_path"])
    except Exception as exc:
        return ToolResult(text=f"[ERROR] invalid JSON input: {exc}")

    if not isinstance(segs, list):
        return ToolResult(text="[ERROR] script_path must be a JSON array of segments")
    reels = reel.get("beats", {})
    shots = sorted(timeline.get("shots", []), key=lambda s: float(s["start"]))
    if not shots:
        return ToolResult(text="[ERROR] timeline has no shots")
    source_edit_proof, source_clock = load_context(paths['timeline_path'].parent, timeline)
    source_args = {'source_edit_proof': source_edit_proof, 'source_clock': source_clock}
    if args.get("shot_ranges_path"):
        try:
            ranges = load_json(ctx.resolve(args["shot_ranges_path"]))
            for shot in shots:
                span = ranges.get(shot["shot_id"])
                if span:
                    left, right = float(span["start"]), float(span["end"])
                    if not span.get("reviewed") or not shot["start"] <= left < right <= shot["end"]:
                        raise ValueError(f"Invalid reviewed range: {shot['shot_id']}")
                    if right - left < MIN_WINDOW_SEC:
                        raise ValueError(f"Reviewed range is too short: {shot['shot_id']}")
                    shot["reviewed_span"] = [left, right]
        except Exception as exc:
            return ToolResult(text=f"[ERROR] shot_ranges: {exc}")
    shot_starts = [float(s["start"]) for s in shots]
    fps = float(timeline.get("fps", DEFAULT_FPS) or DEFAULT_FPS)
    events = {e["event_id"]: e for e in graph.get("events", [])}

    # 复核状态机(每事件轮数/已批准链指纹)
    review: dict = {}
    if review_path and review_path.is_file():
        try:
            review = load_json(review_path)
        except Exception:
            review = {}

    segs = [s for s in segs if isinstance(s, dict)
            and float(s.get("audio_dur", 0) or 0) > 0]
    segs.sort(key=lambda s: int(reels.get(s["seg_id"], {}).get("idx") or 0))

    # --- 全篇主镜头登记: 先扫一遍,每个镜头归第一个点名它的**正片**事件;
    #     后序事件的主镜头对前序事件是 reserved(不许当补镜抢走)。冷开场事件
    #     的主镜头是高潮镜头(正片高潮事件届时重演),不参与登记——否则高潮
    #     事件反被冷开场 reserve 掉自己的主镜头。---
    main_owner: dict[str, str] = {}
    seg_main_ids: dict[str, set[str]] = {}
    span_owner: dict[str, str] = {}
    seg_span_ids = {seg['seg_id']: referenced_spans(seg, source_edit_proof) for seg in segs}
    for seg in segs:
        seg_id = seg["seg_id"]
        rb = reels.get(seg_id, {})
        win = rb.get("window") or {}
        pool_ids = {p["shot_id"] for p in
                    _event_pool(win, shots, shot_starts, set(), set(), set(), **source_args)}
        mains = _collect_main_shots(seg, pool_ids)
        ids = {sid for v in mains.values() for sid in v}
        seg_main_ids[seg_id] = ids
        if not rb.get("cold_open"):
            for sid in ids:
                main_owner.setdefault(sid, seg_id)
            for span_id in seg_span_ids[seg_id]:
                span_owner.setdefault(span_id, seg_id)

    used_global: set[str] = set()
    used_edit_spans: set[str] = set()
    edl: list[dict] = []
    fit_report: list[dict] = []
    shortages: list[dict] = []
    mismatches: list[dict] = []
    needs_review: list[dict] = []
    semantic_issues: list[dict] = []
    chain_diagnostics: list[dict] = []
    logs: list[str] = []

    for seg in segs:
        seg_id = seg["seg_id"]
        audio_dur = float(seg["audio_dur"])
        rb = reels.get(seg_id, {})
        win = rb.get("window") or {}
        cold = bool(rb.get("cold_open"))
        evs = [events[x] for x in seg.get("event_ids", []) if x in events]
        if not evs:
            semantic_issues.append({'seg_id': seg_id, 'reason': 'missing_event_evidence'})
            continue

        # 后序事件的主镜头 = 本事件的 reserved(防补镜抢);但本事件自己的主镜头
        # 即使被别处登记也要保留(冷开场引用高潮镜头时尤其如此)
        reserved_later = ({sid for sid, owner in main_owner.items()
                           if owner != seg_id} - seg_main_ids.get(seg_id, set()))
        reserved_spans = ({sid for sid, owner in span_owner.items() if owner != seg_id}
                          - seg_span_ids[seg_id])
        seg_avoid = avoid_global | avoid_by_seg.get(seg_id, set())
        # 冷开场走独立账本:不占全局 used,也不受全局 used 限制
        pool = _event_pool(win, shots, shot_starts, reserved_later,
                           set() if cold else used_global, seg_avoid,
                           topup=FIT_TOPUP_EXTRA, **source_args,
                           used_edit_spans=set() if cold else used_edit_spans,
                           reserved_edit_spans=reserved_spans)
        pool_ids = {p["shot_id"] for p in pool}

        # 句子表(配音时间轴)+ 每句主镜头
        sentences = []
        for u in seg.get("semantic_units", []) or []:
            if not isinstance(u, dict):
                continue
            uid = u.get("semantic_unit_id")
            if not uid:
                continue
            sentences.append({
                "unit_id": uid, "text": str(u.get("text", "")),
                "start": float(u.get("tts_start", 0) or 0),
                "end": float(u.get("tts_end", 0) or 0),
                "event_ids": list(u.get("event_ids", [])),
                "claim_ids": list(u.get("claim_ids", [])),
                **policy(u),
                "mains": [x for x in
                          (_collect_main_shots(seg, pool_ids).get(uid, []))],
            })
        # semantic_units 没带 tts 时间时,回退用 sentences 数组(配音逐句时间轴)
        if not sentences or all(s["end"] <= s["start"] for s in sentences):
            sentences = []
            for s in seg.get("sentences", []) or []:
                if not isinstance(s, dict):
                    continue
                uid = s.get("semantic_unit_id")
                if not uid:
                    continue
                sentences.append({
                    "unit_id": uid, "text": str(s.get("text", "")),
                    "start": float(s.get("start", 0) or 0),
                    "end": float(s.get("end", 0) or 0),
                    "event_ids": list(s.get("event_ids", [])),
                    "claim_ids": list(s.get("claim_ids", [])),
                    **policy(s),
                    "mains": [x for x in (s.get("cited_shot_ids")
                                          or s.get("anchor_shot_ids") or [])
                              if x in pool_ids],
                })
        if not sentences:
            semantic_issues.append({'seg_id': seg_id, 'reason': 'missing_sentence_timing'})
            continue

        pool = apply_reveal_limits(sentences, pool)
        exclusions = []
        profile_path = ctx.resolve('out/production_profile.json')
        original_path = ctx.resolve('out/original_audio.json')
        if (profile_path.is_file() and load_json(profile_path).get('editorial_policy') == 'movie-editorial-v1'
                and original_path.is_file()):
            exclusions = [(row['start'], row['end']) for row in load_json(original_path)]
        footage = pool_report(pool, exclusions)
        pool = constrain_pool(pool, exclusions)
        pool = verified_pool(pool, fps, **source_args)

        chain, info = _build_chain(pool, {s["unit_id"]: s["mains"]
                                          for s in sentences},
                                   sentences, audio_dur, FIT_TAIL_CAP_SEC, fps=fps, **source_args)
        arranged = chain
        if swaps:
            # The picture check swapped these sentences' footage for the same
            # number of frames; every other frame of the chain is unchanged.
            chain, outcomes = picture_windows.apply_swaps(chain, sentences, swaps, fps)
            stale = sorted(uid for uid, outcome in outcomes.items() if outcome == 'stale')
            if stale:
                semantic_issues.append({'seg_id': seg_id, 'reason': 'picture_swap_stale', 'unit_ids': stale})

        # Keep every event's actual timing conflict, including events that
        # return early for shortage. A mixed failure must not hide the next
        # group of repairs behind the first reported failure category.
        from .picture_chain_search import chain_issues
        _, diagnostic_rows = _assign_units(chain, sentences, fps, audio_dur)
        chain_diagnostics.append({
            "seg_id": seg_id, "audio_seconds": audio_dur,
            "selection": info, "issues": chain_issues(chain, sentences, fps, **source_args), 'footage_accounting': footage,
            "pool": pool, "chain": chain,
            "units": [{**row, "text": sentence["text"],
                       **({"allowed_shot_ids": sentence["allowed_shot_ids"]}
                          if "allowed_shot_ids" in sentence else {})}
                      for sentence, row in zip(sentences, diagnostic_rows)],
        })

        if info["shortage"]:
            shortages.append({"seg_id": seg_id, "idx": rb.get("idx"),
                              "audio_sec": round(audio_dur, 1),
                              "footage_sec": info["duration"],
                              "window": [round(float(win.get("t0", 0)), 1),
                                         round(float(win.get("t1", 0)), 1)],
                              "pool_shots": len(pool),
                              "text_head": str(seg.get("text", ""))[:40]})
            continue
        if info["mismatch"]:
            mismatches.append({"seg_id": seg_id, "idx": rb.get("idx"),
                               "audio_sec": round(audio_dur, 1),
                               "chain_sec": info["duration"],
                               "spine": info["spine"],
                               "text_head": str(seg.get("text", ""))[:40]})
            continue

        windows, semantic_map = _assign_units(chain, sentences, fps, audio_dur)
        if cold:
            # 冷开场窗口逐个标记:audit_edl 据此豁免重复/倒带(高潮镜头正片重演)
            for w in windows:
                w["cold_open"] = True
        chain_frames = sum(w["end_frame"] - w["start_frame"] for w in windows)
        # 帧量化(每窗 round 到整帧)可能让画面比配音少 1~2 帧 → render 会截断
        # 配音。先延长末窗(长镜头取段有余量)按帧盖满;末窗到镜头尾仍不够时,
        # video_dur 取 audio_dur,render 用 tpad 定格末帧补齐(1~2 帧不可见)。
        if chain_frames / fps < audio_dur - 1e-9 and windows:
            need_f = math.ceil(audio_dur * fps) - chain_frames
            lastw = windows[-1]
            src = next((row for row in pool if row['shot_id'] == lastw['shot_id']), None)
            if src is not None and need_f > 0:
                limit = next((row['end'] for row in edit_ranges(src)
                              if row['start'] <= lastw['start'] < lastw['end'] <= row['end'] + 1e-6
                              and row.get('edit_span_id') == lastw.get('edit_span_id')), lastw['end'])
                src_ef = int(round(limit * fps))
                addf = min(src_ef - lastw["end_frame"], need_f)
                if addf > 0:
                    lastw["end_frame"] += addf
                    lastw["end"] = round(min(limit, lastw["end_frame"] / fps), 6)
                    chain_frames += addf
        if source_edit_proof is not None:
            windows = [normalize_window(window, fps, **source_args) for window in windows]
        chain_dur = chain_frames / fps
        video_dur = round(max(chain_dur, audio_dur), 6)
        tail_sec = round(max(0.0, video_dur - audio_dur), 6)
        # Recompute after frame quantization/extension, including cross-sentence shots.
        semantic_map = map_intervals(windows, sentences, fps)
        semantic_qc = audit_requirements(semantic_map, fps)
        semantic_issues.extend({'seg_id': seg_id, **issue} for issue in semantic_qc['issues'])
        for sentence, row in zip(sentences, semantic_map):
            if 'allowed_shot_ids' in sentence:
                unsupported = {o['shot_id'] for o in row['overlaps']
                               if o['seconds'] > 1 / fps + 1e-6 and o['shot_id'] not in sentence['allowed_shot_ids']}
                if unsupported:
                    semantic_issues.append({'seg_id': seg_id, 'semantic_unit_id': sentence['unit_id'],
                                            'reason': 'unsupported_picture_overlap', 'shot_ids': sorted(unsupported)})

        # 全片不重复账本(冷开场不占)
        if not cold:
            # As in the rehearsal, the arranged chain decides what later events may use.
            used_global.update(p["shot_id"] for p in arranged)
            used_edit_spans.update(p['edit_span_id'] for p in arranged if 'edit_span_id' in p)

        entry = {
            "schema_version": REEL_SCHEMA_VERSION, "seg_id": seg_id,
            "event_ids": [e["event_id"] for e in evs], "text": seg["text"],
            "emotion": normalize_emotion(seg.get("emotion")),
            "audio_path": seg["audio_path"], "audio_dur": audio_dur,
            "windows": windows, "semantic_map": semantic_map,
            "shot_ids": [f"{w['start']:.6f}-{w['end']:.6f}" for w in windows],
            "video_dur": video_dur, "speed": 1.0, "bgm_track": None,
            "duck": bool(seg.get("highlight", False)),
            "story_scene_id": seg.get("story_scene_id", ""),
            "tail_sec": tail_sec,
        }
        if source_edit_proof is not None:
            entry['source_edit_proof_id'] = source_edit_proof['proof_id']
        if cold:
            entry["cold_open"] = True
            entry["reuse_type"] = "cold_open_teaser"
            entry["exemptions"] = ["global_no_repeat", "monotonic_time"]
        edl.append(entry)

        # --- 补镜复核记账 ---
        # 复核触发项: 工具新增补镜(fill) + 长镜头内部取段(partial)。
        # 主镜头(写手点名)免单镜复核,但与补镜/取段的组合仍进局部预览统一审。
        fill = info["fill"]
        partials = [p["shot_id"] for p in chain if p.get("partial")]
        review_triggers = sorted(set(fill) | set(partials))
        drift_rows = []
        if window_policy:
            # The picture check already looked at the exact windows of every
            # sentence with a visual claim. Only footage that moved outside a
            # checked window (the real speech timing changed) needs a look.
            drift_rows = picture_windows.drift(ctx.resolve('out'), semantic_map)
            review_triggers = sorted({row['shot_id'] for row in drift_rows})
        ev_review = review.get(seg_id, {})
        rounds = int(ev_review.get("rounds", 0))
        approved_fp = ev_review.get("approved_chain")
        chain_fp = "|".join(f"{p['shot_id']}@{p['start']:.6f}-{p['end']:.6f}"
                            for p in (windows if source_edit_proof is not None else chain))
        if source_edit_proof is not None:
            chain_fp += '|spans:' + '|'.join(f"{w['edit_span_id']}@{w['source_frame_start']}-{w['source_frame_end']}"
                                             for w in windows)
        is_approved = (approved_fp == chain_fp)
        if review_triggers and not is_approved:
            # 有工具新增素材且尚未被模型批准 → 进复核队列
            if rounds >= FIT_REVIEW_MAX_ROUNDS:
                # 达上限仍未批准:cannot_fill(交回选镜/写稿层)
                logs.append(f"{seg_id} 复核达上限({rounds}轮)仍含未批准新增素材 "
                            f"{len(review_triggers)} 处 → cannot_fill")
                needs_review.append({"seg_id": seg_id, "status": "cannot_fill",
                                     "rounds": rounds, "fill": fill,
                                     "partials": partials})
            else:
                needs_review.append({"seg_id": seg_id, "status": "pending",
                                     "rounds": rounds, "fill": fill,
                                     "partials": partials,
                                     "spine": info["spine"],
                                     "chain": chain_fp})
        fit_report.append({
            "seg_id": seg_id, "idx": rb.get("idx"),
            "audio_sec": round(audio_dur, 2),
            "chain_sec": round(chain_dur, 2),
            "tail_sec": tail_sec,
            "n_shots": len(chain),
            "spine": info["spine"], "fill": fill, "partials": partials,
            "chain_fp": chain_fp,
            "soft_boundaries": [p["shot_id"] for p in chain
                                if p.get("boundary_in") == "soft"],
            "review_status": ("approved" if is_approved else
                              "cannot_fill" if any(
                                  r["seg_id"] == seg_id
                                  and r["status"] == "cannot_fill"
                                  for r in needs_review) else
                              "pending" if review_triggers else "no_fill"),
            "rounds": rounds,
            "selection": info.get("selection", {"strategy": "greedy"}),
            **({"window_check_drift": drift_rows} if window_policy else {}),
        })
        logs.append(f"{seg_id}: 配音{audio_dur:.1f}s ← {len(chain)}镜头"
                    f"(脊柱{len(info['spine'])}/补镜{len(fill)}/长镜取段"
                    f"{len(partials)}) 链{chain_dur:.1f}s 留白{tail_sec:.1f}s")

    # This diagnostic is not an EDL or an approval. Preserve existing edits
    # and review receipts while giving the coordinator one complete repair list.
    diagnostic_artifacts = []
    diagnostic_data = {}
    if semantic_issues or shortages or mismatches or any(row['issues'] for row in chain_diagnostics):
        import hashlib
        diagnostic_path = ctx.resolve("out/picture_fit_diagnostics.json")
        input_paths = dict(paths)
        for name in ("shot_ranges_path", "fit_review_path"):
            if args.get(name) and ctx.resolve(args[name]).is_file():
                input_paths[name] = ctx.resolve(args[name])
        for name in ("visual_coverage_gaps.json", "source_edit_spans.json", "window_check.json"):
            if ctx.resolve("out/" + name).is_file():
                input_paths[name] = ctx.resolve("out/" + name)
        save_json({
            "schema": "picture-fit-diagnostics-v1", "status": "failed",
            "timing": "measured_speech", "fps": fps,
            "inputs": {name: {"path": ctx.virtualize(path),
                              "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
                       for name, path in input_paths.items()},
            "avoid_shot_ids": sorted(avoid_global),
            "avoid_shot_ids_by_seg": {sid: sorted(ids) for sid, ids in avoid_by_seg.items()},
            "semantic_issues": semantic_issues, "shortages": shortages,
            "mismatches": mismatches, "segments": chain_diagnostics,
        }, diagnostic_path)
        diagnostic_artifacts = [str(diagnostic_path)]
        diagnostic_data = {"diagnostic_json": str(diagnostic_path),
                           "shortages": shortages, "mismatches": mismatches}

    # --- 失败出口(素材不足 / 时长对不上 优先于复核) ---
    if semantic_issues:
        report = {'schema': 'picture-semantic-qc-v1', 'status': 'failed', 'issues': semantic_issues}
        save_json(report, qc_path)
        return ToolResult(text='[ERROR] picture_semantics: required pictures or sentence evidence missing; '
                               'revise local shot choices or script without cutting unreviewed actions',
                          data={'error': 'picture_semantics', 'issues': semantic_issues,
                                **diagnostic_data},
                          artifacts=[str(qc_path), *diagnostic_artifacts])
    if shortages:
        return ToolResult(
            text=("[ERROR] footage_shortage: " + str(len(shortages)) +
                  " 个事件整镜头池盖不住配音 — 缩这些事件的稿(按 role 删 "
                  "flavor/重复信息),或扩事件镜头池,然后重跑 picture_fit: " +
                  ",".join(f"beat{s['idx']}(配音{s['audio_sec']}s/池仅"
                           f"{s['footage_sec']}s)" for s in shortages[:8])),
            data={"error": "footage_shortage", "beats": shortages, "log": logs, **diagnostic_data},
            artifacts=diagnostic_artifacts)
    if mismatches:
        return ToolResult(
            text=("[ERROR] duration_mismatch: " + str(len(mismatches)) +
                  " 个事件的主镜头本身超配音太多,整镜头组合对不上 — 换主镜头"
                  "(改句子的 cited_shot_ids)或缩短该事件配音,然后重跑: " +
                  ",".join(f"beat{m['idx']}(配音{m['audio_sec']}s/链"
                           f"{m['chain_sec']}s)" for m in mismatches[:8])),
            data={"error": "duration_mismatch", "beats": mismatches, "log": logs, **diagnostic_data},
            artifacts=diagnostic_artifacts)

    # --- 硬质检(复用 bind 的 audit_edl) ---
    report = audit_edl(edl, fps=fps,
                       min_window_sec=MIN_WINDOW_SEC, **source_args)
    save_json(report, qc_path)
    if report["status"] != "passed":
        return ToolResult(
            text=(f"[ERROR] EDL硬质检失败: 重复{len(report['duplicate_shots'])} / "
                  f"重叠{len(report['overlapping_source_frames'])} / "
                  f"倒退{len(report['source_time_regressions'])} / "
                  f"短闪{len(report['too_short_windows'])} / "
                  f"来源校验{len(report.get('source_usage_errors', []))}"),
            data={"error": "edl_qc_failed", "qc": report,
                  "qc_json": str(qc_path), "log": logs, **diagnostic_data},
            artifacts=[str(qc_path), *diagnostic_artifacts])

    save_audited_edl(edl, report, out_path, qc_path)
    save_json({"schema_version": "v5-picture-fit", "events": fit_report,
               "n_segments": len(edl),
               "fps": fps, "avoid_shot_ids": sorted(avoid_global)},
              report_path)

    # 复核队列里 pending 的事件 → 需要模型看局部预览后批准/驳回
    pending = [r for r in needs_review if r["status"] == "pending"]
    cannot = [r for r in needs_review if r["status"] == "cannot_fill"]
    n_fill = sum(len(e["fill"]) for e in fit_report)
    n_spine = sum(len(e["spine"]) for e in fit_report)
    text = (f"[PictureFit] {len(edl)}段 · 整镜头链(脊柱{n_spine}/补镜{n_fill}) · "
            f"自然边界选段，内部取段待复核 → {ctx.virtualize(out_path)}\n")
    if cannot:
        text += (f"[ERROR] cannot_fill: {len(cannot)} 个事件补镜复核达上限"
                 f"({FIT_REVIEW_MAX_ROUNDS}轮)仍未通过 — 换素材或改表达: "
                 + ",".join(c["seg_id"] for c in cannot[:8]) + "\n")
    if pending:
        text += (f"待复核: {len(pending)} 个事件含补镜/长镜取段,需看局部预览后"
                 f"批准/驳回(每事件≤{FIT_REVIEW_MAX_ROUNDS}轮): "
                 + ",".join(p["seg_id"] for p in pending[:12]) + "\n")
    text += f"QC: {report['status']}"

    data = {
        "status": ("cannot_fill" if cannot else
                   "needs_review" if pending else report["status"]),
        "n_segments": len(edl), "n_windows": report["n_windows"],
        "n_spine_shots": n_spine, "n_fill_shots": n_fill,
        "fit_report": str(report_path),
        "needs_review": needs_review,
        "qc": report["status"],
        "rhythm": report.get("rhythm", {}),
        "output_edl": str(out_path), "qc_json": str(qc_path),
        "log": logs,
    }
    if cannot:
        data["error"] = "cannot_fill"
    return ToolResult(text=text, data=data,
                      artifacts=[str(out_path), str(qc_path), str(report_path)])


def picture_fit(args: dict, ctx: RunContext) -> ToolResult:
    try:
        return _picture_fit(args, ctx)
    except (ValueError, KeyError, TypeError, OSError) as exc:
        return ToolResult(text=f'[ERROR] picture_fit input/evidence: {exc}',
                          data={'error': 'invalid_picture_evidence'})
