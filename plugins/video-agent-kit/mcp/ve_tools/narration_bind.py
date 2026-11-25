"""narration_bind: 磁带 DP 句画绑定内核 + 卷模式(移植自 movie_cut,逐行保真)。

来源(movie_cut/pipeline):
- step_event_bind.py     — 常量/SelectionState/句切分/原声穿插/audit_edl 硬质检
- step_event_bind_dp.py  — 磁带 DP 内核(_group_rows/_record/_solve_segment/_emit_windows)
- step_event_bind_reel.py— 卷模式(_reel_tape/_emit_tail/装配循环),kit 只支持卷模式

磁带模型:可用画面按原片顺序铺成一条只进不退的磁带;每个句组的决策 =
"快进到哪 + 从那里录多长"。零重复/时间单调由构造保证;锚优先/跳切代价/
短闪禁令/停留 = 一个打分函数。卷模式下每段磁带 = 该拍卷 spans,余量变呼吸留白。

纯确定性:无任何 LLM 调用;不 print,统计进 ToolResult。
"""
from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

from .result import ToolResult
from .run_context import RunContext

# ---- 常量(与 movie_cut 逐字一致) --------------------------------------
SCHEMA_VERSION = "3.0"            # step_event_bind(原声条目沿用)
REEL_SCHEMA_VERSION = "3.2-reel"  # step_event_bind_reel(旁白条目)
DEFAULT_FPS = 24.0
MIN_WINDOW_SEC = 1.25
# 历史上有过 1.6(首选)/1.25(硬底线) 两级窗口下限,后统一为 1.25 单级;
# 两常量保留同值只为 audit 与 DP 引用点不动,改窗口下限须两处一起改。
HARD_MIN_WINDOW_SEC = 1.25
# 剪辑呼吸感(batch6):真人解说 10~14 切/分钟、敢停 8~10 秒。
MAX_WINDOW_SEC = 9.0        # 单窗口上限:长镜头能扛整句甚至多句
LINGER_MAX_SEC = 10.0       # 同一镜头连续停留上限(再长会闷)
MERGE_UNIT_SEC = 2.4        # 短于此的句子并入邻句共用画面(不再每句强制切一刀)
MERGE_GROUP_CAP_SEC = 7.0   # 软并组后的组预算上限(防整段滚雪球丢失锚精度)

TAIL_MAX_SEC = 3.0     # 高光拍呼吸留白上限(原声透出)
TAIL_PLAIN_SEC = 2.0   # 普通拍呼吸留白上限——"解说完停一停,让原片自己响一会"
                       # 是真人解说的节奏本体;v5 全片仅高光拍留白,10 分钟
                       # 96% 时间在说话,用户实听"很急"。留白是标点:每拍都要,
                       # 高光拍更长。
TAIL_LINE_EXT_SEC = 1.5  # 留白切点撞上台词时, 为念完这句最多再延长的秒数
                         # ——"台词必须说完才切"(8-26 用户定案), 延长不够就
                         # 回退到这句台词开始前收刀, 宁可留白短也不掐半句。
TAIL_MIN_SEC = 0.5     # 比这短的余量不值得留(直接截掉)

# ---- DP 打分(每秒画面价值 / 每次动作代价) ------------------------------
V_ANCHOR = 30.0        # 写作者点名要骑的镜头
V_CLAIM = 15.0         # 事实引用的镜头
V_EVENT = 6.0          # 事件证据/候选池
V_NEAR = 1.2           # 事件区间附近(低价值:宁可跳向事件画面,别骑无关画面混时长)
V_FAR = 0.1            # 远处画面(几乎零价值——回看抽查证实骑无关画面=句画矛盾)
JUMP_PENALTY = 7.0     # 一次跳切的代价(跳向事件/锚镜头时由画面收益覆盖)
SEAM_BONUS = 2.0       # 帧连续过渡(原片自己的剪辑点)奖励
MAX_LANDINGS = 14      # 每个句组考察的落点数上限(前方区间起点)
FRAME_GAP_TOL = 2      # "帧连续"判定容差(帧): DP接缝/审计/留白必须用同一个值,
                       # 任何一处单改都会造成 seamless 与 QC 判定分裂(假阳性短闪)
V_AVOID = -4.0         # 回看判定"句画矛盾"的 (句,镜头) 组合:主动回避

# ---- J/L-cut 声画错开切(v3):出刀点吸附镜头边界,借还记账 ----------------
# 病根:句组预算帧一用完就地停刀(常在镜头半截),下一组跳走 = 半截出刀 +
# 声画同点切,观感"闪一下"。人类剪辑的标配是 J/L-cut:声音切点在句边界,
# 画面切点在镜头边界,两者刻意错开零点几秒。
SNAP_EXIT_SEC = 1.2        # 出刀点离磁带区间尾 ≤ 此值就播完该区间再跳(J-cut),
                           # 多占的帧记为 drift,从下一句组预算里扣(借还)
KEY_MAX_DRIFT_SEC = 0.35   # 锚句(写手点名镜头的关键句)画面入场最大容忍延迟:
                           # J-cut 不许压过关键句的"说到即看到"
MIDSHOT_EXIT_PENALTY = 4.0  # 半截出刀又跳切:在 JUMP_PENALTY 之外的额外罚分,
                            # 推动 DP 优先选吸附出刀/顺播,而不是句号处硬剁
MIN_RUN_SEC = 2.0          # 碎片禁令:两次跳切之间的连续播放段 <2s 即"闪",
                           # DP 直接判不可行(1.25 仍是 audit 硬底线;段级无解
                           # 时回退 1.25 兜底,宁可偶闪不可缺画面)


# ---- 辅助(移植自 common.py / event_common.py) --------------------------

