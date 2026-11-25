"""arrange_footage:电影解说"先排片、后成稿"的确定性排片器(A-lite 内核)。

纪律:大纲决定讲什么,画面决定能讲多久,文案把两者缝起来;
禁止"每句拿着秒数去素材库凑碎片"。工具不调用任何大模型——
大纲和旁白由跑技能的 Agent 写,这里只做三步确定性变换:

- action=dialogue:transcript → 带 D 编号的全片台词轴(Agent 读它写大纲)。
  D 编号以本步产出的 dialogue_index.json 为唯一权威,杜绝编号漂移。
- action=arrange:台词索引+镜头库+大纲+目标分钟数 → 排片卷 reel.json。
  每个剧情要点锚在它引用台词的时刻,从该镜头起整镜头顺延取"连续原片块"
  (块内节奏=原片剪辑师的节奏);全局光标只进不退,新接缝只出现在
  要点/拍边界。附带写作简报(每拍/每要点的真实画面秒数与字数硬预算)。
- action=anchor:排片卷+Agent 写的旁白 → 句级锚定的解说稿+事件图
  (下游 bind_narration 的输入契约)。超预算的拍结构化报错退回重写。
- action=refit(v6 音频先行):TTS 之后按每拍真实配音时长在拍时间窗内
  重新取卷 → reel_fit.json。画面向配音看齐,超时删稿循环降为罕见兜底。
  (v5 whole-shot 流程改走 picture_fit,refit 只在 fit_mode=legacy 时用。)

v5(2026-09)事件级配画的三处改动:每拍附多区间事件池(intervals/pool,
证据段各自垫边就近合并,不再"到下一拍起点"整段);anchor 输出全篇主镜头
登记表 primary_registry.json(跨事件重复点名先到先得并曝光);minutes 变成
软参考量级(±20% 只提示),over_budget 在有池的卷上只出 warning。
"""
from __future__ import annotations

import bisect
import math
import json
import re
from pathlib import Path

from .result import ToolResult
from .run_context import RunContext

SCHEMA_VERSION = "1.0-alite"
CHARS_PER_SEC = 3.4        # 中文口播语速
NARRATION_RATIO = 0.88     # 旁白占画面时长比,余量留呼吸
SEC_PER_POINT_LO = 4.5     # 每要点画面预算下限(预算归一化夹取区间)
SEC_PER_POINT_HI = 8.0
MIN_BEAT_SEC = 10.0        # 一拍画面下限,不足向后续播补足
MAX_BEAT_SEC = 30.0        # 一拍画面上限,防单拍吃掉太多片长
OVERRUN_TOL = 1.03         # 总卷超目标片长 3% 才回吐
OVER_CHAR_TOL = 1.15       # 单拍旁白超预算 15% 才判超(与写稿"可少不许超"配合)
SOFT_BUDGET_RATIO = 0.9    # writing_brief 展示九折软预算(呼吸/tone 余量);
                           # anchor 硬校验仍用全额×OVER_CHAR_TOL
SLOW_TONE_FACTOR = 0.85    # 放慢类 tone(慢/沉/缓)实测拉长时长 10~15%,
                           # anchor 对这类拍按 85% 预算校验
# ---- v6 音频先行(refit) -------------------------------------------------
# 时长匹配的根本解:规划卷只服务写作预算,TTS 之后按每拍真实配音时长回到
# 该拍时间窗重新取卷(素材池约有成片 8 倍深,画面比文字更有弹性)。
REFIT_HEADROOM_SEC = 2.8   # refit 卷至少比配音长这么多:呼吸留白(每拍 TTS 完
                           # 停一停放原声,普通拍 2s/高光拍 3s)+ DP 跳切余量;
                           # 1.2 时短拍留白经常挤没(实测 8 拍仅出 8s 留白)
REFIT_TOPUP_EXTRA = 20.0   # 拍窗内取不满时允许越窗向后顺延的上限(与 MIN_BEAT 补足同源)
FILM_CHAR_TOL = 1.4        # 全片总字数超目标 40% 才拦——用户纪律"不许为凑时长
                           # 压缩删稿",片长宁长勿删;这只是防跑飞的保险丝
CPS_DELIVERY_FACTOR = 0.88 # 标定语速(纯念字探针)→成片语速的折算:句间呼吸+tone
                           # 放慢要摊掉约 12%(v5 实测 3.7 标定 → 3.19 成片);
                           # 不折算的后果是稿子按虚高语速写满,片子又密又急
# ---- v5 事件级配画(whole-shot) ---------------------------------------------
# 事件池改多区间:每拍的证据时刻(台词行/视觉索引段)各自垫 POOL_PAD 秒,
# 间隔 < POOL_MERGE_GAP 的区间合并;池 = 与任一区间相交的整镜头。不再取
# "本拍最早证据 → 下一拍最早证据"整段(会把别的事件的画面收进池子)。
POOL_PAD_SEC = 5.0
POOL_MERGE_GAP_SEC = 15.0
POOL_MIN_SEC = 20.0        # 池总长下限:证据只有一两行台词时向后顺延到这个量级
SOFT_MINUTES_TOL = 0.20    # 软时长量级:参考时长 ±20% 只提示不判失败


def _load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _save_json(data, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1),
                    encoding="utf-8")


def arrange_footage(args: dict, ctx: RunContext) -> ToolResult:
    action = args.get("action")
    try:
        if action == "dialogue":
            return _action_dialogue(args, ctx)
        if action == "arrange":
            return _action_arrange(args, ctx)
        if action == "anchor":
            return _action_anchor(args, ctx)
        if action == "refit":
            return _action_refit(args, ctx)
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        # 输入数据脏(outline 引用不存在的台词编号 / shots 缺 start / beat 非 dict /
        # sentences 是字符串列表 ...): 结构化返回, 不裸抛 traceback
        return ToolResult(text=f"[ERROR] invalid input: {type(exc).__name__}: {exc}",
                          data={"error": "invalid_input", "detail": str(exc)})
    return ToolResult(
        text="[ERROR] action must be one of: dialogue, arrange, anchor, refit",
        data={"error": "bad_action", "got": action})


# ---------------------------------------------------------------- dialogue --
def _action_dialogue(args: dict, ctx: RunContext) -> ToolResult:
    if not args.get("transcript_path"):
        return ToolResult(text="[ERROR] transcript_path is required")
    tp = ctx.resolve(args["transcript_path"])
    if not tp.is_file():
        return ToolResult(text=f"[ERROR] transcript not found: {tp}")
    try:
        rows = _load_json(tp)
    except Exception as exc:
        return ToolResult(text=f"[ERROR] invalid transcript JSON: {exc}")
    if isinstance(rows, dict):
        rows = rows.get("segments", [])
    if not isinstance(rows, list):
        return ToolResult(text="[ERROR] transcript must be a JSON array of segments "
                               "or an object with segments[]")
    rows = [r for r in rows
            if isinstance(r, dict) and str(r.get("text", "")).strip()
            and isinstance(r.get("start"), (int, float))]
    if not rows:
        return ToolResult(
            text="[ERROR] transcript has no usable speech segments — "
            "dialogue-driven recap needs spoken lines; fall back to a "
            "vision-based flow for this film",
            data={"error": "empty_transcript"})
    rows.sort(key=lambda r: float(r["start"]))

    index = [{"id": f"D{i + 1:04d}", "start": float(r["start"]),
              "end": float(r.get("end", r["start"])),
              "speaker": str(r.get("speaker", "?")),
              "text": str(r["text"]).strip()}
             for i, r in enumerate(rows)]
    axis = "\n".join(f"{r['id']}[{r['start']:.0f}s] {r['speaker']}: {r['text']}"
                     for r in index)

    out_txt = ctx.resolve(args.get("output_txt") or "out/dialogue_axis.txt")
    out_json = ctx.resolve(args.get("output_json") or "out/dialogue_index.json")
    out_txt.parent.mkdir(parents=True, exist_ok=True)
    out_txt.write_text(axis + "\n", encoding="utf-8")
    _save_json(index, out_json)
    n_chars = sum(len(r["text"]) for r in index)
    return ToolResult(
        text=(f"Dialogue axis ready: {len(index)} lines / {n_chars} chars, "
              f"{index[0]['start']:.0f}s → {index[-1]['start']:.0f}s. "
              f"Read {ctx.virtualize(out_txt)} like a screenplay to write the "
              "outline; cite line ids (D0001) as evidence for every point."),
        data={"n_lines": len(index), "n_chars": n_chars,
              "first_line_sec": index[0]["start"],
              "last_line_sec": index[-1]["start"]},
        artifacts=[str(out_txt), str(out_json)])


# ----------------------------------------------------------------- arrange --
def _check_outline(outline: dict, n_dlg: int, minutes: float,
                   n_vis: int = 0, *, dialogue_ids: set[str] | None = None,
                   visual_ids: set[str] | None = None) -> dict | None:
    """大纲结构校验;返回 None=通过,否则结构化错误(Agent 拿去重写)。
    要点证据可引台词 D 编号或视觉索引 V 编号(无台词剧情的证据位),
    两者有其一合法即通过;n_vis<=0 时 V 编号只做格式校验(范围留给 arrange)。"""
    beats = outline.get("beats")
    if not isinstance(beats, list) or not beats:
        return {"error": "outline_invalid", "why": "beats missing/empty"}
    # 拍数下限随目标时长走: 24 拍地板只对长片有意义(防懒大纲),
    # 短片验证(10 分钟素材剪 1~2 分钟)按 3 拍/分钟自然缩
    expect = max(4, int(minutes * 2.5)) if minutes < 8 else max(20, int(minutes * 2.5))
    if len(beats) < expect * 0.5:
        return {"error": "outline_invalid",
                "why": f"only {len(beats)} beats, expected ≈{expect} "
                       "(about 2.5 beats per output minute)"}
    n_pts = bad = 0
    issues = []
    for bi, b in enumerate(beats, 1):
        if not isinstance(b, dict):
            return {"error": "outline_invalid", "why": f"beat{bi} is not an object"}
        if not isinstance(b.get("points", []), list):
            return {"error": "outline_invalid", "why": f"beat{bi} points must be an array"}
        for p in b.get("points", []):
            if not isinstance(p, dict):
                return {"error": "outline_invalid",
                        "why": f"beat{bi} has a point that is not an object"}
            if not isinstance(p.get("dlg", []), list):
                return {"error": "outline_invalid",
                        "why": f"beat{bi}: point '{str(p.get('text'))[:30]}' dlg must be an array"}
            n_pts += 1
            ids = [x for x in p.get("dlg", [])
                   if (isinstance(x, str) and x in dialogue_ids if dialogue_ids is not None else
                       re.fullmatch(r"D\d{4}", str(x)) and 0 < int(str(x)[1:]) <= n_dlg)]
            vis = [x for x in p.get("vis", [])
                   if (isinstance(x, str) and x in visual_ids if visual_ids is not None else
                       re.fullmatch(r"V\d{4}", str(x))
                       and (n_vis <= 0 or 0 < int(str(x)[1:]) <= n_vis))]
            if not ids and not vis:
                bad += 1
                if len(issues) < 10:
                    issues.append(f"beat{bi}: point '{str(p.get('text'))[:30]}' "
                                  f"has no valid dlg/vis ids "
                                  f"{p.get('dlg')} {p.get('vis') or ''}")
            p["dlg"] = ids
            if vis or p.get("vis"):
                p["vis"] = vis
    if n_pts == 0 or bad > n_pts * 0.1:
        return {"error": "outline_invalid",
                "why": f"{bad}/{n_pts} points cite no valid dialogue/visual id",
                "issues": issues}
    return None


