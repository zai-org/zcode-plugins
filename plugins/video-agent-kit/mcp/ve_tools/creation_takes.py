"""Shared creation production support; media APIs and explicit evidence contracts."""
from __future__ import annotations

import copy
from ve_tools import file_lock
import json
import os
import re
from contextlib import contextmanager
from pathlib import Path

from .creation_planning import digest, file_digest, number, shot_plan_digest
from . import generators as _gens
from . import audio_identity
from .result import ToolResult

# Execution controls that never reach the provider request. They are not part of a
# candidate's identity: changing them must not block recovery of a submitted task.
EXECUTION_ONLY_SETTINGS = ('shots', 'output_json', 'output_dir', 'force', 'timeout_seconds',
                           'poll_interval_seconds', 'concurrency', 'max_shots_per_call')


def _identity_view(recipe: dict) -> dict:
    """Recipe without compiler/execution-only fields, for recovery comparisons."""
    view = {k: v for k, v in recipe.items() if k != 'compiler_sha256'}
    if isinstance(view.get('settings'), dict):
        view['settings'] = {k: v for k, v in view['settings'].items() if k not in EXECUTION_ONLY_SETTINGS}
    return view


def read_object(path: Path) -> dict:
    if not path.exists():
        return {}
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"expected JSON object: {path}")
    return value


def write_object(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    import tempfile
    fd, name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def bind_project_budget(ctx, directory, caps):
    """One project owns one immutable candidate directory and generation budget.

    The public creation lock serializes this binding with generation/edit reservations.
    Adopt an existing ledger on upgrade; never silently start a second budget.
    """
    path = ctx.resolve('.video_agent/creation_budget.json')
    binding = {'directory': str(Path(directory).resolve()), 'budget': caps}
    old = read_object(path)
    if not old:
        ledgers = [p for p in ctx.project_dir.rglob('takes.json')
                   if read_object(p).get('takes') and read_object(p).get('budget')]
        if len(ledgers) > 1:
            raise ValueError('multiple legacy candidate ledgers need budget reconciliation before generation')
        if ledgers:
            legacy = read_object(ledgers[0])
            old = {'directory': str(ledgers[0].parent.resolve()), 'budget': legacy['budget']}
    if old and old != binding:
        raise ValueError('project generation budget/directory is already bound; use the original directory or a separate project')
    write_object(path, binding)



@contextmanager
def generation_lock(directory: Path):
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / ".takes.lock").open("a") as stream:
        try:
            file_lock.flock(stream.fileno(), file_lock.LOCK_EX | file_lock.LOCK_NB)
        except BlockingIOError as exc:
            raise ValueError("another candidate batch is active in this output_dir; retry after it finishes") from exc
        try:
            yield
        finally:
            file_lock.flock(stream.fileno(), file_lock.LOCK_UN)


