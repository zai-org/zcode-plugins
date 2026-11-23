"""Shared creation production support; media APIs and explicit evidence contracts."""
from __future__ import annotations

import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any


# Episode beat ladder for schema v3: short-form episodes open on a conflict
# hook and end on a cliffhanger; the middle alternates escalation and payoff.
BEAT_FUNCTIONS = ("hook", "escalation", "payoff", "cliffhanger")

# ---- 生成器的物理事实 (creation_media 与 v4 序列校验共用; 计划期不生成, 验证期一次一条 take) ----
# Mandarin delivery rate used for the dialogue-fits-duration check.
def safe_unit_id(value):
    """Display ids may be Unicode; path separators and dot aliases are forbidden."""
    if (not isinstance(value, str) or not value or len(value) > 120
            or value in ('.', '..') or '/' in value or '\\' in value
            or any(ord(c) < 32 for c in value)):
        raise ValueError('unit id must be a safe filename component')
    return value

SPEECH_CHARS_PER_SECOND = 4.5
# The planning-time twin of creation_evidence.VOICE_MIN_SPEECH_S. Under this much speech a voice
# verdict is not supportable at all (the MFCC time-mean is dominated by WHICH phonemes were
# Creation production support.
# 「为什么？」 is 0.5s of voice, came back in a deep male voice over a woman's line and burned
# Production contract; see video-creation references for rationale.
# the plan, where lengthening a line is free.
VOICE_MIN_SPEECH_SECONDS = 3.0
# Official guide (video generator 2.5 「时间戳」): time is written in whole seconds, 2.5 obeys integer
# timestamps, the axis must be continuous, and 「指定时间段内容过多，则会导致过度剪切或剧情遗漏」.
# Nothing official sets a per-block minimum or a block count (the official prompt skill: do not
# assert an unverified maximum). 2s is the shortest block that still holds one reaction or one
# short line — real short dramas cut every ~1.7s (DramaBoard: 101K shots, 79% under 3s). The
# earlier 3s floor cited a failure that was cuts buried in prose (「切到」 in free text), not
# structured Shot N blocks.
SHOT_MIN_SECONDS = 2
# Reaction blocks ride the official short-drama pacing band (0.8-1.5s, Updream storyboard
# skill) on the official whole-second timestamp syntax (Seedance 2.5 响应整数秒的时间戳,
# official prompt guide) — the intersection on whole seconds is 1s. Everything else keeps
# the 2s floor above.
SHOT_REACTION_MIN_SECONDS = 1
# Community experience, not an official limit: past ~6 blocks per request keep every block light.
SHOTS_PER_30S_MAX = 6
# A spoken line needs a visible mouth. video generator 2.5 executes the prompt literally: a speaker
# Production contract; see video-creation references for rationale.
# 过肩 shots legitimately show the LISTENER's back and are exempt.
BACK_FACING_MARKERS = ("背影", "背对镜头", "背朝镜头", "背身", "后脑", "剪影", "侧影")
SEQ_CUT_TYPES = ("continuous", "angle_change", "ellipsis", "scene_change")
# Production contract; see video-creation references for rationale.
# Production contract; see video-creation references for rationale.
# production plans are not nagged. Floors per plan:
ENTRY_EXIT_MARKERS = ("入场", "进门", "走进", "推门", "闯进", "跑进", "离场", "离开", "走出", "出门", "转身走", "下场", "退出画面", "入画", "出画")
# Official positioning of the 30s window: 「无需多段拼接即可呈现完整故事」. Two adjacent
# same-scene sequences that fit in one request have no reason to carry a stitch boundary.
MERGE_WINDOW_SECONDS = 30
# Scene-change bridges (BV13zMG6CEif 四法 minus 构图, which is the multi-keyframe path):
# one generation that sees BOTH sides as first_frame/last_frame and REPLACES the handles.
BRIDGE_METHODS = ("occlusion", "whip", "action")
# ⑤ 触发缝合: ledger 外观变化的高容错词表 (warning 级, 不拦批)
_APPEAR_CHANGE_RE = re.compile(r"伤|血|湿|衣|衫|袍|绷带|撕|破|碎|烧|焦|污|泥|雨|饰|链|面具|换装")
BRIDGE_DURATION_SECONDS = 4
BRIDGE_HANDLE_SECONDS = 1.5
# 视觉圣经 (AI 导演工作流 skill, BV1zKgj6zEGj): 一段锁死全片视觉语言的短文 — 官方结构里它属于
# 总览句的风格词 + 结尾「补充说明」的贯穿细节, 所以要短; 工具会把它注进每张卡和每个序列 prompt。
STYLE_BIBLE_MAX_CHARS = 240
# 关键帧参考 (官方「多关键帧参考」严格档: 独立图按顺序传, 第一句声明): 只给站位复杂的序列用,
# 官方同时提醒分镜图会限制模型发挥、宫格 ≤15。
KEYFRAMES_MAX_PER_SEQUENCE = 6
# A reference video/frame does NOT carry the key-light direction or the wind (controlled
# experiment 2026-09-21: with a context reference the key light flipped 180° and the cloak
# changed the way it blew). Every generation must state both in its own prompt. The groups
# are deliberately broad: a missed case costs nothing, a false alarm teaches the agent to
# ignore warnings.
LIGHT_MARKERS = ("光", "日", "阳", "月", "火", "照", "晨", "暮", "昏", "星", "霞", "焰", "灯")
WIND_MARKERS = ("风", "气流", "吹", "飘", "扬起")
# Wind is not a question indoors, so an interior shot is not nagged about it.
INDOOR_MARKERS = ("室内", "屋内", "客厅", "卧室", "书房", "房间", "厅", "殿内", "洞内",
                  "车内", "舱内", "帐内", "地下", "走廊")


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                    separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def file_digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


# ---- 1012 片型 (format) ----
# 管线最初只认两种片型: 竖屏短剧单集 (episode: hook/cliffhanger 节拍、60-90s、<=3 场景) 与对白
# 驱动的剧情片 (drama / film: 禁旁白、节拍必填因果)。纪录片、虚拟采访、鬼畜/混剪、广告、MV、
# 讲解片……用同一套生成/验片/装配机制, 但不该被这两种片型的创作规矩卡死 (原先一律硬 error)。
# 计划可以写 format 声明片型; 不写时与 1012 前完全一致: schema 3/4 视为 episode, schema 2 视为
# drama。只有 episode 套单集规矩; 只有 drama/film/episode 套剧情片规矩; 其余片型这些规矩降为
# 提醒。生成服务硬限制 / 预算 / 防作弊类闸门与片型无关, 一律照旧。
EPISODE_FORMAT = "episode"
NARRATIVE_FORMATS = frozenset({"drama", "film", "episode"})
# 片型是自由文本 (管线不该给片型设先验), 但写错就会静默放宽剧情片闸门 —— 已知值列在这里,
# 认不出的值放行并提醒, 让 "flim" 这类拼错能被看见 (1012 边界测试发现)
KNOWN_FORMATS = frozenset({
    "episode", "drama", "film",
    "documentary", "interview", "remix", "ad", "mv", "explainer",
})


def plan_format(data: Any) -> str:
    """The plan's declared format (lower-case), or the pre-1012 default for its schema."""
    if not isinstance(data, dict):
        return "drama"
    raw = str(data.get("format") or "").strip().lower()
    if raw:
        return raw
    return "film"


def is_episode(data: Any) -> bool:
    return plan_format(data) == EPISODE_FORMAT


def is_narrative(data: Any) -> bool:
    return plan_format(data) in NARRATIVE_FORMATS


def plan_target_seconds(data: Any) -> "tuple[float | None, float | None]":
    """(low, high) of the plan's declared target length, from target_range_seconds [lo, hi],
    target_duration_seconds / target_seconds (single value), or episode.target_seconds."""
    if not isinstance(data, dict):
        return None, None
    rng = data.get("target_range_seconds")
    if isinstance(rng, list) and len(rng) == 2:
        lo, hi = number(rng[0]), number(rng[1])
        if lo is not None and hi is not None and 0 < lo <= hi:
            return lo, hi
    for key in ("target_duration_seconds", "target_seconds"):
        v = number(data.get(key))
        if v is not None and v > 0:
            return v, v
    ep = data.get("episode")
    v = number(ep.get("target_seconds")) if isinstance(ep, dict) else None
    return (v, v) if v is not None and v > 0 else (None, None)


def _target_duration_notes(data: dict, screen_total: float) -> list[str]:
    """Non-episode formats: the planned screen time vs the plan's own declared target, advisory
    (tolerance max(10s, 15%)). No target declared -> nothing to say."""
    lo, hi = plan_target_seconds(data)
    if lo is None or not screen_total:
        return []
    slack = max(10.0, 0.15 * (hi or lo))
    if screen_total < lo - slack or screen_total > (hi or lo) + slack:
        target = f"{lo:g}s" if lo == hi else f"{lo:g}-{hi:g}s"
        return [f"planned screen time {screen_total:.1f}s is far from the declared target {target} — "
                "re-check coverage (advisory; the format sets no fixed window)"]
    return []


def voiceover_issues(unit: Any, where: str, narrative: bool) -> "tuple[list[str], list[str]]":
    """Structure of a unit's `voiceover` (画外声: 旁白 / 画外采访者 / 广告口播) — {speaker?, line,
    voice?, audio?} items, delivered as an assembly-time voice track, never sent to the generator,
    no lip-sync, no cast card. Narrative formats get a reminder of the house rule."""
    errors: list[str] = []
    warnings: list[str] = []
    vo = unit.get("voiceover") if isinstance(unit, dict) else None
    if vo is None:
        return errors, warnings
    items = vo if isinstance(vo, list) else [vo]
    for j, item in enumerate(items):
        if not isinstance(item, dict) or not str(item.get("line") or "").strip():
            errors.append(f"{where}.voiceover[{j}] must be an object with a non-empty line "
                          "({speaker?, line, voice?, audio?})")
    if items and narrative and not errors:
        warnings.append(f"{where}.voiceover in a narrative format — drama plays information as scene "
                        "(dialogue/action/picture); keep voiceover for what cannot be shown")
    return errors, warnings


def number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def effective_cast(data: dict, shot: dict) -> list[dict]:
    """Resolve only the selected state, preserving stable identity and relationships."""
    result = []
    for member in data.get("cast", []):
        if not isinstance(member, dict) or member.get("id") not in shot.get("character_ids", []):
            continue
        definition = {k: member[k] for k in (
            "id", "name", "kind", "appearance", "styling", "traits", "relations", "voice",
            "voice_card", "headshot", "epithet", "physique",
            "image", "image_side", "image_back") if k in member}
        state_id = (shot.get("cast_states") or {}).get(member.get("id"))
        if state_id:
            active = next((s for s in member.get("states", [])
                           if isinstance(s, dict) and s.get("id") == state_id), None)
            if active is None:
                raise ValueError(f"unknown active cast state: {member.get('id')}/{state_id}")
            definition["state"] = active
            definition.update({k: v for k, v in active.items() if k != "id" and v is not None})
        result.append(definition)
    return result


def resolved_beat(data: dict, shot: dict) -> dict:
    return next((b for b in data.get("beats", []) if isinstance(b, dict)
                 and b.get("id") == shot.get("beat")), {})


def unit_visual_text(unit: dict) -> str:
    """Visual description sources, excluding dialogue-only mentions when blocks exist."""
    parts = [str(unit.get(field) or "") for field in ("setting", "notes")]
    blocks = unit.get("blocks")
    if isinstance(blocks, list) and blocks:
        parts.extend(str(block.get(field) or "") for block in blocks if isinstance(block, dict)
                     for field in ("picture", "action"))
    else:
        parts.append(str(unit.get("prompt") or unit.get("video_prompt") or ""))
    return "\n".join(parts)


def _prop_visible_in_text(text: str, label: str) -> bool:
    for clause in re.split(r"[，,。.;；\n]", text):
        for match in re.finditer(re.escape(label), clause):
            before, after = clause[:match.start()], clause[match.end():]
            if re.search(r"(?:未持(?:有)?|未拿(?:着)?|未握(?:着)?|没有|无|"
                         r"(?:不|没)(?:持(?:有)?|拿(?:着)?|握(?:着)?|带(?:着)?)|"
                         r"(?:不要|别|勿|禁止|不得|不许|不应|不能|do not|don't).{0,24}"
                         r"(?:持(?:有)?|拿(?:着)?|握(?:着)?|出现|hold|carry))\s*$", before, re.IGNORECASE):
                continue
            if re.match(r"\s*(?:(?:尚未|还未|未|不应|禁止)出现|不在场)", after):
                continue
            return True
    return False


def nexus_visual_plan(data: dict) -> dict:
    """T17: promote the nexus prop in an effective view; never mutate the caller's plan."""
    nexus = data.get("nexus")
    pid = nexus.get("prop_id") if isinstance(nexus, dict) else None
    props = data.get("props")
    if not isinstance(pid, str) or not pid or not isinstance(props, list):
        return data
    promoted = [dict(p, critical=True, requires_visual_lock=True)
                if isinstance(p, dict) and p.get("id") == pid else p for p in props]
    return dict(data, props=promoted) if promoted != props else data