def load_json(path: str | Path) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(obj: Any, path: str | Path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def save_audited_edl(edl: list[dict], report: dict, out_path: Path, qc_path: Path) -> None:
    """Persist the exact EDL inspected by this passing audit, then bind its report."""
    import hashlib
    if report.get("status") != "passed":
        raise ValueError("Cannot save an EDL with a failing audit")
    save_json(edl, out_path)
    report["edl_sha256"] = hashlib.sha256(out_path.read_bytes()).hexdigest()
    save_json(report, qc_path)


def overlap_seconds(a0: float, a1: float, b0: float, b1: float) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


EMOTIONS = {"sad", "tense", "warm", "epic", "happy", "neutral"}

_EMOTION_ALIASES = {
    "悲伤": "sad", "伤感": "sad", "痛心": "sad", "心疼": "sad",
    "沉重": "sad", "绝望": "sad", "无奈": "sad", "怅然": "sad",
    "隐忍": "sad", "残酷": "sad",
    "紧张": "tense", "悬疑": "tense", "诡异": "tense", "惊悚": "tense",
    "压抑": "tense", "恐惧": "tense", "压迫": "tense", "不安": "tense",
    "警觉": "tense", "惊惧": "tense", "无助": "tense", "恐怖": "tense",
    "焦灼": "tense", "失控": "tense", "狂躁": "tense", "阴冷": "tense",
    "戒备": "tense", "紧迫": "tense", "窒息": "tense", "惊恐": "tense",
    "冷酷": "tense",
    "温暖": "warm", "温情": "warm", "感动": "warm", "克制": "warm",
    "开心": "happy", "快乐": "happy", "轻松": "happy", "期待": "happy",
    "激烈": "epic", "史诗": "epic", "推进": "epic", "关键": "epic",
    "释放": "epic", "坚决": "epic", "振奋": "epic",
    "平静": "neutral", "中性": "neutral", "警醒": "neutral",
}


def normalize_emotion(value: Any) -> str:
    """把模型常见的中英文自由输出收敛到六个稳定枚举。"""
    s = str(value or "neutral").strip().lower()
    if s in EMOTIONS:
        return s
    if s in _EMOTION_ALIASES:
        return _EMOTION_ALIASES[s]
    for key, val in _EMOTION_ALIASES.items():
        if key in s:
            return val
    for val in EMOTIONS:
        if val in s:
            return val
    return "neutral"


# ---- step_event_bind.py 内核部分 ---------------------------------------

class FootageShortageError(RuntimeError):
    """唯一合法画面不足；调用方应改写文案，而不是循环画面。"""

    def __init__(self, shortage: dict):
        self.shortage = shortage
        super().__init__(shortage_message(shortage))


def shortage_message(s: dict) -> str:
    """缺料文案唯一出处。两种病因话术分开: 总量真不够 vs 有量但约束下无解
    (最短连续段/禁未来镜头/落点规则) — 后者写"只有0.0s"会误导排障。"""
    head = (f"{s.get('seg_id', '')}/{s.get('semantic_unit_id', '')}: "
            f"需要{s.get('required_sec', 0):.1f}s")
    if s.get("reason") == "no_feasible_path":
        return (f"{head},磁带尚余{s.get('available_sec', 0):.1f}s但受"
                f"最短连续段/时间上限约束拼不出可行路径(缩短该句或放宽卷)")
    return f"{head},只有{s.get('available_sec', 0):.1f}s不重复画面"


class SelectionState:
    def __init__(self, fps: float = DEFAULT_FPS) -> None:
        self.fps = fps
        self.cursor_frame = 0
        self.used_shots: set[str] = set()
        self.intervals: list[tuple[int, int, str]] = []

    def occupy(self, shot_id: str, start_frame: int, end_frame: int) -> None:
        # 同一镜头的"顺延"合法：紧接上一窗口的连续帧(画面不切、不重复)。
        contiguous = bool(self.intervals and self.intervals[-1][2] == shot_id and
                          start_frame == self.intervals[-1][1])
        if shot_id in self.used_shots and not contiguous:
            raise AssertionError(f"镜头重复使用: {shot_id}")
        if start_frame < self.cursor_frame:
            raise AssertionError(
                f"原片时间倒退: {start_frame} < {self.cursor_frame} ({shot_id})")
        if end_frame <= start_frame:
            raise AssertionError(f"空镜头区间: {shot_id}")
        if self.intervals and start_frame < self.intervals[-1][1]:
            raise AssertionError(f"原片帧重叠: {shot_id}")
        self.used_shots.add(shot_id)
        self.intervals.append((start_frame, end_frame, shot_id))
        self.cursor_frame = end_frame

    def occupy_run(self, shot_id: str, start_frame: int, end_frame: int) -> None:
        """原声穿插专用:占用连续原片区间,允许"回到旁白已用镜头的后续帧"。

        原声窗口是电影自己的完整时刻(台词原声),它接着旁白讲过的场景继续放,
        视觉上等价于顺延;帧级不重叠、时间单调仍然强制。"""
        if start_frame < self.cursor_frame:
            raise AssertionError(
                f"原声区间时间倒退: {start_frame} < {self.cursor_frame} ({shot_id})")
        if end_frame <= start_frame:
            raise AssertionError(f"空原声区间: {shot_id}")
        if self.intervals and start_frame < self.intervals[-1][1]:
            raise AssertionError(f"原声区间帧重叠: {shot_id}")
        self.used_shots.add(shot_id)
        self.intervals.append((start_frame, end_frame, shot_id))
        self.cursor_frame = end_frame


def _semantic_slices(seg: dict, audio_dur: float) -> list[dict]:
    """把句界归一到真实口播时长；段尾呼吸留白不强行塞进最后一句。"""
    sentences = [x for x in seg.get("sentences", []) if isinstance(x, dict) and
                 float(x.get("end", 0)) > float(x.get("start", 0))]
    if not sentences:
        return [{"semantic_unit_id": f"{seg.get('seg_id', 'seg')}_u01",
                 "text": seg.get("text", ""), "start": 0.0, "end": audio_dur,
                 "event_ids": seg.get("event_ids", []), "claim_ids": [],
                 "anchor_shot_ids": []}]
    speech_dur = min(audio_dur, max(0.001, float(seg.get("speech_dur", audio_dur) or audio_dur)))
    raw_durations = [float(x["end"]) - float(x["start"]) for x in sentences]
    scale = speech_dur / max(0.001, sum(raw_durations))
    out, cursor = [], 0.0
    for idx, (sentence, raw_dur) in enumerate(zip(sentences, raw_durations), 1):
        end = speech_dur if idx == len(sentences) else cursor + raw_dur * scale
        out.append({**sentence,
                    "semantic_unit_id": sentence.get(
                        "semantic_unit_id", f"{seg.get('seg_id', 'seg')}_u{idx:02d}"),
                    "start": cursor, "end": end})
        cursor = end
    return out


def _split_range(start_sec: float, end_sec: float, shots: list[dict],
                 fps: float, start_floor_frame: int = 0) -> list[dict] | None:
    """把一段原片连续区间按镜头边界拆成记账窗口;区间内没有切点。"""
    start_f = max(start_floor_frame, int(math.ceil(start_sec * fps - 1e-7)))
    end_f = int(math.floor(end_sec * fps + 1e-7))
    if (end_f - start_f) / fps < 1.5:
        return None
    pieces = []
    for s in shots:
        sf = max(start_f, int(math.ceil(float(s["start"]) * fps - 1e-7)))
        ef = min(end_f, int(math.floor(float(s["end"]) * fps + 1e-7)))
        if ef > sf:
            pieces.append({"start_frame": sf, "end_frame": ef,
                           "start": round(sf / fps, 6), "end": round(ef / fps, 6),
                           "shot_id": s["shot_id"], "original_audio": True})
    if not pieces:
        return None
    pieces.sort(key=lambda p: p["start_frame"])
    # 镜头边界的 ceil/floor 取整会留出 1~2 帧的记账缝隙(同一时刻两侧各取整一次);
    # 原片本身连续,桥接即可。只有真正的时间轴窟窿(>2帧)才放弃这处插入。
    for a, b in zip(pieces, pieces[1:]):
        gap = b["start_frame"] - a["end_frame"]
        if gap > 2:
            return None
        if gap > 0:
            a["end_frame"] = b["start_frame"]
            a["end"] = round(a["end_frame"] / fps, 6)
    return pieces


def _oa_entry(insert: dict, seg: dict, pieces: list[dict], fps: float,
              replay: bool) -> dict:
    span_start = pieces[0]["start"]
    dur = round((pieces[-1]["end_frame"] - pieces[0]["start_frame"]) / fps, 6)
    if replay:
        for p in pieces:
            p["replay"] = True
    return {"schema_version": SCHEMA_VERSION,
            "seg_id": f"{seg['seg_id']}_oa",
            "original_audio": True, "replay": replay,
            # 画面使用规则显式分层:主画面全局零重复;原声画面允许有限重用,
            # 必须显式声明重用类型与豁免项,QC 按声明豁免而不是靠分支猜规则。
            "reuse_type": ("original_audio_replay" if replay
                           else "original_audio_reserved"),
            "exemptions": (["global_no_repeat", "monotonic_time", "min_window"]
                           if replay else ["shot_reuse_contiguous", "min_window"]),
            "event_ids": list(seg.get("event_ids", [])),
            "text": " / ".join(x.get("text", "") for x in insert.get("lines", [])),
            "emotion": normalize_emotion(seg.get("emotion")),
            "audio_path": None, "audio_dur": dur,
            "windows": pieces,
            "semantic_map": [],
            "shot_ids": [f"{p['start']:.6f}-{p['end']:.6f}" for p in pieces],
            "video_dur": dur, "speed": 1.0,
            "bgm_track": None, "duck": False, "tail_sec": 0.0,
            "story_scene_id": seg.get("story_scene_id", ""),
            "subtitle_lines": [
                {"start": round(max(0.0, float(x["start"]) - span_start), 3),
                 "end": round(min(dur, float(x["end"]) - span_start), 3),
                 "text": x.get("text", "")}
                for x in insert.get("lines", [])
                if float(x["end"]) - span_start > 0.2]}


def _occupy_original(insert: dict, seg: dict, shots: list[dict],
                     state: SelectionState, used: dict[str, int]) -> dict | None:
    """预留模式:把一处原声穿插占进单调帧流(画面不重复),返回 EDL 条目。

    原声是原片的一段连续区间;帧级不重叠、时间单调与旁白窗口共用同一套账本。
    游标已越过太多时返回 None,由调用方降级为回放模式。
    """
    pieces = _split_range(float(insert["start"]), float(insert["end"]),
                          shots, state.fps, start_floor_frame=state.cursor_frame)
    if pieces is None:
        return None
    for p in pieces:
        state.occupy_run(p["shot_id"], p["start_frame"], p["end_frame"])
        used[p["shot_id"]] += 1
    return _oa_entry(insert, seg, pieces, state.fps, replay=False)


def _replay_original(insert: dict, seg: dict, shots: list[dict],
                     fps: float) -> dict | None:
    """回放模式:关键台词时刻的画面带原声重放一遍,不占旁白画面账本。

    真人解说的标准手法——讲完这场戏,把那句台词的原声镜头再放一遍。
    这是**有意的重放**,不是凑时长:窗口带 replay 标记,质检对其豁免
    重复/倒带(旁白画面的零重复门禁完全不受影响)。
    """
    pieces = _split_range(float(insert["start"]), float(insert["end"]), shots, fps)
    if pieces is None:
        return None
    return _oa_entry(insert, seg, pieces, fps, replay=True)


def audit_edl(edl: list[dict], fps: float = DEFAULT_FPS,
              min_window_sec: float = MIN_WINDOW_SEC, *,
              source_edit_proof: dict | None = None, source_clock: dict | None = None) -> dict:
    """渲染前硬门禁：任何重复、重叠、倒退或无意碎片都不放行。"""
    from .source_usage import audit_usage, declares_proof
    if source_edit_proof is not None or declares_proof(edl):
        return {'schema_version': SCHEMA_VERSION,
                **audit_usage(edl, fps, min_window_sec, source_edit_proof=source_edit_proof,
                              source_clock=source_clock, frame_gap_tol=FRAME_GAP_TOL)}
    seen_shots, intervals = set(), []
    duplicate_shots, overlaps, regressions, short_windows, reused = [], [], [], [], []
    previous_end = -1
    previous_sid = ""
    for entry in edl:
        is_oa = bool(entry.get("original_audio"))
        for window in entry.get("windows", []):
            if window.get("replay") or window.get("cold_open"):
                # 原声回放窗口:有意重放关键台词时刻(带原声),在旁白画面
                # 账本之外,不参与重复/倒带/重叠判定,也不推进时间基。
                # 冷开场窗口同理:高潮前置钩子,画面届时在正片高潮重演,
                # 段内单调性已由 bind 的临时账本把关。
                continue
            sid = window.get("shot_id", "")
            start = int(window.get("start_frame", round(float(window["start"]) * fps)))
            end = int(window.get("end_frame", round(float(window["end"]) * fps)))
            row = {"seg_id": entry.get("seg_id"), "shot_id": sid,
                   "start_frame": start, "end_frame": end}
            contiguous = sid == previous_sid and start == previous_end
            # 帧连续但换镜头 = 原片自己的剪辑点(续播路径),不是跳切。
            # 镜头边界 ceil/floor 取整会留 1~2 帧缝(≈83ms,不可感),视为连续。
            seamless = 0 <= start - previous_end <= FRAME_GAP_TOL
            # 原声窗口是原片连续区间按镜头边界的记账拆分:区间内无切点,
            # "回到已用镜头的后续帧"视觉上等价于顺延——豁免重复与短闪判定,
            # 帧重叠与时间倒退仍严格检查。
            if sid in seen_shots and not contiguous and not is_oa:
                duplicate_shots.append(row)
            if start < previous_end:
                overlaps.append(row)
                regressions.append(row)
            if window.get("reused"):
                reused.append(row)
            if (end - start) / fps + 1e-6 < min_window_sec and \
                    float(entry.get("audio_dur", 0)) >= min_window_sec and \
                    not seamless and not is_oa:  # 帧连续窗口(顺延/续播)无跳切点,短不算闪。
                short_windows.append(row)
            seen_shots.add(sid)
            intervals.append((start, end, sid))
            previous_end = max(previous_end, end)
            previous_sid = sid
    # 剪辑节奏指标(信息性,不做门禁):帧连续的窗口(同镜头顺延/跨镜头续播)
    # 合并成"连续播放段"再统计——跳切才是观感上的"闪",原片自带切点不算。
    dwells, run = [], None
    for start, end, sid in intervals:
        if run and 0 <= start - run[1] <= FRAME_GAP_TOL:
            run = (run[0], end, sid)
        else:
            if run:
                dwells.append((run[1] - run[0]) / fps)
            run = (start, end, sid)
    if run:
        dwells.append((run[1] - run[0]) / fps)
    total_sec = sum(dwells)
    rhythm = {
        "n_cuts": len(dwells),
        "cuts_per_min": round(len(dwells) / (total_sec / 60), 1) if total_sec else 0,
        "avg_dwell_sec": round(total_sec / len(dwells), 2) if dwells else 0,
        "pct_under_2s": round(sum(1 for d in dwells if d < 2) / len(dwells), 2)
        if dwells else 0,
        "pct_over_5s": round(sum(1 for d in dwells if d > 5) / len(dwells), 2)
        if dwells else 0,
    }
    report = {
        "schema_version": SCHEMA_VERSION,
        "status": "passed" if not any((duplicate_shots, overlaps, regressions,
                                         short_windows, reused)) else "failed",
        "n_segments": len(edl), "n_windows": len(intervals),
        "rhythm": rhythm,
        "duplicate_shots": duplicate_shots,
        "overlapping_source_frames": overlaps,
        "source_time_regressions": regressions,
        "too_short_windows": short_windows,
        "explicit_reuse": reused,
        "unique_source_frames": sum(end - start for start, end, _ in intervals),
        "fps": fps,
    }
    return report


def _blame_insert(fail_seg_id: str, segs: list[dict],
                  inserts_by_seg: dict[str, dict],
                  replay_segs: set[str]) -> str | None:
    """画面短缺时归因:找失败段上游最近、还处于预留模式的原声插入点。

    预留模式会掐住旁白的选镜上限并推进全局游标,是短缺的头号嫌疑人;
    把它降级为回放模式后整体重绑。找不到嫌疑人才把短缺交给改稿闭环。
    """
    order = {s["seg_id"]: i for i, s in enumerate(segs)}
    fail_order = order.get(fail_seg_id, float("inf"))
    candidates = [sid for sid in inserts_by_seg
                  if sid not in replay_segs and order.get(sid, 0) <= fail_order]
    return max(candidates, key=lambda sid: order.get(sid, 0), default=None)


# ---- step_event_bind_dp.py 磁带 DP 内核 ---------------------------------

def _group_rows(seg: dict, evs: list[dict], all_events: dict[str, dict],
                audio_dur: float, fps: float,
                min_frames: int) -> list[dict]:
    """句子→句组(预算/锚/claim镜头/事件池),软并组规则与贪心内核一致。"""
    claims = {c.get("claim_id"): (event, c) for event in evs
              for c in event.get("claims", []) if c.get("claim_id")}
    units = _semantic_slices(seg, audio_dur)
    target_frames = max(1, int(math.ceil(audio_dur * fps - 1e-7)))
    unit_rows = []
    for unit in units:
        claim_ids = [x for x in unit.get("claim_ids", []) if x in claims]
        requested = (list(dict.fromkeys(
            claims[cid][0]["event_id"] for cid in claim_ids)) or
            unit.get("event_ids", []) or seg.get("event_ids", []))
        unit_events = [all_events[x] for x in requested if x in all_events] or evs
        unit_rows.append({
            "unit": unit, "claim_ids": claim_ids, "events": unit_events,
            "preferred": list(dict.fromkeys(unit.get("anchor_shot_ids", []))),
            "claim_shots": list(dict.fromkeys(
                s for cid in claim_ids for s in claims[cid][1].get("shot_ids", [])))})
    boundaries = [0]
    for i, row in enumerate(unit_rows):
        if i == len(unit_rows) - 1:
            boundaries.append(target_frames)
        else:
            boundaries.append(min(target_frames, max(
                boundaries[-1], int(round(float(row["unit"]["end"]) * fps)))))
    budgets = [boundaries[i + 1] - boundaries[i] for i in range(len(unit_rows))]
    merge_frames = max(min_frames, int(math.ceil(MERGE_UNIT_SEC * fps)))
    cap_frames = int(MERGE_GROUP_CAP_SEC * fps)
    groups: list[dict] = []
    for row, budget in zip(unit_rows, budgets):
        soft = (groups and budget < merge_frames and
                groups[-1]["budget"] + budget <= cap_frames)
        if groups and (budget < min_frames or groups[-1]["budget"] < min_frames
                       or soft):
            groups[-1]["rows"].append(row)
            groups[-1]["budget"] += budget
        else:
            groups.append({"rows": [row], "budget": budget})
    return [g for g in groups if g["budget"] > 0]


def _value_fn(group: dict, fps: float,
              avoid: dict[str, set[str]] | None = None):
    """(shot区间)→每秒价值。锚≫claim≫事件池≫附近≫远处;回避项为负。"""
    anchors = {s for r in group["rows"] for s in r["preferred"]}
    claim_shots = {s for r in group["rows"] for s in r["claim_shots"]}
    avoid_shots: set[str] = set()
    if avoid:
        for r in group["rows"]:
            avoid_shots |= avoid.get(
                r["unit"].get("semantic_unit_id", ""), set())
    events = list({e["event_id"]: e for r in group["rows"]
                   for e in r["events"]}.values())
    pool = {x for e in events
            for x in e.get("candidate_shot_ids", e.get("shot_ids", []))}
    pool |= {x for e in events for x in e.get("shot_ids", [])}
    a = min(float(e.get("start", 0)) for e in events)
    b = max(float(e.get("end", 0)) for e in events)

    def value(iv: dict) -> float:
        sid = iv["shot_id"]
        if sid in avoid_shots:
            return V_AVOID       # 回看实证矛盾的画面:宁可跳切也别再骑
        if sid in anchors:
            return V_ANCHOR
        if sid in claim_shots:
            return V_CLAIM
        if sid in pool:
            return V_EVENT
        if overlap_seconds(a - 25.0, b + 25.0, iv["start"], iv["end"]) > 0:
            return V_NEAR
        return V_FAR
    return value


def _record(tape: list[dict], k: int, off: int, need: int, value,
            not_after_f: int, min_frames: int, fps: float,
            entry_jump: bool = False,
            min_run_frames: int | None = None
            ) -> tuple[list[dict], float, int, int] | None:
    """从磁带位置 (k, off) 起为一个句组录 need 帧。

    跨相邻可用区间(帧连续)= 原片自己的切点,免罚;中间有洞(被用镜头/裁剪)
    则视为一次组内跳切。**任何跳切入场的连续录制段都必须 ≥ min_run**
    (入场残段=闪);跳切状态下容量不足的区间直接跳过(仍算同一次跳切)。
    min_run_frames: 跳切间连续段下限(碎片禁令,默认取 min_frames);
    入场区间的容量筛选仍用 min_frames——小锚岛可以跳进来,只要后面帧连续
    续得下去把 run 攒够。
    返回 (pieces, score, 新k, 新off);录不满返回 None。
    """
    min_run = min_run_frames or min_frames
    pieces: list[dict] = []
    score = 0.0
    run = 0                     # 距上次跳切的连续帧
    jumping = entry_jump        # 当前是否处于"跳切后尚未入场"状态
    jumped = entry_jump
    while need > 0 and k < len(tape):
        iv = tape[k]
        lo = iv["sf"] + off
        hi = min(iv["ef"], not_after_f)
        capacity = hi - lo
        if capacity <= 0:
            break               # 本组的时间上限到了(禁未来镜头)
        if jumping and capacity < min(min_frames, need):
            k, off = k + 1, 0   # 跳切入场点太碎,继续往前找(同一次跳切)
            continue
        take = min(need, capacity)
        pieces.append({"shot_id": iv["shot_id"], "start_frame": lo,
                       "end_frame": lo + take,
                       "start": round(lo / fps, 6),
                       "end": round((lo + take) / fps, 6)})
        score += value(iv) * take / fps
        need -= take
        run += take
        jumping = False
        if need <= 0:
            if jumped and run < min_run:
                return None      # 跳切后的末段残段太短=闪,禁止
            new_off = lo + take - iv["sf"]
            if iv["sf"] + new_off >= iv["ef"]:
                return pieces, score, k + 1, 0
            return pieces, score, k, new_off
        # 本区间录穿了,进入下一区间
        if k + 1 >= len(tape):
            break
        gap = tape[k + 1]["sf"] - iv["ef"]
        if lo + take >= iv["ef"] and gap <= FRAME_GAP_TOL:
            score += SEAM_BONUS      # 帧连续:原片自带切点,丝滑
        else:
            if run < min_run:
                return None          # 跳切前的残段太短=闪,禁止
            score -= JUMP_PENALTY
            run = 0
            jumping = True
            jumped = True
        k, off = k + 1, 0
    return None if need > 0 else (pieces, score, k, off)


def _solve_segment(groups: list[dict], tape: list[dict], fps: float,
                   min_frames: int,
                   avoid: dict[str, set[str]] | None = None,
                   cap_floor_f: int = 0,
                   min_run_frames: int | None = None
                   ) -> list[list[dict]] | dict:
    """段级 DP:为每个句组选落点并录满预算,最大化总分。

    状态 (句组i, 磁带位置k, 区间内偏移off, 漂移drift);落点 = 当前位置
    (免罚,即顺延/续播)或前方区间起点(跳切罚分,锚收益可覆盖)。
    无解返回缺口信息 dict。

    drift(J-cut 借还账,v3):上一组出刀时若离所在磁带区间尾 ≤SNAP_EXIT_SEC,
    可以把该区间播完再跳(画面切点吸附镜头边界,声音切点仍在句边界——声画
    错开切)。多播的帧记为 drift,本组预算 = 原预算 - drift(借的从下一句
    份额里还),段内总帧数不变。锚句(写手点名镜头)容忍的入场延迟以
    KEY_MAX_DRIFT_SEC 为限;末组不许带漂移出段(段总长=配音长的硬校验)。
    半截出刀又跳切在 JUMP_PENALTY 外加罚 MIDSHOT_EXIT_PENALTY,推动 DP
    优先吸附;跳切间连续段下限 min_run_frames(碎片禁令)。

    cap_floor_f: 句组时间上限的下限(帧)。卷引擎用:卷在选卷时已做过防剧透
    把关,卷内画面对本段任何句子都不算"未来镜头"——否则段落首节拍的句子
    会被禁未来镜头规则误判成无画面可用(踩过:卷72.7s却报0.0s可用)。
    """
    values = [_value_fn(g, fps, avoid=avoid) for g in groups]
    caps = []
    for g in groups:
        events = list({e["event_id"]: e for r in g["rows"]
                       for e in r["events"]}.values())
        caps.append(max(cap_floor_f, int(math.floor(
            max(float(e.get("end", 0)) for e in events) * fps + 1e-7))))
    anchor_ks: list[list[int]] = []
    has_anchor: list[bool] = []
    for g in groups:
        preferred = {s for r in g["rows"] for s in r["preferred"]}
        want = preferred | {s for r in g["rows"] for s in r["claim_shots"]}
        anchor_ks.append([k for k, iv in enumerate(tape)
                          if iv["shot_id"] in want])
        has_anchor.append(bool(preferred))
    snap_f = max(0, int(SNAP_EXIT_SEC * fps))
    key_f = max(0, int(KEY_MAX_DRIFT_SEC * fps))
    NEG = float("-inf")
    memo: dict = {}

    def solve(gi: int, k: int, off: int, drift: int):
        if gi == len(groups):
            return 0.0, []
        if has_anchor[gi] and drift > key_f:
            return NEG, None     # J-cut 压过关键句的"说到即看到":不许
        key = (gi, k, off, drift)
        if key in memo:
            return memo[key]
        need = groups[gi]["budget"] - drift
        if need <= 0:
            # 本组份额已被上一组的吸附延播整个盖住(极短并组句):顺播即可
            memo[key] = solve(gi + 1, k, off, -need)
            return memo[key]
        best, best_plan = NEG, None
        last_group = gi == len(groups) - 1
        # 组间接缝: "当前位置"落点若正好是新区间开头且与上一区间尾部有洞,
        # 实为一次跳切 — 与组内跳切同罚,并按 entry_jump 强制入场残段 ≥min_frames
        # (否则组间可绑出非 seamless 的 <1.25s 短窗,必挂硬 QC 且重试环无解)。
        cont_pen = 0.0
        if off == 0 and 0 < k < len(tape) and \
                tape[k]["sf"] - tape[k - 1]["ef"] > FRAME_GAP_TOL:
            cont_pen = -JUMP_PENALTY
        landings = [(k, off, cont_pen)]
        seen = {k}
        upto = min(len(tape), k + 1 + MAX_LANDINGS)
        for nk in range(k + 1, upto):
            landings.append((nk, 0, -JUMP_PENALTY))
            seen.add(nk)
        for nk in anchor_ks[gi]:
            if nk > k and nk not in seen:
                landings.append((nk, 0, -JUMP_PENALTY))
        for nk, noff, pen in landings:
            # 半截出刀又跳切:额外罚分(off>0 = 上一组停在区间半截)
            if pen < 0 and off > 0:
                pen -= MIDSHOT_EXIT_PENALTY
            got = _record(tape, nk, noff, need,
                          values[gi], caps[gi], min_frames, fps,
                          entry_jump=pen < 0, min_run_frames=min_run_frames)
            if got is None:
                continue
            # 出刀变体:exact(照预算停,可能半截)/ snap-J(吸附到区间尾,
            # 多播 extra 帧记正 drift 从下一组扣)/ snap-L(回撤到区间头,
            # 少播 eoff 帧记负 drift 让下一组补)。末组必须 exact(段长守恒)。
            variants = [(got, 0)]
            ek, eoff = got[2], got[3]
            if not last_group and eoff > 0 and ek < len(tape):
                iv = tape[ek]
                extra = min(iv["ef"], caps[gi]) - (iv["sf"] + eoff)
                if 0 < extra <= snap_f:
                    got2 = _record(tape, nk, noff, need + extra,
                                   values[gi], caps[gi], min_frames, fps,
                                   entry_jump=pen < 0,
                                   min_run_frames=min_run_frames)
                    if got2 is not None:
                        variants.append((got2, extra))
                if 0 < eoff <= snap_f and need - eoff > 0:
                    got3 = _record(tape, nk, noff, need - eoff,
                                   values[gi], caps[gi], min_frames, fps,
                                   entry_jump=pen < 0,
                                   min_run_frames=min_run_frames)
                    # 确认真回撤到了区间边界(确定性录制,少录 eoff 帧必然
                    # 停在 ek-1 区间尾;防御:验证出刀 off==0)
                    if got3 is not None and got3[3] == 0:
                        variants.append((got3, -eoff))
            for (pieces, rec_score, vk, voff), vdrift in variants:
                sub, sub_plan = solve(gi + 1, vk, voff, vdrift)
                if sub == NEG:
                    continue
                total = pen + rec_score + sub
                if total > best:
                    best, best_plan = total, [pieces] + sub_plan
        memo[key] = (best, best_plan)
        return memo[key]

    score, plan = solve(0, 0, 0, 0)
    if plan is None:
        # 精确报缺口:磁带总量 vs 预算总量,并指认第一个录不满的句组。
        # available_sec 始终报真实余量; 总量够但无可行路径时用 reason 区分,
        # 不再硬编码 0.0 (曾把排障引向"画面被用光"的错误方向)。
        remain = sum(iv["ef"] - iv["sf"] for iv in tape)
        need = sum(g["budget"] for g in groups)
        first = groups[0]["rows"][0]["unit"]
        for gi, g in enumerate(groups):
            if _record(tape, 0, 0, g["budget"], values[gi], caps[gi],
                       min_frames, fps,
                       min_run_frames=min_run_frames) is None:
                first = g["rows"][0]["unit"]
                break
        return {"required_sec": round(need / fps, 3),
                "available_sec": round(remain / fps, 3),
                "reason": ("insufficient_total" if remain < need
                           else "no_feasible_path"),
                "semantic_unit_id": first.get("semantic_unit_id", ""),
                "text": first.get("text", "")}
    return plan


def solve_segment_snap(groups: list[dict], tape: list[dict], fps: float,
                       min_frames: int,
                       avoid: dict[str, set[str]] | None = None,
                       cap_floor_f: int = 0
                       ) -> tuple[list[list[dict]] | dict, bool]:
    """J/L-cut 求解入口:先按碎片禁令(MIN_RUN_SEC)严格解;段级无解再回退
    legacy 下限(1.25s)兜底——宁可偶闪,不可整段缺画面。返回 (结果, 是否严格)。
    bind 与 refit 可行性预检必须走同一入口,两边判定才不会分裂。"""
    min_run = max(min_frames, int(math.ceil(MIN_RUN_SEC * fps - 1e-7)))
    result = _solve_segment(groups, tape, fps, min_frames, avoid=avoid,
                            cap_floor_f=cap_floor_f, min_run_frames=min_run)
    if isinstance(result, list):
        return result, True
    fallback = _solve_segment(groups, tape, fps, min_frames, avoid=avoid,
                              cap_floor_f=cap_floor_f,
                              min_run_frames=min_frames)
    return fallback, False


def _emit_windows(groups: list[dict], plan: list[list[dict]],
                  fps: float) -> tuple[list[dict], list[dict]]:
    """DP 路径 → 窗口(带证据层)+ 语义映射;组内窗口按口播中点归句。"""
    all_windows: list[dict] = []
    unit_windows: dict[str, list[dict]] = defaultdict(list)
    cursor_sec = 0.0
    for group, pieces in zip(groups, plan):
        anchors = {s for r in group["rows"] for s in r["preferred"]}
        claim_shots = {s for r in group["rows"] for s in r["claim_shots"]}
        events = list({e["event_id"]: e for r in group["rows"]
                       for e in r["events"]}.values())
        ev_shots = {x for e in events for x in e.get("shot_ids", [])}
        cand = {x for e in events
                for x in e.get("candidate_shot_ids", e.get("shot_ids", []))}
        not_after = max(float(e.get("end", 0)) for e in events)
        local = cursor_sec
        for w in pieces:
            dur = (w["end_frame"] - w["start_frame"]) / fps
            midpoint = local + dur / 2
            row = next((r for r in group["rows"]
                        if float(r["unit"]["start"]) <= midpoint <
                        float(r["unit"]["end"])), group["rows"][-1])
            unit = row["unit"]
            sid = w["shot_id"]
            w.update({
                "semantic_unit_id": unit["semantic_unit_id"],
                "claim_ids": row["claim_ids"],
                "tts_start": round(float(unit["start"]), 3),
                "tts_end": round(float(unit["end"]), 3),
                "purpose": str(unit.get("text", ""))[:160],
                "evidence_level": ("anchor" if sid in anchors else
                                   "claim" if sid in claim_shots else
                                   "event" if sid in ev_shots else
                                   "event_candidate" if sid in cand else
                                   "nearby_broll"),
                "not_after_event_time": round(not_after, 3),
                "engine": "dp",
            })
            unit_windows[unit["semantic_unit_id"]].append(w)
            local += dur
        cursor_sec = local
        all_windows.extend(pieces)
    semantic_map = []
    for group in groups:
        for row in group["rows"]:
            unit = row["unit"]
            selected = unit_windows.get(unit["semantic_unit_id"], [])
            semantic_map.append({
                "semantic_unit_id": unit["semantic_unit_id"],
                "text": unit.get("text", ""),
                "tts_start": round(float(unit["start"]), 3),
                "tts_end": round(float(unit["end"]), 3),
                "event_ids": [e["event_id"] for e in row["events"]],
                "claim_ids": row["claim_ids"],
                "anchor_shot_ids": row["preferred"],
                "selected_shot_ids": [w["shot_id"] for w in selected]})
    return all_windows, semantic_map


# ---- step_event_bind_reel.py 卷模式 -------------------------------------

def _reel_tape(spans: list[dict], state: SelectionState) -> list[dict]:
    """卷 → 磁带:卷内片段按序铺开,跳过已被占用的部分(原声预留可能吃进卷)。
    选卷防线之外再加一道:同镜头相邻片段合并、非相邻重复丢弃——历史上选卷桥接
    曾把前镜头剩余帧当新片段重复入卷(shot_0431 事故),磁带层必须自愈。"""
    merged: list[dict] = []
    seen: set[str] = set()
    for span in spans:
        if merged and merged[-1]["shot_id"] == span["shot_id"] and \
                float(span["start"]) <= float(merged[-1]["end"]) + 0.11:
            merged[-1]["end"] = max(float(merged[-1]["end"]), float(span["end"]))
            continue
        if span["shot_id"] in seen:
            continue
        seen.add(span["shot_id"])
        merged.append(dict(span))
    fps = state.fps
    tape = []
    for span in merged:
        sf = max(state.cursor_frame, int(math.ceil(float(span["start"]) * fps - 1e-7)))
        ef = int(math.floor(float(span["end"]) * fps + 1e-7))
        if span["shot_id"] in state.used_shots:
            # 同镜头只允许顺延续播(occupy 的连续例外);已用过且不连续则跳过
            if not (state.intervals and state.intervals[-1][2] == span["shot_id"]
                    and sf <= state.intervals[-1][1]):
                continue
            sf = max(sf, state.intervals[-1][1])
        if ef - sf >= 3:
            tape.append({"shot_id": span["shot_id"], "sf": sf, "ef": ef,
                         "start": sf / fps, "end": ef / fps})
    return tape


def _emit_tail(tape: list[dict], last_end_frame: int, fps: float,
               min_frames: int, max_sec: float = TAIL_MAX_SEC) -> list[dict]:
    """旁白铺完后,沿卷继续帧连续地播 ≤max_sec 当呼吸留白(原声透出)。
    只收连续段:第一处真跳切即停(留白里出现跳切=白挨一刀)。"""
    budget = int(max_sec * fps)
    pieces: list[dict] = []
    pos = last_end_frame
    for iv in tape:
        if iv["ef"] <= pos:
            continue
        sf = max(iv["sf"], pos)
        if sf - pos > FRAME_GAP_TOL:
            break                      # 跳切,留白到此为止
        take = min(iv["ef"] - sf, budget)
        if take <= 0:
            break
        pieces.append({"shot_id": iv["shot_id"], "start_frame": sf,
                       "end_frame": sf + take,
                       "start": round(sf / fps, 6),
                       "end": round((sf + take) / fps, 6),
                       "semantic_unit_id": "", "purpose": "呼吸留白",
                       "evidence_level": "tail", "tail": True,
                       "engine": "reel"})
        budget -= take
        pos = sf + take
        if budget <= 0:
            break
    total = sum(p["end_frame"] - p["start_frame"] for p in pieces)
    if total < int(TAIL_MIN_SEC * fps):
        return []
    return pieces


def _snap_tail_to_line(pieces: list[dict], tape: list[dict], fps: float,
                       lines: list[tuple[float, float]]) -> list[dict]:
    """留白切点避开台词半句:末尾窗口的收刀点若落在某句台词中间,先试着
    沿卷延长到句尾+0.15s(≤TAIL_LINE_EXT_SEC,且不越过跳切/镜头边界);
    延长不成就回退到句头-0.05s 收刀。回退后留白若短于 TAIL_MIN_SEC,整段
    留白放弃(纯解说直切下一拍,也好过掐半句)。lines 用源片时间坐标。"""
    if not pieces or not lines:
        return pieces
    last = pieces[-1]
    cut_t = last["end"]                    # 源片坐标的收刀时刻
    hit = next((ln for ln in lines
                if ln[0] < cut_t - 0.02 and cut_t < ln[1] - 0.02), None)
    if hit is None:
        return pieces
    want_end = hit[1] + 0.15               # 念完这句再多给一点尾气
    ext = want_end - cut_t
    if ext <= TAIL_LINE_EXT_SEC:
        # 沿当前窗口所在的卷段延长(不越过该卷段的帧上界=不引入新跳切)
        iv = next((iv for iv in tape if iv["shot_id"] == last["shot_id"]
                   and iv["sf"] <= last["start_frame"] < iv["ef"]), None)
        if iv is not None:
            new_ef = min(int(round(want_end * fps)), iv["ef"])
            if new_ef / fps >= hit[1] + 0.05:      # 真够到句尾才算延长成功
                last["end_frame"] = new_ef
                last["end"] = round(new_ef / fps, 6)
                return pieces
    # 延长不成: 回退到句头前收刀
    back_ef = int((hit[0] - 0.05) * fps)
    out: list[dict] = []
    for p in pieces:
        if p["end_frame"] <= back_ef:
            out.append(p)
        elif p["start_frame"] < back_ef:
            p["end_frame"] = back_ef
            p["end"] = round(back_ef / fps, 6)
            out.append(p)
    total = sum(p["end_frame"] - p["start_frame"] for p in out)
    if total < int(TAIL_MIN_SEC * fps):
        return []
    return out


# ---- 工具入口 -----------------------------------------------------------

class _GlobalAvoid(dict):
    """avoid_shot_ids 平铺回避表:任意语义句都回避这些镜头。

    DP 内核的 avoid 契约是 {semantic_unit_id: {shot_id,...}};工具入参是
    平铺 shot_id 数组(回看发现矛盾句后重绑),用 .get 恒返回同一集合适配,
    不改动 _value_fn 一行。"""

    def __init__(self, shot_ids: list[str]) -> None:
        super().__init__()
        self._all = set(shot_ids)

    def get(self, key: Any, default: Any = None) -> set[str]:
        return self._all

    def __bool__(self) -> bool:  # 空 dict 本体也要在 `if avoid:` 里为真
        return bool(self._all)


def bind_narration(args: dict, ctx: RunContext) -> ToolResult:
    """卷模式句画绑定:script_tts + graph + timeline + reel → edl.json + qc。

    确定性 DP 内核,无 LLM。短缺/质检失败以 [ERROR] 文本返回,不抛异常。
    """
    for key in ("script_path", "graph_path", "timeline_path", "reel_path"):
        if not args.get(key):
            return ToolResult(text=f"[ERROR] {key} is required")
    paths = {key: ctx.resolve(args[key])
             for key in ("script_path", "graph_path", "timeline_path", "reel_path")}
    for key, p in paths.items():
        if not p.is_file():
            return ToolResult(text=f"[ERROR] {key} not found: {p}")
    out_path = ctx.resolve(args.get("output_edl") or "out/edl.json")
    qc_path = ctx.resolve(args.get("qc_json") or "out/edl_qc.json")
    inserts_path = ctx.resolve(args["inserts_path"]) if args.get("inserts_path") else None
    if inserts_path is not None and not inserts_path.is_file():
        return ToolResult(text=f"[ERROR] inserts_path not found: {inserts_path}")
    avoid_ids = args.get("avoid_shot_ids") or []
    if not isinstance(avoid_ids, list) or \
            not all(isinstance(x, str) for x in avoid_ids):
        return ToolResult(text="[ERROR] avoid_shot_ids must be an array of strings")
    avoid = _GlobalAvoid(avoid_ids) if avoid_ids else None
    tail_mode = str(args.get("tail_mode") or "all").strip().lower()
    if tail_mode not in ("highlight", "all", "none"):
        return ToolResult(text='[ERROR] tail_mode must be "highlight", "all" or "none"')
    # 台词时间表(留白切点避让用): 有 transcript 就自动启用, 没有不报错
    lines: list[tuple[float, float]] = []
    tr_path = ctx.resolve(args.get("transcript_path") or "out/transcript.json")
    if tr_path.is_file():
        try:
            tr = load_json(tr_path)
            tr_segs = tr.get("segments") if isinstance(tr, dict) else tr
            lines = sorted((float(x["start"]), float(x["end"]))
                           for x in tr_segs or []
                           if isinstance(x, dict) and str(x.get("text", "")).strip())
        except Exception:  # noqa: BLE001  台词表坏了不拦渲染, 只失去避让
            lines = []

    try:
        reel = load_json(paths["reel_path"])
        segs = load_json(paths["script_path"])
        graph = load_json(paths["graph_path"])
        timeline = load_json(paths["timeline_path"])
    except Exception as exc:
        return ToolResult(text=f"[ERROR] invalid JSON input: {exc}")

    min_window_sec = MIN_WINDOW_SEC
    # 输入契约轻校验: 缺字段以结构化 [ERROR] 返回, 不让 KeyError 裸奔到调用方
    if not isinstance(reel, dict) or not isinstance(reel.get("beats", {}), dict):
        return ToolResult(text="[ERROR] reel_path must contain an object with a beats{} map")
    reels = reel.get("beats", {})
    if not isinstance(graph, dict):
        return ToolResult(text="[ERROR] graph_path must contain a JSON object with events[]")
    if not isinstance(timeline, dict) or not isinstance(timeline.get("shots", []), list):
        return ToolResult(text="[ERROR] timeline_path must contain a JSON object with shots[]")
    if not isinstance(segs, list):
        return ToolResult(text="[ERROR] script_path must contain a JSON array of segments")
    for i, seg in enumerate(segs):
        if not isinstance(seg, dict) or not str(seg.get("seg_id", "")).strip():
            return ToolResult(text=f"[ERROR] script segment #{i} is missing seg_id")
        if not isinstance(seg.get("text", ""), str):
            return ToolResult(text=f"[ERROR] segment {seg['seg_id']} text must be a string")
        try:
            audio_dur = float(seg.get("audio_dur", 0) or 0)
        except (TypeError, ValueError):
            return ToolResult(text=f"[ERROR] segment {seg['seg_id']} audio_dur must be numeric")
        if audio_dur > 0 and not seg.get("audio_path"):
            return ToolResult(text=f"[ERROR] segment {seg['seg_id']} has audio_dur "
                                   "but no audio_path; run synthesize_narration first")
        if audio_dur > 0 and "text" not in seg:
            return ToolResult(text=f"[ERROR] segment {seg['seg_id']} is missing text")
        if not isinstance(seg.get("sentences", []), list):
            return ToolResult(text=f"[ERROR] segment {seg['seg_id']} sentences must be an array")
    if not isinstance(graph.get("events", []), list):
        return ToolResult(text="[ERROR] graph events must be an array")
    for i, e in enumerate(graph.get("events", [])):
        if not isinstance(e, dict) or not e.get("event_id"):
            return ToolResult(text=f"[ERROR] graph event #{i} is missing event_id")
    for i, sh in enumerate(timeline.get("shots", [])):
        if not isinstance(sh, dict) or not sh.get("shot_id"):
            return ToolResult(text=f"[ERROR] timeline shot #{i} is missing shot_id")
        if not isinstance(sh.get("start"), (int, float)) or \
                not isinstance(sh.get("end"), (int, float)):
            return ToolResult(text=f"[ERROR] timeline shot {sh.get('shot_id')} needs numeric start/end")
    events = {e["event_id"]: e for e in graph.get("events", [])}
    shots = sorted(timeline.get("shots", []), key=lambda s: float(s["start"]))
    shot_bounds = {s["shot_id"]: s for s in shots}
    try:
        fps = float(timeline.get("fps", DEFAULT_FPS) or DEFAULT_FPS)
    except (TypeError, ValueError):
        return ToolResult(text="[ERROR] timeline fps must be numeric")
    min_frames = max(1, int(math.ceil(
        min(min_window_sec, HARD_MIN_WINDOW_SEC) * fps - 1e-7)))
    inserts_by_seg: dict[str, dict] = {}
    if inserts_path is not None and inserts_path.exists():
        try:
            inserts_doc = load_json(inserts_path)
        except Exception as exc:
            return ToolResult(text=f"[ERROR] invalid inserts JSON: {exc}")
        inserts_list = inserts_doc.get("inserts", []) if isinstance(inserts_doc, dict) else None
        if not isinstance(inserts_list, list):
            return ToolResult(text="[ERROR] inserts_path must contain an object with inserts[]")
        for i, x in enumerate(inserts_list):
            if not isinstance(x, dict) or not str(x.get("seg_id", "")).strip():
                return ToolResult(text=f"[ERROR] insert #{i} is missing seg_id")
        inserts_by_seg = {x["seg_id"]: x for x in inserts_list}
    logs: list[str] = []  # movie_cut 里的 print 全部改为进结构化日志

    def seg_spans(seg: dict) -> list[dict]:
        """段落(合并后)的卷 = 组成节拍的卷按序拼接。"""
        beat_ids = seg.get("source_seg_ids") or [seg.get("seg_id", "")]
        spans: list[dict] = []
        for bid in beat_ids:
            spans.extend(reels.get(bid, {}).get("spans", []))
        return spans

    def assemble(replay_segs: set[str]) -> tuple[list[dict], int, int]:
        state = SelectionState(fps=fps)
        used: dict[str, int] = defaultdict(int)
        edl: list[dict] = []
        counts = {"oa": 0, "replay": 0}

        def emit_oa(ins: dict, seg: dict, reserved_mode: bool) -> None:
            oa = (_occupy_original(ins, seg, shots, state, used)
                  if reserved_mode else None)
            mode = "预留"
            if oa is None:
                oa = _replay_original(ins, seg, shots, fps)
                mode = "回放"
            if oa is None:
                logs.append(f"{seg['seg_id']} 原声区间异常,放弃这处插入")
                return
            counts["oa"] += 1
            counts["replay"] += (mode == "回放")
            edl.append(oa)
            logs.append(f"{oa['seg_id']}[{mode}]: 原声{oa['audio_dur']:.1f}s"
                        f"「{oa['text'][:20]}…」")

        for seg in segs:
            audio_dur = float(seg.get("audio_dur", 0) or 0)
            if audio_dur <= 0:
                continue
            sents = [x for x in seg.get("sentences", []) if isinstance(x, dict)]
            if sents and not any(float(x.get("end", 0)) > float(x.get("start", 0))
                                 for x in sents):
                # 静默降级是排障黑洞: 锚全丢只有终值统计能看出来, 必须留痕
                logs.append(f"[warn] {seg.get('seg_id', '?')}: sentences 全部缺"
                            f"有效时间戳,句级锚定退化为整段单元(锚失效)")
            evs = [events[x] for x in seg.get("event_ids", []) if x in events]
            if not evs:
                logs.append(f"{seg['seg_id']} 无合法 event_id，跳过")
                continue
            insert = inserts_by_seg.get(seg["seg_id"])
            reserved = bool(insert) and seg["seg_id"] not in replay_segs
            # 冷开场拍(高潮前置钩子): 画面取自片尾高潮, 走独立账本——
            # 不推进全局游标、不占全局镜头账(正片高潮届时重演同镜头,
            # 与原声回放同一豁免哲学), 段内单调/无重叠仍由临时账本把关。
            cold_seg = any(bool(reels.get(bid, {}).get("cold_open"))
                           for bid in (seg.get("source_seg_ids")
                                       or [seg.get("seg_id", "")]))
            seg_state = SelectionState(fps=fps) if cold_seg else state
            cap_f = None
            if insert and insert.get("position") == "before":
                emit_oa(insert, seg, reserved)
                insert = None
            elif insert and reserved:
                cap_f = int(math.floor(float(insert["start"]) * fps + 1e-7))
            groups = _group_rows(seg, evs, events, audio_dur, fps, min_frames)
            tape = _reel_tape(seg_spans(seg), seg_state)
            if cap_f is not None:      # after+预留:旁白止步于台词时刻
                tape = [{**iv, "ef": min(iv["ef"], cap_f)} for iv in tape
                        if iv["sf"] < cap_f]
            # 卷已在选卷时做过防剧透把关:卷内画面对本段任何句子都可用,
            # 否则首节拍句子会被"禁未来镜头"误判成无画面(cap_floor)。
            reel_end_f = max((iv["ef"] for iv in tape), default=0)
            result, strict = solve_segment_snap(groups, tape, fps, min_frames,
                                                avoid=avoid,
                                                cap_floor_f=reel_end_f)
            if not strict and isinstance(result, list):
                logs.append(f"[warn] {seg['seg_id']}: 碎片禁令(≥{MIN_RUN_SEC}s)"
                            f"下无解,回退 {MIN_WINDOW_SEC}s 下限兜底(可能偶闪)")
            if isinstance(result, dict):
                # 卷内短缺 = 稿子超写(或原声吃进卷),精确报给缩稿闭环
                raise FootageShortageError({
                    **result, "seg_id": seg.get("seg_id", ""),
                    "event_ids": [e["event_id"] for e in evs],
                    "reel_sec": round(sum(
                        s["end"] - s["start"] for s in seg_spans(seg)), 2)})
            windows, semantic_map = _emit_windows(groups, result, fps)
            for w in windows:
                w["engine"] = "reel"
            # 留白是标点也是呼吸:默认每拍都停(解说时垫底归零,留白透原声——
            # "解说的时候不要有原声,不解说的时候放原声"),高光拍停更长。
            want_tail = tail_mode != "none"
            if tail_mode == "highlight" and not seg.get("highlight"):
                want_tail = False
            tail_cap = TAIL_MAX_SEC if seg.get("highlight") else TAIL_PLAIN_SEC
            tail = (_emit_tail(tape, windows[-1]["end_frame"] if windows else 0,
                               fps, min_frames, max_sec=tail_cap)
                    if want_tail else [])
            # 台词必须说完才切: 留白收刀点撞上半句台词就延长到句尾或回退到句头
            if tail and lines:
                tail = _snap_tail_to_line(tail, tape, fps, lines)
            for w in windows + tail:
                seg_state.occupy(w["shot_id"], w["start_frame"], w["end_frame"])
                used[w["shot_id"]] += 1
                if cold_seg:
                    w["cold_open"] = True
                source = shot_bounds.get(w["shot_id"])
                if source is None:
                    raise AssertionError(
                        f"reel 引用的镜头不在 timeline: {w['shot_id']} "
                        f"(reel 与 shots.json 不是同一次切镜产物?)")
                if w["start"] < float(source["start"]) - 1 / fps or \
                        w["end"] > float(source["end"]) + 1 / fps:
                    raise AssertionError(
                        f"{seg['seg_id']} 窗口越过 {w['shot_id']} 边界")
            narr_total = sum(w["end_frame"] - w["start_frame"]
                             for w in windows) / fps
            if narr_total + 1e-6 < audio_dur or \
                    narr_total - audio_dur > 1 / fps + 1e-3:
                raise AssertionError(
                    f"{seg['seg_id']} 画面{narr_total:.3f}s 与配音{audio_dur:.3f}s不匹配")
            tail_sec = round(sum(w["end_frame"] - w["start_frame"]
                                 for w in tail) / fps, 6)
            all_windows = windows + tail
            entry = {"schema_version": REEL_SCHEMA_VERSION, "seg_id": seg["seg_id"],
                     "event_ids": [e["event_id"] for e in evs],
                     "text": seg["text"],
                     "emotion": normalize_emotion(seg.get("emotion")),
                     "audio_path": seg["audio_path"], "audio_dur": audio_dur,
                     "windows": all_windows, "semantic_map": semantic_map,
                     "shot_ids": [f"{w['start']:.6f}-{w['end']:.6f}"
                                  for w in all_windows],
                     "video_dur": round(narr_total + tail_sec, 6),
                     "speed": 1.0, "bgm_track": None,
                     "duck": bool(seg.get("highlight", False)),
                     "story_scene_id": seg.get("story_scene_id", ""),
                     "tail_sec": tail_sec}
            if cold_seg:
                entry["cold_open"] = True
                entry["reuse_type"] = "cold_open_teaser"
                entry["exemptions"] = ["global_no_repeat", "monotonic_time"]
            edl.append(entry)
            logs.append(f"{seg['seg_id']}: 配音{audio_dur:.1f}s / "
                        f"{len(semantic_map)}语义句 ← {len(windows)}窗口(卷)"
                        f"{f' +留白{tail_sec:.1f}s' if tail_sec else ''}")
            if insert:
                emit_oa(insert, seg, reserved)
        return edl, counts["oa"], counts["replay"]

    replay_segs: set[str] = set()
    try:
        while True:
            round_base = len(logs)   # 失败轮的逐段明细全部作废,只留一行摘要
            try:
                edl, n_oa, n_replay = assemble(replay_segs)
                break
            except FootageShortageError as exc:
                blame = _blame_insert(str(exc.shortage.get("seg_id", "")),
                                      segs, inserts_by_seg, replay_segs)
                if blame is None:
                    raise  # 与原声无关的真短缺,交给上游改稿闭环。
                del logs[round_base:]
                replay_segs.add(blame)
                logs.append(f"短缺于 {exc.shortage.get('seg_id', '?')},归因于 "
                            f"{blame} 的原声预留 → 降级为回放模式,该轮明细已丢弃,整体重绑")
    except FootageShortageError as exc:
        s = exc.shortage
        return ToolResult(
            text=f"[ERROR] footage_shortage {shortage_message(s)}",
            data={"error": "footage_shortage", "shortage": s,
                  "hint": "缩写对应段文案后重新TTS再绑", "log": logs})
    except AssertionError as exc:
        # 内部不变量被破坏(输入数据异常):同样以 [ERROR] 返回,不抛异常。
        return ToolResult(text=f"[ERROR] bind_assertion: {exc}",
                          data={"error": "bind_assertion", "detail": str(exc),
                                "log": logs})
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        # 轻校验漏网的脏输入 (end:null / sentence 非 dict / insert 缺 start ...):
        # 结构化 [ERROR], 不让 traceback 冒到工具外
        return ToolResult(text=f"[ERROR] invalid input data: {type(exc).__name__}: {exc}",
                          data={"error": "invalid_input", "detail": str(exc),
                                "log": logs})

    report = audit_edl(edl, fps=fps,
                       min_window_sec=min(min_window_sec, HARD_MIN_WINDOW_SEC))
    save_json(report, qc_path)
    if report["status"] != "passed":
        return ToolResult(
            text=(f"[ERROR] EDL硬质检失败: 重复{len(report['duplicate_shots'])} / "
                  f"重叠{len(report['overlapping_source_frames'])} / "
                  f"倒退{len(report['source_time_regressions'])} / "
                  f"短闪{len(report['too_short_windows'])}"),
            data={"error": "edl_qc_failed", "qc": report,
                  "qc_json": str(qc_path), "log": logs},
            artifacts=[str(qc_path)])
    save_audited_edl(edl, report, out_path, qc_path)

    # 摘要统计(附加信息,不影响产物契约):接缝/锚命中/留白。
    rhythm = report.get("rhythm", {})
    n_tail = sum(1 for e in edl for w in e.get("windows", []) if w.get("tail"))
    tail_total = sum(float(e.get("tail_sec", 0) or 0) for e in edl)
    if tail_mode == "highlight" and not any(s.get("highlight") for s in segs):
        # 全片 0 高光大概率是写手忘了标(或 idx 类型脏导致透传失败),不该无声无息
        logs.append("[warn] tail_mode=highlight 但 script 无任何 highlight=true 段,"
                    "全片零留白 — 若非有意,请在 writer_script 的强拍标 highlight")
    anchored_units = [u for e in edl for u in e.get("semantic_map", [])
                      if u.get("anchor_shot_ids")]
    anchor_hits = sum(1 for u in anchored_units
                      if set(u["anchor_shot_ids"]) & set(u.get("selected_shot_ids", [])))
    n_windows = report["n_windows"]
    seams = {"n_windows": n_windows,
             "n_continuous_runs": rhythm.get("n_cuts", 0),
             "seamless_transitions": max(0, n_windows - rhythm.get("n_cuts", 0))}
    anchor = {"anchored_units": len(anchored_units), "hits": anchor_hits,
              "hit_rate": round(anchor_hits / len(anchored_units), 2)
              if anchored_units else None}
    text = (f"[EventBindReel] {len(edl)}段(原声{n_oa}处,其中回放{n_replay}) · "
            f"{n_windows}个窗口 · 留白{tail_total:.0f}s/{n_tail}处 → "
            f"{ctx.virtualize(out_path)}\n"
            f"节奏: 切镜{rhythm.get('cuts_per_min')}次/分钟 · "
            f"均停留{rhythm.get('avg_dwell_sec')}s · <2s占比{rhythm.get('pct_under_2s')}"
            f" · >5s占比{rhythm.get('pct_over_5s')}\n"
            f"锚命中: {anchor_hits}/{len(anchored_units)} · QC: {report['status']}")
    return ToolResult(
        text=text,
        data={"status": report["status"], "n_segments": len(edl),
              "n_windows": n_windows, "rhythm": rhythm, "seams": seams,
              "anchor": anchor,
              "original_audio": {"n_oa": n_oa, "n_replay": n_replay},
              "tail": {"n_tail": n_tail, "total_sec": round(tail_total, 3)},
              "unique_source_frames": report["unique_source_frames"],
              "fps": fps,
              "avoid_shot_ids": avoid_ids,
              "output_edl": str(out_path), "qc_json": str(qc_path),
              "log": logs},
        artifacts=[str(out_path), str(qc_path)])
