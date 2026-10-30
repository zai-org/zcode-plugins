"""视频工具: clip_video (时间窗细看, 双模) + ingest_video (整片摄入概览)。

clip_video: 对源视频的若干时间窗 [{start, end}] 放大细看, 落产物到
ctx.upload_dir/_clips_/<stem>/。按本次 run 的 ctx.video_input_mode 选形态:

- "frames" (默认, 任何图片模型都能吃): 用 cv2 对每段按 fps 等差抽帧 (默认 3 fps),
  按 media_resolution 档位缩放, 返回 ToolResult.image_paths → agent_loop 把帧当图片
  inline (并按文件名 ms 给每帧标时间戳)。原生视频被消费方按固定低帧率采样, 1-2s 动效
  只采到几帧看不清; 对一小段密集抽帧反而把动效铺开, 看清 timing/easing/方向。
- "video" (需 provider/模型原生支持视频): 用 ffmpeg 切无音轨 mp4 片段, 返回
  ToolResult.video_paths → agent_loop 用 video_url part inline。分辨率由模型原生处理。

设计选择:
- 串行 (不引入 asyncio): 跟现有 tool 接口一致, agent_loop 单线程跑。
- 单段时长 <= 60s + 段数 <= 8 + 总时长 <= 180s 的软上限 (两模式共用)。
- video 模式一律 re-encode (libx264, 无音轨), 不走 `-c copy`: ffmpeg `-ss <s> -i <in>
  -c copy` 产出的 mp4 stts 报告的 sample 数会比 mdat 实际多, 下游解码会越界失败。并带
  size guard (MAX_CLIP_BYTES / MAX_TOTAL_BYTES) 防网关 ~600 KB 不稳定阈值。
- frames 模式每段 n = round((e-s)*fps), 累计封顶 MAX_TOTAL_FRAMES (超了按比例降帧)。
- 只要有 video 上传就解锁本 tool (见 AgentLoop.EXTRA_TOOLS), frames / video 模式都能用。
"""
from __future__ import annotations
import logging
import os
import re
import subprocess
from pathlib import Path

from .frame_utils import resize_frame
from .run_context import RunContext
from .result import ToolResult

log = logging.getLogger(__name__)

MAX_SEGMENTS = 8
MAX_SEGMENT_SECONDS = 60.0
MAX_TOTAL_SECONDS = 180.0

# --- frames 模式 ---
CLIP_FPS_DEFAULT = 3       # 每段每秒抽多少帧 (密到能看清动效); 可经 ctx.clip_fps / env 覆盖
MAX_TOTAL_FRAMES = 400     # 一次调用所有段累计帧数上限 (控 payload)
JPEG_QUALITY = 80

# --- grid (网格拼帧): N 帧拼一张 contact sheet, 每格画时间戳。两条路径密度不同:
# overview 摄入 4x6 (密度优先, 扫布局); clip 2x2 (每格 784px 宽, 细节可辨 —
# 4 列时格子仅 392px, 动效细节看不清)。
GRID_COLS = 4              # overview: 每行格数
GRID_MAX_CELLS = 24        # overview: 单张 sheet 最多格数 (4x6), 超了分多张
CLIP_GRID_COLS = 3         # clip grid 全帧回退时的每行格数 (523px/格): 走到全帧回退的
                           #  都是页级粗粒度运动 (滚动/整卡 tilt/入场), 523px 可辨;
                           #  需要大格子的细微局部动效由 ROI 裁剪路径承担 (原生分辨率)
GRID_SHEET_WIDTH = 1568    # sheet 宽度默认值; 视觉模型长边 >1568px 会被降采样, 卡在这不浪费像素
                           # (CLI --grid-sheet-width / env V2C_GRID_SHEET_WIDTH 可覆盖)

# --- clip grid 动效区域裁剪 (ROI): token 花在动效像素上, 不花在静止背景/放大插值上 ---
# 局部动效 (头像 hover/卡片翻转) 常只占画面 5-15%, 全帧格子里动效区域只剩 ~150px;
# 按差分累计 mask 的 bbox 裁剪后, 同等 token 下动效区有效分辨率 ~2.5x, 成本 ~1/4。
CLIP_ROI_MAX_FRAC = 0.6    # ROI 面积占比超过此值 → 放弃裁剪用全帧 (整页滚动/换节类)
CLIP_ROI_GLOBAL_PAIR_PCT = 4.0  # 单帧对变化像素占比 (%) 超过此值 = 全页级事件 (滚动/
                                #  换节/入场), 不参与 ROI 累计 — 否则一次滚动收尾就把
                                #  count 图撑满全页 (实测 nav 段因此 bbox 达 100%)
CLIP_ROI_MAX_GLOBAL_PAIRS = 0.2 # 全页级帧对占比超过此值 → 整段放弃裁剪 — 裁剪会应用到
                                #  全部帧, 滚动/换节帧被裁进小框就丢了"整页在动"的语境
CLIP_ROI_PAIR_SPREAD = 0.5      # 单帧对变化 bbox 面积占比超过此值也算全页级 — 慢滚动
                                #  收尾每对只变 1-2% 像素但散布全页, 钻得过占比判定
CLIP_ROI_REL_FRAC = 0.2    # ROI 像素判据: 累计变化幅度 >= 窗内峰值 x 该比例 — 真动效区
                           #  (换图/翻转) 的累计幅度远高于视差微移/光标轨迹, 二值计数
                           #  分不开 (实测 cnt>=2 会把有光标视差的整个 hero 框进来)
CLIP_ROI_PAD = 0.05        # bbox 四周外扩 (相对帧宽/高)
CLIP_ROI_MIN_W = 480       # ROI 最小宽/高 (源像素), 过小的动效区放大到可读的上下文
CLIP_ROI_MIN_H = 320
CLIP_CELL_MAX_W = 784      # 格宽上限 (= 2 列布局); 且不超过 ROI 原始宽 (不上采样)
GRID_SHEET_MAX_H = 1500    # 单张 sheet 高度上限 (贴着 1568 降采样线, 竖向多排
                           #  几行少出几张图 — 图片数本身也有 100 张/请求的预算)

# --- diff (差分选帧): 候选帧过采样倍率 / 上限 ---
DIFF_OVERSAMPLE = 4        # 候选帧 = 目标帧数 x 4
DIFF_MAX_CAND = 120        # 单段候选帧上限 (控解码开销)
DIFF_CAND_WIDTH = 160      # 差分计算用的缩略图宽度
DIFF_MIN_FPS_DEFAULT = 0.2 # 锚点保底: 静止段每 5s 至少一帧 (防盲区); ctx.clip_min_fps / env 可覆盖
DIFF_WINDOW_SECONDS = 1.0  # 局部封顶窗口宽度 (UI 动效尺度)
DIFF_WINDOW_CAP_RATIO = 0.5  # 单窗口入选帧 <= 候选密度 x 该比例, 超了溢出给次高变化区域