def unit_prop_ids(data: dict, unit: dict) -> list[str]:
    """Present ids plus literal critical-prop mentions; ledger facts alone are not visibility."""
    raw = unit.get("prop_ids")
    ids = [p for p in raw if isinstance(p, str)] if isinstance(raw, list) else []
    if str(data.get("schema_version")) == "4":
        text = unit_visual_text(unit)
        props = data.get("props") if isinstance(data.get("props"), list) else []
        ids.extend(p["id"] for p in props if isinstance(p, dict) and p.get("critical") is True
                   and isinstance(p.get("id"), str) and isinstance(p.get("label"), str) and p["label"]
                   and _prop_visible_in_text(text, p["label"]))
    return list(dict.fromkeys(ids))


def prop_ledger_states(data: dict, prop: dict) -> list[dict]:
    """Resolve entry/exit facts from the current v4 plan without maintaining another ledger.

    Flat <prop_id>.state / .holder / .hand keys preserve the existing text-only continuity
    contract and T06's holder-change reminder. Omitted facts carry forward across scene cuts.
    The definition's holder seeds first_appearance only, never an earlier unit.
    """
    pid = prop.get("id")
    units = data.get("sequences")
    if str(data.get("schema_version")) != "4" or not isinstance(pid, str) or not isinstance(units, list):
        return []
    current: dict = {}
    rows = []
    for unit in units:
        if not isinstance(unit, dict):
            continue
        if unit.get("sequence_id") == prop.get("first_appearance"):
            current.setdefault("holder", prop.get("holder"))
        continuity = unit.get("continuity") if isinstance(unit.get("continuity"), dict) else {}
        phases = {}
        for phase in ("entry_state", "exit_state"):
            raw = continuity.get(phase) if isinstance(continuity.get(phase), dict) else {}
            current = {**current, **{field: raw[f"{pid}.{field}"] for field in ("state", "holder", "hand")
                                     if f"{pid}.{field}" in raw}}
            phases[phase] = dict(current)
        rows.append({"unit": unit, **phases})
    return rows


def _prop_changes(unit: dict) -> list[str]:
    continuity = unit.get("continuity") if isinstance(unit.get("continuity"), dict) else {}
    raw = continuity.get("allowed_changes")
    return [s for s in raw if isinstance(s, str)] if isinstance(raw, list) else []


def _prop_transfer_recorded(records: list[str], pid: str, before: str, after: str) -> bool:
    """A legal record names this prop, the exact directed holders and a visible transfer."""
    route = re.compile(rf"(?<![\w.-]){re.escape(pid)}\.holder\s*[:：]\s*{re.escape(before)}\s*(?:→|->)\s*"
                       rf"{re.escape(after)}(?=$|[\s，,。.;；（(])")
    action = re.compile(r"递给|递向|递出|交给|交到|交接|接过|接住|移交|传给|放下|拾起|捡起|取走|夺过|抢过|归还|"
                        r"\b(?:hand(?:s|ing)? over|pass(?:es|ing)? to|pick(?:s|ing)? up|put(?:s|ting)? down|drop(?:s|ping)?)\b",
                        re.IGNORECASE)
    for record in records:
        match = route.search(record)
        if not match:
            continue
        for move in action.finditer(record, match.end()):
            if not re.search(r"(?:不(?:要|能|得|应)?|未|勿|禁止|无需|not|don't|do not)\s*$",
                             record[:move.start()], re.IGNORECASE):
                return True
    return False


def prop_ledger_warnings(data: dict) -> list[str]:
    """T01: account for every prop; all new contract/transition findings are advisory."""
    if str(data.get("schema_version")) != "4":
        return []
    props = data.get("props")
    if not isinstance(props, list):
        return ["T01 props[] 全量建账：必须是道具定义数组；无道具写 [] (advisory)"]
    units = data.get("sequences") if isinstance(data.get("sequences"), list) else []
    unit_ids = {u.get("sequence_id") for u in units if isinstance(u, dict) and isinstance(u.get("sequence_id"), str)}
    cast_ids = {c.get("id") for c in data.get("cast") or [] if isinstance(c, dict) and isinstance(c.get("id"), str)}
    warnings = []
    declared = set()
    critical_count = sum(1 for p in props if isinstance(p, dict) and p.get("critical") is True)
    if critical_count > 5:
        warnings.append(f"T01 critical 道具共 {critical_count} 个，超过 5 个；建议按剧情走向聚焦每题 1–3 个 (advisory)")
    for i, prop in enumerate(props):
        where = f"T01 props[{i}]"
        if not isinstance(prop, dict):
            warnings.append(f"{where} 必须是道具定义对象 (advisory)")
            continue
        for field in ("id", "label", "first_appearance"):
            if not isinstance(prop.get(field), str) or not prop[field].strip():
                warnings.append(f"{where}.{field} 必须是逐字固定的非空文本 (advisory)")
        if not isinstance(prop.get("critical"), bool):
            warnings.append(f"{where}.critical 必须是 bool，由 agent 按是否影响剧情走向判定 (advisory)")
        states = prop.get("states")
        if (not isinstance(states, list) or not states
                or any(not isinstance(s, str) or not s.strip() for s in states)):
            warnings.append(f"{where}.states 必须是非空状态枚举，如 ['在鞘', '出鞘', '丢失'] (advisory)")
            states = []
        elif len(set(states)) != len(states):
            warnings.append(f"{where}.states 含重复枚举值 (advisory)")
        if not isinstance(prop.get("holder"), str) or prop["holder"] not in cast_ids | {"无"}:
            warnings.append(f"{where}.holder 必须是当前持有者 cast_id；无人持有记 '无' (advisory)")
        if isinstance(prop.get("first_appearance"), str) and prop["first_appearance"] not in unit_ids:
            warnings.append(f"{where}.first_appearance={prop['first_appearance']!r} 不是已声明单元 id (advisory)")
        pid = prop.get("id")
        if not isinstance(pid, str) or not pid.strip():
            continue
        if pid in declared:
            warnings.append(f"{where}.id={pid!r} 重复；稳定 ID 全片不变且只定义一次 (advisory)")
        declared.add(pid)
        previous = None
        for row in prop_ledger_states(data, prop):
            unit = row["unit"]
            sid = unit.get("sequence_id")
            continuity = unit.get("continuity") if isinstance(unit.get("continuity"), dict) else {}
            for phase in ("entry_state", "exit_state"):
                raw = continuity.get(phase) if isinstance(continuity.get(phase), dict) else {}
                for field in ("state", "holder", "hand"):
                    key = f"{pid}.{field}"
                    if key not in raw:
                        continue
                    value = raw[key]
                    legal = (states if field == "state" else cast_ids | {"无"} if field == "holder" else {"左", "右", "无"})
                    if not isinstance(value, str) or value not in legal:
                        warnings.append(f"T01 {sid}.continuity.{phase}[{key!r}]={value!r} "
                                        f"不在{' states 枚举' if field == 'state' else '合法取值'}内 (advisory)")
            if pid in unit_prop_ids(data, unit) and not row["entry_state"].get("state"):
                warnings.append(f"T01 {sid}: 道具 {pid} 出现但账中无状态；在 continuity.entry_state 写 "
                                f"'{pid}.state'，后续单元承接该事实 (advisory)")
            boundaries = [(row["entry_state"], row["exit_state"], _prop_changes(unit), str(sid))]
            if previous is not None:
                boundaries.append((previous["exit_state"], row["entry_state"],
                                   _prop_changes(previous["unit"]) + _prop_changes(unit),
                                   f"{previous['unit'].get('sequence_id')}→{sid}"))
            for before, after, records, boundary in boundaries:
                a, b = before.get("holder"), after.get("holder")
                if (isinstance(a, str) and isinstance(b, str) and a != b
                        and not _prop_transfer_recorded(records, pid, a, b)):
                    warnings.append(f"T01 {boundary}: {pid}.holder 从 {a!r} 变为 {b!r}，无合法交接记录；"
                                    f"allowed_changes 写 '{pid}.holder: {a} → {b}' 与可见递接/拾放过程，"
                                    "并按 T06 写清给方、收方、启动→过程→落点→次级运动 (advisory)")
            previous = row
    for unit in units:
        if isinstance(unit, dict):
            for pid in unit_prop_ids(data, unit):
                if pid not in declared:
                    warnings.append(f"T01 {unit.get('sequence_id')}.prop_ids: {pid!r} 未在 props[] 全量建账 (advisory)")
    return warnings


def prop_visual_warnings(data: dict, ctx=None) -> list[str]:
    """T02: critical prop cards and literal labels are reminders, never new hard gates."""
    if str(data.get("schema_version")) != "4":
        return []
    props = data.get("props") if isinstance(data.get("props"), list) else []
    units = data.get("sequences") if isinstance(data.get("sequences"), list) else []
    warnings = []

    def card_path(raw):
        if not isinstance(raw, str) or not raw.strip():
            return None
        try:
            return ctx.resolve(raw) if ctx is not None else Path(raw)
        except (OSError, ValueError):
            return None

    for prop in props:
        if not isinstance(prop, dict) or prop.get("critical") is not True:
            continue
        pid, label = prop.get("id"), prop.get("label")
        if not isinstance(pid, str) or not isinstance(label, str) or not label:
            continue
        if prop.get("name") is not None and prop["name"] != label:
            warnings.append(f"T02 {pid}: 道具称谓 name={prop['name']!r} 与 props[].label={label!r} "
                            "不逐字一致；统一称谓 (advisory)")
        image = card_path(prop.get("image"))
        for unit in units:
            if not isinstance(unit, dict) or pid not in unit_prop_ids(data, unit):
                continue
            sid = unit.get("sequence_id")
            if label not in unit_visual_text(unit):
                warnings.append(f"T02 {sid}: critical 道具 {pid} 的描述称谓与 props[].label={label!r} "
                                "不逐字一致；描述中使用固定 label (advisory)")
            refs = unit.get("reference_images") if isinstance(unit.get("reference_images"), list) else []
            mounted = [ref for ref in refs if isinstance(ref, dict) and image is not None
                       and card_path(ref.get("path")) == image
                       and (ref.get("role") or "reference_image") == "reference_image"]
            if not mounted or (ctx is not None and image is not None and not image.is_file()):
                warnings.append(f"T02 {sid}: critical 道具 {pid}（{label}）出现但未挂可用道具卡；"
                                "props[].image 使用一图一物设定图，并在本单元及对应生成请求的 "
                                "reference_images 挂同一卡 (advisory)")
            for ref in mounted:
                if ref.get("label") != label:
                    warnings.append(f"T02 {sid}: 道具卡称谓 {ref.get('label')!r} 与 "
                                    f"props[].label={label!r} 不逐字一致 (advisory)")
    return warnings


def _holder_empty_handed(data: dict, unit: dict, holder: str, label: str) -> bool:
    """Look for affirmative empty-hand wording attached to this holder, not another actor."""
    text = unit_visual_text(unit)
    if re.search(r"(?:不要|别|勿|禁止|不得|不许|不应|不能|do not|don't)[^，,。.;；\n]{0,30}?"
                 rf"(?:拿(?:着)?|持(?:有)?|握(?:着)?|捧(?:着)?|携带|hold|carry)\s*{re.escape(label)}",
                 text, re.IGNORECASE):
        return False
    actors = []
    for member in data.get("cast") or []:
        if not isinstance(member, dict) or not isinstance(member.get("id"), str):
            continue
        for alias in (member["id"], member.get("name")):
            if isinstance(alias, str) and alias:
                token = re.escape(alias)
                if alias.isascii():
                    token = rf"(?<![A-Za-z0-9_]){token}(?![A-Za-z0-9_])"
                actors.append((member["id"], re.compile(token)))
    empty = re.compile(rf"空手|双手空着|未持(?:有)?\s*{re.escape(label)}|\bempty[- ]handed\b", re.IGNORECASE)
    for clause in re.split(r"[，,。.;；\n]", text):
        for match in empty.finditer(clause):
            before = clause[:match.start()]
            if re.search(r"(?:不(?:要|再|是|能|应|该|得)?|非|未|勿|别|禁止|并非|避免|无需|not|don't|do not)\s*$",
                         before, re.IGNORECASE):
                continue
            subjects = [(name.end(), cid) for cid, pattern in actors for name in pattern.finditer(before)]
            if subjects and max(subjects)[1] == holder:
                return True
            if not subjects and unit.get("character_ids") == [holder]:
                return True
    return False


