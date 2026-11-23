"""Screenplay layer and structured shot blocks for creation plans.

A narrative plan is cut from a screenplay: the screenplay is written first, in segments of at
most SEGMENT_MAX_SECONDS, and every plan unit names the segment(s) it films. Units describe their
shots as structured `blocks` (timing, framing, movement, action, line, sound); the generation
prompt is compiled from those blocks so the structure and the request cannot drift apart.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

SCREENPLAY_DEFAULT_PATH = "out/screenplay.md"
SEGMENT_MAX_SECONDS = 15.0
SILENT_BLOCK_MAX_SECONDS = 3.0
LINE_KINDS = ("dialogue", "inner", "voiceover")
UNPLACED_LINES_SHOWN = 5

# Segment heading: 「第3段（约12秒） 日 内 教室」 / 「第3场（12s）…」 / "Segment 3 (~12s) DAY INT. classroom".
_SEGMENT_HEAD = re.compile(
    r"^\s*#{0,6}\s*(?:第\s*(\d+)\s*[段场]|(?:segment|scene)\s+(\d+))\s*"
    r"[（(]\s*(?:约|~|≈|about\s*)?\s*(\d+(?:\.\d+)?)\s*(?:秒|s|sec|secs|seconds)?\s*[)）]\s*(.*)$",
    re.IGNORECASE)
# A spoken line: 「林小溪：……」, 「周哲（皱眉）：……」, 「林小溪（OS）：……」.
_SPOKEN = re.compile(r"^\s*([^\s△:：（()）#|>\-][^:：（()）]{0,23}?)\s*(?:[（(]([^）)]{0,24})[）)])?\s*[:：]\s*(\S.*)$")
_CAST_LIST_LABELS = ("人物", "角色", "出场", "characters", "cast")
_OFFSCREEN_NOTES = ("os", "vo", "v.o", "o.s", "内心", "画外", "旁白", "独白")


def text_key(value: Any) -> str:
    """Comparison key for lines: punctuation, quotes and whitespace removed."""
    return re.sub(r"[\W_]+", "", str(value or ""))


def parse_screenplay(text: str) -> list[dict]:
    """Segments in order: {no, seconds, heading, lines[{speaker, note, text}], actions}."""
    segments: list[dict] = []
    current: dict | None = None
    for raw in str(text or "").splitlines():
        line = raw.replace("**", "").strip()
        if not line:
            continue
        head = _SEGMENT_HEAD.match(line)
        if head:
            current = {"no": int(head.group(1) or head.group(2)), "seconds": float(head.group(3)),
                       "heading": head.group(4).strip(), "lines": [], "actions": 0}
            segments.append(current)
            continue
        if current is None:
            continue
        if line.startswith("△"):
            current["actions"] += 1
            continue
        spoken = _SPOKEN.match(line)
        if not spoken:
            continue
        speaker = spoken.group(1).strip()
        if speaker.lower() in _CAST_LIST_LABELS:
            continue
        current["lines"].append({"speaker": speaker, "note": (spoken.group(2) or "").strip(),
                                 "text": spoken.group(3).strip()})
    return segments


def unit_segments(unit: dict) -> list[Any]:
    value = unit.get("segment")
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def unit_lines(unit: dict) -> list[tuple[str, str]]:
    """(kind, text) of every line a unit carries: dialogue, inner voice, voiceover, block lines."""
    found: list[tuple[str, str]] = []
    for line in unit.get("dialogue") or []:
        if isinstance(line, dict) and str(line.get("line") or "").strip():
            found.append(("dialogue", str(line["line"])))
    narration = unit.get("narration")
    if isinstance(narration, dict) and str(narration.get("line") or "").strip():
        found.append(("inner", str(narration["line"])))
    voiceover = unit.get("voiceover")
    for item in (voiceover if isinstance(voiceover, list) else [voiceover] if voiceover else []):
        if isinstance(item, dict) and str(item.get("line") or "").strip():
            found.append(("voiceover", str(item["line"])))
    for block in unit.get("blocks") or []:
        line = block.get("line") if isinstance(block, dict) else None
        if isinstance(line, dict) and str(line.get("text") or "").strip():
            found.append((str(line.get("kind") or "dialogue"), str(line["text"])))
    return found


def _num(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if out == out and out not in (float("inf"), float("-inf")) else None


def _h3_ts(sec: float) -> str:
    """秒 -> H3 官方 MM:SS.mmm 时间戳 (官方指南格式)。"""
    m = int(sec // 60)
    rem = sec - 60 * m
    return f"{m:02d}:{rem:06.3f}"


def _h3_line_lang(text: str) -> str:
    return "中文" if any("\u4e00" <= ch <= "\u9fff" for ch in text) else "English"


def compile_unit_prompt(unit: dict, multi_shot: bool, h3: bool = False) -> str | None:
    """The generation prompt of a unit with `blocks`, or None when it has none.

    `setting` opens the prompt (place, light, wardrobe, what must stay fixed) and `notes` closes
    it. Each block becomes one shot description; spoken lines stay inside braces at the end of
    their block so nothing trails a line.
    """
    blocks = unit.get("blocks")
    if not isinstance(blocks, list) or not blocks:
        return None
    parts: list[str] = []
    # shadow 提案二 (H3 官方标记语法): 说话人稳定标记注册表, 按 unit 内首次说话顺序分配;
    # 注册行进正文首行, 与正文引用同处分配, 编号绝不错位 (官方: (S1) 贯穿全 prompt)。
    _spk_no: dict[str, int] = {}
    if h3:
        for _bl in blocks:
            if isinstance(_bl, dict) and isinstance(_bl.get("line"), dict) \
                    and str(_bl["line"].get("kind") or "dialogue") == "dialogue":
                _sp = str(_bl["line"].get("speaker") or "").strip()
                if _sp and _sp not in _spk_no:
                    _spk_no[_sp] = len(_spk_no) + 1
        if _spk_no:
            parts.append("说话人标记：" + "；".join(f"(S{n})={sp}" for sp, n in _spk_no.items()) + "。")
    if str(unit.get("setting") or "").strip():
        parts.append(str(unit["setting"]).strip())
    for k, block in enumerate(blocks, 1):
        if not isinstance(block, dict):
            continue
        a, b = _num(block.get("start")), _num(block.get("end"))
        view = ", ".join(str(block.get(key) or "").strip() for key in ("framing", "angle", "movement")
                         if str(block.get(key) or "").strip())
        body = " ".join(str(block.get(key) or "").strip() for key in ("picture", "action")
                        if str(block.get(key) or "").strip())
        text = (f"{view}. {body}" if view and body else view or body).strip()
        if str(block.get("sound") or "").strip():
            text += f" Sound: {str(block['sound']).strip()}."
        line = block.get("line") if isinstance(block.get("line"), dict) else None
        kind = str((line or {}).get("kind") or "dialogue")
        if line and str(line.get("text") or "").strip():
            if kind == "dialogue":
                if h3:
                    _sp = str(line.get("speaker") or "").strip()
                    _no = _spk_no.get(_sp, 1)
                    # 官方: 台词用 <d>[语言] 原文</d> 包裹, 保留原标点不改写
                    text += f" (S{_no})<d>[{_h3_line_lang(str(line['text']))}] {str(line['text']).strip()}</d>"
                else:
                    text += f" {str(line.get('speaker') or '').strip()} says: {{{str(line['text']).strip()}}}"
            else:
                text += " No one speaks on screen; mouths stay closed."
        elif not line:
            text += " No one speaks."
        if h3 and multi_shot and a is not None:
            # 官方: [Shot N] 在 MM:SS.mmm 严格递增; [Shot 1] 不带时间戳; 跨切镜 <scenetrans>
            if k >= 2:
                parts.append("<scenetrans>")
            parts.append((f"[Shot {k}] " if k == 1 else f"[Shot {k}] 在 {_h3_ts(a)}，") + text)
        elif multi_shot and a is not None and b is not None:
            parts.append(f"Shot {k} ({a:g}-{b:g}s): {text}")
        else:
            parts.append(text)
    if str(unit.get("notes") or "").strip():
        parts.append(str(unit["notes"]).strip())
    return "\n".join(parts)


def prompt_field(multi_shot: bool) -> str:
    return "prompt" if multi_shot else "video_prompt"


def _plan_is_h3(data: dict) -> bool:
    """plan 的生成器是否 H3 方言。与 plan_profile 同源判定 (plan.generator -> 环境变量
    -> 默认档): 以前只看 plan.generator, 环境变量钉 H3 而计划不写 generator 时, 能力校验
    按 H3、prompt 编译按 Seedance 方言, 同一次 validate 里两头分叉。"""
    from .generators import plan_profile
    try:
        return plan_profile(data if isinstance(data, dict) else {}).get("dialect") == "h3"
    except ValueError:
        return "h3" in str((data or {}).get("generator") or "").lower()


def compile_plan_prompts(data: dict) -> dict[str, str]:
    """Write compiled prompts into units that carry blocks; returns {unit_id: prompt} changed."""
    v4 = str(data.get("schema_version")) == "4"
    units = data.get("sequences") if v4 else data.get("shots")
    changed: dict[str, str] = {}
    for unit in units or []:
        if not isinstance(unit, dict):
            continue
        compiled = compile_unit_prompt(unit, v4, h3=_plan_is_h3(data))
        if compiled is None:
            continue
        field = prompt_field(v4)
        if unit.get(field) != compiled:
            unit[field] = compiled
            changed[str(unit.get("sequence_id") or unit.get("shot_id"))] = compiled
        if not unit.get("dialogue"):
            spoken = [{"speaker": str(bl["line"].get("speaker") or "").strip(), "line": str(bl["line"]["text"]).strip()}
                      for bl in unit.get("blocks") or []
                      if isinstance(bl, dict) and isinstance(bl.get("line"), dict)
                      and str(bl["line"].get("kind") or "dialogue") == "dialogue" and str(bl["line"].get("text") or "").strip()]
            if spoken:
                unit["dialogue"] = spoken
                # Report the fill too: a plan whose prompts were already compiled (changed
                # empty) must still be written back, or generation never sees who speaks
                # and cannot bind the reference audios to the cast.
                changed[f"{unit.get('sequence_id') or unit.get('shot_id')}:dialogue"] = "filled from blocks"
    return changed


# A unit that stages an exchange of force. Specific verbs only: 打 alone also means 打开 / 打量 /
# 打胶, and a dialogue scene must not be told to write impact chains (references/action.md).
_FIGHT_WORDS = re.compile(
    r"出拳|挥拳|一拳|踢中|飞踢|踢向|劈向|横劈|竖劈|斩向|横斩|砍向|砍中|刺向|挥刀|挥剑|拔刀|拔剑|"
    r"格挡|招架|闪避|闪身|侧身躲|扑向|扑击|撞向|撞飞|击中|命中|击退|震飞|过招|交手|厮杀|搏斗|打斗|"
    r"对打|缠斗|追逐|追击|出掌|一掌|"
    r"\b(?:punch|kick|slash|parr(?:y|ies)|dodg(?:e|es)|lunge|strike|strikes|grapple|tackle|chase)\b",
    re.IGNORECASE)
# How a block says it starts from the previous one's result (momentum, consequence, condition).
_HANDOFF_WORDS = re.compile(
    r"借|顺势|顺着|趁|被|随即|紧接|惯性|反震|余势|失衡|踉跄|前倾|后仰|躲过|避过|闪过|格开|架住|"
    r"落地|起身|顺|乘|因此|于是|^然后|"
    r"\b(?:carried|momentum|using|off balance|as (?:he|she|it|they)|after|knocked|thrown|recoil|"
    r"still|seizing|following)\b",
    re.IGNORECASE)


def _fight_handoff_warnings(where: str, blocks: list) -> list[str]:
    actions = [str(b.get("action") or "").strip() if isinstance(b, dict) else "" for b in blocks]
    if not any(_FIGHT_WORDS.search(a) for a in actions):
        return []
    out = []
    for j in range(1, len(actions)):
        if actions[j] and actions[j - 1] and not _HANDOFF_WORDS.search(actions[j]):
            out.append(f"{where}.blocks[{j}]: a fight block whose action does not open from what "
                       f"blocks[{j - 1}] left behind (momentum, an opening, a body off balance) — read "
                       "the pair as 'because …, …'; an action that does not follow is how bodies "
                       "teleport and blows land on nothing (references/action.md)")
    return out
FUNCTIONS = ("开场钩子", "信息推进", "反应", "反转", "压迫", "爽点", "追看点", "功能转场")


def block_issues(data: dict, narrative: bool) -> tuple[list[str], list[str]]:
    """Structured shot blocks: required for narrative formats, contiguous, and in sync with the prompt."""
    errors: list[str] = []
    warnings: list[str] = []

    def holder_changed(before: Any, after: Any) -> bool:
        # Read existing state only; this reminder does not add or alter a prop ledger.
        if not isinstance(before, dict) or not isinstance(after, dict):
            return False
        for name in before.keys() & after.keys():
            a, b = before[name], after[name]
            if isinstance(a, dict) and isinstance(b, dict):
                if holder_changed(a, b):
                    return True
            elif a != b and (re.search(r"holder|held_by|持有者|持有人|谁持有|手中", str(name), re.IGNORECASE)
                             or (isinstance(a, str) and isinstance(b, str)
                                 and re.search(r"手中|手持|握着|拿着|held by|holds?", a + b, re.IGNORECASE))):
                return True
        return False

    v4 = str(data.get("schema_version")) == "4"
    key = "sequences" if v4 else "shots"
    field = prompt_field(v4)
    for i, unit in enumerate(data.get(key) or []):
        if not isinstance(unit, dict):
            continue
        where = f"{key}[{i}] ({unit.get('sequence_id') or unit.get('shot_id')})"
        blocks = unit.get("blocks")
        if blocks is None:
            if narrative:
                errors.append(f"{where}.blocks is required: one entry per shot with start, end, framing, movement, "
                              "action, line and sound; the prompt is compiled from them")
            continue
        if not isinstance(blocks, list) or not blocks:
            errors.append(f"{where}.blocks must be a non-empty array")
            continue
        continuity = unit.get("continuity") if isinstance(unit.get("continuity"), dict) else {}
        actions = " ".join(str(bl.get("action") or "") for bl in blocks if isinstance(bl, dict))
        if (holder_changed(continuity.get("entry_state"), continuity.get("exit_state"))
                or re.search(r"递给|递向|交给|交到|交接|接过|移交|传给|\bhand(?:s|ing)? over\b|\bpass(?:es|ing)? to\b",
                             actions, re.IGNORECASE)):
            warnings.append(f"{where}: 检出持有者变化/交接动作，须写清给方、收方、递接过程；"
                            "启动(伸手)→过程(递接中)→落点(入手/松手)→次级运动(回收/反应) (advisory)")
        if not v4 and len(blocks) > 1:
            errors.append(f"{where}: a v2 shot is one camera setup; give it one block (use v4 sequences for "
                          "several shots in one generation)")
        funcs: list[str] = []
        frames: list[str] = []
        jump_marks: list[str] = []
        cursor = 0.0
        for j, block in enumerate(blocks):
            bw = f"{where}.blocks[{j}]"
            if not isinstance(block, dict):
                errors.append(f"{bw} must be an object")
                continue
            a, b = _num(block.get("start")), _num(block.get("end"))
            if a is None or b is None or not 0 <= a < b:
                errors.append(f"{bw} needs numeric start < end in seconds")
                continue
            if abs(a - cursor) > 1e-6:
                errors.append(f"{bw} starts at {a:g}s but the previous block ended at {cursor:g}s; blocks are contiguous from 0")
            cursor = b
            for name in ("framing", "movement"):
                if not str(block.get(name) or "").strip():
                    errors.append(f"{bw}.{name} must be non-empty text")
            fn = str(block.get("function") or "").strip()
            if fn and fn not in FUNCTIONS:
                warnings.append(f"{bw}.function '{fn}' 不在节奏功能枚举 {FUNCTIONS} (advisory)")
            if fn == "反应" and (b - a) > 1.5:
                warnings.append(f"{bw}.function=反应 时长 {b - a:g}s 超过 0.8-1.5s 带宽，反应的冲击力来自短 (advisory)")
            funcs.append(fn)
            _cx = str(block.get("complexity") or "").strip()
            if _cx and _cx not in ("低", "中", "高", "low", "mid", "high"):
                warnings.append(f"{bw}.complexity={_cx!r} 应为 低/中/高 (advisory)")
            if _cx in ("高", "high") and (b - a) > 3.0:
                warnings.append(f"{bw}.complexity=高 且时长 {b - a:g}s 偏长——高复杂度动作建议拆成更小的镜头 "
                                "(一镜一主导运镜的同族规则) (advisory)")
            frames.append(str(block.get("framing") or "").strip())
            jump_marks.append(str(block.get("notes") or "") + str(block.get("picture") or ""))
            line = block.get("line")
            if line is not None:
                if not isinstance(line, dict) or not str(line.get("text") or "").strip():
                    errors.append(f"{bw}.line must be {{speaker, text, kind?}} with non-empty text")
                    line = None
                elif str(line.get("kind") or "dialogue") not in LINE_KINDS:
                    errors.append(f"{bw}.line.kind must be one of {list(LINE_KINDS)}")
                elif str(line.get("kind") or "dialogue") == "dialogue" and not str(line.get("speaker") or "").strip():
                    errors.append(f"{bw}.line.speaker is required for dialogue")
            action = str(block.get("action") or "").strip()
            if not line and not action:
                warnings.append(f"{bw} has no line and no action: nothing changes in it; give it a visible action "
                                "or a reaction, or cut it")
            if not line and b - a > SILENT_BLOCK_MAX_SECONDS + 1e-6:
                warnings.append(f"{bw} runs {b - a:g}s without a line; silent stretches over "
                                f"{SILENT_BLOCK_MAX_SECONDS:g}s read as dead air unless the action carries the story")
        warnings.extend(_fight_handoff_warnings(where, blocks))
        for k in range(1, len(funcs)):
            if (funcs[k] in ("", "功能转场")) and (funcs[k - 1] in ("", "功能转场")):
                warnings.append(f"{where}.blocks[{k - 1}]-[{k}]: 连续两个镜头都是无信息铺垫(缺 function 或=功能转场)，"
                                "至少其一应承担钩子/信息推进/反应/反转/压迫/爽点/追看点 (advisory)")
        for k in range(1, len(frames)):
            if frames[k] and frames[k] == frames[k - 1] and "跳切" not in jump_marks[k]:
                warnings.append(f"{where}.blocks[{k - 1}]-[{k}]: 相邻两镜头同为 {frames[k]} 景别且未标有意跳切；"
                                "相邻景别应有变化(紧张收紧/释放放宽)，重复景别需在 notes 标注跳切意图 (advisory)")
        duration = _num(unit.get("duration"))
        if blocks and duration is not None and abs(cursor - duration) > 1e-6:
            errors.append(f"{where}: blocks end at {cursor:g}s but duration={duration:g}s; the blocks cover the whole request")
        compiled = compile_unit_prompt(unit, v4, h3=_plan_is_h3(data))
        if compiled is not None and unit.get(field) != compiled:
            errors.append(f"{where}.{field} is not the compilation of its blocks; edit blocks, then run "
                          "creation_plan_validate, which recompiles the prompt")
    return errors, warnings


def screenplay_issues(data: dict, text: str | None, path: str, narrative: bool) -> tuple[list[str], list[str]]:
    """The plan against its screenplay: segment length, coverage and line provenance."""
    errors: list[str] = []
    warnings: list[str] = []

    def problem(message: str) -> None:
        (errors if narrative else warnings).append(message if narrative else f"{message} (advisory)")

    if text is None:
        if narrative:
            errors.append(f"screenplay {path} not found: narrative formats write the screenplay first "
                          "(segments of at most 15 s with heading, cast, actions and lines), then cut the plan from it")
        return errors, warnings
    segments = parse_screenplay(text)
    if not segments:
        problem(f"screenplay {path} has no segment headings such as 「第1段（约12秒） 日 内 地点」")
        return errors, warnings
    by_no: dict[int, dict] = {}
    for seg in segments:
        if seg["no"] in by_no:
            problem(f"screenplay segment {seg['no']} appears twice")
        by_no[seg["no"]] = seg
        if seg["seconds"] > SEGMENT_MAX_SECONDS + 1e-6:
            problem(f"screenplay segment {seg['no']} plans {seg['seconds']:g}s; keep each segment at most "
                    f"{SEGMENT_MAX_SECONDS:g}s and split longer ones")
        if not seg["lines"] and not seg["actions"]:
            warnings.append(f"screenplay segment {seg['no']} has neither a line nor an action (△)")
    v4 = str(data.get("schema_version")) == "4"
    key = "sequences" if v4 else "shots"
    covered: set[int] = set()
    plan_keys: list[str] = []
    for i, unit in enumerate(data.get(key) or []):
        if not isinstance(unit, dict):
            continue
        where = f"{key}[{i}] ({unit.get('sequence_id') or unit.get('shot_id')})"
        segs = unit_segments(unit)
        if not segs:
            problem(f"{where}.segment must name the screenplay segment number(s) this unit films")
            continue
        own_text = ""
        for no in segs:
            if not isinstance(no, int) or isinstance(no, bool) or no not in by_no:
                problem(f"{where}.segment {no!r} is not a screenplay segment")
                continue
            covered.add(no)
            own_text += "".join(text_key(ln["text"]) for ln in by_no[no]["lines"])
        all_text = "".join(text_key(ln["text"]) for seg in segments for ln in seg["lines"])
        for kind, line in unit_lines(unit):
            k = text_key(line)
            plan_keys.append(k)
            if not k or k in own_text:
                continue
            if k in all_text:
                warnings.append(f"{where}: {kind} line 「{line[:24]}」 is written in a different screenplay segment")
            else:
                problem(f"{where}: {kind} line 「{line[:24]}」 is not in the screenplay; lines come from the "
                        "screenplay, so change the screenplay first")
    for no in sorted(set(by_no) - covered):
        problem(f"screenplay segment {no} has no plan unit; film it or remove it from the screenplay")
    planned = "".join(plan_keys)
    dropped = [ln["text"] for seg in segments for ln in seg["lines"]
               if text_key(ln["text"]) and text_key(ln["text"]) not in planned]
    if dropped:
        shown = "; ".join(f"「{t[:20]}」" for t in dropped[:UNPLACED_LINES_SHOWN])
        warnings.append(f"{len(dropped)} screenplay line(s) are in no plan unit: {shown}")
    return errors, warnings


def load_screenplay(data: dict, ctx) -> tuple[str | None, str]:
    """(text or None, declared path) of the plan's screenplay, resolved inside the project."""
    path = str(data.get("screenplay") or SCREENPLAY_DEFAULT_PATH)
    try:
        target = ctx.resolve(path).resolve()
        target.relative_to(Path(ctx.project_dir).resolve())
    except (ValueError, OSError):
        return None, path
    if not target.is_file():
        return None, path
    return target.read_text(encoding="utf-8", errors="replace"), path