# --- 内容过滤 (overview 摄入 + clip grid 共用) ---
# 冗余判据用「变化像素占比」而非灰度均值: 均值分不开局部真动效和静止 — 实测头像
# hover 换图/卡片翻转这类真动效帧间均值仅 0.3-1.0, 但其变化像素占比 0.4-1.2%
# 与真静止帧 (0.01-0.05%) 分离度足够。两条路径目标不同, 阈值分开:
# - overview 摄入 (2.0%): 只保布局级变化 (滚动/换节), 光标位移/微动效折掉省 token,
#   动效细节本来就靠 clip_video 回看;
# - clip grid (0.1%): GT/上下文说这里有动效才来细看的, 细微动效帧必须忠实保留。
DEDUP_PX_DELTA = 8             # 单像素灰度变化 > 此值才算"该像素变了"
INGEST_DEDUP_MIN_PCT = 2.0     # overview: 与上一保留帧变化像素占比 (%) 低于此视为冗余
CLIP_DEDUP_MIN_PCT = 0.1       # clip grid: 同上, 但保守得多 (只折真静止)
INGEST_DEDUP_ANCHOR_GAP = 5.0  # 但每隔这么多秒至少保留一帧锚点 (静止证据, 对齐 1/DIFF_MIN_FPS_DEFAULT)
BLANK_WHITE_MEAN = 250.0       # 纯白帧判定: 灰度均值 >= 此值
BLANK_WHITE_STD = 3.0          # 且灰度标准差 <= 此值 (近乎无内容, 典型是页面加载白屏)

# --- ingest (整片摄入): 全片布局级概览, 与 clip_video / 录像回灌是三套独立参数 ---
INGEST_FPS_DEFAULT = 1.0   # 全片候选帧采样率 (布局级, 动效细节靠 clip_video 回看)
INGEST_MAX_FRAMES = 200    # 全片候选帧封顶, 超了按比例降有效 fps (长 tour 视频
                           #  不至于解码数百帧/产出十几张 sheet)

# --- video 模式 ---
# 每个 clip 的 raw 字节上限 (≈ 1.33× base64 后大小)。
# 100 KB raw → 133 KB base64, OneAPI 路径上单 part 实测 OK。
MAX_CLIP_BYTES = 100 * 1024
# 一次 clip_video 调用累计 raw 字节上限。
# 300 KB raw → 400 KB base64 总, 给多 clip 留余量避开网关 ~600 KB 不稳定阈值。
MAX_TOTAL_BYTES = 300 * 1024

# 三档 encode profile, 按从清晰到最激进排序。每个 profile 试编一次,
# 若 size 超 MAX_CLIP_BYTES 就升级。
# scale 高度按比例: 480/360/240, 宽度自动 (-2 保偶数兼容 yuv420p)。
ENCODE_PROFILES = [
    {"scale": "-2:480", "fps": 8,  "crf": 28},   # default: 中等清晰
    {"scale": "-2:360", "fps": 5,  "crf": 32},   # harder
    {"scale": "-2:240", "fps": 3,  "crf": 36},   # last resort
]


def _grid_sheet_width() -> int:
    """contact sheet 宽度 (overview 摄入 + clip grid 共用): env 可覆盖默认 1568。"""
    try:
        w = int(os.environ.get("V2C_GRID_SHEET_WIDTH", ""))
        if w > 0:
            return w
    except ValueError:
        pass
    return GRID_SHEET_WIDTH


def _segment_ts(s: float, e: float, n: int) -> list[float]:
    """[s,e] 内等差取 n 个时间戳 (含端点, 抓动效首尾); n==1 取中点。"""
    dur = e - s
    if n <= 1 or dur <= 0:
        return [s + max(0.0, dur) / 2]
    return [s + dur * i / (n - 1) for i in range(n)]


def _read_frames_at(src: Path, ts_list: list[float], tier: str | None):
    """按给定时间戳解码帧, 返回 [(ts, ndarray)]。tier=None 不缩放 (给 grid 自己控尺寸)。

    失败的帧跳过, 不抛异常 (上层按返回数量判断)。"""
    import cv2
    cap = cv2.VideoCapture(str(src))
    if not cap.isOpened():
        log.warning(f"  clip: cv2 打不开 {src}")
        return []
    out = []
    for ts in ts_list:
        cap.set(cv2.CAP_PROP_POS_MSEC, ts * 1000)
        ok, frame = cap.read()
        if not ok or frame is None:
            continue
        if tier is not None:
            frame = resize_frame(frame, tier)
        out.append((ts, frame))
    cap.release()
    return out


def _video_duration(src: Path) -> float:
    """cv2 metadata 时长 (秒); 读不出返回 0.0。"""
    import cv2
    cap = cv2.VideoCapture(str(src))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    n = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    cap.release()
    return n / fps if fps > 0 else 0.0


