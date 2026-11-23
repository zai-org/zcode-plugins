"""Lightweight image review records and advisory repair guidance; no assembly gate."""
from __future__ import annotations

import re
from datetime import datetime, timezone
UTC = timezone.utc  # datetime.UTC needs Python 3.11

from .creation_planning import digest, file_digest, nexus_visual_plan, shot_review_context, unit_prop_ids
from .creation_takes import read_object, write_object
from .result import ToolResult

IMAGE_REVIEWS_REL = "out/creation/image_reviews.json"
IMAGE_CHECKS = ("identity", "state", "props", "count", "single_frame")
IMAGE_GUIDANCE = {
    "identity": "角色身份、造型与当前设定卡一致；纯道具图可说明不适用",
    "state": "状态与当前剧本时间点一致",
    "props": "道具存在、持有者/持有手正确，没有多余道具",
    "count": "每个出现的 critical 道具数量为 1",
    "single_frame": "关键帧单帧非宫格，道具卡一图一物；状态卡按其布局合同说明",
}


def _image_path(raw, ctx):
    if isinstance(raw, dict):
        raw = raw.get("path") or raw.get("image")
    return ctx.resolve(raw) if isinstance(raw, str) and raw.strip() else None


def plan_image_targets(plan, ctx, units=None):
    """Only the selected units' keyframes, active state cards and visible critical props."""
    plan = nexus_visual_plan(plan)
    selected = units if units is not None else (plan.get("sequences") or plan.get("shots") or [])
    targets = {}

    def add(raw, kind):
        path = _image_path(raw, ctx)
        if path is not None:
            targets[str(path)] = kind

    for unit in selected:
        if not isinstance(unit, dict):
            continue
        for frame in unit.get("keyframes") or []:
            add(frame, "keyframe")
        states = unit.get("cast_states") or {}
        for member in plan.get("cast") or []:
            if not isinstance(member, dict) or member.get("id") not in (unit.get("character_ids") or []):
                continue
            for state in member.get("states") or []:
                if isinstance(state, dict) and state.get("id") == states.get(member.get("id")):
                    add(state.get("image"), "state")
        present = unit_prop_ids(plan, unit)
        for prop in plan.get("props") or []:
            if isinstance(prop, dict) and prop.get("critical") is True and prop.get("id") in present:
                add(prop.get("image"), "prop")
    return targets


def _image_basis(plan, path, kind, ctx):
    plan = nexus_visual_plan(plan)
    targets = []
    if kind == "keyframe":
        for unit in plan.get("sequences") or plan.get("shots") or []:
            if any(_image_path(frame, ctx) == path for frame in unit.get("keyframes") or []):
                targets.append(shot_review_context(plan, unit, ctx))
    elif kind == "prop":
        targets = [p for p in plan.get("props") or [] if isinstance(p, dict) and _image_path(p.get("image"), ctx) == path]
    else:
        for member in plan.get("cast") or []:
            if not isinstance(member, dict):
                continue
            for state in member.get("states") or []:
                if isinstance(state, dict) and _image_path(state.get("image"), ctx) == path:
                    targets.append({"cast": {k: v for k, v in member.items() if k != "states"}, "state": state})
    return {"image_path": ctx.virtualize(path), "image_kind": kind, "image_sha256": file_digest(path),
            "expectations": {"style_preset": plan.get("style_preset"), "style_bible": plan.get("style_bible"),
                             "targets": targets}, "required_checks": list(IMAGE_CHECKS)}


