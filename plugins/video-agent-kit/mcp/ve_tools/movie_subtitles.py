"""Movie-recap subtitle cues: word-aware line breaks, minimum on-screen time,
and burned-in subtitle detection for kept original-audio scenes.

Only the movie renderer (`render_narrated`) uses this module. The talking-head
subtitle path (`subtitle.py` / `subtitle_style.py`) is untouched; the timing
defaults are read from the shared `broadcast` preset so both directions agree
on what "too short to read" means.

Everything is deterministic: no model calls, no segmenter dependency.
"""
from __future__ import annotations

import hashlib
import json
import math
import subprocess
from pathlib import Path
from typing import Any, Callable, Iterable

from . import subtitle_style as sty

# ---------------------------------------------------------------------------
# Line breaking
# ---------------------------------------------------------------------------

WRAP_WIDTH = 20
_BREAK_AFTER = "，、。！？；：…,.!?;:—～~ "
_NO_LINE_START = "，、。！？；：…,.!?;:）】》」』”’)]}～~·%％"
_NO_LINE_END = "（【《「『“‘([{"
_OPEN_TITLE, _CLOSE_TITLE = "《「『“", "》」』”"
# Breaking after a structural particle or before a preposition/conjunction
# lands on a word boundary in nearly all narration sentences.
_AFTER_PARTICLE = set("的了着地得吗呢吧啊呀么嘛")
_BEFORE_FUNCTION = set("在和与把被让给向对从跟但却而")
# Two-character words in which those characters are word-internal. A break
# between the two characters is treated like any other unknown position.
_FUNCTION_WORDS = frozenset("""
现在 正在 存在 实在 好在 自在 所在 内在 外在 潜在 旨在
暖和 温和 平和 柔和 缓和 随和 总和 共和 祥和 讲和 附和 和平
参与 给与 赋与 授与
一把 两把 几把 这把 那把 火把
棉被
转让 谦让 出让 礼让 退让 忍让
交给 送给 留给 供给 补给 配给 嫁给 递给 还给 借给 卖给 带给 发给 寄给 分给 让给 输给 献给 留给 交给
方向 一向 志向 倾向 转向 面向 走向 指向 朝向 动向 意向 去向 偏向 导向
面对 反对 绝对 相对 一对 应对 针对 不对 核对 配对 派对 敌对 成对 作对
自从 服从 听从 顺从 无从 随从 侍从
脚跟 鞋跟
不但 非但
冷却 忘却 推却 了却
然而 因而 从而 进而 反而 继而
的确 的士 的话
了解 了不 了结 了然 了如
着急 着想 着落 着火 着迷 着手 着凉 着重 着实
地方 地点 地区 地上 地下 地图 地位 地球 地址 地铁 地板 地面 地狱 地道 地主 地震 地盘 地步
得到 得知 得出 得意 得罪 得手 得病 得逞 得分 得救 得势
""".split())

PENALTY_PUNCT = 0.0
PENALTY_BOUNDARY = 4.0
PENALTY_UNKNOWN = 30.0
PENALTY_ALNUM = 14.0
IMBALANCE_WEIGHT = 0.25
PENALTY_EXTRA_LINE = 12.0   # a third line only when two lines would split a word


def _is_alnum(ch: str) -> bool:
    return ch.isascii() and ch.isalnum()


def break_penalty(text: str, i: int) -> float:
    """Cost of a line break between text[i-1] and text[i]; inf = never."""
    a, b = text[i - 1], text[i]
    if b in _NO_LINE_START or a in _NO_LINE_END:
        return math.inf
    if _is_alnum(a) and _is_alnum(b):
        return math.inf  # never split a number or a Latin word
    depth = 0
    for ch in text[:i]:
        depth += (ch in _OPEN_TITLE) - (ch in _CLOSE_TITLE)
    inside_title = depth > 0
    if a in _BREAK_AFTER:
        return PENALTY_PUNCT
    if _is_alnum(a) or _is_alnum(b):
        cost = PENALTY_ALNUM if (a.isdigit() or b.isdigit()) else PENALTY_BOUNDARY
    elif a + b in _FUNCTION_WORDS:
        cost = PENALTY_UNKNOWN
    elif a in _AFTER_PARTICLE or b in _BEFORE_FUNCTION:
        cost = PENALTY_BOUNDARY
    else:
        cost = PENALTY_UNKNOWN
    return cost + (10.0 if inside_title else 0.0)