def _diff_select_ts(src: Path, s: float, e: float, n: int,
                    min_fps: float = DIFF_MIN_FPS_DEFAULT) -> list[float] | None:
    """差分选帧: 在 [s,e] 内密集过采样候选帧, 按相邻帧变化像素占比挑 n 个时间戳。

    变化度量 = 变化像素占比 (%) 而非灰度均值 — 均值会低估局部小动效 (实测快速
    hover 换图 px% 0.37 与卡片翻转 0.46-0.67 同量级, 但均值只有一半, 按均值分配
    会被大 burst 挤掉)。

    四步分配 (总预算恒为 n):
      1. 段首帧 + 段末帧 + 锚点保底: 每 1/min_fps 秒取最近候选帧, 静止段不留盲区
         (锚点即"此处无变化"的证据; 末帧展示动效收尾的定格状态,
         否则静止 padding 里不落帧, 输出时间范围看起来比请求窗短);
      2. 事件覆盖保底: 显著变化候选 (> 5% 峰值) 按相邻性聚成事件, 每个事件先给
         峰值帧 — 独立小事件 (如 0.2s 快速扫过的 hover) 不被相邻大 burst 挤掉;
      3. 剩余预算按变化占比降序分, 但任一 DIFF_WINDOW_SECONDS 宽的窗口内入选帧
         不超过候选密度 x DIFF_WINDOW_CAP_RATIO (边际收益控制), 超了溢出;
      4. 预算仍有剩 → 最远点填充: 逐帧填进离已选帧最远的时刻 (覆盖最空的时段)。
    返回的时间戳是候选帧的真实时间 (严格递增), 供上层用同一时间戳重新解码写盘
    → 文件名 ms 与画面严格对应。候选不足/解码失败返回 None (回落等差)。"""
    import numpy as np
    dur = e - s
    if n <= 1 or dur <= 0:
        return None
    n_cand = min(max(n * DIFF_OVERSAMPLE, n + 1), max(int(dur * 10) + 1, n + 1), DIFF_MAX_CAND)
    if n_cand <= n:
        return None
    cand_ts = _segment_ts(s, e, n_cand)
    grays = []
    kept_ts = []
    for ts, frame in _read_frames_at(src, cand_ts, None):
        grays.append(_small_gray(frame))
        kept_ts.append(ts)
    if len(kept_ts) <= n:
        return None
    # score[i-1] = 第 i 帧相对前一帧的变化像素占比 (%); 首帧无前帧, 恒保留
    scores = [float((np.abs(grays[i] - grays[i - 1]) > DEDUP_PX_DELTA).mean() * 100)
              for i in range(1, len(grays))]
    cand_dt = dur / (len(kept_ts) - 1)

    selected: set[int] = {0, len(kept_ts) - 1}
    # 1) 锚点保底
    if min_fps > 0:
        gap = 1.0 / min_fps
        t = s + gap
        while t < e - 1e-9 and len(selected) < n:
            selected.add(min(range(len(kept_ts)), key=lambda i: abs(kept_ts[i] - t)))
            t += gap
    # 2) 事件覆盖保底: 显著候选按相邻性 (间隔 <= 2 个候选) 聚成事件, 每事件先保峰值帧
    eps = 0.05 * max(scores) if scores else 0.0
    sig = [i for i in range(1, len(kept_ts)) if scores[i - 1] > eps]
    events: list[list[int]] = []
    for i in sig:
        if events and i - events[-1][-1] <= 2:
            events[-1].append(i)
        else:
            events.append([i])
    for ev in sorted(events, key=lambda ev: max(scores[i - 1] for i in ev),
                     reverse=True):
        if len(selected) >= n:
            break
        selected.add(max(ev, key=lambda i: scores[i - 1]))
    # 3) 按变化占比分剩余预算, 窗口封顶。两遍: 第一遍不允许与已选帧相邻 (先把
    #    预算摊开到整个活动时段 — 慢速连续动效的候选分数相近, 单遍按分数排队会
    #    在开头连成 0.1s 贴脸串, 一张 sheet 只覆盖 0.3s); 第二遍预算有剩再允许
    #    相邻加密 (快速动效仍能拿到 0.1s 级密帧看 easing)。
    cap = max(1, round(DIFF_WINDOW_CAP_RATIO * DIFF_WINDOW_SECONDS / cand_dt))
    order = sorted(sig, key=lambda i: scores[i - 1], reverse=True)
    for adjacent_ok in (False, True):
        for i in order:
            if len(selected) >= n:
                break
            if i in selected:
                continue
            if not adjacent_ok and (i - 1 in selected or i + 1 in selected):
                continue
            in_win = sum(1 for j in selected
                         if abs(kept_ts[j] - kept_ts[i]) <= DIFF_WINDOW_SECONDS / 2)
            if in_win < cap:
                selected.add(i)
    # 4) 预算没花完 → 最远点填充, 覆盖当前最空的时段
    while len(selected) < n:
        rest = [i for i in range(len(kept_ts)) if i not in selected]
        if not rest:
            break
        selected.add(max(rest, key=lambda i: min(abs(kept_ts[i] - kept_ts[j])
                                                 for j in selected)))
    return [kept_ts[i] for i in sorted(selected)]


def _small_gray(frame):
    """缩略灰度图 (int16), 供差分/白帧判定共用。"""
    import cv2
    h, w = frame.shape[:2]
    scale = DIFF_CAND_WIDTH / max(1, w)
    small = cv2.resize(frame, (DIFF_CAND_WIDTH, max(1, int(h * scale))))
    return cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype("int16")


def _is_blank_white(gray) -> bool:
    """近乎无内容的纯白帧 (典型是页面加载白屏)。"""
    return (float(gray.mean()) >= BLANK_WHITE_MEAN
            and float(gray.std()) <= BLANK_WHITE_STD)


def _dedup_frames(frames: list, min_pct: float = INGEST_DEDUP_MIN_PCT,
                  anchor_gap: float = INGEST_DEDUP_ANCHOR_GAP) -> list:
    """内容级去冗余: 先扔纯白帧 (页面加载白屏), 再把与上一保留帧变化像素占比
    < min_pct (%) 且时间差 < anchor_gap 的帧丢弃 (静止段折叠); 每 anchor_gap 秒
    仍保底一帧锚点。判据见 DEDUP_PX_DELTA / INGEST_DEDUP_MIN_PCT 注释。

    保留帧的时间戳不变 → 网格里相邻格时间戳跳变即代表中间画面无变化。
    全是白帧时保留第一帧兜底 (页面可能真是纯白)。"""
    import numpy as np
    if not frames:
        return frames
    grays = [_small_gray(f) for _, f in frames]
    non_white = [i for i, g in enumerate(grays) if not _is_blank_white(g)]
    if not non_white:
        return [frames[0]]

    first = non_white[0]
    kept = [frames[first]]
    last_gray, last_ts = grays[first], frames[first][0]
    for i in non_white[1:]:
        ts = frames[i][0]
        changed_pct = float((np.abs(grays[i] - last_gray) > DEDUP_PX_DELTA).mean() * 100)
        if changed_pct >= min_pct or ts - last_ts >= anchor_gap:
            kept.append(frames[i])
            last_gray, last_ts = grays[i], ts
    return kept


def _draw_ts_label(frame, ts: float):
    """在帧左上角画时间戳标签 (黑底白字), 供 grid 模式每格自带时间。"""
    import cv2
    text = f"{ts:.2f}s"
    scale, thick = 0.55, 1
    (tw, th), base = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, thick)
    cv2.rectangle(frame, (0, 0), (tw + 10, th + base + 8), (0, 0, 0), -1)
    cv2.putText(frame, text, (5, th + 4), cv2.FONT_HERSHEY_SIMPLEX, scale,
                (255, 255, 255), thick, cv2.LINE_AA)
    return frame


