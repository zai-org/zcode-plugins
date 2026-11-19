from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .util import now_iso, save_json, slugify, unique_suffix


PLAN_SCHEMA_HINT = (
    '{"version": 1, "operations": [{"kind": "mkdir", "path": "..."}, '
    '{"kind": "move", "src": "...", "dst": "..."}, '
    '{"kind": "write", "path": "...", "content": "..."}, '
    '{"kind": "manual", "path": "...", "action": "...", "reason": "..."}]}'
)

# Mirrors schemas/plan.schema.json (top-level required keys, per-kind fields,
# slug-shaped id); tests/test_schemas.py fails when the two drift apart.
PLAN_TOP_REQUIRED = ("version", "id", "created_at", "title", "notes", "operations")
PLAN_OPERATION_KINDS = ("mkdir", "move", "write", "manual")
PLAN_OPERATION_FIELDS: Dict[str, Tuple[Tuple[str, bool], ...]] = {
    "mkdir": (("path", True),),
    "move": (("src", True), ("dst", True)),
    "write": (("path", True), ("content", False)),
    "manual": (("path", False), ("action", False), ("reason", False)),
}
PLAN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


def new_plan_id(title: str) -> str:
    stamp = now_iso().replace(":", "").replace("-", "").replace("+", "p")
    return f"{stamp}-{slugify(title)[:40]}-{unique_suffix()}"


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


def op_move(src: Path, dst: Path) -> Dict[str, Any]:
    return {"kind": "move", "src": str(src), "dst": str(dst)}


def op_write(path: Path, content: str) -> Dict[str, Any]:
    return {"kind": "write", "path": str(path), "content": content}


def op_manual(path: str, action: str, reason: str) -> Dict[str, Any]:
    return {"kind": "manual", "path": path, "action": action, "reason": reason}


def plan_move(src: Path, dst: Path) -> Dict[str, Any]:
    # Absolute at plan time: the reviewed object must be the applied object,
    # never re-resolved against whatever CWD `apply` later runs from.
    src = src.expanduser().resolve()
    dst = dst.expanduser().resolve()
    if not src.exists():
        raise FileNotFoundError(f"source does not exist: {src}")
    if dst.exists():
        raise FileExistsError(f"destination already exists: {dst}")
    operations = [
        op_mkdir(dst.parent),
        op_move(src, dst),
    ]
    return build_plan(
        f"Move {src.name} to {dst.name}",
        operations,
        notes="Dry-run by default. Apply creates a backup.",
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
            raw_examples = (item.get("evidence") or {}).get("examples")
            examples = (
                [str(example) for example in raw_examples if isinstance(example, str) and example]
                if isinstance(raw_examples, list)
                else []
            )
            for target in examples or [item.get("path", "")]:
                operations.append(
                    op_manual(
                        target,
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


def _validate_plan(data: Dict[str, Any], path: Path) -> None:
    """Enforce the schemas/plan.schema.json contract before any write can happen;
    a mistyped key (e.g. 'contnet') must stop the plan, not truncate a file."""
    problems: List[str] = []
    for key in PLAN_TOP_REQUIRED:
        if key not in data:
            problems.append(f"missing required key {key!r}")
    for key in data:
        if key not in PLAN_TOP_REQUIRED:
            problems.append(f"unknown key {key!r}")
    for key in ("title", "created_at", "notes"):
        if key in data and not isinstance(data[key], str):
            problems.append(f"{key} must be a string, got {type(data[key]).__name__}")
    if "title" in data and data["title"] == "":
        problems.append("title must be a non-empty string")
    if "id" in data:
        plan_id = data["id"]
        if not isinstance(plan_id, str):
            problems.append(f"id must be a string, got {type(plan_id).__name__}")
        elif not PLAN_ID_RE.match(plan_id):
            problems.append(
                f"id must be a safe slug (letters, digits, '.', '_', '-'; "
                f"no path separators or '..'): {plan_id!r}"
            )
    for index, operation in enumerate(data["operations"], start=1):
        if not isinstance(operation, dict):
            problems.append(f"op {index}: operation is not a JSON object")
            continue
        kind = operation.get("kind")
        if not isinstance(kind, str) or kind not in PLAN_OPERATION_FIELDS:
            problems.append(
                f"op {index}: unknown operation kind: {kind!r} "
                f"(expected one of {', '.join(PLAN_OPERATION_KINDS)})"
            )
            continue
        fields = PLAN_OPERATION_FIELDS[kind]
        allowed = {"kind"} | {field for field, _ in fields}
        for key in operation:
            if key not in allowed:
                hint = (
                    "; pointer updates are no longer applied by `apply`; "
                    "update the referenced file with a write op"
                    if key == "pointer" and kind == "move"
                    else ""
                )
                problems.append(f"op {index}: unknown key {key!r} in {kind} operation{hint}")
        for field, non_empty in fields:
            if field not in operation:
                problems.append(f"op {index}: {kind} operation needs {field!r}")
                continue
            value = operation[field]
            if not isinstance(value, str):
                problems.append(
                    f"op {index}: {kind} {field} must be a string, got {type(value).__name__}"
                )
                continue
            if non_empty and not value:
                problems.append(f"op {index}: {kind} {field} must be a non-empty string")
            elif field in ("path", "src", "dst") and not Path(value).is_absolute():
                problems.append(f"op {index}: {kind} {field} must be an absolute path: {value!r}")
    if problems:
        raise ValueError(
            f"plan {path} does not match the plan contract: {'; '.join(problems)}; "
            f"the contract is schemas/plan.schema.json, e.g. {PLAN_SCHEMA_HINT}"
        )


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
    version = data.get("version")
    if isinstance(version, bool) or not isinstance(version, int) or version != 1:
        raise ValueError(
            f"unsupported plan version: {version!r} (expected the integer 1); "
            f"a plan is shaped {PLAN_SCHEMA_HINT}"
        )
    if not isinstance(data.get("operations"), list):
        raise ValueError(
            "plan has no operations list; expected an 'operations' array of operation "
            f"objects with a 'kind' of mkdir/move/write/manual, e.g. {PLAN_SCHEMA_HINT}"
        )
    _validate_plan(data, path)
    return data