def generate_takes(args: dict, ctx, generate):
    """All takes in this mode have explicit immutable ids; legacy calls stay separate.

    Reservations cap distinct task attempts/seconds, including failed attempts.
    They are deliberately conservative, not an estimate of the provider invoice.
    A later call may recover the same task/download, but may not replace a take.
    """
    shots = args["shots"]
    # Batch-size gate: v4 sequences are heavier (8-30s per generation vs 4-8s
    # for v3 shots), so the default cap is halved. The skill's batching
    # discipline is enforced here because prose alone did not survive contact
    # Production contract; see video-creation references for rationale.
    _pp = ctx.resolve(args.get("shotlist_path") or "out/creation/shotlist.json")
    _plan = None
    if _pp.is_file():
        try:
            _plan = read_object(_pp)
        except ValueError:
            pass
    _default_cap = 2 if (_plan and str(_plan.get("schema_version")) in ("4", "5")) else 4
    batch_cap = number(args.get("max_shots_per_call")) or int(number(
        __import__("os").environ.get("VE_CREATION_MAX_SHOTS_PER_CALL")) or 0) or _default_cap
    if len(shots) > batch_cap:
        raise ValueError(
            f"{len(shots)} candidate shots in one call exceeds the batch cap of "
            f"{int(batch_cap)}: split them into multiple video_generate calls "
            f"(generate <= {int(batch_cap)}, verify, then submit the next batch) — the provider queues "
            "large same-key submissions for hours"
        )
    # Identity-anchor gate (schema v3 plans): footage for shots whose bound
    # Production contract; see video-creation references for rationale.
    # skipped the reference-art phase entirely (zero image-API calls) and its
    # 19 text-only clips drifted in style and identity across the board — the
    # card system exists precisely to prevent that, so the tool now enforces
    # the ordering instead of trusting the skill prose.
    allow_unreferenced = False
    plan = _plan  # reuse plan read for batch cap
    if plan and str(plan.get("schema_version")) in ("3", "4", "5") and not allow_unreferenced:
        # v4: look up sequences[]; v3: look up shots[]
        if str(plan.get("schema_version")) in ("4", "5"):
            plan_items = {s.get("sequence_id"): s for s in plan.get("sequences", []) if isinstance(s, dict)}
        else:
            plan_items = {s.get("shot_id"): s for s in plan.get("shots", []) if isinstance(s, dict)}
        from .creation_planning import effective_cast
        missing_anchors: list[str] = []
        for shot in shots:
            # v4 entries use sequence_id as shot_id
            lookup_key = shot.get("shot_id") or shot.get("sequence_id")
            unit = plan_items.get(lookup_key) or {}
            cast_map = {c["id"]: c for c in effective_cast(plan, unit)}
            bound = unit.get("character_ids") or []
            for cid in bound:
                entry = cast_map.get(cid) or {}
                if not str(entry.get("image") or "").strip() or not ctx.resolve(str(entry["image"])).is_file():
                    missing_anchors.append(f"{shot.get('shot_id')}/{entry.get('name') or cid}")
        if missing_anchors:
            raise ValueError(
                "character reference cards missing for: "
                + ", ".join(sorted(set(missing_anchors)))
                + " — generate the cast cards with image_generate BEFORE footage: "
                "text-only prompts let the model re-invent every face and the whole "
                "work drifts. Establish reference cards before generating footage."
            )
    directory = ctx.resolve(args.get("output_dir") or "out/creation/clips")
    with generation_lock(directory):
        path = directory / "takes.json"
        book = read_object(path) or {"version": 2, "takes": {}}
        records = book["takes"]
        requested: dict[str, dict] = {}
        for shot in shots:
            if not isinstance(shot, dict):
                raise ValueError("candidate shots must be objects")
            tid = shot.get("take_id")
            if not isinstance(tid, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,119}", tid):
                raise ValueError("every candidate needs a safe, unique take_id (letters, digits, _, -, .)")
            if tid in requested:
                raise ValueError(f"duplicate take_id: {tid}")
            if not isinstance(shot.get("shot_id"), str) or not shot["shot_id"].strip():
                raise ValueError(f"{tid}: logical shot_id is required")
            if shot.get("continues_from"):
                raise ValueError(f"{tid}: candidate mode uses reference_take_id, not ambiguous continues_from")
            if not str(shot.get("prompt") or shot.get("video_prompt") or "").strip():
                raise ValueError(f"{tid}: prompt is required")
            duration = number(shot.get("duration"))
            _gp = _gens.profile(args.get("model")) if _gens.resolve_name(args.get("model")) else _gens.profile()
            if duration is None or not _gp["min_seconds"] <= duration <= _gp["max_seconds"] or duration != round(duration):
                raise ValueError(f"{tid}: generation duration must be an integer in [{_gp['min_seconds']}, "
                                 f"{_gp['max_seconds']}] for {_gp['name']}")
            if shot.get("reference_mode", "continuation") not in ("continuation", "context"):
                raise ValueError(f"{tid}: reference_mode must be continuation or context")
            requested[tid] = shot

        caps = {k: number(args.get(k)) for k in ("max_total_generations", "max_total_generated_seconds")}
        if any(v is None or v <= 0 for v in caps.values()) or caps["max_total_generations"] != int(caps["max_total_generations"]):
            raise ValueError("candidate mode requires positive max_total_generations and max_total_generated_seconds")
        if book.get("budget") and book["budget"] != caps:
            raise ValueError("run budget differs from takes.json; do not reset caps between batches")
        book["budget"] = caps

        signatures: dict[str, str] = {}
        recipes = {}
        visiting: set[str] = set()
        continuity_sources: dict[str, tuple[Path, str]] = {}

        def _continuity_source(tid: str, upstream: str) -> tuple[Path, str]:
            """The upstream clip whose tail frame carries the world for `continuity_from`.

            A recorded attempt keeps the exact clip bound in its recipe (found by SHA among
            recorded candidates of that unit/take), so a later batch rewriting clips.json
            cannot change or break the identity of an already submitted task."""
            from .creation_media import _selected_clip_path
            bound = (records.get(tid) or {}).get('effective_recipe', {}).get('world_reference_sha256')
            if bound:
                for record in records.values():
                    if (record.get('source_sha256') == bound and record.get('clip')
                            and upstream in (record.get('shot_id'), record.get('take_id'))):
                        path = ctx.resolve(record['clip'])
                        if path.is_file() and file_digest(path) == bound:
                            return path, str(record.get('shot_id') or upstream)
            upstream_take = records.get(upstream)
            if isinstance(upstream_take, dict) and upstream_take.get('status') == 'generated' and upstream_take.get('clip'):
                path = ctx.resolve(upstream_take['clip'])
                if not path.is_file() or file_digest(path) != upstream_take.get('source_sha256'):
                    raise ValueError(f"continuity_from {upstream!r}: recorded candidate changed or is missing")
                return path, str(upstream_take.get('shot_id') or upstream)
            path = _selected_clip_path(ctx, str(directory), upstream)
            if not path.is_file():
                raise ValueError(f"continuity_from {upstream!r}: no selected upstream clip on disk; "
                                 "generate it first or name a recorded take_id")
            return path, upstream

        def fingerprint(tid: str) -> str:
            if tid in signatures:
                return signatures[tid]
            if tid not in requested:
                if tid not in records:
                    raise ValueError(f"reference_take_id {tid!r} is neither recorded nor in this batch")
                return records[tid]["request_sha256"]
            if tid in visiting:
                raise ValueError("reference_take_id forms a cycle")
            visiting.add(tid)
            shot = requested[tid]
            recipe = copy.deepcopy(shot)
            recipe["plan_unit_sha256"] = shot_plan_digest(plan, next((u for u in (plan.get("sequences") or plan.get("shots") or []) if (u.get("sequence_id") or u.get("shot_id")) == shot["shot_id"]), {}), ctx) if plan else None
            recipe.pop("take_id", None)
            for key in ("dialogue_audio", "voice_ref", "inner_audio"):
                val = shot.get(key)
                if isinstance(val, list):            # one file per speaker (Audio 1, 2, ...)
                    recipe[key] = [file_digest(ctx.resolve(str(v))) for v in val if v]
                elif val:
                    recipe[key] = file_digest(ctx.resolve(str(val)))
            from .creation_planning import shot_review_context
            unit = next((u for u in (plan.get('sequences') or plan.get('shots') or []) if (u.get('sequence_id') or u.get('shot_id')) == shot['shot_id']), {}) if plan else {}
            recipe['context'] = shot_review_context(plan or {}, unit, ctx)
            for key in ('motion_ref', 'edit_from'):
                parent_id = shot.get(key)
                if parent_id:
                    parent_record = records.get(parent_id)
                    if not parent_record or parent_record.get('status') != 'generated':
                        raise ValueError(f'{key} must identify a generated, recorded take')
                    source = ctx.resolve(parent_record.get('clip') or str(directory / f'{parent_id}.mp4'))
                    if not source.is_file() or file_digest(source) != parent_record.get('source_sha256'):
                        raise ValueError(f'{key} candidate changed or is missing')
                    recipe[key] = {'take_id': parent_id, 'source_sha256': file_digest(source), 'request_sha256': parent_record.get('request_sha256'), 'task_id': parent_record.get('task_id')}
            for reference in recipe.get("reference_images", []):
                if reference.get("path") and not reference["path"].startswith(("http://", "https://", "data:")):
                    reference["sha256"] = file_digest(ctx.resolve(reference["path"]))
            for frame in recipe.get("keyframes", []):
                if isinstance(frame, dict) and frame.get("image"):
                    frame["image_sha256"] = file_digest(ctx.resolve(frame["image"]))
            if any(isinstance(frame, str) for frame in recipe.get("keyframes", [])):
                recipe["keyframe_sha256"] = [file_digest(ctx.resolve(frame)) for frame in recipe["keyframes"] if isinstance(frame, str)]
            parent = shot.get("reference_take_id")
            if parent:
                if not isinstance(parent, str):
                    raise ValueError("reference_take_id must be text")
                recipe["parent_request_sha256"] = fingerprint(parent)
            profile = _gens.profile(args.get('model'))
            endpoint = _gens.ENDPOINT_LABEL
            recipe['provider'] = {k: profile[k] for k in ('name', 'model', 'dialect')}
            recipe['endpoint'] = endpoint
            recipe['settings'] = {k: v for k, v in args.items() if k not in EXECUTION_ONLY_SETTINGS}
            from .creation_media import _plan_style_bible, INJECT_APPEARANCE, INJECT_CONTINUITY, INJECT_SEQUENCE_CONTINUITY
            recipe['effective_style_bible'] = _plan_style_bible(ctx, args)
            recipe['compiler_flags'] = [INJECT_APPEARANCE, INJECT_CONTINUITY, INJECT_SEQUENCE_CONTINUITY]
            recipe['compiler_sha256'] = file_digest(Path(__file__).with_name('creation_media.py'))
            if shot.get('continuity_from'):
                source, upstream_unit = _continuity_source(tid, shot['continuity_from'])
                recipe['world_reference_sha256'] = file_digest(source)
                continuity_sources[tid] = (source, upstream_unit)
            previous = records.get(tid, {})
            original = previous.get('effective_recipe', {})
            if original and _identity_view(original) == _identity_view(recipe):
                # Execution-only controls (concurrency, batch cap) never reached the
                # provider; keep the recorded values so the identity stays stable.
                if isinstance(original.get('settings'), dict):
                    recipe['settings'] = copy.deepcopy(original['settings'])
                # Collect the immutable old request after a compiler upgrade. This
                # does not authorize recompiling/resubmitting a submitted attempt.
                if previous.get('task_id') or task_ids.get(tid) or previous.get('status') == 'generated':
                    recipe['compiler_sha256'] = original.get('compiler_sha256')
            recipes[tid] = recipe
            signatures[tid] = digest(recipe)
            visiting.remove(tid)
            return signatures[tid]

        task_ids = read_object(directory / "task_ids.json")
        for tid in requested:
            signature = fingerprint(tid)
            old = records.get(tid)
            target = directory / f"{tid}.mp4"
            if old:
                if args.get("force") or old["request_sha256"] != signature:
                    raise ValueError(f"{tid}: immutable candidate; use a new take_id for a changed prompt/reference or retry")
                if target.is_file() and old.get("source_sha256") != file_digest(target):
                    raise ValueError(f"{tid}: candidate bytes changed since recording; use a new take_id")
                if not target.is_file() and not (task_ids.get(tid) or old.get('task_id')):
                    raise ValueError(f"{tid}: prior attempt has no recoverable task; retry with a new take_id")
            elif target.exists():
                raise ValueError(f"{tid}: untracked file already exists; choose a new take_id")
        # Referenced material must still be the exact candidate recorded, even
        # when its presigned provider URL can be refreshed successfully.
        for shot in shots:
            parent = shot.get("reference_take_id")
            old = records.get(parent, {})
            if old.get("source_sha256"):
                parent_path = ctx.resolve(old.get("clip") or str(directory / f"{parent}.mp4"))
                if not parent_path.is_file() or file_digest(parent_path) != old["source_sha256"]:
                    raise ValueError(f"reference candidate {parent!r} is missing or changed")

        new = {tid: shot for tid, shot in requested.items() if tid not in records}
        count = len(records) + len(new)
        seconds = sum(number(r.get("duration")) or 0 for r in records.values()) + sum(s["duration"] for s in new.values())
        if count > caps["max_total_generations"] or seconds > caps["max_total_generated_seconds"]:
            raise ValueError("generation budget exhausted; reselect/edit existing takes or revise the directing plan")
        for tid, shot in new.items():
            records[tid] = {"shot_id": shot["shot_id"], "take_id": tid,
                            "duration": shot["duration"], "request_sha256": signatures[tid],
                            "reference_take_id": shot.get("reference_take_id"),
                            "effective_recipe": recipes[tid], "plan_unit_sha256": recipes[tid]["plan_unit_sha256"],
                            "provider": _gp["name"], "model": args.get("model"),
                            "reference_files": {str(ctx.resolve(ref["path"])): file_digest(ctx.resolve(ref["path"]))
                                                for ref in shot.get("reference_images", []) if ref.get("path")},
                            "status": "reserved"}
        write_object(path, book)

        compiled = copy.deepcopy(args)
        compiled["force"] = False
        compiled["shots"] = []
        for tid, shot in requested.items():
            # The generator keys everything off shot_id, so a take is submitted under its
            # take id — but the directing plan is still keyed by the PLAN shot id, and the
            # prompt augmenter needs it to find this shot's framing, continuity and
            # speaker. Carry it along or the appearance/continuity injectors silently
            # degrade in versioned runs (observed in v10: close-ups fell back to the trait
            # list and the continuity block vanished entirely). An EXPLICIT plan_shot_id
            # wins — overwriting it (05 修复) silently detached a take from its plan unit
            # and killed the cast_states state-card swap.
            item = dict(shot, shot_id=tid, plan_shot_id=shot.get("plan_shot_id") or shot["shot_id"])
            if records[tid].get('task_id'):
                item['_recover_task_id'] = records[tid]['task_id']
            if tid in continuity_sources:
                # The generator attaches exactly the upstream clip bound in the identity.
                item['_continuity_clip'] = str(continuity_sources[tid][0])
                item['_continuity_unit'] = continuity_sources[tid][1]
            if shot.get("reference_take_id"):
                item["continues_from"] = shot["reference_take_id"]
            compiled["shots"].append(item)
        snapshot = file_digest(_pp) if _pp.is_file() else None
        dependency_files = {}
        from .file_contract import input_paths
        for source in input_paths(args, ctx):
            dependency_files[source] = file_digest(source)
        for candidate in recipes.values():
            for source in input_paths(candidate, ctx):
                dependency_files[source] = file_digest(source)
        compiled['_dependency_sha256'] = {str(p): sha for p, sha in dependency_files.items()}
        result = generate(compiled, ctx)
        if (snapshot is not None and file_digest(_pp) != snapshot) or any(not source.is_file() or file_digest(source) != sha for source, sha in dependency_files.items()):
            raise ValueError('generation dependencies changed during execution; submitted tasks remain recoverable, restore dependencies before collecting')
        task_ids = read_object(directory / "task_ids.json")
        persisted = read_object(path).get("takes", {})
        for tid in requested:
            for field in ('submitted_body_sha256', 'submitted_body', 'submitted_reference_sha256', 'submitted_audio_provenance', 'submitted_payload_sha256'):
                if field in persisted.get(tid, {}):
                    records[tid][field] = persisted[tid][field]
            if persisted.get(tid, {}).get("task_id"):
                records[tid]["task_id"] = persisted[tid]["task_id"]
        for row in result.data.get("clips", []):
            tid = row["shot_id"]
            row.update(take_id=tid, shot_id=requested[tid]["shot_id"],
                       source_sha256=file_digest(ctx.resolve(row["clip"])),
                       request_sha256=signatures[tid])
            row["speech_in_clip"] = bool(requested[tid].get("dialogue_audio") or row.get("inner_in_clip"))
            records[tid].update(row, status="generated")
        for row in result.data.get("failures", []):
            tid = row.get("shot_id")
            if tid in requested:
                row.update(take_id=tid, shot_id=requested[tid]["shot_id"])
                records[tid].update(status="failed", error=row.get("error"))
                if task_ids.get(tid):
                    records[tid]["task_id"] = task_ids[tid]
        book["reserved_generations"] = count
        book["reserved_seconds"] = seconds
        write_object(path, book)
        result.data["takes_path"] = ctx.virtualize(path)
        result.data["budget"] = {**caps, "reserved_generations": count, "reserved_seconds": seconds}
        result.artifacts.append(ctx.virtualize(path))
        output = ctx.resolve(args.get("output_json") or "out/creation/clips.json")
        write_object(output, result.data)
        return result