def _plan(text: str, lines: int, width: int) -> tuple[float, list[int]] | None:
    n = len(text)
    per = n / lines
    bound = max(4.0, math.ceil(per * 0.5))
    hard_max = width + 2
    penalties = [math.inf] + [break_penalty(text, i) for i in range(1, n)]

    def ok(length: int) -> bool:
        return 2 <= length <= hard_max and abs(length - per) <= bound

    # best[k][i]: cheapest way to put text[:i] on k lines.
    best: list[dict[int, tuple[float, int]]] = [{0: (0.0, -1)}]
    for k in range(1, lines + 1):
        row: dict[int, tuple[float, int]] = {}
        ends = [n] if k == lines else range(1, n)
        for i in ends:
            if k < lines and not math.isfinite(penalties[i]):
                continue
            for j, (cost, _) in best[k - 1].items():
                if not ok(i - j):
                    continue
                c = cost + IMBALANCE_WEIGHT * (i - j - per) ** 2 + (penalties[i] if k < lines else 0.0)
                if i not in row or c < row[i][0]:
                    row[i] = (c, j)
        best.append(row)
    if n not in best[lines]:
        return None
    cuts, i = [], n
    for k in range(lines, 0, -1):
        i = best[k][i][1]
        if k > 1:
            cuts.append(i)
    return best[lines][n][0], sorted(cuts)


def wrap_cue(text: str, width: int = WRAP_WIDTH) -> str:
    """Balanced multi-line wrap that avoids breaking inside a Chinese word.

    Lines are balanced around len/lines (bounded imbalance, never a single
    character on a line). Break positions are ranked: after punctuation, then a
    word boundary (after a particle such as 的/了/着, or before a preposition or
    conjunction such as 在/把/让/给/对/从), then any other position. Numbers and
    Latin words are never split; 《》/「」 titles are split only as a last resort.
    """
    text = text.strip()
    if len(text) <= width:
        return text
    lines = math.ceil(len(text) / width)
    plans = [(plan[0] + PENALTY_EXTRA_LINE * extra, plan[1])
             for extra in range(0, 3) if (plan := _plan(text, lines + extra, width)) is not None]
    if plans:
        cuts = min(plans, key=lambda p: p[0])[1]
        parts = [text[a:b].strip() for a, b in zip([0, *cuts], [*cuts, len(text)])]
        return "\n".join(p for p in parts if p)
    # Unreachable for ordinary text; keep the old fixed-width behaviour.
    per = math.ceil(len(text) / lines)
    return "\n".join(text[i:i + per] for i in range(0, len(text), per))


# ---------------------------------------------------------------------------
# Minimum on-screen time
# ---------------------------------------------------------------------------

_TIMING_PRESET = sty.PRESETS["broadcast"]
MIN_DURATION = float(_TIMING_PRESET["min_duration"])
MAX_CPS = float(_TIMING_PRESET["max_cps"])
MIN_GAP = float(_TIMING_PRESET["min_gap"])
SCENE_MARGIN = 0.20          # a cue may outlast its scene's audio by at most this much
MAX_REQUIRED = 4.0           # reading-time requirement cap for very long cues
MERGE_MAX_GAP = 1.2


def visible_chars(text: str) -> int:
    return sum(1 for ch in text if not ch.isspace()
               and ch not in sty.STRONG_PUNCT + sty.WEAK_PUNCT + sty.CLOSING_PUNCT + "“‘（【《「『(")


def required_duration(text: str, min_duration: float = MIN_DURATION, max_cps: float = MAX_CPS) -> float:
    return min(MAX_REQUIRED, max(min_duration, visible_chars(text) / max_cps))


def timing_stats(cues: Iterable[dict], min_duration: float = MIN_DURATION,
                 max_cps: float = MAX_CPS) -> dict:
    rows = list(cues)
    short = [c for c in rows if c["end"] - c["start"] < min_duration - 1e-6]
    fast = [c for c in rows if c["end"] - c["start"] < required_duration(c["text"], min_duration, max_cps) - 1e-6]
    return {"cues": len(rows), "below_min_duration": len(short), "below_reading_time": len(fast),
            "min_duration_sec": min_duration, "max_cps": max_cps,
            "shortest_sec": round(min((c["end"] - c["start"] for c in rows), default=0.0), 3)}