def _take_block(shots: list[dict], shot_starts: list[float], state: dict,
                t_anchor: float, need: float, hard_end: float,
                back_off: float = 1.0) -> list[dict]:
    """从锚点所在镜头起整镜头顺延取满 need 秒;全局光标只进不退。

    back_off: 入块时刻向前回拉量。要点锚(t 取台词/vis 时刻,常在镜头中段)
    默认回拉 1s 把锚时刻裹进首片;句级锚(t 就是镜头起点)必须传 0——
    回拉会把上一镜头的尾巴垫到句前,短句会被垫爆。"""
    a = max(t_anchor - back_off, state["cursor"])
    # 从光标处无缝续接(上一块的剪点)不是跳切入场,首片最短限制不适用——
    # 否则续接处的 1.0~1.3s 镜头会被整个跳过,磁带上留洞(洞后残段
    # 不足最短跳切段时 bind 的 DP 直接全局无解,踩过)。
    cont = state["cursor"] > 0 and a <= state["cursor"] + 1e-6
    if a >= hard_end:
        return []
    i = max(0, bisect.bisect_right(shot_starts, a) - 1)
    spans, got = [], 0.0
    first = True
    used = state.get("used") or ()
    while i < len(shots) and got < need:
        s = shots[i]
        if s["shot_id"] in used:
            # 前面的拍用过的镜头:bind 跨拍去重会整片丢弃(除非帧相邻续播,
            # 而拍间隔着留白基本断不成),refit 必须同规则跳过——半镜头
            # 横跨拍界被两拍分食,后拍那半在 bind 磁带上凭空蒸发,踩过。
            i += 1
            continue
        if float(s["start"]) >= hard_end:
            break               # 拍边界是硬边界: 不吞下一拍的镜头(shots 有序,后面更远)
        # 末片同样被拍边界截断 — 长镜头曾在这里整个越界,把全局光标推进下一拍
        # 领地,造成后续拍锚点全在光标之前(锚漂移/整拍 dropped)
        lo, hi = max(a, float(s["start"])), min(float(s["end"]), hard_end)
        if first:
            if cont:
                first = False       # 续接入场:不回拉不设首片下限
            else:
                # 入块处是跳切点,第一片必须≥1.5s(短了就是"短闪"):
                # 不够先把入点向镜头头部提前(锚点时刻仍在片内),
                # 镜头剩余本身太短则整个顺延到下一镜头。
                lo = max(state["cursor"], float(s["start"]), min(lo, hi - 1.5))
                if hi - lo < 1.3:
                    i += 1
                    continue
                first = False
        if hi > lo + 0.2:
            spans.append({"shot_id": s["shot_id"], "start": round(lo, 3),
                          "end": round(hi, 3), "sec": round(hi - lo, 2)})
            got += hi - lo
        i += 1
    if spans:
        state["cursor"] = spans[-1]["end"]
    return spans


def _evidence_intervals(spans: list[tuple[float, float]], film_end: float,
                        hard_lo: float = 0.0, hard_hi: float | None = None,
                        min_total: float = POOL_MIN_SEC) -> list[list[float]]:
    """证据时段 → 事件的多区间时间池。每段各垫 POOL_PAD 秒,间隔小于
    POOL_MERGE_GAP 的合并;总长不足 min_total 时把最后一段向后顺延补足。
    hard_lo/hard_hi 是不许越过的边界(冷开场不设;正片拍受相邻拍约束——
    但只约束"顺延补足"部分,证据本身落在哪就算哪)。"""
    if not spans:
        return []
    hi_cap = film_end if hard_hi is None else min(film_end, hard_hi)
    padded = sorted((max(hard_lo, a - POOL_PAD_SEC), min(film_end, b + POOL_PAD_SEC))
                    for a, b in spans)
    merged: list[list[float]] = []
    for a, b in padded:
        if merged and a - merged[-1][1] < POOL_MERGE_GAP_SEC:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    total = sum(b - a for a, b in merged)
    if total < min_total:
        merged[-1][1] = min(hi_cap if hi_cap > merged[-1][1] else film_end,
                            merged[-1][1] + (min_total - total))
    return [[round(a, 3), round(b, 3)] for a, b in merged]


def _pool_shots(shots: list[dict], intervals: list[list[float]]) -> list[str]:
    """与任一区间相交的整镜头(按原片顺序)。"""
    out: list[str] = []
    for s in shots:
        st, en = float(s["start"]), float(s["end"])
        if any(st < b and en > a for a, b in intervals):
            out.append(s["shot_id"])
    return out


def _trim_overrun(reels: dict, plan: list[dict], target: float) -> float:
    """总卷超目标片长 3% 时,从最长拍的尾巴回吐(整 span 或截尾,保≥1.5s片):
    只动拍尾不动拍中,不产生新接缝;拍长不跌破 MIN_BEAT_SEC。"""
    total = sum(r["reel_sec"] for r in reels.values())
    trimmed, frozen = 0.0, set()
    while total > target * OVERRUN_TOL:
        cand = [p for p in plan if p["seg_id"] not in frozen
                and reels[p["seg_id"]]["reel_sec"] > MIN_BEAT_SEC + 0.5]
        if not cand:
            break
        p = max(cand, key=lambda x: reels[x["seg_id"]]["reel_sec"])
        r = reels[p["seg_id"]]
        need = total - target
        room = r["reel_sec"] - MIN_BEAT_SEC
        sp = r["spans"][-1]
        if len(r["spans"]) > 1 and sp["sec"] <= min(need, room) + 0.2:
            cut = sp["sec"]
            r["spans"].pop()
        else:
            cut = min(need, room, sp["sec"] - 1.5)
            if cut <= 0.2:
                frozen.add(p["seg_id"])
                continue
            sp["end"] = round(sp["end"] - cut, 3)
            sp["sec"] = round(sp["sec"] - cut, 2)
        r["reel_sec"] = round(r["reel_sec"] - cut, 2)
        total -= cut
        trimmed += cut
    return trimmed


