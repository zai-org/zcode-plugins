"""解说批量 TTS: 排片写稿 script.json → 逐段合成音频 + 句级时长切分。

移植自 movie_cut pipeline/step_bc_tts.py 的 synth_all():
  - 段级输出契约不变: audio_path/audio_dur/speech_dur/delivery_pause_sec/
    sentences/tts_mode/_tts_fp/_tts_complete — 下游 bind 的语义切片靠 sentences。
  - semantic_out 契约不变: {schema_version, n_units, units[]}。
  - 声音指纹与句界/镜头映射分离; 换镜头只刷新映射, 段落重分句只刷新对齐。
  - 复用公共语音接口；电影默认使用共享 TTS 配音适配器。
"""
from __future__ import annotations

import array
import copy
import hashlib
import json
import math
import re
import shlex
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .result import ToolResult
from .run_context import RunContext, clean_env
from .picture_semantics import POLICY_FIELDS

TTS_SCHEMA_VERSION = "3.2-sentence-gap"
TTS_AUDIO_CACHE_VERSION = "4.0-audio-only"

# Single TTS provider; its id is part of the cache fingerprints.
DEFAULT_PROVIDER = "tts"
SUPPORTED_PROVIDERS = ("tts",)
DEFAULT_RATE = "+0%"

# TTS HTTP 调用走保守低并发，避免并发/限流错误。
TTS_WORKERS = 2

_RATE_RE = re.compile(r"^[+-]\d+%$")


# ---------------------------------------------------------------------------
# 基础工具 (从 movie_cut common.py 抄入, 禁止 import movie_cut)
# ---------------------------------------------------------------------------

def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    """跑一条命令, 失败把 stderr 抛出来 (ffmpeg 出错信息都在 stderr)。"""
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if proc.returncode != 0:
        raise RuntimeError(
            f"command failed (exit {proc.returncode}): {shlex.join(cmd)}\n{proc.stderr[-2000:]}"
        )
    return proc


def _media_duration(path: str | Path) -> float:
    """取音频流时长; 流里没存 duration 时回退 format。"""
    cmd = ["ffprobe", "-v", "error", "-select_streams", "a:0",
           "-show_entries", "stream=duration",
           "-of", "default=noprint_wrappers=1:nokey=1", str(path)]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    try:
        return float(proc.stdout.strip())
    except ValueError:
        cmd2 = ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", str(path)]
        return float(_run(cmd2).stdout.strip() or 0.0)


def _valid_audio(path: str | Path, minimum: float = 0.1) -> bool:
    try:
        return bool(path) and Path(path).exists() and _media_duration(path) > minimum
    except Exception:
        return False


def _load_json(path: str | Path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_json(obj, path: str | Path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# 文本/时间轴辅助 (契约与 movie_cut step_bc_tts 一致)
# ---------------------------------------------------------------------------

def _spoken_text(seg: dict) -> str:
    """TTS 只读口播字段; 兼容未经过 spoken_text 层的旧脚本。"""
    direct = str(seg.get("spoken_text", "")).strip()
    if direct:
        return direct
    units = seg.get("semantic_units", [])
    joined = "".join(
        str(x.get("spoken_text", x.get("text", ""))).strip()
        for x in units if isinstance(x, dict))
    return joined or str(seg.get("text", "")).strip()


def _pause_ms(seg: dict) -> int:
    """没有显式停顿字段时保持 0; 有则夹到 [0, 650]。"""
    if 'planned_picture_pause_seconds' in seg:
        value = seg['planned_picture_pause_seconds']
        if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 3:
            raise ValueError('invalid planned movie picture pause')
        return round(value * 1000)
    if "delivery_pause_ms" not in seg:
        return 0
    try:
        value = int(seg.get("delivery_pause_ms", 0))
    except (TypeError, ValueError):
        value = 0
    return max(0, min(650, value))


def _split_sentences(text: str) -> list[str]:
    """按标点拆句; 过滤纯标点句 (TTS 对纯标点报错)。"""
    parts = re.split(r"(?<=[。！？；])", text)
    out = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if len(p) > 20:
            out.extend([x.strip() for x in re.split(r"(?<=[，、])", p) if x.strip()])
        else:
            out.append(p)
    return [s for s in out if re.sub(r"[\W_]+", "", s, flags=re.UNICODE)]


def _timing_units(seg: dict) -> list[dict]:
    """取字幕/口播双文本及原有 claim 映射, 供整段音频估算句级落点。"""
    rows = []
    for idx, unit in enumerate(seg.get("semantic_units", []), 1):
        if not isinstance(unit, dict):
            continue
        subtitle = str(unit.get("subtitle_text", unit.get("text", ""))).strip()
        spoken = str(unit.get("spoken_text", unit.get("text", ""))).strip()
        if not spoken:
            continue
        rows.append({
            "semantic_unit_id": unit.get(
                "semantic_unit_id", f"{seg.get('seg_id', 'seg')}_u{idx:02d}"),
            "text": subtitle or spoken,
            "subtitle_text": subtitle or spoken,
            "spoken_text": spoken,
            "event_ids": list(unit.get("event_ids", seg.get("event_ids", []))),
            "claim_ids": list(unit.get("claim_ids", [])),
            "anchor_shot_ids": list(unit.get("anchor_shot_ids", [])),
            "cited_shot_ids": list(unit.get("cited_shot_ids", [])),
            "storyboard": list(unit.get("storyboard", [])),
            **{key: copy.deepcopy(unit[key]) for key in
               POLICY_FIELDS
               if key in unit},
        })
    if rows:
        return rows

    subtitle_parts = _split_sentences(str(seg.get("subtitle_text", seg.get("text", ""))))
    spoken_parts = _split_sentences(_spoken_text(seg))
    if len(subtitle_parts) != len(spoken_parts):
        subtitle_parts = [str(seg.get("subtitle_text", seg.get("text", ""))).strip()]
        spoken_parts = [_spoken_text(seg)]
    return [{
        "semantic_unit_id": f"{seg.get('seg_id', 'seg')}_u{i + 1:02d}",
        "text": subtitle or spoken,
        "subtitle_text": subtitle or spoken,
        "spoken_text": spoken,
        "event_ids": list(seg.get("event_ids", [])),
        "claim_ids": list(seg.get("evidence_claim_ids", [])),
        "anchor_shot_ids": [],
    } for i, (subtitle, spoken) in enumerate(zip(subtitle_parts, spoken_parts)) if spoken]


def _speech_weight(text: str) -> float:
    """把整段真实时长按发音量和标点停连分配给语义句。"""
    content = len(re.findall(r"[\w㐀-鿿]", str(text), flags=re.UNICODE))
    commas = len(re.findall(r"[，、,:：]", str(text)))
    stops = len(re.findall(r"[。！？!?；;]", str(text)))
    return max(1.0, content + commas * 0.55 + stops * 0.9)


def _estimate_timeline(seg: dict, speech_dur: float) -> list[dict]:
    """整段合成没有强制对齐信息, 按口播字符与停连估算句界; 尾部呼吸不算字幕。"""
    units = _timing_units(seg)
    if not units or speech_dur <= 0:
        return []
    weights = [_speech_weight(x["spoken_text"]) for x in units]
    total = sum(weights) or 1.0
    timeline, cursor = [], 0.0
    for idx, (unit, weight) in enumerate(zip(units, weights), 1):
        end = speech_dur if idx == len(units) else cursor + speech_dur * weight / total
        timeline.append({**unit, "start": round(cursor, 3), "end": round(end, 3)})
        cursor = end
    return timeline


_QUOTE_CHARS = "“”‘’\"'「」『』"


def _flatten_spoken(text: str) -> str:
    """口播去戏剧化: LLM-TTS 会把 "某某说:" 当剧本说话人标签吞掉, 把引语拿去角色演绎
    (实测: 吞句 / 变声 / 自编对白)。冒号压成逗号、引号删除后此类失误显著减少。
    只动标点不动字, 字幕仍走 subtitle_text/text 原文, 不会音字不符。"""
    t = re.sub(r"[::]", ",", str(text))
    t = re.sub(f"[{_QUOTE_CHARS}]", "", t)
    return re.sub(r"[,,]{2,}", ",", t)


_NUM_RUN_RE = re.compile(r"[0-9零一二三四五六七八九两十百千万亿]+")
_ZH_DIGITS = {'零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
              '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '两': 2}
_ZH_UNITS = {'十': 10, '百': 100, '千': 1000, '万': 10000, '亿': 100000000}


def _zh_chunk_value(chunk: str) -> str:
    """数字片段 → 数值字符串。"2000"与"两千"、"10万"与"十万"归一到同一
    表示——ASR 把"两千块"转写成"2000块"曾被查多误判成加词(实测)。
    解析失败兜底原文(两侧同样处理, 一致性优先于精确值)。"""
    m = re.match(r"([0-9]+)(.*)", chunk)
    if m and m.group(1):
        val = int(m.group(1))
        for ch in m.group(2):
            val *= _ZH_UNITS.get(ch, 1)
        return str(val)
    total, sect, cur = 0, 0, 0
    for ch in chunk:
        if ch in _ZH_DIGITS:
            cur = cur * 10 + _ZH_DIGITS[ch]
        elif ch in _ZH_UNITS:
            if ch == '万':
                total = (total + sect + cur) * 10000
                sect = cur = 0
            elif ch == '亿':
                total = (total + sect + cur) * 100000000
                sect = cur = 0
            else:
                sect += (cur or 1) * _ZH_UNITS[ch]
                cur = 0
    return str(total + sect + cur)


def _norm_cjk(text: str) -> str:
    t = re.sub(r"[^一-鿿A-Za-z0-9]", "", str(text))
    return _NUM_RUN_RE.sub(lambda m: _zh_chunk_value(m.group(0)), t)


def _gram_hit_ratio(target: str, heard: str, n: int = 4) -> float:
    """target 的 n 字滑窗在 heard 中的命中率; 短句退化为整串包含。
    实测分界: TTS 改写/吞句 <0.35, ASR 同音误听仍 >0.6。"""
    t, h = _norm_cjk(target), _norm_cjk(heard)
    if not t:
        return 1.0
    if len(t) <= n:
        return 1.0 if t in h else 0.0
    hits = sum(1 for i in range(len(t) - n + 1) if t[i:i + n] in h)
    return hits / (len(t) - n + 1)


_VERIFY_RATE = 4.4  # 语速合理性估算用 (字/秒, 经验值); 只定区间不做硬契约


def _duration_suspect(chars: int, dur: float) -> str | None:
    """句音频时长与字数的合理区间; ASR 自己会漏听, 时长是独立的第二证据。"""
    if chars <= 0 or dur <= 0:
        return None
    expect = chars / _VERIFY_RATE
    if dur < expect * 0.55:
        return (f"audio {dur:.1f}s too short for {chars} chars "
                f"(expect ~{expect:.1f}s): content likely dropped")
    if dur > expect * 1.8 + 1.2:
        return (f"audio {dur:.1f}s too long for {chars} chars "
                f"(expect ~{expect:.1f}s): dramatized pauses or extra content")
    return None


def _sent_fp(provider: str, voice: str, rate: str, sent: str,
             style: str = "") -> str:
    """句级文件缓存指纹: 认 provider+voice+rate+句文本(+念法指令)。
    注意: 重试同一句必须先删文件, 否则永远复用第一次的坏音频。"""
    key = f"{provider}\x00{voice}\x00{rate}\x00{sent}"
    if style:
        key += f"\x00{style}"   # 无指令时保持旧指纹, 不作废存量缓存
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:10]


def _legacy_tts_fingerprint(seg: dict, provider: str, by_sentence: bool,
                            voice: str, rate: str, style: str = "") -> str:
    """精确复现旧指纹; 仅用于校验旧报告确实由当前声音参数生成。"""
    knobs = (TTS_SCHEMA_VERSION, provider, _spoken_text(seg),
             "sentence" if by_sentence else "paragraph", str(_pause_ms(seg)),
             voice, rate,
             json.dumps(seg.get("semantic_units", []), ensure_ascii=False,
                        sort_keys=True))
    if style:
        knobs = knobs + (style,)
    if seg.get("_continuity_profile"):
        knobs += (json.dumps(seg["_continuity_profile"], sort_keys=True),)
    return hashlib.sha256("\x00".join(knobs).encode("utf-8")).hexdigest()[:16]


def _tts_fingerprint(seg: dict, provider: str, by_sentence: bool,
                     voice: str, rate: str, style: str = "") -> str:
    """只绑定会改变声音的输入。逐句模式的分句会改变合成与句间停顿，必须保留。"""
    payload = {
        "version": TTS_AUDIO_CACHE_VERSION,
        "processing_version": TTS_SCHEMA_VERSION,
        "provider": provider, "voice": voice, "rate": rate, "style": style,
        "text": _spoken_text(seg), "pause_ms": _pause_ms(seg),
        "mode": "sentence" if by_sentence else "paragraph",
        "continuity_profile": seg.get("_continuity_profile"),
    }
    if by_sentence:
        payload["spoken_units"] = [u["spoken_text"] for u in _timing_units(seg)]
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True)
                          .encode("utf-8")).hexdigest()[:16]