def _extend(cues: list[dict], i: int, need: float, min_gap: float, margin: float) -> None:
    cue = cues[i]
    nxt = cues[i + 1] if i + 1 < len(cues) else None
    prv = cues[i - 1] if i > 0 else None
    fwd_limit = cue.get("scene_end", math.inf) + margin
    if nxt is not None:
        fwd_limit = min(fwd_limit, nxt["start"] - min_gap)
    cue["end"] = max(cue["end"], min(cue["start"] + need, fwd_limit))
    if cue["end"] - cue["start"] < need - 1e-6:
        back_limit = max(0.0, cue.get("scene_start", 0.0) - margin)
        if prv is not None:
            back_limit = max(back_limit, prv["end"] + min_gap)
        cue["start"] = min(cue["start"], max(cue["end"] - need, back_limit))


def fit_cue_timing(cues: list[dict], *, min_duration: float = MIN_DURATION, max_cps: float = MAX_CPS,
                   min_gap: float = MIN_GAP, margin: float = SCENE_MARGIN,
                   wrap_width: int = WRAP_WIDTH) -> list[dict]:
    """Give every cue its minimum on-screen time without overlapping a neighbour.

    A short cue first extends into the following gap (never closer than
    `min_gap` to the next cue, never more than `margin` past the end of its
    scene's audio), then starts earlier into the preceding gap under the same
    rules. If it is still too short it merges with the nearest neighbouring cue
    of the same scene when the joined text still fits two lines. Cues carry
    `scene`, `scene_start`, `scene_end`; input order does not matter.
    """
    rows = sorted((dict(c) for c in cues if str(c.get("text", "")).strip()),
                  key=lambda c: (c["start"], c["end"]))
    i = 0
    while i < len(rows):
        cue = rows[i]
        need = required_duration(cue["text"], min_duration, max_cps)
        if cue["end"] - cue["start"] < need - 1e-6:
            _extend(rows, i, need, min_gap, margin)
        if cue["end"] - cue["start"] < need - 1e-6:
            options = []
            for j in (i - 1, i + 1):
                if 0 <= j < len(rows) and rows[j].get("scene") == cue.get("scene"):
                    a, b = (rows[j], cue) if j < i else (cue, rows[j])
                    gap = b["start"] - a["end"]
                    if gap <= MERGE_MAX_GAP and len(a["text"]) + len(b["text"]) <= 2 * wrap_width:
                        options.append((gap, j))
            if options:
                _, j = min(options)
                a, b = (rows[j], cue) if j < i else (cue, rows[j])
                merged = {**a, "start": a["start"], "end": max(a["end"], b["end"]),
                          "text": a["text"] + b["text"], "merged": True}
                lo = min(i, j)
                rows[lo:lo + 2] = [merged]
                i = max(0, lo - 1) if lo > 0 else 0
                continue
        i += 1
    for k in range(len(rows) - 1):   # final guard: never overlap the next cue
        if rows[k]["end"] > rows[k + 1]["start"] - min_gap:
            rows[k]["end"] = max(rows[k]["start"] + 0.05, rows[k + 1]["start"] - min_gap)
    return rows


# ---------------------------------------------------------------------------
# Burned-in subtitle detection for original-audio scenes
# ---------------------------------------------------------------------------

DETECTOR_VERSION = "burned-cjk-v1"
SAMPLE_WIDTH = 1280
MAX_SAMPLES = 18
LOWER_AREA = 0.70            # a subtitle line's top edge must sit below this fraction of the frame
MIN_HITS = 2
MIN_HIT_RATIO = 0.15
_CJK_RANGES = ((0x4E00, 0x9FFF), (0x3400, 0x4DBF), (0xF900, 0xFAFF))


def cjk_count(text: str) -> int:
    return sum(1 for ch in text if any(lo <= ord(ch) <= hi for lo, hi in _CJK_RANGES))


def _text_mask(img):
    import cv2
    import numpy as np
    a = img.astype(np.int32)
    lum = (a[..., 2] * 299 + a[..., 1] * 587 + a[..., 0] * 114) // 1000
    chroma = a.max(-1) - a.min(-1)
    white = (lum >= 180) & (chroma <= 60)
    # Subtitle strokes are bright with a dark outline/shadow close by.
    local_min = cv2.erode(lum.astype(np.uint8), np.ones((7, 7), np.uint8)).astype(np.int32)
    return white & (local_min <= lum - 80)


def _runs(flags) -> list[tuple[int, int]]:
    out, i, n = [], 0, len(flags)
    while i < n:
        if flags[i]:
            j = i
            while j < n and flags[j]:
                j += 1
            out.append((i, j))
            i = j
        else:
            i += 1
    return out


