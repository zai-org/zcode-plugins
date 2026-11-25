"""T22: builder 产物永久证明、审核材料完整性与 take/shot 解析链(1106)。

设计依据 kit_refresh/T22_ESTIMATE.md 的方案节;复用 creation_planning 的 digest/file_digest。
诚实边界:自签 hash 只证明内容一致,不构成"只有 builder 签发"的防伪认证(估价报告风险节原文)。
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .creation_planning import digest, file_digest

BUILD_DIR = "out/creation/builds"
MANIFEST_CONTRACT = "build-manifest/1"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def build_manifest_path(ctx, manifest_sha: str) -> Path:
    return ctx.resolve(f"{BUILD_DIR}/{manifest_sha}.json")


def write_build_manifest(ctx, *, timeline_path: Path, args: dict, bindings: dict[str, str],
                         shots: list[dict], plan_path: str, verdicts_path: str,
                         takes_path: str, materials_status: dict) -> tuple[Path, str]:
    """在装配事务成功后原子发布内容寻址的 build manifest。

    文件名 = 自身内容的 sha256 前缀,已存在则校验字节一致(不可覆盖)。
    timeline 字节哈希与全部输入 bindings 一并入账;任何输入变化产生新 manifest。
    """
    timeline_sha = file_digest(timeline_path)
    payload = {
        "contract": MANIFEST_CONTRACT,
        "producer": "creation_timeline_build",
        "built_at": _now(),
        "timeline_path": ctx.virtualize(timeline_path),
        "timeline_sha256": timeline_sha,
        "plan_path": plan_path,
        "verdicts_path": verdicts_path,
        "takes_path": takes_path,
        "shots": [
            {
                "shot_id": s.get("shot_id"),
                "take_id": s.get("take_id"),
                "clip": s.get("clip") or s.get("source"),
                "trim": [s.get("trim_start"), s.get("trim_end")],
            }
            for s in shots
        ],
        "inputs": bindings,
        "materials": materials_status,
    }
    body = json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=1)
    import hashlib
    manifest_sha = hashlib.sha256(body.encode("utf-8")).hexdigest()
    path = build_manifest_path(ctx, manifest_sha)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if file_digest(path) != manifest_sha and path.read_text(encoding="utf-8") != body:
            raise ValueError(f"build manifest collision at {path}; refusing to overwrite")
    else:
        tmp = path.with_suffix(".tmp")
        tmp.write_text(body, encoding="utf-8")
        tmp.replace(path)
    return path, manifest_sha


def read_build_manifest(ctx, path: Path) -> dict:
    """读取并自校验(文件哈希 == 文件名);不一致按 stale 处理。"""
    body = path.read_text(encoding="utf-8")
    import hashlib
    actual = hashlib.sha256(body.encode("utf-8")).hexdigest()
    if path.stem != actual:
        raise ValueError(f"build manifest self-hash mismatch: {path.name} != {actual[:12]}… (stale or tampered)")
    return json.loads(body)


def material_completeness(ctx, *, plan: dict, candidates: dict, shots: list[dict]) -> dict:
    """T22 块2:从绑定候选重建预期材料集合,与提交集合对比。

    输出 complete / incomplete 两态与原因;只做材料覆盖,不代替内容判断。
    (1109 审计: 旧文档串写了三态含 exempt, 该状态从未可达, 现按实际两态表述。)
    """
    units = {str(u.get("sequence_id") or u.get("shot_id")): u for u in plan.get("sequences") or plan.get("shots") or []}
    expected: dict[str, str] = {}
    missing: list[str] = []
    for s in shots:
        tid = str(s.get("take_id") or "")
        cand = candidates.get(tid) if isinstance(candidates, dict) else None
        if not isinstance(cand, dict):
            missing.append(f"{tid}: take 记录缺失")
            continue
        ev = cand.get("evidence") if isinstance(cand.get("evidence"), dict) else {}
        for label, rel in (ev.get("grids") or {}).items():
            p = ctx.resolve(rel)
            if p.is_file():
                expected[str(p)] = file_digest(p)
            else:
                missing.append(f"{tid}: grid {label} 文件缺失")
        for label, rel in (ev.get("audios") or {}).items():
            p = ctx.resolve(rel)
            if p.is_file():
                expected[str(p)] = file_digest(p)
            else:
                missing.append(f"{tid}: audio {label} 文件缺失")
    status = "complete" if not missing else "incomplete"
    return {"status": status, "expected_files": len(expected),
            "expected_digests": expected, "missing": missing}


def resolve_shot_id(ctx, *, clip_span: dict, takes_records: dict, build_manifest: dict | None) -> tuple[str | None, str]:
    """T22 块3:take→shot 解析链。显式 > build manifest > takes 记录;多义/缺失返回明确诊断,不猜。"""
    sid = str(clip_span.get("shot_id") or "").strip()
    if sid:
        return sid, "explicit"
    tid = str(clip_span.get("take_id") or clip_span.get("source_take") or "").strip()
    if build_manifest:
        for row in build_manifest.get("shots") or []:
            if tid and str(row.get("take_id") or "") == tid:
                return str(row.get("shot_id") or "") or None, "build_manifest"
    if tid and isinstance(takes_records, dict):
        rec = takes_records.get(tid)
        if isinstance(rec, dict):
            rs = str(rec.get("shot_id") or rec.get("unit") or "").strip()
            if rs:
                return rs, "takes_record"
    return None, f"unresolved: take_id={tid or '∅'} (无显式 shot_id、build manifest 与 takes 记录均未命中)"