def prop_first_appearance_warnings(data: dict) -> list[str]:
    """T04: a critical prop's future holder is explicitly empty-handed before first use."""
    if str(data.get("schema_version")) != "4":
        return []
    props = data.get("props") if isinstance(data.get("props"), list) else []
    warnings = []
    for prop in props:
        if not isinstance(prop, dict) or prop.get("critical") is not True:
            continue
        pid, label, holder = prop.get("id"), prop.get("label"), prop.get("holder")
        if not all(isinstance(v, str) and v for v in (pid, label, holder)):
            continue
        rows = prop_ledger_states(data, prop)
        first = next((i for i, row in enumerate(rows)
                      if row["unit"].get("sequence_id") == prop.get("first_appearance")), None)
        if first is None:
            continue  # T01 already reminds unknown/missing first_appearance.
        for row in rows[:first]:
            unit = row["unit"]
            sid = unit.get("sequence_id")
            held = any(facts.get("holder") == holder and facts.get("hand") in ("左", "右")
                       for facts in (row["entry_state"], row["exit_state"]))
            if pid in unit_prop_ids(data, unit) or held:
                warnings.append(f"T04 {sid}: critical 道具 {pid}（{label}）在 first_appearance="
                                f"{prop['first_appearance']} 之前已出现/入手；核对首现与状态账 (advisory)")
            characters = unit.get("character_ids") if isinstance(unit.get("character_ids"), list) else []
            if holder in characters and not _holder_empty_handed(data, unit, holder, label):
                warnings.append(f"T04 {sid}: {holder} 在 {label} 首现（{prop['first_appearance']}）前缺少"
                                f"正面空手状态；点名写 '空手' 或 '未持{label}'，不要用 '不要拿{label}' "
                                "这类否定指令，也不能拿另一角色的空手描述代替 (advisory)")
    return warnings


def shot_review_context(data: dict, shot: dict, ctx) -> dict:
    """Bind directing semantics and every effective local media reference to bytes."""
    data = nexus_visual_plan(data)
    assets = {
        "cast": effective_cast(data, shot),
        "scenes": [s for s in data.get("scenes", []) if isinstance(s, dict) and s.get("id") == shot.get("scene_id")],
        "props": [p for p in data.get("props", []) if isinstance(p, dict) and p.get("id") in unit_prop_ids(data, shot)],
    }
    files = {}
    def media(value):
        if isinstance(value, str) and value and not value.startswith(("http://", "https://", "data:")):
            path = ctx.resolve(value)
            files[ctx.virtualize(path)] = file_digest(path) if path.is_file() else None
    def collect(value):
        if isinstance(value, list):
            for item in value:
                collect(item)
        elif isinstance(value, dict):
            for key, item in value.items():
                if key in ("image", "image_side", "image_back", "voice_card", "headshot", "audio", "path"):
                    media(item)
                else:
                    collect(item)
    collect(assets)
    collect({"keyframes": shot.get("keyframes", []), "voiceover": shot.get("voiceover", []),
             "narration": shot.get("narration", {})})
    for frame in shot.get("keyframes", []):
        if isinstance(frame, str):
            media(frame)
    units = data.get('sequences') or data.get('shots') or []
    position = next((i for i, unit in enumerate(units) if unit is shot or (unit.get('sequence_id') or unit.get('shot_id')) == (shot.get('sequence_id') or shot.get('shot_id'))), None)
    # Prompt augmentation consumes preceding unit state/order and selected world references.
    preceding = units[:position] if position is not None else []
    return {"preceding_units": preceding, "shot": shot, "beat": resolved_beat(data, shot), "assets": assets,
            "reference_files": files, "format": plan_format(data), "generator": data.get("generator"),
            "canvas": data.get("canvas"), "style_preset": data.get("style_preset"), "style_bible": data.get("style_bible"),
            "bindings": [b for b in data.get("bindings", []) if isinstance(b, dict)
                         and (b.get("a") in shot.get("character_ids", []) or b.get("b") in shot.get("character_ids", []))]}


def shot_plan_digest(data: dict, shot: dict, ctx) -> str:
    return digest(shot_review_context(data, shot, ctx))


def validate_plan(data: dict, ctx=None) -> tuple[list[str], list[str], float | None]:
    """validate plan: structure, directing/state contract, the story layer, shot blocks and,
    when a project context is given, the plan against its screenplay."""
    data = nexus_visual_plan(data)
    from .creation_style_policy import resolve_human_style
    data, style_blockers, style_warnings = resolve_human_style(data)
    errors, warnings, screen_total = _validate_plan_structure(data)
    errors.extend(style_blockers)
    warnings.extend(style_warnings)
    warnings.extend(prop_ledger_warnings(data))
    warnings.extend(prop_visual_warnings(data, ctx))
    warnings.extend(prop_first_appearance_warnings(data))
    warnings.extend(native_audio_warnings(data.get("sequences") or data.get("shots") or []))
    if str(data.get("schema_version", 1)) in ("2", "3", "4"):
        from . import creation_screenplay as screenplay
        narrative = is_narrative(data)
        layers = [story_layer_issues(data, screen_total), screenplay.block_issues(data, narrative)]
        if ctx is not None:
            text, path = screenplay.load_screenplay(data, ctx)
            layers.append(screenplay.screenplay_issues(data, text, path, narrative))
            layers.append(reference_shape_issues(data, ctx))
        for layer_errors, layer_warnings in layers:
            errors = errors + layer_errors
            warnings = warnings + layer_warnings
    return errors, warnings, screen_total


# The video generator downloads every reference image and refuses the whole task with HTTP 400
# ("expected the aspect ratio to be between 0.39 and 2.50") when one is outside this range — a
# turnaround sheet or a thin strip cropped out of one. The take still counts toward the budget,
# so the shape is checked here, before video_generate reserves anything.
REFERENCE_ASPECT_MIN, REFERENCE_ASPECT_MAX = 0.4, 2.5


def reference_shape_issues(data: dict, ctx) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    for group in ("sequences", "shots"):
        for i, unit in enumerate(data.get(group) or []):
            if not isinstance(unit, dict):
                continue
            for k, ref in enumerate(unit.get("reference_images") or []):
                raw = ref.get("path") if isinstance(ref, dict) else ref
                if not isinstance(raw, str) or not raw.strip() or raw.startswith(("http://", "https://", "data:")):
                    continue
                path = ctx.resolve(raw)
                if not path.is_file():
                    continue  # a missing file is reported by the reference checks that need it
                try:
                    from PIL import Image
                    with Image.open(path) as im:
                        w, h = im.size
                except Exception:  # noqa: BLE001 — an unreadable image fails at generation with its own error
                    continue
                ratio = w / h if h else 0.0
                if not REFERENCE_ASPECT_MIN <= ratio <= REFERENCE_ASPECT_MAX:
                    errors.append(f"{group}[{i}].reference_images[{k}] {raw} is {w}x{h} (aspect {ratio:.2f}); "
                                  f"the video generator only accepts {REFERENCE_ASPECT_MIN}-{REFERENCE_ASPECT_MAX} "
                                  "and fails the whole take — crop or pad it first")
    return errors, []


def native_audio_warnings(units: list[dict], args=None) -> list[str]:
    """T21: consider the existing call-level switch; never turn audio off automatically."""
    from .creation_screenplay import unit_lines
    from . import generators
    args = args or {}
    if args.get("generate_audio") is False or not generators.profile().get("audio_out", True):
        return []   # a silent generator has no native audio to switch off
    warnings = []
    for unit in units:
        if not isinstance(unit, dict):
            continue
        kinds = {kind for kind, text in unit_lines(unit) if text.strip()}
        if "dialogue" in kinds or ("inner" in kinds and args.get("inner_in_clip") is not False):
            continue
        warnings.append(f"T21 {unit.get('sequence_id') or unit.get('shot_id')}: 无台词单元按需关闭原生音频 "
                        "generate_audio=false；需环境/动作音则保留。开关作用整次调用，混合有声/无声单元按需拆批 (advisory)")
    return warnings


# Story layer: the plan already carries causality (cause/action/result, audience
# before/after) and world state; what evaporated was the emotional/motivational dimension —
# no field held it and no gate checked it. These rules make it a contract.
BEAT_MAX_SCREEN_SECONDS = 15.0
INTENT_MIN_CHARS = 25
EMOTION_TURN_MARKERS = ("→", "->")
SPEAKING_EXEMPT_KINDS = ("object",)


def story_layer_issues(data: dict, screen_total: float | None) -> tuple[list[str], list[str]]:
    """Emotion/hook/stake per beat, beat granularity, cast motivation, shot intent as narrative duty.

    Narrative formats (drama/film/episode) get errors; other formats get the same messages as
    advisories, matching how the rest of the directing contract treats them.
    """
    narrative = is_narrative(data)
    found: list[str] = []
    role_warnings: list[str] = []
    beats = [b for b in (data.get("beats") or []) if isinstance(b, dict)]

    def filled(value: Any) -> bool:
        return isinstance(value, str) and bool(value.strip())

    for i, beat in enumerate(beats):
        where = f"beats[{i}]"
        for key in ("emotion", "hook", "stake"):
            if not filled(beat.get(key)):
                found.append(f"{where}.{key} must be non-empty text")
        emotion = beat.get("emotion")
        if filled(emotion):
            parts = re.split(r"→|->", emotion)
            if len(parts) < 2 or any(not p.strip() for p in parts):
                found.append(f"{where}.emotion must be a turn written as 'A → B' (from one state to another), "
                             f"not a single mood: {emotion!r}")

    # Granularity: one beat per ~15s of planned screen time (the declared target only when no
    # unit has a screen time yet), and at least one beat per scene that has coverage.
    lo, hi = plan_target_seconds(data)
    length = screen_total or hi or lo
    units = [u for u in (data.get("shots") or []) + (data.get("sequences") or []) if isinstance(u, dict)]
    covered_scenes = {u.get("scene_id") for u in units if u.get("scene_id")}
    if beats:
        by_time = math.ceil(float(length) / BEAT_MAX_SCREEN_SECONDS) if length else 0
        need = max(by_time, len(covered_scenes))
        if len(beats) < need:
            reason = (f"{float(length):.0f}s of screen time (one beat per ~{BEAT_MAX_SCREEN_SECONDS:.0f}s)"
                      if by_time >= len(covered_scenes) else f"{len(covered_scenes)} scenes (one beat per scene)")
            found.append(f"beats are too coarse: {len(beats)} beat(s) for {reason}; plan at least {need}")

    # T13: functional extras are exempt; core roles keep their story responsibilities.
    speakers: set[str] = set()
    inner_speakers: set[str] = set()
    for unit in units:
        if isinstance(unit, dict):
            for line in unit.get("dialogue") or []:
                if isinstance(line, dict) and filled(line.get("speaker")):
                    speakers.add(line["speaker"].strip())
            narration = unit.get("narration")
            if isinstance(narration, dict) and filled(narration.get("speaker")):
                inner_speakers.add(narration["speaker"].strip())
            for block in unit.get("blocks") or []:
                line = block.get("line") if isinstance(block, dict) else None
                if isinstance(line, dict) and line.get("kind") == "inner" and filled(line.get("speaker")):
                    inner_speakers.add(line["speaker"].strip())
    role_types = ("protagonist", "supporting", "antagonist", "extra", "other")
    core_labels = {"protagonist", "supporting", "antagonist", "主角", "主人公", "关键配角", "对立者", "反派"}
    for i, member in enumerate(data.get("cast") or []):
        if not isinstance(member, dict) or str(member.get("kind") or "") in SPEAKING_EXEMPT_KINDS:
            continue
        names = {str(member.get(k) or "").strip() for k in ("id", "name")} - {""}
        role = member.get("role_type")
        if role is not None and role not in role_types:
            role_warnings.append(f"cast[{i}].role_type must be one of {list(role_types)} (advisory)")
        if role == "extra":
            if names & speakers:
                role_warnings.append(f"cast[{i}] ({member.get('name') or member.get('id')}): extra 不开口或只给动作性台词；"
                                     "主角/对立者/关键配角不得改标 extra 绕开故事责任，请核对台词职责 (advisory)")
            # Only explicit story clues revoke the exemption; do not guess a role from
            # ordinary prop actions or how often a functional character appears.
            named_turn = False
            for beat in beats:
                for state in re.split(r"→|->", str(beat.get("emotion") or "")):
                    for name in names:
                        pattern = re.escape(name) + ("" if re.search(r"[\u3400-\u9fff]", name) else r"\b")
                        if re.match(pattern, state.strip(), re.IGNORECASE):
                            named_turn = True
            core_role = (str(member.get("role") or "").strip().lower() in core_labels
                         or bool({name.lower() for name in names} & core_labels)
                         or bool(names & inner_speakers) or named_turn)
            if not core_role:
                continue
            role_warnings.append(f"cast[{i}].role_type=extra 与已有核心角色标识/具名转折/内心叙事冲突；"
                                 "核心动机 want/need 与转折检查保留，请恢复 protagonist/supporting/antagonist (advisory)")
        if not names & speakers:
            continue
        if not str(member.get("image") or "").strip():
            role_warnings.append(f"cast[{i}] ({member.get('name') or member.get('id')}) 开口说话但缺 image 角色卡；"
                                 "参考图三件套:说话角色卡/出场场景图/critical 道具卡，缺卡跨镜头身份易漂移 (advisory)")
        motivation = member.get("motivation")
        motivation = motivation if isinstance(motivation, dict) else {}
        missing = [k for k in ("want", "need") if not filled(motivation.get(k))]
        if missing:
            found.append(f"cast[{i}] ({member.get('name') or member.get('id')}) speaks but motivation."
                         f"{'/'.join(missing)} is empty; speaking characters declare motivation {{want, need, flaw}}")

    # Shot intent is the shot's narrative duty, not a shooting checklist.
    for i, shot in enumerate(data.get("shots") or []):
        if not isinstance(shot, dict) or not filled(shot.get("intent")):
            continue  # presence is checked by the directing contract
        intent = shot["intent"].strip()
        visuals = {v.strip() for v in shot.get("required_visuals") or [] if isinstance(v, str)}
        if intent in visuals:
            found.append(f"shots[{i}].intent repeats a required_visuals item ({intent!r}); intent says what the shot "
                         "does in the story, required_visuals say what must be seen")
        if len(intent) < INTENT_MIN_CHARS:
            found.append(f"shots[{i}].intent is {len(intent)} characters; state the shot's narrative duty in at least "
                         f"{INTENT_MIN_CHARS} (what changes for the audience or a character, and why here)")

    role_warnings.extend(_story_craft_warnings(data, beats, units))
    if narrative:
        return found, role_warnings + _story_repetition_warnings(data, beats, speakers)
    fmt = plan_format(data)
    return [], role_warnings + [f"{m} (format={fmt}: advisory)" for m in found] + _story_repetition_warnings(data, beats, speakers)


