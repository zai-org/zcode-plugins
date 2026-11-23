"""Refuse to render a timeline whose takes never passed verification.

`creation_timeline_build` has its own assembly gate, but it is only reached when that tool
is called — and on 2026-10-29 a run hand-wrote `out/timeline.json` instead, laying `U12_t4`
(verdict `regenerate`, three failed takes) onto the track without the tool ever running. A
second run that day reached the same end through an `allow_unverified=true` waiver; that
parameter has since been removed, so the hand-written timeline is the remaining way in.

So the check belongs at the one place every film must pass through: `render_preview`. A
hand-written timeline and a legitimate assembly both arrive here, and `preview.mp4` cannot
exist without it. The cost of not having it is measurable: the waived run scored argon 5.8
against 6.4 for the run that kept its gate on the same brief, and half its hard defects are
what per-take verification exists to catch — a stand-in swapped for a named character
mid-scene, a costume flipping four times, a weapon changing hands.

Scope is deliberately narrow — it only speaks when it can prove a take is bad:

  * no ledger (`out/creation/verified.json`) -> silent. Recap/condense/editing runs on real
    footage have no takes and must not be touched.
  * a clip whose source is not a creation take -> ignored. Downloaded footage, bridges and
    renders of other projects are not verification subjects.
  * a take with a final verdict (`pass`, `mute_audio`, `exhausted`) -> allowed. `exhausted`
    means the budget was spent and the best take ships with the defect on record, which is a
    decision, not an omission.
  * `regenerate` / `pending` / absent from the ledger -> refused, with the ids listed.

When the evidence is there (`verdicts.json` + `shotlist.json`), the refused list also runs
`approved_span()`, so an edited trim range outside what the judge approved is caught the same
way the versioned assembly catches it.
"""
from __future__ import annotations

import re
from pathlib import Path

FINAL_OK = ("pass", "mute_audio", "exhausted")
LEDGER_REL = "out/creation/verified.json"
VERDICTS_REL = "out/creation/verdicts.json"
SHOTLIST_REL = "out/creation/shotlist.json"
# out/creation/clips/<take_id>.mp4 — the only sources that are verification subjects.
TAKE_SOURCE = re.compile(r"(?:^|/)creation/clips/([^/]+)\.mp4$")


def take_of(clip: dict, assets: dict, takes_records: dict | None = None) -> str | None:
    """The take a timeline clip lays: explicit id > canonical path > takes-record path match."""
    if not isinstance(clip, dict):
        return None
    explicit = clip.get("source_take") or clip.get("take_id")
    if explicit:
        return str(explicit)
    source = str(clip.get("source") or assets.get(clip.get("asset_id")) or "").replace("\\", "/")
    m = TAKE_SOURCE.search(source)
    if m:
        return m.group(1)
    # T22: 自定义目录/文件名——按 takes 记录登记的 clip 路径唯一反查(多义不猜)。
    if isinstance(takes_records, dict) and source:
        norm = source.rsplit("/", 1)[-1]
        hits = sorted(t for t, rec in takes_records.items()
                      if isinstance(rec, dict)
                      and str(rec.get("clip") or rec.get("path") or "").replace("\\", "/").endswith("/" + norm)
                      or (isinstance(rec, dict) and str(rec.get("clip") or "").replace("\\", "/") == source))
        if len(hits) == 1:
            return hits[0]
    return None


