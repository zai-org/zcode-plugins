"""Basketball and LoL match editing kernel.

Tool arguments, shared speech, paths and artifact bindings live in match_recap.
"""
from __future__ import annotations

import functools
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from .result import ToolResult
from .run_context import RunContext
from .subtitle_style import find_cjk_font, find_drawtext_cjk_font, drawtext_escape, ffmpeg_filter_escape, libass_fontsdir

# ---------------- 剪辑常量 ----------------
KIND_WINDOWS = {          # 每类事件默认 (前摇, 事件后) 秒; 事件后放长, 让画面把事情演完再切
    "fight":   (6.0, 9.0),   # 团战
    "kill":    (3.5, 5.0),   # 单个击杀/一血
    "objective": (8.0, 9.0), # 大龙/小龙/峡谷先锋
    "tower":   (5.0, 8.0),   # 推塔/破高地/拆水晶
    "ending":  (8.0, 11.0),  # 终结比赛
}
SNAP_IN_BACK, SNAP_IN_FWD = 5.0, 3.0
SNAP_OUT_BACK, SNAP_OUT_FWD = 3.0, 7.0
FLASH_PRE, FLASH_POST = 2.5, 1.5      # 冷开场名场面快闪(标题叠在第一个快闪上)
GAP_BREATH = 0.0                       # 不要中间黑屏
FREEZE = 3.0
CALL_SLOT = 3.5                        # 名场面呐喊句槽位
TITLE_SEC = 0.0                        # 标题不再单独黑卡,叠在开场画面上
NARR_TAIL = 1.2                        # 每段解说讲完后画面再留 ~1.2s 才切

# ---- mode="script"(解说稿驱动摘片): 画面是台词的函数, 讲到哪摘到哪 ----
JUMP_GAP = 6.0                         # 句子 t 超出当前画面游标该秒数 -> 另起切片(跳切蒙太奇)
CLIP_PRE = 1.0                         # 切片在首句所指时刻前留的起势画面
HARD_LEAD = 0.25                       # 硬事件句(呐喊)比事件帧早这么多起口
ACTION_SLACK = 6.0                     # 硬事件切片为让动作演完最多多留的秒数
QC_MAX_GAP = 9.0                       # Review signal for a long narration gap, not an automatic failure.

# 三档情绪: 音调恒 0,只用语速+响度拉开
TIERS_LUFS = {0: -18.0, 1: -16.5, 2: -14.5}
CHARS_PER_SEC = {0: 4.6, 1: 4.9, 2: 5.2}

BED_VOL = 0.10                         # 原声全程压低(纯生成解说,原声只当氛围)
SUB_FONTNAME = "Noto Sans CJK SC"
CJK_FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
]


def _font() -> str:
    # drawtext loads face 0 only: prefer a font whose first face is Simplified Chinese.
    # Keeps the find_cjk_font contract: a path, or an "[ERROR] ..." string.
    return find_drawtext_cjk_font() or find_cjk_font()


def _dur_of(p) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "csv=p=0", str(p)], capture_output=True, text=True, stdin=subprocess.DEVNULL, check=True).stdout.strip()
    return float(out or 0)


@functools.lru_cache(maxsize=8)
def _script_option_for(binary: str, stamp: float) -> str:
    """`-/filter_complex FILE` exists from FFmpeg 7; 6.x only has the script option."""
    with tempfile.TemporaryDirectory(prefix="ve-ffprobe-") as tmp:
        script = Path(tmp) / "probe.txt"
        script.write_text("anullsrc=d=0.05[out]", encoding="utf-8")
        for option in ("-/filter_complex", "-filter_complex_script"):
            try:
                done = subprocess.run([binary, "-nostdin", "-v", "error", option, str(script), "-map", "[out]",
                                       "-f", "null", "-"], capture_output=True, timeout=20)
            except (OSError, subprocess.SubprocessError):
                continue
            if done.returncode == 0:
                return option
    return "-filter_complex_script"


def filter_script_args(path) -> list[str]:
    """Arguments that read a complex filtergraph from ``path`` on the active ffmpeg."""
    binary = shutil.which("ffmpeg") or "ffmpeg"
    try:
        stamp = os.stat(binary).st_mtime
    except OSError:
        stamp = 0.0
    return [_script_option_for(os.path.realpath(binary), stamp), str(path)]