# ---------------------------------------------------------------------------
# Creation production support.
#
# video generator re-renders the reference audio instead of copying it — a correct
# Production contract; see video-creation references for rationale.
# 台词 "坐主桌" surfaced as "做主死计"; the TTS wav itself verified clean).
# creation_evidence_clips transcribes every clip's audio track and compares it
# against the scripted dialogue, homophone-tolerant; failed clips must be
# regenerated before assembly.
# ---------------------------------------------------------------------------

# ASR 高频同音转写组 (归一到组首字再比对; 只收确定同音的常用组)
_HOMOPHONE_GROUPS = (
    "坐做作", "他她它", "的地得", "在再", "以已", "象像", "须需", "带戴",
    "城成", "进近", "义议易", "声生升", "世市事式势视试士", "新心欣",
    "工公功攻", "及级极急", "员圆原源", "现线限", "至致质", "做作坐", "湖胡",
)

def _homophone_map() -> dict[str, str]:
    table: dict[str, str] = {}
    for group in _HOMOPHONE_GROUPS:
        head = group[0]
        for ch in group:
            table.setdefault(ch, head)
    return table


_CN_DIGITS = "零一二三四五六七八九"
_CN_UNITS = ("", "十", "百", "千")
_NUM_RE = re.compile(r"\d+(?:\.\d+)?")


def _int_to_chinese(digits: str) -> str:
    """阿拉伯数字串 → 口语汉字读法: 300→三百, 160→一百六十, 15→十五, 2005→二千零五。
    前导零 / 五位以上 (年份、编号、电话) 逐位读: 007→零零七, 2024→二零二四 不适用
    (四位仍按数值读, ASR 对"两千零二十四"也是这么转的)。"""
    if len(digits) > 4 or (len(digits) > 1 and digits[0] == "0"):
        return "".join(_CN_DIGITS[int(d)] for d in digits)
    n = int(digits)
    if n < 10:
        return _CN_DIGITS[n]
    out, zero_pending, L = [], False, len(digits)
    for i, ch in enumerate(digits):
        d, unit = int(ch), _CN_UNITS[L - 1 - i]
        if d == 0:
            zero_pending = True
            continue
        if zero_pending and out:
            out.append("零")
        zero_pending = False
        if not (d == 1 and unit == "十" and i == 0):  # 十五, 不是一十五
            out.append(_CN_DIGITS[d])
        out.append(unit)
    return "".join(out)


def _numbers_to_chinese(text: str) -> str:
    'numbers to chinese.'
    def rep(m):
        raw = m.group(0)
        if "." in raw:
            a, b = raw.split(".", 1)
            return _int_to_chinese(a) + "点" + "".join(_CN_DIGITS[int(d)] for d in b)
        return _int_to_chinese(raw)
    return _NUM_RE.sub(rep, text)


# Production contract; see video-creation references for rationale.
# 不走了」, 连原始 TTS wav 也被转成「跪在这不走了」, 白吃一个编辑距离) — 比对前两边都去掉后缀
# 「儿」。「儿」作实义语素的词 (女儿/儿子/婴儿/孤儿…) 保留: 前字或后字命中白名单就不删。
_ERHUA_KEEP_PREV = set("女婴幼孤男健少育胎宠娇孩")
_ERHUA_KEEP_NEXT = set("子女童媳孙时戏歌")