def _cached_audio_matches(cached: dict, seg: dict, provider: str, by_sentence: bool,
                          voice: str, rate: str, style: str) -> bool:
    expected = _tts_fingerprint(seg, provider, by_sentence, voice, rate, style)
    if cached.get("_tts_cache_version") == TTS_AUDIO_CACHE_VERSION:
        from .narration_continuity import audio_hash
        return (cached.get("_tts_fp") == expected
                and cached.get("_audio_sha256") == audio_hash(cached["audio_path"]))
    # Old outputs contain the old script and fingerprint. Validate those together
    # before comparing audio-only identities; never guess voice/rate from text.
    old = copy.deepcopy(cached)
    variants = [old]
    if old.get("continuity"):
        without_timing = copy.deepcopy(old)
        for unit in without_timing.get("semantic_units", []):
            if isinstance(unit, dict):
                unit.pop("tts_start", None)
                unit.pop("tts_end", None)
        variants.append(without_timing)
    return any(
        cached.get("_tts_fp") == _legacy_tts_fingerprint(
            variant, provider, by_sentence, voice, rate, style)
        and _tts_fingerprint(variant, provider, by_sentence, voice, rate, style) == expected
        for variant in variants)


def _refresh_cached_timing(seg: dict) -> None:
    """Refresh metadata by position; reuse timestamps only for identical spoken boundaries."""
    units = _timing_units(seg)
    previous = seg.get("sentences") or []
    same_boundaries = ([u["spoken_text"] for u in units]
                       == [str(u.get("spoken_text", u.get("text", ""))) for u in previous])
    if same_boundaries:
        seg["sentences"] = [{**unit, "start": old["start"], "end": old["end"]}
                            for unit, old in zip(units, previous)]
    elif seg.get("continuity"):
        # ASR timing is rebuilt later from the transcript of the same raw audio.
        # Do not expose old sentence boundaries while alignment is pending.
        seg["sentences"] = []
        seg.pop("_alignment_fp", None)
    else:
        seg["sentences"] = _estimate_timeline(seg, float(seg.get("speech_dur", 0)))
    _copy_unit_times(seg)


def _copy_unit_times(seg: dict) -> None:
    by_id = {row["semantic_unit_id"]: row for row in seg.get("sentences", [])}
    for unit in seg.get("semantic_units", []):
        row = by_id.get(unit.get("semantic_unit_id"))
        if row:
            unit["tts_start"], unit["tts_end"] = row["start"], row["end"]
        else:
            unit.pop("tts_start", None)
            unit.pop("tts_end", None)


_STYLE_GUARD = ("以上是念法说明。只朗读下面的正文，正文要一字不差地念完，"
                "不要念说明，也不要加任何正文以外的字词或语气词。")
_MIN_STYLE_CHARS = 10   # 短句不吃指令: 指令给短句太大发挥空间(实测碎句被演绎加词)
_TERMINAL_PUNCT = tuple("。！？!?…")


def _sent_style(style: str, sent: str) -> str:
    """句级生效的念法指令: 只有"够长且句末标点收尾的完整句"才吃指令。
    逗号收尾的碎句(无语义单元老稿的兜底拆分)带指令必即兴加词(实测),
    完整句 46 字级实测 13/13 干净; 不满足条件裸念, 指纹随生效值走。"""
    s = sent.strip()
    if len(_norm_cjk(s)) < _MIN_STYLE_CHARS or not s.endswith(_TERMINAL_PUNCT):
        return ""
    return style


_TONE_CLAUSE_RE = re.compile(r"[,,。;;!!??]")
_TONE_MAX_CHARS = 16     # tone 下发上限(CJK字): 指令越长越像台词, 漏念概率越高


def _strip_quoting_clauses(tone: str, seg: dict) -> str:
    """tone 瘦身两刀: ①剥掉引用了稿件字词的子句——指令与正文明文同发,
    TTS 偶发把指令念出声, 引用稿件字词的子句漏出来最致命(听感像正文加词
    且无字幕; 实锤: tone"这一脚要念得狠"致句尾漏念"这一脚"), 凡与本段口播
    文本共享 CJK 2-gram 的子句一律不下发; ②总长封顶 _TONE_MAX_CHARS,
    超出的子句整条不发。剥离清单记回 seg["tone_stripped"], 写手应改成
    不点名内容的短指令(如"沉稳,放慢")。"""
    if not tone:
        return ""
    text = _norm_cjk(_spoken_text(seg))
    kept, stripped, used = [], [], 0
    for cl in _TONE_CLAUSE_RE.split(tone):
        cl = cl.strip()
        if not cl:
            continue
        ncl = _norm_cjk(cl)
        quoting = any(ncl[i:i + 2] in text for i in range(len(ncl) - 1))
        if quoting or used + len(ncl) > _TONE_MAX_CHARS:
            stripped.append(cl)
        else:
            kept.append(cl)
            used += len(ncl)
    if stripped:
        seg["tone_stripped"] = stripped
    else:
        seg.pop("tone_stripped", None)
    return ",".join(kept) + ("。" if kept else "")


def _seg_style(seg: dict, global_style: str) -> str:
    """段级念法指令 = 全局风格 + 稿子拍级 tone(剥掉引用稿件字词的子句)。
    非空时垫防念句——实测防念句必须是指令的最后一句, 否则 TTS 会把紧邻
    正文的说明当内容念出来。"""
    tone = _strip_quoting_clauses(str(seg.get("tone") or "").strip(), seg)
    combined = f"{global_style}{tone}".strip()
    return (combined + _STYLE_GUARD) if combined else ""


def _pad_audio(raw_audio: str, out_audio: str, pause_ms: int) -> str:
    """段尾加入明确呼吸, 统一转 24kHz 单声道 wav, 避免 MP3 拼接尾差。"""
    if pause_ms <= 0:
        return raw_audio
    speech_dur = _media_duration(raw_audio)
    total = speech_dur + pause_ms / 1000.0
    _run(["ffmpeg", "-y", "-i", raw_audio,
          "-af", f"apad=pad_dur={pause_ms / 1000.0:.3f}",
          "-t", f"{total:.3f}", "-ar", "24000", "-ac", "1",
          "-c:a", "pcm_s16le", out_audio])
    return out_audio


_TRIM_EDGE_SEC = 0.06   # 句音频头尾保留的静音上限
_TRIM_DB = 45           # 头部静音判定阈值(-dB)
# A narration clip is seconds long: analysis passes that outlive these bounds
# are a stuck ffmpeg, not slow audio.
_PROBE_TIMEOUT = 120
_DECODE_TIMEOUT = 300

_TRIM_TAIL_DB = 50      # 尾部裁剪阈值。38dB 曾把尾字衰减段一起切掉
                        # (用户听感"字没念完整", 8-25), 放宽到 50 只切真静音
_TAIL_FADE_SEC = 0.04   # 尾部微淡出, 防更狠裁剪产生的切声
_TAIL_ISLAND_MAX = 0.85  # 尾部孤岛判定: 被静音隔开且自身 ≤此时长的响声段
_TAIL_ISLAND_GAP = 0.30  # 孤岛前的静音下限; 正文内正常停顿多在 0.2s 以内
_SENT_GAP_SEC = 0.50    # 句间统一呼吸(非段尾句尾部补齐)。0.32 被用户评为
                        # "抢着说下一句"(8-25 听感), 放宽到 0.50


def _tail_island_cut(path: str) -> float | None:
    """尾部孤岛检测: 返回应裁到的时刻(秒), 无孤岛返回 None。
    孤岛 = 被 ≥_TAIL_ISLAND_GAP 静音隔开、自身 ≤_TAIL_ISLAND_MAX 的尾部
    响声段(漏念的指令字/嘴音/气口——实测几乎每句尾都有"憋 0.3~0.5s 再冒
    一小声", 现行 silenceremove 碰到它就停手, 憋气+突响整段进成片)。
    从末尾往前可连锁多个孤岛, 但累计剪除的**响声**总长 ≤0.9s——正文尾词
    (≥1s 的连续语音)绝不该被卷进来(实测无上限时会误吃衰减慢的尾词);
    静音部分随剪不计入。"""
    p = subprocess.run(
        ["ffmpeg", "-nostdin", "-i", path, "-af",
         f"silencedetect=noise=-{_TRIM_TAIL_DB}dB:d={_TAIL_ISLAND_GAP}",
         "-f", "null", "-"], capture_output=True, text=True, timeout=_PROBE_TIMEOUT)
    starts = [float(m) for m in re.findall(r"silence_start: (-?[\d.]+)", p.stderr)]
    ends = [float(m) for m in re.findall(r"silence_end: (-?[\d.]+)", p.stderr)]
    if not starts:
        return None
    dur = _media_duration(path)
    sil = [(ss, ends[i] if i < len(ends) else dur)
           for i, ss in enumerate(starts)]
    # 响度保险: 孤岛必须明显比句体轻才许切——正文尾词和句体同响,
    # 杂音碎声才是小声(8-25 前版误切尾词致"字没念完整")。
    dbs = _pcm_rms_profile(path)
    voiced_vals = sorted(d for d in dbs if d > -55)
    if len(voiced_vals) < 10:
        return None
    body = voiced_vals[int(len(voiced_vals) * 0.8)]
    cut, end, sound_cut = None, dur, 0.0
    for ss, se in reversed(sil):
        island = end - se
        if island > _TAIL_ISLAND_MAX or sound_cut + island > 0.9:
            break
        i0, i1 = int(se / 0.02), int(end / 0.02)
        isl_vals = sorted(d for d in dbs[i0:i1] if d > -90)
        isl_lvl = isl_vals[int(len(isl_vals) * 0.8)] if isl_vals else -100
        if isl_lvl > body - 8:
            break                       # 与句体同响: 是正文词, 不切
        cut, end, sound_cut = ss, ss, sound_cut + island
    return cut if cut is not None and cut >= 0.4 else None