def _action_arrange(args: dict, ctx: RunContext) -> ToolResult:
    for k in ("dialogue_index_path", "shots_path", "outline_path", "minutes"):
        if not args.get(k):
            return ToolResult(text=f"[ERROR] {k} is required")
    try:
        minutes = float(args["minutes"])
        if not minutes > 0:
            raise ValueError
    except (TypeError, ValueError):
        return ToolResult(text="[ERROR] minutes must be a positive number")
    try:
        dlg = _load_json(ctx.resolve(args["dialogue_index_path"]))
        timeline = _load_json(ctx.resolve(args["shots_path"]))
        outline = _load_json(ctx.resolve(args["outline_path"]))
    except Exception as exc:
        return ToolResult(text=f"[ERROR] failed to load inputs: {exc}")
    if not isinstance(timeline, dict) or not isinstance(timeline.get("shots", []), list):
        return ToolResult(text="[ERROR] shots_path must contain a JSON object with shots[]")
    if not isinstance(outline, dict):
        return ToolResult(text="[ERROR] outline_path must contain a JSON object with beats[]")
    if not isinstance(dlg, list):
        return ToolResult(text="[ERROR] dialogue_index_path must contain a JSON array")
    for i, sh in enumerate(timeline.get("shots", [])):
        if not isinstance(sh, dict) or not isinstance(sh.get("start"), (int, float)) \
                or not isinstance(sh.get("end"), (int, float)) or not sh.get("shot_id"):
            return ToolResult(text=f"[ERROR] shot #{i} needs shot_id and numeric start/end")
    for i, r in enumerate(dlg):
        if not isinstance(r, dict) or not r.get("id") or not isinstance(r.get("start"), (int, float)):
            return ToolResult(text=f"[ERROR] dialogue index row #{i} needs id and numeric start")
    shots = sorted(timeline.get("shots", []), key=lambda s: float(s["start"]))
    if not shots:
        return ToolResult(text="[ERROR] shots_path has no shots — run detect_shots first")
    # 视觉索引(可选): V 编号 → (t0, t1)。大纲的 vis-only 要点靠它定位时间。
    vis_index: dict[str, tuple[float, float]] = {}
    if args.get("visual_index_path"):
        try:
            vlist = _load_json(ctx.resolve(args["visual_index_path"]))
        except Exception as exc:
            return ToolResult(text=f"[ERROR] failed to load visual_index: {exc}")
        for row in vlist if isinstance(vlist, list) else []:
            if isinstance(row, dict) and row.get("vid"):
                t0 = float(row.get("t0", 0.0))
                vis_index[str(row["vid"])] = (t0, float(row.get("t1", t0)))
    bad = _check_outline(outline, len(dlg), minutes, len(vis_index),
                         dialogue_ids={r['id'] for r in dlg},
                         visual_ids=set(vis_index) if vis_index else None)
    if bad:
        return ToolResult(
            text="[ERROR] outline_invalid: " + bad.get("why", "") +
            " — rewrite the outline (cite real D-ids from the dialogue axis "
            "or V-ids from the visual index) and call arrange again",
            data=bad)
    if not vis_index and any(p.get("vis") and not p.get("dlg")
                             for b in outline["beats"]
                             for p in (b.get("points", []) if isinstance(b, dict) else [])):
        return ToolResult(
            text="[ERROR] visual_index_required: outline has vis-only points "
                 "but visual_index_path was not provided — pass it so V-ids "
                 "can be resolved to film time",
            data={"error": "visual_index_required"})

    shot_starts = [float(s["start"]) for s in shots]
    shots_by_id_all = {s["shot_id"]: s for s in shots}
    film_end = float(shots[-1]["end"])
    by_id = {r["id"]: r for r in dlg}

    def dlg_t(x: str) -> float:
        row = by_id.get(str(x))
        if row is None:
            # 索引被手改出编号空洞时不裸 KeyError; outline 校验容忍 ≤10% 坏引用,
            # 漏网的在这里以可定位的 ValueError 收口(外层按结构化错误返回)
            raise ValueError(f"outline 引用的台词编号不存在: {x}")
        return float(row["start"])

    def vis_span(x: str) -> tuple[float, float]:
        row = vis_index.get(str(x))
        if row is None:
            raise ValueError(f"outline 引用的视觉索引编号不存在: {x}")
        return row

    # 拍的时间锚:每拍 t0 = 其要点证据(台词时刻/视觉事件窗起点)的最早时刻;强制时间单调
    beats = []
    for b in outline["beats"]:
        pts = [p for p in b.get("points", []) if p.get("dlg") or p.get("vis")]
        if not pts:
            continue
        for p in pts:
            ts = [dlg_t(x) for x in p.get("dlg", [])]
            ts += [vis_span(x)[0] for x in p.get("vis", [])]
            p["t"] = min(ts)
        pts.sort(key=lambda p: p["t"])
        beats.append({"summary": str(b.get("summary", "")), "points": pts,
                      "t0": pts[0]["t"],
                      "cold_open": bool(b.get("cold_open"))})
    # 冷开场拍(高潮前置钩子, 大纲第一拍才认): 钉在片头不参与时间排序,
    # 窗口取自身证据的时间段——引用哪场高潮, 窗就落在哪场。
    cold = beats[0] if beats and beats[0]["cold_open"] else None
    if any(b["cold_open"] for b in beats if b is not cold):
        return ToolResult(
            text="[ERROR] cold_open is only allowed on the FIRST outline beat "
                 "(exactly one teaser beat)",
            data={"error": "cold_open_misplaced"})
    if cold is not None:
        beats = [b for b in beats if b is not cold]
    beats.sort(key=lambda b: b["t0"])
    for cur, nxt in zip(beats, beats[1:]):
        cur["t1"] = nxt["t0"]
    if beats:
        last = beats[-1]
        tail_ts = ([dlg_t(x) for p in last["points"] for x in p.get("dlg", [])] +
                   [vis_span(x)[1] for p in last["points"] for x in p.get("vis", [])])
        last["t1"] = min(film_end, max(tail_ts) + 40.0)
    if cold is not None:
        cold_tail = ([dlg_t(x) for p in cold["points"] for x in p.get("dlg", [])] +
                     [vis_span(x)[1] for p in cold["points"] for x in p.get("vis", [])])
        cold["t1"] = min(film_end,
                         max(max(cold_tail) + 30.0, cold["t0"] + 20.0))
        beats = [cold] + beats

    # v5 事件池(多区间):每拍的证据段各自垫边、就近合并,池 = 相交的整镜头。
    # 顺延补足只许在相邻拍的证据起点之前(正片拍),冷开场不受约束。
    def dlg_span(x: str) -> tuple[float, float]:
        row = by_id[str(x)]
        return float(row["start"]), max(float(row["start"]), float(row.get("end", row["start"])))

    for k, b in enumerate(beats):
        ev = ([dlg_span(x) for p in b["points"] for x in p.get("dlg", [])] +
              [vis_span(x) for p in b["points"] for x in p.get("vis", [])])
        nxt = next((c["t0"] for c in beats[k + 1:] if not c["cold_open"]), None)
        b["intervals"] = _evidence_intervals(
            ev, film_end, hard_hi=None if b["cold_open"] else nxt)
        b["pool"] = _pool_shots(shots, b["intervals"])

    # 预算归一化:每要点画面秒数由目标片长反推,不再用固定值
    # (固定 6.5s/点在要点多的大纲上会把总卷推超目标 8%+)。
    # 卷是素材带,旁白只占卷的 NARRATION_RATIO——目标卷长要除回去,
    # 否则成片会比 minutes 短 12%。
    target_reel = minutes * 60.0 / NARRATION_RATIO
    n_points = sum(len(b["points"]) for b in beats)
    try:
        sec_per_point = float(args.get("sec_per_point") or 0) or None
    except (TypeError, ValueError):
        return ToolResult(text="[ERROR] sec_per_point must be a number")
    if sec_per_point is None:
        sec_per_point = min(SEC_PER_POINT_HI,
                            max(SEC_PER_POINT_LO, target_reel / max(n_points, 1)))

    state = {"cursor": 0.0}
    reels: dict[str, dict] = {}
    plan: list[dict] = []
    dropped: list[str] = []
    for bi, b in enumerate(beats, 1):
        seg_id = f"s{bi:03d}"
        # 冷开场拍用隔离游标取卷:取完恢复原位、不占镜头账——预告闪回与
        # 正片高潮重演同镜头是解说片惯例(bind/QC 侧对应豁免)。
        cold_b = bool(b.get("cold_open"))
        saved_cursor = state["cursor"]
        if cold_b:
            state["cursor"] = 0.0
        spans: list[dict] = []
        pt_secs: list[float] = []
        for pi, p in enumerate(b["points"], 1):
            got = sum(x["sec"] for x in spans)
            if got >= MAX_BEAT_SEC:
                pt_secs.append(0.0)
                continue
            blk = _take_block(shots, shot_starts, state, p["t"],
                              min(sec_per_point, MAX_BEAT_SEC - got), b["t1"])
            for sp in blk:
                sp["point"] = pi          # 块归属要点:句子只配自己要点的画面
            spans += blk
            pt_secs.append(sum(x["sec"] for x in blk))
        # 不足下限 → 块尾向后续播补足(不跳取),记到最后一个有画面的要点
        if spans and sum(x["sec"] for x in spans) < MIN_BEAT_SEC:
            blk = _take_block(shots, shot_starts, state, state["cursor"],
                              MIN_BEAT_SEC - sum(x["sec"] for x in spans),
                              b["t1"] + 20.0)
            last_pt = spans[-1]["point"]
            for sp in blk:
                sp["point"] = last_pt
            spans += blk
            pt_secs[last_pt - 1] += sum(x["sec"] for x in blk)
        if not spans:
            if cold_b:
                state["cursor"] = saved_cursor
            dropped.append(f"beat{bi}: {b['summary'][:24]}")
            continue
        if cold_b:
            state["cursor"] = saved_cursor
        reel_sec = round(sum(x["sec"] for x in spans), 2)
        reels[seg_id] = {"seg_id": seg_id, "idx": bi, "spans": spans,
                         "reel_sec": reel_sec, "char_cap": 0,
                         "cold_open": cold_b,
                         # v6 refit 元数据: 拍时间窗与要点锚时刻——TTS 之后按
                         # 真实配音时长回到这个窗里重新取卷(音频先行)。
                         # 要点的 vis 时间段一并存档: anchor 用它给句子自动补
                         # 语义锚(v5 教训: 写手引用链太绕, 全稿零锚静默放行,
                         # 画面全靠位置猜测 → neutral 44.7%)。
                         "window": {"t0": round(b["t0"], 3),
                                    "t1": round(b["t1"], 3)},
                         # v5 事件池:多区间 + 池内整镜头(whole-shot 配画的
                         # 候选集;anchor 的"窗内引用"判定也以池为准)
                         "intervals": b["intervals"],
                         "pool": b["pool"],
                         "pool_sec": round(sum(
                             float(shots_by_id_all[x]["end"]) - float(shots_by_id_all[x]["start"])
                             for x in b["pool"]), 2),
                         "point_anchors": [
                             {"point": pi, "t": round(p["t"], 3),
                              "vis": [[round(a, 3), round(c, 3)] for a, c in
                                      (vis_span(x) for x in p.get("vis", []))]}
                             for pi, p in enumerate(b["points"], 1)]}
        plan.append({"idx": bi, "seg_id": seg_id, "summary": b["summary"],
                     "points": [dict(text=p["text"]) for p in b["points"]],
                     "sec": reel_sec})

    if not plan:
        return ToolResult(text="[ERROR] arrange produced no beats — outline "
                          "anchors may all point before the global cursor",
                          data={"error": "empty_plan", "dropped": dropped})

    trimmed = 0.0
    if args.get("trim", True):
        trimmed = _trim_overrun(reels, plan, target_reel)

    # 语速可按音色校准:字数预算 = 画面秒 × 旁白占比 × 语速。
    # 传入值应为 tts_generate 实测的纯念字速率(measured_chars_per_sec);
    # 成片语速还要摊句间呼吸与 tone 放慢,这里统一折算,调用方不要自己打折。
    try:
        cps_measured = float(args.get("chars_per_sec") or CHARS_PER_SEC)
        if not 2.0 <= cps_measured <= 7.0:
            raise ValueError
    except (TypeError, ValueError):
        return ToolResult(text="[ERROR] chars_per_sec must be a number in [2, 7]")
    cps = cps_measured * CPS_DELIVERY_FACTOR

    # 回吐后统一从 spans 反推:要点秒数/字数预算/视觉短语接缝
    n_seams = 0
    for p in plan:
        r = reels[p["seg_id"]]
        spans = r["spans"]
        r["reel_sec"] = round(sum(x["sec"] for x in spans), 2)
        r["char_cap"] = int(r["reel_sec"] * NARRATION_RATIO * cps)
        pt_sec: dict[int, float] = {}
        for sp in spans:
            pt_sec[int(sp["point"])] = pt_sec.get(int(sp["point"]), 0.0) + sp["sec"]
        for j, pt in enumerate(p["points"], 1):
            sec = round(pt_sec.get(j, 0.0), 1)
            pt["sec"] = sec
            pt["chars"] = int(sec * NARRATION_RATIO * cps)
        phrases = []
        for sp in spans:
            if phrases and sp["start"] - phrases[-1][-1]["end"] <= 0.1:
                phrases[-1].append(sp)
            else:
                phrases.append([sp])
        p["sec"] = r["reel_sec"]
        p["chars"] = r["char_cap"]
        p["n_phrases"] = len(phrases)
        n_seams += len(phrases) - 1

    total_sec = round(sum(r["reel_sec"] for r in reels.values()), 1)
    est_film = round(total_sec * NARRATION_RATIO, 1)
    names = "、".join(str(c.get("name", "")) for c in
                     outline.get("characters", []))[:200]
    # 要点级只展示画面秒数不展示字数上限: 逐要点卡字数会把写作压成电报体,
    # anchor 实际也只强制拍级预算; 秒数保留是让写手知道画面空间还剩多少。
    # 拍级预算展示九折(软预算): 呼吸/tone 都要吃时长, 顶格写必超。
    # v5 软时长量级: minutes 是参考值(±20%), 写手按"预计口播秒=字数÷每秒字"
    # 估篇幅; 每拍另给镜头池总长(整镜头配画的素材上限, 池不够=素材不足)。
    lo_min, hi_min = minutes * (1 - SOFT_MINUTES_TOL), minutes * (1 + SOFT_MINUTES_TOL)
    ref_chars = int(minutes * 60 * cps)
    brief = (f"角色表:{names}\n参考时长:约{minutes:.0f}分钟"
             f"(范围{lo_min:.0f}~{hi_min:.0f}分钟;成片时长≈总口播时长,"
             f"预计口播秒=字数÷{cps:.1f};全片约{int(ref_chars * 0.8)}~"
             f"{int(ref_chars * 1.2)}字;画面已剪好共{total_sec:.0f}秒)\n\n" + "\n".join(
                 f"拍{p['idx']}(画面{p['sec']:.0f}秒,"
                 f"镜头池{reels[p['seg_id']].get('pool_sec', 0):.0f}秒/"
                 f"{len(reels[p['seg_id']].get('pool', []))}镜,"
                 f"总预算{int(p['chars'] * SOFT_BUDGET_RATIO)}字): "
                 f"{p['summary']}\n" +
                 "\n".join(f"  要点{j + 1}" +
                           (f"(画面{pt['sec']:.0f}秒)"
                            if pt["sec"] > 0.5 else "(无画面)") +
                           f": {pt['text']}"
                           for j, pt in enumerate(p["points"]))
                 for p in plan))

    reel_out = ctx.resolve(args.get("reel_json") or "out/reel.json")
    plan_out = ctx.resolve(args.get("plan_json") or "out/plan.json")
    brief_out = ctx.resolve(args.get("brief_txt") or "out/writing_brief.txt")
    _save_json({"schema_version": SCHEMA_VERSION, "beats": reels,
                "narration_ratio": NARRATION_RATIO,
                "chars_per_sec": round(cps, 2),
                "chars_per_sec_measured": round(cps_measured, 2),
                "target_reel_sec": round(target_reel, 1),
                "reference_minutes": minutes,
                "reference_tol": SOFT_MINUTES_TOL,
                "sec_per_point": round(sec_per_point, 2)}, reel_out)
    _save_json(plan, plan_out)
    brief_out.parent.mkdir(parents=True, exist_ok=True)
    brief_out.write_text(brief + "\n", encoding="utf-8")
    return ToolResult(
        text=(f"Arranged {len(plan)} beats · reel {total_sec:.0f}s "
              f"(target reel {target_reel:.0f}s, trimmed {trimmed:.0f}s) · "
              f"estimated film ≈{est_film:.0f}s vs asked {minutes * 60:.0f}s · "
              f"{n_seams} intra-beat seams "
              f"({n_seams / max(len(plan), 1):.1f}/beat) · "
              f"{sec_per_point:.1f}s per point. Write narration per "
              f"{ctx.virtualize(brief_out)}: char budgets are SOFT guidance "
              "(after TTS the footage refits to the real audio duration); "
              "film length ≈ total narration time, so control TOTAL chars."),
        data={"n_beats": len(plan), "reel_sec": total_sec,
              "target_reel_sec": round(target_reel, 1),
              "est_film_sec": est_film,
              "trimmed_sec": round(trimmed, 1),
              "seams_per_beat": round(n_seams / max(len(plan), 1), 2),
              "sec_per_point": round(sec_per_point, 2),
              "dropped_beats": dropped},
        artifacts=[str(reel_out), str(plan_out), str(brief_out)])


