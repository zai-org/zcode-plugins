#!/usr/bin/env python3
"""The one episode validator: preflight reports it and render refuses to run without it."""

from __future__ import annotations

import dataclasses
import json
import re
import shutil
from pathlib import Path

from dv_core import (
    ALLOWED_SOURCES,
    CARD_DEFAULT,
    CARD_MAX,
    CARD_MIN,
    CARD_TITLE_MAX,
    DEFAULT_LAYOUT,
    DEMO_STAGE_KIND,
    EVIDENCE_KINDS,
    FPS,
    H,
    is_renderer_output,
    LATIN_WEIGHT,
    LAYOUTS,
    NARRATION_SOFT_MAX,
    OUTPUT_DIRS,
    RATE,
    SEGMENT_ID,
    SEGMENT_KINDS,
    SPEECH_UNITS_PER_SECOND,
    SPEED_MAX,
    SPEED_MIN,
    W,
    RenderError,
    check_edge_tts_version,
    check_pillow,
    crop_error,
    duration,
    feedback_errors,
    font_path,
    probe_video,
    sha256,
)
from dv_tts import cache_files, read_clock, segment_seconds

# TTS reading of these chars depends on context. `safe` words have one reading and stay quiet;
# `watch` words are the only places a char is flagged when its everyday reading is the default.
@dataclasses.dataclass(frozen=True)
class Polyphone:
    hint: str
    safe: tuple = ()
    watch: tuple = ()
    watch_before: str = ""