# Two texts this close (after dropping punctuation and spaces) are the same sentence reused,
# not two beats, characters or shots written for themselves.
STORY_REPEAT_RATIO = 0.85


def _story_text_key(value: str) -> str:
    return re.sub(r"[\W_]+", "", value)


def _cast_mentioned(text: str, member: dict) -> bool:
    """Names or exact ids count; a short ASCII id inside another word does not."""
    for alias in (member.get("id"), member.get("name")):
        if isinstance(alias, str) and alias.strip():
            token = re.escape(alias.strip())
            if alias.isascii():
                token = rf"(?<![A-Za-z0-9_]){token}(?![A-Za-z0-9_])"
            if re.search(token, text, re.IGNORECASE):
                return True
    return False


def _story_craft_warnings(data: dict, beats: list[dict], units: list[dict]) -> list[str]:
    """T14–T17 supplement the existing story checks, entirely as advisories."""
    warnings = []
    cast = {c["id"]: c for c in data.get("cast") or []
            if isinstance(c, dict) and isinstance(c.get("id"), str) and c["id"]}
    beat_by_id = {b["id"]: b for b in beats if isinstance(b.get("id"), str)}
    narrative = is_narrative(data)

    def filled(value):
        return isinstance(value, str) and bool(value.strip())

    def warn(message):
        warnings.append(message + " (advisory)")

    pairs = set()
    relationships = data.get("relationships")
    if relationships is not None and not isinstance(relationships, list):
        warn("T14 relationships 必须是核心关系对象数组")
    for i, relation in enumerate(relationships if isinstance(relationships, list) else []):
        where = f"T14 relationships[{i}]"
        if not isinstance(relation, dict):
            warn(f"{where} 必须是关系对象")
            continue
        a, b = relation.get("a"), relation.get("b")
        valid_pair = isinstance(a, str) and isinstance(b, str) and a in cast and b in cast and a != b
        if not valid_pair:
            warn(f"{where}.a/b 必须是两个不同的已声明 cast_id")
        else:
            pairs.add(frozenset((a, b)))
        for field in ("a_wants", "b_wants", "why_exclusive", "a_fears", "b_fears", "end_change"):
            if not filled(relation.get(field)):
                warn(f"{where}.{field} 必须是非空文本")
        if filled(relation.get("a_wants")) and filled(relation.get("b_wants")):
            if _story_text_key(relation["a_wants"]).casefold() == _story_text_key(relation["b_wants"]).casefold():
                warn(f"{where}.a_wants 与 b_wants 文本相同；分别写两人的诉求")
        if valid_pair and not all(_cast_mentioned(str(relation.get("why_exclusive") or ""), cast[cid])
                                  for cid in (a, b)):
            warn(f"{where}.why_exclusive 须同时提到 {a} 与 {b}（名字或 ID），说明为何不能同时满足")
    if narrative:
        protagonists = [cid for cid, c in cast.items() if c.get("role_type") == "protagonist"]
        partners = [cid for cid, c in cast.items() if c.get("role_type") in ("supporting", "antagonist")]
        if partners and not protagonists:
            warn("T14 请标明 protagonist，建立主角与每个 supporting/antagonist 的核心关系四问")
        for a in protagonists:
            for b in partners:
                if frozenset((a, b)) not in pairs:
                    warn(f"T14 relationships 缺少主角 {a} 与 {b} 的核心关系四问")
        for cid, member in cast.items():
            if member.get("role_type") == "antagonist" and not filled(member.get("justification")):
                warn(f"T14 cast[{cid}].justification 缺失；写他为什么认为自己是对的")

    speaking = set()
    for i, beat in enumerate(beats):
        present_speakers = set()
        for unit in units:
            if unit.get("beat") != beat.get("id"):
                continue
            lines = list(unit.get("dialogue") or [])
            lines += [b["line"] for b in unit.get("blocks") or [] if isinstance(b, dict)
                      and isinstance(b.get("line"), dict) and b["line"].get("kind", "dialogue") == "dialogue"]
            names = {line.get("speaker") for line in lines if isinstance(line, dict)
                     and isinstance(line.get("speaker"), str)}
            speaking.update(cid for cid, c in cast.items()
                            if any(alias in names for alias in (cid, c.get("name")) if isinstance(alias, str)))
            present_speakers.update(cid for cid in unit.get("character_ids") or []
                                    if isinstance(cid, str) and cid in cast
                                    and any(alias in names for alias in (cid, cast[cid].get("name"))
                                            if isinstance(alias, str)))
        where = f"T15 beats[{i}]"
        goals = beat.get("goals")
        if not isinstance(goals, dict) or not goals:
            warn(f"{where}.goals 为空；按 cast_id 写本场目标")
            goals = {}
        for cid, goal in goals.items():
            if cid not in cast or not filled(goal):
                warn(f"{where}.goals[{cid}] 须对应已声明角色且是非空本场目标")
        for cid in sorted(present_speakers):
            if not filled(goals.get(cid)):
                warn(f"{where}.goals 缺少在场说话角色 {cid} 的本场目标")
        seen = {}
        for cid in sorted(present_speakers):
            if not filled(goals.get(cid)):
                continue
            key = _story_text_key(goals[cid]).casefold()
            if key in seen:
                warn(f"{where}.goals[{cid}] 与 {seen[key]} 文本相同；在场说话角色的目标须不同")
            seen[key] = cid
        if not filled(beat.get("info_gap")):
            warn(f"{where}.info_gap 缺失；一句话写谁知道什么、谁不知道")

    for cid, member in cast.items():
        if member.get("kind") in SPEAKING_EXEMPT_KINDS or member.get("role_type") == "extra":
            continue
        if member.get("role_type") not in ("protagonist", "supporting", "antagonist") and cid not in speaking:
            continue
        motivation = member.get("motivation") if isinstance(member.get("motivation"), dict) else {}
        bid = motivation.get("flaw_beat")
        if not filled(bid):
            warn(f"T16 cast[{cid}].motivation.flaw_beat 缺失；绑定缺点导致坏选择的 beat id")
        elif bid not in beat_by_id:
            warn(f"T16 cast[{cid}].motivation.flaw_beat={bid!r} 不是已声明 beat id")
        else:
            beat = beat_by_id[bid]
            if not _cast_mentioned("\n".join(str(beat.get(k) or "") for k in ("action", "cause")), member):
                warn(f"T16 beat {bid} 的 action/cause 未提到 {cid}（名字或 ID）；写清该缺点导致的坏选择")

    nexus = data.get("nexus")
    if nexus is None:
        if narrative:
            warn("T17 建议标出三层冲突交汇点 nexus{beat,choice,prop_id?}")
    elif not isinstance(nexus, dict):
        warn("T17 nexus 必须是 {beat,choice,prop_id?} 对象")
    else:
        if not isinstance(nexus.get("beat"), str) or nexus["beat"] not in beat_by_id:
            warn("T17 nexus.beat 须引用已声明 beat id")
        if not filled(nexus.get("choice")):
            warn("T17 nexus.choice 须写交汇点的具体选择")
        props = {p["id"] for p in data.get("props") or [] if isinstance(p, dict) and isinstance(p.get("id"), str)}
        if "prop_id" in nexus and (not isinstance(nexus["prop_id"], str) or nexus["prop_id"] not in props):
            warn("T17 nexus.prop_id 须引用已声明道具；有效绑定自动 critical/requires_visual_lock")
    return warnings


def _story_repeats(items: list[tuple[str, str, str]]) -> list[str]:
    """items: (label, group, text). Pairs in the same group are allowed to be close."""
    from difflib import SequenceMatcher
    notes: list[str] = []
    for a in range(len(items)):
        for b in range(a + 1, len(items)):
            (la, ga, ta), (lb, gb, tb) = items[a], items[b]
            if ga and ga == gb:
                continue
            ka, kb = _story_text_key(ta), _story_text_key(tb)
            if ka and kb and (ka == kb or SequenceMatcher(None, ka, kb).ratio() >= STORY_REPEAT_RATIO):
                notes.append(f"{lb} repeats {la} almost word for word; write what is specific to it")
                break
    return notes


def _story_repetition_warnings(data: dict, beats: list[dict], speakers: set[str]) -> list[str]:
    """The story fields only work if each beat, character and shot is written for itself."""
    notes: list[str] = []
    for key in ("stake", "hook"):
        notes += _story_repeats([(f"beats[{i}].{key}", "", b[key]) for i, b in enumerate(beats)
                                 if isinstance(b.get(key), str) and b[key].strip()])
    cast = [c for c in data.get("cast") or [] if isinstance(c, dict)
            and str(c.get("kind") or "") not in SPEAKING_EXEMPT_KINDS
            and ({str(c.get(k) or "").strip() for k in ("id", "name")} & speakers)]
    for key in ("want", "need", "flaw"):
        notes += _story_repeats([(f"cast[{c.get('name') or c.get('id')}].motivation.{key}", "",
                                  c["motivation"][key]) for c in cast
                                 if isinstance(c.get("motivation"), dict)
                                 and isinstance(c["motivation"].get(key), str) and c["motivation"][key].strip()])
    shots = data.get("shots") or []
    notes += _story_repeats([(f"shots[{i}].intent", str(s.get("beat") or ""), s["intent"]) for i, s in enumerate(shots)
                             if isinstance(s, dict) and isinstance(s.get("intent"), str) and s["intent"].strip()])
    return notes