def _text_bands(mask, height: int) -> list[tuple[int, int]]:
    import numpy as np
    rows = mask.sum(1).astype(float)
    bands = []
    for a, b in _runs(rows >= max(3.0, mask.shape[1] * 0.004)):
        stack = [(a, b)]
        while stack:
            a, b = stack.pop()
            h = b - a
            if h > 0.06 * height:      # two stacked lines (e.g. Chinese over English)
                lo, hi = a + int(h * 0.3), a + int(h * 0.7)
                k = lo + int(np.argmin(rows[lo:hi]))
                if rows[k] <= 0.35 * float(np.median(rows[a:b])):
                    stack += [(a, k), (k + 1, b)]
                    continue
            if 0.02 * height <= h <= 0.075 * height:
                bands.append((a, b))
    return sorted(bands)


def _line_features(sub, h: int, width: int) -> dict | None:
    import numpy as np
    col = sub.sum(0)
    xs = np.where(col > 0)[0]
    if len(xs) == 0:
        return None
    groups, start, prev = [], xs[0], xs[0]
    for x in xs[1:]:
        if x - prev > 1.2 * h:
            groups.append((start, prev))
            start = x
        prev = x
    groups.append((start, prev))
    x0, x1 = min(groups, key=lambda g: abs((g[0] + g[1]) / 2 - width / 2))
    occ = (col[x0:x1 + 1] > 0).astype(float)
    length = len(occ)
    q = occ - occ.mean()
    den = float((q * q).sum()) or 1.0
    lags = list(range(max(2, int(0.7 * h)), int(1.4 * h) + 2))
    ac = [float((q[:-l] * q[l:]).sum() / den) if l < length - 1 else 0.0 for l in lags]
    best, pitch = 0.0, 0
    for k in range(1, len(ac) - 1):     # interior peak only: a real glyph pitch
        if ac[k] >= ac[k - 1] and ac[k] >= ac[k + 1] and 0.85 * h <= lags[k] <= 1.25 * h and ac[k] > best:
            best, pitch = ac[k], lags[k]
    cell = 0.0
    if pitch:
        for p in np.arange(0.85 * h, 1.25 * h, 0.5):
            n = int(round((length + 0.08 * p) / p))
            if n < 2 or abs(length + 0.08 * p - n * p) / p > 0.2:
                continue
            tol = max(1, int(round(0.1 * p)))
            hits = 0
            for k in range(1, n):
                c = int(round(k * p - 0.04 * p))
                w = occ[max(0, c - tol):min(length, c + tol + 1)]
                hits += int(len(w) > 0 and w.min() == 0)
            cell = max(cell, hits / (n - 1))
    return {"centre": (x0 + x1) / 2 / width, "glyph_widths": length / h, "periodicity": best,
            "pitch": pitch / h if pitch else 0.0, "cell_gaps": cell, "empty_columns": float(1 - occ.mean())}


def is_cjk_line(f: dict) -> bool:
    """Monospaced square glyphs: a strong glyph-pitch periodicity near the line
    height, inter-glyph gaps on that grid, and few empty columns (Latin text is
    proportional and full of letter/word gaps)."""
    if abs(f["centre"] - 0.5) > 0.06 or f["glyph_widths"] < 1.8 or f["cell_gaps"] < 0.75:
        return False
    return (f["periodicity"] >= 0.30 and f["empty_columns"] <= 0.20) or f["periodicity"] >= 0.45


def frame_cjk_lines(img) -> list[dict]:
    """Centred Chinese subtitle lines in the lower area of one BGR frame."""
    import cv2
    h0, w0 = img.shape[:2]
    if w0 != SAMPLE_WIDTH:
        img = cv2.resize(img, (SAMPLE_WIDTH, max(1, int(round(h0 * SAMPLE_WIDTH / w0)))),
                         interpolation=cv2.INTER_AREA)
    height, width = img.shape[:2]
    y0 = int(height * 0.55)
    mask = _text_mask(img[y0:])
    mask[:, :int(width * 0.1)] = False
    mask[:, int(width * 0.9):] = False
    found = []
    for a, b in _text_bands(mask, height):
        if (a + y0) / height < LOWER_AREA:
            continue
        f = _line_features(mask[a:b], b - a, width)
        if f and is_cjk_line(f):
            found.append({**f, "y": round((a + y0) / height, 4), "height": round((b - a) / height, 4)})
    return found