def _strip_erhua(text: str) -> str:
    out = []
    n = len(text)
    for i, ch in enumerate(text):
        if ch == "儿" and i > 0:
            prev = text[i - 1]
            nxt = text[i + 1] if i + 1 < n else ""
            if prev not in _ERHUA_KEEP_PREV and (not nxt or nxt not in _ERHUA_KEEP_NEXT):
                continue
        out.append(ch)
    return "".join(out)


def speech_normalize(text: str) -> str:
    """数字→汉字读法, 去标点/空白/非汉字, 去儿化后缀, 同音组归一。"""
    table = _homophone_map()
    text = _numbers_to_chinese(str(text or ""))
    han = "".join(ch for ch in text if ("一" <= ch <= "鿿") or ch.isalnum()).lower()
    return "".join(table.get(ch, ch) for ch in _strip_erhua(han))


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def _protected_spans(t_norm: str, protected) -> list[tuple[int, int]]:
    """专名 (归一后 ≥2 字) 在归一 target 里的所有出现区间 [a, b), 重叠合并。"""
    spans: list[tuple[int, int]] = []
    for term in protected or ():
        tn = speech_normalize(term)
        if len(tn) < 2:
            continue
        start = 0
        while True:
            k = t_norm.find(tn, start)
            if k < 0:
                break
            spans.append((k, k + len(tn)))
            start = k + 1
    spans.sort()
    merged: list[tuple[int, int]] = []
    for a, b in spans:
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    return merged


def _levenshtein_attributed(t: str, h: str, spans: list[tuple[int, int]]) -> tuple[int, int]:
    """编辑距离, 并把落在 spans (target 索引区间) 内的错误记为可豁免。返回 (raw, adjusted)。
    每个区间最多豁免 len+1 个错误: 专名可以被 ASR 读成同长度的别字
    (申屠岳→沈图月 三字全换), 但不能借专名的名义塞进一整句。"""
    n, m = len(t), len(h)
    D = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        D[i][0] = i
    for j in range(1, m + 1):
        D[0][j] = j
    for i in range(1, n + 1):
        ti = t[i - 1]
        for j in range(1, m + 1):
            D[i][j] = min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (ti != h[j - 1]))
    raw = D[n][m]
    if not spans or raw == 0:
        return raw, raw
    errs_at: dict[int, int] = {}
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and D[i][j] == D[i - 1][j - 1] + (t[i - 1] != h[j - 1]):
            if t[i - 1] != h[j - 1]:
                errs_at[i - 1] = errs_at.get(i - 1, 0) + 1
            i -= 1
            j -= 1
        elif i > 0 and D[i][j] == D[i - 1][j] + 1:      # target 字被吞
            errs_at[i - 1] = errs_at.get(i - 1, 0) + 1
            i -= 1
        else:                                            # heard 多出一字, 记到相邻 target 位
            idx = max(i - 1, 0)
            errs_at[idx] = errs_at.get(idx, 0) + 1
            j -= 1
    forgiven = 0
    for a, b in spans:
        inside = sum(c for k, c in errs_at.items() if a <= k < b)
        forgiven += min(inside, (b - a) + 1)
    return raw, max(0, raw - forgiven)


def speech_verdict_detail(target: str, heard: str, protected=()) -> dict:
    'speech verdict detail.'
    t, h = speech_normalize(target), speech_normalize(heard)
    if not t:
        ok = len(h) <= 3
        return {"verdict": "pass" if ok else "fail", "similarity": 1.0 if ok else 0.0,
                "distance": 0 if ok else len(h), "distance_raw": 0 if ok else len(h), "forgiven": 0}
    if not h:
        return {"verdict": "fail", "similarity": 0.0, "distance": len(t), "distance_raw": len(t), "forgiven": 0}
    raw, dist = _levenshtein_attributed(t, h, _protected_spans(t, protected))
    sim = 1.0 - dist / max(len(t), len(h))
    # 容错随句长缩放 (1012): 原先任何长度错 2 字即 fail, 阈值按 <=15 字的短剧台词标定;
    # 上百字的采访回答/讲解长句几乎必有 >=2 字的 ASR 偏差。<25 字与原口径完全一致。
    allow = max(1, int(len(t) * 0.08))
    if dist == 0:
        verdict = "pass"
    elif len(t) <= 5 or dist > allow:
        verdict = "fail"
    else:
        verdict = "warn"
    return {"verdict": verdict, "similarity": sim, "distance": dist,
            "distance_raw": raw, "forgiven": raw - dist}


def speech_verdict(target: str, heard: str, protected=()) -> tuple[str, float]:
    """(verdict, similarity) — speech_verdict_detail 的简版。"""
    d = speech_verdict_detail(target, heard, protected)
    return d["verdict"], d["similarity"]


def _cache_matches(data, clip):
    if not isinstance(data, dict) or clip is None or not clip.is_file():
        return False
    from .media import ASR_CHUNK_SECONDS
    return data.get('source_video_sha256') == file_digest(clip) and data.get('recognition_parameters') == {'language': 'zh', 'chunk_seconds': ASR_CHUNK_SECONDS, 'provider': 'asr'}


def _cache_candidates(asr_dir, seq_id: str, clip: Path | None) -> list[Path]:
    """Transcript cache files in lookup order. `asr_dir` may be one directory or several
    (the shared ASR cache, then the speech check's own work dir where fresh transcripts land)."""
    dirs = list(asr_dir) if isinstance(asr_dir, (list, tuple)) else [asr_dir]
    names = [f"{seq_id}.json", f"{seq_id}_clip.json"] + ([f"{clip.stem}.transcript.json"] if clip else [])
    return [Path(d) / name for d in dirs for name in names]


