"""render_narrated: EDL → 带解说配音 + 字幕 + BGM 的最终成片。

从 movie_cut 移植三个模块并合为一个 MCP 工具(逻辑逐行保真, JSON/文件契约不变):
  - step_e_render.render   成片渲染(seg级切片缓存断点续跑/呼吸尾tail_sec/
                            音画漂移硬校验/响度QC/原声让位)
  - step_subtitle.build_srt 句级字幕 + 均衡换行
  - step_bgm.build_from_edl BGM 按故事场景分组垫乐(原声段静音让位)

与源版的差异(见文件尾注释"移植取舍"):
  - HDR tonemap 前缀改为运行时 ffprobe 探测(源版读 probe.json)
  - BGM 素材运行时从 bgm_dir(VE_BGM_DIR) 读, 并过滤带视频流(内嵌封面
    attached_pic)的文件 —— 该类 mp3 会让拼接挂起
  - 字幕字体走共用 CJK 查找(subtitle_style.find_cjk_font: VE_FONT_DIRS -> fontconfig ->
    常见路径, 按 cmap 校验覆盖); 找不到直接返回 "[ERROR] no CJK-capable font ...", 不再静默跳过
  - 不移植: LLM 相关 / intro+outro 片头尾卡 / keep_original_audio 全程 ducking
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import os
import re
import shlex
import shutil
import subprocess
import time
import threading
from concurrent.futures import ThreadPoolExecutor
from fractions import Fraction
from pathlib import Path
from typing import Any

from .result import ToolResult
from .run_context import RunContext, clean_env
from .recap_runtime_state import RuntimeBusy
from . import subtitle_style as sty
from . import movie_subtitles
from .creation_planning import file_digest
from .creation_takes import read_object, write_object
from .file_contract import output_locks, protect_outputs, protect_directories

# ---------------------------------------------------------------------------
# 统一输出规格(保证切片可无缝拼接) + 渲染调优旋钮(环境变量可覆盖, 与源版一致)
# ---------------------------------------------------------------------------
# FPS 只是无片源信息时的兜底; 每次渲染按片源帧率归一到标准帧率(见 output_fps)
W, H, FPS, PIXFMT = 1920, 1080, 24, "yuv420p"
STANDARD_FPS = (Fraction(24000, 1001), Fraction(24), Fraction(25), Fraction(30000, 1001),
                Fraction(30), Fraction(50), Fraction(60000, 1001), Fraction(60))
# 工作音频格式: 48 kHz 立体声全程(原声保留立体声, 单声道 TTS 在此统一上混)
AUDIO_RATE = 48000
_AFMT = f"aresample={AUDIO_RATE},aformat=sample_fmts=fltp:sample_rates={AUDIO_RATE}:channel_layouts=stereo"
_WAV = ["-ar", str(AUDIO_RATE), "-ac", "2", "-c:a", "pcm_s24le"]
# 切片/缓存/输出配方版本: 改动切法、格式或指纹组成时递增, 旧缓存不会被误用
RENDER_VERSION = "movie-render-v6-lossless-48k"


# 沿用已有的 VE_RENDER_<NAME> 覆盖的旋钮; 其余(编码/响度/帧率/漂移/音轨)是固定默认值,
# 不新增环境变量(测试直接改模块常量)。
_ENV_KNOBS = frozenset({"PRESET", "ENC_THREADS", "CUT_WORKERS", "SPEEDUP", "BED_VOLUME",
                        "TAIL_VOLUME", "NARR_GAIN"})


def _knob(name: str, default: str) -> str:
    """渲染旋钮: VE_RENDER_<NAME> 优先, 兼容旧名 RENDER_<NAME>; 经 clean_env 读
    (进程 env > 项目 .env > 插件 .env —— Codex 环境变量白名单下裸 os.environ 拿不到)。"""
    if name not in _ENV_KNOBS:
        return default
    return clean_env(f"VE_RENDER_{name}", f"RENDER_{name}") or default


def _knob_float(name: str, default: float) -> float:
    try:
        return float(_knob(name, str(default)))
    except ValueError:
        return default


def _knob_int(name: str, default: int) -> int:
    try:
        return int(_knob(name, str(default)))
    except ValueError:
        return default


_DEFAULT_THREADS = min(8, os.cpu_count() or 4)
# 中间片段编码预设(无损, 预设只影响速度/体积, 不影响画质)
PRESET = _knob("PRESET", "veryfast")
ENC_THREADS = _knob("ENC_THREADS", str(_DEFAULT_THREADS))
# 中间片段量化: 0 = x264 数学无损(多代切/补帧/拼接零损失); 磁盘吃紧可设 4~10(视觉无损)
INTER_QP = _knob_int("INTERMEDIATE_QP", 0)
# 成片唯一一次交付编码
FINAL_PRESET = _knob("FINAL_PRESET", "medium")
FINAL_CRF = _knob_float("FINAL_CRF", 18.0)
AUDIO_BITRATE = _knob("AUDIO_BITRATE", "256k")
# 输出帧率: auto=跟片源(归一到标准帧率, 上限 60); 也可写 24 / 25 / 24000/1001 / 23.976
OUTPUT_FPS = _knob("FPS", "auto")
# 并发切片数: 默认跟核数走(上限 8), 不再固定 24 x -threads 8 把机器打满
CUT_WORKERS = _knob_int("CUT_WORKERS", _DEFAULT_THREADS)
# 快速 seek: -ss 放 -i 前跳到最近关键帧, 再用输出端 -ss 补精度(大 GOP 源留 12s 缓冲)
PRESEEK = 12.0
# 成片整体变速(默认原速)
SPEEDUP = _knob_float("SPEEDUP", 1.0)
# 解说底下铺原片原声的音量(环境声透出来); 0=关闭
BED_VOL = _knob_float("BED_VOLUME", 0.0)
# 呼吸留白段的原片原声音量:0=留白静音。
# 0.85 留白原声与解说同响像"杂音"; 0.4 仍会漏出电影台词半句被掐断
# (8-25 用户实锤"ei的一声"=台词 203.35s"这里又没有其他人哦"漏出被切)。
# 定案:解说就是解说, 留白只演画面不出声; 原声只在高潮 original_audio 段整段放。
TAIL_VOL = _knob_float("TAIL_VOLUME", 0.0)
# 留白原声尾末淡出时长(消掉下一句开讲瞬间掐断原声的啪嗒感)
TAIL_AUDIO_FADEOUT = 0.15
# 时间跳跃硬切的视频短过渡时长(顺接续播不加, 保解说片硬朗质感)
# 0.08 首版被用户反馈"画面不自然"(黑场闪), 收紧到 0.05 只留柔和边缘
# 跳跃切点压暗过渡: 0.08/0.05 两版实听都被评为"画面闪的很奇怪", 置 0 回到硬切
JUMP_FADE_D = 0.0
# 相邻窗口起止差 <= 该秒数视为顺接(原片自己的剪辑点), 不加过渡
JUMP_TOL = 0.1
# 解说增益: 不设(参数/环境变量)时按实测响度自动对齐到分轨工作电平(STEM_LUFS)
NARR_GAIN = _knob_float("NARR_GAIN", 0.0) or None
# 响度: 解说/原声分轨统一到 STEM_LUFS(实测线性增益, 不做逐段动态压缩),
# 成片再做一次两遍实测 loudnorm(EBU R128) 到交付目标
STEM_LUFS = _knob_float("STEM_LUFS", -18.0)
LOUDNESS_I = _knob_float("LOUDNESS_I", -16.0)
LOUDNESS_TP = _knob_float("LOUDNESS_TP", -1.5)
LOUDNESS_LRA = _knob_float("LOUDNESS_LRA", 11.0)
MASTER_LOUDNORM = _knob("LOUDNORM", "1") != "0"
# 上游漂移硬门禁: 解说实测时长与计划/画面的允许偏差(秒)
DRIFT_TOL = _knob_float("DRIFT_TOLERANCE", 0.25)
# 片源多音轨选择: 显式序号(第 N 条音轨, 0 起) > 语言(逗号分隔, 如 chi,zho) > default 标记 > 第一条
AUDIO_TRACK = _knob("AUDIO_TRACK", "")
AUDIO_LANGUAGE = _knob("AUDIO_LANGUAGE", "")
# 超过该体积的输入按 (路径, 大小, mtime_ns, ctime_ns, inode) 缓存 SHA-256, 不再每次全片重算
DIGEST_CACHE_MIN_BYTES = 64 * 1024 * 1024

# V3 EDL 渲染前硬门禁的最小窗口时长(源: step_event_bind.MIN_WINDOW_SEC)
MIN_WINDOW_SEC = 1.25

# ffmpeg 长任务超时(秒)
FF_TIMEOUT = 3600

# 渲染过程日志与每次调用的音量覆盖都放线程本地: MCP server 用 2 个 worker 线程
# (server_common VE_MCP_WORKERS), 两次 render_narrated 并发时模块全局会互踩 —
# A 的日志被 B 清空, A 后半段按 B 的 bed_volume 混音且把错值烙进缓存指纹。
# 切片线程池的 worker 经 _bind_state 继承调用线程的全部状态(日志/音量/帧率/输入哈希)。
_STATE = threading.local()


def _log_lines() -> list[str]:
    lines = getattr(_STATE, "log", None)
    if lines is None:
        lines = _STATE.log = []
    return lines


def _log(msg: str) -> None:
    _log_lines().append(msg)


def _bind_state(fn):
    """把调用线程的渲染状态带进线程池 worker(否则 worker 里日志丢失、音量回落默认)。"""
    _log_lines()
    snapshot = dict(vars(_STATE))

    def bound(*args, **kwargs):
        vars(_STATE).update(snapshot)
        return fn(*args, **kwargs)
    return bound


def _bed_vol() -> float:
    return getattr(_STATE, "bed_vol", BED_VOL)


def _narr_gain() -> float | None:
    return getattr(_STATE, "narr_gain", NARR_GAIN)


def _tail_vol() -> float:
    return getattr(_STATE, "tail_vol", TAIL_VOL)


def _fps_q() -> Fraction:
    return getattr(_STATE, "fps", None) or Fraction(FPS).limit_denominator(1001)


def _fps() -> float:
    return float(_fps_q())


def _fps_arg() -> str:
    q = _fps_q()
    return str(q.numerator) if q.denominator == 1 else f"{q.numerator}/{q.denominator}"


def _frames(seconds: float) -> int:
    """秒 → 输出整帧数(帧数驱动裁切, 不再用 -t 秒数四舍五入多出一帧)。"""
    return max(1, int(round(float(seconds) * _fps() + 1e-9)))


def _inter_v() -> list[str]:
    return ["-c:v", "libx264", "-preset", PRESET, "-qp", str(INTER_QP), "-pix_fmt", PIXFMT,
            "-threads", ENC_THREADS]


def _final_v() -> list[str]:
    return ["-c:v", "libx264", "-preset", FINAL_PRESET, "-crf", f"{FINAL_CRF:g}", "-pix_fmt", PIXFMT,
            "-profile:v", "high", "-threads", ENC_THREADS]


def _nearest_standard(value: Fraction) -> Fraction:
    while value > Fraction(605, 10):
        value /= 2
    return min(STANDARD_FPS, key=lambda q: (abs(float(q - value)), q))


def output_fps(video: str, timeline: dict | None = None, override: str | None = None) -> Fraction:
    """输出帧率: 显式覆盖 > 片源(timeline fps_num/fps_den, 否则 ffprobe avg/r_frame_rate),
    归一到最近的标准帧率(23.976/24/25/29.97/30/50/59.94/60), 高帧率按半分降到 ≤60。"""
    raw = str(override or OUTPUT_FPS or "auto").strip().lower()
    if raw not in ("", "auto", "source"):
        value = Fraction(raw).limit_denominator(1001)
        if not 0 < value <= 120:
            raise ValueError(f"invalid output fps: {raw}")
        close = [q for q in STANDARD_FPS if abs(float(q - value)) < 0.01]
        return close[0] if close else value
    timeline = timeline if isinstance(timeline, dict) else {}
    value = None
    if timeline.get("fps_num") and timeline.get("fps_den"):
        value = Fraction(int(timeline["fps_num"]), int(timeline["fps_den"]))
    if value is None:
        info = _probe_video(video)
        for key in ("avg_frame_rate", "r_frame_rate"):
            try:
                rate = Fraction(str(info.get(key) or "0/0"))
            except (ValueError, ZeroDivisionError):
                continue
            if 0 < rate <= 1000:
                value = rate
                break
    if value is None and timeline.get("fps"):
        value = Fraction(float(timeline["fps"])).limit_denominator(1001)
    return _nearest_standard(value) if value else Fraction(FPS)


# ---------------------------------------------------------------------------
# 公共小工具(从 movie_cut/pipeline/common.py 抄入)
# ---------------------------------------------------------------------------

def load_json(path: str | Path) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def run(cmd: list[str], check: bool = True,
        timeout: float = FF_TIMEOUT) -> subprocess.CompletedProcess:
    """跑一条命令; ffmpeg 强制 -nostdin, 失败把 stderr 抛出来。"""
    if cmd and Path(cmd[0]).name == "ffmpeg" and "-nostdin" not in cmd:
        cmd = [cmd[0], "-nostdin", *cmd[1:]]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if check and proc.returncode != 0:
        raise RuntimeError(
            f"命令失败 (exit {proc.returncode}):\n  {shlex.join(cmd)}\n"
            f"--- stderr ---\n{proc.stderr[-3000:]}"
        )
    return proc


def media_duration(path: str | Path, stream: str = "v") -> float:
    """单独取某条流的时长(v=视频, a=音频), 用于缓存校验与成片自检。"""
    cmd = ["ffprobe", "-v", "error", "-select_streams", f"{stream}:0",
           "-show_entries", "stream=duration",
           "-of", "default=noprint_wrappers=1:nokey=1", str(path)]
    out = run(cmd, check=False, timeout=60).stdout.strip()
    try:
        return float(out)
    except ValueError:
        # 有些容器流里没存 duration, 回退到 format
        cmd2 = ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", str(path)]
        return float(run(cmd2, timeout=60).stdout.strip() or 0.0)


_PROBE_CACHE: dict[tuple, dict] = {}
_PROBE_LOCK = threading.Lock()


def _probe_key(path: str, kind: str) -> tuple:
    p = Path(path)
    try:
        st = p.stat()
        return (kind, str(p.resolve()), st.st_size, st.st_mtime_ns, st.st_ino)
    except OSError:
        return (kind, str(p), 0, 0, 0)


def _probe_video(video: str) -> dict:
    """首条视频流的规格/色彩/HDR 元数据(按文件签名缓存)。"""
    key = _probe_key(video, "v")
    with _PROBE_LOCK:
        if key in _PROBE_CACHE:
            return _PROBE_CACHE[key]
    r = run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
             "stream=codec_name,codec_tag_string,width,height,sample_aspect_ratio,pix_fmt,"
             "color_transfer,color_primaries,color_space,color_range,avg_frame_rate,r_frame_rate:"
             "stream_side_data", "-of", "json", str(video)], check=False, timeout=60)
    try:
        info = (json.loads(r.stdout or "{}").get("streams") or [{}])[0]
    except ValueError:
        info = {}
    with _PROBE_LOCK:
        _PROBE_CACHE[key] = info
    return info


def source_audio_stream(video: str) -> dict | None:
    """确定性选片源音轨, 全渲染层一致使用(-map 0:a:N); 无音轨返回 None。
    优先级: AUDIO_TRACK 序号 > AUDIO_LANGUAGE > disposition.default > 第一条(两个常量默认为空)。"""
    key = _probe_key(video, "a") + (AUDIO_TRACK, AUDIO_LANGUAGE)
    with _PROBE_LOCK:
        if key in _PROBE_CACHE:
            return _PROBE_CACHE[key] or None
    r = run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries",
             "stream=index,codec_name,channels,sample_rate:stream_tags=language:stream_disposition=default",
             "-of", "json", str(video)], check=False, timeout=60)
    try:
        streams = json.loads(r.stdout or "{}").get("streams") or []
    except ValueError:
        streams = []
    pick = None
    if streams:
        languages = [x.strip().lower() for x in AUDIO_LANGUAGE.split(",") if x.strip()]
        if AUDIO_TRACK.strip().isdigit() and int(AUDIO_TRACK) < len(streams):
            pick, reason = int(AUDIO_TRACK), "configured_index"
        elif languages and any((st.get("tags") or {}).get("language", "").lower() in languages for st in streams):
            pick, reason = next(i for i, st in enumerate(streams)
                                if (st.get("tags") or {}).get("language", "").lower() in languages), "language"
        elif any((st.get("disposition") or {}).get("default") == 1 for st in streams):
            pick, reason = next(i for i, st in enumerate(streams)
                                if (st.get("disposition") or {}).get("default") == 1), "default_disposition"
        else:
            pick, reason = 0, "first"
    value = {} if pick is None else {
        "position": pick, "index": streams[pick].get("index"), "count": len(streams), "reason": reason,
        "channels": streams[pick].get("channels"), "codec": streams[pick].get("codec_name"),
        "language": (streams[pick].get("tags") or {}).get("language")}
    with _PROBE_LOCK:
        _PROBE_CACHE[key] = value
    return value or None


def hdr_info(video: str) -> dict:
    """HDR/杜比视界判定。DV profile 5 无 HDR10 兼容基础层(IPT-PQ-c2), 普通 tonemap 会偏色,
    只能告警; profile 7/8 的基础层按 HDR10/HLG 正常 tonemap。"""
    info = _probe_video(video)
    transfer = str(info.get("color_transfer") or "")
    dv = next((d for d in info.get("side_data_list") or []
               if "dovi" in str(d.get("side_data_type", "")).lower()
               or "dolby vision" in str(d.get("side_data_type", "")).lower()), None)
    tag = str(info.get("codec_tag_string") or "").lower()
    profile = dv.get("dv_profile") if dv else ("unknown" if tag in {"dvh1", "dvhe", "dva1", "dvav"} else None)
    hdr = transfer in {"smpte2084", "arib-std-b67"}
    value = {"transfer": transfer or None, "primaries": info.get("color_primaries"),
             "dolby_vision_profile": profile, "tonemap": hdr, "warning": None}
    if profile is not None and (profile == 5 or not hdr):
        value["warning"] = (f"Dolby Vision profile {profile} has no HDR10/HLG base layer; "
                            "colours after tone mapping may be wrong")
    return value


def hdr_vf(video: str) -> str:
    """HDR 片源的 tonemap 前缀滤镜, SDR 返回空串。按 ffprobe 实测的色彩元数据显式声明输入,
    线性光转 gbrpf32le 后再 tonemap(否则 HDR 直出 x264+yuv420p 整体发灰)。"""
    info = _probe_video(video)
    transfer = str(info.get("color_transfer") or "")
    if transfer not in {"smpte2084", "arib-std-b67"}:
        return ""
    primaries = "bt2020" if str(info.get("color_primaries") or "bt2020") in {"bt2020", "unknown", ""} \
        else str(info["color_primaries"])
    matrix = {"bt2020c": "2020_cl"}.get(str(info.get("color_space") or ""), "2020_ncl")
    rng = "pc" if info.get("color_range") == "pc" else "tv"
    return (f"zscale=tin={transfer}:pin={primaries}:min={matrix}:rin={rng}:t=linear:npl=100,"
            "format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,"
            "zscale=t=bt709:m=bt709:r=tv,format=yuv420p,")


def _picture_vf(video: str) -> str:
    """统一画面规格: HDR→SDR, 非方像素先还原显示宽高比(setsar=1), 等比缩放+黑边, 整帧率。"""
    return (hdr_vf(video) + "scale='trunc(iw*sar/2)*2':ih,setsar=1,"
            f"scale={W}:{H}:force_original_aspect_ratio=decrease:force_divisible_by=2,"
            f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={_fps_arg()}")


def clips_directory(work_dir: Path) -> Path:
    """无损中间片目录(work_dir/clips)。电影任务导出 /workspace 前由宿主流程删除它,
    避免把十几 GB 的中间片打进导出包(重渲染时按切片计划重切)。"""
    return Path(work_dir) / "clips"


_DIGEST_LOCK = threading.Lock()
_DIGEST_MEMO: dict[str, str] = {}


def _cached_digest(path: Path, store: Path | None = None) -> str:
    """大文件(整部片源)的 SHA-256 按 (路径, 大小, mtime_ns, ctime_ns, inode, 设备) 缓存到 store;
    任一变化即重算。小文件直接算。ctime 不能由用户态设置, 改过的文件不会命中旧记录。"""
    path = Path(path)
    if store is None:
        return file_digest(path)
    st = path.stat()
    if st.st_size < DIGEST_CACHE_MIN_BYTES:
        return file_digest(path)
    key = json.dumps([str(path.resolve()), st.st_size, st.st_mtime_ns, st.st_ctime_ns, st.st_ino, st.st_dev])

    def load() -> dict:
        try:
            return read_object(store)
        except (OSError, ValueError):
            return {}
    with _DIGEST_LOCK:
        known = _DIGEST_MEMO.get(key) or load().get(key)
    if isinstance(known, str):
        _DIGEST_MEMO[key] = known
        return known
    digest = file_digest(path)
    after = path.stat()
    if (after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (st.st_size, st.st_mtime_ns, st.st_ctime_ns):
        return digest
    with _DIGEST_LOCK:
        _DIGEST_MEMO[key] = digest
        prefix = json.dumps([str(path.resolve())])[:-1]
        cache = {k: v for k, v in load().items() if not k.startswith(prefix)}
        cache[key] = digest
        Path(store).parent.mkdir(parents=True, exist_ok=True)
        write_object(store, cache)
    return digest


# ---------------------------------------------------------------------------
# 字幕(从 step_subtitle.py 抄入)
# ---------------------------------------------------------------------------

def split_sentences(text: str) -> list[str]:
    """按中文标点拆短句, 保留语义完整。过长的逗号句也拆。"""
    parts = re.split(r"(?<=[。！？；])", text)
    out = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if len(p) > 20:
            sub = re.split(r"(?<=[，、])", p)
            out.extend([x.strip() for x in sub if x.strip()])
        else:
            out.append(p)
    return out


def balanced_wrap(text: str, width: int = 20) -> str:
    """长句均衡换行: 行数按总长均分, 不留单字行; 断点优先标点后, 其次词边界
    (助词后/介词连词前), 不在数字或词内断开(见 movie_subtitles.wrap_cue)。"""
    return movie_subtitles.wrap_cue(text, width)


def fmt_ts(sec: float) -> str:
    """秒 → SRT 时间戳 HH:MM:SS,mmm"""
    total_ms = max(0, int(round(sec * 1000)))
    total_s, ms = divmod(total_ms, 1000)
    h, rem = divmod(total_s, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def build_srt(script_path: str, out_path: str, edl_path: str | None = None) -> int:
    """句级字幕: 段起点按 EDL 最终画面时长(整帧取整)累加, 消除长片累计漂移。
    返回字幕条数。"""
    segs = load_json(script_path)
    edl_durations = {}
    if edl_path:
        edl = load_json(edl_path)
        rows = edl.get("segments", []) if isinstance(edl, dict) else edl
        edl_durations = {
            str(row.get("seg_id")): float(row.get("video_dur", 0) or 0)
            for row in rows
            if row.get("seg_id") and float(row.get("video_dur", 0) or 0) > 0
        }
    cues = []
    spans: list[tuple[str, float, float]] = []
    seg_start = 0.0
    for s in segs:
        dur = s.get("audio_dur")
        if not dur or dur <= 0:
            # 该段 TTS 失败/无音频 —— 已被 EDL/渲染丢弃, 字幕同样跳过
            continue
        # 优先用 TTS 逐句合成产出的真实句级时间轴(精确对齐, 零漂移)
        if s.get("sentences"):
            for sent in s["sentences"]:
                cues.append((seg_start + sent["start"], seg_start + sent["end"],
                             sent.get("subtitle_text", sent.get("text", ""))))
        else:
            # 回退: 按字数比例均分(有漂移)
            sents = split_sentences(s.get("subtitle_text", s["text"]))
            total_chars = sum(len(x) for x in sents) or 1
            t = seg_start
            for sent in sents:
                d = dur * len(sent) / total_chars
                cues.append((t, t + d, sent))
                t += d
        # 以最终 EDL 时长推进, 微小余量留在本段末尾, 不传递成全片累计漂移
        seg_end = seg_start + edl_durations.get(str(s.get("seg_id")), dur)
        spans.extend([(str(s.get("seg_id")), seg_start, seg_end)] * (len(cues) - len(spans)))
        seg_start = seg_end

    rows = movie_subtitles.fit_cue_timing(
        [{"start": st, "end": en, "text": text, "scene": sid, "scene_start": a, "scene_end": b}
         for (st, en, text), (sid, a, b) in zip(cues, spans)])
    _write_srt(rows, out_path)
    _log(f"[字幕] {len(rows)} 条字幕 → {out_path}")
    return len(rows)


def _write_srt(rows: list[dict], out_path: str) -> None:
    lines = [f"{i}\n{fmt_ts(r['start'])} --> {fmt_ts(r['end'])}\n{balanced_wrap(r['text'])}\n"
             for i, r in enumerate(rows, 1)]
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def _recap_font_family(font_file: str, text: str) -> str:
    # Noto's TTC starts with JP, while the accepted recap used its SC face.
    # Keep that face preference within the selected, coverage-checked file;
    # do not replace explicitly configured custom font files.
    if Path(font_file).suffix.lower() == ".ttc":
        try:
            from fontTools.ttLib import TTCollection

            required = {ord(ch) for ch in text if sty._is_han(ch)}
            with TTCollection(font_file, lazy=True) as collection:
                for preferred in ("Noto Sans CJK SC", "Noto Sans CJK TC"):
                    for font in collection.fonts:
                        names = font["name"]
                        family = names.getDebugName(16) or names.getDebugName(1)
                        if family == preferred and required.issubset(font.getBestCmap() or {}):
                            return preferred
        except Exception:
            pass
    return sty.font_family_name(font_file) or "Noto Sans CJK SC"


def _detect_cjk_font(text: str = "") -> dict:
    """共用 CJK 字体查找(VE_FONT_DIRS -> fontconfig -> 常见路径, 按 cmap 校验覆盖 text 的每个汉字)。
    每次渲染用实际要烧的全部字幕文字调用一次, 结果显式传给 _mux(不写模块全局, 并发渲染互不干扰):
    {"file", "fontsdir"(喂 libass), "family"(libass 匹配名), "error"("[ERROR] ..." 或 None)}。"""
    sample = text or sty.CJK_PROBE_TEXT
    found = sty.find_cjk_font(sample)
    if found.startswith("[ERROR]"):
        return {"file": None, "fontsdir": None, "family": None, "error": found}
    return {"file": found, "fontsdir": sty.libass_fontsdir(found),
            "family": _recap_font_family(found, sample), "error": None}


def _subtitle_text(script_path: str | Path, rows: list[dict]) -> str:
    """成片会烧录的全部字幕文字: 解说稿 + 原声段台词字幕。"""
    lines = [str(line.get("text", "")) for row in rows if isinstance(row, dict)
             for line in row.get("subtitle_lines") or [] if isinstance(line, dict)]
    return _script_text_sample(script_path) + "".join(lines)


def _script_text_sample(script_path: str | Path) -> str:
    """解说稿里会上字幕的全部文本(用于校验字体 cmap 是否覆盖每个汉字); 读不出来返回空串。"""
    try:
        segs = load_json(str(script_path))
    except Exception:
        return ""
    out: list[str] = []

    def walk(node) -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                if k in ("text", "subtitle_text", "spoken_text", "narration") and isinstance(v, str):
                    out.append(v)
                else:
                    walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(segs)
    return "".join(out)


# ---------------------------------------------------------------------------
# BGM(从 step_bgm.py 抄入; 素材库目录由调用方传入, 不再指向 movie_cut/assets)
# ---------------------------------------------------------------------------

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


EMOTION_CHORD = {
    "warm":   [261.63, 329.63, 392.00],   # C4 E4 G4 大三
    "happy":  [261.63, 329.63, 392.00],
    "sad":    [220.00, 261.63, 329.63],   # A3 C4 E4 小三
    "tragic": [220.00, 261.63, 329.63],
    "tense":  [246.94, 293.66, 349.23],   # B3 D4 F4 减
    "epic":   [130.81, 164.81, 196.00],   # C3 E3 G3 低厚
    "neutral": [261.63, 329.63, 392.00],
}

_BGM_HAS_VIDEO_CACHE: dict[str, bool] = {}


def _bgm_has_video(path: str) -> bool:
    """音乐文件是否带视频流(内嵌封面 attached_pic)——这种 mp3 会让拼接挂起,
    选文件时过滤掉。探测失败按'有视频'处理(宁可不选, 不冒挂起风险)。"""
    if path not in _BGM_HAS_VIDEO_CACHE:
        try:
            r = run(["ffprobe", "-v", "error", "-select_streams", "v",
                     "-show_entries", "stream=index", "-of", "csv=p=0", path],
                    check=False, timeout=60)
            _BGM_HAS_VIDEO_CACHE[path] = (r.returncode != 0) or bool(r.stdout.strip())
        except Exception:
            _BGM_HAS_VIDEO_CACHE[path] = True
    return _BGM_HAS_VIDEO_CACHE[path]


def lib_pick(bgm_dir: str, emotion: str, key: str = "",
             avoid: str | None = None) -> str | None:
    """从音乐库 bgm_dir/<emotion>/*.mp3|m4a 按情绪挑一首。
    确定性选曲(按 key 哈希): 同一部片重跑选同一首; avoid=上一组用过的曲子,
    同情绪连续场景尽量换曲。找不到该情绪则尝试 neutral, 再无则 None。"""
    for emo in (emotion, "neutral"):
        d = Path(bgm_dir) / emo
        if d.is_dir():
            files = sorted([str(p) for p in d.glob("*.mp3")] +
                           [str(p) for p in d.glob("*.m4a")])
            files = [f for f in files if not _bgm_has_video(f)]
            if files:
                idx = int(hashlib.sha256(f"{emo}|{key}".encode()).hexdigest(), 16) % len(files)
                pick = files[idx]
                if avoid and pick == avoid and len(files) > 1:
                    pick = files[(idx + 1) % len(files)]
                return pick
    return None


def synth_segment(freqs: list[float], dur: float, out: str, fade: float = 1.5) -> None:
    """合成一段和弦氛围乐: 多正弦叠加 + 混响 + 低通柔化 + 首尾淡入淡出。"""
    inputs = []
    for f in freqs:
        inputs += ["-f", "lavfi", "-i", f"sine=frequency={f}:duration={dur:.2f}"]
    n = len(freqs)
    mix = "".join(f"[{i}]" for i in range(n))
    fc = (f"{mix}amix=inputs={n},volume=2.0,"
          f"aecho=0.8:0.7:60:0.4,lowpass=f=1800,"
          f"afade=t=in:d={fade},afade=t=out:st={max(0, dur - fade):.2f}:d={fade},{_AFMT}[a]")
    run(["ffmpeg", "-y", *inputs, "-filter_complex", fc, "-map", "[a]", *_WAV, out])


def fit_clip(src: str, dur: float, out: str, fade: float = 1.0) -> None:
    """把一段音乐裁切或循环到 dur 秒, 并加首尾淡入淡出。"""
    src_dur = media_duration(src, "a")
    loops = max(0, int(dur // max(src_dur, 0.1)))   # 需要额外循环几遍
    af = f"{_AFMT},afade=t=in:d={fade},afade=t=out:st={max(0, dur - fade):.2f}:d={fade}"
    run(["ffmpeg", "-y", "-stream_loop", str(loops), "-i", src, "-map", "0:a:0",
         "-t", f"{dur:.6f}", "-af", af, *_WAV, out])


def make_segment(bgm_dir: str, emotion: str, dur: float, out: str,
                 user_bgm: str | None, key: str = "",
                 avoid: str | None = None) -> tuple[str, str | None]:
    """单段 BGM, 三档优先级: 库 > 用户自备 > 合成。返回(来源标记, 曲目路径或None)。"""
    lib = lib_pick(bgm_dir, emotion, key=key, avoid=avoid)
    if lib:
        fit_clip(lib, dur, out)
        return f"库:{Path(lib).name}", lib
    if user_bgm:
        fit_clip(user_bgm, dur, out)
        return "用户自备", user_bgm
    synth_segment(EMOTION_CHORD.get(emotion, EMOTION_CHORD["neutral"]), dur, out)
    return "合成", None


def _silence(dur: float, out: str) -> None:
    """原声穿插段的 BGM 占位: 纯静音(电影自己说话的时刻, 配乐必须让位)。"""
    run(["ffmpeg", "-y", "-f", "lavfi", "-i", f"anullsrc=r={AUDIO_RATE}:cl=stereo",
         "-t", f"{dur:.6f}", *_WAV, out])


def _scene_groups(edl: list) -> list[dict]:
    """按故事场景合并连续 EDL 段; 原声穿插段单独成组(静音)。
    一场戏一首曲、场景边界才换曲, 配乐才跟着剧情走。"""
    groups: list[dict] = []
    for e in edl:
        dur = float(e.get("video_dur") or
                    (e.get("audio_dur", 0) + e.get("tail_sec", 0.0)))
        emo = normalize_emotion(e.get("emotion", "neutral"))
        oa = bool(e.get("original_audio"))
        key = f"oa:{e['seg_id']}" if oa else (e.get("story_scene_id") or e["seg_id"])
        if groups and not oa and not groups[-1]["oa"] and groups[-1]["key"] == key:
            groups[-1]["dur"] += dur
            groups[-1]["emotions"][emo] = groups[-1]["emotions"].get(emo, 0.0) + dur
        else:
            groups.append({"key": key, "oa": oa, "dur": dur, "emotions": {emo: dur}})
    return groups


def build_from_edl(edl_path: str, out: str, work: str, bgm_dir: str,
                   user_bgm: str | None = None) -> None:
    """按故事场景分组选 BGM(场景内一首到底, 时长加权主情绪), 再交叉淡化拼接。
    原声穿插段静音让位。"""
    edl = load_json(edl_path)
    Path(work).mkdir(parents=True, exist_ok=True)
    groups = _scene_groups(edl)
    parts, timeline_durations = [], []
    xfade = 1.0
    prev_track: str | None = None
    for gi, g in enumerate(groups):
        dur = g["dur"]
        p = f"{work}/bgm_g{gi:03d}.wav"
        # acrossfade 会吃掉每个边界 xfade 秒; 除最后一组外预补同样时长,
        # 保证最终 BGM 总长仍等于 EDL, 而不是几十组后提前结束。
        render_dur = dur + (xfade if gi < len(groups) - 1 else 0.0)
        if g["oa"]:
            _silence(render_dur, p)
            emo, src = "原声让位", "静音"
        else:
            emo = max(g["emotions"], key=g["emotions"].get)
            src, track = make_segment(bgm_dir, emo, render_dur, p, user_bgm,
                                      key=g["key"], avoid=prev_track)
            prev_track = track or prev_track
        parts.append(p)
        timeline_durations.append(float(dur))
        _log(f"  {g['key']} [{emo}] {dur:.0f}s ← {src}")
    # 拼接(交叉淡化避免和弦突变)
    inputs = []
    for p in parts:
        inputs += ["-i", p]
    total_dur = sum(timeline_durations)
    if len(parts) == 1:
        run(["ffmpeg", "-y", "-i", parts[0],
             "-af", f"apad,atrim=duration={total_dur:.6f}", *_WAV, out])
    else:
        fc, prev = [], "[0:a]"
        for i in range(1, len(parts)):
            lbl = f"[a{i}]" if i < len(parts) - 1 else "[aout]"
            fc.append(f"{prev}[{i}:a]acrossfade=d={xfade}:c1=tri:c2=tri{lbl}")
            prev = lbl
        fc.append(f"{prev}apad,atrim=duration={total_dur:.6f}[afinal]")
        run(["ffmpeg", "-y", *inputs, "-filter_complex", ";".join(fc),
             "-map", "[afinal]", *_WAV, out])
    _log(f"[BGM] 按场景分组拼接 {len(parts)} 组 → {out}")


def _bgm_dir_usable(bgm_dir: Path) -> bool:
    """库目录下(含情绪子目录)是否有任何不带视频流的可用音频。"""
    if not bgm_dir.is_dir():
        return False
    for pat in ("*.mp3", "*.m4a", "*/*.mp3", "*/*.m4a"):
        for p in sorted(bgm_dir.glob(pat)):
            if not _bgm_has_video(str(p)):
                return True
    return False


# ---------------------------------------------------------------------------
# 渲染前硬门禁(从 step_event_bind.audit_edl 抄入, V3 EDL 专用)
# ---------------------------------------------------------------------------

def audit_edl(edl: list[dict], fps: float = FPS,
              min_window_sec: float = MIN_WINDOW_SEC, *,
              source_edit_proof: dict | None = None, source_clock: dict | None = None) -> dict:
    """渲染前硬门禁: 任何重复、重叠、倒退或无意碎片都不放行。"""
    from .source_usage import audit_usage, declares_proof
    if source_edit_proof is not None or declares_proof(edl):
        return audit_usage(edl, fps, min_window_sec, source_edit_proof=source_edit_proof,
                           source_clock=source_clock)
    seen_shots, intervals = set(), []
    duplicate_shots, overlaps, regressions, short_windows, reused = [], [], [], [], []
    previous_end = -1
    previous_sid = ""
    for entry in edl:
        is_oa = bool(entry.get("original_audio"))
        for window in entry.get("windows", []):
            if window.get("replay") or window.get("cold_open"):
                # 原声回放窗口: 有意重放关键台词时刻, 在旁白画面账本之外,
                # 不参与重复/倒带/重叠判定, 也不推进时间基。
                # 冷开场窗口同理: 高潮前置钩子, 画面届时在正片高潮重演,
                # 段内单调性已由 bind 的临时账本把关(与 bind.audit_edl 同规)。
                continue
            sid = window.get("shot_id", "")
            start = int(window.get("start_frame", round(float(window["start"]) * fps)))
            end = int(window.get("end_frame", round(float(window["end"]) * fps)))
            row = {"seg_id": entry.get("seg_id"), "shot_id": sid,
                   "start_frame": start, "end_frame": end}
            contiguous = sid == previous_sid and start == previous_end
            # 帧连续但换镜头 = 原片自己的剪辑点(续播路径), 不是跳切。
            # 镜头边界取整会留 1~2 帧缝(≈83ms, 不可感), 视为连续。
            seamless = 0 <= start - previous_end <= 2
            # 原声窗口是原片连续区间按镜头边界的记账拆分: 豁免重复与短闪判定,
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
                    not seamless and not is_oa:  # 帧连续窗口(顺延/续播)短不算闪
                short_windows.append(row)
            seen_shots.add(sid)
            intervals.append((start, end, sid))
            previous_end = max(previous_end, end)
            previous_sid = sid
    report = {
        "status": "passed" if not any((duplicate_shots, overlaps, regressions,
                                       short_windows, reused)) else "failed",
        "n_segments": len(edl), "n_windows": len(intervals),
        "duplicate_shots": duplicate_shots,
        "overlapping_source_frames": overlaps,
        "source_time_regressions": regressions,
        "too_short_windows": short_windows,
        "explicit_reuse": reused,
        "fps": fps,
    }
    return report


# ---------------------------------------------------------------------------
# 渲染内核(从 step_e_render.py 抄入; print → _log, hdr_vf 按片源探测)
# ---------------------------------------------------------------------------

def _content_fp(*parts) -> str:
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False, sort_keys=True,
                                     default=str).encode("utf-8")).hexdigest()[:16]


def _file_sig(path: str) -> tuple:
    p = Path(path)
    if not p.exists():
        return (str(p), 0, 0)
    resolved = str(p.resolve())
    digest = getattr(_STATE, 'input_hashes', {}).get(resolved)
    return (resolved, digest or file_digest(p))


def _clip_recipe(video: str, clock: dict | None) -> dict:
    """切片配方: 进所有切片指纹(格式/帧率/音轨/HDR/时钟任一变化都不会误用旧缓存)。"""
    stream = source_audio_stream(video)
    mode = None
    if clock is not None:
        from .movie_refinement import clock_mode
        mode = clock_mode(clock)
    return {"version": RENDER_VERSION, "size": [W, H], "fps": _fps_arg(), "pix_fmt": PIXFMT,
            "intermediate_qp": INTER_QP, "audio": [AUDIO_RATE, 2, STEM_LUFS],
            "audio_stream": stream["position"] if stream else None, "hdr": hdr_vf(video),
            "clock": [clock["clock_id"], mode] if clock is not None else None}


def _stat_of(path: str | Path) -> list:
    st = Path(path).stat()
    return [st.st_size, st.st_mtime_ns, st.st_ino]


def _bytes_ok(path: str | Path, record: dict | None) -> bool:
    """缓存字节校验: stat 未变直接信任已存 SHA(无损切片很大, 不每次重算), 变了才重算比对。"""
    p = Path(path)
    if not isinstance(record, dict) or not p.is_file():
        return False
    if record.get("stat") == _stat_of(p):
        return True
    return record.get("sha256") == file_digest(p)


def _cache_load(path: str, fp: str, companions: list[str] | tuple = ()) -> dict | None:
    side = Path(path + ".fp")
    try:
        if not Path(path).is_file() or not side.is_file():
            return None
        saved = read_object(side)
        if saved.get('fingerprint') != fp or not _bytes_ok(path, saved):
            return None
        if any(not _bytes_ok(c, (saved.get("companions") or {}).get(Path(c).name)) for c in companions):
            return None
        return saved
    except Exception:
        return None


def _cache_ok(path: str, fp: str, duration: float, stream: str,
              tolerance: float) -> bool:
    try:
        return (_cache_load(path, fp) is not None
                and abs(media_duration(path, stream) - duration) < tolerance)
    except Exception:
        return False


def _cache_mark(path: str, fp: str, measured: dict | None = None,
                companions: list[str] | tuple = ()) -> None:
    record = {'fingerprint': fp, 'sha256': file_digest(Path(path)), 'stat': _stat_of(path)}
    if measured is not None:
        record['measured'] = measured
    if companions:
        record['companions'] = {Path(c).name: {'sha256': file_digest(Path(c)), 'stat': _stat_of(c)}
                                for c in companions}
    write_object(Path(path + ".fp"), record)


def _finite(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _ebur128(inputs: list[str], prefilter: str = "", stream: str = "0:a:0") -> dict:
    """EBU R128 实测: 积分响度(LUFS)/响度范围(LU)/真峰值(dBTP)。"""
    r = run(["ffmpeg", "-hide_banner", "-nostats", *inputs, "-map", stream, "-vn", "-af",
             f"{prefilter}ebur128=peak=true:framelog=verbose", "-f", "null", "-"], check=False)
    text = r.stderr[r.stderr.rfind("Summary:"):] if "Summary:" in r.stderr else ""

    def grab(label: str) -> float | None:
        m = re.search(rf"{label}:\s+(-?inf|nan|-?[\d.]+)", text)
        return _finite(m.group(1)) if m else None
    return {"integrated_lufs": grab("I"), "lra_lu": grab("LRA"), "true_peak_dbtp": grab("Peak")}


def _loudness(path: str) -> dict:
    """成片响度质检(EBU R128 积分响度/真峰值/LRA), 不再只看 volumedetect 均值。"""
    return _ebur128(["-i", str(path)])


_LUFS_CACHE: dict[tuple, float | None] = {}


def _audio_lufs(path: str) -> float | None:
    key = _file_sig(path)
    if key not in _LUFS_CACHE:
        _LUFS_CACHE[key] = _ebur128(["-i", str(path)])["integrated_lufs"]
    return _LUFS_CACHE[key]


def _gain_to(level: float | None, target: float) -> float:
    """实测响度 → 线性增益(dB); 近乎静音(< -60 LUFS)不放大底噪。"""
    if level is None or level < -60:
        return 0.0
    return round(min(20.0, max(-20.0, target - level)), 2)


def _loudnorm_json(stderr: str) -> dict:
    blocks = re.findall(r"\{[^{}]*\"input_i\"[^{}]*\}", stderr)
    if not blocks:
        raise RuntimeError("loudnorm did not report measurements")
    return json.loads(blocks[-1])


def _audio_start(start: float, clock: dict | None) -> float:
    """原声起点对齐到实际画面首帧的 PTS(画面从 start 之后第一帧开始, 音频不能早于它)。"""
    if clock is None:
        return start
    from .movie_refinement import picture_span, source_frame_time
    first, _ = picture_span(clock, start, 1e-3)
    return source_frame_time(clock, first) if first < clock['frame_count'] else start


def _previous_frame_time(start: float, clock: dict | None) -> float:
    if clock is None:
        return max(0.0, start - 1.0 / _fps())
    from .movie_refinement import picture_span, source_frame_time
    first, _ = picture_span(clock, start, 1e-3)
    return source_frame_time(clock, max(0, first - 1))


def _mix_bed(video: str, windows: list[tuple[float, float]], dur: float,
             narr: str, out: str, narr_end: float | None = None,
             tail_vol: float | None = None,
             bed_vol: float | None = None,
             narr_gain: float | None = None, *, clock: dict | None = None) -> None:
    """解说 + 与每个画面窗口真正对应的原片原声(逐窗口抽原声后 concat,
    声音和蒙太奇窗口保持一致)。48 kHz 立体声, 采样数精确 = dur。

    音量全部显式传参(不读模块全局): 调用方用哪组值算缓存指纹, 就必须用同
    一组值混音, 否则并发改全局时会产出"错误音量+正确指纹"的毒缓存。
    narr_end/tail_vol 给呼吸留白做分时包络:解说在讲时原声压到 bed_vol,
    解说结束(narr_end 起 0.3s 渐入)原声升到 tail_vol —— 解说与原声互斥。
    限幅器关自动电平(level=false), 只防削波不改响度。"""
    bv = _bed_vol() if bed_vol is None else bed_vol
    ng = _narr_gain() if narr_gain is None else narr_gain
    ng = 1.0 if ng is None else ng
    samples = int(round(dur * AUDIO_RATE))
    limiter = "alimiter=limit=0.95:level=false:latency=true"
    stream = source_audio_stream(video) if windows else None
    if not windows or stream is None:
        # 无垫底原声(bed=0 且留白静音, 或片源无音轨): 只做解说增益+限幅+补齐
        run(["ffmpeg", "-y", "-i", narr, "-af",
             f"{_AFMT},volume={ng:.4f},{limiter},apad,atrim=end_sample={samples}", *_WAV, out])
        return
    inputs, filters, labels = [], [], []
    for i, (start, wdur) in enumerate(windows):
        a0 = _audio_start(start, clock)
        ss = max(0.0, a0 - PRESEEK)
        off = a0 - ss
        inputs += ["-ss", f"{ss:.6f}", "-i", video]
        filters.append(f"[{i}:a:{stream['position']}]atrim=start={off:.6f}:duration={wdur:.6f},"
                       f"asetpts=PTS-STARTPTS,{_AFMT}[b{i}]")
        labels.append(f"[b{i}]")
    narr_idx = len(windows)
    inputs += ["-i", narr]
    if narr_end is not None and tail_vol is not None and tail_vol > 0 \
            and narr_end < dur - 0.05:
        ne, ramp = narr_end, 0.3
        # 尾末淡出: 留白原声在段结束前 fo 秒线性降到 0 —— 不然下一句开讲时
        # 原声被 atrim 一刀掐断, 响的片源(音乐/对白)听起来就是"杂音+啪嗒"。
        fo = min(TAIL_AUDIO_FADEOUT, max(0.0, dur - (ne + ramp)))
        if fo > 0.03:
            vol_expr = (f"if(lt(t\\,{ne:.3f})\\,{bv:.4f}\\,"
                        f"if(lt(t\\,{ne + ramp:.3f})\\,"
                        f"{bv:.4f}+({tail_vol:.4f}-{bv:.4f})*(t-{ne:.3f})/{ramp}\\,"
                        f"if(lt(t\\,{dur - fo:.3f})\\,{tail_vol:.4f}\\,"
                        f"{tail_vol:.4f}*({dur:.3f}-t)/{fo:.3f})))")
        else:
            vol_expr = (f"if(lt(t\\,{ne:.3f})\\,{bv:.4f}\\,"
                        f"if(lt(t\\,{ne + ramp:.3f})\\,"
                        f"{bv:.4f}+({tail_vol:.4f}-{bv:.4f})*(t-{ne:.3f})/{ramp}\\,"
                        f"{tail_vol:.4f}))")
        bed_vol_filter = f"volume='{vol_expr}':eval=frame"
    else:
        bed_vol_filter = f"volume={bv:.4f}"
    filters.append(f"{''.join(labels)}concat=n={len(labels)}:v=0:a=1,"
                   f"apad,atrim=end_sample={samples},{bed_vol_filter}[bed]")
    # MP3 的容器时长和实际可解码采样常差 20~50ms, 在本段内补齐,
    # 误差不累积到长片末尾, 余量只保留轻微环境声。
    filters.append(f"[{narr_idx}:a]{_AFMT},volume={ng:.4f},apad,"
                   f"atrim=end_sample={samples}[nr]")
    filters.append("[nr][bed]amix=inputs=2:duration=longest:dropout_transition=0:"
                   f"normalize=0,{limiter},apad,atrim=end_sample={samples}[a]")
    run(["ffmpeg", "-y", *inputs, "-filter_complex", ";".join(filters),
         "-map", "[a]", *_WAV, out])


def _global_speedup(path: str, factor: float) -> None:
    """对最终成片做一次整体变速重编(字幕已烧进画面, 会一起同步加速)。"""
    if abs(factor - 1.0) < 1e-3:
        return
    tmp = str(Path(path).with_suffix(".spd.mp4"))
    run(["ffmpeg", "-y", "-i", path,
         "-filter_complex", f"[0:v]setpts=PTS/{factor},fps={_fps_arg()}[v];[0:a]atempo={factor}[a]",
         "-map", "[v]", "-map", "[a]", *_final_v(),
         "-c:a", "aac", "-b:a", AUDIO_BITRATE, "-ar", str(AUDIO_RATE), "-ac", "2", tmp])
    Path(tmp).replace(path)


def shot_index(shots_path: str) -> dict:
    data = load_json(shots_path)
    rows = data.get("shots", []) if isinstance(data, dict) else data
    return {s["shot_id"]: s for s in rows}


def cut_clip(video: str, start: float, dur: float, speed: float, out: str, *,
             clock: dict | None = None, frames: int | None = None) -> int:
    """从原片切一段, 统一规格 + 按 speed 变速(视频 setpts, 丢原声), 无损中间编码。
    帧数驱动: 输出至多 frames 帧(默认 dur 对应整帧数, -frames:v), 不用 -t 秒数取整多切一帧。
    clock: 片源 PTS 时钟, 按真实帧时间戳精确选帧; 无 clock 时快速 seek(-ss 放 -i 前跳到最近
    关键帧, 再用输出端 -ss 补 PRESEEK 秒到精确帧)。返回实测帧数。"""
    n = frames if frames is not None else max(1, int(round(dur * speed * _fps() + 1e-9)))
    if clock is not None:
        from .movie_refinement import picture_cut_input
        arguments, selection = picture_cut_input(video, start, dur, clock)
        vf = selection + f",setpts={speed}*(PTS-STARTPTS)," + _picture_vf(video)
        run(['ffmpeg', '-y', *arguments, '-map', '0:v:0', '-vf', vf, '-an', '-sn', '-dn',
             '-frames:v', str(n), *_inter_v(), '-r', _fps_arg(), out])
    else:
        ss = max(0.0, start - PRESEEK)
        off = start - ss
        vf = f"setpts={speed}*PTS," + _picture_vf(video)
        run(["ffmpeg", "-y", "-ss", f"{ss:.6f}", "-t", f"{off + dur * max(speed, 1.0) + 1:.6f}",
             "-i", video, "-ss", f"{off:.6f}", "-map", "0:v:0", "-vf", vf, "-an", "-sn", "-dn",
             "-frames:v", str(n), *_inter_v(), "-r", _fps_arg(), out])
    return _nb_frames(out)


def _seg_vdur(e: dict) -> float:
    """段画面时长: 卷引擎带呼吸留白时 video_dur > audio_dur,
    画面按 video_dur 切, 解说音频 apad 补静音——旁白念完画面继续演。"""
    return float(e.get("video_dur") or e.get("audio_dur", 0) or 0)


def _is_jump(prev_end: float, next_start: float) -> bool:
    """前后窗口/段衔接是否为时间跳跃(非原片顺接续播)。"""
    return abs(next_start - prev_end) > JUMP_TOL


def _fade_plan(e: dict, prev_e: dict | None, next_e: dict | None) -> dict:
    """切点淡化方案: 时间跳跃的硬切加短过渡(消"突然一下"),
    顺接处(原片自己的剪辑点)保持硬切。段首看与上一段的衔接是否跳跃;
    段尾仅当本段无留白(tail<0.25s)时才加——留白段画面要透气, 不能淡黑。
    (breath_every>0 时段的边界由呼吸段承接, 此处段间过渡不生效, 无害。)"""
    wins = e.get("windows", []) or []
    n = len(wins)
    win_fi = [False] * n
    win_fo = [False] * n
    for i in range(1, n):
        if _is_jump(float(wins[i - 1]["end"]), float(wins[i]["start"])):
            win_fo[i - 1] = True
            win_fi[i] = True
    seg_fi = seg_fo = False
    if prev_e is not None:
        pw = prev_e.get("windows", []) or []
        # 段首淡入只看衔接是否跳跃(不管前段有无留白——留白结束的切点同样扎眼)
        if pw and wins and _is_jump(float(pw[-1]["end"]), float(wins[0]["start"])):
            seg_fi = True
    if next_e is not None and float(e.get("tail_sec", 0) or 0) < 0.25:
        nw = next_e.get("windows", []) or []
        if nw and wins and _is_jump(float(wins[-1]["end"]), float(nw[0]["start"])):
            seg_fo = True
    return {"win_fi": win_fi, "win_fo": win_fo, "seg_fi": seg_fi, "seg_fo": seg_fo}


def _parse_windows(e: dict, shots: dict):
    """从 edl 解析画面窗口 [(start, dur), ...]。
    - windows 数组(V3): 直接取。
    - 'start-end' 时间段字符串: 直接取。
    - 纯 shot_id(标注源 legacy): 去 shots 表查起止。"""
    if e.get("windows"):
        wins = [(float(w["start"]), float(w["end"]) - float(w["start"]))
                for w in e["windows"] if float(w["end"]) > float(w["start"])]
        if not wins:
            raise RuntimeError(f"seg {e.get('seg_id')}: all windows[] are empty (end <= start)")
        return wins
    wins = []
    for sid in e.get("shot_ids") or []:
        if "-" in sid and sid.replace("-", "").replace(".", "").isdigit():
            st, en = (float(x) for x in sid.split("-"))
        else:
            sh = shots.get(sid, {"start": 0, "end": e["audio_dur"]})
            st, en = sh["start"], sh["end"]
        wins.append((st, en - st))
    if not wins:
        raise RuntimeError(f"seg {e.get('seg_id')}: no picture windows (windows[] / shot_ids[] empty)")
    return wins


def planned_duration(edl: list[dict], breath_every: int = 0, breath_sec: float = 6.0) -> float:
    """成片计划时长(秒): 各段画面时长 + 呼吸段(与渲染插入规则一致), 供上游时长门禁使用。"""
    total = sum(_seg_vdur(e) for e in edl)
    if breath_every > 0:
        total += breath_sec * sum(1 for i, e in enumerate(edl)
                                  if not e.get("original_audio") and (i + 1) % breath_every == 0
                                  and i < len(edl) - 1)
    return total


def _seg_windows(windows: list, vdur: float) -> tuple[int, list[dict]]:
    """段画面的逐窗口整帧分配(切片与清单共用的唯一规则)。
    - 单窗口: 窗口远长于解说时从中前部取(跳开头转场)。
    - 多窗口: 每窗口按自身时长取整帧, 累计到段总帧数为止; 末窗口补足(源不够时定格)。
    cap = 该窗口最多从片源取的帧数(不越出窗口), frames = 该窗口在成片里占的帧数。"""
    fps = _fps()
    total = _frames(vdur)
    if len(windows) <= 1:
        wst, wdur = windows[0]
        need = vdur + 1.0
        if wdur > need + 2:
            wst, wdur = wst + (wdur - need) * 0.4, need
        windows = [(wst, wdur)]
    rows, remaining = [], total
    for j, (st, dur) in enumerate(windows):
        if remaining <= 0:
            break
        cap = max(1, int(round(dur * fps + 1e-9)))
        n = remaining if j == len(windows) - 1 else min(cap, remaining)
        rows.append({"index": j, "start": st, "dur": dur, "frames": n, "cap": min(cap, n)})
        remaining -= n
    return total, rows


def _cut_seg_video(video: str, windows: list, audio_dur: float,
                   base: str, seg_v: str, plan: dict | None = None, *, clock: dict | None = None,
                   source_rows: list[dict] | None = None) -> dict:
    """产出一段解说对应的画面 seg_v, 帧数精确 = audio_dur(带尾窗时=video_dur)对应整帧。
    每窗口从片源一次无损切出(帧数驱动), 不足处定格补帧, 再 concat(-c copy); 窗口临时文件用完即删,
    实测帧数写进返回值(存缓存 sidecar, 供成片清单/接缝表使用)。
    plan(_fade_plan 产物)给跳跃切点加短过渡淡入/淡出。"""
    if source_rows is None:
        total, rows = _seg_windows(windows, audio_dur)
    else:
        total, rows = _frames(audio_dur), [dict(row) for row in source_rows]
        if sum(row['frames'] for row in rows) != total:
            raise ValueError('verified movie cut plan has the wrong output duration')
    # legacy EDL(无 windows 键)解析出的窗口数与方案旗标数对不上时, 退化为无过渡
    if plan and len(plan["win_fi"]) != len(windows):
        plan = None
    single, last = len(windows) <= 1, rows[-1]["index"]
    parts, temporary = [], []
    try:
        for row in rows:
            j = row["index"]
            fi = JUMP_FADE_D if plan and ((not single and plan["win_fi"][j]) or (j == 0 and plan["seg_fi"])) else 0.0
            fo = JUMP_FADE_D if plan and ((not single and plan["win_fo"][j]) or (j == last and plan["seg_fo"])) else 0.0
            praw, pv = f"{base}_w{j}_raw.mp4", f"{base}_w{j}.mp4"
            temporary += [praw, pv]
            row["available"] = cut_clip(video, row["start"], row["dur"], 1.0, praw, clock=clock,
                                        frames=row["cap"])
            _trim_to(praw, 0.0, pv, fade_in=fi, fade_out=fo, frames=row["frames"])
            parts.append(pv)
        if len(parts) == 1:
            os.replace(parts[0], seg_v)
        else:
            _concat(parts, seg_v)
    finally:
        for path in temporary + [base + "_raw.mp4", base + "_merged.mp4"]:
            Path(path).unlink(missing_ok=True)
    if _nb_frames(seg_v) != total:
        raise RuntimeError(f"{seg_v}: cut produced a wrong frame count (expected {total})")
    return {"total": total, "windows": rows}


def _breath_window(e: dict, wins: list, rows: list[dict], shots: dict, edl: list[dict],
                   breath_sec: float, clock: dict | None = None, *,
                   source_edit_proof: dict | None = None) -> dict:
    """呼吸段画面只取本段已审批的画面: 接在本段最后实际用到的画面之后, 先用该窗口余量,
    再仅在同一镜头内顺延; 不跨镜头、不碰 EDL 中其他段的任何窗口(否则绕过 EDL 无重复审计)。
    余量不足的部分定格(available < total)。"""
    fps = _fps()
    total = _frames(breath_sec)
    last = rows[-1]
    j = last["index"]
    used_end = last["start"] + min(last["frames"], last["cap"]) / fps
    if source_edit_proof is not None:
        used_end = last['source_window']['source_end']
    elif clock is not None:
        from .movie_refinement import nearest_frame_time
        used_end = nearest_frame_time(clock, used_end)
    entries = e.get("windows") or []
    legacy = e.get("shot_ids") or []
    sid = (entries[j].get("shot_id", "") if j < len(entries)
           else (legacy[j] if j < len(legacy) else ""))
    limit = wins[j][0] + wins[j][1]
    shot = shots.get(sid) if sid else None
    if shot and float(shot["start"]) <= used_end + 1e-6 and float(shot["end"]) > limit:
        limit = float(shot["end"])
    approved = None
    if source_edit_proof is not None:
        from .source_usage import normalize_window
        approved = normalize_window(entries[j], fps, source_edit_proof=source_edit_proof, source_clock=clock)
        span = next(s for s in source_edit_proof['shots'][sid]['spans']
                    if s['span_id'] == approved['edit_span_id'])
        limit = min(limit, span['end'])
        approved = {**approved, 'source_frame_end': span['frame_end'], 'source_end': span['end']}
    for other in edl:
        if other is e:
            continue
        for ws, wd in _parse_windows(other, shots):
            if ws + wd > used_end + 1e-6 and ws < limit:
                limit = used_end if ws <= used_end + 1e-6 else ws
    available = max(0, min(total, int(math.floor((limit - used_end) * fps + 1e-6))))
    result = {"start": round(used_end, 6), "frames": total, "available": available, "shot_id": sid}
    if approved is not None:
        if available:
            picture = _proof_plan_window(approved, used_end, min(limit, used_end+available/fps),
                                         total, source_edit_proof, clock)
            result['start'] = picture['source_start']
        else:
            from .movie_refinement import source_frame_time
            end = last['source_window']['source_frame_end']
            picture = _proof_plan_window(approved, source_frame_time(clock, end-1),
                                         source_frame_time(clock, end), total, source_edit_proof, clock)
        result.update(source_limit=picture['source_end'], source_window=picture)
    return result


def _proof_plan_window(approved: dict, start: float, end: float, frames: int,
                       proof: dict, clock: dict) -> dict:
    """Bind a render crop to its approved source frames, not output-frame math."""
    from .source_usage import normalize_window
    old = {'start', 'end', 'start_frame', 'end_frame', 'source_frame_start', 'source_frame_end',
           'source_start', 'source_end', 'output_duration'}
    candidate = {**{key: value for key, value in approved.items() if key not in old},
                 'start': start, 'end': end, 'start_frame': 0, 'end_frame': frames}
    row = normalize_window(candidate, _fps(), source_edit_proof=proof, source_clock=clock)
    if (row['source_frame_start'] < approved['source_frame_start']
            or row['source_frame_end'] > approved['source_frame_end']):
        raise ValueError('movie render plan leaves the approved source window')
    # Cut exactly this verified half-open PTS range. Output frame counts and
    # freeze padding remain separate and keep the existing segment duration.
    row.update(start=row['source_start'], end=row['source_end'])
    return row


def _proof_seg_rows(e: dict, wins: list, vdur: float, proof: dict, clock: dict) -> tuple[int, list[dict]]:
    from .source_usage import normalize_window
    total, rows = _seg_windows(wins, vdur)
    for row in rows:
        approved = normalize_window(e['windows'][row['index']], _fps(),
                                    source_edit_proof=proof, source_clock=clock)
        end = row['start'] + min(row['dur'], row['cap']/_fps())
        picture = _proof_plan_window(approved, row['start'], end, row['frames'], proof, clock)
        row.update(start=picture['source_start'], dur=picture['source_end']-picture['source_start'],
                   source_window=picture)
    return total, rows


def _proof_original_windows(e: dict, frames: int, proof: dict, clock: dict) -> tuple[dict, list[dict]]:
    from .source_usage import normalize_window
    approved = [normalize_window(w, _fps(), source_edit_proof=proof, source_clock=clock)
                for w in e['windows']]
    if any(a['source_frame_end'] != b['source_frame_start'] for a, b in zip(approved, approved[1:])):
        raise ValueError('original-audio render plan crosses an unapproved source gap')
    start = approved[0]['source_start']
    limit = min(approved[-1]['source_end'], start+frames/_fps())
    windows = []
    for row in approved:
        a, b = max(start, row['source_start']), min(limit, row['source_end'])
        if a < b:
            windows.append(_proof_plan_window(row, a, b, max(1, round((b-a)*_fps())), proof, clock))
    if not windows:
        raise ValueError('original-audio render plan contains no approved source frames')
    return {'start': start, 'frames': frames, 'source_limit': windows[-1]['source_end']}, windows


def _audit_source_windows(items: list[dict], *, source_edit_proof: dict,
                          source_clock: dict) -> dict:
    """Check the actual cutter plan, including offsets, trim and breath windows."""
    from .source_usage import audit_usage, normalize_window
    from .movie_refinement import picture_span
    edl = []
    for item in items:
        params = item['params']
        if item['kind'] == 'breath':
            saved = params['source_window']
            start = params['start'] if params['available'] else _previous_frame_time(params['start'], source_clock)
            actual = picture_span(source_clock, start, params['source_limit']-start)
            previous = edl[-1]['windows'][-1]
            expected_start = previous['source_frame_end'] - (0 if params['available'] else 1)
            if (actual != (saved['source_frame_start'], saved['source_frame_end'])
                    or actual[0] != expected_start or saved['edit_span_id'] != previous['edit_span_id']
                    or (not params['available'] and actual[1] != previous['source_frame_end'])):
                raise ValueError('movie breath plan differs from its approved source continuation')
            normalize_window(saved, _fps(), source_edit_proof=source_edit_proof, source_clock=source_clock)
            # A generated hold repeats the last approved frame intentionally;
            # its one-frame containment was checked by _proof_plan_window.
            if params['available']:
                edl[-1]['windows'].append(saved)
        elif item['kind'] == 'oa':
            expected, windows = _proof_original_windows(item['entry'], _frames(item['entry']['audio_dur']),
                                                        source_edit_proof, source_clock)
            if any(params[key] != expected[key] for key in ('start', 'source_limit', 'frames')):
                raise ValueError('original-audio cut parameters differ from the approved source plan')
            edl.append({**item['entry'], 'windows': windows})
        else:
            windows = []
            if sum(row['frames'] for row in params['source_rows']) != _frames(_seg_vdur(item['entry'])):
                raise ValueError('movie source plan changed the approved output duration')
            for row in params['source_rows']:
                approved = normalize_window(item['entry']['windows'][row['index']], _fps(),
                                            source_edit_proof=source_edit_proof, source_clock=source_clock)
                actual = _proof_plan_window(approved, row['start'], row['start']+row['dur'], row['frames'],
                                            source_edit_proof, source_clock)
                saved = row['source_window']
                if any(actual[key] != saved[key] for key in ('source_frame_start', 'source_frame_end', 'edit_span_id')):
                    raise ValueError('movie cut parameters differ from the approved source plan')
                windows.append(actual)
            edl.append({**item['entry'], 'windows': windows})
    return audit_usage(edl, _fps(), min_window_sec=0, source_edit_proof=source_edit_proof,
                       source_clock=source_clock)


def _audit_rendered_windows(edl: list[dict], windows: list[dict], *, source_edit_proof: dict,
                            source_clock: dict) -> dict:
    """Independent post-render ledger over the produced window manifest.

    Rebuilt only from ``actual_windows`` (what was actually cut, including
    zero-output-frame windows) and the EDL's declared reuse flags, then checked
    by ``source_usage.audit_usage``; it shares no state with the cutter plan.
    """
    from .source_usage import audit_usage
    flags = ('original_audio', 'cold_open', 'replay', 'reuse_type', 'exemptions', 'source_edit_proof_id')
    entries = {e.get('seg_id'): e for e in edl}
    rebuilt: list[dict] = []
    for row in windows:
        breath = bool(row.get('breath'))
        seg_id = row['segment_id']
        if not breath and (not rebuilt or rebuilt[-1]['seg_id'] != seg_id):
            source = entries.get(seg_id, {})
            rebuilt.append({'seg_id': seg_id, 'windows': [],
                            **{k: copy.deepcopy(source[k]) for k in flags if k in source}})
        if not rebuilt:  # a leading breath has no approved span to continue
            rebuilt.append({'seg_id': seg_id, 'windows': []})
        entry = rebuilt[-1]
        if 'source_frame_start' not in row:
            entry['windows'].append({'shot_id': row.get('shot_id'), 'unproven_rendered_window': True})
            continue
        pieces = [(row, row['end_frame']-row['start_frame'])]
        pieces += [(hidden, 0) for hidden in row.get('zero_frame_source_windows', [])]
        for piece, frames in pieces:
            window = {k: piece[k] for k in ('shot_id', 'source_frame_start', 'source_frame_end',
                                            'source_edit_proof_id', 'edit_span_id') if k in piece}
            window.update(start_frame=0, end_frame=frames)
            if breath:
                # Breath continues the previous approved span; a generated hold
                # repeats an already counted frame and claims no new source.
                previous = entry['windows'][-1] if entry['windows'] else None
                if (previous is not None and 'source_frame_start' in previous
                        and previous['source_frame_start'] <= window['source_frame_start']
                        and window['source_frame_end'] <= previous['source_frame_end']):
                    continue
                window['original_audio'] = True
            elif entry.get('original_audio'):
                window['original_audio'] = True
            if entry.get('cold_open'):
                window['cold_open'] = True
            if entry.get('replay'):
                window['replay'] = True
            entry['windows'].append(window)
    unproven = [{'seg_id': e['seg_id'], 'shot_id': w.get('shot_id'), 'reason': 'rendered_window_without_source_frames'}
                for e in rebuilt for w in e['windows'] if w.get('unproven_rendered_window')]
    for entry in rebuilt:
        entry['windows'] = [w for w in entry['windows'] if not w.get('unproven_rendered_window')]
    report = audit_usage(rebuilt, _fps(), min_window_sec=0, source_edit_proof=source_edit_proof,
                         source_clock=source_clock)
    if unproven:
        report['source_usage_errors'].extend(unproven)
        report['status'] = 'failed'
    report['scope'] = 'rendered_window_manifest'
    return report


def _clip_plan(edl: list, shots: dict, video: str, clips_dir: str, breath_every: int,
               breath_sec: float, clock: dict | None = None, *,
               source_edit_proof: dict | None = None) -> list[dict]:
    """全部切片任务的唯一定义(路径/参数/指纹/切法), 预切与主循环共用 ——
    两处不再各算一套指纹、各切一遍(否则主循环覆盖精确切片且每次缓存失效)。"""
    from .source_usage import declares_proof
    if source_edit_proof is None and declares_proof(edl):
        raise ValueError('source_edit_proof_missing')
    recipe = _clip_recipe(video, clock)
    source = _file_sig(video)
    items = []
    for idx, e in enumerate(edl):
        wins = _parse_windows(e, shots)
        sid = e["seg_id"]
        if e.get("original_audio"):
            params = {"start": wins[0][0], "frames": _frames(e["audio_dur"])}
            source_windows = None
            if source_edit_proof is not None:
                params, source_windows = _proof_original_windows(e, params['frames'], source_edit_proof, clock)
            items.append({"kind": "oa", "entry": e, "wins": wins, "source": video,
                          "video": f"{clips_dir}/oa_{sid}.mp4", "audio": f"{clips_dir}/oa_{sid}.wav",
                          "params": params, "source_windows": source_windows,
                          "fp": _content_fp("oa-v2", source, recipe, wins, params,
                                            *([source_windows] if source_windows is not None else []))})
            continue
        vdur = _seg_vdur(e)
        plan = _fade_plan(e, edl[idx - 1] if idx > 0 else None,
                          edl[idx + 1] if idx < len(edl) - 1 else None)
        total, rows = (_seg_windows(wins, vdur) if source_edit_proof is None else
                       _proof_seg_rows(e, wins, vdur, source_edit_proof, clock))
        params = {"vdur": vdur, "plan": plan, "frames": total}
        if source_edit_proof is not None:
            params['source_rows'] = rows
        items.append({"kind": "seg", "entry": e, "wins": wins, "source": video,
                      "video": f"{clips_dir}/seg_{sid}.mp4", "base": f"{clips_dir}/seg_{sid}",
                      "params": params,
                      "fp": _content_fp("seg-v6", source, recipe, wins, vdur, plan, rows)})
        if (breath_every > 0 and (idx + 1) % breath_every == 0
                and idx < len(edl) - 1):
            # 呼吸段同样要内容指纹: verify 治愈/改稿会改 audio_dur, 起点随之移动
            params = _breath_window(e, wins, rows, shots, edl, breath_sec, clock,
                                    source_edit_proof=source_edit_proof)
            items.append({"kind": "breath", "entry": e, "wins": wins, "source": video,
                          "video": f"{clips_dir}/breath_{sid}.mp4", "audio": f"{clips_dir}/breath_{sid}.wav",
                          "params": params, "fp": _content_fp("breath-v2", source, recipe, params)})
    if source_edit_proof is not None:
        report = _audit_source_windows(items, source_edit_proof=source_edit_proof, source_clock=clock)
        if report['status'] != 'passed':
            raise ValueError('movie render source plan failed: ' + json.dumps(report, ensure_ascii=False))
    return items


def _item_ready(item: dict) -> dict | None:
    """已切好且指纹/字节/实测帧数都对的切片直接复用(断点续跑), 返回其实测记录。"""
    saved = _cache_load(item["video"], item["fp"], [item["audio"]] if "audio" in item else [])
    measured = (saved or {}).get("measured")
    if not isinstance(measured, dict) or measured.get("total") != item["params"]["frames"]:
        return None
    try:
        return measured if _nb_frames(item["video"]) == measured["total"] else None
    except RuntimeError:
        return None


def _make_item(item: dict, clock: dict | None) -> dict:
    video, params = item["source"], item["params"]
    if item["kind"] == "seg":
        measured = _cut_seg_video(video, item["wins"], params["vdur"], item["base"], item["video"],
                                  params["plan"], clock=clock,
                                  **({'source_rows': params['source_rows']} if 'source_rows' in params else {}))
    elif item["kind"] == "oa":
        measured = _cut_with_audio(video, params["start"], params["frames"] / _fps(), item["video"],
                                   item["audio"], clock=clock, frames=params["frames"],
                                   **({'source_limit': params['source_limit']} if 'source_limit' in params else {}))
        if item.get('source_windows') is not None:
            measured['source_windows'] = item['source_windows']
    else:
        measured = {**_cut_with_audio(video, params["start"], params["frames"] / _fps(), item["video"],
                                      item["audio"], clock=clock, frames=params["frames"],
                                      available=params["available"], fade_out=TAIL_AUDIO_FADEOUT,
                                      **({'source_limit': params['source_limit']} if 'source_limit' in params else {})),
                    "shot_id": params["shot_id"]}
        if 'source_window' in params:
            measured['source_windows'] = [params['source_window']]
    _cache_mark(item["video"], item["fp"], measured, [item["audio"]] if "audio" in item else [])
    item["measured"] = measured
    return measured


def _precut_all(edl: list, shots: dict, video: str, clips_dir: str,
                breath_every: int, breath_sec: float, *, clock: dict | None = None,
                source_edit_proof: dict | None = None) -> list[dict]:
    """并行预切所有段画面(+原声段+呼吸段)。各段独立, 线程池吃满多核(worker 继承调用线程的
    渲染状态)。已切好的段跳过(断点续跑)。返回切片计划(含实测), 主循环只做记账。"""
    items = _clip_plan(edl, shots, video, clips_dir, breath_every, breath_sec, clock,
                       source_edit_proof=source_edit_proof)
    pending = []
    for item in items:
        item["measured"] = _item_ready(item)
        if item["measured"] is None:
            pending.append(item)
    if not pending:
        _log("[E] 预切: 所有段已就绪(断点续跑), 跳过")
        return items
    _log(f"[E] 并行切片: {len(pending)} 段待切, {CUT_WORKERS} 并发, 无损中间片(qp={INTER_QP})")
    worker = _bind_state(lambda item: _make_item(item, clock))
    with ThreadPoolExecutor(max_workers=max(1, CUT_WORKERS)) as ex:
        list(ex.map(worker, pending))
    _log(f"[E] 并行切片完成 ({len(pending)} 段)")
    return items


def _rebuild_subtitle(script_path: str, seg_offsets: dict, out: str,
                      extra_cues: list | None = None, *,
                      scene_spans: dict[str, tuple[float, float]] | None = None) -> dict:
    """按每段在成片的真实起点(seg_id→offset)重建解说字幕;
    原声穿插段的台词字幕(extra_cues, 绝对时间; 第4项为所属段 seg_id)一并合入。
    最后统一做最短显示时长(movie_subtitles.fit_cue_timing): 只向后续空隙/前方空隙
    延长或与同段相邻字幕合并, 不压下一条, 不超出本段音频末尾太多。返回时长统计。"""
    segs = load_json(script_path)
    spans = scene_spans or {}
    cues = []
    for s in segs:
        base = seg_offsets.get(s.get("seg_id"))
        if base is None:
            continue
        a, b = spans.get(s.get("seg_id"), (base, math.inf))
        for sent in s.get("sentences", []):
            cues.append({"start": base + sent["start"], "end": base + sent["end"],
                         "text": sent.get("subtitle_text", sent.get("text", "")),
                         "scene": s.get("seg_id"), "scene_start": a, "scene_end": b})
    for x in extra_cues or []:
        st, en, text, *rest = x
        sid = rest[0] if rest else None
        a, b = spans.get(sid, (st, en)) if sid is not None else (st, en)
        cues.append({"start": st, "end": en, "text": text, "scene": sid,
                     "scene_start": a, "scene_end": b})
    before = movie_subtitles.timing_stats(cues)
    rows = movie_subtitles.fit_cue_timing(cues)
    _write_srt(rows, out)
    return {"before": before, "after": movie_subtitles.timing_stats(rows),
            "merged": sum(1 for r in rows if r.get("merged"))}


def _source_subtitles(video: str, scene_start: float, lines: list[dict],
                      cache: "movie_subtitles.DetectionCache") -> dict:
    """原声段片源是否已烧有中文字幕(抽台词中段帧, 检测下方居中的中文字幕行)。
    判定不确定时返回非 burned_in, 照旧叠加本片字幕。"""
    key = movie_subtitles.scene_key(_file_sig(video), scene_start, lines)
    row = cache.get(key)
    if row is None:
        try:
            row = movie_subtitles.detect_scene(video, scene_start, lines)
        except Exception as exc:   # 检测是锦上添花, 失败只按旧行为叠字幕
            row = {"status": "unavailable", "burned_in": False, "reason": f"{type(exc).__name__}: {exc}",
                   "detector": movie_subtitles.DETECTOR_VERSION}
        if row.get("status") != "unavailable":
            cache.put(key, row)
    return row


def _trim_to(src: str, dur: float, out: str,
             fade_in: float = 0.0, fade_out: float = 0.0, *, frames: int | None = None) -> int:
    """把视频精确对齐到 frames 帧(默认 dur 秒对应整帧): 长了裁短, 短了定格最后一帧补足。
    必须严格等长, 否则视频轨与音频轨累积错位导致全片音画不同步。src 是临时切片, 调用后不再保留:
    帧数恰好且无过渡时直接改名(不多一代编码), 否则无损重编。返回 src 实有帧数。
    fade_in/fade_out>0 时在边界加短淡化(跳跃切点的过渡, 见 _fade_plan)。"""
    n = frames if frames is not None else _frames(dur)
    have = _nb_frames(src)
    if have == n and fade_in <= 0 and fade_out <= 0:
        os.replace(src, out)
        return have
    chain = []
    if have < n:
        # 源不够长(绑定原片区间短于解说): tpad 定格最后一帧补到 n 帧
        chain.append(f"tpad=stop_mode=clone:stop={n - have}")
    if fade_in > 0:
        chain.append(f"fade=t=in:st=0:d={fade_in:.3f}")
    if fade_out > 0:
        chain.append(f"fade=t=out:st={max(0.0, n / _fps() - fade_out):.3f}:d={fade_out:.3f}")
    run(["ffmpeg", "-y", "-i", src, "-map", "0:v:0", *(["-vf", ",".join(chain)] if chain else []),
         "-frames:v", str(n), "-an", *_inter_v(), "-r", _fps_arg(), out])
    Path(src).unlink(missing_ok=True)
    return have


def _cut_with_audio(video: str, start: float, dur: float, out_v: str, out_a: str, *,
                    clock: dict | None = None, frames: int | None = None,
                    available: int | None = None, fade_out: float = 0.0,
                    source_limit: float | None = None) -> dict:
    """切原片一段(原声段/呼吸段): 画面帧数精确(available 之外定格), 原声从实际首帧 PTS 起取,
    48 kHz 立体声(保留片源声道), 按实测积分响度做线性增益到 STEM_LUFS(不再逐段动态 loudnorm,
    与解说同一工作电平), 采样数与画面逐帧一致。片源无音轨时补静音。返回实测记录。"""
    fps = _fps()
    total = frames or _frames(dur)
    usable = total if available is None else max(0, min(total, int(available)))
    raw = out_v + ".raw.mp4"
    pic_start = start
    if usable <= 0:
        # 本镜头内已无可用画面: 定格本段最后一帧(只借 1 帧, 不越出已审批窗口)
        pic_start = _previous_frame_time(start, clock)
    source_dur = (usable if usable > 0 else 1) / fps + 0.5 / fps
    if source_limit is not None:
        source_dur = source_limit-pic_start
        if source_dur <= 0:
            raise ValueError('verified original-audio source interval is empty')
    got = cut_clip(video, pic_start, source_dur, 1.0, raw, clock=clock, frames=usable if usable > 0 else 1)
    _trim_to(raw, 0.0, out_v, frames=total)
    audio_s = got / fps if usable > 0 else 0.0
    samples = int(round(total / fps * AUDIO_RATE))
    stream = source_audio_stream(video)
    a0 = _audio_start(start, clock)
    level, gain_db = None, 0.0
    if stream is None or audio_s <= 0:
        run(["ffmpeg", "-y", "-f", "lavfi", "-i", f"anullsrc=r={AUDIO_RATE}:cl=stereo",
             "-af", f"atrim=end_sample={samples}", *_WAV, out_a])
    else:
        ss = max(0.0, a0 - PRESEEK)
        off = a0 - ss
        src = ["-ss", f"{ss:.6f}", "-t", f"{off + audio_s + 1:.6f}", "-i", video]
        pick = f"atrim=start={off:.6f}:duration={audio_s:.6f},asetpts=PTS-STARTPTS,{_AFMT},"
        level = _ebur128(src, pick, f"0:a:{stream['position']}")["integrated_lufs"]
        gain_db = _gain_to(level, STEM_LUFS)
        fade = (f"afade=t=out:st={max(0.0, audio_s - fade_out):.6f}:d={min(fade_out, audio_s):.6f},"
                if fade_out > 0 else "")
        run(["ffmpeg", "-y", *src, "-map", f"0:a:{stream['position']}", "-vn", "-af",
             f"{pick}volume={gain_db:.2f}dB,alimiter=limit=0.95:level=false:latency=true,"
             f"{fade}apad,atrim=end_sample={samples}", *_WAV, out_a])
    return {"start": pic_start, "total": total, "available": got if usable > 0 else 1,
            "hold": usable <= 0, "audio_start": round(a0, 6), "audio_seconds": round(audio_s, 6),
            "input_lufs": level, "gain_db": gain_db}


def _concat_entry(path: str) -> str:
    value = str(Path(path).resolve())
    if any(char in value for char in ('\r', '\n', '\0')):
        raise ValueError('concat paths must not contain line breaks or NUL')
    # av_get_token uses single quotes and backslash escapes, not shell quoting.
    return "file '" + value.replace("'", "'\\''") + "'\n"


def _concat(parts: list[str], out: str) -> None:
    """concat demuxer 拼接同规格片段(无损中间片 -c copy, 不多一代编码)。"""
    if len(parts) == 1:
        run(["ffmpeg", "-y", "-i", parts[0], "-c", "copy", out])
        return
    lst = out + ".txt"
    entries = [_concat_entry(p) for p in parts]
    with open(lst, "w", encoding='utf-8') as f:
        f.writelines(entries)
    try:
        # 切片已统一规格, 这里可安全 -c copy; 若仍报错回退无损重编
        r = run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", lst,
                 "-c", "copy", out], check=False)
        if r.returncode != 0:
            if Path(parts[0]).suffix.lower() == ".wav":
                run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", lst, *_WAV, out])
            else:
                run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", lst,
                     *_inter_v(), "-r", _fps_arg(), out])
    finally:
        Path(lst).unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# 渲染后接缝帧扫描: 成片里每个预期切点两侧是否干净
# ---------------------------------------------------------------------------

SEAM_SCAN = os.environ.get("RENDER_SEAM_SCAN", "1") != "0"
SEAM_MIN_JUMP = 8.0          # 64x36 灰度帧间平均绝对差, 低于此不算跳变
SEAM_BASELINE_MULT = 3.0     # 跳变须超过局部基线的倍数(快动作镜头基线高, 防误报)
SEAM_MAX_REPORT = 60


def _nb_frames(path: str) -> int:
    """Use stored frame count or count decoded frames; never estimate final positions."""
    r = run(["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=nb_frames",
             "-of", "default=noprint_wrappers=1:nokey=1", path], check=False, timeout=60)
    try:
        n = int(r.stdout.strip())
        if n > 0:
            return n
    except ValueError:
        pass
    r = run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames",
             "-show_entries", "stream=nb_read_frames", "-of", "default=noprint_wrappers=1:nokey=1", path],
            check=False, timeout=600)
    try:
        count = int(r.stdout.strip())
        if count > 0:
            return count
    except ValueError:
        pass
    raise RuntimeError('could not measure actual video frame count')


def _window_manifest(e: dict, wins: list, start_frame: int, total: int, measured: dict,
                     shots: dict) -> tuple[list, list]:
    """Map the cuts actually rendered, including trim, center offset and freeze padding."""
    rows, errors = [], []
    fps = _fps()
    original = bool(e.get('original_audio'))
    entries = e.get('windows') or []
    counts, source_records, absorbed = [], [], []
    if measured.get('source_windows') is not None:
        # Proof-aware original-audio/breath plans retain their real internal
        # edit spans instead of reconstructing them from coarse shot IDs.
        have = min(total, int(measured.get('available', total)))
        sources = measured['source_windows']
        consumed, pending = 0, []
        for j, source in enumerate(sources):
            upto = min(have, round((source['source_end']-sources[0]['source_start'])*fps))
            n = total-consumed if j == len(sources)-1 else max(0, upto-consumed)
            if n:
                counts.append((source['source_start'], source['source_end']-source['source_start'],
                               source['shot_id'], n, max(0, min(have-consumed, n))))
                source_records.append(source)
                # A source window shorter than one output tick has no output
                # frame of its own; keep it on the next shown window, not drop it.
                absorbed.append(pending)
                pending = []
                consumed += n
            else:
                pending.append(source)
        if pending:
            if absorbed:
                absorbed[-1].extend(pending)
            else:
                errors.append(f"{e['seg_id']}: source windows produced no output frames")
    elif e.get('breath'):
        # Breath pictures stay inside one approved shot; the rest is a held frame.
        counts.append((measured['start'], measured['available'] / fps, measured.get('shot_id', ''),
                       total, measured['available']))
    elif original:
        # Original-audio clips are one continuous source range, even across shot boundaries.
        cursor = float(measured.get('start', wins[0][0]))
        have = min(total, int(measured.get('available', total)))
        end = cursor + have / fps
        actual = [(max(cursor, float(s['start'])), min(end, float(s['end'])), s['shot_id'])
                  for s in sorted(shots.values(), key=lambda s: float(s['start']))
                  if float(s['end']) > cursor and float(s['start']) < end]
        if not actual:
            actual = [(cursor, end, entries[0].get('shot_id', '') if entries else '')]
        if (abs(actual[0][0]-cursor) > 1/fps or abs(actual[-1][1]-end) > 1/fps
                or any(abs(a[1]-b[0]) > 1/fps for a,b in zip(actual, actual[1:]))):
            errors.append(f"{e['seg_id']}: source shot coverage incomplete")
        consumed, pending = 0, []
        for j, (left, right, sid) in enumerate(actual):
            n = min(have-consumed, int(round((right-cursor)*fps))-consumed)
            if j == len(actual)-1:
                n = total-consumed
            if n > 0:
                counts.append((left, right-left, sid, n, n - (total-have if j == len(actual)-1 else 0)))
                absorbed.append(pending)
                pending = []
                consumed += n
            else:
                pending.append({'shot_id': sid, 'source_start': left, 'source_end': right})
        if pending:
            if absorbed:
                absorbed[-1].extend(pending)
            else:
                errors.append(f"{e['seg_id']}: source shots produced no output frames")
    else:
        for row in measured.get('windows') or []:
            j = row['index']
            sid = (entries[j].get('shot_id', '') if j < len(entries)
                   else (e.get('shot_ids') or ['']*len(wins))[j])
            counts.append((row['start'], row['dur'], sid, row['frames'], row['available']))
            source_records.append(row.get('source_window'))
    cursor = start_frame
    for j, (st, dur, sid, n, available) in enumerate(counts):
        units = list(dict.fromkeys(uid for w in entries if w.get('shot_id') == sid
                                  for uid in w.get('semantic_unit_ids', [w.get('semantic_unit_id')]) if uid))
        rows.append({'window_id': f"{e['seg_id']}:w{j:03d}", 'segment_id': e['seg_id'], 'shot_id': sid,
                     'start_frame': cursor, 'end_frame': cursor+n, 'start': cursor/fps, 'end': (cursor+n)/fps,
                     'source_start': st, 'source_end': st+min(dur, min(n, available)/fps),
                     'freeze_frames': max(0, n-available), 'unit_ids': units,
                     'kind': 'original_audio' if original else 'narration',
                     **({'breath': True} if e.get('breath') else {})})
        source = source_records[j] if j < len(source_records) else None
        if source is not None:
            rows[-1].update({key: source[key] for key in ('source_start', 'source_end', 'source_frame_start',
                                'source_frame_end', 'source_edit_proof_id', 'edit_span_id')})
            rows[-1]['source_frame_scope'] = 'selected_before_output_fps'
        hidden = absorbed[j] if j < len(absorbed) else []
        if hidden:
            keys = ('shot_id', 'source_start', 'source_end', 'source_frame_start', 'source_frame_end',
                    'source_edit_proof_id', 'edit_span_id')
            rows[-1]['zero_frame_source_windows'] = [{k: w[k] for k in keys if k in w} for w in hidden]
        cursor += n
    if cursor != start_frame+total:
        errors.append(f"{e['seg_id']}: actual window coverage incomplete")
    return rows, errors


def _seam_scan(video: str, seams: list[dict]) -> dict:
    """整段解码成片(64x36 灰度)算帧间差, 对每个预期接缝帧 c(新窗口首帧)看
    附近哪些帧对发生跳变, 偏移 0 = c-1→c 即切点本身。

    残帧判据(关键): 残帧 = 切点没对准, 上一镜头的尾帧漏进新窗口。特征是
    "切点处(偏移0)不跳或跳得小, 隔 1~2 帧才出现真正的大跳"。而**正确的切点
    后面紧跟快动作**也会在偏移 +1/+2 产生跳变, 但那时偏移 0 已是最大跳(切点
    本身), 后续跳变量级明显更小——这是内容运动, 不是残帧。所以只有当额外跳变
    与主切点跳变量级相当(≥0.7×), 或切点处根本没跳(位移切点)时, 才判残帧。
    两侧各用局部基线(快动作镜头帧差本来就大, 防误报)。续播接缝(同镜头顺延)
    不跳属正常。seams: [{"frame": 成片帧号, "seg_id":…, "kind": "seg"|"win"}]。"""
    import numpy as np
    # passthrough: concat 成片 start_time 常带 20ms 音频预卷偏移,
    # rawvideo 默认 cfr 会在片头复制一帧补齐, 全部接缝帧号就整体错一帧。
    r = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", video, "-fps_mode", "passthrough",
         "-vf", "scale=64:36,format=gray", "-f", "rawvideo", "-"],
        capture_output=True, stdin=subprocess.DEVNULL, timeout=FF_TIMEOUT)
    buf = np.frombuffer(r.stdout, dtype=np.uint8)
    n = len(buf) // (64 * 36)
    if r.returncode != 0 or n < 8:
        return {"status": "skipped", "reason": "decode_fail", "n_seams": len(seams)}
    fr = buf[:n * 64 * 36].reshape(n, 36, 64).astype(np.int16)
    d = np.abs(np.diff(fr, axis=0)).mean(axis=(1, 2))   # d[i] = 帧 i→i+1
    bad, n_clean = [], 0
    for s in seams:
        c = int(s["frame"])
        if c < 16 or c + 16 >= n:
            continue
        thr_after = max(SEAM_MIN_JUMP, SEAM_BASELINE_MULT * float(np.median(d[c + 3:c + 15])))
        thr_before = max(SEAM_MIN_JUMP, SEAM_BASELINE_MULT * float(np.median(d[c - 15:c - 3])))
        j0 = float(d[c - 1])                       # 偏移 0 = 预期切点本身的跳变
        cut_present = j0 > thr_after
        extra = [o for o in (-2, -1, 1, 2)
                 if d[c - 1 + o] > (thr_after if o > 0 else thr_before)]
        # 残帧: ①切点处没跳但有邻近跳(位移切点); ②额外跳与主切点量级相当(双切=漏帧)
        residual = [o for o in extra
                    if (not cut_present) or float(d[c - 1 + o]) >= 0.7 * j0]
        if not residual:
            n_clean += 1
            continue
        kind = "residual_after" if any(o > 0 for o in residual) else "residual_before"
        bad.append({"frame": c, "t": round(c / _fps(), 3), "seg_id": s.get("seg_id"),
                    "seam": s.get("kind"), "kind": kind,
                    "cut_jump": round(j0, 1),
                    "jump_offsets": [0] + extra if cut_present else extra,
                    "jump_values": [round(j0, 1)] + [round(float(d[c - 1 + o]), 1)
                                                      for o in extra] if cut_present
                                   else [round(float(d[c - 1 + o]), 1) for o in extra]})
    return {
        "status": "clean" if not bad else "residual_frames",
        "source": video,
        "n_frames": n,
        "n_seams": len(seams),
        "n_clean": n_clean,
        "n_bad": len(bad),
        "bad_seams": bad[:SEAM_MAX_REPORT],
        "truncated": len(bad) > SEAM_MAX_REPORT,
    }


def _concat_audio_plain(parts: list[str], out: str,
                        durations: list[float] | None = None) -> None:
    """纯拼接音频段, 不做交叉淡化。统一到 48 kHz 立体声(单声道 TTS 在此居中上混)。
    durations 给定时, 每段按累计采样边界补齐/裁短到对应视频段的整帧时长,
    误差不跨段累计(逐采样精确)。临时分段文件拼完即删。"""
    norm = []
    bounds = None
    if durations is not None:
        acc, bounds = 0.0, [0]
        for d in durations:
            acc += float(d)
            bounds.append(int(round(acc * AUDIO_RATE)))
    try:
        for i, p in enumerate(parts):
            np_ = f"{out}.n{i}.wav"
            norm.append(np_)
            af = _AFMT if bounds is None else f"{_AFMT},apad,atrim=end_sample={bounds[i + 1] - bounds[i]}"
            run(["ffmpeg", "-y", "-i", p, "-map", "0:a:0", "-af", af, *_WAV, np_])
        _concat(norm, out)
    finally:
        for np_ in norm:
            Path(np_).unlink(missing_ok=True)


SUB_POSITION_TAGS = {"top": r"{\an8}", "middle": r"{\an5}"}


def positioned_subtitle(path: Path, sub_pos: str) -> Path:
    """The SRT to burn: top/middle cues carry an explicit ``\\an`` position tag.

    Bottom and lower placements use the style alignment and need no copy.
    """
    tag = SUB_POSITION_TAGS.get(sub_pos)
    if tag is None:
        return path
    blocks = re.split(r"\n\s*\n", path.read_text(encoding="utf-8").strip())
    out = []
    for block in blocks:
        lines = block.splitlines()
        if len(lines) >= 3 and "-->" in lines[1] and not lines[2].startswith("{\\an"):
            lines[2] = tag + lines[2]
        out.append("\n".join(lines))
    target = path.with_name(f"{path.stem}.{sub_pos}{path.suffix}")
    target.write_text("\n\n".join(out) + "\n", encoding="utf-8")
    return target


def _mux(video: str, narration: str, out: str, subtitle: str | None = None,
         bgm: str | None = None, bgm_volume: float = 0.18,
         sub_pos: str = "top", font_name: str = "Noto Sans CJK SC", *,
         fontsdir: str | None = None, master: bool | None = None) -> dict:
    """合成画面+解说(+可选BGM +可选字幕烧录), 成片唯一一次交付编码(FINAL_PRESET/FINAL_CRF)。
    音频链: 解说为主、BGM 压低垫底 → 两遍实测 loudnorm(EBU R128, 优先线性) 到交付目标 →
    按实测画面时长补齐/裁短(不用 -shortest, 也不截画面)。返回母带处理记录。"""
    # Audio resampling and AAC packetization can finish a few milliseconds
    # before the last video frame. -shortest then drops real pictures (including
    # buffered B-frames on the stream-copy route). Bound audio to the measured
    # picture duration instead; never truncate/pad the already assembled video.
    video_duration = media_duration(video, "v")
    if not math.isfinite(video_duration) or video_duration <= 0:
        raise ValueError('final mux requires a measured positive video duration')
    samples = int(round(video_duration * AUDIO_RATE))
    stem = Path(out).stem
    mixed = str(Path(narration).parent / f"_{stem}_mix.wav")
    mastered = str(Path(narration).parent / f"_{stem}_master.wav")
    inputs, fc, srcs = ["-i", narration], [f"[0:a]{_AFMT}[nr]"], ["[nr]"]
    if bgm:
        inputs += ["-i", bgm]
        fc.append(f"[1:a]{_AFMT},volume={bgm_volume}[bgm]")
        srcs.append("[bgm]")
    # 混音: 解说优先(duration=first 跟随解说长度)
    if len(srcs) > 1:
        fc.append(f"{''.join(srcs)}amix=inputs={len(srcs)}:"
                  f"duration=first:dropout_transition=0:normalize=0[amixed]")
        label = "[amixed]"
    else:
        label = "[nr]"
    fc.append(f"{label}apad,atrim=end_sample={samples},asetpts=PTS-STARTPTS[aout]")
    enabled = MASTER_LOUDNORM if master is None else master
    record = {"enabled": bool(enabled), "target": {"integrated_lufs": LOUDNESS_I,
              "true_peak_dbtp": LOUDNESS_TP, "lra_lu": LOUDNESS_LRA}}
    try:
        run(["ffmpeg", "-y", *inputs, "-filter_complex", ";".join(fc), "-map", "[aout]", *_WAV, mixed])
        audio = mixed
        if enabled:
            target = f"I={LOUDNESS_I}:TP={LOUDNESS_TP}:LRA={LOUDNESS_LRA}"
            first = _loudnorm_json(run(["ffmpeg", "-hide_banner", "-nostats", "-i", mixed, "-af",
                                        f"loudnorm={target}:print_format=json", "-f", "null", "-"]).stderr)
            record["measured"] = {k: _finite(first.get(k)) for k in
                                  ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")}
            if (record["measured"]["input_i"] or -99) < -60 or any(
                    v is None for v in record["measured"].values()):
                record["skipped"] = "near_silent_or_unmeasurable"
            else:
                m = record["measured"]
                # 线性(静态增益)优先: 电影混音 LRA 天然大, 目标 LRA 不低于实测值, loudnorm 才不会
                # 退回动态压缩; 只有真峰值放不下时才由 loudnorm 动态限峰。measured_LRA=0 会被
                # loudnorm 当成"未给出"而强制动态, 下限 0.01。
                lra = round(min(50.0, max(LOUDNESS_LRA, m['input_lra'] + 0.5)), 1)
                record["applied_lra_lu"] = lra
                norm = (f"loudnorm=I={LOUDNESS_I}:TP={LOUDNESS_TP}:LRA={lra}:"
                        f"measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
                        f"measured_LRA={max(0.01, m['input_lra'])}:measured_thresh={m['input_thresh']}:"
                        f"offset={m['target_offset']}:linear=true:print_format=json")
                second = _loudnorm_json(run(["ffmpeg", "-y", "-hide_banner", "-nostats", "-i", mixed, "-af",
                                             f"{norm},{_AFMT},apad,atrim=end_sample={samples}",
                                             *_WAV, mastered]).stderr)
                record.update(normalization_type=second.get("normalization_type"),
                              output_i=_finite(second.get("output_i")),
                              output_tp=_finite(second.get("output_tp")))
                audio = mastered
        vinputs = ["-i", video, "-i", audio]
        vf = []
        # 视频: 有字幕则烧录; 中间片为无损, 无字幕也必须做这唯一一次交付编码
        if subtitle:
            sub = str(positioned_subtitle(Path(subtitle).resolve(), sub_pos))
            # force_style 的 Alignment 会被 libass 按旧 SSA 编号解释(8=中间靠左),
            # 所以样式里固定底部居中(两套编号里 2 都是底部居中), 顶部/正中改用每条
            # 字幕自带的 {\an8}/{\an5}。lower=底部对齐但上抬, 落在画面下 1/3 处。
            margin_v = 60 if sub_pos == "lower" else 45
            style = (f"FontName={font_name},FontSize=20,"
                     f"PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,"
                     f"BackColour=&H99000000,Bold=1,BorderStyle=1,Outline=2,"
                     f"Shadow=1,Alignment=2,MarginV={margin_v}")
            # 路径双层转义(滤镜图一层 + 选项值一层), 含 : 或 ' 的路径才不会被切断; 不加引号
            sub_opts = f"filename={sty.ffmpeg_filter_escape(sub)}"
            if fontsdir:
                sub_opts += f":fontsdir={sty.ffmpeg_filter_escape(fontsdir)}"
            vf = ["-filter_complex", f"[0:v]subtitles={sub_opts}:force_style='{style}'[vout]"]
            vmap = "[vout]"
        else:
            vmap = "0:v:0"
        run(["ffmpeg", "-y", *vinputs, *vf, "-map", vmap, "-map", "1:a:0", *_final_v(),
             "-fps_mode:v", "passthrough", "-c:a", "aac", "-b:a", AUDIO_BITRATE,
             "-ar", str(AUDIO_RATE), "-ac", "2", "-movflags", "+faststart", out])
    finally:
        for path in (mixed, mastered):
            Path(path).unlink(missing_ok=True)
    return record


def _prune_clips(clips_dir: str, keep: set[str]) -> int:
    """删掉本次渲染不再引用的旧切片/旧版中间文件(缓存只保留当前 EDL 会复用的)。"""
    removed = 0
    for path in Path(clips_dir).iterdir() if Path(clips_dir).is_dir() else []:
        if (path.is_file() and path.name.startswith(("seg_", "oa_", "breath_", "sega_", "_full_"))
                and str(path) not in keep):
            path.unlink(missing_ok=True)
            removed += 1
    return removed


def _render(edl_path: str, video: str, shots_path: str, out: str,
            clips_dir: str, subtitle: str | None = None, bgm: str | None = None,
            bgm_volume: float = 0.18, sub_pos: str = "top",
            script_path: str | None = None,
            breath_every: int = 0, breath_sec: float = 6.0, font: dict | None = None) -> dict:
    """渲染主流程(源 step_e_render.render 的 v11 用法路径), 返回质检报告。"""
    edl = load_json(edl_path)
    timeline_meta = load_json(shots_path) if shots_path and Path(shots_path).exists() else {}
    previous_fps = getattr(_STATE, "fps", None)
    _STATE.fps = output_fps(video, timeline_meta)
    try:
        return _render_timeline(edl, timeline_meta, video, shots_path, out, clips_dir, subtitle, bgm,
                                bgm_volume, sub_pos, script_path, breath_every, breath_sec, font)
    finally:
        _STATE.fps = previous_fps


def _render_source_proof(edl: list[dict], out: Path, timeline: dict, clock: dict) -> dict | None:
    """Use an EDL's immutable proof only while the active proof is intact too."""
    from . import movie_edit_spans
    from .source_usage import declares_proof
    declared = []
    for entry in edl:
        for row in [entry, *entry.get('windows', [])]:
            if 'source_edit_proof_id' in row:
                value = row['source_edit_proof_id']
                if not isinstance(value, str) or not value:
                    raise ValueError('invalid source_edit_proof_id')
                declared.append(value)
    identifiers = set(declared)
    if len(identifiers) > 1:
        raise ValueError('mixed source_edit_proof_id declarations')
    active = movie_edit_spans.load(out, timeline, clock)
    if active is None:
        if declares_proof(edl):
            raise ValueError('source_edit_proof_missing')
        return None
    if identifiers and (identifier := next(iter(identifiers))) != active['proof_id']:
        previous = movie_edit_spans.load(out, timeline, clock, proof_id=identifier)
        if previous is None:
            raise ValueError('source_edit_proof_missing')
        return previous
    return active


def _render_timeline(edl, timeline_meta, video, shots_path, out, clips_dir, subtitle, bgm,
                     bgm_volume, sub_pos, script_path, breath_every, breath_sec, font) -> dict:
    fps = _fps()
    clock, source_edit_proof = None, None
    if isinstance(timeline_meta, dict) and timeline_meta.get('time_origin') == 'source_container_pts':
        from . import movie_refinement
        clock = movie_refinement.frame_clock(Path(video), movie_refinement.exact_fps(timeline_meta),
                                             Path(shots_path).parent / movie_refinement.CLOCK)
        if timeline_meta.get('frame_clock_id') != clock['clock_id']:
            raise ValueError('movie render source clock changed')
        source_edit_proof = _render_source_proof(edl, Path(shots_path).parent, timeline_meta, clock)
    # V3 EDL 必须再次通过无重复硬门禁: 即使有人手工改过 EDL,
    # 渲染层也不能把重叠/倒带镜头写进成片。
    from .source_usage import declares_proof
    if edl and (source_edit_proof is not None or declares_proof(edl)
                or any(str(x.get("schema_version", "")).startswith("3") for x in edl)):
        qc = audit_edl(edl, fps=float(timeline_meta.get("fps", FPS) or FPS),
                       min_window_sec=MIN_WINDOW_SEC, source_edit_proof=source_edit_proof,
                       source_clock=clock)
        if qc["status"] != "passed":
            raise RuntimeError(
                "拒绝渲染未通过无重复质检的EDL: "
                f"重复{len(qc['duplicate_shots'])}/"
                f"重叠{len(qc['overlapping_source_frames'])}/"
                f"倒退{len(qc['source_time_regressions'])}/"
                f"短闪{len(qc['too_short_windows'])}/"
                f"源证明{len(qc.get('source_usage_errors', []))}: "
                f"{qc.get('source_usage_errors', [])[:3]}")
    shots = shot_index(shots_path) if shots_path and Path(shots_path).exists() else {}
    Path(clips_dir).mkdir(parents=True, exist_ok=True)
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    stream = source_audio_stream(video)
    hdr = hdr_info(video)
    if stream is None:
        _log("[E] 片源无音轨: 原声段/垫底按静音处理")
    elif stream["count"] > 1:
        _log(f"[E] 片源 {stream['count']} 条音轨, 选第 {stream['position']} 条({stream['reason']}, "
             f"lang={stream.get('language')})")
    if hdr["warning"]:
        _log(f"[E] 警告: {hdr['warning']}")

    # --- 0. 并行预切所有段(多核加速); 主循环只做记账, 与预切共用同一份切片计划 ---
    items = _precut_all(edl, shots, video, clips_dir, breath_every, breath_sec,
                        **({'clock': clock} if clock is not None else {}),
                        **({'source_edit_proof': source_edit_proof} if source_edit_proof is not None else {}))

    # 解说增益: 显式值优先; 否则按全部解说的实测积分响度(中位数)一次性对齐到 STEM_LUFS,
    # 与原声段同一工作电平(单一静态增益, 不逐段动态压缩)。音量在此一次快照。
    narr_g = _narr_gain()
    narration_lufs = None
    if narr_g is None:
        levels = sorted(x for x in (_audio_lufs(e["audio_path"]) for e in edl
                                    if not e.get("original_audio") and e.get("audio_path"))
                        if x is not None and x > -60)
        narration_lufs = levels[len(levels) // 2] if levels else None
        narr_g = round(min(4.0, max(0.25, 10 ** (_gain_to(narration_lufs, STEM_LUFS) / 20))), 4)
        _log(f"[E] 解说响度 {narration_lufs} LUFS → 增益 {narr_g:.3f} (分轨目标 {STEM_LUFS} LUFS)")
    bed_v, tail_v = _bed_vol(), _tail_vol()
    recipe = _clip_recipe(video, clock)

    # --- 1. 逐段记账 + 构造每段音频 ---
    seg_videos, seg_audios, seg_durations = [], [], []
    seg_offsets: dict[str, float] = {}   # 解说段 seg_id → 成片起始时间(字幕重定位用)
    oa_cues = []                         # 原声段台词字幕(绝对时间)
    oa_subtitles: list[dict] = []        # 原声段是否已有片源硬字幕(逐段判定, 写进渲染报告)
    scene_spans: dict[str, tuple[float, float]] = {}   # seg_id → (成片起点, 本段音频终点)
    burned_cache = movie_subtitles.DetectionCache(Path(clips_dir) / "_burned_subtitles.json")
    cum = 0.0
    # 预期接缝表(成片帧号), 渲染后逐个查残帧。帧数按每段实测帧数累加,
    # 不用秒×fps 取整(每段几十毫秒误差累到片尾就对不上帧)。
    seams: list[dict] = []
    cum_frames = [0]
    actual_windows, actual_segments, timeline_errors = [], [], []
    drift_rows: list[dict] = []
    keep: set[str] = set()

    def _account(seg_id: str, count: int, internal: list[int] | None = None,
                 entry: dict | None = None, windows: list | None = None,
                 measured: dict | None = None) -> None:
        start = cum_frames[0]
        if entry is not None:
            rows, errors = _window_manifest(entry, windows, start, count, measured or {}, shots)
            actual_windows.extend(rows)
            timeline_errors.extend(errors)
        actual_segments.append({'seg_id': seg_id, 'start_frame': start, 'end_frame': start+count,
                                'start': start/fps, 'end': (start+count)/fps,
                                'original_audio': bool(entry and entry.get('original_audio'))})
        if cum_frames[0] > 0:
            seams.append({"frame": cum_frames[0], "seg_id": seg_id, "kind": "seg"})
        for off in internal or []:
            seams.append({"frame": cum_frames[0] + off, "seg_id": seg_id, "kind": "win"})
        cum_frames[0] += count

    for item in items:
        e, wins = item["entry"], item["wins"]
        measured = item.get("measured") or _make_item(item, clock)
        count = int(measured["total"])
        keep.update({item["video"], item["video"] + ".fp", *([item["audio"]] if "audio" in item else [])})
        first_st = wins[0][0]

        # --- 原声穿插段: 电影自己说话(原片画面+实测增益原声, 无解说无BGM) ---
        if item["kind"] == "oa":
            odur = count / fps
            _account(e["seg_id"], count, entry=e, windows=wins, measured=measured)
            seg_videos.append(item["video"])
            seg_audios.append(item["audio"])
            seg_durations.append(odur)
            scene_spans[e["seg_id"]] = (cum, cum + odur)
            lines = list(e.get("subtitle_lines", []))
            decision = _source_subtitles(video, first_st, lines, burned_cache) if lines else \
                {"status": "no_dialogue", "burned_in": False}
            if not decision.get("burned_in"):
                for line in lines:
                    oa_cues.append((cum + float(line["start"]),
                                    cum + min(float(line["end"]), odur),
                                    str(line.get("text", "")), e["seg_id"]))
            oa_subtitles.append({"seg_id": e["seg_id"], "source_start": round(first_st, 3),
                                 "dialogue_lines": len(lines),
                                 "cues_added": 0 if decision.get("burned_in") else len(lines),
                                 **{k: v for k, v in decision.items() if k != "sample_times"}})
            if lines:
                _log(f"    ↳ 原声字幕: 片源硬字幕={decision.get('status')} "
                     f"({decision.get('hits', 0)}/{decision.get('readable', 0)} 帧)"
                     f"{' → 不再叠加本片字幕' if decision.get('burned_in') else ''}")
            cum = cum_frames[0] / fps
            _log(f"  [oa] {e['seg_id']}: 原声{odur:.1f}s @原片{measured.get('audio_start', first_st):.0f}s"
                 f" 增益{measured.get('gain_db', 0):+.1f}dB")
            continue

        # --- 呼吸段: 纯原片原声(无解说无字幕), 画面只在本段已审批镜头内顺延, 不足定格 ---
        if item["kind"] == "breath":
            bdur = count / fps
            _account(f"breath_{e['seg_id']}", count,
                     entry={'seg_id': f"breath_{e['seg_id']}", 'original_audio': True, 'breath': True},
                     windows=[(measured["start"], bdur)], measured=measured)
            seg_videos.append(item["video"])
            seg_audios.append(item["audio"])
            seg_durations.append(bdur)
            cum = cum_frames[0] / fps
            held = count - int(measured["available"])
            _log(f"    ↳ 呼吸段 {bdur:.1f}s 纯原声@{measured['start']:.0f}s"
                 f"{f' (定格{held}帧)' if held > 0 else ''}")
            continue

        seg_v = item["video"]
        # 视频只能落在整帧边界, 真实段长可能比 MP3 标称时长多几十毫秒。
        # 后续音频、字幕都以这个最终画面段长为唯一时间基。
        seg_dur = count / fps
        # 上游漂移硬检查(补齐/裁短之前): 解说实测时长必须与计划一致且不长于画面,
        # 否则 atrim 会静默掐掉解说或整段错位。
        narr_actual = media_duration(e["audio_path"], "a")
        planned = float(e.get("audio_dur") or 0)
        drift_rows.append({"seg_id": e["seg_id"], "planned_audio_sec": round(planned, 3),
                           "actual_audio_sec": round(narr_actual, 3), "picture_sec": round(seg_dur, 3),
                           "planned_picture_sec": round(_seg_vdur(e), 3)})
        if (planned > 0 and abs(narr_actual - planned) > DRIFT_TOL) or narr_actual - seg_dur > DRIFT_TOL:
            raise RuntimeError(
                f"拒绝合成上游漂移的音画: {e['seg_id']} 解说实测{narr_actual:.3f}s / "
                f"计划{planned:.3f}s / 画面{seg_dur:.3f}s (容差{DRIFT_TOL}s)")

        # 该段音频: 解说为主 + 原片原声垫底;有呼吸留白时,留白部分原声升到
        # tail_vol(解说停、原声起)——bed=0 也要为留白建原声轨。
        bed_windows = [(w["start"], w["frames"] / fps) for w in measured["windows"]]
        tail = float(e.get("tail_sec", 0) or 0)
        need_tail_audio = tail > 0.05 and tail_v > 0
        seg_a = f"{clips_dir}/sega_{e['seg_id']}.wav"
        if bed_v > 0 or need_tail_audio:
            narr_end = seg_dur - tail if need_tail_audio else None
            audio_fp = _content_fp("bed-v6", _file_sig(video), recipe, bed_windows,
                                   _file_sig(e["audio_path"]), seg_dur,
                                   bed_v, narr_g, tail_v,
                                   narr_end if narr_end is not None else -1)
            if not _cache_ok(seg_a, audio_fp, seg_dur, "a", 0.02):
                _mix_bed(video, bed_windows, seg_dur, e["audio_path"], seg_a,
                         narr_end=narr_end,
                         tail_vol=tail_v if need_tail_audio else None,
                         bed_vol=bed_v, narr_gain=narr_g, clock=clock)
                _cache_mark(seg_a, audio_fp)
            seg_audios.append(seg_a)
            keep.update({seg_a, seg_a + ".fp"})
        elif abs(narr_g - 1.0) > 1e-3:
            # bed=0 且留白静音: 解说仍要过同一增益链, 与原声段工作电平一致
            audio_fp = _content_fp("narr-v2-gain", recipe["audio"], _file_sig(e["audio_path"]),
                                   seg_dur, narr_g)
            if not _cache_ok(seg_a, audio_fp, seg_dur, "a", 0.02):
                _mix_bed(video, [], seg_dur, e["audio_path"], seg_a,
                         narr_gain=narr_g)
                _cache_mark(seg_a, audio_fp)
            seg_audios.append(seg_a)
            keep.update({seg_a, seg_a + ".fp"})
        else:
            seg_audios.append(e["audio_path"])
        # 段内多窗口的接缝 = 前面各窗口实测帧数累加
        internal: list[int] = []
        acc = 0
        for w in measured["windows"][:-1]:
            acc += int(w["frames"])
            if acc < count:
                internal.append(acc)
        _account(e["seg_id"], count, internal, entry=e, windows=wins, measured=measured)
        seg_videos.append(seg_v)
        seg_durations.append(seg_dur)
        seg_offsets[e["seg_id"]] = cum
        scene_spans[e["seg_id"]] = (cum, cum + min(seg_dur, narr_actual if narr_actual > 0 else seg_dur))
        cum = cum_frames[0] / fps
        _log(f"  {e['seg_id']}: {e['audio_dur']:.0f}s · {len(wins)}镜"
             f"{f' · 留白{tail:.1f}s' if tail > 0.05 else ''}")

    # --- 2. 拼接所有段的画面(无损 -c copy) ---
    full_v = f"{clips_dir}/_full_video.mp4"
    full_narr = f"{clips_dir}/_full_narration.wav"
    try:
        _concat(seg_videos, full_v)

        # --- 2.5 接缝帧扫描(在烧字幕之前扫, 字幕出没不会混进帧差) ---
        seam_report: dict = {"status": "skipped" if seams else "not_applicable",
                             "reason": "disabled" if seams else "no_seams", "n_seams": len(seams)}
        if SEAM_SCAN and seams:
            try:
                seam_report = _seam_scan(full_v, seams)
            except Exception as exc:   # 扫描是质检不是渲染, 失败只记录
                seam_report = {"status": "skipped", "reason": f"{type(exc).__name__}: {exc}",
                               "n_seams": len(seams)}
            if seam_report.get("status") == "residual_frames":
                _log(f"[E] 接缝扫描: {seam_report['n_bad']}/{seam_report['n_seams']} 处残帧 "
                     f"(首例 {seam_report['bad_seams'][0]['t']}s {seam_report['bad_seams'][0]['seg_id']})")
            else:
                _log(f"[E] 接缝扫描: {seam_report.get('status')} "
                     f"({seam_report.get('n_clean', 0)}/{seam_report.get('n_seams', 0)} 干净)")

        # --- 3. 拼接音频(纯拼接, 每段音频按累计采样边界补齐/裁短到视频段整帧时长) ---
        _concat_audio_plain(seg_audios, full_narr, seg_durations)

        # 拼接后的整体对齐自检(上游漂移已逐段硬检查; 这里只兜采样舍入/拼接异常)。
        full_v_dur = media_duration(full_v, "v")
        full_a_dur = media_duration(full_narr, "a")
        if abs(full_v_dur - full_a_dur) > (1.0 / fps + 0.01):
            raise RuntimeError(
                f"拒绝合成累计漂移的音画轨: 视频{full_v_dur:.3f}s / "
                f"音频{full_a_dur:.3f}s")
        _log(f"[E] 分段时间基对齐 (视频{full_v_dur:.3f}s / 音频{full_a_dur:.3f}s)")

        # 始终按真实视频段起点重建字幕: 即使没有呼吸段, 逐段整帧取整也会产生
        # 几十毫秒差值; 不在段内归零, 长片后半段就会逐渐漂移。
        sub_use = subtitle
        subtitle_timing = None
        burned_cache.save()
        keep.add(str(burned_cache.path))
        if script_path and Path(script_path).exists() and subtitle:
            sub_use = f"{clips_dir}/_subtitle_aligned.srt"
            subtitle_timing = _rebuild_subtitle(script_path, seg_offsets, sub_use, extra_cues=oa_cues,
                                                scene_spans=scene_spans)
            _log(f"  字幕最短显示: 低于 {movie_subtitles.MIN_DURATION:.2f}s 的 "
                 f"{subtitle_timing['before']['below_min_duration']} → "
                 f"{subtitle_timing['after']['below_min_duration']} 条")
            _log(f"  字幕已按最终画面时间轴重建 → {sub_use}")

        # --- 4. 混音 + 母带响度 + 唯一一次交付编码(字幕烧录 + BGM) ---
        font = font or {}
        master = _mux(full_v, full_narr, out, sub_use, bgm, bgm_volume, sub_pos,
                      font.get("family") or "Noto Sans CJK SC", fontsdir=font.get("fontsdir"))
    finally:
        for path in (full_v, full_narr):
            Path(path).unlink(missing_ok=True)

    # --- 4.6 成片整体微加速(默认 1.0 原速, 环境变量 RENDER_SPEEDUP 可开) ---
    if abs(SPEEDUP - 1.0) > 1e-3:
        _global_speedup(out, SPEEDUP)
        _log(f"  成片整体 {SPEEDUP}x 加速")

    # --- 5. 自检 ---
    vd = media_duration(out, "v")
    ad = media_duration(out, "a")
    _log(f"[E] 成片 {out}  视频{vd:.1f}s 音频{ad:.1f}s"
         f"{' +字幕' if subtitle else ''}{' +BGM' if bgm else ''}")
    av_drift = abs(vd - ad)
    if av_drift > max(0.1, 2.0 / fps):
        raise RuntimeError(f"成片音视频时长差 {av_drift:.3f}s, 拒绝交付")
    _log(f"[E] 音视频对齐 (差 {av_drift:.3f}s)")
    loud = _loudness(out)
    loudness_flag = "unmeasured"
    if loud["integrated_lufs"] is not None:
        tp = loud["true_peak_dbtp"]
        loudness_flag = ("clip-risk" if tp is not None and tp > LOUDNESS_TP + 0.5 else
                         "mean-too-low" if loud["integrated_lufs"] < LOUDNESS_I - 1.5 else
                         "too-loud" if loud["integrated_lufs"] > LOUDNESS_I + 1.5 else "ok")
        if not master.get("enabled") and loudness_flag in ("mean-too-low", "too-loud"):
            loudness_flag = "ok"   # 母带响度归一被显式关闭时只拦削波
        _log(f"[E] 响度[{loudness_flag}] {loud['integrated_lufs']:.1f} LUFS / 真峰值 "
             f"{tp if tp is not None else float('nan'):.1f} dBTP / LRA {loud['lra_lu']} LU")
    if abs(SPEEDUP - 1.0) > 1e-3:
        timeline_errors.append('global speedup requires a new measured timeline')
    total_frames = _nb_frames(out)
    if total_frames != cum_frames[0]:
        timeline_errors.append('final frame count differs from assembled segments')
    rendered_usage = None
    if source_edit_proof is not None:
        rendered_usage = _audit_rendered_windows(edl, actual_windows, source_edit_proof=source_edit_proof,
                                                 source_clock=clock)
        if rendered_usage['status'] != 'passed':
            # Fail closed for delivery: the produced cut no longer proves its source ledger.
            timeline_errors.append('rendered window manifest failed the source-usage audit')
            _log("[E] 成片窗口源帧复核未通过: " + json.dumps(
                {k: rendered_usage[k][:3] for k in ('duplicate_shots', 'overlapping_source_frames',
                 'source_time_regressions', 'explicit_reuse', 'source_usage_errors')}, ensure_ascii=False))
    removed = _prune_clips(clips_dir, keep)
    if removed:
        _log(f"[E] 清理 {removed} 个过期切片/中间文件")
    return {
        "n_segments": len(edl),
        "video_duration_sec": round(vd, 3),
        "audio_duration_sec": round(ad, 3),
        "av_drift_sec": round(av_drift, 3),
        "loudness": {**loud, "master": master},
        "loudness_integrated_lufs": loud["integrated_lufs"],
        "loudness_true_peak_dbtp": loud["true_peak_dbtp"],
        "loudness_lra_lu": loud["lra_lu"],
        "loudness_flag": loudness_flag,
        "subtitle_burned": bool(sub_use),
        "aligned_subtitle_path": sub_use if (sub_use and sub_use != subtitle) else None,
        "seam_scan": seam_report,
        "original_audio_subtitles": oa_subtitles,
        "subtitle_timing": subtitle_timing,
        'fps': fps, 'fps_rational': _fps_arg(), 'speedup': SPEEDUP, 'total_frames': total_frames,
        'actual_windows': actual_windows, 'actual_segments': actual_segments,
        'actual_timeline_status': 'unavailable' if timeline_errors else 'measured',
        'actual_timeline_errors': timeline_errors,
        'rendered_source_usage': rendered_usage,
        'drift': {"tolerance_sec": DRIFT_TOL, "segments": drift_rows,
                  "max_audio_vs_plan_sec": round(max((abs(r["actual_audio_sec"] - r["planned_audio_sec"])
                                                      for r in drift_rows), default=0.0), 3)},
        'narration_gain': narr_g, 'narration_lufs': narration_lufs,
        'source_clock_mode': recipe["clock"][1] if recipe["clock"] else None,
        'audio_stream': stream, 'hdr': hdr,
        'encoding': {"render_version": RENDER_VERSION, "intermediate": f"libx264 qp={INTER_QP}",
                     "final": f"libx264 preset={FINAL_PRESET} crf={FINAL_CRF:g}",
                     "audio": f"{AUDIO_RATE} Hz stereo, aac {AUDIO_BITRATE}"},
    }


# ---------------------------------------------------------------------------
# 工具入口
# ---------------------------------------------------------------------------

def render_narrated(args: dict, ctx: RunContext) -> ToolResult:
    """Serialize publication with the native output locks used by other editors."""
    output = ctx.resolve(args.get("output_path") or "out/final.mp4")
    work = ctx.resolve(args.get("work_dir") or ".video_agent/render_narrated")
    try:
        with output_locks(ctx, [output, output.with_suffix('.render_report.json'), work]):
            return _render_narrated(args, ctx)
    except (OSError, ValueError) as exc:
        return ToolResult('[ERROR] movie render: ' + str(exc), is_error=True)
    finally:
        _STATE.input_hashes = {}


def _render_narrated(args: dict, ctx: RunContext) -> ToolResult:
    """EDL → 带解说配音+字幕+BGM 的最终成片(内部先 build_srt / build_from_edl)。"""
    _STATE.log = []
    # 解说增益: 显式参数 > VE_RENDER_NARR_GAIN > 自动(按实测响度对齐分轨工作电平, 见 _render_timeline)
    raw_gain = args.get("narration_gain") if args.get("narration_gain") is not None else NARR_GAIN
    gain = None
    if raw_gain is not None:
        try:
            gain = float(raw_gain)
            if not 0 < gain <= 4:
                raise ValueError
        except (TypeError, ValueError):
            return ToolResult(text="[ERROR] narration_gain must be in (0, 4]")
    _STATE.narr_gain = gain
    # 垫底默认静音；只有显式传入的已审核原声段保留源片声音。
    # 本次调用的覆盖值放线程本地 (见 _STATE 注), 不写模块全局。
    if args.get("bed_volume") is not None:
        try:
            bed = float(args["bed_volume"])
            if not 0 <= bed <= 1:
                raise ValueError
        except (TypeError, ValueError):
            return ToolResult(text="[ERROR] bed_volume must be a number in [0, 1]")
        _STATE.bed_vol = bed
    else:
        _STATE.bed_vol = _knob_float("BED_VOLUME", 0.0)
    if args.get("tail_volume") is not None:
        try:
            tv = float(args["tail_volume"])
            if not 0 <= tv <= 1:
                raise ValueError
        except (TypeError, ValueError):
            return ToolResult(text="[ERROR] tail_volume must be a number in [0, 1]")
        _STATE.tail_vol = tv
    else:
        _STATE.tail_vol = _knob_float("TAIL_VOLUME", 0.0)
    for key in ("edl_path", "video_path", "timeline_path", "script_path"):
        if not args.get(key):
            return ToolResult(text=f"[ERROR] {key} is required")
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        return ToolResult(text="[ERROR] ffmpeg/ffprobe not found on PATH")

    edl_path = ctx.resolve(args["edl_path"])
    video_path = ctx.resolve(args["video_path"])
    timeline_path = ctx.resolve(args["timeline_path"])
    script_path = ctx.resolve(args["script_path"])
    for name, p in (("edl", edl_path), ("video", video_path),
                    ("timeline", timeline_path), ("script", script_path)):
        if not p.is_file():
            return ToolResult(text=f"[ERROR] {name} file not found: {p}")

    work_dir = ctx.resolve(args.get("work_dir") or ".video_agent/render_narrated")
    # 整部片源的 SHA-256 按文件签名缓存(大小/mtime/ctime/inode 任一变化即重算), 不再每次渲染全片重算
    digest_store = work_dir / "_source_digests.json"
    input_hashes = {str(p): _cached_digest(p, digest_store)
                    for p in (edl_path, video_path, timeline_path, script_path)}
    timeline_meta = load_json(timeline_path)
    if isinstance(timeline_meta, dict) and timeline_meta.get('time_origin') == 'source_container_pts':
        from .movie_refinement import CLOCK
        clock_path = timeline_path.parent / CLOCK
        input_hashes[str(clock_path)] = file_digest(clock_path)

    try:
        edl = load_json(edl_path)
    except Exception as exc:
        return ToolResult(text=f"[ERROR] invalid EDL JSON: {exc}")
    rows = edl.get("segments") if isinstance(edl, dict) else edl
    if not isinstance(rows, list) or not rows:
        return ToolResult(text="[ERROR] EDL has no segments")
    for row in rows:
        if row.get('audio_path'):
            row['audio_path'] = str(ctx.resolve(row['audio_path']))
            audio = Path(row['audio_path'])
            if audio.is_file():
                input_hashes[str(audio)] = file_digest(audio)
    target = ctx.resolve(args.get('output_path') or 'out/final.mp4')
    working = ctx.resolve(args.get('work_dir') or '.video_agent/render_narrated')
    protect_outputs([target, target.with_suffix('.render_report.json')], input_hashes)
    protect_directories([working], input_hashes)
    try:
        from .picture_semantics import audit_edit
        from .picture_windows import enabled as movie_profile
        if movie_profile(ctx.resolve('out')):
            from .picture_semantics import audit_script_binding
            binding_issues = audit_script_binding(load_json(ctx.resolve('out/narration_script.json')), load_json(script_path))
            if binding_issues:
                return ToolResult(text='[ERROR] render: TTS does not match anchored narration',
                                  data={'error': 'tts_script_binding', 'issues': binding_issues})
        issues = audit_edit(rows, load_json(script_path), float(load_json(timeline_path).get('fps', 24)),
                            require_all=movie_profile(ctx.resolve('out')) and not args.get('preview_only'))
        if issues:
            return ToolResult(text='[ERROR] render: sentence/picture evidence no longer matches the EDL',
                              data={'error': 'picture_semantics', 'issues': issues})
    except (ValueError, KeyError, TypeError) as exc:
        return ToolResult(text=f'[ERROR] render: invalid sentence/picture evidence: {exc}')
    # 渲染内核按 list 契约读 EDL; dict 包裹的 segments 落一份展开版
    work_dir.mkdir(parents=True, exist_ok=True)
    # Freeze resolved audio paths in a derived EDL; preserve the user's input.
    flat = work_dir / "edl_segments.json"
    flat.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    edl_path = flat
    input_hashes[str(flat)] = file_digest(flat)

    # 每段解说音频必须可读(TTS 产物路径写在 EDL 里)
    missing_audio = [e.get("seg_id") for e in rows
                     if not e.get("original_audio")
                     and not Path(str(e.get("audio_path") or "")).is_file()]
    if missing_audio:
        return ToolResult(
            text=f"[ERROR] narration audio missing for {len(missing_audio)} segment(s): "
                 f"{missing_audio[:5]}",
            data={"missing_audio_seg_ids": missing_audio})

    output_path = ctx.resolve(args.get("output_path") or "out/final.mp4")
    bgm_volume = float(args.get("bgm_volume", 0.06))
    sub_pos = str(args.get("sub_pos") or "lower")
    if sub_pos not in {"top", "middle", "lower", "bottom"}:
        return ToolResult(text="[ERROR] sub_pos must be one of top/middle/lower/bottom")
    breath_every = int(args.get("breath_every", 0) or 0)
    warnings: list[str] = []

    # --- 字幕: 本次渲染一次性选字体, 校验覆盖实际要烧的全部字形(解说 + 原声台词);
    # 找不到直接报错(不再静默不烧字幕)。结果显式传给渲染, 不写模块全局 ---
    srt_path: str | None = None
    subtitle_font: str | None = None
    font: dict | None = None
    if bool(args.get("subtitle", True)):
        font = _detect_cjk_font(_subtitle_text(script_path, rows))
        if font["error"]:
            return ToolResult(text=(font["error"] or "[ERROR] no CJK-capable font found")
                              + " (or pass subtitle=false to render without subtitles)")
        subtitle_font = font["family"]
        srt_path = str(work_dir / "subtitle.srt")
        try:
            build_srt(str(script_path), srt_path, str(edl_path))
        except Exception as exc:
            return ToolResult(text=f"[ERROR] build_srt failed: {exc}",
                              data={"log": _log_lines()[-20:]})

    # --- BGM: 素材运行时从 bgm_dir(默认 VE_BGM_DIR)读; 没配/目录空则跳过 ---
    bgm_path: str | None = None
    if bool(args.get("bgm", False)):
        bgm_dir_raw = args.get("bgm_dir") or clean_env("VE_BGM_DIR")
        if not bgm_dir_raw:
            warnings.append("bgm_dir not set and VE_BGM_DIR not configured; BGM skipped")
        else:
            bgm_dir = ctx.resolve(bgm_dir_raw)
            if not _bgm_dir_usable(bgm_dir):
                warnings.append(f"bgm_dir has no usable audio (dir missing/empty or "
                                f"all files carry embedded cover art): {bgm_dir}; BGM skipped")
            else:
                bgm_path = str(work_dir / "bgm.wav")
                try:
                    build_from_edl(str(edl_path), bgm_path,
                                   str(work_dir / "bgm"), str(bgm_dir))
                except Exception as exc:
                    # BGM 失败不拖垮渲染: 降级为无 BGM 成片
                    warnings.append(f"BGM build failed, rendering without BGM: {exc}")
                    bgm_path = None

    # --- 渲染 ---
    for extra in (srt_path, font["file"] if font else None, bgm_path):
        if extra:
            path = Path(extra).resolve()
            input_hashes[str(path)] = file_digest(path)
    _STATE.input_hashes = input_hashes
    clips = clips_directory(work_dir)
    started = time.time()
    try:
        from .recap_runtime_state import resource_slot
        with resource_slot('render', timeout=60):
            report = _render(str(edl_path), str(video_path), str(timeline_path),
                         str(output_path), clips_dir=str(clips),
                         subtitle=srt_path, bgm=bgm_path, bgm_volume=bgm_volume,
                         sub_pos=sub_pos, script_path=str(script_path),
                         breath_every=breath_every, font=font)
    except RuntimeBusy:
        return ToolResult(text='[ERROR] render resource busy; retry after the current render finishes',
                          data={'status': 'busy', 'retryable': True})
    except subprocess.TimeoutExpired as exc:
        return ToolResult(text=f"[ERROR] ffmpeg timed out after {exc.timeout}s",
                          data={"warnings": warnings, "log": _log_lines()[-40:]})
    except (RuntimeError, KeyError, ValueError, OSError) as exc:
        return ToolResult(text=f"[ERROR] render failed: {exc}",
                          data={"warnings": warnings, "log": _log_lines()[-40:]})

    if (report.get("hdr") or {}).get("warning"):
        warnings.append(report["hdr"]["warning"])
    actual_picture_issues = []
    if movie_profile(ctx.resolve('out')) and not args.get('preview_only'):
        from .picture_semantics import audit_rendered
        actual_picture_issues = audit_rendered(report, load_json(script_path))
        report['actual_picture_issues'] = actual_picture_issues
    seam = report.get("seam_scan") or {}
    if seam.get("status") == "residual_frames":
        warnings.append(f"seam scan: {seam['n_bad']}/{seam['n_seams']} cuts carry residual frames "
                        f"(visible flash); see data.seam_scan.bad_seams — usually shots.json "
                        f"boundaries not frame-refined (rerun detect_shots with refine=true)")
    elif seam.get("status") not in {"clean", "not_applicable"}:
        warnings.append("seam scan incomplete; retry the scan before delivery")
    if report.get("loudness_flag") != "ok":
        warnings.append(f"loudness {report.get('loudness_flag')}: integrated {report.get('loudness_integrated_lufs')} LUFS, "
                        f"true peak {report.get('loudness_true_peak_dbtp')} dBTP "
                        f"(target {LOUDNESS_I} LUFS / {LOUDNESS_TP} dBTP)")

    report.update({
        "output_path": str(output_path),
        "work_dir": str(work_dir),
        "subtitle_path": srt_path,
        "subtitle_font": subtitle_font,
        "bgm_path": bgm_path,
        "bgm_volume": bgm_volume if bgm_path else None,
        "warnings": warnings,
        "elapsed_seconds": round(time.time() - started, 3),
        "log": _log_lines()[-60:],
    })
    # The native QC verifies the current bytes of every render input.
    try:
        from .timeline import file_sha256
        if any(not Path(raw).is_file() or _cached_digest(Path(raw), digest_store) != digest
               for raw, digest in input_hashes.items()):
            return ToolResult('[ERROR] render inputs changed during rendering',
                              data={'error': 'render_inputs_changed'}, is_error=True)
        aligned = report.get('aligned_subtitle_path')
        if aligned:
            input_hashes[str(Path(aligned).resolve())] = file_digest(Path(aligned))
        write_object(output_path.with_suffix(".render_report.json"),
                       {"tool": "render_narrated",
                        "input_sha256": input_hashes,
                        "output_sha256": file_sha256(output_path),
                        "timeline_sha256": file_sha256(timeline_path),
                        "edl_sha256": file_sha256(ctx.resolve(args["edl_path"])),
                        "tts_sha256": file_sha256(script_path),
                        'output_path': str(output_path),
                        **{k: report[k] for k in ('video_duration_sec', 'audio_duration_sec', 'av_drift_sec')},
                        **{k: report[k] for k in ('fps', 'speedup', 'total_frames', 'actual_windows',
                                                 'actual_segments', 'actual_timeline_status', 'actual_timeline_errors')},
                        **{k: report.get(k) for k in ('fps_rational', 'loudness', 'loudness_flag', 'drift',
                                                     'source_clock_mode', 'audio_stream', 'hdr', 'encoding',
                                                     'narration_gain', 'original_audio_subtitles',
                                                     'subtitle_timing')},
                        'aligned_subtitle_path': report.get('aligned_subtitle_path') or srt_path,
                        'aligned_subtitle_sha256': file_sha256(Path(report.get('aligned_subtitle_path') or srt_path)) if (report.get('aligned_subtitle_path') or srt_path) else None,
                        'actual_picture_issues': actual_picture_issues,
                        "subtitle_burned": report["subtitle_burned"],
                        "seam_scan": seam})
    except (OSError, ValueError, KeyError, TypeError):
        return ToolResult('[ERROR] render provenance could not be published',
                          data={'error': 'render_provenance_missing'}, is_error=True)
    if actual_picture_issues:
        return ToolResult(text='[ERROR] render: actual output is missing required sentence pictures',
                          data={'error': 'actual_picture_semantics', 'issues': actual_picture_issues},
                          artifacts=[str(output_path.with_suffix('.render_report.json'))])
    parts = [f"Final video rendered: {ctx.virtualize(output_path)} "
             f"({report['video_duration_sec']:.1f}s, {report['n_segments']} segments"
             f"{', subtitles burned' if report['subtitle_burned'] else ''}"
             f"{', BGM mixed' if bgm_path else ''})"]
    if warnings:
        parts.append("[WARNING] " + "; ".join(warnings))
    artifacts = [str(output_path)] + ([srt_path] if srt_path else [])
    return ToolResult(text="\n".join(parts), data=report,
                      artifacts=artifacts, video_paths=[str(output_path)])