def _ffmpeg(args):
    return subprocess.run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-filter_complex_threads", "1", "-threads", "2"] + args,
                          capture_output=True, text=True)


def _normalize_mix(path, work):
    """Keep the mix balance while measuring and normalizing delivery loudness."""
    probe = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-nostats", "-i", str(path),
                            "-af", "loudnorm=I=-16:TP=-1.5:LRA=7:print_format=json", "-f", "null", "-"],
                           capture_output=True, text=True)
    blocks = re.findall(r"\{[^{}]+\}", probe.stderr)
    if probe.returncode or not blocks:
        return "could not measure the final mix"
    measured = json.loads(blocks[-1])
    if not all(math.isfinite(float(measured[k])) for k in ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")):
        return "the final mix has no measurable audio"
    lra = min(50, max(7, float(measured["input_lra"])))
    filter_ = (f"loudnorm=I=-16:TP=-1.5:LRA={lra}:measured_I={measured['input_i']}:"
               f"measured_TP={measured['input_tp']}:measured_LRA={max(0.01, float(measured['input_lra']))}:"
               f"measured_thresh={measured['input_thresh']}:offset={measured['target_offset']}:linear=true")
    normalized = work / "normalized.mp4"
    result = _ffmpeg(["-i", str(path), "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy",
                      "-af", filter_, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
                      "-movflags", "+faststart", str(normalized)])
    if result.returncode:
        return result.stderr[-300:]
    normalized.replace(path)
    return None


# ================================================================ lol_ingest


# ================================================================ lol_arrange
def _cuts_from_shots(sj):
    shots = sj.get("shots") or []
    cuts = [round(float(s["start"]), 3) for s in shots[1:]]
    if shots:
        cuts.append(round(float(shots[-1]["end"]), 3))
    return cuts


def _snap(t, cuts, back, fwd, prefer):
    cand = [c for c in cuts if t - back <= c <= t + fwd]
    if not cand:
        return t
    fore = [c for c in cand if (c - t) * prefer >= 0]
    return (min(fore, key=lambda c: abs(c - t)) if fore else min(cand, key=lambda c: abs(c - t)))


def _pin_event(t, game_idx, events, win=12.0, chain_gap=6.0):
    """v2 精定位: 把 ASR 时间 t 吸附到窗口内最近的 VLM 事件;并把间隔<=chain_gap 的
    相邻事件链成一个完整过程(团战->接推进),窗口下限=真实事件区间。"""
    evs = sorted([e for e in events if str(e.get("game", 1)) == str(game_idx)],
                 key=lambda e: e["src_start"])
    bi = None; bc = None
    for i, e in enumerate(evs):
        # A reviewed action time is distinct from the surrounding action range.
        # Legacy ranges may extend the clip, but must not move an explicit anchor.
        c = float(e.get("event_t", t))
        if "event_t" not in e and not e["src_start"] <= t <= e["src_end"]:
            continue
        if abs(c - t) <= win and (bi is None or abs(c - t) < abs(bc - t)):
            bi, bc = i, c
    if bi is None:
        return None
    s, en = evs[bi]["src_start"], evs[bi]["src_end"]
    j = bi
    while j + 1 < len(evs) and evs[j + 1]["src_start"] - en <= chain_gap:
        j += 1; en = max(en, evs[j]["src_end"])
    j = bi
    while j - 1 >= 0 and s - evs[j - 1]["src_end"] <= chain_gap:
        j -= 1; s = min(s, evs[j]["src_start"])
    return (s, en, bc)  # (in, out, center)


def _validate_outline(outline):
    issues = []
    if not outline.get("teams_cn", {}).get("home"):
        issues.append("teams_cn.home/away required")
    beats = outline.get("beats") or []
    if not beats:
        issues.append("beats empty")
    kinds = {"open", "fight", "kill", "objective", "tower", "ending"}
    prev_key = (0, -1.0)
    for b in beats:
        k = b.get("kind")
        if k not in kinds:
            issues.append(f"beat {b.get('idx')}: kind must be {sorted(kinds)}"); continue
        if k == "open":
            continue
        if not isinstance(b.get("t"), (int, float)):
            issues.append(f"beat {b.get('idx')}: t (source second of the game) required"); continue
        key = (int(b.get("game", 1)), b["t"])
        if key < prev_key:
            issues.append(f"beat {b.get('idx')}: out of time order")
        prev_key = key
    return issues


# ---------------- mode="script": 解说稿驱动摘片 ----------------
# 范式与 window 模式相反: 先有从头到尾的解读稿(每句标注它讲的源画面秒 t),
# 画面按稿摘 —— 每组台词摘一段刚好讲完的画面, 硬事件句由 VLM 钉到动作帧。
# 没有词的画面不会被摘进来, 空窗在结构上不存在(只剩呐喊后的呼吸口)。

def _sent_dur(s):
    return float(s.get("dur") or (len(s["text"]) / 4.8 + 0.4))


def _group_moments(sents):
    """按 t 跳变把一拍的句子分成若干"时刻组", 每组对应一个源画面切片。
    无 t 的句子跟随前句(画面连续讲下去)。"""
    groups, cur, cursor = [], [], None    # cursor: 当前组讲完时画面播到的源秒
    for s in sents:
        st = s.get("t")
        if cur and ((s.get("hard") and any(x.get("hard") for x in cur)) or
                    (st is not None and cursor is not None and float(st) - cursor > JUMP_GAP)):
            groups.append(cur); cur = []; cursor = None
        cur.append(s)
        if st is not None:
            cursor = float(st) + _sent_dur(s) + 0.15
        elif cursor is not None:
            cursor += _sent_dur(s) + 0.15
    if cur:
        groups.append(cur)
    return groups


def _clip_layout(group, clip_in, hl, hard_te=None):
    """摆一组句子: 前向链 + t 软约束; 硬句钉死在 hard_te(事件帧), 前面的铺垫句
    向前回填(解说比画面早起口是自然的), 后面的句子从硬句(含呐喊呼吸口)重新前推。
    假定每组至多一个硬句(写作纪律)。返回 (每句片内偏移, 末句讲完偏移)。"""
    hi = next((i for i, s in enumerate(group) if s.get("hard")), None)
    locs, prev_end = [], None
    for s in group:
        want = 0.2 if prev_end is None else prev_end + 0.15
        st = s.get("t")
        if st is not None and not s.get("hard"):
            want = max(want, float(st) - clip_in - 0.8)
        locs.append(want)
        prev_end = want + _sent_dur(s)
        if s.get("hard") and hl:
            prev_end += CALL_SLOT
    if hi is not None and hard_te is not None:
        locs[hi] = hard_te - clip_in - HARD_LEAD
        for j in range(hi - 1, -1, -1):                      # 铺垫回填
            locs[j] = min(locs[j], locs[j + 1] - _sent_dur(group[j]) - 0.15)
        prev_end = locs[hi] + _sent_dur(group[hi]) + (CALL_SLOT if hl else 0.0)
        for j in range(hi + 1, len(group)):                  # 硬句后重新前推
            want = prev_end + 0.15
            stj = group[j].get("t")
            if stj is not None:
                want = max(want, float(stj) - clip_in - 0.8)
            locs[j] = want
            prev_end = locs[j] + _sent_dur(group[j])
    last_end = max(loc + _sent_dur(s) for loc, s in zip(locs, group))
    if hi is not None and hl:
        last_end = max(last_end, locs[hi] + _sent_dur(group[hi]) + CALL_SLOT)
    return locs, last_end


def _solve_clip(group, hl, pin, gdur):
    """解切片入点: 硬事件句起口落在事件帧前 HARD_LEAD; 铺垫被回填出片头时
    把画面入点提前(铺垫词盖在事件前的真实画面上)。"""
    hi = next((i for i, s in enumerate(group) if s.get("hard")), None)
    te = None
    if hi is not None:
        te = pin[2] if pin else (float(group[hi]["t"]) if group[hi].get("t") is not None else None)
    clip_in = max(0.0, float(group[0]["t"]) - CLIP_PRE)
    locs, last_end = _clip_layout(group, clip_in, hl, te)
    if locs[0] < 0.2:
        clip_in = max(0.0, clip_in - (0.2 - locs[0]))
        locs, last_end = _clip_layout(group, clip_in, hl, te)
    out = clip_in + last_end + NARR_TAIL
    if pin:
        out = max(out, pin[1] + 0.8)  # Retain the reviewed outcome, even during a pause.
        clip_in = min(clip_in, pin[0])
        locs, last_end = _clip_layout(group, clip_in, hl, te)
        out = max(out, clip_in + last_end + NARR_TAIL)
    return round(clip_in, 3), round(min(out, gdur), 3), locs


def _arrange_script_mode(out_dir, args, match, outline, sents_by_beat, vlm_events):
    beats = outline["beats"]
    co = outline.get("cold_open") or {}
    flashes = [{"game": str(fl.get("game", 1)), "in": round(fl["t"] - FLASH_PRE, 3),
                "out": round(fl["t"] + FLASH_POST, 3)} for fl in co.get("flashes", [])]
    open_dur = sum(f["out"] - f["in"] for f in flashes) + TITLE_SEC

    clips, issues = [], []
    for b in beats:
        if b["kind"] == "open":
            continue
        sents = sents_by_beat.get(b["idx"]) or []
        if not sents:
            issues.append(f"beat{b['idx']} has no narration — in script mode the picture follows the lines, "
                          "so a beat without lines gets no footage")
            continue
        if sents[0].get("t") is None:
            issues.append(f"beat{b['idx']} first sentence lacks t (the source second it talks about)")
            continue
        g = str(b.get("game", 1)); gdur = match["games"][g]["duration"]
        hl = bool(b.get("highlight"))
        for group in _group_moments(sents):
            if group[0].get("t") is None and clips:   # 跳切组首句无 t: 并回上一片
                clips[-1]["_sents"] += group
                cin, cout, locs = _solve_clip(clips[-1]["_sents"], clips[-1]["highlight"],
                                              clips[-1].get("_pin"), gdur)
                clips[-1].update({"in": cin, "out": cout, "_locs": locs})
                continue
            hs = next((s for s in group if s.get("hard") and s.get("t") is not None), None)
            pin = _pin_event(float(hs["t"]), g, vlm_events) if hs is not None else None
            cin, cout, locs = _solve_clip(group, hl, pin, gdur)
            clips.append({"beat": b["idx"], "kind": "seg", "tag": b["kind"], "game": g,
                          "event_t": round(pin[2] if pin else float(group[0]["t"]), 2),
                          "in": cin, "out": cout, "highlight": hl,
                          "action_end": pin[1] if pin else None,
                          "_locs": locs, "_sents": group, "_pin": pin})
    if not clips:
        return ToolResult(text="outline_invalid: " + "; ".join(issues[:5]),
                          data={"status": "outline_invalid", "issues": issues})

    # 源时间单调: 相邻切片重叠 -> 先收上一片的动作余量, 不够再顺移本片(并报告)
    for a, c in zip(clips, clips[1:]):
        if c["game"] != a["game"] or c["in"] >= a["out"] + 0.1:
            continue
        a_min = max(a["in"] + a["_locs"][-1] + _sent_dur(a["_sents"][-1]) + 0.3,
                    a.get("action_end") or 0)
        a["out"] = round(max(a_min, c["in"] - 0.1), 3)
        if c["in"] < a["out"] + 0.1:
            issues.append(f"beat{a['beat']}->beat{c['beat']} footage overlaps by {a['out']-c['in']:.1f}s, "
                          f"combine beats or shorten narration; source anchors were retained")
            # Leave the evidence times intact; the public adapter rejects this plan.
    ending = [c for c in clips if c["tag"] == "ending"]
    if ending:
        ending[-1]["kind"] = "end"

    cur = open_dur
    plan = []
    ob = next((x for x in beats if x["kind"] == "open"), None)
    if ob is not None:                       # 开场句骑在快闪蒙太奇上, 从 0.4s 链排
        prev = 0.4
        for s in sents_by_beat.get(ob["idx"], []):
            plan.append({"beat": ob["idx"], "text": s["text"], "start": round(prev, 2),
                         "dur": round(_sent_dur(s), 2)})
            prev += _sent_dur(s) + 0.15
        if prev > open_dur + 1.5:
            issues.append(f"opening narration {prev:.1f}s exceeds the cold open {open_dur:.1f}s, "
                          "add flashes or drop a sentence")
    for c in clips:
        c["reel_in"] = round(cur, 2)
        c["reel_event"] = round(cur + c["event_t"] - c["in"], 2)
        for s, loc in zip(c["_sents"], c["_locs"]):
            plan.append({"beat": c["beat"], "text": s["text"], "start": round(cur + loc, 2),
                         "dur": round(_sent_dur(s), 2)})
        cur += c["out"] - c["in"]
        if c["kind"] == "end":
            cur += FREEZE
    total = round(cur, 2)
    for c in clips:
        c.pop("_sents", None); c.pop("_locs", None); c.pop("_pin", None)

    # 覆盖审计: 无解说空窗一目了然, 这是"讲清楚比赛"的机器化验收
    gaps, cursor = [], 0.0
    for p in sorted(plan, key=lambda x: x["start"]):
        if p["start"] - cursor > 2.0:
            gaps.append((round(cursor, 1), round(p["start"] - cursor, 1)))
        cursor = max(cursor, p["start"] + p["dur"])
    body_end = total - (FREEZE if ending else 0.0)
    if body_end - cursor > 2.0:
        gaps.append((round(cursor, 1), round(body_end - cursor, 1)))
    max_gap = max((g[1] for g in gaps), default=0.0)
    speech = sum(p["dur"] for p in plan)

    reel = {"mode": "script", "match_path": str(args["match_path"]), "open_dur": round(open_dur, 2),
            "title_sec": TITLE_SEC, "flashes": flashes, "segs": clips, "total": total,
            "freeze": FREEZE if ending else 0.0, "gap_breath": 0.0, "plan": plan}
    (out_dir / "reel.json").write_text(json.dumps(reel, ensure_ascii=False, indent=1), encoding="utf-8")
    rpt = [f"script mode: {len(clips)} clips, expected cut {total:.0f}s, speech {speech:.0f}s "
           f"(coverage {speech/max(total,1)*100:.0f}%), longest gap {max_gap:.1f}s (review above {QC_MAX_GAP}s)"]
    rpt += [f"  narration gap {g[1]}s at {g[0]}s of the cut" for g in gaps if g[1] > 4.0]
    rpt += [f"  [!] {i}" for i in issues]
    (out_dir / "coverage_report.txt").write_text("\n".join(rpt), encoding="utf-8")
    return ToolResult(text=rpt[0] + ("; issues: " + "; ".join(issues[:3]) if issues else ""),
                      data={"status": "ok" if not issues else "check",
                            "total_sec": total, "n_clips": len(clips), "speech_sec": round(speech, 1),
                            "max_gap": max_gap, "gaps": gaps, "issues": issues,
                            "reel_path": str(out_dir / "reel.json")},
                      artifacts=[str(out_dir / "reel.json"), str(out_dir / "coverage_report.txt")])


# ================================================================ lol_tts (照 soccer_tts)


# ================================================================ lol_render


def _place_plan(sentences, reel):
    """script 模式: 逐句按 arrange 解好的摆放计划落位(计划与稿子同序)。"""
    plan = reel.get("plan") or []
    if len(plan) != len(sentences):
        return [], [f"plan and script differ in sentence count: {len(plan)} vs {len(sentences)} — the script changed, run the arrange step again"]
    placed, issues = [], []
    prev_end = 0.0
    for s, p in zip(sentences, plan):
        if s["text"].strip() != p["text"].strip():
            return [], [f"sentence order differs from the plan (from \"{s['text'][:14]}\") — the script changed, run the arrange step again"]
        st = max(p["start"], prev_end + 0.12)
        if s.get("hard") and st - p["start"] > 0.6:
            issues.append(f"beat{p['beat']} hard sentence pushed {st-p['start']:.2f}s late: {s['text'][:16]}")
        if st + s["dur"] > reel["total"] - 0.4:
            issues.append(f"beat{p['beat']} runs past the end of the cut: {s['text'][:16]}")
        placed.append({**s, "beat": p["beat"], "start": round(st, 2)})
        prev_end = st + s["dur"]
    return placed, issues


def _render_segments(reel, match, outline, work):
    files = []
    tcn = outline.get("teams_cn", {})
    font = _font()
    for i, f in enumerate(reel["flashes"]):
        src = match["games"][f["game"]]["video"]
        dst = work / f"flash_{i}.mp4"; dur = f["out"] - f["in"]
        vf = "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=25"
        if i == 0:                # 标题叠在第一个快闪画面上(不再要黑色标题卡)
            l1 = f"{tcn.get('home','')}  vs  {tcn.get('away','')}"
            l2 = outline.get("open_title", "")
            vf += (f",drawbox=x=0:y=0:w=iw:h=ih:color=black@0.32:t=fill"
                   f",drawtext=fontfile={font}:text={drawtext_escape(l1)}:x=(w-text_w)/2:y=h*0.40-text_h/2:"
                   f"fontsize=80:fontcolor=white:borderw=3:bordercolor=black"
                   f",drawtext=fontfile={font}:text={drawtext_escape(l2)}:x=(w-text_w)/2:y=h*0.58-text_h/2:"
                   f"fontsize=34:fontcolor=white:borderw=2:bordercolor=black"
                   f",fade=t=in:st=0:d=0.4")
        af = f"afade=t=in:st=0:d=0.04,afade=t=out:st={dur-0.04:.2f}:d=0.04"
        r = _ffmpeg(["-ss", f"{f['in']:.3f}", "-to", f"{f['out']:.3f}", "-i", src, "-vf", vf, "-af", af,
                     "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-pix_fmt", "yuv420p",
                     "-c:a", "aac", "-ar", "48000", "-ac", "2", str(dst)])
        if r.returncode:
            return files, f"flash {i}: {r.stderr[-200:]}"
        files.append(dst)
    if reel["flashes"] and GAP_BREATH > 0:
        gap = work / "gap.mp4"
        _ffmpeg(["-f", "lavfi", "-i", f"color=c=black:s=1280x720:r=25:d={GAP_BREATH}",
                 "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-shortest",
                 "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p",
                 "-c:a", "aac", "-ar", "48000", "-ac", "2", str(gap)])
        files.append(gap)
    for i, g in enumerate(reel["segs"]):
        src = match["games"][g["game"]]["video"]
        dst = work / f"seg_{i:02d}.mp4"; dur = g["out"] - g["in"]
        vf = "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=25"
        af = f"afade=t=in:st=0:d=0.08,afade=t=out:st={dur-0.08:.2f}:d=0.08"
        if g["kind"] == "end":
            ec = outline.get("end_card") or {}; fz = reel.get("freeze", FREEZE); font = _font()
            vf += f",tpad=stop_mode=clone:stop_duration={fz}"
            if ec.get("line1"):
                vf += (f",drawtext=fontfile={font}:text={drawtext_escape(ec['line1'])}:x=(w-text_w)/2:y=300:fontsize=60:"
                       f"fontcolor=white:enable=gte(t\\,{dur+0.3:.2f})")
            if ec.get("line2"):
                vf += (f",drawtext=fontfile={font}:text={drawtext_escape(ec['line2'])}:x=(w-text_w)/2:y=400:fontsize=34:"
                       f"fontcolor=0xdddddd:enable=gte(t\\,{dur+0.5:.2f})")
            vf += f",fade=t=out:st={dur+fz-0.9:.2f}:d=0.9"
            af = f"apad=pad_dur={fz},afade=t=in:st=0:d=0.08,afade=t=out:st={dur+fz-1.2:.2f}:d=1.2"
        r = _ffmpeg(["-ss", f"{g['in']:.3f}", "-to", f"{g['out']:.3f}", "-i", src, "-vf", vf, "-af", af,
                     "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-pix_fmt", "yuv420p",
                     "-c:a", "aac", "-ar", "48000", "-ac", "2", str(dst)])
        if r.returncode:
            return files, f"seg {i}: {r.stderr[-300:]}"
        files.append(dst)
    return files, None


def _srt_ts(t):
    h = int(t // 3600); m = int((t % 3600) // 60); s = t % 60
    return f"{h:02d}:{m:02d}:{int(s):02d},{int((s-int(s))*1000):03d}"


def _build_srt(placed, path):
    """把每句解说按 (start, start+dur) 写成 SRT,供烧字幕。"""
    lines = []
    for i, s in enumerate(sorted(placed, key=lambda z: z["start"]), 1):
        st = s["start"]; en = st + s.get("dur", 2.0)
        lines.append(f"{i}\n{_srt_ts(st)} --> {_srt_ts(en)}\n{s['text'].strip()}\n")
    Path(path).write_text("\n".join(lines), encoding="utf-8")
    return path


def _mix(base, placed, out_path, work, subs=None, position="lower", fontsdir=None):
    """动态 ducking: 解说时原声压到 BED_VOL, 无解说空窗 0.4s 内平滑抬到 GAP_VOL;
    短于 MIN_GAP 的空窗不抬(避免原解说半字冒头)。解说句 adelay 叠加。可选烧字幕。"""
    GAP_VOL, RAMP, MIN_GAP = 0.85, 0.4, 1.2
    # 解说区间 -> 合并小间隙(小空窗保持压低)
    iv = sorted((s["start"] - 0.15, s["start"] + s.get("dur", 2.0) + 0.15) for s in placed)
    duck = []
    for a, b in iv:
        if duck and a - duck[-1][1] < MIN_GAP:
            duck[-1][1] = max(duck[-1][1], b)
        else:
            duck.append([max(0.0, a), b])
    # 到最近解说区间的距离: 区间内=0 -> BED_VOL; 区间外按距离 0.4s 线性抬到 GAP_VOL
    dists = [f"max(max({a:.2f}-t\\,t-{b:.2f})\\,0)" for a, b in duck]
    expr = dists[0]
    for d in dists[1:]:
        expr = f"min({expr}\\,{d})"
    vol = f"volume='{BED_VOL}+{GAP_VOL - BED_VOL}*min(1\\,({expr})/{RAMP})':eval=frame"

    parts = []
    if subs:
        # libass reads force_style Alignment with legacy SSA numbers (8 = middle-left):
        # keep the style bottom-centred and tag top/middle cues with {\an8}/{\an5}.
        from .render_narrated import positioned_subtitle
        subs = str(positioned_subtitle(Path(os.path.abspath(subs)), position))
        style = (f"FontName={SUB_FONTNAME},FontSize=18,PrimaryColour=&H00FFFFFF,"
                 f"OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,"
                 f"Alignment=2,MarginV=38")
        sub_opts = f"filename={ffmpeg_filter_escape(os.path.abspath(subs))}"
        if fontsdir:                     # 让 libass 看到 VE_FONT_DIRS 选中的字体目录
            sub_opts += f":fontsdir={ffmpeg_filter_escape(fontsdir)}"
        parts.append(f"[0:v]subtitles={sub_opts}:force_style='{style}'[v]")
        vmap = "[v]"
    else:
        vmap = "0:v"
    parts.append(f"[0:a]{vol}[bg]"); amixin = "[bg]"
    for k, s in enumerate(placed):
        ms = int(round(s["start"]*1000))
        parts.append(f"[{k+1}:a]adelay={ms}|{ms}[n{k}]"); amixin += f"[n{k}]"
    parts.append(f"{amixin}amix=inputs={len(placed)+1}:duration=first:normalize=0,"
                 f"acompressor=threshold=0.15:ratio=2:attack=200:release=800:makeup=1.5,"
                 f"alimiter=limit=0.95[out]")
    fscript = work / "mix.txt"; fscript.write_text(";".join(parts), encoding="utf-8")
    cmd = ["-i", str(base)]
    for s in placed:
        cmd += ["-i", s["audio"]]
    cmd += [*filter_script_args(fscript), "-map", vmap, "-map", "[out]",
            "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-pix_fmt", "yuv420p",
            "-profile:v", "high", "-level", "4.0", "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart", str(out_path)]
    r = _ffmpeg(cmd)
    return r.stderr[-400:] if r.returncode else _normalize_mix(out_path, work)


def _qc(final, reel, placed=None):
    qc = {"pass": True, "checks": {}}
    d = _dur_of(final)
    qc["checks"]["duration"] = {"pass": abs(d - reel["total"]) < 3.0, "final": round(d, 2), "reel": reel["total"]}
    r = subprocess.run(["ffmpeg", "-nostdin", "-i", str(final), "-af", "loudnorm=print_format=json",
                        "-f", "null", "-"], capture_output=True, text=True)
    m = re.search(r"\{[^{}]+\}", r.stderr[-2000:], re.S)
    lufs = float(json.loads(m.group())["input_i"]) if m else None
    qc["checks"]["loudness"] = {"pass": lufs is not None and -20 <= lufs <= -12, "input_i": lufs}
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                        "stream=pix_fmt", "-of", "csv=p=0", str(final)], capture_output=True, text=True)
    qc["checks"]["pix_fmt"] = {"pass": r.stdout.strip() == "yuv420p", "pix_fmt": r.stdout.strip()}
    if placed:   # 空窗门: 讲清楚比赛的机器化验收 —— 全片不允许长时间没人讲
        cursor, worst = 0.0, (0.0, 0.0)
        for p in sorted(placed, key=lambda x: x["start"]):
            g = p["start"] - cursor
            if g > worst[1]:
                worst = (cursor, g)
            cursor = max(cursor, p["start"] + p.get("dur", 2.0))
        tail = reel["total"] - reel.get("freeze", 0.0) - cursor
        if tail > worst[1]:
            worst = (cursor, tail)
        qc["narration_gaps"] = {"needs_review": worst[1] > QC_MAX_GAP,
                                "max_gap": round(worst[1], 1), "at": round(worst[0], 1)}
    qc["pass"] = all(c["pass"] for c in qc["checks"].values())
    return qc