def review_image(args, ctx, plan):
    """Prepare never accepts an image. Record requires an explicit observation declaration."""
    path = _image_path(args.get("image_path"), ctx)
    kind = args.get("image_kind")
    if path is None or not path.is_file() or kind not in ("keyframe", "state", "prop"):
        raise ValueError("image review requires image_path and image_kind=keyframe|state|prop")
    basis = _image_basis(plan, path, kind, ctx)
    key = str(path)
    ledger_path = ctx.resolve(IMAGE_REVIEWS_REL)
    book = read_object(ledger_path)
    images = book.setdefault("images", {})
    previous = images.get(key, {})
    signature = digest(basis)
    if args["action"] == "image_prepare":
        from PIL import Image
        with Image.open(path) as image:
            image.verify()
        entry = dict(basis, evidence_signature=signature, status="pending", viewed=False,
                     review_revision=int(previous.get("review_revision") or 0) + 1,
                     history=previous.get("history") or [])
        images[key] = entry
        write_object(ledger_path, book)
        return ToolResult(text="T11 图片已准备，decode 成功不算验收。实际查看此图并对照检查单后，用 image_record 确认。",
                          data={**entry, "check_guidance": IMAGE_GUIDANCE}, artifacts=[str(ledger_path)],
                          image_paths=[str(path)])
    if (previous.get("status") != "pending" or args.get("evidence_signature") != signature
            or previous.get("evidence_signature") != signature):
        raise ValueError("image review is missing or stale; image_prepare again and view the current image")
    checks = args.get("checks")
    problems = []
    if args.get("viewed") is not True:
        problems.append("T11 必须实际查看图片并声明 viewed=true；decode 成功不算验收")
    if not isinstance(args.get("notes"), str) or len(args["notes"].strip()) < 20:
        problems.append("T11 notes 至少 20 字符，说明实际看到的内容")
    for name in IMAGE_CHECKS:
        item = checks.get(name) if isinstance(checks, dict) else None
        if (not isinstance(item, dict) or not isinstance(item.get("ok"), bool)
                or not isinstance(item.get("evidence"), str) or len(item["evidence"].strip()) < 8):
            problems.append(f"T11 checks.{name} 须写 ok 与具体观察；不适用也说明原因")
    verdict = args.get("image_verdict")
    if verdict not in ("pass", "fail", "uncertain"):
        problems.append("T11 image_verdict 须为 pass/fail/uncertain")
    if verdict == "pass" and isinstance(checks, dict) and any(
            isinstance(checks.get(name), dict) and checks[name].get("ok") is False for name in IMAGE_CHECKS):
        problems.append("T11 失败检查不能记录为 pass")
    if problems:
        return ToolResult(text="\n".join(problems), data={"recorded": False, "status": "needs_review", "warnings": problems})
    record = {**basis, "evidence_signature": signature, "review_revision": previous["review_revision"],
              "status": verdict, "viewed": True, "checks": checks, "notes": args["notes"],
              "reviewed_at": datetime.now(UTC).isoformat(timespec="seconds")}
    record["review_signature"] = digest(record)
    images[key] = {**record, "history": [*(previous.get("history") or []), record]}
    write_object(ledger_path, book)
    return ToolResult(text=f"T11 图片查看确认已落账：{verdict}。",
                      data={"recorded": True, "status": verdict, "entry": images[key]}, artifacts=[str(ledger_path)])


def image_review_warnings(plan, ctx, targets):
    """Missing/stale/failed review is advisory, including unreadable review records."""
    try:
        images = read_object(ctx.resolve(IMAGE_REVIEWS_REL)).get("images") or {}
    except (ValueError, OSError):
        images = {}
    warnings = []
    for raw, kind in targets.items():
        path = ctx.resolve(raw)
        entry = images.get(str(path), {}) if isinstance(images, dict) else {}
        entry = entry if isinstance(entry, dict) else {}
        current = False
        try:
            canonical = {k: v for k, v in entry.items() if k not in ("review_signature", "history")}
            current = (entry.get("viewed") is True and entry.get("status") == "pass"
                       and digest(canonical) == entry.get("review_signature")
                       and digest(_image_basis(plan, path, kind, ctx)) == entry.get("evidence_signature"))
        except (ValueError, OSError):
            pass
        if not current:
            warnings.append(f"T11 {ctx.virtualize(path)}（{kind}）尚无当前图片的实际查看确认；"
                            "装配前执行 creation_verify image_prepare → 看图 → image_record。decode 成功不算验收 (advisory)")
    return warnings