def _validate_plan_structure(data: dict) -> tuple[list[str], list[str], float | None]:
    'validate plan structure and the directing/state contract.'
    errors: list[str] = []
    warnings: list[str] = []
    if "schema_version" not in data and "version" in data:
        # A plan written with `version` would silently validate as legacy v1, which generation refuses.
        return ["the plan version field is schema_version (got `version`); set schema_version to 2, 3 or 4"], [], None
    version = data.get("schema_version", 1)
    if version not in (1, 2, 3, 4, "1", "2", "3", "4") or isinstance(version, bool):
        return ["schema_version must be 1, 2, 3 or 4"], [], None
    if str(version) == "1":
        return [], ["Legacy shotlist: no directing/state contract; use schema_version=4 for new runs. "
                    "video_generate and creation review accept only schema_version 2, 3 or 4."], None
    serial = str(version) in ("3", "4")
    v4 = str(version) == "4"
    # 1012 片型: 单集规矩只管 episode, 剧情片规矩只管 drama/film/episode (见 plan_format)
    fmt = plan_format(data)
    episode_fmt = fmt == EPISODE_FORMAT
    narrative = fmt in NARRATIVE_FORMATS
    _raw_fmt = data.get("format")
    if _raw_fmt is not None and (not isinstance(_raw_fmt, str) or not _raw_fmt.strip()):
        errors.append(f"format must be a non-empty string (got {type(_raw_fmt).__name__}); omit it for the "
                      "default (film)")
    elif isinstance(_raw_fmt, str) and fmt not in KNOWN_FORMATS:
        warnings.append(f"format={fmt!r} is not one of {sorted(KNOWN_FORMATS)} — free-text formats are allowed, "
                        "but note that any value outside drama/film/episode turns the narrative rules "
                        "(no narration, causal beats, per-shot directing fields, world-state ledger) into "
                        "advisories; check for a typo if you meant a narrative film")

    for target_key in ("target_duration_seconds", "target_seconds"):
        if target_key in data and (number(data[target_key]) is None or number(data[target_key]) <= 0):
            errors.append(f"{target_key} must be positive and finite")
    if "target_range_seconds" in data:
        rng = data["target_range_seconds"]
        if not isinstance(rng, list) or len(rng) != 2 or any(number(v) is None for v in rng) or not 0 < number(rng[0]) <= number(rng[1]):
            errors.append("target_range_seconds must be [positive lower, upper >= lower]")

    # shadow P1-5: lighting_dna 按官方光影技能写全, 不接受短标签 (dict=十三字段 / str=整段)
    _ldna = data.get("lighting_dna")
    if isinstance(_ldna, dict):
        for _col in ("key_light", "palette", "continuity_lock"):
            if not str(_ldna.get(_col) or "").strip():
                warnings.append(f"lighting_dna.{_col} 为空——十三字段结构至少写 key_light/palette/continuity_lock "
                                "(官方分镜光影技能) (advisory)")
    elif isinstance(_ldna, str) and _ldna.strip() and (
            len(_ldna.strip()) < 24 or ("，" not in _ldna and "," not in _ldna)):
        warnings.append("lighting_dna 过短——写全光影 DNA（主光/辅光/轮廓光/阴影/色板/空气感/一致性锁定），"
                        "禁止'蓝调夜景、低调光'式短标签 (官方分镜光影技能) (advisory)")

    def text(value: Any, where: str) -> None:
        if not isinstance(value, str) or not value.strip():
            errors.append(f"{where} must be non-empty text")

    def texts(value: Any, where: str, allow_empty: bool = False) -> None:
        if not isinstance(value, list) or (not value and not allow_empty):
            errors.append(f"{where} must be {'an' if allow_empty else 'a non-empty'} array of strings")
        elif any(not isinstance(v, str) or not v.strip() for v in value):
            errors.append(f"{where} contains empty/non-text items")

    def soft(message: str) -> None:
        """剧情片型里是 error; 其他片型降为提醒 (仍提示, 不拦)。"""
        (errors if narrative else warnings).append(
            message if narrative else f"{message} (format={fmt}: advisory)")

    def text_soft(value: Any, where: str) -> None:
        if not isinstance(value, str) or not value.strip():
            soft(f"{where} must be non-empty text")

    def texts_soft(value: Any, where: str, allow_empty: bool = False) -> None:
        if not isinstance(value, list) or (not value and not allow_empty):
            soft(f"{where} must be {'an' if allow_empty else 'a non-empty'} array of strings")
        elif any(not isinstance(v, str) or not v.strip() for v in value):
            soft(f"{where} contains empty/non-text items")

    scenes = {s.get("id"): s for s in data.get("scenes", []) if isinstance(s, dict)}
    used_scene_ids = set()
    for u in (data.get("sequences") or []) + (data.get("shots") or []):
        if isinstance(u, dict) and isinstance(u.get("scene_id"), str):
            used_scene_ids.add(u["scene_id"])
    for sid in sorted(used_scene_ids):
        sc = scenes.get(sid)
        if sc is not None and not str(sc.get("image") or "").strip():
            warnings.append(f"scenes[{sid}].image: 出场场景缺参考图——至少 1 张说明空间/时代/氛围/关键方位 "
                            "(官方分镜技能要求; 纯文生场景跨镜头易漂移) (advisory)")
    evo = data.get("scene_evolution")
    if isinstance(evo, list):
        for i, row in enumerate(evo):
            if not isinstance(row, dict):
                continue
            esid = str(row.get("scene_id") or "").strip()
            if not esid:
                warnings.append(f"scene_evolution[{i}].scene_id 为空 (advisory)")
                continue
            if esid not in scenes:
                warnings.append(f"scene_evolution[{i}].scene_id '{esid}' 不在 scenes[] 中 (advisory)")
            for col in ("phase", "情绪任务", "光影色彩", "材质与状态变化"):
                if not str(row.get(col) or "").strip():
                    warnings.append(f"scene_evolution[{i}](scene {esid}).{col} 为空——演变账每行需写清阶段与状态变化 (advisory)")
    for sid, scene in scenes.items():
        if not v4:  # v4 removes scene intent/spatial_anchors
            text_soft(scene.get("intent"), f"scenes[{sid}].intent")
            texts_soft(scene.get("spatial_anchors"), f"scenes[{sid}].spatial_anchors")
    beats: dict[str, dict] = {}
    raw_beats = data.get("beats")
    if not isinstance(raw_beats, list) or not raw_beats:
        errors.append("beats must be a non-empty array of directing beats")
        raw_beats = []
    for i, beat in enumerate(raw_beats):
        where = f"beats[{i}]"
        if not isinstance(beat, dict):
            errors.append(f"{where} must be an object")
            continue
        bid = beat.get("id")
        text(bid, f"{where}.id")
        if isinstance(bid, str):
            if bid in beats:
                errors.append(f"{where}.id duplicates {bid}")
            beats[bid] = beat
        if beat.get("scene_id") not in scenes and not v4:
            soft(f"{where}.scene_id is not a declared scene")
        if not v4 and narrative:  # v4 makes cause/action/result optional; non-narrative formats skip them
            for key in ("cause", "action", "result", "audience_before", "audience_after"):
                text(beat.get(key), f"{where}.{key}")
        texts(beat.get("required_visuals"), f"{where}.required_visuals")
        _rc = str(beat.get("relationship_change") or "").strip()
        if _rc and _rc not in ("变好", "变坏", "不变", "不明确"):
            warnings.append(f"{where}.relationship_change={_rc!r} 应为 变好/变坏/不变/不明确 (关系弧节点标注) (advisory)")
        if serial:
            if episode_fmt and beat.get("function") not in BEAT_FUNCTIONS:
                errors.append(f"{where}.function must be one of {BEAT_FUNCTIONS}")
            window = beat.get("time_window")
            start, end = (number(w) for w in window) if isinstance(window, list) and len(window) == 2 else (None, None)
            if window is not None and (start is None or end is None or start < 0 or end <= start):
                errors.append(f"{where}.time_window must be [start, end] seconds with 0 <= start < end")
    ordered_beats = [b for b in raw_beats if isinstance(b, dict)]
    if episode_fmt and ordered_beats:
        functions = [b.get("function") for b in ordered_beats]
        if functions[0] != "hook":
            errors.append("the first beat of an episode must be function=hook (the 0-3s conflict opener)")
        if functions[-1] != "cliffhanger":
            errors.append("the last beat of an episode must be function=cliffhanger (the end hook)")
        for j, f in enumerate(functions[1:-1], 1):
            if f not in ("escalation", "payoff"):
                errors.append(f"beats[{j}].function must be escalation or payoff between hook and cliffhanger")
    if episode_fmt:
        episode = data.get("episode")
        if not isinstance(episode, dict):
            errors.append("episode shotlists declare episode {ep_no, target_seconds}")
        else:
            ep_no = episode.get("ep_no")
            if not isinstance(ep_no, int) or isinstance(ep_no, bool) or ep_no < 1:
                errors.append("episode.ep_no must be a positive integer")
            target = number(episode.get("target_seconds"))
            if target is None or target <= 0:
                errors.append("episode.target_seconds must be positive and finite")

    # shadow P1-1: unit.shot_power 镜头权重 (低/中/高) — 钩子/反转/爽点场次建议高权重
    _POWER = {"低", "中", "高", "low", "mid", "high"}
    for _i, _u in enumerate((data.get("sequences") or []) + (data.get("shots") or [])):
        if not isinstance(_u, dict):
            continue
        _sp = str(_u.get("shot_power") or "").strip()
        if _sp and _sp not in _POWER:
            warnings.append(f"unit[{_i}].shot_power={_sp!r} 应为 低/中/高 (advisory)")
        _b = resolved_beat(data, _u) if isinstance(_u, dict) else {}
        if isinstance(_b, dict) and str(_b.get("function") or "") in ("hook", "cliffhanger", "payoff") \
                and _sp in ("", "低", "low"):
            warnings.append(f"unit[{_i}].shot_power: 该单元的 beat 是钩子/回收/悬念落点，建议 shot_power 高"
                            "（更多镜头密度与特写强调；功能性转场才降权） (advisory)")

    # 音色: TTS 只有固定预置音色 (cast.voice), 不再有克隆种子; voice_card 为该音色的样本
    for i, member in enumerate(data.get("cast") or []):
        if isinstance(member, dict) and member.get("voice_seed"):
            warnings.append(f"cast[{i}].voice_seed is no longer used — set cast.voice to a "
                            "preset voice id and point voice_card at a sample in that voice")

    # T03: handheld plot props belong to prop assets; attached identity accessories stay.
    for i, member in enumerate(data.get("cast") or []):
        if not isinstance(member, dict):
            continue
        for field in ("appearance", "sheet_prompt"):
            handheld = False
            for clause in re.split(r"[，,。.;；\n]", str(member.get(field) or "")):
                for match in re.finditer(r"手持|手握|握着|拿着|捧着|\b(?:hand[- ]?held|holding|holds?)\b",
                                         clause, re.IGNORECASE):
                    if re.search(r"(?:不(?:再|要|应)?|未|无|勿|禁止|不得|无需|without|no|not)\s*$",
                                 clause[:match.start()], re.IGNORECASE):
                        continue
                    if re.match(r"\s*(?:一副|一枚|固定的?|标志性的?|随身的?)*"
                                r"(?:眼镜|发饰|耳饰|项链|腕表|手表|glasses\b|hair accessory\b|watch\b)",
                                clause[match.end():], re.IGNORECASE):
                        continue
                    handheld = True
                    break
                if handheld:
                    break
            if handheld:
                warnings.append(f"cast[{i}].{field}: 手持剧情道具默认移到道具资产，不放入角色三视图；"
                                "眼镜、发饰、固定随身物等固有配饰保留 (advisory)")

    # ---- ⑦ 通用 bindings: 声明过的实体间关系, 同框时必须显式绑定 (零题材先验) ----
    # 管线不认识龙/马/骑乘——只执行「声明过的关系, 同框缺绑定短语报 error」。骑乘/
    # 怀抱/押运/持有/人宠同一槽位全体受益。note 进验片期望, 错配可被核对抓出。
    _ent_ids = ({c.get("id") for c in data.get("cast", []) if isinstance(c, dict) and c.get("id")}
                | {p.get("id") for p in data.get("props", []) if isinstance(p, dict) and p.get("id")})
    binding_rows: list[dict] = []
    _bindings = data.get("bindings")
    if _bindings is not None:
        if not isinstance(_bindings, list):
            errors.append("bindings must be an array of {a, b, phrase, note}")
        else:
            for j, b in enumerate(_bindings):
                if (not isinstance(b, dict) or not str(b.get("a") or "").strip()
                        or not str(b.get("b") or "").strip() or not str(b.get("phrase") or "").strip()):
                    errors.append(f"bindings[{j}] must be an object with a, b and phrase "
                                  "(a/b = declared cast or prop ids; phrase = 同框时 prompt 必须包含的绑定短语)")
                    continue
                if b.get("a") not in _ent_ids or b.get("b") not in _ent_ids:
                    errors.append(f"bindings[{j}]: a={b.get('a')!r}/b={b.get('b')!r} must reference "
                                  "declared cast or prop ids")
                    continue
                if not str(b.get("note") or "").strip():
                    warnings.append(f"bindings[{j}] has no note — one line saying what the relation is "
                                    "(the verifier reads it to check 谁骑谁/谁抱着谁)")
                binding_rows.append(b)

    # ---- v4: multi-shot sequences replace shots ----
    # generator capability profile (plan.generator pins it; else the process's active generator)
    from ve_tools.generators import plan_profile as _plan_profile
    _gprof = _plan_profile(data)
    _gmax = int(_gprof["max_seconds"])
    if v4:
        sequences = data.get("sequences", [])
        seq_ids: set[str] = set()
        used_beats_v4: set[str] = set()
        screen_total = 0.0
        for i, seq in enumerate(sequences if isinstance(sequences, list) else []):
            if not isinstance(seq, dict):
                errors.append(f"sequences[{i}] must be an object")
                continue
            where = f"sequences[{i}]"
            _vo_e, _vo_w = voiceover_issues(seq, where, narrative)
            errors.extend(_vo_e)
            warnings.extend(_vo_w)
            sid = seq.get("sequence_id")
            text(sid, f"{where}.sequence_id")
            try:
                safe_unit_id(sid)
            except ValueError as exc:
                errors.append(f'{where}.sequence_id: {exc}')
            if isinstance(sid, str):
                if sid in seq_ids:
                    errors.append(f"{where}.sequence_id duplicates {sid}")
                seq_ids.add(sid)
            bid = seq.get("beat")
            if not isinstance(bid, str) or bid not in beats:
                errors.append(f"{where}.beat must reference a beat id")
            else:
                used_beats_v4.add(bid)
            duration = number(seq.get("duration"))
            # 硬下限只取生成器自己的下限 (min_seconds, 全档 4s); 原先 2.5 档硬卡 8s 是多镜头
            # 剧情序列的经验, 15-30s 广告的单镜、鬼畜的短素材会被逼着多生成一倍 -> 降为提醒 (1012)
            dmin = int(_gprof.get("min_seconds") or 4)
            # T23: recommended <=15s; a continuous one-shot escape route up to 30s
            # must be bound to a generator with _gmax>=30 (currently Seedance 2.5).
            if duration is None or duration < dmin:
                errors.append(f"{where}.duration must be {dmin}-{min(_gmax, 30)} seconds per sequence")
            elif duration > 30:
                errors.append(f"{where}.duration={duration:g}s exceeds 30s — no model supports >30s; "
                              "30s 是模型能力上限，不是项目策略")
            elif duration > 15 and _gmax < 30:
                errors.append(f"{where}.duration={duration:g}s: 15s < d <= 30s 的一镜到底单元必须绑定 "
                              f"_gmax>=30 的生成器 (Seedance 2.5 / video-v2.5 的 30s 档)；"
                              f"当前 {_gprof['name']} 最多 {_gmax}s，拆成 <=15s 单元或绑定 2.5")
            elif duration > _gmax:
                errors.append(f"{where}.duration must be {dmin}-{_gmax} seconds per sequence"
                              + (f" — {_gprof['name']} generates at most {_gmax}s per request; split the sequence at a "
                                 "Shot boundary into two sequences (continuity_from the first)" if _gmax < 30 else ""))
            elif duration > 15:
                block_count = len(seq.get("blocks")) if isinstance(seq.get("blocks"), list) else 0
                prompt_cuts = len(re.findall(r"\bShot\s+\d+\s*[（(]", str(seq.get("prompt") or "")))
                if max(block_count, prompt_cuts) > 1:
                    warnings.append(f"T23 {where}: 推荐单元 <=15s；15-30s 通道用于一镜到底的连续镜头，"
                                    "多镜头单元请考虑按镜头拆分 (advisory)")
            elif _gmax >= 30 and duration < 8 and "Shot" in str(seq.get("prompt") or ""):
                warnings.append(f"{where}.duration={duration:g}s with Shot blocks — a multi-shot request under 8s "
                                "leaves each block very little time; fine for a single beat, merge or lengthen otherwise")
            sd = number(seq.get("screen_duration"))
            if sd is None or sd <= 0:
                errors.append(f"{where}.screen_duration must be positive")
            else:
                screen_total += sd
                if duration is not None and sd > duration:
                    warnings.append(f"{where}: screen_duration exceeds duration; the trim will clip the sequence")
            if seq.get("scene_id") not in scenes:
                errors.append(f"{where}.scene_id is not a declared scene")
            for cid in seq.get("character_ids") or []:
                if cid not in {c.get("id") for c in data.get("cast", []) if isinstance(c, dict)}:
                    errors.append(f"{where}.character_ids has unknown id {cid!r}")
            prompt = str(seq.get("prompt") or "")
            if not prompt.strip():
                errors.append(f"{where}.prompt is required (the full Shot N text)")
            elif "Shot" not in prompt and len(sequences) > 0:
                # single-shot sequences don't need Shot N, but warn if multi-shot was intended
                if seq.get("character_ids") and len(seq.get("character_ids")) > 1:
                    warnings.append(f"{where}: multi-character sequence without Shot N blocks may flatten cuts")
            # dialogue
            for j, line in enumerate(seq.get("dialogue") or []):
                if not isinstance(line, dict):
                    errors.append(f"{where}.dialogue[{j}] must be an object")
                    continue
                speaker = str(line.get("speaker") or "").strip()
                if not speaker:
                    errors.append(f"{where}.dialogue[{j}].speaker is required")
            # Shot 时间戳连续性 (官方: 区间必须连续覆盖序列全长, 禁跳轴)。
            # 编译器可能写出小数秒 ({a:g}); 正则随之认小数, 校验不再静默失效;
            # 小数秒本身另由取整提醒处理 (官方只响应整数秒)。
            import re as _re
            spans = [(int(n), float(a), float(b)) for n, a, b in
                     _re.findall(r"Shot (\d+) \((\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)s\)", prompt)]
            if spans:
                if spans[0][1] != 0:
                    warnings.append(f"{where}: Shot timestamps should start at 0s (got {spans[0][1]:g}s)")
                for (n1, a1, b1), (n2, a2, b2) in zip(spans, spans[1:]):
                    if abs(a2 - b1) > 1e-6:
                        warnings.append(f"{where}: Shot timestamps jump {b1:g}s->{a2:g}s — must be continuous (official)")
                if duration is not None and abs(spans[-1][2] - duration) > 1e-6:
                    warnings.append(f"{where}: Shot timestamps end at {spans[-1][2]:g}s but duration={duration:g} — sum must equal the request")
                _fractional = [(a, b) for _, a, b in spans if a != int(a) or b != int(b)]
                if _fractional:
                    warnings.append(f"{where}: Shot timestamps {', '.join(f'{a:g}-{b:g}s' for a, b in _fractional)} "
                                    "are not whole seconds — the official guide works in whole seconds "
                                    "(Seedance 2.5 响应整数秒的时间戳); round the block start/end in the plan")
            # 台词后追加描述诱发字幕 (官方 FAQ) — {} 之后同行还有文字
            for _ln in prompt.split("\n"):
                _di = _ln.find("}")
                if _di >= 0 and _ln[_di:].strip() != "}":
                    warnings.append(f"{where}: text after {{}} on a Shot line — official FAQ: trailing descriptions after dialogue trigger subtitles")
                    break
            # Shot 块密度 (官方: 以 1 秒为单位、内容过多→过度剪切; 段数上限只是社区经验)
            if len(spans) >= 3 and len({round(b - a, 6) for _, a, b in spans}) == 1:
                warnings.append(f"{where}: all {len(spans)} Shot blocks are {spans[0][2] - spans[0][1]:g}s — equal-length cuts read as a "
                                "slideshow (真人短剧 12 集: 「每个镜头都是 5 秒会显得非常无趣」); vary them (e.g. 6/3/5)")
            _blocks_for_fn = seq.get("blocks") if isinstance(seq.get("blocks"), list) else []
            for k, (n, a, b) in enumerate(spans, 1):
                fn = ""
                if 0 < n <= len(_blocks_for_fn) and isinstance(_blocks_for_fn[n - 1], dict):
                    fn = str(_blocks_for_fn[n - 1].get("function") or "").strip()
                floor = SHOT_REACTION_MIN_SECONDS if fn == "反应" else SHOT_MIN_SECONDS
                if 0 < b - a < floor - 1e-6:
                    _why = ("reaction blocks ride the official 0.8-1.5s band, which is 1s on whole-second "
                            "timestamps" if fn == "反应" else
                            "the official guide works in whole seconds and a block carrying too much gets over-cut; "
                            "a 2s block holds one reaction or one short line")
                    warnings.append(f"{where}: Shot {k} spans only {b - a:g}s — keep {'reaction' if fn == '反应' else 'non-reaction'} "
                                    f"blocks >={floor:g}s: {_why}")
            if len(spans) > SHOTS_PER_30S_MAX:
                warnings.append(f"{where}: reminder — {len(spans)} Shot blocks in one request. Not an official limit (community "
                                f"experience puts the comfortable range at up to {SHOTS_PER_30S_MAX}); fine if every block is light "
                                "(one action or one line), split the sequence if blocks carry action and dialogue together")
            # 逐 Shot 块: 台词装不装得下 / 说话人有没有嘴 (video generator 2.5 照字面执行)
            _mblocks = list(_re.finditer(r"Shot (\d+) \((\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)s\)", prompt))
            for _bi, _m in enumerate(_mblocks):
                _body = prompt[_m.end():(_mblocks[_bi + 1].start() if _bi + 1 < len(_mblocks) else len(prompt))]
                _tail = _re.search(r"\n(参考图说明|音频说明|补充说明|尺度|画幅|人物为|不要字幕|无BGM|承接状态)", _body)
                if _tail:
                    _body = _body[:_tail.start()]
                _span = float(_m.group(3)) - float(_m.group(2))
                _lines = _re.findall(r"\{([^}]*)\}", _body)
                if not _lines:
                    continue
                _chars = len(_re.findall(r"[一-鿿]", "".join(_lines)))
                _secs = _chars / SPEECH_CHARS_PER_SECOND
                if _span > 0 and _secs > _span + 0.5:
                    warnings.append(f"{where}: Shot {_m.group(1)} carries {_chars} chars (~{_secs:.1f}s of speech) in a {_span}s "
                                    "block — the line will be cut off or rushed; lengthen the block or split the line")
                _back = [mk for mk in BACK_FACING_MARKERS if mk in _body]
                if _back and "过肩" not in _body:
                    warnings.append(f"{where}: Shot {_m.group(1)} has a spoken line but writes someone as {_back} — video generator 2.5 "
                                    "executes that literally and the speaker ends up talking with no visible mouth (DramaChain "
                                    "lip sync depends on visible speaker evidence). Keep the speaker's face or profile on screen; a back view belongs "
                                    "to the listener (过肩)")
            # 每说话人人声下限 (一人一音频文件; 低于 3s 声纹不可判、模型无锚 — 计划期改字不需要重新生成)
            speech_chars: dict[str, int] = {}
            for line in seq.get("dialogue") or []:
                if isinstance(line, dict) and str(line.get("speaker") or "").strip():
                    spk = str(line["speaker"]).strip()
                    speech_chars[spk] = speech_chars.get(spk, 0) + len(str(line.get("line") or "").strip())
            # 参考音频路数 / 总时长 (生成器能力档案): 每说话人一路, 片内内心独白再占一路
            _n_voiced = len(speech_chars) + (1 if isinstance(seq.get("narration"), dict) and seq["narration"].get("line") else 0)
            if _n_voiced > _gprof["max_audio"]:
                errors.append(f"{where}: {_n_voiced} voices (speakers + in-clip inner monologue) but {_gprof['name']} takes at most "
                              f"{_gprof['max_audio']} reference audios per request — split the sequence or merge two speakers' lines into one file")
            _est_audio = sum(speech_chars.values()) / SPEECH_CHARS_PER_SECOND
            if _est_audio > _gprof["max_audio_seconds"] * 0.9:
                warnings.append(f"{where}: lines total ~{_est_audio:.1f}s of speech; {_gprof['name']} caps reference audio at "
                                f"{_gprof['max_audio_seconds']:g}s per request — shorten lines or split the sequence")
            for spk, n_chars in speech_chars.items():
                secs = n_chars / SPEECH_CHARS_PER_SECOND
                if n_chars and secs < VOICE_MIN_SPEECH_SECONDS - 1e-6:
                    warnings.append(f"{where}: {spk} speaks {n_chars} chars (~{secs:.1f}s) — under the {VOICE_MIN_SPEECH_SECONDS:.0f}s a voice "
                                    "verdict needs (thin evidence needs listening or a longer speech sample). "
                                    "Give this speaker a longer exchange in this sequence")
            # 光位 / 风向 (参考图不带光向与风向, 每次生成都得自己写; 室内不追问风向)
            _scene_obj = scenes.get(seq.get("scene_id")) or {}
            _scene_text = " ".join(str(_scene_obj.get(k) or "") for k in ("name", "location", "title", "prompt", "plate_prompt"))
            if not any(m in prompt for m in LIGHT_MARKERS):
                warnings.append(f"{where}.prompt states no key-light direction (窗在左/主光从上方来…) — a reference image "
                                "does not carry it (2026-09-21 controlled experiment: key light flipped 180°)")
            _indoor = any(m in prompt for m in INDOOR_MARKERS) or any(m in _scene_text for m in INDOOR_MARKERS)
            _p_wind = prompt.replace("风格", "")   # 六步法总览句必带「…风格」, 不算风向
            if not _indoor and not any(m in _p_wind for m in WIND_MARKERS):
                warnings.append(f"{where}.prompt is an exterior with no wind stated (无风 counts) — the reference does not carry it")
            # 关键帧参考 (可选): 站位复杂的序列先出静帧, 生成时按官方多关键帧形式挂上
            kfs = seq.get("keyframes")
            if kfs is not None:
                if not isinstance(kfs, list) or not all(isinstance(k, (str, dict)) for k in kfs):
                    errors.append(f"{where}.keyframes must be a list of image paths (or {{shot, image}} objects)")
                else:
                    n_obj = sum(1 for k in kfs if isinstance(k, dict))
                    if 0 < n_obj < len(kfs):
                        errors.append(f"{where}.keyframes mixes path strings and {{shot, image}} objects — pick ONE form: "
                                      "{shot, image} when coverage is sparse (each image declares the Shot it starts), "
                                      "plain paths when the keyframes cover the Shots in order")
                    elif n_obj:
                        # {shot, image} 形式: shot 必须落在本序列 Shot 块序号内, 不重不越
                        n_shots = len(spans)
                        seen_shots: set[int] = set()
                        for j, k in enumerate(kfs):
                            m = k.get("shot")
                            if not str(k.get("image") or "").strip():
                                errors.append(f"{where}.keyframes[{j}].image must be an image path")
                            if not isinstance(m, int) or isinstance(m, bool):
                                errors.append(f"{where}.keyframes[{j}].shot must be an integer Shot number")
                                continue
                            if m < 1 or not n_shots or m > n_shots:
                                errors.append(f"{where}.keyframes[{j}].shot={m} is outside this sequence's Shot blocks"
                                              + (f" (1-{n_shots})" if n_shots
                                                 else " (no Shot N (a-bs) blocks found in the prompt)"))
                            elif m in seen_shots:
                                errors.append(f"{where}.keyframes[{j}].shot={m} is already claimed by an earlier "
                                              "keyframe — at most one image per Shot")
                            else:
                                seen_shots.add(m)
                    if len(kfs) > KEYFRAMES_MAX_PER_SEQUENCE:
                        warnings.append(f"{where}: {len(kfs)} keyframes — keep it to the staging-critical Shots (official: "
                                        "storyboard frames constrain the model; <=15 per request)")
                    if spans and len(kfs) > len(spans):
                        warnings.append(f"{where}: {len(kfs)} keyframes for {len(spans)} Shot blocks — at most one per Shot")
                    n_chars = len(seq.get("character_ids") or [])
                    if n_chars <= 2 and not any(w in prompt for w in ("道具", "桌", "门", "车", "台", "楼梯")):
                        warnings.append(f"{where}: keyframes on a <=2-character sequence with no named prop/space anchor — "
                                        "cards usually suffice; keyframes are for 3+ people, props that must be in frame, "
                                        "or spatial relations that matter")
            # 序列间世界引用: 上一段末帧作场景/光影参考 (官方「参考图片 N 的光影」松档)
            cf = seq.get("continuity_from")
            if cf is not None:
                earlier = {s.get("sequence_id"): s for s in sequences[:i] if isinstance(s, dict)}
                if not isinstance(cf, str) or cf not in earlier:
                    errors.append(f"{where}.continuity_from={cf!r} must name an EARLIER sequence_id (the upstream clip has to exist first)")
                elif earlier[cf].get("scene_id") != seq.get("scene_id"):
                    warnings.append(f"{where}.continuity_from={cf} is in another scene ({earlier[cf].get('scene_id')}) — a scene change is "
                                    "normally a hard cut; only keep this if the world genuinely continues (e.g. walking out of the same door)")
            # ⑦ bindings 硬闸 (error): 声明关系的两实体同框而 prompt 缺绑定短语
            if binding_rows:
                _ents_here = set(seq.get("character_ids") or []) | set(seq.get("prop_ids") or [])
                for b in binding_rows:
                    if b.get("a") in _ents_here and b.get("b") in _ents_here:
                        if str(b["phrase"]) not in prompt:
                            errors.append(
                                f"{where}: binding {b.get('a')}+{b.get('b')} 同框但 prompt 缺绑定短语"
                                f"「{b['phrase']}」——写进 prompt；若关系已变（换乘/失龙/夺剑），"
                                "先更新 bindings 再交卷")
            # ⑤ cast_states 绑定 (v4 序列): char 必须在 cast 且 state 必须已声明 (懒生成: 无图合法)
            cs_map = seq.get("cast_states")
            if cs_map is not None:
                if not isinstance(cs_map, dict):
                    errors.append(f"{where}.cast_states must map character_id -> state_id")
                else:
                    _cast_by_id = {c.get("id"): c for c in data.get("cast", []) if isinstance(c, dict) and c.get("id")}
                    for cid, st_id in cs_map.items():
                        member = _cast_by_id.get(cid)
                        if member is None:
                            errors.append(f"{where}.cast_states has unknown character id {cid!r}")
                        elif str(st_id) not in {str(s.get("id")) for s in member.get("states") or []
                                                if isinstance(s, dict) and s.get("id")}:
                            errors.append(
                                f"{where}.cast_states[{cid!r}]={st_id!r} is not a declared state of "
                                f"{member.get('name')!r} — declare it in cast[].states "
                                "({id, note} 先登记, 卡懒生成)")
                        elif cid not in (seq.get("character_ids") or []):
                            warnings.append(f"{where}.cast_states covers {cid!r} which is not in character_ids")
            # ⑤ 需求拉动: 背面镜头缺背卡 (仅多视图生成器 2.5; 2.0/Fast 不挂背卡;
            # serial 的背面镜从 prompt 文字探测, 句子级点名归属——「陈默的背影」只 nag 陈默,
            # 背面句谁都没点名才 nag 全体; 状态版背卡在位不算缺; 侧面不要求视图卡)
            if _gprof.get("multi_view_cards"):
                _back_lines = [ln for ln in re.split(r"[\n。；;]", prompt)
                               if any(w in ln for w in ("背影", "背面", "背对"))]
                if _back_lines:
                    _cmap = {cid: next((c for c in data.get("cast", []) if isinstance(c, dict) and c.get("id") == cid), None)
                             for cid in seq.get("character_ids") or []}
                    _named = {str(m.get("name") or "") for m in _cmap.values() if m
                              and any(str(m.get("name") or "") in ln for ln in _back_lines)}
                    for cid, member in _cmap.items():
                        if not member or not str(member.get("image") or "").strip():
                            continue
                        if _named and str(member.get("name") or "") not in _named:
                            continue
                        st_id = (cs_map or {}).get(cid) if isinstance(cs_map, dict) else None
                        active = next((s for s in member.get("states") or []
                                       if isinstance(s, dict) and s.get("id") == st_id), {}) if st_id else {}
                        if not str(active.get("image_back") or member.get("image_back") or "").strip():
                            warnings.append(
                                f"{where}: 背面镜头 but cast {member.get('name')!r} has no image_back card — "
                                "11 区大卡的全身三视图已含背面, 先从大卡内取; 仅当跨镜背面仍漂移或背面分辨率不够时, "
                                "才补独立 image_back 高清卡 (按需升级通道: 挂主卡+视角保护语, 先测一张再批量)")
            # 跨场景转场桥 (transition_out): 一次生成同时看见两侧, 吃掉两侧手柄; 手柄区必须无台词
            tr = seq.get("transition_out")
            if tr is not None:
                if not isinstance(tr, dict) or tr.get("method") not in BRIDGE_METHODS:
                    errors.append(f"{where}.transition_out.method must be one of {list(BRIDGE_METHODS)} "
                                  "(相似构图 is a multi-keyframe world-hop, not a two-clip bridge)")
                else:
                    nxt = sequences[i + 1] if i + 1 < len(sequences) and isinstance(sequences[i + 1], dict) else None
                    b_dur = number(tr.get("duration")) or BRIDGE_DURATION_SECONDS
                    handle = number(tr.get("handle_seconds")) or BRIDGE_HANDLE_SECONDS
                    if nxt is None:
                        errors.append(f"{where}.transition_out sits on the last sequence — nothing to bridge into")
                    else:
                        if nxt.get("scene_id") == seq.get("scene_id"):
                            warnings.append(f"{where}.transition_out bridges into the same scene ({seq.get('scene_id')}) — "
                                            "same-scene boundaries merge or use continuity_from; a bridge is for a scene change")
                        n_shots = len(spans)
                        last_dlg = max((int(l.get("shot") or 0) for l in (seq.get("dialogue") or []) if isinstance(l, dict)), default=0)
                        if n_shots and last_dlg >= n_shots:
                            warnings.append(f"{where}: transition_out replaces this sequence's last {handle}s, but dialogue sits in its "
                                            f"final Shot {last_dlg} — end on a silent beat (the bridge carries no dialogue audio)")
                        first_dlg = min((int(l.get("shot") or 99) for l in (nxt.get("dialogue") or []) if isinstance(l, dict)), default=99)
                        if first_dlg == 1:
                            warnings.append(f"{where}.transition_out replaces the first {handle}s of {nxt.get('sequence_id')}, but its "
                                            "Shot 1 carries dialogue — open on a silent beat")
                        if b_dur - 2 * handle < 0.5:
                            warnings.append(f"{where}.transition_out: {b_dur}s bridge with {handle}s handles leaves <0.5s for the switch")
                        screen_total += max(0.0, b_dur - 2 * handle)   # net screen cost of the bridge (~1s)
            # Creation production support.
            _cont = seq.get("continuity")
            if _cont is not None:
                if not isinstance(_cont, dict):
                    errors.append(f"{where}.continuity must be an object {{entry_state, exit_state, allowed_changes, cut_type}}")
                else:
                    for _key in ("entry_state", "exit_state"):
                        _st = _cont.get(_key)
                        if _st is None:
                            continue
                        if (not isinstance(_st, dict) or not _st
                                or any(not str(k).strip() or not isinstance(v, str) or not v.strip() for k, v in _st.items())):
                            errors.append(f"{where}.continuity.{_key} must map a named fact to non-empty text, e.g. "
                                          "{\"玉镯\": \"在character A手里\", \"character B左腕\": \"钢壳棕带旧机械表\"}")
                    _ac = _cont.get("allowed_changes")
                    if _ac is not None and (not isinstance(_ac, list) or not all(isinstance(x, str) and x.strip() for x in _ac)):
                        errors.append(f"{where}.continuity.allowed_changes must be a list of short texts")
                    if _cont.get("cut_type") is not None and _cont.get("cut_type") not in SEQ_CUT_TYPES:
                        errors.append(f"{where}.continuity.cut_type must be one of {list(SEQ_CUT_TYPES)}")
                    _en = _cont.get("entry_state") if isinstance(_cont.get("entry_state"), dict) else {}
                    _ex = _cont.get("exit_state") if isinstance(_cont.get("exit_state"), dict) else {}
                    _acl = [a for a in (_ac or []) if isinstance(a, str)] if isinstance(_ac, list) else []
                    _undeclared = [k for k in _en.keys() & _ex.keys()
                                   if str(_en[k]).strip() != str(_ex[k]).strip() and not any(k in a for a in _acl)]
                    if _undeclared:
                        warnings.append(f"{where}.continuity: {_undeclared} change inside the sequence but allowed_changes does "
                                        "not say how — name the change (e.g. 「玉镯：从character C腕上摘下交到character A手里」); the tool "
                                        "tells the model which changes are allowed and keeps everything else fixed")
            # narration
            narr = seq.get("narration")
            if isinstance(narr, dict) and narr.get("line"):
                if not str(narr.get("speaker") or "").strip():
                    errors.append(f"{where}.narration needs a speaker (protagonist inner monologue)")
                narr_shot = narr.get("shot")
                if narr_shot is not None and any(
                    isinstance(line, dict) and line.get("shot") == narr_shot
                    for line in (seq.get("dialogue") or [])
                ):
                    # v4c 实测病灶: 内心独白挂到说话镜头 — 同一张嘴不能既张(说台词)又闭(内心),
                    # 装配时内心声会叠在说话口型上穿帮
                    errors.append(
                        f"{where}.narration is attached to shot {narr_shot}, which also has dialogue — "
                        "inner monologue must sit on a silent (mouth-closed) shot"
                    )
        # 视觉圣经: 全片视觉语言锁死在一段短文里, 工具注进每张卡与每个序列 (跨序列/跨集一致性的第一块砖)
        bible = data.get("style_bible")
        if not isinstance(bible, str) or not bible.strip():
            warnings.append("style_bible missing — write one short paragraph (<=240 chars) that locks the film's visual "
                            "language: 一主一辅参考片(只借什么), 镜头家族(白话), 色彩军规, 光线基调, 声音基调. "
                            "image_generate / video_generate inject it into every card, plate and sequence")
        elif len(bible.strip()) > STYLE_BIBLE_MAX_CHARS:
            warnings.append(f"style_bible is {len(bible.strip())} chars — keep it <={STYLE_BIBLE_MAX_CHARS}: it rides in the "
                            "补充说明 block of every prompt, and the model reads long prompts less attentively")
        # Production contract; see video-creation references for rationale.
        # Creation production support.
        _no_ledger = []
        for prev, cur in zip(sequences, sequences[1:]):
            if not (isinstance(prev, dict) and isinstance(cur, dict)):
                continue
            if prev.get("scene_id") != cur.get("scene_id"):
                continue
            _pc = prev.get("continuity") if isinstance(prev.get("continuity"), dict) else {}
            _cc = cur.get("continuity") if isinstance(cur.get("continuity"), dict) else {}
            if _cc.get("cut_type") in ("ellipsis", "scene_change"):
                continue
            # the previous sequence ENDS in its entry state updated by its exit state: a fact the
            # exit does not restate (陈默's watch) still holds at the cut
            _px = {**(_pc.get("entry_state") if isinstance(_pc.get("entry_state"), dict) else {}),
                   **(_pc.get("exit_state") if isinstance(_pc.get("exit_state"), dict) else {})}
            _ce = _cc.get("entry_state") if isinstance(_cc.get("entry_state"), dict) else {}
            _pid, _cid = prev.get("sequence_id"), cur.get("sequence_id")
            if not _px and not _ce:
                _no_ledger.append(f"{_pid}→{_cid}")
                continue
            _allowed = [a for a in (_cc.get("allowed_changes") or []) if isinstance(a, str)]
            for k in sorted(_px.keys() & _ce.keys()):
                if str(_px[k]).strip() != str(_ce[k]).strip() and not any(k in a for a in _allowed):
                    warnings.append(f"{_pid}→{_cid}: {k} is 「{_px[k]}」 at the end of {_pid} but 「{_ce[k]}」 at the start of "
                                    f"{_cid} — the cut would show the jump; make them agree (same fact? copy {_pid}'s wording "
                                    f"verbatim — the check compares text), or mark {_cid}.continuity.cut_type ellipsis "
                                    "(time passes) / scene_change")
            _lost = sorted(set(_px) - set(_ce))
            if _lost and _ce:
                warnings.append(f"{_cid}.continuity.entry_state does not carry {_lost} from the end of {_pid} — carry it "
                                "(the tool only injects declared facts) or say where it went in allowed_changes")
        if _no_ledger:
            warnings.append(f"same-scene boundaries without continuity states: {', '.join(_no_ledger)} — declare "
                            "exit_state / entry_state (props and who holds them, clothing/injury, who is present, positions); "
                            "props and layout are what drifts first across separate generations")
        # T23: merge reminders use the <=15s project baseline, not the model's 30s ceiling.
        for prev, cur in zip(sequences, sequences[1:]):
            if not (isinstance(prev, dict) and isinstance(cur, dict)):
                continue
            d1, d2 = number(prev.get("duration")), number(cur.get("duration"))
            if (prev.get("scene_id") == cur.get("scene_id") and d1 and d2
                    and d1 + d2 <= 15 + 1e-6):
                warnings.append(f"{prev.get('sequence_id')}+{cur.get('sequence_id')}: same scene, {int(d1)}s+{int(d2)}s fits one "
                                "recommended <=15s unit — consider merging into one sequence, "
                                "or set continuity_from on the second")
        # ---- ⑤ 触发缝合 (warning): ledger 声明了外观变化, 但 cast 未资产化对应状态 ----
        # 账本管文字断言, 状态卡管画面锚定。exit_state/allowed_changes 里出现伤/衣/饰类
        # 变化而角色 states 为空 → 提醒登记 (懒生成: 先 {id, note}, 剧情到达再画卡)。
        # 词匹配容错高, warning 不拦批。
        for i2, seq2 in enumerate(sequences if isinstance(sequences, list) else []):
            if not isinstance(seq2, dict):
                continue
            _cont = seq2.get("continuity") if isinstance(seq2.get("continuity"), dict) else {}
            _exit = _cont.get("exit_state") if isinstance(_cont.get("exit_state"), dict) else {}
            # 键也拼进来: 归属常写在键上 (「陈默状态: 左臂被划伤渗血」)
            _change_txt = " ".join([f"{k} {v}" for k, v in _exit.items()]
                                   + [str(a) for a in (_cont.get("allowed_changes") or []) if a])
            _hit = _APPEAR_CHANGE_RE.search(_change_txt) if _change_txt else None
            if not _hit:
                continue
            _members = [c for c in data.get("cast", []) if isinstance(c, dict)
                        and c.get("id") in (seq2.get("character_ids") or []) and not c.get("states")]
            if not _members:
                continue
            _names_in_txt = {str(c.get("name") or "") for c in data.get("cast", [])
                             if isinstance(c, dict) and c.get("id") in (seq2.get("character_ids") or [])
                             and str(c.get("name") or "") and str(c["name"]) in _change_txt}
            for _m in _members:
                if _names_in_txt and str(_m.get("name") or "") not in _names_in_txt:
                    continue  # 文本点名了别的角色, 不 nag 这个
                warnings.append(
                    f"sequences[{i2}] ({seq2.get('sequence_id')}): continuity 声明了外观变化"
                    f"（{_hit.group()}…）但 {_m.get('name')} 未登记 cast[].states —— 把变化"
                    "资产化成状态卡（默认截帧回填：先拍变化镜，从 verified take 抽状态最清晰帧"
                    "图生图；并行批次用纯预生成兜底），后续序列挂状态版身卡锚定，"
                    "否则只能靠文本断言扛漂移")
        # ---- 装配后 prompt 长度硬闸门 (prompt_soft_chars): 把注定被 API 按字数拒掉的调用拦在计划层 ----
        # 估算口径 = 计划 prompt + 工具自动追加块 (关键帧声明 / style_bible / 画外音声明 /
        # 上游尾帧声明), 见 generators.assembled_prompt_len。2.5 无限额 (None) 跳过。
        _limit = _gprof.get("prompt_soft_chars")
        if _limit:
            from ve_tools.generators import assembled_prompt_len as _apl
            for i, seq in enumerate(sequences if isinstance(sequences, list) else []):
                if not isinstance(seq, dict):
                    continue
                _est = _apl(seq, data, _gprof)
                if _est > _limit:
                    errors.append(
                        f"sequences[{i}] ({seq.get('sequence_id')}) assembled prompt ≈{_est} chars exceeds "
                        f"{_gprof['name']}'s {_limit}-char limit — the provider refuses oversize prompts at submit. "
                        f"Cut the plan text: the tool auto-appends the style bible and the declarations on top "
                        f"of it, and the estimate already counts them")
        for bid in beats.keys() - used_beats_v4:
            errors.append(f"beat {bid!r} has no sequence coverage")
        # hook/cliffhanger timing
        if episode_fmt and sequences:
            beat_screen_v4: dict[str, float] = {}
            for seq in sequences:
                if isinstance(seq, dict):
                    b = seq.get("beat")
                    sd = number(seq.get("screen_duration"))
                    if isinstance(b, str) and sd:
                        beat_screen_v4[b] = beat_screen_v4.get(b, 0.0) + sd
            first_id = ordered_beats[0].get("id") if ordered_beats else None
            last_id = ordered_beats[-1].get("id") if ordered_beats else None
            if isinstance(first_id, str) and beat_screen_v4.get(first_id, 0.0) > 15.0 + 1e-6:
                # (1109 审计: 本块自 v4 分支引入起就在 v4 作用域内, 旧的 `not v4` 两行恒假
                # 死码与恒真的 `and v4` 已删, v2/v3 的对应提醒在下方 shot 分支尾部。)
                warnings.append(f"hook sequence plans {beat_screen_v4[first_id]:.1f}s; keep the hook moment in the first 3-5s of the sequence")
            if isinstance(last_id, str) and beat_screen_v4.get(last_id, 0.0) > 15.0 + 1e-6:
                warnings.append(f"cliffhanger sequence plans {beat_screen_v4[last_id]:.1f}s; keep the reveal moment in the last 3-5s")
        # total duration — window matches the closeout gate exactly (episode only; other formats
        # are compared with their own declared target, advisory)
        warnings.extend(_target_duration_notes(data, screen_total))
        # budget
        budget = data.get("budget")
        if not isinstance(budget, dict):
            errors.append("budget must declare max_total_generations and max_total_generated_seconds")
        else:
            for key in ("max_total_generations", "max_total_generated_seconds"):
                value = number(budget.get(key))
                if value is None or value <= 0 or (key == "max_total_generations" and value != int(value)):
                    errors.append(f"budget.{key} must be a positive {'integer' if key.endswith('generations') else 'number'}")
        return errors, warnings, screen_total

    # ---- v2/v3: shot-based validation (existing code) ----
    shots = data.get("shots", [])
    known: dict[str, dict] = {}
    used_beats: set[str] = set()
    screen_total = 0.0
    for i, shot in enumerate(shots if isinstance(shots, list) else []):
        if not isinstance(shot, dict):
            continue  # legacy structural validator reports this
        where = f"shots[{i}]"
        _vo_e, _vo_w = voiceover_issues(shot, where, narrative)
        errors.extend(_vo_e)
        warnings.extend(_vo_w)
        bid = shot.get("beat")
        if not isinstance(bid, str) or bid not in beats:
            errors.append(f"{where}.beat must reference a directing beat id")
        else:
            used_beats.add(bid)
            if beats[bid].get("scene_id") != shot.get("scene_id"):
                soft(f"{where}: beat and shot disagree on scene_id")
        duration = number(shot.get("screen_duration"))
        if duration is None or duration <= 0:
            errors.append(f"{where}.screen_duration must be positive (editorial time, not API duration)")
        else:
            screen_total += duration
            raw = number(shot.get("duration"))
            if raw is not None and duration > raw:
                warnings.append(f"{where}: planned screen time exceeds footage; plan a supported speed/hold or more coverage")
        for key in ("intent", "cut_on"):
            text_soft(shot.get(key), f"{where}.{key}")
        texts_soft(shot.get("required_visuals"), f"{where}.required_visuals")
        texts_soft(shot.get("flexible"), f"{where}.flexible", allow_empty=True)
        continuity = shot.get("continuity")
        if not isinstance(continuity, dict):
            # 世界状态账本是分段生成剧情片的连续性手段; 非剧情片型 (鬼畜/MV/纪录片空镜) 可以不写
            if narrative:
                errors.append(f"{where}.continuity must be an object")
        else:
            if continuity.get("cut_type") not in ("continuous", "angle_change", "ellipsis", "scene_change"):
                soft(f"{where}.continuity.cut_type must describe the intended edit")
            text_soft(continuity.get("camera_relation"), f"{where}.continuity.camera_relation")
            for key in ("entry_state", "exit_state"):
                state = continuity.get(key)
                if not isinstance(state, dict) or not state:
                    soft(f"{where}.continuity.{key} must contain named world-state facts")
                elif any(not isinstance(v, str) or not v.strip() for v in state.values()):
                    soft(f"{where}.continuity.{key} values must be non-empty text")
            texts_soft(continuity.get("allowed_changes"), f"{where}.continuity.allowed_changes", allow_empty=True)
            if i and continuity.get("cut_type") not in ("ellipsis", "scene_change"):
                previous = shots[i - 1]
                if isinstance(previous, dict) and previous.get("scene_id") == shot.get("scene_id"):
                    before = (previous.get("continuity") or {}).get("exit_state", {})
                    after = continuity.get("entry_state", {})
                    allowed = continuity.get("allowed_changes", [])
                    if isinstance(before, dict) and isinstance(after, dict) and isinstance(allowed, list):
                        for key in before.keys() & after.keys():
                            if before[key] != after[key] and key not in allowed:
                                soft(f"{where}: world state {key!r} changes across the planned cut without allowed_changes")
        parent = shot.get("reference_from") or shot.get("continues_from")
        if shot.get("reference_from") and shot.get("continues_from"):
            errors.append(f"{where}: choose reference_from or legacy continues_from, not both")
        if parent:
            if not isinstance(parent, str) or parent not in known:
                errors.append(f"{where}.reference_from must refer to an earlier planned shot")
            if shot.get("reference_from") and shot.get("reference_mode") not in ("context", "continuation"):
                errors.append(f"{where}.reference_mode must be context or continuation")
        elif shot.get("reference_mode"):
            errors.append(f"{where}.reference_mode requires reference_from")
        sid = shot.get("shot_id")
        try:
            safe_unit_id(sid)
        except ValueError as exc:
            errors.append(f"{where}.shot_id: {exc}")
        if isinstance(sid, str):
            known[sid] = shot
    for bid in beats.keys() - used_beats:
        errors.append(f"beat {bid!r} has no planned coverage")
    if episode_fmt and shots:
        beat_screen: dict[str, float] = {}
        for shot in shots:
            if isinstance(shot, dict):
                bid = shot.get("beat")
                sd = number(shot.get("screen_duration"))
                if isinstance(bid, str) and sd:
                    beat_screen[bid] = beat_screen.get(bid, 0.0) + sd
        first_id = ordered_beats[0].get("id") if ordered_beats else None
        last_id = ordered_beats[-1].get("id") if ordered_beats else None
        if isinstance(first_id, str) and beat_screen.get(first_id, 0.0) > 5.0 + 1e-6:
            warnings.append(
                f"hook beat {first_id!r} plans {beat_screen[first_id]:.1f}s of screen time; "
                "the 0-3s conflict opener must stay within 5s"
            )
        if isinstance(last_id, str) and beat_screen.get(last_id, 0.0) > 10.0 + 1e-6:
            warnings.append(
                f"cliffhanger beat {last_id!r} plans {beat_screen[last_id]:.1f}s of screen time; "
                "the end hook must stay within 10s"
            )
    warnings.extend(_target_duration_notes(data, screen_total))
    budget = data.get("budget")
    if not isinstance(budget, dict):
        errors.append("budget must declare max_total_generations and max_total_generated_seconds")
    else:
        for key in ("max_total_generations", "max_total_generated_seconds"):
            value = number(budget.get(key))
            if value is None or value <= 0 or (key == "max_total_generations" and value != int(value)):
                errors.append(f"budget.{key} must be a positive {'integer' if key.endswith('generations') else 'number'}")
    return errors, warnings, screen_total