def _motion_roi(frames: list):
    """动效区域: 局部帧对差分「累计变化幅度」高值像素的 bbox。

    返回 ((x0,y0,x1,y1), locator_idx) 或 None; locator_idx 是贡献峰值帧对所在的
    帧下标 — 定位图必须用动效发生时刻的画面 (段首帧可能还在滚动途中, 画面内容
    与 ROI 坐标对不上)。
    帧对过滤 (都是实测教训):
    - 变化像素占比 > CLIP_ROI_GLOBAL_PAIR_PCT: 全页级事件 (滚动/换节), 不累计;
    - 变化 bbox 面积 > CLIP_ROI_PAIR_SPREAD: 慢滚动收尾每对只变 1-2% 像素但散布
      全页, 钻得过占比判定, 按散布兜住;
    - 全页级帧对占比 > CLIP_ROI_MAX_GLOBAL_PAIRS: 该段主体就是整页在动, 放弃裁剪。
    像素级: 累计幅度 >= 峰值 x CLIP_ROI_REL_FRAC 才算动效区 (光标视差微移/压缩噪声
    的累计幅度远低于真动效, 二值计数分不开), 再 2x2 腐蚀掉光标轨迹细条。
    在 _small_gray 缩略图上算再按比例放回全帧; bbox 外扩 CLIP_ROI_PAD, 保底
    CLIP_ROI_MIN_W/H (居中扩); 面积占比 > CLIP_ROI_MAX_FRAC 返回 None。"""
    import cv2
    import numpy as np
    if len(frames) < 2:
        return None
    grays = [_small_gray(f) for _, f in frames]
    acc = None
    n_global = 0
    peak_idx, peak_contrib = 0, -1.0
    for i in range(1, len(grays)):
        d = np.abs(grays[i] - grays[i - 1])
        m = d > DEDUP_PX_DELTA
        if float(m.mean() * 100) > CLIP_ROI_GLOBAL_PAIR_PCT:
            n_global += 1
            continue
        if m.any():
            pys, pxs = np.where(m)
            spread = ((pxs.max() - pxs.min() + 1) * (pys.max() - pys.min() + 1)
                      / (m.shape[0] * m.shape[1]))
            if spread > CLIP_ROI_PAIR_SPREAD:
                n_global += 1
                continue
        contrib = np.where(m, d, 0).astype(np.int32)
        acc = contrib if acc is None else acc + contrib
        tot = float(contrib.sum())
        if tot > peak_contrib:
            peak_contrib, peak_idx = tot, i
    if acc is None or acc.max() <= 0:
        return None
    if n_global > CLIP_ROI_MAX_GLOBAL_PAIRS * (len(grays) - 1):
        return None  # 全页级事件占比过高, 该段的主体就是整页在动
    thr = max(int(acc.max() * CLIP_ROI_REL_FRAC), DEDUP_PX_DELTA * 2)
    mask = (acc >= thr).astype(np.uint8)
    eroded = cv2.erode(mask, np.ones((2, 2), np.uint8))
    if eroded.any():
        mask = eroded
    if not mask.any():
        return None
    ys, xs = np.where(mask > 0)
    fh, fw = frames[0][1].shape[:2]
    scale = fw / mask.shape[1]
    x0, x1 = xs.min() * scale, (xs.max() + 1) * scale
    y0, y1 = ys.min() * scale, (ys.max() + 1) * scale
    x0 -= fw * CLIP_ROI_PAD; x1 += fw * CLIP_ROI_PAD
    y0 -= fh * CLIP_ROI_PAD; y1 += fh * CLIP_ROI_PAD
    # 保底尺寸: 居中扩到最小宽高
    if x1 - x0 < CLIP_ROI_MIN_W:
        cx = (x0 + x1) / 2
        x0, x1 = cx - CLIP_ROI_MIN_W / 2, cx + CLIP_ROI_MIN_W / 2
    if y1 - y0 < CLIP_ROI_MIN_H:
        cy = (y0 + y1) / 2
        y0, y1 = cy - CLIP_ROI_MIN_H / 2, cy + CLIP_ROI_MIN_H / 2
    x0, y0 = int(max(0, x0)), int(max(0, y0))
    x1, y1 = int(min(fw, x1)), int(min(fh, y1))
    if (x1 - x0) * (y1 - y0) > CLIP_ROI_MAX_FRAC * fw * fh:
        return None
    return (x0, y0, x1, y1), peak_idx


def _build_grid_sheets(frames: list, out_dir: Path, prefix: str,
                       cols: int = GRID_COLS,
                       max_cells: int = GRID_MAX_CELLS,
                       cell_w: int | None = None) -> list[Path]:
    """把 [(ts, ndarray)] 拼成 contact sheet(s): cols 列, 每格左上角画时间戳。

    cell_w 缺省为 sheet 宽//cols; 显式传入时用给定宽 (ROI 裁剪格子
    不上采样)。文件名 <prefix>_grid_<start_ms>ms_<end_ms>ms.jpg 编入该 sheet
    覆盖的时间窗, 供 agent_loop inline 时给整张 sheet 标时间范围 (prefix:
    clip 用 seg<idx>, overview 摄入用 video)。超过 max_cells 分多张。"""
    import cv2
    import numpy as np
    if cell_w is None:
        cell_w = _grid_sheet_width() // cols
    paths: list[Path] = []
    for chunk_start in range(0, len(frames), max_cells):
        chunk = frames[chunk_start:chunk_start + max_cells]
        cells = []
        for ts, frame in chunk:
            h, w = frame.shape[:2]
            cell = cv2.resize(frame, (cell_w, max(1, int(h * cell_w / max(1, w)))))
            cells.append(_draw_ts_label(cell, ts))
        cell_h = max(c.shape[0] for c in cells)
        blank = np.zeros((cell_h, cell_w, 3), dtype=np.uint8)
        cells = [c if c.shape[0] == cell_h else
                 cv2.copyMakeBorder(c, 0, cell_h - c.shape[0], 0, 0, cv2.BORDER_CONSTANT)
                 for c in cells]
        while len(cells) % cols:
            cells.append(blank)
        rows = [np.hstack(cells[r:r + cols]) for r in range(0, len(cells), cols)]
        sheet = np.vstack(rows)
        ms0, ms1 = int(round(chunk[0][0] * 1000)), int(round(chunk[-1][0] * 1000))
        p = out_dir / f"{prefix}_grid_{ms0}ms_{ms1}ms.jpg"
        if cv2.imwrite(str(p), sheet, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY]):
            paths.append(p)
    return paths


def _extract_segment_frames(src: Path, out_dir: Path, seg_idx: int,
                            ts_list: list[float], tier: str) -> tuple[list[Path], int]:
    """按给定时间戳抽帧, 纯白帧丢弃, 按 media_resolution 档位缩放, 落 jpg。

    返回 (路径列表, 丢弃的纯白帧数)。
    文件名 seg<idx>_<ms>ms.jpg 把时间戳编进名字, 供 agent_loop inline 时给帧标时间。"""
    import cv2
    paths: list[Path] = []
    n_white = 0
    for ts, frame in _read_frames_at(src, ts_list, tier):
        if _is_blank_white(_small_gray(frame)):
            n_white += 1
            continue
        p = out_dir / f"seg{seg_idx:02d}_{int(round(ts * 1000))}ms.jpg"
        if cv2.imwrite(str(p), frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY]):
            paths.append(p)
    return paths, n_white


def _run_ffmpeg(cmd: list[str], timeout: float = 120.0) -> tuple[bool, str]:
    """跑 ffmpeg, 返回 (ok, stderr_or_msg)。"""
    try:
        proc = subprocess.run(
            cmd, check=False, capture_output=True, text=True, timeout=timeout,
        )
        if proc.returncode != 0:
            return False, proc.stderr[-2000:] or proc.stdout[-2000:]
        return True, ""
    except FileNotFoundError:
        return False, "ffmpeg binary not found in PATH"
    except subprocess.TimeoutExpired:
        return False, f"ffmpeg timeout after {timeout}s"