def _load_cached_transcript(asr_dir, seq_id: str, clip: Path) -> str | None:
    # 两种缓存命名: creation_evidence_clips 自己写的 <SEQ>.json, 以及 media.transcribe
    # Production contract; see video-creation references for rationale.
    for cached in _cache_candidates(asr_dir, seq_id, clip):
        if not cached.is_file() or not clip.is_file():
            continue
        try:
            data = json.loads(cached.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not _cache_matches(data, clip):
            continue
        if isinstance(data.get('text'), str):
            return data['text']
        if isinstance(data.get('segments'), list):
            return ''.join(str(row.get('text') or '') for row in data['segments'] if isinstance(row, dict))
    return None


def _transcribe_clip(clip: Path, work_dir: Path):
    """音轨转写 (可被测试 monkeypatch)。返回转写文本或 None。"""
    from .media import transcribe
    from .run_context import RunContext
    work_dir.mkdir(parents=True, exist_ok=True)
    result = transcribe({"input_path": str(clip), "output_json": str(work_dir / (clip.stem + ".transcript.json"))}, RunContext())
    if result.failed:
        return None
    payload = json.loads((work_dir / (clip.stem + ".transcript.json")).read_text())
    rows = payload.get("segments") or payload.get("utterances") or []
    text = payload.get('text')
    return text if isinstance(text, str) and text.strip() else "".join(str(u.get("text", "")) for u in rows if isinstance(u, dict))


def _speech_only_wav(clip: Path, segments: list, out: Path, pad: float = 0.12) -> tuple[Path | None, float]:
    'speech only wav.'
    import math
    import subprocess
    import tempfile
    from .media import media_duration_seconds
    from .file_contract import publish_files
    from .file_contract import protect_outputs
    protect_outputs([out], {clip})
    duration = media_duration_seconds(clip)
    if not duration or duration <= 0:
        return None, 0.0
    spans = []
    for seg in segments or []:
        try:
            a, b = float(seg.get('start')), float(seg.get('end'))
        except (AttributeError, TypeError, ValueError):
            continue
        if not math.isfinite(a) or not math.isfinite(b) or b <= a:
            continue
        a, b = max(0.0, a - pad), min(duration, b + pad)
        if b > a:
            spans.append((a, b))
    merged = []
    for a, b in sorted(spans):
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    if sum(b - a for a, b in merged) < .3:
        return None, 0.0
    with tempfile.TemporaryDirectory(prefix='speechonly-') as raw:
        tmp = Path(raw)
        parts = []
        for i, (a, b) in enumerate(merged):
            part = tmp / f'p{i:03d}.wav'
            r = subprocess.run(['ffmpeg', '-nostdin', '-y', '-v', 'error', '-i', str(clip),
                                '-ss', f'{a:.3f}', '-t', f'{b-a:.3f}', '-vn', '-ac', '1', '-ar', '16000', str(part)],
                               capture_output=True, timeout=60)
            actual = media_duration_seconds(part) if r.returncode == 0 else None
            if not actual or abs(actual - (b-a)) > .08:
                return None, 0.0
            parts.append(part)
        listing = tmp / 'list.txt'
        listing.write_text(''.join(f"file '{p.as_posix()}'\n" for p in parts))
        staged = tmp / 'speech.wav'
        r = subprocess.run(['ffmpeg', '-nostdin', '-y', '-v', 'error', '-f', 'concat', '-safe', '0',
                            '-i', str(listing), '-c', 'copy', str(staged)], capture_output=True, timeout=60)
        actual = media_duration_seconds(staged) if r.returncode == 0 else None
        if not actual or abs(actual - sum(b-a for a,b in merged)) > .08:
            return None, 0.0
        publish_files({out: staged})
        return out, actual


VOICE_CARD_SUSPECT = audio_identity.thresholds()[1]  # follows VE_SPEAKER_SCORER
VOICE_MIN_SPEECH_S = 3.0  # <3s 人声评分是噪声, 不能下重判 (thin evidence)


def _fingerprint_sim(a: Path, b: Path, ctx):
    'fingerprint sim.'
    try:
        from .audio_identity import voice_similarity
        r = voice_similarity({"audio_a": str(a), "audio_b": str(b)}, ctx)
        sim = (r.data or {}).get("similarity")
        if sim is None:
            return None, str(r.text)[:120]
        return sim, None
    except Exception as exc:  # noqa: BLE001
        return None, f"{type(exc).__name__}: {str(exc)[:100]}"


VOICE_CARD_FAIL = audio_identity.thresholds()[0]  # follows VE_SPEAKER_SCORER


def _voice_cards_from_plan(plan: dict) -> dict[str, str]:
    """Each speaking character's voice_card: a sample in its fixed preset voice."""
    cards = {}
    for c in plan.get("cast") or []:
        if isinstance(c, dict) and c.get("name") and c.get("voice_card"):
            cards[str(c["name"])] = str(c["voice_card"])
    return cards


def _protected_terms_from_plan(plan: dict, extra=()) -> list[str]:
    """台词核对时豁免的专名: 角色名/别名、场景名、剧本级 proper_nouns/glossary、调用方追加。
    只收归一后 ≥2 字的词 (单字豁免等于放水)。"""
    terms: list[str] = []
    for c in plan.get("cast") or []:
        if isinstance(c, dict):
            terms.append(str(c.get("name") or ""))
            terms.extend(str(a) for a in (c.get("aliases") or []) if a)
    for sc in plan.get("scenes") or []:
        if isinstance(sc, dict):
            # 场景名多是复合词「沉星湖北岸渔村」「霁京·摄政王殿」, 台词里只叫「沉星湖」「霁京」:
            # 按分隔符拆开, 每段再收 ≥3 字的前缀 (中文地名核心在前)。v4 用 name, v2 用 location。
            for key in ("name", "location", "title"):
                for part in re.split(r"[·・．.\-—/／、,，:：\s]+", str(sc.get(key) or "")):
                    part = part.strip()
                    if len(part) >= 2:
                        terms.append(part)
                        terms.extend(part[:k] for k in range(3, len(part)))
            terms.extend(str(a) for a in (sc.get("aliases") or []) if a)
    for pr in plan.get("props") or []:              # 道具名 (v2): 兵器/信物常是自造词
        if isinstance(pr, dict):
            terms.append(str(pr.get("name") or ""))
    for key in ("proper_nouns", "glossary"):
        terms.extend(str(x) for x in (plan.get(key) or []) if x)
        ep = plan.get("episode")
        if isinstance(ep, dict):
            terms.extend(str(x) for x in (ep.get(key) or []) if x)
    terms.extend(str(x) for x in (extra or ()) if x)
    seen, out = set(), []
    for term in terms:
        tn = speech_normalize(term)
        if len(tn) >= 2 and tn not in seen:
            seen.add(tn)
            out.append(term)
    return out


def _segments_for(asr_dir, sid: str, heard, clip: Path | None = None) -> list:
    for cached in _cache_candidates(asr_dir, sid, clip):
        if not cached.is_file():
            continue
        try:
            data = json.loads(cached.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not _cache_matches(data, clip):
            continue
        segs = data.get("segments") or data.get("utterances") or []
        if segs:
            return [x for x in segs if isinstance(x, dict)]
    # 缓存没有时间戳 (旧格式) — 用 words 拼段
    for cached in _cache_candidates(asr_dir, sid, clip):
        if cached.is_file():
            try:
                data = json.loads(cached.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if not _cache_matches(data, clip):
                continue
            words = data.get("words") or []
            if words and isinstance(words[0], dict) and words[0].get("start") is not None:
                spans = []
                cur = None
                for w in words:
                    a, b = w.get("start"), w.get("end")
                    if a is None or b is None:
                        continue
                    if cur and a - cur["end"] <= 0.6:
                        cur["end"] = max(cur["end"], b)
                    else:
                        cur = {"start": a, "end": b}
                        spans.append(cur)
                if spans:
                    return spans
    return []



def _segments_from_words(words: list) -> list[dict]:
    """words[] (带 speaker 标签) → 伪 segments: 同标签、间隔 ≤0.6s 的词连成一段。"""
    segs: list[dict] = []
    for w in words or []:
        if not isinstance(w, dict):
            continue
        try:
            a, b = float(w.get("start")), float(w.get("end"))
        except (TypeError, ValueError):
            continue
        if b <= a:
            continue
        lab = str(w.get("speaker") or "").strip()
        txt = str(w.get("text") or "")
        if segs and segs[-1]["speaker"] == lab and a - segs[-1]["end"] <= 0.6:
            segs[-1]["end"] = max(segs[-1]["end"], b)
            segs[-1]["text"] += txt
        else:
            segs.append({"speaker": lab, "start": a, "end": b, "text": txt})
    return segs


ASR_TEXT_ALIGN_MIN = 0.5  # 段落与台词的归一字符重合率下限 (分母取短的一方)


SPLIT_LINE_MATCH_MIN = 0.6  # a scripted line is "found" inside a segment when this share of it aligns


def _split_segment_by_lines(seg: dict, lines: list) -> list[dict]:
    """Split one ASR segment that carries lines of two or more scripted speakers.

    Diarization merges back-to-back lines into one segment when the speakers follow each other
    without a pause (11-06 S04: 「人会走…也天天聚。我不喜欢散。」 came back as ONE speaker-2
    segment, so the whole span went to 心月狐 by character overlap and 漂泊者 was reported as
    no_speech on a take that had voiced his line). With word timings the segment can be cut at
    the line boundaries instead: each scripted line is located as the longest aligned run of
    the segment's normalized text, and the words under that run become that line's own span.
    Returns [seg] unchanged when the segment has no word timings or holds lines of only one
    speaker.
    """
    from difflib import SequenceMatcher
    words = [w for w in (seg.get("words") or []) if isinstance(w, dict)]
    chars: list[str] = []
    owner: list[int] = []
    timed: list[tuple[float, float]] = []
    for w in words:
        try:
            wa, wb = float(w.get("start")), float(w.get("end"))
        except (TypeError, ValueError):
            return [seg]
        wi = len(timed)
        timed.append((wa, wb))
        for ch in speech_normalize(w.get("text") or ""):
            chars.append(ch)
            owner.append(wi)
    if not chars:
        return [seg]
    text = "".join(chars)
    found: list[tuple[int, int, str]] = []
    for name, ln, _lset in lines:
        if not ln or len(ln) > len(text):
            continue
        # Best window of the line's length (ASR homophones such as 集市/即使 break exact
        # substring search; a ratio over the window tolerates them).
        best, best_ratio = None, 0.0
        for start in range(0, len(text) - len(ln) + 1):
            r = SequenceMatcher(None, text[start:start + len(ln)], ln, autojunk=False).ratio()
            if r > best_ratio:
                best, best_ratio = start, r
        if best is None or best_ratio < SPLIT_LINE_MATCH_MIN:
            continue
        found.append((best, best + len(ln), name))
    found.sort()
    if len({n for _a, _b, n in found}) < 2:
        return [seg]
    pieces: list[dict] = []
    cursor = 0
    for start, end, name in found:
        start = max(start, cursor)
        if end <= start:
            continue
        pieces.append({"a": timed[owner[start]][0], "b": timed[owner[end - 1]][1],
                       "text": text[start:end], "label": seg["label"],
                       "split_from": (seg["a"], seg["b"])})
        cursor = end
    return pieces or [seg]


def assign_asr_speakers(segments: list, dialogue: list) -> dict:
    'assign asr speakers.'
    lines: list[tuple[str, str, set]] = []
    for d in dialogue or []:
        if isinstance(d, dict) and d.get("speaker") and d.get("line"):
            ln = speech_normalize(d["line"])
            if ln:
                lines.append((str(d["speaker"]), ln, set(ln)))
    segs: list[dict] = []
    for s in segments or []:
        if not isinstance(s, dict):
            continue
        try:
            a, b = float(s.get("start")), float(s.get("end"))
        except (TypeError, ValueError):
            continue
        if b <= a:
            continue
        seg = {"a": a, "b": b, "text": speech_normalize(s.get("text") or ""),
               "label": str(s.get("speaker") or "").strip(), "words": s.get("words") or []}
        segs.extend(_split_segment_by_lines(seg, lines) if len({n for n, _, _ in lines}) > 1 else [seg])

    assigned: list[tuple[dict, str, str]] = []
    votes: dict[str, dict[str, float]] = {}
    pending: list[dict] = []
    for seg in segs:
        chars = set(seg["text"])
        best, best_score = None, 0.0
        if len(chars) >= 2:
            for name, _ln, lset in lines:
                score = len(chars & lset) / max(1, min(len(chars), len(lset)))
                if score > best_score:
                    best, best_score = name, score
        if best is not None and best_score >= ASR_TEXT_ALIGN_MIN:
            assigned.append((seg, best, "text"))
            if seg["label"]:
                bucket = votes.setdefault(seg["label"], {})
                bucket[best] = bucket.get(best, 0.0) + (seg["b"] - seg["a"])
        else:
            pending.append(seg)
    label_map = {lab: max(v, key=v.get) for lab, v in votes.items() if v}
    unassigned: list[dict] = []
    for seg in pending:
        name = label_map.get(seg["label"]) if seg["label"] else None
        if name:
            assigned.append((seg, name, "label"))
        else:
            unassigned.append(seg)
    names = {n for n, _, _ in lines}
    if len(names) == 1 and unassigned:
        # One scripted speaker: short interjections stay theirs (speech spans for the voice
        # score), but a segment with 3+ CJK chars that aligns with no scripted line is
        # off-script speech and is reported as unassigned instead of silently absorbed.
        only = next(iter(names))
        keep: list[dict] = []
        for seg in unassigned:
            if len(seg["text"]) >= 3:
                keep.append(seg)
            else:
                assigned.append((seg, only, "only_speaker"))
        unassigned = keep

    spans: dict[str, list[tuple[float, float]]] = {}
    labels_of: dict[str, set] = {}
    off_script: list[dict] = []
    for seg, name, how in assigned:
        spans.setdefault(name, []).append((seg["a"], seg["b"]))
        if seg["label"]:
            labels_of.setdefault(name, set()).add(seg["label"])
        # Attributed by voice label only (no scripted text matched) and long enough to be
        # words rather than an interjection: the speaker said something that is not in the
        # script (11-06 S09: the generator voiced the action note 「没有回头」).
        if how != "text" and len(seg["text"]) >= 3:
            off_script.append({"start": seg["a"], "end": seg["b"], "text": seg["text"], "speaker": name})
    for name in spans:
        spans[name].sort()
    return {"spans": spans, "label_map": label_map,
            "labels_of": {k: sorted(v) for k, v in labels_of.items()},
            "unassigned": [{"start": s["a"], "end": s["b"], "text": s["text"], "label": s["label"]}
                           for s in unassigned],
            "off_script": off_script,
            "method": "text_align+label_vote"}


def _multi_speaker_voice_check(clip: Path, asr_dir, sid: str,
                                speakers: list, card_by_name: dict, work_dir: Path, ctx,
                                dialogue: list | None = None, evidence_key: str | None = None):
    'multi speaker voice check.'
    segments = None
    for cached in _cache_candidates(asr_dir, sid, clip):
        if not cached.is_file():
            continue
        try:
            data = json.loads(cached.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not _cache_matches(data, clip):
            continue
        segs = [s for s in (data.get("segments") or []) if isinstance(s, dict)]
        if not segs:
            segs = _segments_from_words(data.get("words") or [])
        if segs:
            segments = segs
            break
    if not segments:
        return None

    active = [sp for sp in speakers if sp in card_by_name and
              ctx.resolve(str(card_by_name[sp])).is_file()]
    if not active:
        return None

    if dialogue:
        assign = assign_asr_speakers(segments, dialogue)
    else:  # no script lines to align against: trust labels that already ARE names
        assign = {"spans": {}, "label_map": {}, "labels_of": {}}
        for s in segments:
            lab = str(s.get("speaker") or "").strip()
            try:
                a, b = float(s.get("start")), float(s.get("end"))
            except (TypeError, ValueError):
                continue
            if lab in active and b > a:
                assign["spans"].setdefault(lab, []).append((a, b))
    label_map = assign.get("label_map") or {}
    spans_by_speaker = {sp: list(assign["spans"].get(sp) or []) for sp in active}
    for spk in list(spans_by_speaker):
        merged = []
        for a, b in sorted(spans_by_speaker[spk]):
            if merged and a <= merged[-1][1] + 0.1:
                merged[-1][1] = max(merged[-1][1], b)
            else:
                merged.append([a, b])
        spans_by_speaker[spk] = [(a, b) for a, b in merged]

    results = []
    for spk in active:
        spans = spans_by_speaker[spk]
        total_s = sum(b - a for a, b in spans)
        if total_s < 0.6 or not spans:
            results.append({"speaker": spk, "status": "thin",
                           "speech_seconds": round(total_s, 1),
                           "note": "only %.1fs of speech" % total_s})
            continue

        out_wav = work_dir / f"{evidence_key or sid}_{speakers.index(spk)}_spk.wav"
        sw, ss = _speech_only_wav(
            clip, [{"start": a, "end": b} for a, b in spans], out_wav)
        if sw is None:
            results.append({"speaker": spk, "status": "skipped",
                           "reason": "speech extraction failed"})
            continue

        total_s = ss
        card_path = ctx.resolve(str(card_by_name[spk]))
        sim, err = _fingerprint_sim(sw, card_path, ctx)
        if sim is None:
            results.append({"speaker": spk, "status": "skipped", "reason": err})
            continue

        if total_s < VOICE_MIN_SPEECH_S:
            results.append({"speaker": spk, "similarity": round(sim, 3),
                           "status": "thin", "speech_seconds": round(total_s, 1),
                           "note": "<3s speech, score unreliable"})
        elif sim < VOICE_CARD_FAIL:
            results.append({"speaker": spk, "similarity": round(sim, 3),
                           "status": "fail", "speech_seconds": round(total_s, 1),
                           "note": "voice does not match the voice card"})
        elif sim < VOICE_CARD_SUSPECT:
            results.append({"speaker": spk, "similarity": round(sim, 3),
                           "status": "borderline", "speech_seconds": round(total_s, 1),
                           "note": "suspect range, listen to confirm"})
        else:
            results.append({"speaker": spk, "similarity": round(sim, 3),
                           "status": "pass", "speech_seconds": round(total_s, 1)})
    for r in results:
        r["asr_labels"] = sorted(lab for lab, nm in label_map.items() if nm == r["speaker"])
    return results


def creation_evidence_clips(args: dict, ctx) -> ToolResult:
    """Transcribe every generated clip and verify the speech against the script.

    Verdicts by mismatched characters after normalisation (homophones, numerals,
    protected proper nouns forgiven): 0 pass / 1 warn (fail on <=5-char lines) /
    >=2 fail -> regenerate the sequence. Clips without dialogue must stay silent
    (stray speech fails). Writes out/creation/clips_verification.json.
    """
    force = bool(args.get("force", False))
    shotlist_path = ctx.resolve(str(args.get("shotlist_path") or "out/creation/shotlist.json"))
    clips_path = ctx.resolve(str(args.get("clips_path") or "out/creation/clips.json"))
    asr_dir = ctx.resolve("out/creation/asr")
    work_dir = ctx.resolve(".video_agent/clip_verify")

    plan = read_object(shotlist_path)
    seqs = plan.get("sequences") or plan.get("shots") or []
    targets: dict[str, str] = {}
    inner_lines: dict[str, str] = {}
    for s in seqs:
        sid = str(s.get("sequence_id") or s.get("shot_id") or "")
        lines = [str(l.get("line") or "") for l in (s.get("dialogue") or [])
                 if isinstance(l, dict) and str(l.get("line") or "").strip()]
        targets[sid] = " ".join(lines)
        _narr = s.get("narration")
        if isinstance(_narr, dict) and str(_narr.get("line") or "").strip():
            inner_lines[sid] = str(_narr["line"]).strip()

    _seq_by_id = {str(x.get("sequence_id") or x.get("shot_id") or ""): x
                  for x in (plan.get("sequences") or plan.get("shots") or []) if isinstance(x, dict)}
    protected = _protected_terms_from_plan(plan, args.get("protected_terms") or ())

    clips_doc = read_object(clips_path)
    clip_rows = clips_doc.get("clips") if isinstance(clips_doc, dict) else clips_doc
    if not isinstance(clip_rows, list) or not clip_rows:
        raise ValueError(f"no clips found in {clips_path} — generate takes first")
    from .creation_planning import safe_unit_id
    for row in clip_rows:
        if not isinstance(row, dict):
            raise ValueError('clip rows must be objects')
        sid = safe_unit_id(row.get('shot_id') or row.get('sequence_id'))
        if sid not in _seq_by_id:
            raise ValueError('clip unit is absent from the current plan')

    from .file_contract import input_paths, protect_outputs, protect_directories
    inputs = input_paths(args, ctx) | input_paths(plan, ctx) | input_paths(clips_doc, ctx)
    protect_directories([work_dir, asr_dir], inputs)
    derived_outputs = []

    def evidence_key(row: dict) -> str:
        # Several takes of one logical unit are checked in one report: derived audio is
        # keyed by the immutable take id so one take never overwrites another's evidence.
        sid = safe_unit_id(row.get('shot_id') or row.get('sequence_id'))
        return safe_unit_id(row['take_id']) if row.get('take_id') else sid

    keys = [evidence_key(row) for row in clip_rows]
    if len(set(keys)) != len(keys):
        raise ValueError('clip rows must identify distinct takes (duplicate take_id/unit without take_id)')
    for row in clip_rows:
        sid = safe_unit_id(row.get('shot_id') or row.get('sequence_id'))
        key = evidence_key(row)
        unit = _seq_by_id[sid]
        speakers = {str(d.get('speaker')) for d in unit.get('dialogue', []) if isinstance(d, dict) and d.get('speaker')}
        derived_outputs.append(work_dir / f'{key}_speech.wav')
        derived_outputs.extend(work_dir / f'{key}_{i}_spk.wav' for i in range(len(speakers) + 1))
    protect_outputs(derived_outputs, inputs)
    # Fresh transcripts land in work_dir; cached ones may live in the shared ASR dir.
    transcript_dirs = (asr_dir, work_dir)
    results, fails, warns = [], [], []
    for row in clip_rows:
        sid = str(row.get("shot_id") or row.get("sequence_id") or "")
        key = evidence_key(row)
        clip_rel = str(row.get("clip") or "")
        clip = ctx.resolve(clip_rel)
        # inner monologue performed in-clip (Audio N, 画外音) is scripted speech too
        row_target = (targets.get(sid) or "").strip()
        if row.get("inner_in_clip") and inner_lines.get(sid):
            row_target = (row_target + " " + inner_lines[sid]).strip()
        entry = {"sequence_id": sid, "clip": clip_rel,
                 "has_dialogue": bool(row_target),
                 **({"take_id": key} if row.get("take_id") else {}),
                 **({"inner_in_clip": True} if row.get("inner_in_clip") else {})}
        if not clip.is_file():
            entry.update(verdict="fail", error="clip file missing", asr=None, similarity=None)
            results.append(entry)
            fails.append(entry)
            continue

        import subprocess
        try:
            probe = subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(clip)], capture_output=True, text=True, timeout=30)
        except (OSError, subprocess.SubprocessError) as exc:
            # 单个 clip 的 ffprobe 超时/失败只让这一条不可判, 不中断整份 speech 报告
            entry.update(verdict="warn", asr=None, similarity=None, cached=False, audio_state="unavailable",
                         error=f"audio probe unavailable: {type(exc).__name__}: {str(exc)[:120]}")
            results.append(entry)
            warns.append(entry)
            continue
        if probe.returncode == 0 and not any(stream.get('codec_type') == 'audio' for stream in json.loads(probe.stdout).get('streams', [])):
            from . import generators as _gens
            if entry['has_dialogue'] and not _gens.profile().get('audio_out', True):
                # The generator returns silent clips by design: the line is laid from its
                # reference audio at assembly, so there is nothing to hear here yet.
                entry.update(verdict='pass', asr='', similarity=None, audio_state='silent_generator', cached=False,
                             note='silent generator output: the scripted line is laid from its reference audio '
                                  'at assembly; judge lip timing on the frames')
                results.append(entry)
                continue
            entry.update(verdict='fail' if entry['has_dialogue'] else 'pass', asr='', similarity=None, audio_state='no_audio_stream', cached=False)
            if entry['has_dialogue']:
                entry['error'] = 'scripted dialogue clip has no audio stream'
                fails.append(entry)
            results.append(entry)
            continue
        heard = None if force else _load_cached_transcript(transcript_dirs, sid, clip)
        cached = heard is not None
        if heard is None:
            try:
                heard = _transcribe_clip(clip, work_dir)
            except Exception as exc:  # noqa: BLE001
                heard = None
                entry["transcribe_error"] = str(exc)[:160]
            if heard is None:
                # 转写通道故障 (ToolResult 失败/异常) != 片子真的没声音。
                # Production contract; see video-creation references for rationale.
                # "no audible speech"; 降级 warn 并提示用 transcribe 工具的缓存/重跑。
                entry.update(verdict="warn", asr=None, similarity=None, cached=False,
                             error="asr unavailable (transcribe channel failed) — check "
                                   "out/creation/asr/ caches or rerun transcribe; not treated "
                                   "as silent-clip failure")
                results.append(entry)
                warns.append(entry)
                continue

        entry["asr"] = heard
        entry["cached"] = cached
        if entry["has_dialogue"]:
            target = row_target
            detail = speech_verdict_detail(target, heard or "", protected)
            verdict, sim = detail["verdict"], detail["similarity"]
            entry["target"] = target
            entry["similarity"] = round(sim, 3)
            if detail["forgiven"]:
                entry["protected_forgiven"] = detail["forgiven"]
                entry["distance_raw"] = detail["distance_raw"]
            if not (heard or "").strip():
                entry.update(verdict="fail", error="dialogue clip has no audible speech")
                fails.append(entry)
            elif verdict == "pass":
                entry["verdict"] = "pass"
            elif verdict == "fail":
                entry.update(verdict="fail", error="speech deviates from the script")
                fails.append(entry)
            else:
                entry.update(verdict="warn", error="speech partially matches")
                warns.append(entry)
        else:
            stray = speech_normalize(heard or "")
            if len(stray) >= 3 and (_seq_by_id.get(sid) or {}).get("ambient_speech_ok"):
                # 计划声明了这里本来就有环境人声 (市集/人群/伴唱/鬼畜素材人声): 记录不判 fail (1012)
                entry.update(verdict="warn", similarity=None,
                             error=f"ambient speech (declared ambient_speech_ok): {str(heard)[:60]}")
                warns.append(entry)
            elif len(stray) >= 3:
                entry.update(verdict="fail", similarity=0.0,
                             error=f"stray speech in a no-dialogue clip: {str(heard)[:60]} — if crowd/"
                                   "background voices are intended here, declare ambient_speech_ok on the unit")
                fails.append(entry)
            else:
                entry.update(verdict="pass", similarity=None)
        # Creation production support.
        _seq = _seq_by_id.get(sid) or {}
        _voice_lines = [l for l in (_seq.get("dialogue") or []) if isinstance(l, dict)]
        _narr = _seq.get("narration")
        if row.get("inner_in_clip") and isinstance(_narr, dict) and _narr.get("speaker") and _narr.get("line"):
            _voice_lines = _voice_lines + [{"speaker": _narr["speaker"], "line": _narr["line"]}]
        speakers = sorted({str(l.get("speaker")) for l in _voice_lines if l.get("speaker")})
        card_by_name = _voice_cards_from_plan(plan)
        try:
            if entry.get("has_dialogue") and len(speakers) == 1 and speakers[0] in card_by_name:
                card_path = ctx.resolve(str(card_by_name[speakers[0]]))
                if card_path.is_file():
                    segments = _segments_for(transcript_dirs, sid, heard, clip)
                    speech_wav, speech_s = _speech_only_wav(
                        clip, segments, work_dir / f"{key}_speech.wav")
                    if speech_wav is None:
                        entry["voice_check"] = {"status": "skipped",
                                                "reason": "no asr-timed speech spans"}
                    else:
                        sim, err = _fingerprint_sim(speech_wav, card_path, ctx)
                        if sim is None:
                            entry["voice_check"] = {"status": "skipped", "reason": err}
                        else:
                            vc = {"similarity": round(sim, 3), "speech_seconds": round(speech_s, 1),
                              "speaker": speakers[0]}
                            if speech_s < VOICE_MIN_SPEECH_S:
                                vc.update(status="thin",
                                          note="<3s speech is noise for fingerprints; listen manually")
                                warns.append(entry)
                            elif sim < VOICE_CARD_FAIL:
                                vc.update(status="fail",
                                          note="voice does not match the character's voice card")
                                entry["verdict"] = "warn"
                                entry["error"] = (entry.get("error") or "") +                                 f"; voice/card similarity {sim:.2f} < {VOICE_CARD_FAIL}"
                                if entry not in warns:
                                    warns.append(entry)
                            elif sim < VOICE_CARD_SUSPECT:
                                vc.update(status="borderline",
                                          note=f"{VOICE_CARD_FAIL}-{VOICE_CARD_SUSPECT} on the "
                                               f"{audio_identity.active_scorer()} scale: report the number")
                                warns.append(entry)
                            else:
                                vc["status"] = "pass"
                            entry["voice_check"] = vc
                else:
                    entry["voice_check"] = {"status": "no_voice_card_file",
                                            "voice_card": str(card_by_name[speakers[0]])}
            elif entry.get("has_dialogue") and len(speakers) > 1:
                multi = _multi_speaker_voice_check(
                    clip, transcript_dirs, sid, speakers, card_by_name, work_dir, ctx,
                    dialogue=_voice_lines, evidence_key=key)
                if multi is not None:
                    entry["voice_check_multi"] = multi
                    for mr in multi:
                        if mr.get("status") == "fail":
                            entry["verdict"] = "warn"
                            entry["error"] = (entry.get("error") or "") +\
                                f"; {mr.get('speaker')}: voice/card {mr.get('similarity')}"
                            if entry not in warns:
                                warns.append(entry)
                            break
                else:
                    entry["voice_check"] = {"status": "skipped",
                                            "reason": "multi-speaker but no ASR speaker labels or voice cards"}
            elif entry.get("has_dialogue"):
                entry["voice_check"] = {"status": "skipped",
                                        "reason": "no voice card for speaker " + (speakers[0] if speakers else "?")}
        except (OSError, subprocess.SubprocessError) as exc:
            # ffmpeg 抽人声段超时/失败: 该 clip 声纹核对降级为 skipped 并记原因, 台词判定照常保留
            entry.pop("voice_check_multi", None)
            entry["voice_check"] = {"status": "skipped",
                                    "reason": f"speech extraction unavailable: {type(exc).__name__}: {str(exc)[:120]}"}
        results.append(entry)

    # ---- best-peer 离群检测: 同角色跨序列, 各 clip 对最近的同类邻居仍远 => 离群 ----
    by_speaker: dict[str, list[tuple[dict, Path]]] = {}
    for entry in results:
        vc = entry.get("voice_check") or {}
        if vc.get("status") in ("pass", "borderline", "thin"):
            wav = work_dir / f"{entry.get('take_id') or entry['sequence_id']}_speech.wav"
            spk = vc.get("speaker")
            if wav.is_file() and spk:
                by_speaker.setdefault(spk, []).append((entry, wav))
    outliers = []
    for spk, members in by_speaker.items():
        if len(members) < 2:
            continue
        for i, (entry, wav) in enumerate(members):
            best, best_sid = None, None
            for j, (other, owav) in enumerate(members):
                if i == j:
                    continue
                sim, err = _fingerprint_sim(wav, owav, ctx)
                if sim is not None and (best is None or sim > best):
                    best, best_sid = sim, other.get("take_id") or other["sequence_id"]
            if best is not None and best < VOICE_CARD_SUSPECT:  # the active scorer's "ok" line
                outliers.append({"sequence_id": entry["sequence_id"], **({"take_id": entry["take_id"]} if entry.get("take_id") else {}),
                                 "speaker": spk,
                                 "best_peer_similarity": round(best, 3),
                                 "best_peer": best_sid,
                                 "note": "closest same-character clip is still far — "
                                         "audibly different takes; regenerate or re-bind the voice card"})
                warns.append(entry)

    # One clip may be flagged by several hints; count each clip once.
    warns = list({id(e): e for e in warns}.values())
    fails = list({id(e): e for e in fails}.values())
    report = {
        "ok": not fails,
        "n_clips": len(results),
        "n_pass": sum(1 for r in results if r["verdict"] == "pass"),
        "n_warn": len(warns),
        "n_fail": len(fails),
        "results": results,
        "voice_outliers": outliers,
    }
    out_path = ctx.resolve(str(args.get("output_json") or "out/creation/clips_verification.json"))
    from .public_surface import public_data, source_fragments
    quoted = [str(r.get(k))[:n] for r in results for k in ('asr', 'target') for n in (40,60)]
    report = public_data(report, fragments=source_fragments(report) + quoted)
    write_object(out_path, report)

    if fails:
        detail = "; ".join(
            f"{r['sequence_id']}: heard '{str(r.get('asr'))[:40]}' vs '{str(r.get('target'))[:40]}'"
            f" (similarity {r.get('similarity')})"
            for r in fails[:4])
        text = (f"[FAIL] clip speech verification: {len(fails)}/{len(results)} failed — "
                f"regenerate these sequences before assembly. {detail}")
    elif warns:
        text = (f"[PASS-with-warnings] clip speech verification: "
                f"{report['n_pass']}/{len(results)} pass, {len(warns)} warn (partial matches kept)")
    else:
        text = f"[PASS] clip speech verification: {report['n_pass']}/{len(results)} clips match the script"
    return ToolResult(text=text, data=report, artifacts=[ctx.virtualize(out_path)],
                      protected_texts=quoted)