# ------------------------------------------------------------------- refit --
def _qframes(blk: list[dict], fps: float) -> int:
    """镜像 bind._reel_tape 的帧量化:每片 ceil(start)/floor(end),<3 帧丢弃。
    (bind 还会把同镜头相邻片段合并再量化,真实帧数 ≥ 这里的模拟值——
    保守方向,担保"磁带够用"永不高估。)"""
    total = 0
    for sp in blk:
        f = int(math.floor(float(sp["end"]) * fps + 1e-7)) - \
            int(math.ceil(float(sp["start"]) * fps - 1e-7))
        if f >= 3:
            total += f
    return total


def _trim_tail(blk: list[dict], want: float, state: dict,
               shots_by_id: dict[str, dict] | None = None,
               snap_sec: float = 0.0, limit: float | None = None) -> None:
    """把块修剪到 want 秒:光标回落到剪点,下一块顺播时与本块同镜帧连续,
    不产生新切点;独片短块保底 0.3s 不整片丢弃(可行性预检兜底)。
    块尾若剩不足 0.85s 的"新镜头一瞬"(修剪后观感是闪一下就跳走,用户
    点名),整片丢弃——欠的时间由帧账保底以 ≥1.45s 整块补回,同一镜头
    从"一闪"变成"看清楚"。

    snap_sec>0 时启用 J-cut 出刀吸附(v3):剪点离末镜头真实尾部 ≤snap_sec
    就不剪了,播完整镜头(半截出刀=闪的病根)。多占的秒数由调用方的前缀
    帧账自动从后句份额里扣(借还);limit 是吸附不许越过的硬上限(拍窗/
    下一句锚岛入场时刻),越过会偷后句的画面。"""
    if not blk:
        return
    over = sum(x["sec"] for x in blk) - want
    if over <= 0.04:
        return
    last = blk[-1]
    if shots_by_id is not None and snap_sec > 0 and \
            last["shot_id"] in shots_by_id:
        shot_end = float(shots_by_id[last["shot_id"]]["end"])
        hard = min(shot_end, limit) if limit is not None else shot_end
        # 剪点(last.end - over)到镜头真实尾部的距离 ≤ snap → 播完它
        if 0 < shot_end - (last["end"] - over) <= snap_sec and \
                last["end"] <= hard + 1e-6 and shot_end <= hard + 0.05:
            ext = round(shot_end - last["end"], 3)
            if ext > 0.01:
                last["end"] = round(shot_end, 3)
                last["sec"] = round(last["sec"] + ext, 2)
            state["cursor"] = last["end"]
            return
    keep = last["sec"] - over
    if keep < 0.85 and len(blk) > 1:
        blk.pop()
        state["cursor"] = blk[-1]["end"]
    else:
        keep = max(keep, 0.3)
        last["end"] = round(last["end"] - (last["sec"] - keep), 3)
        last["sec"] = round(keep, 2)
        state["cursor"] = last["end"]