def _encode_clip(src: Path, out: Path, s: float, e: float, profile: dict) -> tuple[bool, str]:
    """跑一档 encode profile, 输出无音轨 mp4。"""
    cmd = [
        "ffmpeg", "-y",
        "-ss", f"{s:.3f}", "-to", f"{e:.3f}",
        "-i", str(src),
        "-an",  # 丢音轨
        "-vf", f"scale={profile['scale']},fps={profile['fps']}",
        "-c:v", "libx264", "-preset", "veryfast",
        "-crf", str(profile["crf"]),
        "-avoid_negative_ts", "make_zero",
        "-movflags", "+faststart",
        str(out),
    ]
    return _run_ffmpeg(cmd)


def _encode_with_size_guard(src: Path, out: Path, s: float, e: float) -> tuple[bool, str, dict]:
    """按 ENCODE_PROFILES 升级 encode, 返回 (ok, last_err, info)。info 含最终用了哪档 profile + 字节数。"""
    last_err = ""
    used_profile = None
    for prof_idx, profile in enumerate(ENCODE_PROFILES):
        ok, err = _encode_clip(src, out, s, e, profile)
        if not ok:
            last_err = err
            return False, last_err, {"profile_idx": prof_idx, "size": 0}
        if not out.exists() or out.stat().st_size == 0:
            last_err = "ffmpeg 成功但 0 字节"
            return False, last_err, {"profile_idx": prof_idx, "size": 0}
        size = out.stat().st_size
        used_profile = prof_idx
        if size <= MAX_CLIP_BYTES:
            return True, "", {"profile_idx": prof_idx, "size": size, "over": False}
        log.info(f"  clip {out.name} profile[{prof_idx}] {size:,} bytes > "
                 f"{MAX_CLIP_BYTES:,}, 升级到更激进 profile")
    # 三档全用完仍超 → 接受 (warn), 不丢
    size = out.stat().st_size if out.exists() else 0
    log.warning(f"  clip {out.name} 走完所有 profile 仍 {size:,} bytes > "
                f"{MAX_CLIP_BYTES:,}, 接受 (网关可能 500)")
    return True, "", {"profile_idx": used_profile, "size": size, "over": True}


def clip_video(args: dict, ctx: RunContext):
    """对视频的若干时间窗放大细看 (按 ctx.video_input_mode 选帧/视频形态)。

    args (模型可见的输入只有时间参数):
        video_path: 源视频路径 (ctx 虚拟路径或绝对路径都行, 走 ctx.resolve)
        segments:   [{start: float, end: float}, ...] 单位秒;
                    end 必须 > start, 单段 <= 60s, 段数 <= 8, 总时长 <= 180s

    实现形式 (抽帧 fps / 分辨率档 / 是否 grid 拼图 / 采样策略 / 锚点保底) 由外部
    运行配置决定, 模型不可 per-call 覆盖:
        ctx.clip_fps               / env V2C_CLIP_FPS      / CLIP_FPS_DEFAULT
        ctx.clip_media_resolution  / ctx.media_resolution          / "medium"
        ctx.clip_grid              / env V2C_CLIP_GRID     / False
        ctx.clip_sample            / env V2C_CLIP_SAMPLE   / "uniform"
        ctx.clip_min_fps           / env V2C_CLIP_MIN_FPS  / min(0.2, fps)
    """
    raw_path = args.get("video_path")
    segments = args.get("segments")
    if not raw_path:
        return "[ERROR] video_path 必填"
    if not isinstance(segments, list) or not segments:
        return "[ERROR] segments 必填且为非空 list, 形如 [{start:1.0,end:3.0}]"
    if len(segments) > MAX_SEGMENTS:
        return f"[ERROR] segments 最多 {MAX_SEGMENTS} 段, 当前 {len(segments)} 段"

    try:
        src = ctx.resolve(raw_path)
    except Exception as e:
        return f"[ERROR] 无法解析 video_path={raw_path!r}: {e}"
    if not src.exists():
        return f"[ERROR] video not found: {raw_path}"
    if not src.is_file():
        return f"[ERROR] not a file: {raw_path}"

    parsed: list[tuple[float, float]] = []
    total_s = 0.0
    for i, seg in enumerate(segments):
        if not isinstance(seg, dict) or "start" not in seg or "end" not in seg:
            return f"[ERROR] segments[{i}] 必须含 start/end 字段, 收到 {seg!r}"
        try:
            s = float(seg["start"])
            e = float(seg["end"])
        except (TypeError, ValueError) as ex:
            return f"[ERROR] segments[{i}] start/end 必须是数字: {ex}"
        if e <= s:
            return f"[ERROR] segments[{i}] end({e}) 必须 > start({s})"
        dur = e - s
        if dur > MAX_SEGMENT_SECONDS:
            return (f"[ERROR] segments[{i}] 时长 {dur:.1f}s 超过单段上限 "
                    f"{MAX_SEGMENT_SECONDS:.0f}s")
        total_s += dur
        parsed.append((s, e))
    if total_s > MAX_TOTAL_SECONDS:
        return (f"[ERROR] segments 总时长 {total_s:.1f}s 超过 "
                f"{MAX_TOTAL_SECONDS:.0f}s 上限")

    out_dir = ctx.upload_dir / "_clips_" / src.stem
    out_dir.mkdir(parents=True, exist_ok=True)

    # 窗口台账: 精确重复段跳过 + 重叠标注。子窗口重切是合法用法 (motion-ROI 在
    # 短窗上收得更紧、看得更清), 只拦"同一窗口原样再要一遍"的纯重复; 部分重叠
    # 不拦, 只在结果里标注已覆盖范围, 供模型校正后续窗口规划。
    import json as _json
    ledger_p = out_dir / ".covered.json"
    try:
        covered = _json.loads(ledger_p.read_text()) if ledger_p.is_file() else []
    except Exception:
        covered = []
    ledger_notes: list[str] = []
    kept: list[tuple[float, float]] = []
    for (s, e) in parsed:
        dup = next((c for c in covered
                    if abs(c[0] - s) <= 0.2 and abs(c[1] - e) <= 0.2), None)
        if dup is not None:
            ledger_notes.append(
                f"  - segment {s:g}-{e:g}s 与先前 clip 的 {dup[0]:g}-{dup[1]:g}s "
                "基本相同, 已跳过重抽 — 帧已在先前那次结果中")
            continue
        ov = [c for c in covered if min(e, c[1]) - max(s, c[0]) > 0.05]
        if ov:
            rng = "; ".join(f"{c[0]:g}-{c[1]:g}s" for c in ov[:4])
            ledger_notes.append(
                f"  - segment {s:g}-{e:g}s 与已切范围重叠 ({rng}) — 更短的子窗口"
                "细看是合法的 (运动区域裁剪更紧), 同粒度重看不会有新信息")
        kept.append((s, e))
    if not kept:
        return ("[window ledger] 所有 segment 均与先前 clip 基本重复, 未重抽:\n"
                + "\n".join(ledger_notes))
    parsed = kept

    mode = getattr(ctx, "video_input_mode", "frames")
    if mode == "video":
        res = _clip_as_video(src, raw_path, parsed, out_dir, ctx)
    else:
        res = _clip_as_frames(src, raw_path, parsed, out_dir, ctx)
    is_err = isinstance(res, str) and res.startswith("[ERROR]")
    if not is_err:
        try:
            ledger_p.write_text(_json.dumps(covered + [[s, e] for (s, e) in parsed]))
        except Exception:
            pass
    if ledger_notes and not is_err:
        note = "\n[window ledger]\n" + "\n".join(ledger_notes)
        if isinstance(res, ToolResult):
            res.text += note
        else:
            res = str(res) + note
    return res