def find_build_manifest(ctx, timeline_path) -> dict | None:
    """T22: 在 builds/ 下找 timeline_sha256 与当前 timeline 字节精确匹配的 manifest。"""
    import hashlib
    builds_dir = ctx.resolve("out/creation/builds")
    if not builds_dir.is_dir() or not timeline_path.is_file():
        return None
    try:
        current = hashlib.sha256(timeline_path.read_bytes()).hexdigest()
    except OSError:
        return None
    from .build_provenance import read_build_manifest
    best = None
    for cand in sorted(builds_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            manifest = read_build_manifest(ctx, cand)
        except Exception:  # noqa: BLE001
            continue
        if manifest.get("timeline_sha256") == current:
            best = manifest
            break
    return best


def _read(path: Path) -> dict:
    try:
        from .creation_takes import read_object
        return read_object(path) or {}
    except Exception:  # noqa: BLE001 — a missing/garbled ledger must not break rendering
        return {}


def unverified_takes(timeline: dict, ctx) -> list[str]:
    """`<take>:<status>` for every take on the timeline without a final verdict."""
    ledger = _read(ctx.resolve(LEDGER_REL))
    if not ledger:
        return []
    # P2-6: T22 的 takes 记录反查在这里同样生效——自定义 clip 路径、无显式 take_id 的素材
    # 以前在这道检查里漏判 (只有 unapproved_spans 传了 records), 配合空 verdicts 时整个逃逸。
    takes_records = (_read(ctx.resolve("out/creation/clips/takes.json")) or {}).get("takes") or {}
    assets = {a.get("id"): (a.get("path") or a.get("source"))
              for a in (timeline.get("assets") or []) if isinstance(a, dict)}
    bad: dict[str, str] = {}
    for track in (timeline.get("tracks") or []):
        if not isinstance(track, dict) or track.get("enabled") is False:
            continue
        for clip in (track.get("clips") or []):
            take = take_of(clip, assets, takes_records)
            if not take:
                continue
            entry = ledger.get(take)
            status = (entry or {}).get("status") or (entry or {}).get("verdict")
            if status in FINAL_OK:
                continue
            # A take absent from the ledger is as unverified as a pending one, but say which.
            bad[take] = status or ("unverified" if entry is None else "no_verdict")
    return [f"{t}:{s}" for t, s in sorted(bad.items())]


def unapproved_spans(timeline: dict, ctx, *, verdicts_path=None, shotlist_path=None, takes_path=None) -> list[str]:
    """`<take>: <why>` for laid ranges the judge did not approve. Needs the evidence files."""
    verdicts = (_read(ctx.resolve(verdicts_path or VERDICTS_REL)) or {}).get("takes") or {}
    plan = _read(ctx.resolve(shotlist_path or SHOTLIST_REL))
    takes_records = (_read(ctx.resolve(takes_path or "out/creation/clips/takes.json")) or {}).get("takes") or {}
    if not verdicts or not plan:
        return []
    build_manifest = find_build_manifest(ctx, ctx.resolve(timeline.get("timeline_path") or "out/timeline.json"))
    try:
        from .creation_planning import approved_span, shot_plan_digest
        from .timeline import file_sha256
    except Exception:  # noqa: BLE001
        return []
    shots = {str(s.get("shot_id") or s.get("sequence_id")): s
             for s in (plan.get("shots") or plan.get("sequences") or []) if isinstance(s, dict)}
    assets = {a.get("id"): (a.get("path") or a.get("source"))
              for a in (timeline.get("assets") or []) if isinstance(a, dict)}
    problems: list[str] = []
    for track in (timeline.get("tracks") or []):
        if not isinstance(track, dict) or track.get("enabled") is False:
            continue
        for clip in (track.get("clips") or []):
            take = take_of(clip, assets, takes_records)
            review = verdicts.get(take) if take else None
            shot = shots.get(str(clip.get("shot_id"))) if isinstance(clip, dict) else None
            if take and not shot:
                # T22: 显式 > build manifest > takes 记录;解析不出写诊断,不沉默跳过。
                from .build_provenance import resolve_shot_id
                sid, how = resolve_shot_id(ctx, clip_span=clip, takes_records=takes_records,
                                           build_manifest=build_manifest)
                if sid and sid in shots:
                    shot = shots[sid]
                elif review is not None:
                    problems.append(f"{take}: shot 无法解析({how})——缺逻辑单元映射,选段边界无法核验")
            source = clip.get("source") or assets.get(clip.get("asset_id"))
            if not source:
                continue
            path = ctx.resolve(source)
            if not path.is_file():
                continue
            try:
                approved_span(review, shot_plan_digest(plan, shot, ctx), file_sha256(path),
                              float(clip.get("start") or 0), float(clip.get("end") or 0))
            except ValueError as exc:
                problems.append(f"{take}: {exc}")
            except Exception:  # noqa: BLE001 — never let the check itself stop a render
                continue
    return problems


def refusal(timeline: dict, ctx) -> str | None:
    """The message to refuse the render with, or None when the timeline is clean."""
    bad = unverified_takes(timeline, ctx)
    spans = unapproved_spans(timeline, ctx)
    if not bad and not spans:
        return None
    parts = []
    if bad:
        parts.append(f"{len(bad)} take(s) on the timeline have no passing verdict in "
                     f"{LEDGER_REL} — {', '.join(bad[:12])}{' …' if len(bad) > 12 else ''}")
    if spans:
        parts.append(f"{len(spans)} laid range(s) outside an approved usable_span — "
                     f"{'; '.join(spans[:6])}{' …' if len(spans) > 6 else ''}")
    return ("[ERROR] refusing to render unverified footage: " + "; ".join(parts)
            + ". Verify each take (creation_verify prepare + record) and re-assemble with "
              "creation_timeline; a take whose budget is spent must be recorded as "
              "'exhausted' rather than left pending.")