def _refit_units(seg: dict, state: dict, shots: list[dict],
                 shot_starts: list[float], shots_by_id: dict[str, dict],
                 t1: float, tally: dict, fps: float) -> list[dict]:
    """按句结账:每句的画面份额 = 该句真实配音时长(句边界直接用 bind 的
    _semantic_slices,含 speech 重标定,保证两边一个尺子)。

    v8 只把句首锚镜头当份额的入场岛,句内剩余时间顺播填充——锚中了,
    填充画面却可能与句意无关。v9 起写手的引用链(anchor_shot_ids,同句
    多镜头按时间序)整条兑现:份额在链元素间均分,每个元素从它引用的
    镜头入场——整句每一秒都盖在写手看过的画面上。

    治的是"按拍结账"的句内漂移:拍级取料只保总量,bind 的 DP 在磁带上
    只进不退,前句配音短、铺的镜头多,就把后句引用的镜头提前消耗掉,
    整拍从第二句起全线错位。这里让磁带出厂即按句对齐:
    - 入场对锚:句份额从它引用的镜头起铺(说到即看到);
    - 向前看(单锚句):句份额若会吃进下一句的锚岛,入场点提前去垫岛前
      的过渡画面,不偷下一句的岛;
    - 帧级前缀记账:模拟 bind 的量化,保证任意句前缀"磁带帧 ≥ 预算帧"
      (差 1 帧落在素材断口上会撞 DP 的最短跳切段禁令,整段无解——踩过);
      盈余自动扣减下一句的取量,错位不累积;
    - 引用纪律:锚已被前文吃掉/同拍重复引用/时序倒挂 → 逐镜头计数并附
      违规清单曝光(写手照单修引用),该元素剔除或按时间序降级演播。
    """
    from . import narration_bind as nb
    audio = float(seg["audio_dur"])
    slices = nb._semantic_slices(seg, audio)
    target_f = max(1, int(math.ceil(audio * fps - 1e-7)))
    units, b_prev = [], 0
    for j, s in enumerate(slices):
        b_end = target_f if j == len(slices) - 1 else \
            min(target_f, max(b_prev, int(round(float(s["end"]) * fps))))
        # 引用链只认写手引用(cited_shot_ids):anchor_shot_ids 会在二遍
        # patch 后混入磁带分配回声,重跑时被当成引用链会把违规计数
        # 和节奏全部打花(踩过)。老稿无此字段才退回 anchor_shot_ids。
        src = s["cited_shot_ids"] if "cited_shot_ids" in s \
            else (s.get("anchor_shot_ids") or [])
        cited_unit = bool(src)
        if not src:
            src = s.get("anchor_shot_ids") or []   # 未引用句:auto/位置锚兜底
        chain = list(dict.fromkeys(a for a in src if a in shots_by_id))
        bf_total = b_end - b_prev
        # 信息点分镜(v10):句内时长按各段字数占比分(hold 段 ×1.25 多停),
        # 切点跟内容走,不再均分;<1.8s 的碎段并入前段(上一画面顺延盖住
        # 这几个字)——碎段是"切得急/闪"的源头。
        subs: list[dict] = []
        board = [x for x in (s.get("storyboard") or []) if isinstance(x, dict)]
        total_w = sum(int(x.get("chars") or 0) *
                      (1.25 if x.get("hold") else 1.0) for x in board)
        if board and total_w > 0 and bf_total > 0:
            min_f, acc = int(1.8 * fps), 0
            for k_i, x in enumerate(board):
                w = int(x.get("chars") or 0) * (1.25 if x.get("hold") else 1.0)
                f = bf_total - acc if k_i == len(board) - 1 \
                    else max(0, min(int(round(bf_total * w / total_w)),
                                    bf_total - acc))
                acc += f
                sch = list(dict.fromkeys(
                    a for a in (x.get("shots") or []) if a in shots_by_id))
                if subs and f < min_f and not x.get("hold"):
                    subs[-1]["bf"] += f
                    continue
                subs.append({"bf": f, "chain": sch})
            while len(subs) > 1 and subs[0]["bf"] < min_f:
                subs[1]["bf"] += subs[0]["bf"]      # 首段过碎:并入下一段
                subs[0]["chain"] = subs[0]["chain"] + subs[1]["chain"]
                subs[1]["chain"] = list(dict.fromkeys(subs[0]["chain"]))
                subs.pop(0)
        if subs:
            for sub in subs:
                units.append({"uid": s.get("semantic_unit_id"),
                              "bf": sub["bf"], "chain": sub["chain"],
                              "cited": True,
                              "a0": (float(shots_by_id[sub["chain"][0]]["start"])
                                     if sub["chain"] else None)})
        else:
            units.append({"uid": s.get("semantic_unit_id"), "bf": bf_total,
                          "chain": chain, "cited": cited_unit,
                          "a0": (float(shots_by_id[chain[0]]["start"])
                                 if chain else None)})
        b_prev = b_end
    # 引用纪律体检:同拍内跨句重复引用/时序倒挂,逐镜头计数并留清单
    # (只体检写手真引用的句,auto/位置兜底锚不算写手的账)
    seen: set = set()
    prev_a = None
    for u in units:
        for sid in u["chain"]:
            st = float(shots_by_id[sid]["start"])
            if sid in seen and u["cited"]:
                tally["dup"] += 1
                tally["violations"].append(
                    {"unit": u["uid"], "shot_id": sid, "kind": "duplicate"})
            seen.add(sid)
            if prev_a is not None and st + 0.01 < prev_a and u["cited"]:
                tally["ooo"] += 1
                tally["violations"].append(
                    {"unit": u["uid"], "shot_id": sid, "kind": "out_of_order"})
            prev_a = st if prev_a is None else max(prev_a, st)
    spans: list[dict] = []
    qcum = bcum = 0                 # 量化磁带帧 / 预算帧 前缀账
    for j, u in enumerate(units):
        bcum += u["bf"]
        need = (bcum - qcum) / fps
        if need < 0.35:             # 前句盈余已罩住本句份额:顺播即可
            continue
        # 引用链清洗:被前文吃干净的元素剔除;岛头被啃还剩尾巴的保留
        # (从光标续播剩余部分);两种都计 behind 曝光给写手。
        usable: list[tuple[str, float, float]] = []
        for sid in u["chain"]:
            st = float(shots_by_id[sid]["start"])
            en = float(shots_by_id[sid]["end"])
            if sid in state["used"] or en <= state["cursor"] + 0.2:
                tally["behind"] += 1
                tally["violations"].append(
                    {"unit": u["uid"], "shot_id": sid, "kind": "consumed"})
                continue
            if st + 0.4 < state["cursor"]:
                tally["behind"] += 1
                tally["violations"].append(
                    {"unit": u["uid"], "shot_id": sid, "kind": "consumed"})
            usable.append((sid, st, en))
        usable.sort(key=lambda x: x[1])     # 倒挂引用按时间序演播(已计数)
        # 每元素≥2.8s 才立得住:1.6s 实测成片"幻灯片连放"(用户点名切得急/闪)
        usable = usable[:max(1, int(need // 2.8))]
        blk: list[dict] = []
        if len(usable) >= 2:
            # 引用链兑现:份额均分到各元素,每元素从所引镜头入场;非末元素
            # 修剪到份额护住后面元素的出场时间(链上相邻镜头若素材帧连续,
            # _take_block 从光标续接,不产生跳切)。尾量不足 1.4s 不再开新
            # 跳切块(修剪后会低于 bind 最短窗),留给帧账保底顺播补足。
            remaining = need
            for e_idx, (sid, st, en) in enumerate(usable):
                if remaining < 1.4 or state["cursor"] >= t1:
                    break
                sub = max(remaining / (len(usable) - e_idx), 1.55)
                b = _take_block(shots, shot_starts, state,
                                max(state["cursor"], st), sub, t1,
                                back_off=0.0)
                if not b:
                    continue
                if e_idx < len(usable) - 1:
                    # 链内元素的出刀同样吸附镜头尾(≤1.2s 播完再走),
                    # 上限是下一元素锚岛的入场时刻(不偷岛);相邻镜头链
                    # 恰好 shot_end==下岛start,吸附后 = 真镜头边界切
                    _trim_tail(b, sub, state, shots_by_id=shots_by_id,
                               snap_sec=1.2,
                               limit=min(t1, usable[e_idx + 1][1]))
                blk += b
                remaining = need - sum(x["sec"] for x in blk)
        else:
            a0 = usable[0][1] if usable else None
            if a0 is None:
                entry = state["cursor"]
            else:
                nxt = next((x["a0"] for x in units[j + 1:]
                            if x["a0"] is not None and x["a0"] > a0 + 0.01),
                           None)
                pre = max(0.0, need - (nxt - a0)) if nxt is not None else 0.0
                entry = max(state["cursor"], a0 - pre)
            blk = _take_block(shots, shot_starts, state, entry, need, t1,
                              back_off=0.0)
        if not blk:
            continue                # 拍窗耗尽:欠账留给拍级越窗补足/缺口检查
        # J-cut 出刀吸附:剪点离末镜头尾 ≤1.2s 就播完它(半截出刀=闪),
        # 多占的时间由 qcum 前缀帐自动从后句份额里扣;吸附不许越过拍窗,
        # 也不许压过下一句的锚岛入场时刻(偷岛)。
        nxt_a0 = next((x["a0"] for x in units[j + 1:]
                       if x["a0"] is not None), None)
        snap_lim = t1 if nxt_a0 is None or nxt_a0 <= state["cursor"] \
            else min(t1, nxt_a0 - 0.1)
        _trim_tail(blk, need, state, shots_by_id=shots_by_id,
                   snap_sec=1.2, limit=snap_lim)    # 精确修剪:光标回落到剪点,下一句
        for _ in range(2):          # 顺播时与本句同镜帧连续,不产生新切点
                                    # 帧账保底:先撑长末片,再不行补一小块
            deficit = bcum - qcum - _qframes(blk, fps)
            if deficit <= 0 or not blk:
                break
            last = blk[-1]
            room = round(min(float(shots_by_id[last["shot_id"]]["end"]), t1)
                         - last["end"], 3)
            ext = min(max(room, 0.0), deficit / fps + 0.05)
            if ext > 0.01:
                # 延长后离镜头尾 ≤1.2s 就干脆播完(帧账保底的延长点也不许
                # 落在镜头半截);盈余由前缀帐从后句份额扣,吸附不越拍窗/锚岛
                if 0 < room - ext <= 1.2 and \
                        (last["end"] + room) <= snap_lim + 0.05:
                    ext = room
                last["end"] = round(last["end"] + ext, 3)
                last["sec"] = round(last["sec"] + ext, 2)
                state["cursor"] = last["end"]
                continue
            extra = _take_block(shots, shot_starts, state, state["cursor"],
                                max(deficit / fps + 0.06, 1.45), t1,
                                back_off=0.0)
            if not extra:
                break
            blk += extra
        qcum += _qframes(blk, fps)
        for sp in blk:
            sp["unit"] = u["uid"]
        spans += blk
    tally["deficit_sec"] = round(max(0, bcum - qcum) / fps, 2)
    return spans


def _refit_feasible(seg: dict, spans: list[dict], fps: float) -> bool:
    """用 bind 自己的分组/求解器预检:这份句级磁带真能被 DP 录满吗?
    (最短跳切段/帧连续/禁未来镜头这些约束只有 bind 自己说了算——
    镜像模拟永远追不全,直接问本尊。)不可行就让该拍回退按拍结账。"""
    from . import narration_bind as nb
    min_frames = max(1, int(math.ceil(
        min(nb.MIN_WINDOW_SEC, nb.HARD_MIN_WINDOW_SEC) * fps - 1e-7)))
    probe = {"event_id": "_refit_probe", "start": 0.0, "end": 1e9,
             "shot_ids": [], "candidate_shot_ids": [], "claims": []}
    try:
        groups = nb._group_rows(seg, [probe], {}, float(seg["audio_dur"]),
                                fps, min_frames)
        tape = nb._reel_tape([dict(sp) for sp in spans],
                             nb.SelectionState(fps=fps))
        reel_end = max((iv["ef"] for iv in tape), default=0)
        # 与 bind 走同一求解入口(碎片禁令严格解→1.25s 兜底),预检与实绑
        # 的可行性判定不许分裂
        res, _strict = nb.solve_segment_snap(groups, tape, fps, min_frames,
                                             cap_floor_f=reel_end)
    except Exception:
        return False
    return isinstance(res, list)


def _action_refit(args: dict, ctx: RunContext) -> ToolResult:
    """音频先行:按每拍真实配音时长在该拍时间窗内重新取卷 → reel_fit.json。

    规划卷(arrange)只服务写作预算;TTS 出来后每拍音频时长是精确已知数,
    这里用同一套取块纪律(整镜头顺延/全局光标只进不退/拍窗硬边界)把画面
    重新剪到"恰好装得下配音+呼吸余量"。素材池约有成片 8 倍深,所以
    footage_shortage 从"每片必发的循环"降为罕见兜底(拍窗物理装不下才报)。
    """
    for k in ("reel_path", "tts_path", "shots_path"):
        if not args.get(k):
            return ToolResult(text=f"[ERROR] {k} is required")
    try:
        reel = _load_json(ctx.resolve(args["reel_path"]))
        tts_segs = _load_json(ctx.resolve(args["tts_path"]))
        timeline = _load_json(ctx.resolve(args["shots_path"]))
    except Exception as exc:
        return ToolResult(text=f"[ERROR] failed to load inputs: {exc}")
    reels = reel.get("beats", {})
    if not isinstance(tts_segs, list):
        return ToolResult(text="[ERROR] tts_path must be script_tts.json "
                          "(a JSON array of TTS'd segments)")
    ratio = float(reel.get("narration_ratio") or NARRATION_RATIO)
    cps = float(reel.get("chars_per_sec") or CHARS_PER_SEC)
    shots = sorted(timeline.get("shots", []), key=lambda s: float(s["start"]))
    if not shots:
        return ToolResult(text="[ERROR] shots_path has no shots")
    shot_starts = [float(s["start"]) for s in shots]

    # 每拍每要点的字数占比 ≈ 配音时长占比(写手稿的句→要点归属是唯一来源;
    # 缺稿时回退规划卷的要点秒数占比)。
    pt_chars: dict[int, dict[int, int]] = {}
    if args.get("script_path"):
        try:
            wdata = _load_json(ctx.resolve(args["script_path"]))
        except Exception as exc:
            return ToolResult(text=f"[ERROR] failed to load script_path: {exc}")
        for b in wdata.get("beats", []) if isinstance(wdata, dict) else []:
            if not isinstance(b, dict):
                continue
            try:
                bi = int(b.get("idx"))
            except (TypeError, ValueError):
                continue
            for s in b.get("sentences", []) or []:
                if not isinstance(s, dict):
                    continue
                try:
                    pi = int(s.get("point") or 1)
                except (TypeError, ValueError):
                    pi = 1
                d = pt_chars.setdefault(bi, {})
                d[pi] = d.get(pi, 0) + len(str(s.get("text", "")))

    audible = [s for s in tts_segs if isinstance(s, dict)
               and float(s.get("audio_dur", 0) or 0) > 0]
    missing = [s.get("seg_id") for s in audible if s.get("seg_id") not in reels]
    if missing:
        return ToolResult(text=f"[ERROR] tts segments not in reel: {missing[:6]}"
                          " — reel/script are not from the same arrange run",
                          data={"error": "reel_script_mismatch"})
    if any(not (reels[s["seg_id"]] or {}).get("window") for s in audible):
        return ToolResult(text="[ERROR] reel has no window metadata — re-run "
                          "arrange (action=arrange) with the current tool "
                          "version, then refit",
                          data={"error": "reel_missing_windows"})

    audible.sort(key=lambda s: int(reels[s["seg_id"]].get("idx") or 0))
    shots_by_id = {s["shot_id"]: s for s in shots}
    fps = float(timeline.get("fps") or 24.0)
    state = {"cursor": 0.0, "used": set()}
    new_beats: dict[str, dict] = {}
    shortages: list[dict] = []
    n_unit_beats = n_fallback = n_dup = n_ooo = n_behind = 0
    viols: list[dict] = []
    for seg in audible:
        seg_id = seg["seg_id"]
        rb = reels[seg_id]
        win = rb["window"]
        t0, t1 = float(win["t0"]), float(win["t1"])
        audio = float(seg["audio_dur"])
        need = max(audio / ratio, audio + REFIT_HEADROOM_SEC)
        anchors = rb.get("point_anchors") or [{"point": 1, "t": t0}]
        # 冷开场拍隔离结账:游标临时归零、镜头不入全局账(取完恢复),
        # 高潮正拍稍后可重取同镜头;bind/audit 侧按 cold_open 豁免。
        cold_b = bool(rb.get("cold_open"))
        cold_saved = (state["cursor"], set(state["used"])) if cold_b else None
        if cold_b:
            state["cursor"] = 0.0

        def alloc_point_mode() -> list[dict]:
            shares = dict(pt_chars.get(int(rb.get("idx") or 0)) or {})
            if not shares:
                for sp in rb.get("spans", []):
                    pi = int(sp.get("point", 1))
                    shares[pi] = shares.get(pi, 0) + float(sp.get("sec", 0))
            total_share = sum(shares.get(int(a["point"]), 0) for a in anchors)
            out: list[dict] = []
            if total_share <= 0:
                blk = _take_block(shots, shot_starts, state,
                                  float(anchors[0]["t"]), need, t1)
                for sp in blk:
                    sp["point"] = int(anchors[0]["point"])
                out += blk
            else:
                for a in anchors:
                    share = shares.get(int(a["point"]), 0) / total_share
                    if share <= 0:
                        continue
                    blk = _take_block(shots, shot_starts, state,
                                      float(a["t"]), need * share, t1)
                    for sp in blk:
                        sp["point"] = int(a["point"])
                    out += blk
            return out

        sents_ok = any(isinstance(s, dict) and s.get("semantic_unit_id")
                       and s.get("end") is not None
                       for s in seg.get("sentences") or [])
        spans: list[dict] = []
        unit_ok = False
        if sents_ok:
            # 按句结账:磁带出厂即句级对齐,bind 顺播 = 句到画到
            cur0 = state["cursor"]
            tally = {"dup": 0, "ooo": 0, "behind": 0, "deficit_sec": 0.0,
                     "violations": []}
            spans = _refit_units(seg, state, shots, shot_starts,
                                 shots_by_id, t1, tally, fps)
            tail_need = need - audio + tally["deficit_sec"]
            if tail_need > 0.05:    # 拍尾呼吸余量 + 句账收尾差
                spans += _take_block(shots, shot_starts, state,
                                     state["cursor"], tail_need, t1,
                                     back_off=0.0)
            # point 标签按时间归给要点(二遍 anchor 的要点分组/自动 vis 锚要用)
            pas = sorted(anchors, key=lambda a: float(a["t"]))
            for sp in spans:
                pt = int(pas[0]["point"])
                for a in pas:
                    if float(a["t"]) <= sp["start"] + 0.5:
                        pt = int(a["point"])
                    else:
                        break
                sp["point"] = pt
            if spans and _refit_feasible(seg, spans, fps):
                unit_ok = True
                n_unit_beats += 1
                n_dup += tally["dup"]
                n_ooo += tally["ooo"]
                n_behind += tally["behind"]
                viols += [{"seg_id": seg_id, **v} for v in tally["violations"]]
            else:
                # 句级磁带过不了 bind 的可行性(碎镜/断口结构):整拍回退
                # 按拍结账,宁可句画对齐降级也不能整片报错
                state["cursor"] = cur0
                spans = []
                n_fallback += 1
        if not unit_ok:
            spans = alloc_point_mode()
        got = sum(x["sec"] for x in spans)
        if got < need - 0.2:
            # 窗内取不满 → 从光标处越窗向后顺延补足(不跳取,与 MIN_BEAT 同源)
            blk = _take_block(shots, shot_starts, state, state["cursor"],
                              need - got, t1 + REFIT_TOPUP_EXTRA)
            if blk:
                last_pt = int(spans[-1]["point"]) if spans \
                    else int(anchors[0]["point"])
                for sp in blk:
                    sp["point"] = last_pt
                spans += blk
                got = sum(x["sec"] for x in spans)
        if got + 1e-6 < audio + 0.3:
            if cold_b:
                state["cursor"], state["used"] = cold_saved
            shortages.append({"seg_id": seg_id, "idx": rb.get("idx"),
                              "audio_sec": round(audio, 1),
                              "footage_sec": round(got, 1),
                              "window": [round(t0, 1), round(t1, 1)],
                              "text_head": str(seg.get("text", ""))[:40]})
            continue
        if cold_b:
            state["cursor"], state["used"] = cold_saved
        else:
            state["used"].update(sp["shot_id"] for sp in spans)
        new_beats[seg_id] = {"seg_id": seg_id, "idx": rb.get("idx"),
                             "spans": spans, "reel_sec": round(got, 2),
                             "char_cap": int(got * ratio * cps),
                             "window": win,
                             "unit_fit": unit_ok,
                             "cold_open": cold_b,
                             "point_anchors": anchors}
    if shortages:
        return ToolResult(
            text=("[ERROR] refit_shortage: " + str(len(shortages)) + " beats' "
                  "audio physically exceeds their footage window — shorten "
                  "those beats' narration (role discipline: delete flavor / "
                  "duplicate info first), then call produce_film again: " +
                  ",".join(f"beat{s['idx']}(配音{s['audio_sec']}s/画面窗仅"
                           f"{s['footage_sec']}s)" for s in shortages[:8])),
            data={"error": "refit_shortage", "beats": shortages})

    out_reel = ctx.resolve(args.get("output_reel") or "out/reel_fit.json")
    audio_total = round(sum(float(s["audio_dur"]) for s in audible), 1)
    reel_total = round(sum(b["reel_sec"] for b in new_beats.values()), 1)
    _save_json({"schema_version": SCHEMA_VERSION, "beats": new_beats,
                "narration_ratio": ratio, "chars_per_sec": round(cps, 2),
                "refit": True,
                "target_reel_sec": reel.get("target_reel_sec"),
                "audio_total_sec": audio_total}, out_reel)
    discipline = ""
    if n_dup or n_ooo or n_behind:
        discipline = (f" Citation discipline: {n_dup} duplicate citations,"
                      f" {n_ooo} out-of-chronological-order,"
                      f" {n_behind} cited shots already consumed by earlier"
                      " sentences (per-sentence list in data."
                      "citation_violations — fix the writer's shot citations"
                      " to reclaim them).")
    return ToolResult(
        text=(f"Refit {len(new_beats)} beats to real audio "
              f"({n_unit_beats} sentence-level"
              + (f", {n_fallback} fell back to beat-level (bind feasibility)"
                 if n_fallback else "")
              + f"): footage "
              f"{reel_total:.0f}s for narration {audio_total:.0f}s "
              f"(headroom {reel_total - audio_total:.0f}s) → "
              f"{ctx.virtualize(out_reel)}. Footage now yields to audio; "
              "estimated film ≈ narration + breathing tails." + discipline),
        data={"n_beats": len(new_beats), "reel_sec": reel_total,
              "audio_sec": audio_total,
              "n_unit_fit_beats": n_unit_beats,
              "n_beat_fallback": n_fallback,
              "n_dup_citations": n_dup,
              "n_out_of_order_citations": n_ooo,
              "n_anchors_behind_cursor": n_behind,
              "citation_violations": viols[:120],
              "output_reel": str(out_reel)},
        artifacts=[str(out_reel)])


# ------------------------------------------------------------------ anchor --
def _split_sents(rows: list[dict], *, preserve_units=False) -> list[dict]:
    """写手常把整拍塞进一个 sentence 对象——机械按标点重分句,保住句级锚定粒度。
    句级 shots(写手从 shot_captions 引用的语义锚)整句继承到每个拆分片段。
    带 board(信息点分镜)的句子不拆:board 的 text 片段与句文本是对位关系,
    机械拆句会打断这个对位。"""
    out = []
    for s in rows:
        from .picture_semantics import POLICY_FIELDS
        picture_fields = {key: s[key] for key in POLICY_FIELDS if key in s}
        shots = [str(x) for x in (s.get("shots") or []) if x]
        board = s.get("board") if isinstance(s.get("board"), list) else None
        if board or preserve_units:
            out.append({"text": str(s.get("text", "")).strip(),
                        "point": s.get("point", 1),
                        "shots": shots or [str(x) for seg in (board or [])
                                           if isinstance(seg, dict)
                                           for x in (seg.get("shots") or [])],
                        "board": board, **picture_fields})
            continue
        for part in re.split(r"(?<=[。！？!?；;])", str(s.get("text", ""))):
            part = part.strip()
            if part:
                out.append({"text": part, "point": s.get("point", 1),
                            "shots": shots, **picture_fields})
    return out


def _action_anchor(args: dict, ctx: RunContext) -> ToolResult:
    for k in ("reel_path", "plan_path", "script_path"):
        if not args.get(k):
            return ToolResult(text=f"[ERROR] {k} is required")
    try:
        reel = _load_json(ctx.resolve(args["reel_path"]))
        plan = _load_json(ctx.resolve(args["plan_path"]))
        sdata = _load_json(ctx.resolve(args["script_path"]))
    except Exception as exc:
        return ToolResult(text=f"[ERROR] failed to load inputs: {exc}")
    if not isinstance(reel, dict) or not isinstance(reel.get("beats", {}), dict):
        return ToolResult(text="[ERROR] reel_path must contain an object with a beats{} map")
    if not isinstance(plan, list) or not all(
            isinstance(p, dict) and "idx" in p and "chars" in p and "seg_id" in p for p in plan):
        return ToolResult(text="[ERROR] plan_path must be an array of {idx, seg_id, chars, summary}")
    if not isinstance(sdata, dict) or not isinstance(sdata.get("beats", []), list):
        return ToolResult(text="[ERROR] script_path must contain an object with beats[]")
    for b in sdata.get("beats", []):
        if isinstance(b, dict) and not isinstance(b.get("sentences", []), list):
            return ToolResult(text=f"[ERROR] script beat idx={b.get('idx')} sentences must be an array")
        if isinstance(b, dict) and not all(isinstance(x, dict) for x in b.get("sentences", [])):
            return ToolResult(text=f"[ERROR] script beat idx={b.get('idx')} sentences must be "
                                   "objects like {\"text\": ..., \"point\": n}, not strings")
    reels = reel.get("beats", {})
    cps = float(reel.get("chars_per_sec") or CHARS_PER_SEC)
    # 镜头时刻表(可选): 给"窗内引用"判定用;不传保持老行为(只认卷内)
    shot_times: dict[str, tuple[float, float]] = {}
    if args.get("shots_path"):
        try:
            tl = _load_json(ctx.resolve(args["shots_path"]))
            shot_times = {s["shot_id"]: (float(s["start"]), float(s["end"]))
                          for s in tl.get("shots", [])}
        except Exception as exc:
            return ToolResult(text=f"[ERROR] failed to load shots_path: {exc}")
    def _idx(v) -> int:
        try:
            return int(v)
        except (TypeError, ValueError):
            return -1

    # idx 统一 int 归一: 写手把 idx 写成字符串时, 句子失配会报 script_invalid
    # 兜底, 但 highlight 侧失配曾是静默全丢(留白归零无告警)
    by_idx = {_idx(b.get("idx")): b.get("sentences", [])
              for b in sdata.get("beats", []) if isinstance(b, dict)}
    hl_idx = {_idx(b.get("idx")) for b in sdata.get("beats", [])
              if isinstance(b, dict) and bool(b.get("highlight"))}
    # 拍级念法标注(tone): 写手给 TTS 的自然语言指令, 原样透传到 narration_script
    tone_idx = {_idx(b.get("idx")): str(b.get("tone") or "").strip()
                for b in sdata.get("beats", []) if isinstance(b, dict)}

    missing = [p["idx"] for p in plan
               if p["idx"] not in by_idx or not by_idx[p["idx"]]]
    if len(missing) > len(plan) * 0.1:
        return ToolResult(
            text=f"[ERROR] script_invalid: beats {missing[:10]} have no "
            "sentences — cover every beat in the brief, then call anchor again",
            data={"error": "script_invalid", "missing_beats": missing})

    # v6 预算门(音频先行):卷有 window 元数据时,refit 会让画面向配音看齐,
    # 每拍不再卡规划卷字数——只拦两类真错:①拍窗物理装不下(素材真极限);
    # ②全片总字数超目标 25%(片长保险丝,片长=总配音长)。
    # 旧卷(无 window)保持逐拍硬预算校验不变。produce_film 的二次锚定
    # (refit 之后换锚)传 budget_check=false 跳过整个门。
    budget_check = bool(args.get("budget_check", True))
    windows_present = any(isinstance(r, dict) and r.get("window")
                          for r in reels.values())
    ratio = float(reel.get("narration_ratio") or NARRATION_RATIO)
    budget_warnings: list[str] = []
    budget_data: dict = {}
    if budget_check:
        over = []
        total_chars_all = 0
        for p in plan:
            n = sum(len(str(s.get("text", ""))) for s in by_idx.get(p["idx"]) or [])
            total_chars_all += n
            if windows_present:
                rb = reels.get(p["seg_id"]) or {}
                win = rb.get("window") or {}
                if not win:
                    continue
                # v5 有池:素材上限就是池总长(整镜头配画只能从池里拿)
                if rb.get("pool"):
                    sup = float(rb.get("pool_sec") or 0)
                else:
                    sup = max(0.0, float(win["t1"]) - float(win["t0"])) \
                        + REFIT_TOPUP_EXTRA
                cap = int(sup * ratio * cps)
                tol = 1.0
            else:
                cap = p["chars"]
                tol = OVER_CHAR_TOL
            # 放慢类 tone 实测拉长配音时长 10~15%, 变相超预算 —— 按 85% 校验
            if any(w in tone_idx.get(p["idx"], "") for w in ("慢", "沉", "缓")):
                cap = int(cap * SLOW_TONE_FACTOR)
            if n > cap * tol:
                over.append({"idx": p["idx"], "chars": n, "cap": cap,
                             "summary": p["summary"][:30]})
        if over and not windows_present:
            return ToolResult(
                text=(f"[ERROR] over_budget: {len(over)} beats — beats exceed "
                      "their char cap by >15% — narration must yield to footage. "
                      "Shorten by DELETING whole sentences or secondary info; "
                      "do NOT compress multiple events into one sentence. "
                      "Then call anchor again: " +
                      ",".join(f"beat{o['idx']}({o['chars']}/{o['cap']})"
                               for o in over[:8])),
                data={"error": "over_budget", "scope": "beat", "beats": over})
        if over:
            # v5 软预算:池装不下只提示(配画阶段会精确报 insufficient_footage
            # 并交回写稿层),不在这里判失败
            budget_warnings.append(
                f"{len(over)} beats' text likely exceeds their shot pool: " +
                ",".join(f"beat{o['idx']}({o['chars']}/{o['cap']}字)"
                         for o in over[:8]))
            budget_data["pool_over"] = over
        if windows_present:
            ref_min = float(reel.get("reference_minutes") or 0)
            tol_ref = float(reel.get("reference_tol") or SOFT_MINUTES_TOL)
            est_min = total_chars_all / cps / 60.0
            budget_data["est_minutes"] = round(est_min, 2)
            if ref_min > 0:
                dev = (est_min - ref_min) / ref_min
                budget_data["reference_minutes"] = ref_min
                budget_data["deviation"] = round(dev, 3)
                if abs(dev) > tol_ref:
                    budget_warnings.append(
                        f"estimated narration {est_min:.1f} min is "
                        f"{dev * 100:+.0f}% vs reference {ref_min:.0f} min "
                        f"(soft range ±{tol_ref * 100:.0f}%) — not an error; "
                        "adjust only if the length matters to you")
            else:
                target_reel = float(reel.get("target_reel_sec") or 0)
                film_cap = int(target_reel * ratio * cps * FILM_CHAR_TOL) \
                    if target_reel > 0 else 0
                if film_cap and total_chars_all > film_cap:
                    budget_warnings.append(
                        f"film total {total_chars_all} chars exceeds "
                        f"{film_cap} (>40% over target length)")

    movie_packet, movie_clock = None, None
    profile_path = ctx.resolve('out/production_profile.json')
    if profile_path.is_file() and _load_json(profile_path).get('editorial_policy') == 'movie-editorial-v1':
        movie_packet = _load_json(ctx.resolve('out/writing_packet.json'))
        from . import movie_refinement
        clock_path = ctx.resolve('out/' + movie_refinement.CLOCK)
        if movie_refinement.enabled(ctx.resolve('out')) and clock_path.is_file():
            movie_clock = _load_json(clock_path)
    script: list[dict] = []
    events: list[dict] = []
    n_sent = 0
    n_cited_used = n_cited_dropped = 0
    n_auto_total = 0
    n_board_units = n_bad_board = 0
    for p in plan:
        seg_id = p["seg_id"]
        sents = _split_sents(by_idx.get(p["idx"]) or [], preserve_units=movie_packet is not None)
        if not sents or seg_id not in reels:
            continue
        spans = reels[seg_id]["spans"]
        text = "".join(s["text"] for s in sents)
        # 句→要点→该要点的画面块直接绑定(不按全拍字数比例摊,治句画漂移):
        # 讲要点k的句子只在要点k的块里配画面;同要点多句在块内按字数细分。
        pt_spans: dict[int, list[dict]] = {}
        for sp in spans:
            pt_spans.setdefault(int(sp.get("point", 1)), []).append(sp)
        pts_avail = sorted(pt_spans)

        def spans_for(pi: int) -> list[dict]:
            if pi in pt_spans:
                return pt_spans[pi]
            prev = [k for k in pts_avail if k < pi]   # 无画面要点→就近归前
            return pt_spans[prev[-1] if prev else pts_avail[0]]

        grouped: list[tuple[int, list[dict]]] = []
        for s in sents:
            pi = int(s.get("point") or 1)
            if grouped and grouped[-1][0] == pi:
                grouped[-1][1].append(s)
            else:
                grouped.append((pi, [s]))
        # 写手句级 shot 引用 = 语义锚(写稿时人已做过句画匹配)。
        # v9 起认"本拍时间窗内"的镜头(写手看着整窗的笔记标引用,预选卷
        # 只覆盖窗内一部分,按卷过滤会拦腰砍断引用链——踩过);窗外引用
        # 才是笔误或剧透,丢弃并计数。refit 取料同样以窗为界,窗内必兑现。
        beat_shots = {sp["shot_id"] for sp in spans}
        beat_shots |= set(reels[seg_id].get("pool") or [])
        win = reels[seg_id].get("window") or {}
        w0, w1 = float(win.get("t0", 0.0)), float(win.get("t1", 0.0))
        if shot_times and w1 > w0:
            in_window = beat_shots | {sid for sid, (a, b) in shot_times.items()
                                      if a < w1 and b > w0}
        else:
            in_window = beat_shots
        # 要点级 vis 自动锚: 大纲要点引用的视觉事件时间段 ∩ 该要点的卷镜头。
        # 写手引用永远优先; 自动锚兜"写手没引用"的底(v5 全稿零锚的教训——
        # 位置猜测把手机特写这类点睛镜头绑去了窗头打斗)。
        pt_vis: dict[int, list[list[float]]] = {}
        for a in reels[seg_id].get("point_anchors", []) or []:
            if a.get("vis"):
                pt_vis[int(a["point"])] = a["vis"]

        def vis_auto_shots(pi: int, g_spans: list[dict]) -> list[str]:
            out = []
            for t0v, t1v in pt_vis.get(pi, []):
                for sp in g_spans:
                    if sp["start"] < t1v and sp["end"] > t0v \
                            and sp["shot_id"] not in out:
                        out.append(sp["shot_id"])
            return out[:4]

        # refit 卷带句级分配(spans 的 unit 标签)时,位置锚直接照抄分配——
        # 磁带出厂已按句对齐,再按字数占比猜位置反而会跟分配打架。
        unit_span_shots: dict[str, list[str]] = {}
        for sp in spans:
            u = sp.get("unit")
            if u and sp["shot_id"] not in unit_span_shots.setdefault(u, []):
                unit_span_shots[u].append(sp["shot_id"])

        units, si = [], 0
        for pi, group in grouped:
            g_spans = spans_for(pi)
            g_sec = sum(sp["sec"] for sp in g_spans)
            g_chars = max(sum(len(x["text"]) for x in group), 1)
            auto = vis_auto_shots(pi, g_spans)
            pos = 0.0
            for gi_s, s in enumerate(group):
                si += 1
                uid = f"{seg_id}_u{si:02d}"
                sec = len(s["text"]) / g_chars * g_sec
                w0, w1 = pos, min(pos + sec, g_sec)
                pos = w1
                # 镜头归句:refit 句级分配优先(照抄);否则按中点归属唯一一句
                ids = list(unit_span_shots.get(uid) or [])
                if not ids:
                    acc = 0.0
                    for sp in g_spans:
                        mid = acc + sp["sec"] / 2
                        if w0 <= mid < w1:
                            ids.append(sp["shot_id"])
                        acc += sp["sec"]
                if not ids:             # 短句窗口没罩住镜头中点→取窗口所在镜头
                    acc = 0.0
                    for sp in g_spans:
                        if acc + sp["sec"] > (w0 + w1) / 2:
                            ids = [sp["shot_id"]]
                            break
                        acc += sp["sec"]
                # 信息点分镜(v10):board 的 text 片段拼起来必须就是句文本,
                # 每段 = "这几个字该看什么画面";时长按字数占比兑现,不再均分。
                storyboard: list[dict] = []
                board = s.get("board") if isinstance(s.get("board"), list) else None
                if board:
                    concat = "".join(str(x.get("text", "")) for x in board
                                     if isinstance(x, dict))
                    if concat.replace(" ", "") == str(s["text"]).replace(" ", ""):
                        for x in board:
                            b_shots = [str(a) for a in (x.get("shots") or [])
                                       if str(a) in in_window]
                            storyboard.append(
                                {"chars": len(str(x.get("text", ""))),
                                 "shots": b_shots,
                                 **({"text": str(x.get("text", ""))} if movie_packet is not None else {}),
                                 "hold": bool(x.get("hold"))})
                        n_board_units += 1
                    else:
                        if movie_packet is not None:
                            return ToolResult(text=f'[ERROR] movie storyboard changes sentence text: {uid}',
                                              data={'error': 'invalid_movie_storyboard', 'unit_id': uid})
                        n_bad_board += 1   # 分段文本对不上句文本:退回句级引用
                if storyboard:
                    cited = list(dict.fromkeys(
                        a for x in storyboard for a in x["shots"]))
                else:
                    cited = [x for x in s.get("shots", []) if x in in_window]
                n_cited_used += len(cited)
                n_cited_dropped += len(s.get("shots", [])) - len(cited) \
                    if not storyboard else 0
                # 语义锚优先级: 写手引用 > 要点 vis 自动锚(只发给要点首句,
                # 且该句自己没引用时) > 位置猜测兜底。
                # 写手有引用时不再拼接位置猜测——anchor_shot_ids 就是写手的
                # 引用链,refit 按句整条兑现,混入猜测镜头会污染链;
                # refit 后的二遍照抄(unit_span_shots)是实际磁带分配,可拼。
                merged = list(cited)
                if not cited and gi_s == 0 and auto:
                    merged += [x for x in auto if x not in merged]
                    n_auto_total += 1
                if not cited or uid in unit_span_shots:
                    merged += [x for x in ids if x not in merged]
                from .picture_semantics import policy
                raw_cited = list(dict.fromkeys(x for b in (board or []) if isinstance(b, dict)
                                               for x in b.get('shots', []))) if storyboard else s.get('shots', [])
                try:
                    expression = {}
                    if movie_packet is not None:
                        from .movie_picture import bind
                        expression = bind(s, movie_packet, p['idx'], si, clock=movie_clock)
                    picture_policy = policy({**s, **expression, 'cited_shot_ids': raw_cited})
                except ValueError as exc:
                    return ToolResult(text=f'[ERROR] invalid picture requirement: {uid}: {exc}',
                                      data={'error': 'invalid_picture_requirement', 'unit_id': uid})
                policy_ids = picture_policy['required_shot_ids'] + picture_policy['candidate_shot_ids']
                if any(sid not in in_window for sid in policy_ids):
                    return ToolResult(text=f'[ERROR] picture requirements outside beat window: {uid}',
                                      data={'error': 'invalid_picture_requirement', 'unit_id': uid})
                units.append({"semantic_unit_id": f"{seg_id}_u{si:02d}",
                              "text": s["text"], "anchor_shot_ids": merged[:4],
                              "cited_shot_ids": cited[:4],
                              **picture_policy, 'role': s.get('role', ''),
                              **({"storyboard": storyboard} if storyboard
                                 else {}),
                              "claim_ids": [],
                              "event_ids": [f"alb_{p['idx']:03d}"]})
                n_sent += 1
        events.append({"event_id": f"alb_{p['idx']:03d}",
                       "start": spans[0]["start"], "end": spans[-1]["end"],
                       "summary": p["summary"][:80], "importance": 0.6,
                       "narrative_role": "development", "character_ids": [],
                       "shot_ids": [x["shot_id"] for x in spans],
                       "candidate_shot_ids": [x["shot_id"] for x in spans],
                       "claims": [], "cue_ids": []})
        script.append({"seg_id": seg_id, "idx": p["idx"],
                       "source_seg_ids": [seg_id],
                       "story_scene_id": f"scene_{p['idx']:03d}",
                       "event_ids": [f"alb_{p['idx']:03d}"], "text": text,
                       "emotion": "neutral", "narrative": "development",
                       "tone": tone_idx.get(p["idx"], ""),
                       "highlight": p["idx"] in hl_idx, "use_original_audio": False,
                       "duration_is_soft": True,
                       "target_sec": round(len(text) / cps, 1),
                       "semantic_units": units})
        if movie_packet is not None:
            from .movie_picture import expand_storyboards
            if any(unit.get('storyboard') for unit in units):
                # Keep the exact paragraph utterance while allowing the existing
                # ASR alignment to time each explicit picture task independently.
                script[-1]['spoken_text'] = ''.join(unit['text'].strip() for unit in units)
                try:
                    script[-1]['semantic_units'] = expand_storyboards(units)
                except ValueError as exc:
                    return ToolResult(text=f'[ERROR] invalid movie storyboard: {seg_id}: {exc}',
                                      data={'error': 'invalid_movie_storyboard', 'seg_id': seg_id})
            picture_plan = movie_packet['beats'][p['idx']-1]['picture_plan']
            if picture_plan.get('hold_after_seconds'):
                script[-1].update(planned_picture_pause_seconds=picture_plan['hold_after_seconds'],
                                  picture_pause_reason=picture_plan['hold_reason'])

    out_script = ctx.resolve(args.get("output_script") or "out/narration_script.json")
    out_graph = ctx.resolve(args.get("output_graph") or "out/graph.json")
    _save_json(script, out_script)
    _save_json({"title": str(args.get("title", "")),
                "schema_version": SCHEMA_VERSION, "events": events}, out_graph)
    # v5 全篇主镜头登记:每句点名的镜头按大纲顺序登记(冷开场排最前,它用掉
    # 的镜头计入全片账本);同一镜头被两个事件点名 → duplicate,先到先得,
    # 后来者在配画时降级为"无主镜头句"(需补镜+复核)。登记表是 picture_fit
    # 防"补镜抢后文主镜头"的依据。
    registry: dict[str, dict] = {}
    dup_primaries: list[dict] = []
    order = sorted(script, key=lambda s: (0 if reels.get(s["seg_id"], {}).get("cold_open")
                                          else 1, int(s["idx"])))
    for s in order:
        for u in s["semantic_units"]:
            for sid in u.get("cited_shot_ids") or []:
                if sid in registry:
                    if registry[sid]["seg_id"] != s["seg_id"]:
                        dup_primaries.append({"shot_id": sid,
                                              "owner": registry[sid]["unit"],
                                              "unit": u["semantic_unit_id"]})
                    continue
                registry[sid] = {"seg_id": s["seg_id"], "unit": u["semantic_unit_id"]}
    out_registry = ctx.resolve(args.get("output_registry") or "out/primary_registry.json")
    _save_json({"schema_version": SCHEMA_VERSION, "primaries": registry,
                "duplicates": dup_primaries}, out_registry)
    total_chars = sum(len(s["text"]) for s in script)
    total_reel = round(sum(reels[s["seg_id"]]["reel_sec"] for s in script), 1)
    dup_note = ""
    if dup_primaries:
        dup_note = (f" {len(dup_primaries)} shots are cited by two events "
                    "(first citing event keeps them; later sentences lose that "
                    "primary — see data.duplicate_primaries, re-cite if it matters).")
    warn_note = (" [WARNING] " + "; ".join(budget_warnings)) if budget_warnings else ""
    return ToolResult(
        text=(f"Anchored {len(script)} beats / {n_sent} sentences / "
              f"{total_chars} chars over a {total_reel:.0f}s reel "
              f"(narration ≈{total_chars / cps:.0f}s); semantic anchors: "
              f"{n_cited_used} cited shots used"
              + (f", auto vis anchors for {n_auto_total} lead sentences"
                 if n_auto_total else "")
              + (f", {n_cited_dropped} dropped (outside beat reel)"
                 if n_cited_dropped else "")
              + f"; {len(registry)} primary shots registered." + dup_note
              + " Next: TTS, then picture fit." + warn_note),
        data={"n_beats": len(script), "n_sentences": n_sent,
              "n_picture_units": sum(len(s['semantic_units']) for s in script),
              "n_chars": total_chars, "reel_sec": total_reel,
              "n_cited_anchors": n_cited_used,
              "n_auto_vis_anchors": n_auto_total,
              "n_cited_dropped": n_cited_dropped,
              "n_storyboard_sentences": n_board_units,
              "n_invalid_boards": n_bad_board,
              "n_primaries": len(registry),
              "duplicate_primaries": dup_primaries[:60],
              "budget": budget_data,
              "warnings": budget_warnings,
              "est_narration_sec": round(total_chars / cps, 1)},
        artifacts=[str(out_script), str(out_graph), str(out_registry)])