POLYPHONES = {
    "行": Polyphone("háng 表格行 / xíng 行走——表格「一行」建议改用「一条」", safe=(
        "执行", "运行", "进行", "就行", "也行", "能行", "不行", "可行", "行了", "行为", "行动",
        "自行", "流行", "发行", "步行", "行政", "行使", "行程", "强行", "银行", "行业", "行内",
        "分行", "行号", "换行", "行距", "数据行", "每行", "各行", "该行", "首行", "末行")),
    "重": Polyphone("zhòng 重量 / chóng 重新、重复", safe=(
        "重新", "重写", "重做", "重录", "重置", "重复", "重试", "重启", "重来", "重申", "重构",
        "重现", "重播", "重命名", "重合", "重叠", "重温", "重建", "重组", "重发", "重算", "重跑",
        "重量", "重点", "重要", "严重", "重大", "注重", "多重", "侧重", "沉重", "繁重", "重度",
        "看重", "重视", "尊重", "敬重", "轻重", "保重", "稳重", "郑重", "隆重", "慎重", "厚重",
        "浓重", "重担")),
    "还": Polyphone("hái 还有 / huán 归还", watch=(
        "归还", "偿还", "退还", "还款", "还原", "还回", "还钱", "还书", "还债", "奉还",
        "还手", "还击", "还价", "还嘴", "发还", "返还", "还乡", "还俗", "交还")),
    "都": Polyphone("dōu 都是 / dū 首都", watch=(
        "首都", "成都", "都市", "都城", "古都", "国都", "定都", "建都", "都督", "陪都", "故都",
        "迁都")),
    "长": Polyphone("cháng 长度 / zhǎng 增长", safe=(
        "最长", "超长", "长度", "长时间", "长期", "长短", "漫长", "冗长", "长篇", "长城", "长久",
        "长途", "悠长", "细长", "长处", "增长", "成长", "长出", "校长", "队长", "组长", "部长",
        "局长", "市长", "厂长", "会长", "社长", "家长", "团长", "董事长", "首长", "滋长")),
    "得": Polyphone("dé 得到 / de 跑得快 / děi 得去", safe=(
        "觉得", "懂得", "显得", "记得", "认得", "晓得", "舍得", "省得", "免得", "来得及",
        "来不得", "对得起", "得到", "获得", "取得", "值得", "心得", "得出", "得知", "不得不",
        "得意"), watch=("得去", "得要", "得先", "得靠", "得等"),
        watch_before="这那我你他她它们谁啥"),
    "着": Polyphone("zhe 看着 / zháo 着急 / zhuó 着重", watch=(
        "着急", "着火", "着凉", "着迷", "着眼", "着重", "着手", "着想", "着落", "着装", "着实",
        "着力", "着色", "着陆", "沉着", "执着", "附着", "穿着", "睡着", "着数")),
    "差": Polyphone("chà 差一点 / chā 差别 / chāi 出差", safe=(
        "差别", "差异", "误差", "时差", "偏差", "温差", "落差", "差值", "差额", "差距", "视差",
        "色差", "价差", "差一点", "差不多", "差点", "很差", "太差", "较差", "差劲", "最差",
        "出差")),
    "数": Polyphone("shù 数量 / shǔ 数一数", watch=(
        "数一数", "数不清", "数得清", "数不过来", "数来数去", "数数", "数落", "数九", "数得上",
        "数不上", "屈指可数", "数不胜数")),
    "干": Polyphone("gàn 干活 / gān 干净", watch=("干系", "相干", "外强中干")),
    "应": Polyphone("yīng 应该 / yìng 响应", safe=(
        "应该", "应当", "应有", "应允", "应许", "响应", "反应", "应用", "对应", "适应", "应付",
        "应聘", "应变", "应验", "应答", "应急", "应邀", "报应", "供应", "顺应", "感应", "效应",
        "应承", "应声", "应景", "应试", "应时")),
    "结": Polyphone("jié 结果 / jiē 结实", safe=(
        "结果", "结束", "总结", "结合", "结论", "结算", "结构", "结成", "结尾", "结余", "结婚",
        "终结", "结案", "冻结", "结出", "结交", "结晶", "团结")),
    "系": Polyphone("xì 系统 / jì 系鞋带", safe=(
        "系统", "关系", "体系", "系列", "联系", "语系", "星系", "水系", "嫡系", "世系")),
    "弹": Polyphone("tán 弹出 / dàn 子弹", safe=(
        "弹出", "弹窗", "弹框", "弹回", "弹性", "弹指", "弹琴", "弹幕", "子弹", "炮弹", "弹药",
        "导弹", "炸弹", "弹坑", "反弹", "弹劾", "弹跳", "弹簧", "评弹", "弹奏")),
    "屏": Polyphone("píng 屏幕 / bǐng 屏息", safe=(
        "屏幕", "显示屏", "大屏", "小屏", "截屏", "闪屏", "分屏", "全屏", "竖屏", "横屏", "屏风",
        "屏障", "息屏", "亮屏", "开屏", "投屏", "一屏"), watch=("屏蔽", "屏息", "屏除", "屏退")),
}

INTERNAL_TERMS = (
    "工作流", "管线", "pipeline", "接口", "数据库", "后端", "前端",
    "部署", "构建", "docker", "commit", "refactor",
)
AI_CLICHE_PATTERNS = (
    ("not-x-but-x cliche",
     re.compile(r"这[^。！？；\n，,]{0,4}不是[^。！？；\n]{1,40}[，,]?\s*(?:而是|是)")),
)


@dataclasses.dataclass
class Source:
    path: Path
    width: int
    height: int
    duration: float
    evidence: dict | None


@dataclasses.dataclass
class Validation:
    errors: list[str] = dataclasses.field(default_factory=list)
    warnings: list[str] = dataclasses.field(default_factory=list)
    notes: list[str] = dataclasses.field(default_factory=list)
    episode: dict = dataclasses.field(default_factory=dict)
    sources: dict[str, Source] = dataclasses.field(default_factory=dict)
    layout: str = DEFAULT_LAYOUT

    @property
    def ok(self) -> bool:
        return not self.errors