def generated_image_targets(plan, rows, ctx):
    targets = plan_image_targets(plan, ctx)
    # Generated state cards may not be active in a unit yet.
    for member in plan.get("cast") or []:
        if isinstance(member, dict):
            for state in member.get("states") or []:
                if isinstance(state, dict) and (path := _image_path(state.get("image"), ctx)) is not None:
                    targets[str(path)] = "state"
    critical = {p.get("id") for p in nexus_visual_plan(plan).get("props") or []
                if isinstance(p, dict) and p.get("critical") is True}
    generated = {}
    for row in rows:
        path = _image_path(row.get("path"), ctx)
        if path is None:
            continue
        kind = targets.get(str(path))
        if row.get("kind") == "keyframe":
            kind = "keyframe"
        elif row.get("kind") == "prop" and row.get("id") in critical:
            kind = "prop"
        if kind:
            generated[str(path)] = kind
    return generated


def candidate_image_targets(plan, ctx, units, candidates):
    targets = plan_image_targets(plan, ctx, units)
    try:
        images = read_object(ctx.resolve(".video_agent/image_requests.json"))
    except (ValueError, OSError):
        images = {}
    for candidate in candidates:
        recipe = candidate.get("effective_recipe") or {}
        for frame in recipe.get("keyframes") or []:
            if (path := _image_path(frame, ctx)) is not None:
                targets[str(path)] = "keyframe"
        for raw in candidate.get("submitted_reference_sha256") or {}:
            if images.get(str(ctx.resolve(raw)), {}).get("kind") == "keyframe":
                targets[str(ctx.resolve(raw))] = "keyframe"
    return targets


def repeated_prop_warnings(plan, ledger):
    """Count matching failed prop tags on distinct takes, never review revisions of one take."""
    plan = nexus_visual_plan(plan)
    units = {u.get("sequence_id") or u.get("shot_id"): u for u in plan.get("sequences") or plan.get("shots") or []}
    warnings = []
    for prop in plan.get("props") or []:
        if not isinstance(prop, dict) or prop.get("critical") is not True:
            continue
        pid, label = prop.get("id"), prop.get("label")
        by_tag = {}
        for key, entry in ledger.items():
            if not isinstance(entry, dict):
                continue
            unit = units.get(entry.get("shot_id") or key, {})
            check = (entry.get("checks") or {}).get("props") or {}
            if pid not in unit_prop_ids(plan, unit) or check.get("ok") is not False:
                continue
            named = check.get("prop_ids")
            text = str(check.get("evidence") or "")
            mentioned = any(isinstance(alias, str) and alias and re.search(
                rf"(?<![A-Za-z0-9_]){re.escape(alias)}(?![A-Za-z0-9_])" if alias.isascii() else re.escape(alias),
                text, re.IGNORECASE) for alias in (pid, label))
            if not (pid in named if isinstance(named, list) and named else mentioned):
                continue
            for tag in check.get("tags") or []:
                if isinstance(tag, str) and tag.startswith("prop_"):
                    by_tag.setdefault(tag, set()).add(entry.get("take_id") or key)
        for tag, takes in by_tag.items():
            if len(takes) >= 2:
                warnings.append(f"T11 critical 道具 {pid}（{label}）的 {tag} 在 {len(takes)} 个不同 take 上反复出现；"
                                "先改参考图再重试（关键帧/状态卡/道具卡），不要只改 prompt (advisory)")
    return warnings


def add_warnings(result, warnings):
    if warnings:
        result.data["warnings"] = list(dict.fromkeys([*(result.data.get("warnings") or []), *warnings]))
        result.text += "\n" + "\n".join(warnings)
    return result