def sample_times(scene_start: float, lines: list[dict], max_samples: int = MAX_SAMPLES) -> list[float]:
    """Source times inside spoken lines (up to three per line, evenly capped)."""
    times = []
    for line in lines:
        if cjk_count(str(line.get("text", ""))) < 2:
            continue
        st, en = float(line["start"]), float(line["end"])
        fracs = (0.2, 0.5, 0.8) if en - st >= 0.9 else (0.3, 0.7) if en - st >= 0.5 else (0.5,)
        times.extend(scene_start + st + (en - st) * f for f in fracs)
    if len(times) > max_samples:
        step = len(times) / max_samples
        times = [times[int(k * step)] for k in range(max_samples)]
    return [round(t, 3) for t in times]


def decide(frames: list[list[dict] | None]) -> dict:
    """Scene decision from per-frame detections (None = frame unreadable)."""
    readable = [f for f in frames if f is not None]
    if not readable:
        return {"status": "unavailable", "burned_in": False, "samples": len(frames), "readable": 0, "hits": 0}
    tops = [min(x["y"] for x in f) for f in readable if f]
    hits = 0
    band = None
    if tops:
        tops.sort()
        band = tops[len(tops) // 2]
        hits = sum(1 for t in tops if abs(t - band) <= 0.04)
    ratio = hits / len(readable)
    if hits >= MIN_HITS and ratio >= MIN_HIT_RATIO:
        status = "burned_in"
    elif hits == 0 and len(readable) >= 2:
        status = "absent"
    else:
        status = "uncertain"
    return {"status": status, "burned_in": status == "burned_in", "samples": len(frames),
            "readable": len(readable), "hits": hits, "hit_ratio": round(ratio, 3),
            "band_y": band}


def grab_frame(video: str, t: float, timeout: float = 60):
    import cv2
    import numpy as np
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-ss", f"{max(0.0, t):.3f}", "-i", str(video),
           "-frames:v", "1", "-vf", f"scale={SAMPLE_WIDTH}:-2", "-f", "image2pipe", "-vcodec", "png", "-"]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0 or not proc.stdout:
        return None
    return cv2.imdecode(np.frombuffer(proc.stdout, np.uint8), cv2.IMREAD_COLOR)


def scene_key(video_sig: Any, scene_start: float, lines: list[dict]) -> str:
    payload = json.dumps([DETECTOR_VERSION, video_sig, round(float(scene_start), 3),
                          [(round(float(l["start"]), 3), round(float(l["end"]), 3), str(l.get("text", "")))
                           for l in lines]], ensure_ascii=False, default=str)
    return hashlib.sha256(payload.encode()).hexdigest()


def detect_scene(video: str, scene_start: float, lines: list[dict], *,
                 grab: Callable[[str, float], Any] | None = None, workers: int = 4) -> dict:
    """Decide whether the source already shows Chinese subtitles for an
    original-audio scene: sample frames inside its spoken lines and look for a
    centred, consistently placed CJK text line in the lower area."""
    times = sample_times(scene_start, lines)
    if not times:
        return {"status": "no_dialogue", "burned_in": False, "samples": 0, "readable": 0, "hits": 0,
                "detector": DETECTOR_VERSION}
    grab = grab or grab_frame
    try:
        import cv2  # noqa: F401
        import numpy  # noqa: F401
    except ImportError:
        return {"status": "unavailable", "burned_in": False, "samples": len(times), "readable": 0, "hits": 0,
                "detector": DETECTOR_VERSION, "reason": "opencv/numpy missing"}

    def one(t: float):
        img = grab(video, t)
        if img is None:
            return None
        try:
            return frame_cjk_lines(img)
        except Exception:   # a malformed frame is "unreadable", never a crash
            return None
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        frames = list(ex.map(one, times))
    return {**decide(frames), "sample_times": times, "detector": DETECTOR_VERSION}


class DetectionCache:
    """Small JSON cache so re-renders do not re-sample unchanged scenes."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        try:
            self.data = json.loads(self.path.read_text())
            if not isinstance(self.data, dict):
                self.data = {}
        except (OSError, ValueError):
            self.data = {}
        self.used: dict[str, dict] = {}

    def get(self, key: str) -> dict | None:
        row = self.data.get(key)
        if isinstance(row, dict) and row.get("detector") == DETECTOR_VERSION:
            self.used[key] = row
            return row
        return None

    def put(self, key: str, row: dict) -> None:
        self.data[key] = row
        self.used[key] = row

    def save(self) -> None:
        try:
            self.path.write_text(json.dumps(self.used, ensure_ascii=False, indent=1))
        except OSError:
            pass