def approved_span(review: dict, expected_plan_hash: str, source_hash: str, start: float, end: float) -> None:
    """Fail closed on stale/unobserved candidates or unapproved editorial ranges."""
    if review.get("source_sha256") != source_hash:
        raise ValueError("candidate verdict is missing/stale: source_sha256 does not match")
    if review.get("shot_plan_sha256") != expected_plan_hash:
        raise ValueError("candidate verdict is stale: shot_plan_sha256 does not match")
    # `exhausted`: the budget is spent and the best take ships with its defect on record;
    # it may be laid, but only inside the usable_spans the judge left (the defect is cut out).
    exhausted = review.get("status") == "exhausted"
    if review.get("verdict") not in ("pass", "mute_audio") and not exhausted:
        raise ValueError("candidate has no passing visual verdict")
    performance = review.get("performance")
    if not exhausted and (not isinstance(performance, dict) or any(
        performance.get(k) != "pass" for k in ("required_visuals", "causality", "intended_effect")
    )):
        raise ValueError("candidate needs passing required_visuals, causality and intended_effect checks")
    for span in review.get("usable_spans", []):
        if not isinstance(span, dict):
            continue
        a, b = number(span.get("start")), number(span.get("end"))
        if a is not None and b is not None and 0 <= a <= start + 1e-6 and end <= b + 1e-6:
            return
    raise ValueError("selected range is not contained in an approved usable_span")