def load_episode(path: Path) -> dict:
    if not path.is_file():
        raise RenderError(f"missing {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RenderError(f"invalid JSON in {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise RenderError("episode.json must be an object")
    return data


def load_evidence(prefix: str, path: Path, report: Validation) -> dict | None:
    try:
        evidence = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        report.errors.append(f"{prefix}: invalid evidence JSON {path.name}: {exc}")
        return None
    if not isinstance(evidence, dict):
        report.errors.append(f"{prefix}: evidence must be an object: {path.name}")
        return None
    return evidence


def check_duration_match(prefix: str, source: Path, recorded: object, report: Validation) -> bool:
    try:
        actual = duration(source)
        recorded_s = float(recorded)
    except (RenderError, TypeError, ValueError) as exc:
        report.errors.append(f"{prefix}: evidence duration unreadable: {exc}")
        return False
    if abs(actual - recorded_s) > 0.2:
        report.errors.append(
            f"{prefix}: evidence duration {recorded_s:.2f}s != source {actual:.2f}s"
        )
    return True


def check_browser_evidence(prefix: str, source: Path, declared: bool,
                           report: Validation) -> dict | None:
    """Browser source recordings need a matching <shot>.evidence.json."""
    before = len(report.errors)
    path = source.with_suffix(".evidence.json")
    if not path.is_file():
        if declared:
            report.errors.append(
                f"{prefix}: browser shot needs {path.name}; "
                "record with a scripted browser screencast tool that writes evidence"
            )
        return None
    evidence = load_evidence(prefix, path, report)
    if evidence is None:
        return None
    kind = evidence.get("kind")
    if kind not in EVIDENCE_KINDS:
        report.errors.append(f"{prefix}: evidence kind {kind!r} is not a browser recording")
    port = evidence.get("port")
    if port is not None and (not isinstance(port, int) or isinstance(port, bool) or port <= 0):
        report.errors.append(f"{prefix}: evidence port {port!r} must be a positive integer")
    if evidence.get("video") not in (None, source.name):
        report.errors.append(
            f"{prefix}: evidence video {evidence.get('video')!r} does not match {source.name}"
        )
    if evidence.get("sha256") != sha256(source):
        report.errors.append(f"{prefix}: evidence sha256 does not match {source.name}")
    check_duration_match(prefix, source, evidence.get("video_s"), report)
    try:
        frames = int(evidence.get("frames") or 0)
    except (TypeError, ValueError):
        frames = 0
    if frames < 1:
        report.errors.append(f"{prefix}: evidence has no captured frames")
    if len(report.errors) == before:
        report.notes.append(
            f"{prefix}: evidence kind={kind} port={port} frames={frames} "
            f"sha={str(evidence.get('sha256'))[:12]}"
        )
    return evidence


def check_demo_stage_evidence(prefix: str, source: Path, report: Validation) -> None:
    """Headless stage recording: kind=demo-stage-recording, self-checks all passed."""
    before = len(report.errors)
    path = source.with_suffix(".evidence.json")
    if not path.is_file():
        report.errors.append(
            f"{prefix}: demo-stage shot needs {path.name}; "
            "record with a headless scripted-stage tool that writes evidence"
        )
        return
    evidence = load_evidence(prefix, path, report)
    if evidence is None:
        return
    if evidence.get("kind") != DEMO_STAGE_KIND:
        report.errors.append(
            f"{prefix}: evidence kind {evidence.get('kind')!r} is not a demo-stage recording"
        )
    if evidence.get("status") != "passed":
        report.errors.append(
            f"{prefix}: demo-stage evidence status {evidence.get('status')!r} != 'passed'"
        )
    checks = evidence.get("checks")
    if not isinstance(checks, list) or not checks:
        report.errors.append(f"{prefix}: demo-stage evidence has no self-checks")
    else:
        failed = [
            str(item.get("id")) for item in checks
            if not isinstance(item, dict) or item.get("passed") is not True
        ]
        if failed:
            report.errors.append(f"{prefix}: demo-stage self-checks failed: {', '.join(failed)}")
    capture = evidence.get("capture")
    if not isinstance(capture, dict):
        report.errors.append(f"{prefix}: demo-stage evidence lacks capture block")
        capture = {}
    if capture.get("headless") is not True:
        report.errors.append(
            f"{prefix}: demo-stage recording must be headless (capture.headless=true)"
        )
    if capture.get("window_visible") is not False:
        report.errors.append(
            f"{prefix}: demo-stage window was visible; recording must not steal focus"
        )
    video = evidence.get("video")
    if not isinstance(video, dict):
        report.errors.append(f"{prefix}: demo-stage evidence lacks video block")
        return
    if video.get("sha256") != sha256(source):
        report.errors.append(f"{prefix}: evidence sha256 does not match {source.name}")
    if video.get("fps") != FPS:
        report.errors.append(f"{prefix}: demo-stage evidence fps {video.get('fps')!r} != {FPS}")
    frames = video.get("frames")
    if not isinstance(frames, int) or isinstance(frames, bool) or frames < 1:
        report.errors.append(f"{prefix}: demo-stage evidence has no captured frames")
    if check_duration_match(prefix, source, video.get("duration_s"), report) \
            and len(report.errors) == before:
        scene = evidence.get("scene")
        report.notes.append(
            f"{prefix}: demo-stage scene={(scene or {}).get('id') if isinstance(scene, dict) else None} "
            f"frames={frames} sha={str(video.get('sha256'))[:12]}"
        )


def check_evidence_size(prefix: str, evidence: dict | None, width: int, height: int,
                        report: Validation) -> None:
    """Browser/window evidence carries a size; demo-stage evidence does not."""
    if evidence is None:
        return
    if [width, height] != [1920, 1080]:
        report.errors.append(
            f"{prefix}: evidence-backed source must be 1920x1080, got {width}x{height}"
        )
    if evidence.get("size") != [width, height]:
        report.errors.append(
            f"{prefix}: evidence size {evidence.get('size')!r} != source {width}x{height}"
        )


def speed_error(segment: dict, seconds: float) -> str | None:
    """Playback rate implied by a narration length and a footage range."""
    start, end = float(segment["start"]), float(segment["end"])
    speed = (end - start) / seconds
    if SPEED_MIN <= speed <= SPEED_MAX:
        return None
    return (f"{segment['id']}: recording speed {speed:.2f}x outside "
            f"{SPEED_MIN:g}x..{SPEED_MAX:g}x "
            f"(interval {end - start:.2f}s, narration {seconds:.2f}s)")


def check_tts(build: Path, segment: dict, voice: str, rate: str, report: Validation,
              timed: bool = True) -> bool:
    """Return True when nothing usable is cached, so the speed is still unknown."""
    mp3, clock = cache_files(build, segment["id"], segment["text"], voice, rate)
    if not mp3.exists() and not clock.exists():
        return True
    if not (mp3.is_file() and clock.is_file()):
        report.notes.append(
            f"{segment['id']}: incomplete narration cache; it is re-synthesized at render"
        )
        return True
    try:
        read_clock(clock, segment["text"])
        seconds = segment_seconds(duration(mp3))
    except RenderError as exc:
        report.errors.append(str(exc))
        return False
    error = speed_error(segment, seconds) if timed else None
    if error:
        report.errors.append(error)
    return False


def legacy_cache_names(build: Path) -> list[str]:
    """Files from the pre-content-addressed cache (tts/<id>.mp3|.json); ignored."""
    names = [path.name for path in (build / "tts").glob("*")
             if path.is_file() and path.suffix in (".mp3", ".json") and "." not in path.stem]
    return sorted(names)


def check_redline(texts: list[str], report: Validation) -> None:
    for index, text in enumerate(texts, 1):
        for name, pattern in AI_CLICHE_PATTERNS:
            if pattern.search(text):
                report.errors.append(
                    f"narration {index}: AI-cliche pattern {name}; "
                    "write a plain factual statement from the viewer's perspective"
                )
        lowered = text.lower()
        for term in INTERNAL_TERMS:
            if term in lowered:
                report.warnings.append(
                    f"narration {index}: internal jargon '{term}' is fine for technical "
                    "acceptance; remove it for external deliveries"
                )


def covers(text: str, pos: int, words: tuple) -> bool:
    """True when the char at pos is part of one of `words` in the text."""
    for word in words:
        for index, char in enumerate(word):
            start = pos - index
            if char == text[pos] and start >= 0 and text[start:start + len(word)] == word:
                return True
    return False


def polyphone_hit(text: str, pos: int, rule: Polyphone) -> bool:
    if covers(text, pos, rule.safe):
        return False
    if covers(text, pos, rule.watch):
        return True
    if rule.watch_before and pos > 0 and text[pos - 1] in rule.watch_before:
        return True
    return not rule.watch


def check_polyphones(texts: list[str], report: Validation) -> None:
    for index, text in enumerate(texts, 1):
        for char, rule in POLYPHONES.items():
            pos = 0
            while True:
                pos = text.find(char, pos)
                if pos < 0:
                    break
                if polyphone_hit(text, pos, rule):
                    context = text[max(0, pos - 8):pos + 9]
                    report.warnings.append(
                        f"narration {index}: polyphone '{char}' in …{context}… ({rule.hint}); "
                        "confirm the TTS reading or rewrite to the unambiguous word"
                    )
                pos += 1


def speech_units(text: str) -> float:
    """CJK characters count 1; Latin letters and digits count LATIN_WEIGHT."""
    return sum(1 if ord(char) > 0x2E7F else LATIN_WEIGHT
               for char in text if char.isalnum())


def check_length(texts: list[str], report: Validation) -> None:
    for index, text in enumerate(texts, 1):
        units = speech_units(text)
        if units > NARRATION_SOFT_MAX:
            report.warnings.append(
                f"narration {index}: long ({units:.0f} speech units, about "
                f"{units / SPEECH_UNITS_PER_SECOND:.0f}s); one segment carries one thought "
                "-- split it or give the result its own segment"
            )


def valid_evidence(evidence: dict) -> bool:
    scalar = (str, int, float)
    for key, value in evidence.items():
        if not isinstance(key, str) or not key.strip():
            return False
        if isinstance(value, list):
            if not all(isinstance(item, scalar) for item in value):
                return False
        elif not isinstance(value, scalar):
            return False
    return True


def narration_text_error(text: object, required: bool) -> str | None:
    if text is None and not required:
        return None
    if not isinstance(text, str) or not text.strip():
        return "text must be a non-empty string"
    if "\n" in text or "\r" in text:
        return "text must be one paragraph without newlines"
    return None


def card_errors(segment: dict, narrated: bool) -> list[str]:
    """A card is renderer-made: a title, optional narration and no footage."""
    segment_id = segment["id"]
    errors: list[str] = []
    title = segment.get("title")
    if title is not None and (not isinstance(title, str) or not title.strip()
                              or "\n" in title or "\r" in title):
        errors.append(f"{segment_id}: card title must be a single non-empty line")
    elif isinstance(title, str) and speech_units(title) > CARD_TITLE_MAX:
        errors.append(
            f"{segment_id}: card title is too long for the frame "
            f"({speech_units(title):.0f} units, max {CARD_TITLE_MAX})"
        )
    if title is None and not narrated:
        errors.append(f"{segment_id}: card needs a title or narration")
    for key in ("shot", "source", "crop", "start", "end"):
        if segment.get(key) is not None:
            errors.append(f"{segment_id}: a card has no footage; drop {key!r}")
    duration = segment.get("duration", CARD_DEFAULT)
    if not narrated:
        if isinstance(duration, bool) or not isinstance(duration, (int, float)) \
                or not CARD_MIN <= duration <= CARD_MAX:
            errors.append(
                f"{segment_id}: card duration must be a number within "
                f"{CARD_MIN:g}..{CARD_MAX:g}s"
            )
    elif "duration" in segment:
        errors.append(
            f"{segment_id}: duration applies to silent cards; "
            "a narrated card follows its narration"
        )
    return errors


def validate_episode(build: Path, episode: dict, report: Validation) -> Validation:
    build = build.expanduser().resolve()
    voice_value = episode.get("voice")
    rate_value = episode.get("rate", "+5%")
    voice_ok = isinstance(voice_value, str) and bool(voice_value.strip())
    rate_ok = isinstance(rate_value, str) and bool(RATE.fullmatch(rate_value))
    if not voice_ok:
        report.errors.append("voice must be a non-empty string")
    if not rate_ok:
        report.errors.append(f"rate must look like +5% or -10%, got {rate_value!r}")
    report.layout = episode.get("layout", DEFAULT_LAYOUT)
    if report.layout not in LAYOUTS:
        report.errors.append(
            f"layout must be one of {sorted(LAYOUTS)}, got {report.layout!r}"
        )
    evidence = episode.get("evidence")
    if evidence is not None and (not isinstance(evidence, dict) or not valid_evidence(evidence)):
        report.errors.append(
            "evidence must be an object of version facts (git_sha, environment, ticket ids) "
            "with string, number or list values"
        )

    segments = episode.get("segments")
    if not isinstance(segments, list) or not segments:
        report.errors.append("segments must be a non-empty array")
        return report

    seen_ids: set[str] = set()
    texts: list[str] = []
    uncached: list[str] = []
    for index, segment in enumerate(segments):
        if not isinstance(segment, dict):
            report.errors.append(f"segments[{index}]: must be an object")
            continue
        segment_id = segment.get("id")
        if not isinstance(segment_id, str) or not SEGMENT_ID.fullmatch(segment_id):
            report.errors.append(
                f"segments[{index}]: id must be ASCII letters/digits/_/- and start alphanumeric"
            )
            continue
        folded = segment_id.casefold()
        if folded in seen_ids:
            report.errors.append(f"{segment_id}: duplicate id")
            continue
        seen_ids.add(folded)

        kind = segment.get("kind", "shot")
        if kind not in SEGMENT_KINDS:
            report.errors.append(
                f"{segment_id}: kind must be one of {list(SEGMENT_KINDS)}, got {kind!r}"
            )
            continue
        label = segment.get("label")
        if (kind == "shot" or label is not None) and not (isinstance(label, str) and label.strip()):
            report.errors.append(f"{segment_id}: label must be a non-empty string")
        case = segment.get("case")
        if case is not None and not (isinstance(case, str) and case.strip()):
            report.errors.append(f"{segment_id}: case must be a non-empty string")
        text = segment.get("text")
        text_error = narration_text_error(text, required=kind == "shot")
        if text_error:
            report.errors.append(f"{segment_id}: {text_error}")
        elif isinstance(text, str):
            texts.append(text)
        if kind == "card":
            narrated = isinstance(text, str) and text_error is None
            report.errors.extend(card_errors(segment, narrated=narrated))
            if narrated and voice_ok and rate_ok:
                check_tts(build, segment, voice_value, rate_value, report, timed=False)
            continue

        shot = segment.get("shot")
        if not isinstance(shot, str) or not shot.strip():
            report.errors.append(f"{segment_id}: shot must be a relative path")
            continue
        shot_path = Path(shot)
        if shot_path.is_absolute() or ".." in shot_path.parts:
            report.errors.append(f"{segment_id}: shot must stay inside the build directory")
            continue
        source_kind = segment.get("source")
        if source_kind is not None and not (isinstance(source_kind, str)
                                            and source_kind in ALLOWED_SOURCES):
            report.errors.append(
                f"{segment_id}: source must be one of {sorted(ALLOWED_SOURCES)}, got {source_kind!r}"
            )
            continue
        source = (build / shot_path).resolve()
        try:
            relative = source.relative_to(build)
        except ValueError:
            report.errors.append(f"{segment_id}: shot resolves outside the build directory")
            continue
        if is_renderer_output(relative):
            report.errors.append(
                f"{segment_id}: shot {shot} is a file the renderer writes into this build; "
                f"keep takes out of {', '.join(OUTPUT_DIRS)}/ and away from the output file names"
            )
            continue
        if not source.is_file() or source.stat().st_size == 0:
            report.errors.append(f"{segment_id}: missing or empty recording {source}")
            continue
        if source_kind == "demo-stage":
            check_demo_stage_evidence(segment_id, source, report)
            evidence = None
        else:
            evidence = check_browser_evidence(segment_id, source, source_kind == "browser", report)

        start = segment.get("start")
        end = segment.get("end")
        if (not isinstance(start, (int, float)) or isinstance(start, bool)
                or not isinstance(end, (int, float)) or isinstance(end, bool)):
            report.errors.append(f"{segment_id}: start and end must be numbers")
            continue
        if start < 0 or end <= start:
            report.errors.append(
                f"{segment_id}: require 0 <= start < end, got {start}..{end}"
            )
            continue
        try:
            width, height, source_duration = probe_video(source)
        except RenderError as exc:
            report.errors.append(str(exc))
            continue
        report.sources[segment_id] = Source(source, width, height, source_duration, evidence)
        check_evidence_size(segment_id, evidence, width, height, report)
        if width < W or height < H:
            report.warnings.append(
                f"{segment_id}: source {width}x{height} is smaller than the {W}x{H} canvas "
                f"and will be upscaled; record at {W}x{H} or larger"
            )
        if end > source_duration + 0.1:
            report.errors.append(
                f"{segment_id}: interval ends at {end:.2f}s beyond source duration "
                f"{source_duration:.2f}s"
            )
            continue
        crop = segment.get("crop")
        if crop is not None:
            error = crop_error(segment_id, crop, width, height)
            if error:
                report.errors.append(error)
        report.notes.append(
            f"{segment_id}: {shot} {start:.2f}-{end:.2f}s "
            f"source={width}x{height} duration={source_duration:.2f}s"
        )
        if voice_ok and rate_ok and text_error is None and isinstance(text, str):
            if check_tts(build, segment, voice_value, rate_value, report):
                uncached.append(segment_id)

    report.errors.extend(feedback_errors(episode, segments))
    if texts:
        check_redline(texts, report)
        check_polyphones(texts, report)
        check_length(texts, report)
    if uncached:
        report.warnings.append(
            f"{len(uncached)} segment(s) have no cached TTS; speed range not checked: "
            + ", ".join(uncached)
        )
    legacy = legacy_cache_names(build)
    if legacy:
        report.warnings.append(
            "legacy TTS cache files are ignored and can be deleted: " + ", ".join(legacy)
        )
    return report


def validate(build: Path) -> Validation:
    """Every material rule for a build directory, collected instead of raised."""
    build = build.expanduser().resolve()
    report = Validation()
    for executable in ("ffmpeg", "ffprobe"):
        if shutil.which(executable) is None:
            report.errors.append(f"{executable} is not on PATH")
    for check in (check_edge_tts_version, check_pillow, font_path):
        try:
            check()
        except RenderError as exc:
            report.errors.append(str(exc))
    if not build.is_dir():
        report.errors.append(f"missing build directory: {build}")
        return report
    if any(error.endswith("is not on PATH") for error in report.errors):
        return report
    try:
        report.episode = load_episode(build / "episode.json")
    except RenderError as exc:
        report.errors.append(str(exc))
        return report
    return validate_episode(build, report.episode, report)