def _clip_as_frames(src: Path, raw_path: str, parsed: list[tuple[float, float]],
                    out_dir: Path, ctx: RunContext):
    """frames 模式: 每段抽帧 (等差或差分选帧), 逐帧返回或拼成 grid sheet。

    实现参数全部来自 ctx 属性 / 环境变量 (batch 下发), 模型无法 per-call 覆盖。"""
    tier = (getattr(ctx, "clip_media_resolution", None)
            or getattr(ctx, "media_resolution", None)
            or "medium")
    try:
        fps = float(getattr(ctx, "clip_fps", None)
                    or os.environ.get("V2C_CLIP_FPS")
                    or CLIP_FPS_DEFAULT)
    except (TypeError, ValueError):
        fps = CLIP_FPS_DEFAULT
    fps = max(0.1, fps)
    grid_cfg = getattr(ctx, "clip_grid", None)
    if grid_cfg is None:
        grid_env = os.environ.get("V2C_CLIP_GRID", "").strip().lower()
        # 默认开 (生产既定档: grid + ROI 裁剪, 全案图片 token -71%); 显式 0/false 才关
        grid_cfg = grid_env not in ("0", "false", "no", "off")
    grid = bool(grid_cfg)
    sample = (getattr(ctx, "clip_sample", None)
              or os.environ.get("V2C_CLIP_SAMPLE") or "diff")
    min_fps_cfg = getattr(ctx, "clip_min_fps", None)
    if min_fps_cfg is None:
        min_fps_cfg = os.environ.get("V2C_CLIP_MIN_FPS")
    try:
        min_fps = (float(min_fps_cfg) if min_fps_cfg is not None
                   else min(DIFF_MIN_FPS_DEFAULT, fps))
    except (TypeError, ValueError):
        min_fps = min(DIFF_MIN_FPS_DEFAULT, fps)
    min_fps = max(0.0, min(min_fps, fps))  # 保底不可能超过名义 fps 本身

    # 每段帧数 = round(dur*fps) (>=1); 全部段累计封顶 max_frames, 超了按比例降。
    try:
        max_frames = int(float(os.environ.get("V2C_CLIP_MAX_FRAMES") or MAX_TOTAL_FRAMES))
    except ValueError:
        max_frames = MAX_TOTAL_FRAMES
    max_frames = max(1, max_frames)
    if max_frames < len(parsed):
        return (f"[ERROR] V2C_CLIP_MAX_FRAMES={max_frames} cannot cover "
                f"{len(parsed)} segments with at least one frame each. "
                "Request fewer segments or increase the configured frame budget.")
    n_list = [max(1, round((e - s) * fps)) for (s, e) in parsed]
    total_n = sum(n_list)
    capped = total_n > max_frames
    if capped:
        # Reserve one frame per segment, then apportion the remaining budget
        # over requested extra frames. Largest remainders avoid both overshoot
        # from minimum-one clamping and unused budget from rounding down.
        remaining = max_frames - len(n_list)
        extra_total = total_n - len(n_list)
        shares = [divmod((n - 1) * remaining, extra_total) for n in n_list]
        n_list = [1 + whole for whole, _ in shares]
        order = sorted(range(len(shares)), key=lambda i: shares[i][1], reverse=True)
        for i in order[:max_frames - sum(n_list)]:
            n_list[i] += 1

    image_paths: list[str] = []
    info_lines: list[str] = []
    fail_lines: list[str] = []
    total_folded = 0
    total_roi = 0
    seen_ms: set[int] = set()  # 相邻段共享边界 (前段 end == 后段 start) 时去重, 不浪费帧预算
    for i, (s, e) in enumerate(parsed):
        ts_all = None
        if sample == "diff":
            ts_all = _diff_select_ts(src, s, e, n_list[i], min_fps)
        diff_used = ts_all is not None
        if ts_all is None:
            ts_all = _segment_ts(s, e, n_list[i])
        ts_list = []
        for ts in ts_all:
            key = int(round(ts * 1000))
            if key in seen_ms:
                continue
            seen_ms.add(key)
            ts_list.append(ts)
        if not ts_list:
            info_lines.append(f"  - segment {i} ({s:.2f}-{e:.2f}s): 0 帧 (时间戳与前面 segment 完全重复, 已去重)")
            continue
        tag = ", 差分选帧" if diff_used else ""
        if grid:
            raw_frames = _read_frames_at(src, ts_list, None)
            if not raw_frames:
                fail_lines.append(f"  - segment {i} ({s:.2f}-{e:.2f}s): 抽帧失败")
                continue
            frames = _dedup_frames(raw_frames, min_pct=CLIP_DEDUP_MIN_PCT)
            n_folded = len(raw_frames) - len(frames)
            if n_folded:
                tag += f", 折叠 {n_folded} 张白帧/近重复帧"
                total_folded += n_folded
            roi = _motion_roi(frames)
            if roi:
                import cv2
                (x0, y0, x1, y1), loc_idx = roi
                roi_w, roi_h = x1 - x0, y1 - y0
                # 全帧定位图: 红框标出动效区; 用贡献峰值帧 (段首帧可能还在滚动途中)
                ts0 = frames[loc_idx][0]
                locator = frames[loc_idx][1].copy()
                cv2.rectangle(locator, (x0, y0), (x1, y1), (0, 0, 255), 4)
                locator = resize_frame(locator, "medium")
                _draw_ts_label(locator, ts0)
                ctx_path = out_dir / f"seg{i:02d}_ctx_{int(round(ts0 * 1000))}ms.jpg"
                cv2.imwrite(str(ctx_path), locator,
                            [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
                # 裁剪格: 小 ROI 用原生分辨率 (不上采样); 大 ROI 保持与全帧 2 列
                # 相同的有效缩放 (sheet宽/2/帧宽 ≈ 0.54x) — 动效区看到的
                # 像素密度不低于全帧 2x2, 裁掉的背景就是省下的 token
                fh, fw = frames[0][1].shape[:2]
                sheet_w = _grid_sheet_width()
                if roi_w <= CLIP_CELL_MAX_W:
                    cell_w = roi_w
                else:
                    cell_w = max(sheet_w // 4,
                                 int(roi_w * sheet_w / (2 * fw)))
                cols = max(1, min(6, sheet_w // cell_w))
                cell_h = max(1, int(roi_h * cell_w / roi_w))
                max_rows = max(1, GRID_SHEET_MAX_H // cell_h)
                sheets = _build_grid_sheets(
                    [(t, f[y0:y1, x0:x1]) for t, f in frames], out_dir,
                    f"seg{i:02d}", cols=cols, max_cells=cols * max_rows,
                    cell_w=cell_w)
                if not sheets:
                    fail_lines.append(f"  - segment {i} ({s:.2f}-{e:.2f}s): 抽帧失败")
                    continue
                image_paths.append(str(ctx_path))
                image_paths.extend(str(p) for p in sheets)
                total_roi += 1
                info_lines.append(
                    f"  - segment {i} ({s:.2f}-{e:.2f}s): {len(frames)} 帧 → "
                    f"1 张全帧定位图 (红框=动效区) + {len(sheets)} 张网格图 "
                    f"(格子裁剪至动效区 {roi_w}x{roi_h}, 每格左上角标有时间戳{tag})")
                continue
            fh, fw = frames[0][1].shape[:2]
            cell_w_ff = _grid_sheet_width() // CLIP_GRID_COLS
            rows_ff = max(1, GRID_SHEET_MAX_H // max(1, int(fh * cell_w_ff / fw)))
            sheets = _build_grid_sheets(frames, out_dir, f"seg{i:02d}",
                                        cols=CLIP_GRID_COLS,
                                        max_cells=CLIP_GRID_COLS * rows_ff)
            if not sheets:
                fail_lines.append(f"  - segment {i} ({s:.2f}-{e:.2f}s): 抽帧失败")
                continue
            image_paths.extend(str(p) for p in sheets)
            info_lines.append(
                f"  - segment {i} ({s:.2f}-{e:.2f}s): {len(frames)} 帧 → "
                f"{len(sheets)} 张网格图 (每格左上角标有时间戳{tag})")
        else:
            frames, n_white = _extract_segment_frames(src, out_dir, i, ts_list, tier)
            if n_white:
                tag += f", 丢弃 {n_white} 张纯白帧"
            if not frames:
                if n_white:
                    info_lines.append(
                        f"  - segment {i} ({s:.2f}-{e:.2f}s): 0 帧 (全为纯白帧, 已丢弃)")
                else:
                    fail_lines.append(f"  - segment {i} ({s:.2f}-{e:.2f}s): 抽帧失败")
                continue
            image_paths.extend(str(p) for p in frames)
            dur = e - s
            eff = len(frames) / dur if dur > 0 else fps
            info_lines.append(f"  - segment {i} ({s:.2f}-{e:.2f}s): {len(frames)} 帧 @ {eff:.2g}fps{tag}")

    if not image_paths:
        return ("[ERROR] 所有 segment 抽帧失败:\n" + "\n".join(fail_lines)) if fail_lines \
               else "[ERROR] 所有 segment 抽帧失败 (未知原因)"

    virt_out = ctx.virtualize(out_dir)
    what = ("timestamped contact-sheet grid(s) — each cell is one frame labelled with its "
            "timestamp at the top-left corner; read cells left-to-right, top-to-bottom"
            ) if grid else ("timestamped images — study how the animation moves across the "
                            "frames, each frame is labelled with its time")
    text = (
        f"Extracted {len(image_paths)} image(s) across {len(info_lines)} segment(s) "
        f"of {raw_path}, saved at {virt_out}/ and inlined below "
        f"as {what}.\n" + "\n".join(info_lines)
    )
    if sample == "diff":
        text += ("\n[note] sample=diff: 帧取自画面变化最大的时刻 (非等间隔), "
                 "帧间时间差请以标注的时间戳为准。")
    if total_roi:
        text += (f"\n[note] grid: {total_roi} 个 segment 的格子按动效区域裁剪 — 每段先给"
                 "一张全帧定位图 (红框=裁剪区域), 其后的网格格子只显示红框内画面; "
                 "需要看红框外的内容请把该时刻拆成更短的时间窗重调。")
    if total_folded:
        text += (f"\n[note] grid: 已折叠 {total_folded} 张白帧/近重复帧 — 相邻格时间戳"
                 "跳变即该区间无显著变化 (但小幅局部动效在网格小格里也可能被折叠/看不清), "
                 "怀疑有细微动效时请对该时刻用更短的时间窗重调。")
    if capped:
        text += (f"\n[note] 请求 {fps:g}fps 累计超过 {max_frames} 帧上限, "
                 f"已按比例降帧; 各 segment 实际帧率见上。如需更密的帧, 请缩小时间窗分多次调用。")
    if fail_lines:
        text += "\n[partial failure]\n" + "\n".join(fail_lines)
    return ToolResult(text=text, image_paths=image_paths)


def _clip_as_video(src: Path, raw_path: str, parsed: list[tuple[float, float]],
                   out_dir: Path, ctx: RunContext):
    """video 模式: ffmpeg 切无音轨 mp4 片段 (带 size guard), 返回 video_paths。"""
    clip_paths: list[str] = []
    fail_lines: list[str] = []
    info_lines: list[str] = []
    cum_bytes = 0
    for i, (s, e) in enumerate(parsed):
        out = out_dir / f"clip_{i:02d}_{s:.2f}-{e:.2f}.mp4"
        ok, err, info = _encode_with_size_guard(src, out, s, e)
        if not ok:
            fail_lines.append(
                f"  - clip_{i:02d} ({s:.2f}-{e:.2f}): "
                f"{err.splitlines()[-1] if err else 'encode failed'}")
            continue
        size = info["size"]
        # 总字节预算 guard: 加上这一片若超 MAX_TOTAL_BYTES 就丢掉
        if cum_bytes + size > MAX_TOTAL_BYTES:
            fail_lines.append(
                f"  - clip_{i:02d}: 跳过 (累计 {cum_bytes + size:,} bytes > "
                f"{MAX_TOTAL_BYTES:,} 总预算; 已加 {len(clip_paths)} 段)")
            try:
                out.unlink()
            except OSError:
                pass
            continue
        cum_bytes += size
        clip_paths.append(str(out))
        prof_tag = f"p{info['profile_idx']}" + ("!" if info.get("over") else "")
        info_lines.append(
            f"  - {out.name} ({size:,} bytes, {prof_tag})"
        )

    if not clip_paths:
        return ("[ERROR] 所有 segment 切片失败:\n" + "\n".join(fail_lines)) if fail_lines \
               else "[ERROR] 所有 segment 切片失败 (未知原因)"

    virt_out = ctx.virtualize(out_dir)
    text = (
        f"Extracted {len(clip_paths)} clip(s) from {raw_path} "
        f"(累计 {cum_bytes:,} bytes raw, 预算 {MAX_TOTAL_BYTES:,}), "
        f"saved at {virt_out}/ and inlined into the next user turn for direct viewing.\n"
        + "\n".join(info_lines)
    )
    if fail_lines:
        text += "\n[partial failure]\n" + "\n".join(fail_lines)
    return ToolResult(text=text, video_paths=clip_paths)


# --------------------------------------------------------------------------- #
# 整片摄入 (ingest): 全片概览 contact sheet
# --------------------------------------------------------------------------- #

def _grid_start_ms(p: Path) -> int:
    """<prefix>_grid_<start_ms>ms_<end_ms>ms.jpg → start_ms; 解析失败排最后。"""
    m = re.search(r"_grid_(\d+)ms_", p.name)
    return int(m.group(1)) if m else 1 << 62


def _dump_fullres_frames(frames: list, out_dir: Path) -> Path:
    """把去重后的关键帧按全分辨率单帧落盘 (frames/still_<t>s.jpg)。

    隐藏缓存: ingest 输出不再向模型宣传这些文件 (Phase-1 走 still_crops 主动
    批量取帧, 见 ingest_video 文案), 但落盘保留 — still_crops/composite 命中
    相同时刻时可复用, 蒸馏/排查也用得上。"""
    import cv2
    fdir = out_dir / "frames"
    fdir.mkdir(parents=True, exist_ok=True)
    for ts, img in frames:
        p = fdir / f"still_{ts:.2f}s.jpg"
        if not p.exists():
            cv2.imwrite(str(p), img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return fdir


def build_ingest_sheets(video: Path, out_dir: Path,
                        fps: float = INGEST_FPS_DEFAULT,
                        max_frames: int = INGEST_MAX_FRAMES) -> list[Path]:
    """整片按 fps 抽帧 → 白帧/近重复折叠 (INGEST 阈值) → 4 列 contact sheet(s)。

    幂等: out_dir 下已有 video_grid_*.jpg 直接复用 (按起始 ms 数值排序 —
    字典序会把 103926ms 排到 39350ms 前面, 时间序错乱)。
    调用方: ingest_video 工具 (交互式) 与 scripts/batch_replicate.py (离线预抽帧),
    单一实现保证两条入口产出形态一致。"""
    out_dir.mkdir(parents=True, exist_ok=True)
    existing = sorted(out_dir.glob("video_grid_*.jpg"), key=_grid_start_ms)
    if existing:
        return existing
    dur = _video_duration(video)
    if dur <= 0:
        raise RuntimeError(f"视频时长读取失败: {video}")
    n = max(2, min(round(dur * fps), max(2, max_frames)))
    ts = _segment_ts(0.0, dur, n)
    frames = _read_frames_at(video, ts, None)
    if not frames:
        raise RuntimeError(f"抽帧失败: {video}")
    frames = _dedup_frames(frames)  # INGEST 阈值: 折白帧+布局级去重
    _dump_fullres_frames(frames, out_dir)
    return _build_grid_sheets(frames, out_dir, "video",
                              cols=GRID_COLS, max_cells=GRID_MAX_CELLS)


def ingest_video(args: dict, ctx: RunContext):
    """整片摄入: 布局级采样全片, 产出带时间戳的概览 contact sheet 并内联。

    args (模型可见的输入只有视频路径):
        video_path: 源视频路径 (相对项目目录或绝对路径, 走 ctx.resolve)

    采样参数由外部运行配置决定, 模型不可 per-call 覆盖:
        ctx.ingest_fps        / env V2C_INGEST_FPS        / INGEST_FPS_DEFAULT
        ctx.ingest_max_frames / env V2C_INGEST_MAX_FRAMES / INGEST_MAX_FRAMES
    """
    raw_path = args.get("video_path")
    if not raw_path:
        return "[ERROR] video_path 必填"
    try:
        src = ctx.resolve(raw_path)
    except Exception as e:
        return f"[ERROR] 无法解析 video_path={raw_path!r}: {e}"
    if not src.exists():
        return f"[ERROR] video not found: {raw_path}"
    if not src.is_file():
        return f"[ERROR] not a file: {raw_path}"

    try:
        fps = float(getattr(ctx, "ingest_fps", None)
                    or os.environ.get("V2C_INGEST_FPS")
                    or INGEST_FPS_DEFAULT)
    except (TypeError, ValueError):
        fps = INGEST_FPS_DEFAULT
    fps = max(0.1, fps)
    try:
        max_frames = int(float(getattr(ctx, "ingest_max_frames", None)
                               or os.environ.get("V2C_INGEST_MAX_FRAMES")
                               or INGEST_MAX_FRAMES))
    except (TypeError, ValueError):
        max_frames = INGEST_MAX_FRAMES
    max_frames = max(2, max_frames)

    out_dir = ctx.upload_dir / "_ingest_" / src.stem
    reused = out_dir.is_dir() and any(out_dir.glob("video_grid_*.jpg"))
    try:
        sheets = build_ingest_sheets(src, out_dir, fps, max_frames)
    except RuntimeError as e:
        return f"[ERROR] {e}"

    dur = _video_duration(src)
    vw = vh = 0
    try:
        import cv2
        cap = cv2.VideoCapture(str(src))
        vw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        vh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        cap.release()
    except Exception:
        pass
    virt_out = ctx.virtualize(out_dir)
    dims = f", {vw}x{vh}px" if vw and vh else ""
    text = (
        f"Ingested {raw_path} ({dur:.1f}s{dims}): {len(sheets)} timestamped contact sheet(s) "
        f"saved at {virt_out}/ and inlined below. Each cell is one frame labelled with "
        "its timestamp at the top-left corner; read cells left-to-right, top-to-bottom. "
        "Blank/near-duplicate frames are folded away — a jump between adjacent "
        "timestamps means nothing changed in between. This is a layout-level overview: "
        "to study any moment closely (animation, interaction, transition), call "
        "clip_video with that time window.\n"
        + "\n".join(f"  - {ctx.virtualize(p)}" for p in sheets)
        + "\nFor Phase-1 layout measuring: pick each section's SETTLED moment off the "
        "sheet (cells are timestamped) and pull those full-resolution frames in ONE "
        "still_crops(video, times=[...]) call — every section's timestamp in the same "
        "call. A scroll recording shows the same section at many offsets; one settled "
        "frame per section is the complete layout evidence — do not pull full-res "
        "frames one by one, and skip moments the sheet already shows as near-duplicates."
    )
    if reused:
        text += ("\n[note] 该视频此前已完成摄入, 本次直接复用已生成的 sheet "
                 "(内容与上次完全相同, 已细读过可不必重看)。")
    return ToolResult(text=text, image_paths=[str(p) for p in sheets])
