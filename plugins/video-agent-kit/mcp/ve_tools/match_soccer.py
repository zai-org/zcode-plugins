"""Soccer match editing kernel.

Tool arguments, shared speech, paths and artifact bindings live in match_recap.
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

from .result import ToolResult
from .match_games import _normalize_mix, filter_script_args
from .run_context import RunContext
from .subtitle_style import find_cjk_font, find_drawtext_cjk_font, drawtext_escape, ffmpeg_filter_escape, libass_fontsdir

# ---------------- 剪辑常量 (v0.7 定型) ----------------
GOAL_PRE_DEFAULT, GOAL_POST = 14, 18
CHANCE_PRE, CHANCE_POST = 9, 6
SNAP_IN_BACK, SNAP_IN_FWD = 6.0, 3.0
SNAP_OUT_BACK, SNAP_OUT_FWD = 3.0, 8.0
REPLAY_SCAN_FROM, REPLAY_SHOT_MIN, REPLAY_CAP = 12, 5.0, 50
FLASH_PRE, FLASH_POST = 2.0, 0.8
GAP_BREATH = 0.7          # 冷开场后黑场"屏息" —— 全片唯一允许的黑场(压标题卡, 不裸黑)
XFADE = 0.30              # 段间溶解时长; 两侧各多取 XFADE/2 素材, 叠化吃掉延长量 => 时间轴不变
XPAD = XFADE / 2
FREEZE = 3.2              # 末帧定格
CALL_SLOT = 4.5           # 进球呐喊句预留槽位(s)
HIGHLIGHT_HOLD = 2.5      # highlight 拍呐喊后欢呼留白(s)
EVENT_WINDOWS = ("Goal", "Penalty", "Red card", "Shots on target")

# 三档情绪: 音调恒 0(音调抬升会被听成换人), 只用语速+响度拉开
TIERS_LUFS = {0: -17.5, 1: -16.5, 2: -14.5}
CHARS_PER_SEC = {0: 4.9, 1: 5.1, 2: 5.3}

CJK_FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
]


def _font() -> str:
    # drawtext loads face 0 only: prefer a font whose first face is Simplified Chinese.
    # Keeps the find_cjk_font contract: a path, or an "[ERROR] ..." string.
    return find_drawtext_cjk_font() or find_cjk_font()


def _dur_of(p: Path | str) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "csv=p=0", str(p)], capture_output=True, text=True, stdin=subprocess.DEVNULL, check=True).stdout.strip()
    return float(out)


def _ffmpeg(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-filter_complex_threads", "1", "-threads", "2"] + args,
                          capture_output=True, text=True)


# ================================================================
# soccer_ingest
# ================================================================


# ================================================================
# soccer_arrange
# ================================================================

def _cuts_from_shots(shots_json: dict) -> list[float]:
    shots = shots_json.get("shots") or []
    cuts = [round(float(s["start"]), 3) for s in shots[1:]]
    if shots:
        cuts.append(round(float(shots[-1]["end"]), 3))
    return cuts


def _snap(t: float, cuts: list[float], back: float, fwd: float, prefer: int) -> float:
    cand = [c for c in cuts if t - back <= c <= t + fwd]
    if not cand:
        return t
    fore = [c for c in cand if (c - t) * prefer >= 0]
    return (min(fore, key=lambda c: abs(c - t)) if fore else min(cand, key=lambda c: abs(c - t)))


def _replay_end(cuts: list[float], t_event: float, max_shots: int) -> float | None:
    ends = []
    for a, b in zip(cuts, cuts[1:]):
        if a < t_event + REPLAY_SCAN_FROM:
            continue
        if a > t_event + REPLAY_CAP:
            break
        if b - a >= REPLAY_SHOT_MIN and b <= t_event + REPLAY_CAP:
            ends.append(b)
            if len(ends) >= max_shots:
                break
    return ends[-1] if ends else None


def _resolve_beat_event(b: dict, ev_by_id: dict) -> tuple[dict | None, str | None]:
    """拍事件解析: 有标注走 event_id 查 match.json;
    免标注(source=video)用内联 event{half,t,minute[,score_after,team]} —— 理解即标注。"""
    if b.get("event_id"):
        e = ev_by_id.get(b["event_id"])
        if e is None:
            return None, f"event_id {b.get('event_id')} not in match.json"
        if b.get("kind") == "goal" and e["label"] != "Goal":
            return None, f"event {e['id']} is {e['label']}, not Goal"
        if b.get("kind") == "chance" and e["label"] == "Goal":
            return None, f"kind=chance but event {e['id']} is a Goal"
        return e, None
    ev = b.get("event")
    if not isinstance(ev, dict):
        return None, "needs event_id or an inline event{half,t,minute[,score_after]}"
    if not isinstance(ev.get("half"), int) or ev["half"] < 1:
        return None, "event.half must be a positive source-part number"
    if not isinstance(ev.get("t"), (int, float)) or ev["t"] <= 0:
        return None, "event.t (second in that part's video, confirmed on frames) required"
    if not isinstance(ev.get("minute"), int):
        return None, "event.minute (match minute; add 45 in the second half) required"
    is_goal = b.get("kind") == "goal"
    if is_goal and not re.fullmatch(r"\d+-\d+", str(ev.get("score_after", ""))):
        return None, "a goal beat needs event.score_after such as '1-2' (home-away after the goal)"
    return {"id": f"B{b.get('idx')}", "label": "Goal" if is_goal else "Chance",
            "half": int(ev["half"]), "t": float(ev["t"]), "minute": int(ev["minute"]),
            "team": ev.get("team", ""), "score_after": str(ev.get("score_after", ""))}, None


def _validate_outline(outline: dict, ev_by_id: dict) -> tuple[list[str], dict]:
    issues: list[str] = []
    resolved: dict = {}
    if not outline.get("teams_cn", {}).get("home") or not outline.get("teams_cn", {}).get("away"):
        issues.append("teams_cn.home/away required (the team names shown in the score badge)")
    beats = outline.get("beats") or []
    if not beats:
        issues.append("beats is empty")
    prev_key = (-1, -1.0)
    kinds = {"open", "goal", "chance", "ending"}
    for b in beats:
        k = b.get("kind")
        if k not in kinds:
            issues.append(f"beat {b.get('idx')}: kind must be one of {sorted(kinds)}")
            continue
        if k in ("goal", "chance"):
            e, err = _resolve_beat_event(b, ev_by_id)
            if err:
                issues.append(f"beat {b.get('idx')}: {err}")
                continue
            resolved[b["idx"]] = e
            key = (e["half"], e["t"])
            if key < prev_key:
                issues.append(f"beat {b.get('idx')}: out of time order (beats must follow match time)")
            prev_key = key
            reps = b.get("replays", 1)
            if k == "goal" and reps not in (0, 1, 2):
                issues.append(f"beat {b.get('idx')}: replays must be 0/1/2")
        if k == "ending":
            for f in ("in_t", "out_t", "whistle_t"):
                if not isinstance(b.get(f), (int, float)):
                    issues.append(f"ending beat: {f} required (locate the final whistle from the commentary axis or the picture)")
    co = outline.get("cold_open") or {}
    for eid in co.get("event_ids", []):
        e = ev_by_id.get(eid)
        if e is None or e["label"] != "Goal":
            issues.append(f"cold_open: {eid} must be an existing goal event")
    for fl in co.get("flashes", []):     # 免标注: 内联快闪时刻
        if not isinstance(fl, dict) or not isinstance(fl.get("half"), int) \
                or not isinstance(fl.get("t"), (int, float)):
            issues.append("each cold_open.flashes item needs {half:1|2, t:seconds}")
    return issues, resolved


def soccer_arrange(args: dict, ctx: RunContext) -> ToolResult:
    out_dir = Path(args.get("out_dir", "out"))
    try:
        match = json.loads(Path(args["match_path"]).read_text(encoding="utf-8"))
        outline = json.loads(Path(args["outline_path"]).read_text(encoding="utf-8"))
        shots = {int(h): json.loads(Path(p).read_text(encoding="utf-8"))
                 for h, p in (args.get("shots_paths") or {}).items()}
    except KeyError as e:
        return ToolResult(text=f"[ERROR] missing arg: {e}")
    except (OSError, json.JSONDecodeError) as e:
        return ToolResult(text=f"[ERROR] cannot read input: {e}")
    if set(shots) != {int(h) for h in match["halves"]}:
        return ToolResult(text="[ERROR] shots_paths must cover every match part")

    ev_by_id = {e["id"]: e for e in match["events"]}
    issues, resolved = _validate_outline(outline, ev_by_id)
    if issues:
        return ToolResult(text="outline_invalid: " + "; ".join(issues[:5]),
                          data={"status": "outline_invalid", "issues": issues})

    cuts = {h: _cuts_from_shots(sj) for h, sj in shots.items()}
    beats = outline["beats"]

    # ---- 冷开场快闪 ----
    co = outline.get("cold_open") or {}
    pre = float(co.get("pre", FLASH_PRE))
    post = float(co.get("post", FLASH_POST))
    flashes = []
    for eid in co.get("event_ids", []):
        e = ev_by_id[eid]
        flashes.append({"event_id": eid, "half": e["half"],
                        "in": round(e["t"] - pre, 3), "out": round(e["t"] + post, 3)})
    for fl in co.get("flashes", []):     # 免标注: 内联快闪时刻
        flashes.append({"half": int(fl["half"]),
                        "in": round(float(fl["t"]) - pre, 3),
                        "out": round(float(fl["t"]) + post, 3)})
    open_dur = sum(f["out"] - f["in"] for f in flashes) + (GAP_BREATH if flashes else 0.0)

    # ---- 正片段落(每拍一段) ----
    segs = []
    score_now = "0-0"
    for b in beats:
        k = b["kind"]
        if k == "open":
            continue
        if k == "ending":
            half = int(b.get("half", max(cuts)))
            s2 = _snap(float(b["in_t"]), cuts[half], 6, 3, prefer=-1)
            segs.append({"beat": b["idx"], "kind": "end", "half": half, "tag": "FT",
                         "event_t": float(b["whistle_t"]), "in": round(s2, 3),
                         "out": round(float(b["out_t"]), 3), "score": score_now,
                         "score_pre": score_now, "minute": 90, "highlight": bool(b.get("highlight"))})
            continue
        e = resolved[b["idx"]]
        is_goal = k == "goal"
        if is_goal:
            pre_w = float(b.get("pre", GOAL_PRE_DEFAULT))
            post_w, max_rep = GOAL_POST, int(b.get("replays", 1))
        else:
            pre_w, post_w, max_rep = float(b.get("pre", CHANCE_PRE)), CHANCE_POST, 0
        s = max(0.0, e["t"] - pre_w)
        t1 = e["t"] + post_w
        c = cuts[e["half"]]
        s2 = _snap(s, c, SNAP_IN_BACK, SNAP_IN_FWD, prefer=-1)
        e2 = _snap(t1, c, SNAP_OUT_BACK, SNAP_OUT_FWD, prefer=+1)
        if is_goal:
            r = _replay_end(c, e["t"], max_rep) if max_rep else None
            if r and r > e2:
                e2 = r
        if b.get("out_t") is not None:
            e2 = float(b["out_t"])
        if b.get("in_t") is not None:
            s2 = float(b["in_t"])
        e2 = min(e2, match["halves"][str(e["half"])]["duration"])
        score_pre = score_now
        if is_goal:
            score_now = e["score_after"]
        segs.append({"beat": b["idx"], "kind": "seg", "half": e["half"],
                     "tag": "GOAL" if is_goal else "CHANCE", "event_id": e["id"],
                     "event_t": e["t"], "in": round(s2, 3), "out": round(e2, 3),
                     "score": score_now, "score_pre": score_pre, "minute": e["minute"],
                     "team": e.get("team", ""), "highlight": bool(b.get("highlight"))})
    # 同半场重叠合并 -> 直接报错让 Agent 改大纲(拍粒度合并会破坏拍-段一一对应)
    for a, b2 in zip(segs, segs[1:]):
        if a["half"] == b2["half"] and b2["in"] < a["out"] + 0.5 and a["kind"] == b2["kind"] == "seg":
            return ToolResult(
                text=f"outline_invalid: the footage windows of beat {a['beat']} and beat {b2['beat']} overlap; merge them into one beat or adjust pre",
                data={"status": "outline_invalid",
                      "issues": [f"beats {a['beat']}/{b2['beat']} overlap: "
                                 f"[{a['in']},{a['out']}] vs [{b2['in']},{b2['out']}]"]})

    # ---- 卷轴时间 + 写作简报 ----
    cur = open_dur
    for g in segs:
        g["reel_in"] = round(cur, 2)
        g["reel_event"] = round(cur + g["event_t"] - g["in"], 2)
        cur += g["out"] - g["in"]
        if g["kind"] == "end":
            cur += FREEZE
    total = round(cur, 2)

    cps = {int(k): float(v) for k, v in (args.get("chars_per_sec") or {}).items()} or CHARS_PER_SEC
    brief_beats, brief_txt = [], []
    open_beat = next((b for b in beats if b["kind"] == "open"), None)
    if open_beat is not None and flashes:
        sec = open_dur - 0.5
        brief_beats.append({"idx": open_beat["idx"], "kind": "open", "sec": round(sec, 1),
                            "budget_chars": int(sec * cps[1])})
        brief_txt.append(f"beat {open_beat['idx']} [opening] rides over {len(flashes)} flashes + black, "
                         f"room {sec:.1f}s ≈ {int(sec * cps[1])} characters (tier 1 suggested)")
    for g in segs:
        b = next(x for x in beats if x["idx"] == g["beat"])
        region_end = total if g["kind"] == "end" else None
        nxt = segs[segs.index(g) + 1]["reel_in"] if segs.index(g) + 1 < len(segs) else total - 0.9
        region_end = nxt
        buildup = g["reel_event"] - g["reel_in"] - 0.4
        post_start = g["reel_event"] + (CALL_SLOT if g["tag"] == "GOAL" else 0.0)
        if g["highlight"]:
            post_start += HIGHLIGHT_HOLD
        post = max(0.0, region_end - 0.3 - post_start)
        bb = {"idx": g["beat"], "kind": g["tag"], "reel_in": g["reel_in"],
              "reel_event": g["reel_event"], "region_end": round(region_end, 2),
              "buildup_sec": round(buildup, 1), "buildup_chars": int(buildup * cps[0]),
              "post_sec": round(post, 1), "post_chars": int(post * cps[0]),
              "highlight": g["highlight"]}
        brief_beats.append(bb)
        hl = " [highlight: stay silent after the call so the crowd is heard]" if g["highlight"] else ""
        call = f"; the {CALL_SLOT}s call slot is already deducted" if g["tag"] == "GOAL" else ""
        brief_txt.append(
            f"beat {g['beat']} [{g['tag']} {g['minute']}' {b.get('summary','')}]{hl}\n"
            f"  build-up {bb['buildup_sec']}s ≈ {bb['buildup_chars']} characters | "
            f"after the event {bb['post_sec']}s ≈ {bb['post_chars']} characters{call}\n"
            f"  a bridging sentence may start ~1.5s before the segment (J-cut over the time jump)")

    reel = {"match_path": str(args["match_path"]), "open_dur": round(open_dur, 2),
            "flashes": flashes, "segs": segs, "total": total,
            "freeze": FREEZE if any(g["kind"] == "end" for g in segs) else 0.0,
            "transition": outline.get("transition", "cut"),
            "gap_breath": GAP_BREATH if flashes else 0.0}
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "reel.json").write_text(json.dumps(reel, ensure_ascii=False, indent=1),
                                       encoding="utf-8")
    (out_dir / "writing_brief.txt").write_text(
        f"Expected cut {total:.0f}s (cold open {open_dur:.1f}s). The character count per beat is a hard "
        f"budget: up to 10% under is fine, never over.\n"
        f"The call sentence (tier 2) must sit on the event second; a bridging sentence rides over the start of "
        f"its segment; on a highlight beat stay silent for {HIGHLIGHT_HOLD}s after the call.\n\n"
        + "\n".join(brief_txt), encoding="utf-8")
    (out_dir / "brief.json").write_text(json.dumps({"beats": brief_beats, "total": total},
                                                   ensure_ascii=False, indent=1), encoding="utf-8")
    return ToolResult(
        text=(f"reel: {len(flashes)} flashes + {len(segs)} segs, expected {total:.0f}s "
              f"-> {out_dir}/reel.json + writing_brief.txt"),
        data={"status": "ok", "total_sec": total, "n_segs": len(segs),
              "reel_path": str(out_dir / "reel.json"),
              "brief_path": str(out_dir / "writing_brief.txt")},
        artifacts=[str(out_dir / "reel.json"), str(out_dir / "writing_brief.txt")])


# ================================================================
# soccer_tts
# ================================================================


# ================================================================
# soccer_render
# ================================================================

def _place(sentences: list[dict], reel: dict) -> tuple[list[dict], list[str]]:
    """摆放: 硬锚钉事件秒, 桥接句骑跨段首, 其余顺流; 返回 (placed, issues)"""
    segs = reel["segs"]
    by_beat = {g["beat"]: g for g in segs}
    bounds = [g["reel_in"] for g in segs[1:]] + [reel["total"] - 0.9]
    placed, issues = [], []
    for s in sentences:
        g = by_beat.get(s["beat"])
        anchor = s.get("anchor", "flow")
        off = float(s.get("offset", 0.0))
        if g is None:                      # open 拍: 相对卷首
            s["_planned"] = max(0.4, off)
        elif anchor == "event":
            s["_planned"] = g["reel_event"] + off
        elif anchor == "bridge":           # 骑跨: 段首前 ~1.5s 起句
            s["_planned"] = g["reel_in"] - min(1.5, s["dur"] * 0.4)
        elif anchor == "post":
            base = g["reel_event"] + off
            if g.get("highlight") and s.get("tier") != 2:
                base = max(base, g["reel_event"] + CALL_SLOT + HIGHLIGHT_HOLD)
            s["_planned"] = base
        else:                              # flow: 跟在前句后
            s["_planned"] = placed[-1]["start"] + placed[-1]["dur"] + 0.15 if placed else 0.4
        prev_end = placed[-1]["start"] + placed[-1]["dur"] if placed else 0.0
        st = max(s["_planned"], prev_end + 0.15)
        limit = next((b for b in bounds if b > s["_planned"] + 0.01), reel["total"] - 0.9) - 0.3
        if anchor == "bridge":             # 骑跨句允许越过本段边界(它就是要跨)
            limit = reel["total"] - 0.9
        over = st + s["dur"] - limit
        late = st - s["_planned"]
        if over > 0.05:
            issues.append(f"beat{s['beat']} runs {over:.2f}s past its room: {s['text'][:18]}")
        if s.get("hard") and late > 0.6:
            issues.append(f"beat{s['beat']} hard sentence pushed {late:.2f}s late: {s['text'][:18]}")
        placed.append({**s, "start": round(st, 2)})
    for s in placed:
        s.pop("_planned", None)
    return placed, issues


def _render_segments(reel: dict, match: dict, outline: dict, work: Path) -> tuple[list[dict], str | None]:
    """渲染各拼装件. 返回 pieces=[{path, D:时间轴时长, head/tail:溶解延长量}].
    段间溶解是时长守恒的: 边界两侧各多取 XPAD 秒素材, xfade 叠化正好吃掉延长量,
    因此 reel 时间轴(以及所有解说锚点)一毫米都不动."""
    font = _font()
    pad = XPAD if reel.get("transition") == "dissolve" else 0.0
    tcn = outline["teams_cn"]
    pieces: list[dict] = []
    flash_files = []
    for i, f in enumerate(reel["flashes"]):
        src = match["halves"][str(f["half"])]["video"]
        dst = work / f"flash_{i}.mp4"
        dur = f["out"] - f["in"]
        tail = pad if i == len(reel["flashes"]) - 1 else 0.0
        vf = ("scale=1280:720:force_original_aspect_ratio=decrease,"
              "pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=25")
        if i == 0 and outline.get("open_title"):
            vf += (f",drawtext=fontfile={font}:text={drawtext_escape(outline['open_title'])}:"
                   f"x=(w-text_w)/2:y=60:fontsize=34:fontcolor=white:box=1:"
                   f"boxcolor=black@0.5:boxborderw=10,fade=t=in:st=0:d=0.3")
        af = f"afade=t=in:st=0:d=0.04,afade=t=out:st={dur-0.04:.2f}:d=0.04,volume=0.85"
        r = _ffmpeg(["-ss", f"{f['in']:.3f}", "-to", f"{f['out']+tail:.3f}", "-i", src,
                     "-vf", vf, "-af", af, "-c:v", "libx264", "-crf", "20",
                     "-preset", "medium", "-pix_fmt", "yuv420p",
                     "-c:a", "aac", "-ar", "48000", "-ac", "2", str(dst)])
        if r.returncode:
            return pieces, f"flash {i}: {r.stderr[-200:]}"
        flash_files.append(dst)
    if flash_files:
        # 快闪蒙太奇内部保持硬切: 先硬拼成 open.mp4 再进溶解链
        lst = work / "open_concat.txt"
        lst.write_text("".join(f"file '{f.resolve()}'\n" for f in flash_files), encoding="utf-8")
        open_mp4 = work / "open.mp4"
        r = _ffmpeg(["-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(open_mp4)])
        if r.returncode:
            return pieces, f"open concat: {r.stderr[-200:]}"
        pieces.append({"path": open_mp4, "D": sum(f["out"] - f["in"] for f in reel["flashes"]),
                       "head": 0.0, "tail": pad})
        # 屏息黑场压标题卡 —— 不给观众裸黑屏
        gap = work / "gap.mp4"
        gc = outline.get("gap_card") or {}
        l1 = gc.get("line1") or f"{tcn['home']}  vs  {tcn['away']}"
        l2 = gc.get("line2") or outline.get("open_title", "")
        gvf = (f"drawtext=fontfile={font}:text={drawtext_escape(l1)}:x=(w-text_w)/2:y=296:"
               f"fontsize=58:fontcolor=white")
        if l2:
            gvf += (f",drawtext=fontfile={font}:text={drawtext_escape(l2)}:x=(w-text_w)/2:y=402:"
                    f"fontsize=30:fontcolor=0xcccccc")
        r = _ffmpeg(["-f", "lavfi", "-i",
                     f"color=c=black:s=1280x720:r=25:d={GAP_BREATH+2*pad:.2f}",
                     "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-shortest",
                     "-vf", gvf, "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p",
                     "-c:a", "aac", "-ar", "48000", "-ac", "2", str(gap)])
        if r.returncode:
            return pieces, f"gap card: {r.stderr[-200:]}"
        pieces.append({"path": gap, "D": GAP_BREATH, "head": pad, "tail": pad})
    for i, g in enumerate(reel["segs"]):
        src = match["halves"][str(g["half"])]["video"]
        dst = work / f"seg_{i:02d}.mp4"
        head = pad if pieces else 0.0
        tail = 0.0 if g["kind"] == "end" else pad
        ss = max(0.0, g["in"] - head)
        head = g["in"] - ss
        dur = g["out"] + tail - ss           # 素材件全长(含溶解延长量)
        vf = ("scale=1280:720:force_original_aspect_ratio=decrease,"
              "pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=25,")
        sb_box = "fontsize=26:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=10"
        if g["kind"] == "end":
            label = drawtext_escape(f"{tcn['home']} {g['score']} {tcn['away']}   FT")
            vf += f"drawtext=fontfile={font}:text={label}:x=36:y=32:{sb_box}"
        elif g["tag"] == "GOAL" and g["score_pre"] != g["score"]:
            t_rel = g["event_t"] - ss + 0.8
            for score, condition in ((g["score_pre"], "lt"), (g["score"], "gte")):
                label = drawtext_escape(f"{tcn['home']} {score} {tcn['away']}   {g['minute']}'")
                vf += (f"drawtext=fontfile={font}:text={label}:x=36:y=32:{sb_box}:"
                       f"enable='{condition}(t,{t_rel:.2f})',")
            vf = vf.rstrip(",")
        else:
            label = drawtext_escape(f"{tcn['home']} {g['score']} {tcn['away']}   {g['minute']}'")
            vf += f"drawtext=fontfile={font}:text={label}:x=36:y=32:{sb_box}"
        af = None                            # 段间淡入淡出交给拼装图的溶解, 不在件内做
        if g["kind"] == "end":
            ec = outline.get("end_card") or {}
            fz = reel.get("freeze", FREEZE)
            vf += f",tpad=stop_mode=clone:stop_duration={fz}"
            if ec.get("line1"):
                vf += (f",drawtext=fontfile={font}:text={drawtext_escape(ec['line1'])}:x=(w-text_w)/2:y=280:"
                       f"fontsize=64:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=18:"
                       f"enable=gte(t\\,{dur+0.3:.2f})")
            if ec.get("line2"):
                vf += (f",drawtext=fontfile={font}:text={drawtext_escape(ec['line2'])}:x=(w-text_w)/2:y=390:"
                       f"fontsize=36:fontcolor=0xdddddd:box=1:boxcolor=black@0.55:boxborderw=12:"
                       f"enable=gte(t\\,{dur+0.6:.2f})")
            vf += f",fade=t=out:st={dur+fz-0.9:.2f}:d=0.9"
            af = f"apad=pad_dur={fz},afade=t=out:st={dur+fz-1.5:.2f}:d=1.5"
        cmd = ["-ss", f"{ss:.3f}", "-to", f"{g['out']+tail:.3f}", "-i", src, "-vf", vf]
        if af:
            cmd += ["-af", af]
        cmd += ["-c:v", "libx264", "-crf", "20", "-preset", "medium", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-ar", "48000", "-ac", "2", str(dst)]
        r = _ffmpeg(cmd)
        if r.returncode:
            return pieces, f"seg {i}: {r.stderr[-300:]}"
        D = (g["out"] - g["in"]) + (reel.get("freeze", FREEZE) if g["kind"] == "end" else 0.0)
        pieces.append({"path": dst, "D": D, "head": head, "tail": tail})
    return pieces, None


def _write_ass(placed: list[dict], path: Path, position="lower") -> None:
    """解说字幕轨: 底部居中白字黑边, 按摆放时刻逐句显示, 不与下一句重叠"""
    def ts(t: float) -> str:
        t = max(0.0, t)
        return f"{int(t // 3600)}:{int(t % 3600 // 60):02d}:{t % 60:05.2f}"
    lines = [
        "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1280", "PlayResY: 720",
        "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
        "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
        "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: N,Noto Sans CJK SC,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H7F000000,"
        "1,0,0,0,100,100,0,0,1,2,0.8,2,60,60,34,1",
        "", "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    for i, s in enumerate(placed):
        st = s["start"]
        en = st + s["dur"] + 0.3
        if i + 1 < len(placed):
            en = min(en, placed[i + 1]["start"] - 0.05)
        en = max(en, st + 0.5)
        txt = s["text"].replace("\n", " ").replace("{", "(").replace("}", ")")
        lines.append(f"Dialogue: 0,{ts(st)},{ts(en)},N,,0,0,0,,{txt}")
    content = "\n".join(lines) + "\n"
    alignment = {"top": 8, "middle": 5, "lower": 2, "bottom": 2}[position]
    content = content.replace("1,2,0.8,2,60,60,34,1", f"1,2,0.8,{alignment},60,60,34,1")
    path.write_text(content, encoding="utf-8")


def _assemble(pieces: list[dict], base: Path, ass_path: Path | None, work: Path,
              fontsdir: str | None = None) -> str | None:
    """溶解拼装: 视频链式 xfade(offset 按时间轴推算, 延长量正好被叠化吃掉);
    音频不用 acrossfade(逐段拼会累积时长漂移), 而是各件按时间轴 adelay 精确摆放 +
    边界 XFADE 淡入淡出, amix 叠加 == 交叉淡化且采样级对齐. 字幕(如有)在此一次性烧录."""
    n = len(pieces)
    parts = [f"[{k}:v]settb=AVTB,fps=25[v{k}]" for k in range(n)]
    cur, acc = "v0", pieces[0]["D"]
    for k in range(1, n):
        xf = pieces[k - 1]["tail"] + pieces[k]["head"]
        if xf:
            parts.append(f"[{cur}][v{k}]xfade=transition=fade:duration={xf:.2f}:"
                         f"offset={acc - pieces[k]['head']:.3f}[vx{k}]")
        else:
            parts.append(f"[{cur}][v{k}]concat=n=2:v=1:a=0[vx{k}]")
        cur = f"vx{k}"
        acc += pieces[k]["D"]
    if ass_path:
        ass_opts = f"filename={ffmpeg_filter_escape(str(ass_path))}"
        if fontsdir:                     # 让 libass 看到 VE_FONT_DIRS 选中的字体目录
            ass_opts += f":fontsdir={ffmpeg_filter_escape(fontsdir)}"
        parts.append(f"[{cur}]ass={ass_opts}[vout]")
        cur = "vout"
    t_axis, ains = 0.0, ""
    for k, p in enumerate(pieces):
        ext = p["D"] + p["head"] + p["tail"]
        chain = []
        if p["head"] > 0:
            chain.append(f"afade=t=in:st=0:d={XFADE:.2f}")
        if p["tail"] > 0:
            chain.append(f"afade=t=out:st={ext - XFADE:.2f}:d={XFADE:.2f}")
        ms = int(round((t_axis - p["head"]) * 1000))
        if ms > 0:
            chain.append(f"adelay={ms}|{ms}")
        parts.append(f"[{k}:a]{','.join(chain) if chain else 'anull'}[a{k}]")
        ains += f"[a{k}]"
        t_axis += p["D"]
    parts.append(f"{ains}amix=inputs={n}:duration=longest:normalize=0[aout]")
    fscript = work / "assemble_filter.txt"
    fscript.write_text(";".join(parts), encoding="utf-8")
    cmd = []
    for p in pieces:
        cmd += ["-i", str(p["path"])]
    cmd += [*filter_script_args(fscript), "-map", f"[{cur}]", "-map", "[aout]",
            "-c:v", "libx264", "-crf", "19", "-preset", "medium", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-ar", "48000", "-ac", "2", str(base)]
    r = _ffmpeg(cmd)
    return r.stderr[-300:] if r.returncode else None


def _mix(base: Path, placed: list[dict], duck_iv: list[list[float]], out_path: Path,
         work: Path) -> str | None:
    dists = [f"max(max({a:.2f}-t\\,t-{b:.2f})\\,0)" for a, b in duck_iv]
    expr = dists[0]
    for d in dists[1:]:
        expr = f"min({expr}\\,{d})"
    vol = f"volume='0.3+0.7*min(1\\,({expr})/0.4)':eval=frame"
    parts, amixin = [f"[0:a]{vol}[bg]"], "[bg]"
    for k, s in enumerate(placed):
        ms = int(round(s["start"] * 1000))
        parts.append(f"[{k+1}:a]adelay={ms}|{ms}[n{k}]")
        amixin += f"[n{k}]"
    parts.append(f"{amixin}amix=inputs={len(placed)+1}:duration=first:normalize=0,"
                 f"acompressor=threshold=0.12:ratio=2:attack=200:release=900:makeup=2[out]")
    fscript = work / "mix_filter.txt"
    fscript.write_text(";".join(parts), encoding="utf-8")
    cmd = ["-i", str(base)]
    for s in placed:
        cmd += ["-i", s["audio"]]
    cmd += [*filter_script_args(fscript), "-map", "0:v", "-map", "[out]",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", str(out_path)]
    r = _ffmpeg(cmd)
    return r.stderr[-300:] if r.returncode else _normalize_mix(out_path, work)


def _qc_gates(final: Path, reel: dict, placed: list[dict]) -> dict:
    qc = {"pass": True, "checks": {}}
    # 1. 黑场唯一性: 只允许冷开场后的 GAP_BREATH 一处
    r = subprocess.run(["ffmpeg", "-nostdin", "-i", str(final), "-vf",
                        "blackdetect=d=0.2:pix_th=0.10", "-an", "-f", "null", "-"],
                       capture_output=True, text=True)
    blacks = re.findall(r"black_start:([\d.]+) black_end:([\d.]+)", r.stderr)
    gap_start = reel["open_dur"] - reel.get("gap_breath", 0.0)
    unexpected = [(a, b) for a, b in blacks
                  if not (abs(float(a) - gap_start) < 1.0)
                  and float(a) < reel["total"] - 3.0]
    qc["checks"]["blackdetect"] = {"pass": r.returncode == 0 and not unexpected, "found": blacks,
                                   "unexpected": unexpected}
    # 2. 硬锚零偏: 摆放层已校验, 复核落盘值
    hard_bad = [{"text": s["text"][:16], "start": s["start"]}
                for s in placed if s.get("hard") and s.get("anchor") == "event"
                and abs(s["start"] - next((g["reel_event"] + float(s.get("offset", 0))
                                           for g in reel["segs"] if g["beat"] == s["beat"]), 0)) > 1.0]
    qc["checks"]["hard_anchor"] = {"pass": not hard_bad, "bad": hard_bad}
    # 3. 响度
    r = subprocess.run(["ffmpeg", "-nostdin", "-i", str(final), "-af",
                        "loudnorm=print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True)
    m = re.search(r"\{[^{}]+\}", r.stderr[-2000:], re.S)
    lufs = float(json.loads(m.group())["input_i"]) if m else None
    qc["checks"]["loudness"] = {"pass": lufs is not None and -19.5 <= lufs <= -12.5,
                                "input_i": lufs}
    # 4. 时长
    d = _dur_of(final)
    qc["checks"]["duration"] = {"pass": abs(d - reel["total"]) < 2.0,
                                "final": round(d, 2), "reel": reel["total"]}
    qc["pass"] = all(c["pass"] for c in qc["checks"].values())
    return qc


def soccer_render(args: dict, ctx: RunContext) -> ToolResult:
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
    work = out_dir / "render_work"
    work.mkdir(parents=True, exist_ok=True)

    # ---- 摆放(先于渲染: over_budget 时不浪费渲染) ----
    placed, issues = _place(stts["sentences"], reel)
    (out_dir / "placement.json").write_text(json.dumps(placed, ensure_ascii=False, indent=1),
                                            encoding="utf-8")
    if issues:
        return ToolResult(text="over_budget: " + "; ".join(issues[:4]),
                          data={"status": "over_budget", "issues": issues,
                                "hint": "shorten the narration of those beats (cut modifiers, keep the facts), then rerun synthesize_narration(mode=match) and video_render(kind=match)"})

    # ---- 字体: 先查后用, 找不到直接报错(find_cjk_font 返回 "[ERROR] ..." 串), 不进滤镜图 ----
    font = _font()
    if font.startswith("[ERROR]"):
        return ToolResult(text=font, is_error=True, data={"status": "font_missing"})
    fontsdir = libass_fontsdir(font)   # 系统字体目录太大, 只把选中的字体链接进私有目录喂 libass

    # ---- 渲染底版: 各件 -> 溶解拼装(+字幕烧录) ----
    pieces, err = _render_segments(reel, match, outline, work)
    if err:
        return ToolResult(text=f"[ERROR] render failed: {err}")
    ass_path = None
    if args.get("subtitles", True):
        ass_path = (work / "subs.ass").resolve()
        _write_ass(placed, ass_path, args.get("subtitle_position", "lower"))
    base = work / "base.mp4"
    err = _assemble(pieces, base, ass_path, work, fontsdir)
    if err:
        return ToolResult(text=f"[ERROR] assemble failed: {err}")

    # ---- 压音区间: 底版转录区间(可选) ∪ 中文句区间 ----
    iv = [(s["start"], s["start"] + s["dur"]) for s in placed]
    tr_path = args.get("base_transcript_path")
    if tr_path and Path(tr_path).exists():
        tr = json.loads(Path(tr_path).read_text(encoding="utf-8"))
        iv += [(t["start"], t["end"]) for t in tr.get("segments", [])]
    iv = sorted((max(0.0, a - 0.2), b + 0.2) for a, b in iv)
    duck = []
    for a, b in iv:
        if duck and a - duck[-1][1] < 0.7:
            duck[-1][1] = max(duck[-1][1], b)
        else:
            duck.append([a, b])
    err = _mix(base, placed, duck, out_path, work)
    if err:
        return ToolResult(text=f"[ERROR] mix failed: {err}")

    # ---- QC 硬门 ----
    qc = _qc_gates(out_path, reel, placed)
    (out_dir / "qc.json").write_text(json.dumps(qc, ensure_ascii=False, indent=1),
                                     encoding="utf-8")
    if not qc["pass"]:
        bad = [k for k, v in qc["checks"].items() if not v["pass"]]
        return ToolResult(text=f"qc_failed: {bad} (the cut was rendered but did not pass; see qc.json)",
                          data={"status": "qc_failed", "qc": qc,
                                "output_path": str(out_path)})
    d = _dur_of(out_path)
    return ToolResult(
        text=(f"final: {out_path}  {d:.1f}s  "
              f"LUFS {qc['checks']['loudness']['input_i']}  QC all pass"),
        data={"status": "ok", "output_path": str(out_path), "duration": round(d, 2),
              "qc": qc, "n_duck_intervals": len(duck)},
        artifacts=[str(out_path)], video_paths=[str(out_path)])