_HEAD_ISLAND_GAP = 0.15   # 爆音孤岛判定: 两侧静音下限(实测爆音后隔 0.24s 才开口,
                          # 句内正常停顿多在 0.2s 内——收紧到 0.15 配合频带甄别用)
_HEAD_ISLAND_MAX = 0.50   # 头部孤岛自身时长上限(真词组通常 ≥0.6s)
_HEAD_LOW_RATIO = 0.55    # 低频能量占比门槛: 爆音/嘴音 ≥0.6, 真人声 ≈0.3~0.5
_HEAD_DETECT_DB = 55      # 检测阈值用 -55dB: 爆音是"尖峰+低频衰减", -38dB 会把
                          # 衰减段误判成静音、切点落进爆音中间


def _band_level_db(path: str, t0: float, t1: float, filt: str = "") -> float:
    """取 [t0,t1) 区间的 RMS 电平(dB); filt 可加频带滤镜(如 lowpass)。"""
    af = f"{filt},volumedetect" if filt else "volumedetect"
    p = subprocess.run(
        ["ffmpeg", "-nostdin", "-ss", f"{t0:.3f}", "-i", str(path),
         "-t", f"{t1 - t0:.3f}", "-af", af, "-f", "null", "-"],
        capture_output=True, text=True, timeout=_PROBE_TIMEOUT)
    m = re.search(r"mean_volume: ([-\d.]+) dB", p.stderr)
    return float(m.group(1)) if m else -90.0


def _island_low_ratio(path: str, t0: float, t1: float) -> float:
    """区间内 <500Hz 能量占比(0~1)。低频爆音实测 0.75, 正常语音 0.3~0.5。"""
    full = _band_level_db(path, t0, t1)
    low = _band_level_db(path, t0, t1, "lowpass=f=500")
    if full <= -80:
        return 0.0
    return 10 ** ((low - full) / 10)


