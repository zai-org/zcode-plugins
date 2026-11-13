from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from .util import now_iso, save_json, slugify


def new_plan_id(title: str) -> str:
    stamp = now_iso().replace(":", "").replace("-", "").replace("+", "p")
    return f"{stamp}-{slugify(title)[:40]}"


def build_plan(title: str, operations: Sequence[Dict[str, Any]], notes: Optional[str] = None) -> Dict[str, Any]:
    plan_id = new_plan_id(title)
    return {
        "version": 1,
        "id": plan_id,
        "created_at": now_iso(),
        "title": title,
        "notes": notes or "",
        "operations": list(operations),
    }


def op_mkdir(path: Path) -> Dict[str, Any]:
    return {"kind": "mkdir", "path": str(path)}


def op_move(
    src: Path,
    dst: Path,
    pointer: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    return {
        "kind": "move",
        "src": str(src),
        "dst": str(dst),
        "pointer": pointer or None,
    }


def op_write(path: Path, content: str) -> Dict[str, Any]:
    return {"kind": "write", "path": str(path), "content": content}


def op_manual(path: str, action: str, reason: str) -> Dict[str, Any]:
    return {"kind": "manual", "path": path, "action": action, "reason": reason}


def plan_move(src: Path, dst: Path) -> Dict[str, Any]:
    if not src.exists():
        raise FileNotFoundError(f"source does not exist: {src}")
    if dst.exists():
        raise FileExistsError(f"destination already exists: {dst}")
    operations = [
        op_mkdir(dst.parent),
        op_move(
            src,
            dst,
            pointer={
                "path": str(src.parent / f"{src.name}.moved.md"),
                "content": f"# Moved\n\nThis path moved to `{dst}`.\n",
            },
        ),
    ]
    return build_plan(
        f"Move {src.name} to {dst.name}",
        operations,
        notes="Dry-run by default. Apply creates a backup and keeps a pointer at the old location.",
    )


def plan_init_project(project_root: Path) -> Dict[str, Any]:
    root = project_root.resolve()
    agents = root / ".agents"
    operations: List[Dict[str, Any]] = []
    for slot in ("plans", "wiki", "evidence", "skills", "tmp", "archive"):
        operations.append(op_mkdir(agents / slot))
    readme = agents / "README.md"
    if not readme.exists():
        operations.append(
            op_write(
                readme,
                "# Project Agent Context\n\n"
                "| Area | Path | Purpose |\n"
                "|---|---|---|\n"
                "| Plans | `plans/` | Active plans, PRDs and checklists |\n"
                "| Wiki | `wiki/` | Stable project knowledge |\n"
                "| Evidence | `evidence/` | Screenshots, videos, test output, acceptance proof |\n"
                "| Skills | `skills/` | Project-local skills |\n"
                "| Tmp | `tmp/` | Scratch, 14-day TTL |\n"
                "| Archive | `archive/` | Superseded plans and evidence |\n",
            )
        )
    agents_md = root / "AGENTS.md"
    if not agents_md.exists():
        operations.append(
            op_write(
                agents_md,
                "# Project Instructions\n\n"
                "## Scope\n\n"
                "This project uses Guster's standard `.agents/` layout. "
                "Put active plans in `.agents/plans/`, durable project knowledge in `.agents/wiki/`, "
                "evidence in `.agents/evidence/`, and scratch files in `.agents/tmp/`.\n\n"
                "## Boundaries\n\n"
                "- Code and tests are the source of truth for behavior.\n"
                "- Do not put credentials in this repository.\n"
                "- Do not commit `.agents/` unless the repository explicitly chooses to share it.\n\n"
                "## Context format\n\n"
                "File paths in this file and `.agents/README.md` are markdown links or inline code, "
                "never naked in prose, so `guster doctor` can verify them (CTX-03).\n",
            )
        )
    return build_plan(
        f"Initialize {root.name}",
        operations,
        notes="Creates the standard .agents layout, README index and a minimal AGENTS.md if absent.",
    )


def plan_from_findings(findings: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    operations: List[Dict[str, Any]] = []
    for item in findings:
        if item.get("severity") in {"critical", "high", "medium"}:
            if item.get("rule") == "misplaced-artifact":
                suggested = (item.get("evidence") or {}).get("suggested") or {}
                for entry, slot in suggested.items():
                    operations.append(
                        op_manual(
                            f"{item.get('path', '')}/.agents/{entry}",
                            f"Move under .agents/{slot}/ after updating any references",
                            f"misplaced-artifact: {entry} does not match a standard slot",
                        )
                    )
                continue
            operations.append(
                op_manual(
                    item.get("path", ""),
                    item.get("suggestion", ""),
                    f"{item.get('rule')}: {item.get('message')}",
                )
            )
    return build_plan(
        "Review context findings",
        operations,
        notes="This plan is a review checklist. It contains no automatic writes.",
    )


def save_plan(state_dir: Path, plan: Dict[str, Any]) -> Path:
    path = state_dir / "plans" / f"{plan['id']}.json"
    save_json(path, plan)
    return path


def load_plan(path: Path) -> Dict[str, Any]:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ValueError(f"cannot read plan {path}: {exc}") from exc
    try:
        data = json.loads(raw)
    except ValueError as exc:
        raise ValueError(f"invalid plan JSON {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"plan must be a JSON object: {path}")
    if data.get("version") != 1:
        raise ValueError(f"unsupported plan version: {data.get('version')}")
    if not isinstance(data.get("operations"), list):
        raise ValueError("plan has no operations")
    return data