def lol_render(args: dict, ctx: RunContext) -> ToolResult:
    out_dir = Path(args.get("out_dir", "out"))
    try:
        reel = json.loads(Path(args["reel_path"]).read_text(encoding="utf-8"))
        stts = json.loads(Path(args["script_tts_path"]).read_text(encoding="utf-8"))
        match = json.loads(Path(reel["match_path"]).read_text(encoding="utf-8"))
        outline = json.loads(Path(args["outline_path"]).read_text(encoding="utf-8"))
    except KeyError as e:
        return ToolResult(text=f"[ERROR] missing arg: {e}")
    except (OSError, json.JSONDecodeError) as e:
        return ToolResult(text=f"[ERROR] cannot read input: {e}")
    out_path = Path(args.get("output_path") or out_dir / "final.mp4")
    work = out_dir / "render_work"; work.mkdir(parents=True, exist_ok=True)

    placed, issues = _place_plan(stts["sentences"], reel)
    (out_dir / "placement.json").write_text(json.dumps(placed, ensure_ascii=False, indent=1), encoding="utf-8")
    if issues:
        tag = "placement_invalid" if reel.get("mode") == "script" else "over_budget"
        hint = ("the script and the reel plan are out of sync, or a hard sentence drifted: after editing the script rerun synthesis, then arrange, then render"
                if reel.get("mode") == "script" else "shorten the narration of those beats, then rerun synthesize_narration(mode=match) and video_render(kind=match)")
        return ToolResult(text=f"{tag}: " + "; ".join(issues[:4]),
                          data={"status": tag, "issues": issues, "hint": hint})
    # 字体: 先查后用, 找不到直接报错(find_cjk_font 返回 "[ERROR] ..." 串), 不进滤镜图
    font = _font()
    if font.startswith("[ERROR]"):
        return ToolResult(text=font, is_error=True, data={"status": "font_missing"})
    fontsdir = libass_fontsdir(font)   # 系统字体目录太大, 只把选中的字体链接进私有目录喂 libass
    files, err = _render_segments(reel, match, outline, work)
    if err:
        return ToolResult(text=f"[ERROR] render failed: {err}")
    lst = work / "concat.txt"; lst.write_text("".join(f"file '{os.path.abspath(f)}'\n" for f in files), encoding="utf-8")
    base = work / "base.mp4"
    r = _ffmpeg(["-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(base)])
    if r.returncode:
        return ToolResult(text=f"[ERROR] concat failed: {r.stderr[-200:]}")
    subs = _build_srt(placed, work / "subs.srt")   # 解说字幕(中文黑体烧录)
    err = _mix(base, placed, out_path, work, subs=subs, position=args.get("subtitle_position", "lower"),
               fontsdir=fontsdir)
    if err:
        return ToolResult(text=f"[ERROR] mix failed: {err}")
    qc = _qc(out_path, reel, placed)
    (out_dir / "qc.json").write_text(json.dumps(qc, ensure_ascii=False, indent=1), encoding="utf-8")
    d = _dur_of(out_path)
    status = "ok" if qc["pass"] else "qc_failed"
    return ToolResult(text=f"final: {out_path} {d:.1f}s QC {'pass' if qc['pass'] else 'FAIL '+str([k for k,v in qc['checks'].items() if not v['pass']])}",
                      data={"status": status, "output_path": str(out_path), "duration": round(d, 2), "qc": qc},
                      artifacts=[str(out_path)], video_paths=[str(out_path)])