def _pcm_rms_profile(path: str, win_sec: float = 0.02) -> list[float]:
    """解码为 16k 单声道, 返回逐 20ms 窗口的 RMS 电平(dB)包络。"""
    p = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(path),
         "-f", "s16le", "-ar", "16000", "-ac", "1", "-"], capture_output=True,
        timeout=_DECODE_TIMEOUT)
    a = array.array("h")
    a.frombytes(p.stdout[: len(p.stdout) // 2 * 2])
    win = int(16000 * win_sec)
    out = []
    for i in range(0, len(a) - win, win):
        seg = a[i:i + win]
        rms = (sum(s * s for s in seg) / win) ** 0.5 / 32768
        out.append(20 * math.log10(rms) if rms > 1e-9 else -100.0)
    return out


def _glued_onset(path: str) -> tuple[float, float] | None:
    """粘着起音检测: 句首一个比人声主体轻 ≥8dB 的杂音(哼声/气声), 粘在
    真人声前面、中间无静音缝——孤立孤岛判据看不见。形态: 突起→跌落(谷比
    突起低 ≥8dB、比主体低 ≥12dB)→0.3~1.5s 内人声主体起来。命中返回
    (0, 切点): 切点在人声主体前留 30ms 自然起头, 之前的全部是杂音可切。
    实测三部片 285 句 75 句命中(26%); A/B 对照(改指令 6 次 vs 原指令 6 次)
    确认与 prompt 无关, 是 TTS 引擎随机产物——只能检出后重掷或切除。"""
    dbs = _pcm_rms_profile(path)
    voiced = [i for i, d in enumerate(dbs) if d > -55]
    if not voiced or voiced[0] > 40:      # 起音必须在开头 0.8s 内
        return None
    start = voiced[0]
    peak = max(dbs[start:start + 6]) if start + 6 <= len(dbs) else max(dbs[start:])
    voiced_vals = sorted(dbs[i] for i in voiced)
    if len(voiced_vals) < 10:
        return None
    body = voiced_vals[int(len(voiced_vals) * 0.8)]
    if peak > body - 8:                   # 起音=主体响度: 正常开口发音, 不是杂音
        return None
    win_v = dbs[start:start + 50]         # 起音区只看开头 1s(句内逗号停顿不算谷)
    if len(win_v) < 20:
        return None
    vmin = min(win_v)
    vi = win_v.index(vmin)
    if peak - vmin < 8 or body - vmin < 12 or vi < 3 or vi > 25:
        return None
    rise = next((i for i in range(vi, len(win_v))
                 if win_v[i] > body - 10), None)
    if rise is None or rise > 45:
        return None
    cut = max(0.0, (start + rise) * 0.02 - 0.03)
    return 0.0, cut


def _head_pop(path: str) -> tuple[float, float] | None:
    """句首爆音检测: 短突起(≤0.3s)顶在文件开头, 后面带一条短静音谷——
    谷不够 0.15s, 孤立孤岛判据两侧静音下限卡不住; 粘着判据也看不见(谷在
    突起"后面", 突起本身被当成人声开头)。形态: 文件头→突起→谷≥0.06s→
    1s 内人声主体起来。实测老炮儿 s017: -40dB 砰声 0.05s + 0.1s 谷, 单句
    扫描全漏, 拼进段里(前面有留白衬底)立刻扎耳。命中返回 (0, 突起末端)。
    防误伤三道: 突起比人声主体轻 ≥8dB(重读首词不切)、低频占比 ≥0.55
    (真词是宽带)、突起 ≤0.3s(词组通常 ≥0.6s)。"""
    dbs = _pcm_rms_profile(path)
    voiced = [i for i, d in enumerate(dbs) if d > -55]
    if not voiced or voiced[0] > 12:      # 突起必须顶在开头 0.24s 内
        return None
    b0 = voiced[0]
    b1 = next((i for i in range(b0 + 1, min(b0 + 26, len(dbs)))
               if dbs[i] <= -55), None)
    if b1 is None or b1 - b0 > 15:        # 连响 >0.3s: 是人声主体不是爆音
        return None
    vlen = 0
    for i in range(b1, min(b1 + 50, len(dbs))):
        if dbs[i] <= -55:
            vlen += 1
        else:
            break
    if vlen < 3:                          # 谷 <0.06s: 突起跟人声粘着, 走粘着判据
        return None
    voiced_vals = sorted(dbs[i] for i in voiced)
    if len(voiced_vals) < 10:
        return None
    body = voiced_vals[int(len(voiced_vals) * 0.8)]
    if max(dbs[b0:b1]) > body - 8:        # 突起≥主体响度: 可能是重读首词
        return None
    # 低频占比门槛比孤岛判据松 0.05: 句首爆音有"顶在文件头+≤0.3s+后带谷+
    # 比主体轻 8dB"四道保险兜着; 实测坏句占比 0.54 正好卡在孤岛门槛下。
    if _island_low_ratio(path, b0 * 0.02, b1 * 0.02) < _HEAD_LOW_RATIO - 0.05:
        return None                       # 宽带=真词, 爆音是低频主导
    return 0.0, b1 * 0.02 + 0.01


def _trim_part(part: str) -> str:
    """句音频边缘静音裁剪 (by_sentence 模式)。TTS 原生头尾静音是随机的
    (0~0.5s), 逐句拼接后句间空隙忽紧忽松, 听感"忽快忽慢"的主因之一。
    这里裁到 ≤0.06s, 句间呼吸交给 _gap_part 按固定规则重建——节奏来自
    规则, 不来自 TTS 残留。尾侧另用更高阈值+微淡出, 专治句尾气口/嘴音;
    再跑一遍孤岛清除, 专治"静音后又冒一小声"(漏念指令字必现形态)。
    裁剪参数编进文件名(调参即换缓存), 并带 mtime 校验(句重合成后自动重裁)。"""
    src = Path(part)
    out = src.with_name(
        f"{src.stem}_trim{int(_TRIM_EDGE_SEC * 1000)}n{_TRIM_DB}"
        f"t{_TRIM_TAIL_DB}f{int(_TAIL_FADE_SEC * 1000)}"
        f"i{int(_TAIL_ISLAND_MAX * 100)}.wav")
    if out.exists() and out.stat().st_mtime >= src.stat().st_mtime and _valid_audio(out):
        return str(out)
    th = f"-{_TRIM_DB}dB"
    tail_th = f"-{_TRIM_TAIL_DB}dB"
    _run(["ffmpeg", "-nostdin", "-y", "-i", str(src), "-af",
          f"silenceremove=start_periods=1:start_threshold={th}:start_silence={_TRIM_EDGE_SEC},"
          f"areverse,"
          f"silenceremove=start_periods=1:start_threshold={tail_th}:start_silence={_TRIM_EDGE_SEC},"
          f"afade=t=in:d={_TAIL_FADE_SEC},"
          f"areverse",
          str(out)])
    if not _valid_audio(out):  # 全静音等极端输入: 裁剪产物无效则只转码不裁 (保持 wav 统一)
        out.unlink(missing_ok=True)
        _run(["ffmpeg", "-nostdin", "-y", "-i", str(src), str(out)])
        if not _valid_audio(out):
            out.unlink(missing_ok=True)
            return str(src)
        return str(out)
    cut = _tail_island_cut(str(out))
    if cut is not None:
        tmp = out.with_name(out.stem + "_ic.wav")
        _run(["ffmpeg", "-nostdin", "-y", "-i", str(out), "-af",
              f"atrim=end={cut:.3f},areverse,"
              f"afade=t=in:d={_TAIL_FADE_SEC},areverse",
              str(tmp)])
        if _valid_audio(tmp):
            tmp.replace(out)
        else:
            tmp.unlink(missing_ok=True)
    return str(out)


def _gap_part(part: str) -> str:
    """非段尾句的尾部补统一句间呼吸。裁剪+定长补齐后, 句间空隙恒定
    ≈_SENT_GAP_SEC(±裁剪残留 ≤0.12s), 替代旧的"TTS 随机残留静音"。
    间隔编进文件名, mtime 校验同 _trim_part。
    注意: 不能走 _pad_audio(它强制重采样 24k)——concat 的各 part 必须同
    采样率, 混拼会产出时长/音调全错的段音频(实测)。这里保持源参数只 apad。"""
    src = Path(part)
    out = src.with_name(f"{src.stem}_g{int(_SENT_GAP_SEC * 1000)}.wav")
    if out.exists() and out.stat().st_mtime >= src.stat().st_mtime and _valid_audio(out):
        return str(out)
    out.unlink(missing_ok=True)
    total = _media_duration(str(src)) + _SENT_GAP_SEC
    _run(["ffmpeg", "-nostdin", "-y", "-i", str(src),
          "-af", f"apad=pad_dur={_SENT_GAP_SEC:.3f}",
          "-t", f"{total:.3f}", "-c:a", "pcm_s16le", str(out)])
    return str(out) if _valid_audio(out) else str(src)


def _artifact_regions(path: str) -> list[tuple[float, float, str]]:
    """全句扫描孤立低频爆音: 返回 [(start, end, 位置), ...], 位置 ∈ head/mid/tail。
    判据: -55dB 下被 ≥0.15s 静音隔开的响声段, 自身 ≤0.5s 且低频占比 ≥0.55
    —— 爆音/嘴音实测低频占比 0.6~0.9, 真词组是宽带人声(≈0.3~0.5)且通常
    ≥0.6s, 两条一起卡才不误伤。句首句尾的孤立响声天然没有一侧语音, 同样命中。"""
    p = subprocess.run(
        ["ffmpeg", "-nostdin", "-i", str(path), "-af",
         f"silencedetect=noise=-{_HEAD_DETECT_DB}dB:d={_HEAD_ISLAND_GAP}",
         "-f", "null", "-"], capture_output=True, text=True, timeout=_PROBE_TIMEOUT)
    starts = [float(m) for m in re.findall(r"silence_start: (-?[\d.]+)", p.stderr)]
    ends = [float(m) for m in re.findall(r"silence_end: (-?[\d.]+)", p.stderr)]
    dur = _media_duration(path)
    regions: list[tuple[float, float]] = []
    prev = 0.0
    for i, ss in enumerate(starts):
        se = ends[i] if i < len(ends) else dur
        if ss - prev >= 0.05:
            regions.append((prev, ss))
        prev = se
    if dur - prev >= 0.05:
        regions.append((prev, dur))
    if len(regions) < 2:
        regions = []     # 整句一段响声: 没有"孤立"可言, 短句不能当爆音误杀
    out: list[tuple[float, float, str]] = []
    for k, (a, b) in enumerate(regions):
        if b - a > _HEAD_ISLAND_MAX:
            continue
        if _island_low_ratio(path, a, b) < _HEAD_LOW_RATIO:
            continue
        pos = "head" if k == 0 else ("tail" if k == len(regions) - 1 else "mid")
        out.append((a, b, pos))
    # 粘着起音(与孤岛判据互补: 杂音粘在人声前、无静音缝)
    glued = _glued_onset(path)
    if glued and not any(glued[0] < e and s < glued[1] for s, e, _ in out):
        out.append((glued[0], glued[1], "head-glued"))
    # 句首爆音(突起后带短谷: 孤岛嫌谷短、粘着嫌谷在突起后面, 都漏)
    hp = _head_pop(path)
    if hp and not any(hp[0] < e and s < hp[1] for s, e, _ in out):
        out.append((hp[0], hp[1], "head-pop"))
    return out


def _cut_regions(src: str, regions: list[tuple[float, float]], out: str) -> bool:
    """从音频里挖掉 regions 列出的区间, 其余按原顺序拼回。"""
    dur = _media_duration(src)
    keeps: list[tuple[float, float]] = []
    prev = 0.0
    for a, b in regions:
        if a - prev > 0.02:
            keeps.append((prev, a))
        prev = max(prev, b)
    if dur - prev > 0.02:
        keeps.append((prev, dur))
    if not keeps:
        return False
    parts = []
    for i, (a, b) in enumerate(keeps):
        p = str(Path(out).with_suffix(f".k{i}.wav"))
        _run(["ffmpeg", "-nostdin", "-y", "-i", str(src), "-af",
              f"atrim=start={a:.3f}:end={b:.3f},asetpts=PTS-STARTPTS",
              "-c:a", "pcm_s16le", p])
        parts.append(p)
    _concat_audio(parts, out)
    for p in parts:
        Path(p).unlink(missing_ok=True)
    return _valid_audio(out)


def _artifact_guard(seg_id: str, j: int, sent: str, part: str,
                    style: str, fn, tts_dir: Path, ext: str,
                    provider: str, voice: str, rate: str,
                    retries: int = 4) -> str:
    """句内爆音清理(头/中/尾全覆盖): 检出孤立低频响声优先重掷该句——爆音是
    随机的, 重掷大概率干净, 零误伤; 4 次仍带才兜底切除。切除只挖"被静音
    隔开的孤立低频岛"(判据见 _artifact_regions), 两侧停顿原样保留, 误切真
    词的概率极低; 句中爆音宁可切也不留——用户实测这种"句子里突然冒一声"
    最扎耳。重掷句用独立文件名(_hr 后缀), 不污染原句缓存。"""
    if not _artifact_regions(part):
        return part
    for k in range(1, retries + 1):
        try:
            base = str((tts_dir /
                        f"{seg_id}_{j}_hr{k}_{_sent_fp(provider, voice, rate, sent, style)}"
                        ).resolve())
            ap = fn(sent, base, style=style)
            ap = _trim_part(ap)
            if not _artifact_regions(ap):
                return ap
        except Exception:  # noqa: BLE001  重掷失败走兜底
            break
    regs = _artifact_regions(part)
    if not regs:
        return part
    src = Path(part)
    out = src.with_name(
        f"{src.stem}_acut" + "x".join(f"{int(a * 1000)}-{int(b * 1000)}"
                                       for a, b, _ in regs) + ".wav")
    if _cut_regions(part, [(a, b) for a, b, _ in regs], str(out)):
        return str(out)
    return part


def _concat_audio(parts: list[str], out: str) -> None:
    """拼接句音频成段音频 (by_sentence 模式)。"""
    if len(parts) == 1:
        # 统一转码 (拼接输入可能是裁剪后的 wav, 容器随 out 后缀走, -c copy 会容器错配)
        codec1 = ["-c:a", "pcm_s16le"] if Path(out).suffix.lower() == ".wav" else \
                 ["-c:a", "libmp3lame", "-b:a", "192k"]
        _run(["ffmpeg", "-y", "-i", parts[0], *codec1, out])
        return
    lst = out + ".txt"
    with open(lst, "w", encoding="utf-8") as f:
        for p in parts:
            f.write(f"file '{p}'\n")
    codec = ["-c:a", "pcm_s16le"] if Path(out).suffix.lower() == ".wav" else \
            ["-c:a", "libmp3lame", "-b:a", "192k"]
    _run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", lst, *codec, out])


# ---------------------------------------------------------------------------
# 合成后端: 委托共享 TTS 适配器 (tts.request_tts)
# ---------------------------------------------------------------------------

def _make_tts_fn(provider: str, voice: str, speed: float | None, ctx: RunContext,
                 instruction: str = ""):
    """逐段调用共享 TTS 适配器 (请求账本防重复提交)。voice/speed 透传;
    念法通过 instruction 传递, 句级 style 不单独发送。"""
    from .tts import request_tts as generate
    ext = ".wav"

    def fn(text: str, out_base: str, retries: int = 2, style: str = "") -> str:
        out = out_base + ext
        d_args: dict = {"text": text, "output_path": out, "voice": voice}
        if speed is not None:
            d_args["speed"] = speed
        if instruction:
            d_args["instruction"] = instruction
        last: Exception | None = None
        for i in range(retries):
            from .recap_runtime_state import resource_slot
            with resource_slot("tts") as attempt:
                result = generate(dict(d_args), ctx)
                valid = not result.failed and _valid_audio(out, 0.05)
                if not valid:
                    attempt.update(status="failed", failure_code="tts_provider_error")
                if isinstance((result.data or {}).get("usage"), dict):
                    attempt["usage"] = result.data["usage"]
            if valid:
                return out
            last = RuntimeError(result.text)
            if (result.data.get("retryable") is not True or result.data.get("completion_unknown")
                    or i + 1 >= retries):
                break
            time.sleep(3 * (i + 1))
        raise last  # type: ignore[misc]

    return fn


def _parse_rate_speed(rate: str) -> float | None:
    """百分比语速 "+6%" → TTS speed 1.06; "+0%" 视为不指定。"""
    m = _RATE_RE.match(rate.strip())
    if not m:
        return None
    pct = int(rate.strip().rstrip("%"))
    if pct == 0:
        return None
    return round(1.0 + pct / 100.0, 3)


# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------

def handoff_arguments(args: dict) -> dict:
    """{mcp_tool, arguments}: the same call for the MCP tool (identical arguments = identical caches)."""
    from .movie_schemas import TOOL_SCHEMAS
    allowed = set(TOOL_SCHEMAS["synthesize_narration"]["inputSchema"]["properties"])
    return {"mcp_tool": "synthesize_narration",
            "arguments": {k: v for k, v in args.items() if k in allowed and v is not None}}


def handoff_of(result: ToolResult) -> dict:
    """The MCP hand-off a failed synthesis asked for, as fields for a command's JSON result."""
    handoff = (result.data or {}).get("handoff")
    if not handoff:
        return {}
    return {"handoff": handoff, "next": ("call the MCP tool " + handoff["mcp_tool"] + " with handoff.arguments, "
                                        "then rerun this command; it reuses that audio")}


def synthesize_narration(args: dict, ctx: RunContext) -> ToolResult:
    """Checkpoint the stage; audio/ASR caches still validate their actual files."""
    from .recap_runtime_state import RuntimeBusy, stage_run
    source = ctx.resolve(args["script_path"]) if args.get("script_path") else None
    if source is None or not source.is_file():
        return _synthesize_narration(args, ctx)
    output = ctx.resolve(args.get("output_json") or "out/script_tts.json")
    outputs = [output]
    if args.get("semantic_out"):
        outputs.append(ctx.resolve(args["semantic_out"]))
    # An explicitly in-place input is consumed as a frozen snapshot; ordinary
    # source scripts are checked again at commit for concurrent modifications.
    input_ref = source if source not in outputs else {
        "path": str(source), "sha256": hashlib.sha256(source.read_bytes()).hexdigest()}
    knobs = {name: clean_env(name) for name in (
        "VE_TTS_VOICE", "VE_NARRATION_TTS_RATE", "VE_TTS_STYLE_DEFAULT")}
    from .tts import tts_config
    knobs["tts_backend"] = tts_config()["model"]
    try:
        with stage_run(ctx.project_dir, "tts", inputs={"script": input_ref, "options": args,
                       "defaults": knobs, "audio_cache_version": TTS_AUDIO_CACHE_VERSION},
                       outputs=outputs) as stage:
            result = _synthesize_narration(args, ctx)
            verification = (result.data or {}).get("verify") or {}
            if result.text.startswith("[ERROR]"):
                stage.fail("tts_incomplete")
            elif verification.get("failed_seg_ids") or verification.get("unverified_seg_ids"):
                stage.fail("tts_verification_pending")
            else:
                stage.complete(segments_cached=(result.data or {}).get("segments_cached"),
                               segments_total=(result.data or {}).get("segments_total"))
            return result
    except RuntimeBusy:
        return ToolResult(text="[ERROR] narration TTS already has an active writer; retry after release",
                          data={"status": "busy", "retryable": True})
    except (OSError, ValueError) as exc:
        return ToolResult(text=f"[ERROR] narration TTS checkpoint: {exc}")


def _synthesize_narration(args: dict, ctx: RunContext) -> ToolResult:
    if not args.get("script_path"):
        return ToolResult(text="[ERROR] script_path is required")
    script_path = ctx.resolve(args["script_path"])
    if not script_path.is_file():
        return ToolResult(text=f"[ERROR] script not found: {script_path}")
    try:
        segs = _load_json(script_path)
    except Exception as exc:  # noqa: BLE001
        return ToolResult(text=f"[ERROR] invalid script JSON: {exc}")
    # A hand-written script is naturally an object with a title/notes and a
    # `segments` list (what the assembly workflow authors); accept that wrapper
    # as well as the bare array arrange_footage emits.
    if isinstance(segs, dict) and isinstance(segs.get("segments"), list):
        segs = segs["segments"]
    if not isinstance(segs, list) or not segs:
        return ToolResult(text="[ERROR] script must be a non-empty JSON array of segments "
                               "(or an object with a non-empty `segments` array)")
    for idx, seg in enumerate(segs):
        if not isinstance(seg, dict) or not str(seg.get("seg_id", "")).strip():
            return ToolResult(
                text=f"[ERROR] segment #{idx} is missing seg_id",
                data={"segment_index": idx},
            )
        # The input may itself be a previous TTS output. Runtime fields are only
        # inherited from a validated cache below, never trusted as script input.
        for key in ("audio_path", "audio_dur", "speech_dur", "sentences", "verify",
                    "delivery_pause_sec", "tts_mode", "_tts_fp", "_tts_complete",
                    "continuity", "raw_audio_path", "_continuity_profile",
                    "_tts_cache_version", "_alignment_fp", "_binding_fp", "_audio_sha256"):
            seg.pop(key, None)
        for unit in seg.get("semantic_units", []):
            if isinstance(unit, dict):
                unit.pop("tts_start", None)
                unit.pop("tts_end", None)

    provider = str(args.get("provider") or DEFAULT_PROVIDER).strip().lower()
    if provider == "auto":
        provider = DEFAULT_PROVIDER
    if provider not in SUPPORTED_PROVIDERS:
        return ToolResult(
            text=f"[ERROR] unsupported provider: {provider}; "
                 f"expected one of {', '.join(SUPPORTED_PROVIDERS)}",
        )
    by_sentence = args.get("by_sentence", False)
    if not isinstance(by_sentence, bool):
        return ToolResult(text="[ERROR] by_sentence must be a boolean")
    continuous = bool(args.get("continuous_delivery", False))
    if continuous and by_sentence:
        return ToolResult(text="[ERROR] continuous_delivery requires paragraph synthesis")
    if continuous:
        from .narration_continuity import PROFILE
        for seg in segs:
            seg["_continuity_profile"] = dict(PROFILE)
    flatten_quotes = args.get("flatten_quotes", False)
    if not isinstance(flatten_quotes, bool):
        return ToolResult(text="[ERROR] flatten_quotes must be a boolean")
    verify_mode = str(args.get("verify") or "").strip().lower()
    if verify_mode not in ("", "asr"):
        return ToolResult(text='[ERROR] verify must be "asr" or omitted')
    try:
        verify_retries = int(args.get("verify_retries", 2))
    except (TypeError, ValueError):
        return ToolResult(text="[ERROR] verify_retries must be an integer")
    verify_retries = max(0, min(3, verify_retries))
    from . import movie_speech_verification as movie_speech
    movie_check = movie_speech.enabled(ctx, continuous=continuous, by_sentence=by_sentence)
    if movie_check:
        verify_retries = min(verify_retries, movie_speech.MAX_REPAIRS)
    if flatten_quotes:
        # 口播去戏剧化写回 spoken_text (指纹随之变化, 不会误用未压平的旧音频);
        # subtitle_text/text 原文不动
        for s in segs:
            s["spoken_text"] = _flatten_spoken(_spoken_text(s))
            for u in s.get("semantic_units", []):
                if isinstance(u, dict):
                    u["spoken_text"] = _flatten_spoken(
                        str(u.get("spoken_text", u.get("text", ""))))
    require_complete = args.get("require_complete", True)
    if not isinstance(require_complete, bool):
        return ToolResult(text="[ERROR] require_complete must be a boolean")

    # 念法指令: 全局风格(参数, 缺省回落环境默认) + 稿子拍级 tone 字段, 逐句拼进
    # text_prompt。防念句由 _seg_style 自动垫底; 指令入句级/段级缓存指纹。
    # 环境默认 VE_TTS_STYLE_DEFAULT: 关键参数不依赖调用方逐次传参。
    global_style = str(args.get("style_instructions") or "").strip()
    if not global_style:
        global_style = clean_env("VE_TTS_STYLE_DEFAULT") or ""
    seg_style = {s["seg_id"]: _seg_style(s, global_style) for s in segs}

    explicit_voice = args.get("voice")
    if explicit_voice is not None and not str(explicit_voice).strip():
        explicit_voice = None
    rate = str(args.get("rate") or clean_env("VE_NARRATION_TTS_RATE")
               or DEFAULT_RATE).strip()
    if not _RATE_RE.match(rate):
        return ToolResult(text='[ERROR] rate must look like "+0%", "+6%" or "-10%"')
    from .tts import PRESET_VOICES, tts_config
    config = tts_config()
    voice = str(explicit_voice or config["voice"]).strip()
    if voice not in PRESET_VOICES:
        return ToolResult(text="[ERROR] voice must be one of the TTS service voices: " + ", ".join(PRESET_VOICES))
    speed = _parse_rate_speed(rate)
    cache_provider = f"{provider}:{config['model']}"
    fn = _make_tts_fn(provider, voice, speed, ctx,
                      instruction=PROFILE["instruction"] if continuous else "")
    workers = TTS_WORKERS
    ext = ".wav"

    out_path = ctx.resolve(args.get("output_json") or "out/script_tts.json")
    tts_dir = ctx.resolve(args.get("audio_dir") or ".video_agent/narration_tts")
    tts_dir.mkdir(parents=True, exist_ok=True)
    semantic_out = ctx.resolve(args["semantic_out"]) if args.get("semantic_out") else None

    started = time.time()

    # Audio reuse is independent of subtitle/evidence/picture metadata. Legacy
    # fingerprints are checked against their saved script before migration.
    cached_done: dict[str, dict] = {}
    from .movie_segment_cache import entries as prepared_audio
    prepared = prepared_audio(ctx.resolve('out'))
    if out_path.exists():
        try:
            for d in _load_json(out_path):
                ap = d.get("audio_path")
                if (d.get("_tts_complete", False) and ap and _valid_audio(ap)):
                    cached_done[d["seg_id"]] = d
        except Exception:
            pass
    done: dict[str, dict] = {}
    for s in segs:
        d = cached_done.get(s["seg_id"])
        if not d or not _cached_audio_matches(d, s, cache_provider, by_sentence, voice, rate, seg_style[s['seg_id']]):
            d = next((row for row in reversed(prepared) if row.get('seg_id') == s['seg_id']
                      and row.get('_tts_complete') and row.get('audio_path') and _valid_audio(row['audio_path'])
                      and _cached_audio_matches(row, s, cache_provider, by_sentence, voice, rate, seg_style[s['seg_id']])), None)
        if d and _cached_audio_matches(
                d, s, cache_provider, by_sentence, voice, rate, seg_style[s["seg_id"]]):
            done[s["seg_id"]] = d
            for key in ("audio_path", "audio_dur", "speech_dur", "sentences",
                        "delivery_pause_sec", "tts_mode", "_tts_fp", "_tts_complete",
                        "verify", "continuity", "raw_audio_path", "_alignment_fp"):
                if key in d:
                    s[key] = copy.deepcopy(d[key])
            s["_tts_fp"] = _tts_fingerprint(
                s, cache_provider, by_sentence, voice, rate, seg_style[s["seg_id"]])
            _refresh_cached_timing(s)
    pending = [s for s in segs if s["seg_id"] not in done]
    needs_service = bool(pending) or (verify_mode == "asr" and any(
        _needs_asr_verification(s.get("verify") or {}) for s in segs if s["seg_id"] in done))
    if needs_service and ctx.session_kind != "job":
        from . import toolhub
        if toolhub.identity_missing():
            return ToolResult(
                text=("[ERROR] narration TTS needs the signed-in ZCode account, which only MCP tool calls carry: "
                      "call the MCP tool synthesize_narration with data.handoff.arguments, then rerun this step "
                      "(it reuses that audio and its verification)"),
                data={"status": "needs_mcp_call", "pending_seg_ids": [s["seg_id"] for s in pending],
                      "handoff": handoff_arguments(args)})

    failures: list[dict] = []

    if by_sentence and pending:
        # 句级并行: 跨全部待办段, 每句独立任务; 顺序拼接与句级时间轴在合成后按序重建
        seg_units = {s["seg_id"]: _timing_units(s) for s in pending}
        seg_sents = {seg_id: [u["spoken_text"] for u in units]
                     for seg_id, units in seg_units.items()}
        jobs = [(s["seg_id"], j, sent)
                for s in pending for j, sent in enumerate(seg_sents[s["seg_id"]])]

        def _work(job):
            seg_id, j, sent = job
            style = _sent_style(seg_style[seg_id], sent)
            # 句级文件缓存指纹同样绑 provider+voice+rate+念法指令
            base = str((tts_dir / f"{seg_id}_{j}_{_sent_fp(cache_provider, voice, rate, sent, style)}").resolve())
            cached = base + ext
            if Path(cached).exists():
                if _valid_audio(cached):
                    return seg_id, j, cached, None      # 断点续跑: 复用已生成句
                Path(cached).unlink(missing_ok=True)    # 坏/空文件删掉重合成
            try:
                return seg_id, j, fn(sent, base, style=style), None
            except Exception as exc:  # noqa: BLE001
                return seg_id, j, None, f"{type(exc).__name__}: {str(exc)[:120]}"

        paths: dict[tuple[str, int], str | None] = {}
        sent_errors: dict[str, list[str]] = {}
        with ThreadPoolExecutor(max_workers=workers) as ex:
            for seg_id, j, ap, err in ex.map(_work, jobs):
                paths[(seg_id, j)] = ap
                if err:
                    sent_errors.setdefault(seg_id, []).append(err)

        for s in pending:
            sents = seg_sents[s["seg_id"]]
            parts, timeline, t = [], [], 0.0
            for j, sent in enumerate(sents):
                ap = paths.get((s["seg_id"], j))
                if not ap:
                    continue
                try:
                    ap = _trim_part(ap)
                    # 句内爆音防护(头/中/尾全扫, 重掷优先/兜底切除)
                    ap = _artifact_guard(
                        s["seg_id"], j, sent, ap, _sent_style(seg_style[s["seg_id"]], sent),
                        fn, tts_dir, ext, cache_provider, voice, rate)
                    if j < len(sents) - 1:
                        ap = _gap_part(ap)      # 句间呼吸规则化(段尾句交给 delivery pause)
                    d = round(_media_duration(ap), 3)
                except Exception as exc:  # noqa: BLE001  坏音频/ffprobe 失败: 记错跳句, 不拖垮整段
                    sent_errors.setdefault(s["seg_id"], []).append(
                        f"trim/probe failed: {type(exc).__name__}: {str(exc)[:120]}")
                    continue
                unit = seg_units[s["seg_id"]][j]
                timeline.append({
                    "text": unit.get("subtitle_text", unit.get("text", sent)),
                    "subtitle_text": unit.get("subtitle_text", unit.get("text", sent)),
                    "spoken_text": sent, "start": round(t, 3),
                    "end": round(t + d, 3),
                    "semantic_unit_id": unit.get(
                        "semantic_unit_id", f"{s['seg_id']}_u{j + 1:02d}"),
                    "event_ids": list(unit.get("event_ids", s.get("event_ids", []))),
                    "claim_ids": list(unit.get("claim_ids", [])),
                    "anchor_shot_ids": list(unit.get("anchor_shot_ids", [])),
                    "cited_shot_ids": list(unit.get("cited_shot_ids", [])),
                    "storyboard": list(unit.get("storyboard", [])),
                    **{key: copy.deepcopy(unit[key]) for key in
                       POLICY_FIELDS
                       if key in unit}})
                t += d
                parts.append(ap)
            if not parts:
                failures.append({"seg_id": s["seg_id"], "reason": "no valid sentence audio",
                                 "errors": sent_errors.get(s["seg_id"], [])})
                continue
            try:
                fp = _tts_fingerprint(s, cache_provider, by_sentence, voice, rate,
                                      seg_style[s["seg_id"]])
                raw_audio = str((tts_dir / f"{s['seg_id']}_sentence_{fp}{ext}").resolve())
                _concat_audio(parts, raw_audio)
                speech_dur = round(_media_duration(raw_audio), 3)
                pause = _pause_ms(s)
                final_audio = str((tts_dir /
                                   f"{s['seg_id']}_sentence_{fp}_p{pause}.wav").resolve())
                audio = _pad_audio(raw_audio, final_audio, pause)
                s["audio_path"] = audio
                s["speech_dur"] = speech_dur
                s["audio_dur"] = round(_media_duration(audio), 3)
                s["delivery_pause_sec"] = round(max(0.0, s["audio_dur"] - speech_dur), 3)
                s["tts_mode"] = "sentence"
                s["sentences"] = timeline
                s["_tts_fp"] = fp
                s["_tts_complete"] = len(parts) == len(sents)
                if not s["_tts_complete"]:
                    failures.append({
                        "seg_id": s["seg_id"],
                        "reason": f"only {len(parts)}/{len(sents)} sentences synthesized",
                        "errors": sent_errors.get(s["seg_id"], []),
                    })
            except Exception as exc:  # noqa: BLE001
                failures.append({"seg_id": s["seg_id"],
                                 "reason": f"concat/pad failed: {str(exc)[:160]}"})
    elif pending:
        # 默认整段合成: 一段只起一次调, 句内停连由 TTS 连续建模;
        # 句级时间轴按发音量估算切分
        def _work_paragraph(s: dict):
            style = seg_style[s["seg_id"]]
            fp = _tts_fingerprint(s, cache_provider, by_sentence, voice, rate, style)
            text = _spoken_text(s)
            base = str((tts_dir / f"{s['seg_id']}_paragraph_{fp}").resolve())
            raw_audio = base + ext
            if movie_check:
                journal = movie_speech.Journal(tts_dir, {**s, '_tts_fp': fp})
                repaired = movie_speech.repair_path(raw_audio)
                if journal.repairs and _valid_audio(repaired):
                    raw_audio = str(repaired)
            # Interrupted legacy jobs may have audio but no completed JSON. A
            # matching old filename can be reused only for the exact old input.
            if not _valid_audio(raw_audio):
                legacy_fp = _legacy_tts_fingerprint(
                    s, cache_provider, by_sentence, voice, rate, style)
                legacy = str((tts_dir / f"{s['seg_id']}_paragraph_{legacy_fp}{ext}").resolve())
                if _valid_audio(legacy):
                    raw_audio = legacy
            # 段级文件缓存: 指纹一致且音频有效则不重合成
            if not _valid_audio(raw_audio):
                Path(raw_audio).unlink(missing_ok=True)
                raw_audio = fn(text, base, style=style)
            speech_dur = round(_media_duration(raw_audio), 3)
            pause = _pause_ms(s)
            final_audio = str((tts_dir /
                               f"{s['seg_id']}_paragraph_{fp}_p{pause}.wav").resolve())
            if movie_check and raw_audio == str(movie_speech.repair_path(base + ext)):
                final_audio = str(Path(raw_audio).with_suffix('')) + f'_p{pause}.wav'
            if pause:
                if not _valid_audio(final_audio, max(0.1, speech_dur - 0.05)):
                    Path(final_audio).unlink(missing_ok=True)
                    _pad_audio(raw_audio, final_audio, pause)
                audio = final_audio
            else:
                audio = raw_audio
            audio_dur = round(_media_duration(audio), 3)
            return s["seg_id"], {
                "audio_path": audio, "audio_dur": audio_dur,
                "speech_dur": speech_dur,
                "delivery_pause_sec": round(max(0.0, audio_dur - speech_dur), 3),
                "sentences": _estimate_timeline(s, speech_dur),
                "tts_mode": "paragraph", "_tts_fp": fp, "_tts_complete": True,
            }

        with ThreadPoolExecutor(max_workers=workers) as ex:
            futures = {ex.submit(_work_paragraph, s): s for s in pending}
            for future, source in list(futures.items()):
                try:
                    _, result = future.result()
                    source.update(result)
                except Exception as exc:  # noqa: BLE001
                    failures.append({"seg_id": source["seg_id"],
                                     "reason": f"{type(exc).__name__}: {str(exc)[:160]}"})

    # 忠实度回验: LLM-TTS 会改写/吞句/演绎 (实测), 回听是唯一能兜住的闸门。
    # ASR 未执行成功的 warn 必须补验，复用已合成音频。
    if verify_mode == "asr":
        targets = [
            s for s in segs
            if s.get("_tts_complete") and _valid_audio(s.get("audio_path", ""))
            and _needs_asr_verification(s.get("verify") or {})
        ]
        if targets:
            # 治愈阶段会并发调 TTS 委托, 不得突破后端的保守并发上限
            with ThreadPoolExecutor(max_workers=max(1, min(3, workers))) as ex:
                reports = list(ex.map(
                    lambda s: _verify_seg(s, ctx, tts_dir, ext, fn,
                                          cache_provider, voice, rate, verify_retries,
                                          seg_style.get(s["seg_id"], ""),
                                          movie_check=movie_check),
                    targets))
            for s, rep in zip(targets, reports):
                s["verify"] = rep

    # 最终杂音复检: 句音频无论走过哪条路径(首次合成/治愈重掷), 进成片前
    # 全部再过一遍爆音闸——8-25 实测治愈路径曾绕过句级防护漏出 17 段。
    # 检出即重掷/切除并重拼段音频(时间轴随之刷新); .agate 侧车记录已检
    # 文件, 缓存重跑不重复扫描(侧车带判据版本号, 判据升级自动全量重扫)。
    # 多轮循环: 重掷是随机的, 修复产物本身可能再带杂音——8-26 实测三部片
    # 单轮修完仍漏 10 段, 其中 4 段正是"修复时新掷出来的"。修到干净为止,
    # 4 轮封顶(每轮内部 _artifact_guard 已有 4 次重掷+切除兜底)。
    gate_fixed = []
    for _pass in range(4):
        pass_fixed = []
        for s in segs:
            if s.get("tts_mode") != "sentence" \
                    or not _valid_audio(s.get("audio_path", "")):
                continue
            man = Path(str(s["audio_path"]) + ".txt")
            if not man.exists():
                continue
            dirty = set()
            for line in man.read_text(encoding="utf-8").splitlines():
                m = re.search(r"file '([^']+)'", line)
                if not m:
                    continue
                p = Path(m.group(1))
                mj = re.match(rf"{re.escape(str(s['seg_id']))}_(\d+)_", p.name)
                side = Path(str(p) + ".agate")
                if not (mj and p.is_file()):
                    continue
                mark = f"v2:{p.stat().st_mtime}:{p.stat().st_size}"
                if side.exists() and side.read_text(encoding="utf-8").strip() == mark:
                    continue
                if _artifact_regions(str(p)):
                    dirty.add(int(mj.group(1)))
                else:
                    side.write_text(mark, encoding="utf-8")
            if dirty:
                _rebuild_sentence_seg(s, tts_dir, ext, cache_provider, voice, rate,
                                      seg_style.get(s["seg_id"], ""), fn)
                pass_fixed.append(s["seg_id"])
        if not pass_fixed:
            break
        gate_fixed.extend(pass_fixed)
        print(f"[narrate_tts] 杂音终检第{_pass + 1}轮修复 {len(pass_fixed)} 段: "
              f"{pass_fixed}", flush=True)

    missing = [s.get("seg_id", "") for s in segs
               if not s.get("_tts_complete") or not _valid_audio(s.get("audio_path", ""))]

    if continuous and not missing:
        from .narration_continuity import audio_hash, continuity_current, finish_paragraph
        for s in segs:
            if (continuity_current(s, PROFILE)
                    and s.get("sentences") and not (s.get("verify") or {}).get("alignment_error")):
                _copy_unit_times(s)
                continue
            report = s.get("verify") or {}
            if report.get("status") == "fail" and not report.get("alignment_error"):
                continue
            if movie_check and report.get('asr_available') is False:
                # One ASR attempt also supplies alignment. An outage does not
                # justify a second ASR or fresh TTS within the same invocation.
                s['sentences'] = []
                _copy_unit_times(s)
                s['verify'] = {**report, 'status': 'fail', 'speech_status': report['status'],
                               'alignment_error': 'asr_unavailable'}
                continue
            try:
                source = s.get("raw_audio_path") if s.get("continuity") else s["audio_path"]
                transcript_path = ctx.resolve(
                    f".video_agent/narration_tts/_verify/{s['seg_id']}/verified_transcript.json")
                try:
                    transcript = _load_json(transcript_path)
                except (OSError, ValueError):
                    transcript = {}
                if s.get("continuity"):
                    raw_hash = audio_hash(source) if source and Path(source).is_file() else None
                    expected_raw = s["continuity"].get("source_audio_sha256")
                    if (not raw_hash or expected_raw and expected_raw != raw_hash
                            or not expected_raw and transcript.get("_audio_sha256") != raw_hash):
                        # The normalized waveform is still valid. Missing or
                        # modified intermediate audio must not force new speech
                        # or supply timestamps for a different waveform.
                        source = s["audio_path"]
                if transcript.get("_audio_sha256") != audio_hash(source):
                    # A lost/stale transcript needs ASR, not a new TTS call.
                    if verify_mode != "asr" or _verify_heard(source, ctx, s["seg_id"])[0] is None:
                        raise ValueError("ASR transcript unavailable for the current paragraph audio")
                    transcript = _load_json(transcript_path)
                finish_paragraph(s, transcript, _timing_units(s), _norm_cjk, PROFILE,
                                 tts_dir / f"{s['seg_id']}_continuous_{s['_tts_fp']}.wav")
                if report.get("alignment_error"):
                    report["status"] = report.pop("speech_status", "fail")
                    report.pop("alignment_error", None)
            except Exception as exc:
                s["sentences"] = []
                _copy_unit_times(s)
                s["verify"] = {**report, "status": "fail",
                               "speech_status": report.get("speech_status", report.get("status", "fail")),
                               "alignment_error": str(exc)[:250]}

    from .narration_continuity import alignment_fingerprint, audio_hash
    for s in segs:
        if s.get("_tts_complete") and _valid_audio(s.get("audio_path", "")):
            s["_tts_cache_version"] = TTS_AUDIO_CACHE_VERSION
            s["_audio_sha256"] = audio_hash(s["audio_path"])
            if s.get("sentences") and not (s.get("verify") or {}).get("alignment_error"):
                s["_alignment_fp"] = alignment_fingerprint(
                    _timing_units(s), s["_audio_sha256"],
                    s.get("tts_mode", ""), s.get("_continuity_profile"))
                # Binding can change while both sound and alignment stay stable.
                s["_binding_fp"] = hashlib.sha256(json.dumps(
                    {"alignment": s["_alignment_fp"], "units": _timing_units(s)},
                    ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()[:20]
            else:
                s.pop("_alignment_fp", None)
                s.pop("_binding_fp", None)

    # require_complete: 有失败段不写半成品 output_json (段级音频文件缓存仍在,
    # 重跑只补失败段); 非严格模式写出并在 data 里标 partial
    if missing and require_complete:
        return ToolResult(
            text=f"[ERROR] TTS incomplete for {len(missing)} of {len(segs)} segments; "
                 "output_json not written (audio file cache is kept, rerun to fill gaps)",
            data={
                "provider": provider, "voice": voice, "rate": rate,
                "mode": "sentence" if by_sentence else "paragraph",
                "segments_total": len(segs),
                "segments_cached": len(done),
                "missing_seg_ids": missing,
                "failures": failures,
                "audio_dir": str(tts_dir),
                "elapsed_seconds": round(time.time() - started, 3),
            },
        )

    _save_json(segs, out_path)
    if semantic_out is not None:
        _save_semantic_timeline(segs, semantic_out)

    total = sum(float(s.get("audio_dur", 0) or 0) for s in segs)
    data = {
        "provider": provider, "voice": voice, "rate": rate,
        "mode": "sentence" if by_sentence else "paragraph",
        "flatten_quotes": flatten_quotes,
        "style": {"global": bool(global_style),
                  "toned_segments": sum(1 for s in segs
                                        if str(s.get("tone") or "").strip()),
                  "tone_stripped": {s["seg_id"]: s["tone_stripped"]
                                    for s in segs if s.get("tone_stripped")}},
        "segments_total": len(segs),
        "segments_cached": len(done),
        "artifact_gate_fixed": gate_fixed,
        "segments_synthesized": len(pending) - len(
            {f["seg_id"] for f in failures} & {s["seg_id"] for s in pending}),
        "total_audio_seconds": round(total, 3),
        "output_json": str(out_path),
        "audio_dir": str(tts_dir),
        "semantic_out": str(semantic_out) if semantic_out is not None else None,
        "elapsed_seconds": round(time.time() - started, 3),
    }
    verify_note = ""
    if verify_mode == "asr":
        v_fail = [s["seg_id"] for s in segs
                  if (s.get("verify") or {}).get("status") == "fail"]
        v_warn = [s["seg_id"] for s in segs
                  if (s.get("verify") or {}).get("status") == "warn"]
        v_unverified = [s["seg_id"] for s in segs
                        if _needs_asr_verification(s.get("verify") or {})
                        and (s.get("verify") or {}).get("status") != "fail"]
        data["verify"] = {"mode": "asr", "failed_seg_ids": v_fail,
                          "warn_seg_ids": v_warn, "unverified_seg_ids": v_unverified}
        if movie_check:
            data['verify']['policy'] = movie_speech.POLICY
        verify_note = (f" | verify: {len(v_fail)} fail / {len(v_warn)} warn / {len(v_unverified)} unverified"
                       if (v_fail or v_warn or v_unverified) else " | verify: all pass")
    artifacts = [str(out_path)] + ([str(semantic_out)] if semantic_out is not None else [])
    if missing:
        data["partial"] = True
        data["missing_seg_ids"] = missing
        data["failures"] = failures
        return ToolResult(
            text=f"[ERROR] narration TTS partial: {len(segs) - len(missing)}/{len(segs)} "
                 f"segments ready ({total:.1f}s) -> {ctx.virtualize(out_path)}; "
                 "output_json written with incomplete segments flagged",
            data=data, artifacts=artifacts,
        )
    return ToolResult(
        text=f"Narration TTS complete: {len(segs)} segments, {total:.1f}s total "
             f"-> {ctx.virtualize(out_path)}{verify_note}",
        data=data, artifacts=artifacts,
    )


def _needs_asr_verification(report: dict) -> bool:
    if report.get("alignment_error"):
        report = {**report, "status": report.get("speech_status", "fail")}
    return (report.get("status") not in ("pass", "warn")
            or report.get("asr_available") is False
            or report.get("reason") == "asr_unavailable")


def _verify_heard(audio_path: str, ctx: RunContext, tag: str) -> tuple[str | None, int]:
    """段音频 ASR 回听: 返回 (听写全文, 说话人数)。ASR 挂了返回 (None, 0),
    调用方退化为只用时长指标且 status 封顶 warn——不许假 pass。
    复用公共 asr 的来源绑定和请求恢复，回验产物集中在 _verify/。"""
    from .asr import asr_transcribe_payload
    from .recap_runtime_state import resource_slot
    vdir = ctx.resolve(".video_agent/narration_tts/_verify")
    work = vdir / tag                    # 每段固定目录, 重试轮覆写不留垃圾
    work.mkdir(parents=True, exist_ok=True)
    try:
        with resource_slot("asr"):
            got = asr_transcribe_payload(
                Path(audio_path), work, language="zh",
                timeout_seconds=300.0, poll_interval_seconds=3.0, started=time.time())
    except Exception:
        return None, 0
    if isinstance(got, ToolResult):
        return None, 0
    payload = got[0]
    from .narration_continuity import audio_hash
    _save_json({**payload, "_audio_sha256": audio_hash(audio_path)},
               work / "verified_transcript.json")
    rows = payload.get("segments") or payload.get("utterances") or []
    utts = [u for u in rows if isinstance(u, dict)]
    heard = "".join(str(u.get("text", "")) for u in utts)
    speakers = {str(u.get("speaker", "")).strip()
                for u in utts if str(u.get("speaker", "")).strip()}
    return heard, len(speakers)


def _rebuild_sentence_seg(s: dict, tts_dir: Path, ext: str,
                          provider: str, voice: str, rate: str,
                          style: str = "", fn=None) -> None:
    """按稳定命名公式重收集句音频, 重拼段音频并刷新句级时间轴。
    fn 传入时逐句过 _artifact_guard——verify 治愈重掷的句子同样会带爆音/
    粘着起音, 不过闸就是防护盲区(8-25 实测: 影两段泄漏正出自此路)。"""
    parts, t = [], 0.0
    n = len(s["sentences"])
    for j, sent in enumerate(s["sentences"]):
        spoken = str(sent.get("spoken_text", ""))
        sstyle = _sent_style(style, spoken)
        raw = tts_dir / f"{s['seg_id']}_{j}_{_sent_fp(provider, voice, rate, spoken, sstyle)}{ext}"
        ap = _trim_part(str(raw))
        if fn is not None:
            ap = _artifact_guard(s["seg_id"], j, spoken, ap, sstyle,
                                 fn, tts_dir, ext, provider, voice, rate)
        if j < n - 1:
            ap = _gap_part(ap)
        d = round(_media_duration(ap), 3)
        sent["start"], sent["end"] = round(t, 3), round(t + d, 3)
        t += d
        parts.append(str(ap))
    fp = s["_tts_fp"]
    raw_audio = str((tts_dir / f"{s['seg_id']}_sentence_{fp}{ext}").resolve())
    Path(raw_audio).unlink(missing_ok=True)
    _concat_audio(parts, raw_audio)
    speech_dur = round(_media_duration(raw_audio), 3)
    pause = _pause_ms(s)
    final_audio = str((tts_dir / f"{s['seg_id']}_sentence_{fp}_p{pause}.wav").resolve())
    Path(final_audio).unlink(missing_ok=True)
    audio = _pad_audio(raw_audio, final_audio, pause)
    s["audio_path"] = audio
    s["speech_dur"] = speech_dur
    s["audio_dur"] = round(_media_duration(audio), 3)
    s["delivery_pause_sec"] = round(max(0.0, s["audio_dur"] - speech_dur), 3)


def _localize_insertions(s: dict, ctx: RunContext, tts_dir: Path, ext: str,
                         provider: str, voice: str, rate: str, style: str,
                         rows_all: list[dict]) -> list[dict]:
    """句级查多: 段级回听疑似加词时, 逐句 ASR 定位罪句——某句听到的字数比
    稿子多 ≥2 即定罪(带 heard 供人工复核)。只对疑似段调用, 控制 ASR 用量;
    ASR 对单句挂了就跳过该句(退化为段级松阈值兜底)。"""
    guilty = []
    for j, sent in enumerate(s.get("sentences", [])):
        spoken = str(sent.get("spoken_text", ""))
        if not spoken.strip() or j >= len(rows_all):
            continue
        sstyle = _sent_style(style, spoken)
        raw = tts_dir / (f"{s['seg_id']}_{j}_"
                         f"{_sent_fp(provider, voice, rate, spoken, sstyle)}{ext}")
        if not raw.exists():
            continue
        heard_j, _ = _verify_heard(_trim_part(str(raw)), ctx,
                                   f"{s['seg_id']}_sx{j}")
        if heard_j is None:
            continue
        extra_j = len(_norm_cjk(heard_j)) - len(_norm_cjk(spoken))
        if extra_j >= 2:
            row = rows_all[j]
            row["insertion"] = extra_j
            row["heard"] = heard_j[:80]
            guilty.append(row)
    return guilty


# 一个 take 的全部可替换字段: 修复版更差时整体恢复原 take
_TAKE_KEYS = ("audio_path", "speech_dur", "audio_dur", "delivery_pause_sec", "sentences",
              "continuity", "raw_audio_path", "_alignment_fp")


def _verify_seg(s: dict, ctx: RunContext, tts_dir: Path, ext: str, fn,
                provider: str, voice: str, rate: str, retries: int,
                style: str = "", *, movie_check: bool = False) -> dict:
    """忠实度回验: ASR 内容命中 + 句时长合理性双指标。

    判定(实测校准): 长句(≥6字)命中<0.35 或时长越界 = 坏句; 0.35~0.7 = 灰句。
    坏句和灰句在非末轮都删句级缓存重合成(灰区曾漏过半句改写, 不再直接放行),
    末轮仍灰才以 warn 接受。短句(<6字)ASR 误伤率高, 要求 hit==0 且时长越界
    双证据才判坏。词全对(hit≥0.7)只是读得慢的句子豁免 "too long"(重合成
    大概率同样慢, 纯烧配额)。ASR 整体不可用时只剩时长指标, status 封顶 warn
    并置 reason=asr_unavailable——不许假 pass。说话人 >1 只记警告。
    电影连续配音只修坏句一次，灰区留给现有成片回听；原始判定阈值保持。
    修复版按同一判据(坏句数, 灰句数, 加词, 平均命中)更差时保留原 take。"""
    seg_id = s["seg_id"]
    sentence_mode = s.get("tts_mode") == "sentence"
    journal = None
    if movie_check:
        from .movie_speech_verification import Journal, repair_path
        journal = Journal(tts_dir, s)
        cached = journal.cached(s['audio_path'])
        if cached is not None:
            return cached
        retries = min(retries, max(0, 1 - journal.repairs))

    def finish(report):
        return journal.finish(s['audio_path'], report) if journal else report

    rep: dict = {"status": "pass", "rounds": 0}
    previous_take = None
    for rnd in range(retries + 1):
        heard, n_spk = _verify_heard(s["audio_path"], ctx, seg_id)
        units = (s.get("sentences", []) if sentence_mode
                 else [{"spoken_text": _spoken_text(s), "start": 0.0,
                        "end": float(s.get("speech_dur", 0) or 0)}])
        bad, grey, rows_all = [], [], []
        for j, sent in enumerate(units):
            spoken = str(sent.get("spoken_text", ""))
            chars = len(_norm_cjk(spoken))
            dur = float(sent.get("end", 0)) - float(sent.get("start", 0))
            issue = _duration_suspect(chars, dur)
            hit = _gram_hit_ratio(spoken, heard) if heard is not None else None
            if issue and "too long" in issue and hit is not None and hit >= 0.7:
                issue = None            # 词对速慢: 豁免, 见 docstring
            row = {"index": j, "text": spoken, "dur": round(dur, 2),
                   "hit": None if hit is None else round(hit, 2),
                   "duration_issue": issue}
            rows_all.append(row)
            if chars >= 6:
                if issue or (hit is not None and hit < 0.35):
                    bad.append(row)
                elif hit is not None and hit < 0.7:
                    grey.append(row)
            else:
                if issue and hit == 0.0:
                    bad.append(row)     # 短句双证据
                elif hit == 0.0 and issue is None:
                    grey.append(row)
        # 查多: 命中率只查"该念的都念了"(查漏), 不查"多念了啥"——念法指令
        # 漏念挂在句尾时("这一脚"实锤), 每句命中率照样全绿。段级回听多
        # ≥3 字即疑似加词, 先逐句 ASR 定位罪句(只重掷罪句); 定位不到且超
        # 8% 松阈值才全段重合成(容纳 ASR 归一化波动: 数字/英文名转写)。
        if heard is not None:
            tgt_len = sum(len(_norm_cjk(str(u.get("spoken_text", "")))) for u in units)
            extra = max(0, len(_norm_cjk(heard)) - tgt_len)
            if extra >= 3:
                rep["insertion_suspect"] = extra
                if not bad:
                    guilty = (_localize_insertions(
                        s, ctx, tts_dir, ext, provider, voice, rate,
                        style, rows_all) if sentence_mode else [])
                    if guilty:
                        bad.extend(g for g in guilty if g not in bad)
                    elif extra > max(5, round(tgt_len * 0.08)):
                        bad = list(rows_all)
            else:
                rep.pop("insertion_suspect", None)
        rep.update({
            "rounds": rnd, "speakers": n_spk,
            "asr_available": heard is not None,
            "heard": (heard or "")[:400],
            "failed_sentences": bad, "warn_sentences": grey,
        })
        if heard is None:
            rep["reason"] = "asr_unavailable"
            if movie_check:
                rep['status'] = 'warn'
                return finish(rep)
        else:
            rep.pop('reason', None)
        hits = [r["hit"] for r in rows_all if r.get("hit") is not None]
        score = (len(bad), len(grey), rep.get("insertion_suspect", 0),
                 -round(sum(hits) / len(hits), 2) if hits else 0)
        if previous_take is not None and heard is not None and score > previous_take["score"]:
            # 修复版按同一判据更差: 保留原 take(音频/时长/句轴原样恢复)
            for key in _TAKE_KEYS:
                s.pop(key, None)
            s.update(copy.deepcopy(previous_take["fields"]))
            rejected = {"heard": (heard or "")[:400], "failed_sentences": bad,
                        "warn_sentences": grey, "score": list(score)}
            rep = {**copy.deepcopy(previous_take["report"]), "rounds": rnd, "repair_rejected": rejected}
            bad, grey, n_spk = previous_take["bad"], previous_take["grey"], previous_take["speakers"]
            heard, previous_take = previous_take["heard"], None
        heal = bad + (grey if rnd < retries and not movie_check else [])
        if not heal:
            rep["status"] = ("warn" if (grey or n_spk > 1 or heard is None)
                             else "pass")
            return finish(rep)
        if rnd == retries:
            rep["status"] = "fail" if bad else "warn"
            return finish(rep)
        if journal:
            journal.reserve(s['audio_path'])
            previous_take = {"fields": copy.deepcopy({k: s[k] for k in _TAKE_KEYS if k in s}),
                             "report": copy.deepcopy(rep), "score": score, "bad": bad,
                             "grey": grey, "speakers": n_spk, "heard": heard}
        # 治愈: 坏句/灰句删句级缓存后重合成, 再重拼段音频
        if sentence_mode:
            for item in heal:
                j = item["index"]
                spoken = str(s["sentences"][j].get("spoken_text", ""))
                sstyle = _sent_style(style, spoken)
                base = str((tts_dir /
                            f"{seg_id}_{j}_{_sent_fp(provider, voice, rate, spoken, sstyle)}").resolve())
                Path(base + ext).unlink(missing_ok=True)
                try:
                    fn(spoken, base, style=sstyle)
                except Exception as exc:  # noqa: BLE001
                    item["retry_error"] = f"{type(exc).__name__}: {str(exc)[:120]}"
            try:
                _rebuild_sentence_seg(s, tts_dir, ext, provider, voice, rate,
                                      style, fn)
            except Exception as exc:  # noqa: BLE001
                rep["status"] = "fail"
                rep["rebuild_error"] = str(exc)[:160]
                return finish(rep)
        else:
            # 整段模式: 删段音频整段重合成 (无句级粒度)
            fp = s["_tts_fp"]
            base = str((tts_dir / f"{seg_id}_paragraph_{fp}").resolve())
            pause = _pause_ms(s)
            if movie_check:
                base = str(repair_path(base + ext).with_suffix(''))
            else:
                Path(base + ext).unlink(missing_ok=True)
                Path(f"{base}_p{pause}.wav").unlink(missing_ok=True)
            try:
                raw_audio = fn(_spoken_text(s), base, style=style)
                speech_dur = round(_media_duration(raw_audio), 3)
                audio = (_pad_audio(raw_audio, f"{base}_p{pause}.wav", pause)
                         if pause else raw_audio)
                s["audio_path"] = audio
                s["speech_dur"] = speech_dur
                s["audio_dur"] = round(_media_duration(audio), 3)
                s["delivery_pause_sec"] = round(max(0.0, s["audio_dur"] - speech_dur), 3)
                s["sentences"] = _estimate_timeline(s, speech_dur)
                s.pop("continuity", None)
                s.pop("raw_audio_path", None)
                s.pop("_alignment_fp", None)
            except Exception as exc:  # noqa: BLE001
                rep["status"] = "fail"
                rep["rebuild_error"] = str(exc)[:160]
                return finish(rep)
    return finish(rep)


def _save_semantic_timeline(segs: list[dict], out: Path) -> None:
    """语义时间轴: 每句的段内相对/全局绝对时间, 契约与 movie_cut semantic.json 一致。"""
    rows, global_start = [], 0.0
    for seg in segs:
        dur = float(seg.get("audio_dur", 0) or 0)
        for sent in seg.get("sentences", []):
            rows.append({
                "seg_id": seg.get("seg_id", ""),
                "semantic_unit_id": sent.get("semantic_unit_id", ""),
                "text": sent.get("subtitle_text", sent.get("text", "")),
                "subtitle_text": sent.get("subtitle_text", sent.get("text", "")),
                "spoken_text": sent.get("spoken_text", sent.get("text", "")),
                "relative_start": sent.get("start", 0),
                "relative_end": sent.get("end", 0),
                "global_start": round(global_start + float(sent.get("start", 0)), 3),
                "global_end": round(global_start + float(sent.get("end", 0)), 3),
                "event_ids": sent.get("event_ids", seg.get("event_ids", [])),
                "claim_ids": sent.get("claim_ids", []),
                "anchor_shot_ids": sent.get("anchor_shot_ids", []),
                "cited_shot_ids": sent.get("cited_shot_ids", []),
                "storyboard": sent.get("storyboard", []),
                **{key: copy.deepcopy(sent[key]) for key in
                   POLICY_FIELDS
                   if key in sent},
            })
        global_start += dur
    _save_json({"schema_version": "2.0", "n_units": len(rows), "units": rows}, out)
