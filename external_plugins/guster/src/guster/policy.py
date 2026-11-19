from __future__ import annotations

import glob
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from .discover import ScanConfig, STANDARD_AGENTS_SLOTS, in_scope_path, scope_roots
from .layout import load_waivers, resolve_hub_layout
from .util import (
    DATE_ONLY_RE,
    NOTE_DATE_KEYS,
    age_days,
    extract_naked_pointers,
    extract_pointers,
    git_last_commit_dates,
    has_top_level_row_keys,
    is_under,
    load_json_strict,
    note_header_date,
    parse_date,
    parse_note_header,
    parse_register_rows,
    parse_yaml_head,
    read_text,
    relative,
    resolve_pointer,
)


SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
COMMON_KNOWLEDGE_NAMES = {"readme.md", "agents.md", "index.md", "skill.md"}
MEDIA_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp4", ".mov", ".wav", ".mp3"}
RESIDENT_ENTRIES = (
    (".zcode", "AGENTS.md"),
    (".dsh", "AGENTS.md"),
    (".codex", "AGENTS.md"),
    (".claude", "CLAUDE.md"),
)
DATE_HEADER_LINES = 40
VERIFIED_DATE_KEYS = r"(?:最后更新|更新时间|更新于|最近核实|最后核实|已核实|verified_at|(?i:last updated|updated))"
FRESH_SOURCE_STATS = {
    "declared": "state_docs_fresh_declared",
    "git": "state_docs_fresh_from_git",
    "mtime": "state_docs_fresh_from_mtime",
}


def resident_entries(home: Path) -> List[Path]:
    """Host entry files that exist, deduped by real path (hosts often symlink one file)."""
    seen: Set[str] = set()
    entries: List[Path] = []
    for folder, name in RESIDENT_ENTRIES:
        path = home / folder / name
        if not path.is_file():
            continue
        try:
            real = str(path.resolve())
        except OSError:
            continue
        if real in seen:
            continue
        seen.add(real)
        entries.append(path)
    return entries


def finding(
    rule: str,
    severity: str,
    title: str,
    path: str,
    message: str,
    suggestion: str,
    evidence: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return {
        "rule": rule,
        "severity": severity,
        "title": title,
        "path": path,
        "message": message,
        "suggestion": suggestion,
        "evidence": evidence or {},
    }


def suggest_slot(name: str, is_dir: bool) -> str:
    """Guess the standard slot an unplaced top-level entry belongs to."""
    lowered = name.lower()
    if is_dir:
        if lowered in {"skills", "tools", "scripts"}:
            return "skills"
        if lowered in {"wiki", "knowledge"}:
            return "wiki"
        if any(
            key in lowered
            for key in (
                "shot", "screenshot", "截图", "review", "evidence", "audit",
                "verify", "verification", "acceptance", "visual", "frame",
                "panorama", "photo",
            )
        ):
            return "evidence"
        if any(key in lowered for key in ("scratch", "tmp", "backup", "bak", "cache")):
            return "archive"
        return "plans"
    suffix = Path(name).suffix.lower()
    if suffix in MEDIA_SUFFIXES or suffix in {".pdf", ".xlsx"}:
        return "evidence"
    if suffix in {".py", ".sh", ".mjs"}:
        return "skills"
    if suffix in {".json", ".log", ".txt", ".bak", ".tsv", ".html"}:
        return "tmp"
    return "plans"


# `host:/path` (and URLs) reference another machine; a local three-way diff
# can never see them, so they are counted apart instead of drifting forever.
REGISTRY_REMOTE_FORM = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")

# knowledge/v1 format contract (CTX-11). Opt-in: only files whose metadata
# face declares `schema: knowledge/v1` are validated, so plain notes stay
# untouched. Vocabularies ship with the format; zone/host/history-style local
# extensions are ignored, never validated.
KNOWLEDGE_SCHEMA = "knowledge/v1"
KNOWLEDGE_TYPES = {"state", "howto", "principle", "pitfall", "decision", "index", "reference"}
KNOWLEDGE_STATUSES = {"active", "dormant", "superseded", "archived"}
KNOWLEDGE_STALE_TYPES = {"state", "index"}
KNOWLEDGE_STALE_DAYS = 90
REGISTER_SCHEMA = "register/v1"
REGISTER_KIND = "projects"
REGISTER_STATUSES = {"active", "pending", "on-hold", "stale", "retired"}


def resolve_registry_row_path(raw: str, hub_root: Path, home: Path) -> Optional[Path]:
    """A register row path resolves against the hub root, `~` or an absolute."""
    value = raw.strip().rstrip("/")
    if not value:
        return None
    if value.startswith("~"):
        return home / value[2:]
    candidate = Path(value)
    if candidate.is_absolute():
        return candidate
    return (hub_root / candidate).resolve()


def resolved_str(raw: str) -> str:
    """Canonical spelling for finding paths: one doctor report must not mix
    /tmp and /private/tmp forms of the same directory."""
    try:
        return str(Path(raw).resolve())
    except OSError:
        return raw


def collect_knowledge_v1(
    artifacts: List[Dict[str, Any]], knowledge_root: Optional[Path]
) -> Tuple[List[Dict[str, Any]], List[Tuple[Path, str]]]:
    """Read the metadata face of every knowledge/v1 file under the hub's
    knowledge root. Files without the `schema: knowledge/v1` header are
    skipped: the format contract is opt-in by declaration. A file that
    declares a knowledge/* or register/* schema other than the current one is
    returned as a mismatch, so a typo'd declaration stays visible instead of
    silently opting out of every check."""
    docs: List[Dict[str, Any]] = []
    mismatches: List[Tuple[Path, str]] = []
    if knowledge_root is None:
        return docs, mismatches
    for item in artifacts:
        if item.get("kind") != "knowledge":
            continue
        path = Path(item["path"])
        if path.suffix.lower() not in {".yaml", ".yml"}:
            continue
        if not is_under(path, knowledge_root):
            continue
        head = parse_yaml_head(read_text(path, limit=500_000))
        declared = head.get("schema")
        if declared == KNOWLEDGE_SCHEMA:
            docs.append({"path": path, "stem": path.stem, "head": head})
        elif isinstance(declared, str) and declared.startswith(("knowledge/", "register/")):
            mismatches.append((path, declared))
    return docs, mismatches


def run_policy(
    registry: Dict[str, Any],
    config: ScanConfig,
    previous_registry: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Orchestration only: seed stats, run every rule family in its own
    _check_* function, then scope, waive and order the findings.
    `previous_registry` is the machine table captured before this run
    overwrote it; when omitted the baseline is read from disk, strictly."""
    findings: List[Dict[str, Any]] = []
    governance = registry.get("governance_docs")
    stats: Dict[str, Any] = {
        "pointers_checked": 0,
        "pointers_valid": 0,
        "broken_pointers": 0,
        "naked_pointers": 0,
        "agents_dirs_total": 0,
        "agents_dirs_compliant": 0,
        "agents_dirs_missing_index": 0,
        "agents_dirs_missing_slots": 0,
        "agents_dirs_extra_entries": 0,
        "knowledge_total": 0,
        "knowledge_indexed": 0,
        "agents_index_total": 0,
        "agents_indexed": 0,
        "state_docs_total": 0,
        "state_docs_fresh": 0,
        "state_docs_fresh_declared": 0,
        "state_docs_fresh_from_git": 0,
        "state_docs_fresh_from_mtime": 0,
        "duplicate_knowledge": 0,
        "note_headers_total": 0,
        "governance_docs": None if governance is None else len(governance),
        "misplaced_entries": 0,
        "resident_entries": 0,
        "secret_total": 0,
        "secret_outside_root": 0,
        "secret_in_git": 0,
        "secret_tracking_unknown": 0,
        "secret_undeclared_outside": 0,
        "pointer_files_total": 0,
        "pointer_files_scanned": 0,
        "git_probe_failures": 0,
        "inline_bearers": 0,
        "registry_rows": 0,
        "registry_rows_remote": 0,
        "registry_drift_dead_rows": 0,
        "registry_drift_unscanned_rows": 0,
        "registry_drift_unregistered": 0,
        "registry_drift_stale_machine": 0,
        "registry_format_bad": 0,
        "knowledge_v1_total": 0,
        "knowledge_format_bad": 0,
        "see_also_broken": 0,
        "knowledge_duplicate_ids": 0,
        "knowledge_stale": 0,
        "scan_walk_errors": int((registry.get("scan_errors") or {}).get("count") or 0),
    }
    home = config.home
    hub = config.hub
    scope = getattr(config, "scope", "machine")
    hub_layout = resolve_hub_layout(hub) if hub else {}
    artifacts = registry.get("artifacts", [])
    projects = registry.get("projects", [])
    git_failures: List[str] = [
        str(project.get("path") or project.get("id"))
        for project in projects
        if project.get("git_state") == "error"
    ]
    skills = registry.get("skills", [])

    findings.extend(_check_resident_budget(home, hub, scope, stats))
    if scope != "hub":
        findings.extend(_check_skill_metadata(skills, home, stats))
        findings.extend(_check_skill_copy_drift(skills))
    knowledge, knowledge_index_findings = _check_knowledge_index(artifacts, stats)
    findings.extend(knowledge_index_findings)
    findings.extend(_check_knowledge_v1(artifacts, hub, hub_layout, stats))
    findings.extend(_check_duplicate_canonical(registry, stats))
    structured_notes, note_findings = _check_structured_notes(knowledge, stats)
    findings.extend(note_findings)
    findings.extend(_check_project_layout(projects, stats))
    findings.extend(
        _check_state_freshness(artifacts, projects, hub, hub_layout, git_failures, stats)
    )
    findings.extend(_check_pointers(artifacts, structured_notes, hub, home, config, stats))
    secrets_findings, secrets_ctx = _check_secrets(registry, home, stats)
    findings.extend(secrets_findings)
    findings.extend(_check_credential_registry(registry, secrets_ctx, stats))
    findings.extend(_check_governance_overlap(registry))
    findings.extend(_check_tmp_hygiene(projects))
    findings.extend(_check_plugin_manifests(registry))
    findings.extend(
        _check_registry_drift(registry, config, hub_layout, stats, previous_registry)
    )

    scoped = scope_roots(config)
    if scoped is not None:
        kept = [
            item for item in findings if in_scope_path(item.get("path", ""), scoped)
        ]
        hidden = [
            item for item in findings if not in_scope_path(item.get("path", ""), scoped)
        ]
        stats["scoped_hidden_findings"] = len(hidden)
        if hidden:
            by_rule: Dict[str, int] = {}
            for item in hidden:
                by_rule[item["rule"]] = by_rule.get(item["rule"], 0) + 1
            kept.append(
                finding(
                    "out-of-scope",
                    "info",
                    f"Machine-level findings hidden in {scope} scope",
                    "",
                    f"{len(hidden)} finding(s) sit outside the {scope} scope.",
                    "Run `guster doctor` without --root for the machine-wide view.",
                    {"by_rule": by_rule},
                )
            )
        findings = kept

    waived: List[Dict[str, Any]] = []
    waivers = load_waivers(hub)
    if waivers:
        kept, waived = [], []
        for item in findings:
            reason = _waiver_reason(item, waivers)
            if reason is None:
                kept.append(item)
            else:
                item["waiver_reason"] = reason
                waived.append(item)
        stats["waived_findings"] = len(waived)
        findings = kept

    findings.sort(key=lambda item: (SEVERITY_ORDER.get(item["severity"], 9), item["rule"], item["path"]))
    for index, item in enumerate(findings, start=1):
        item["id"] = f"F{index:04d}"
    return {"findings": findings, "waived": waived, "stats": stats}


def _check_resident_budget(
    home: Path, hub: Optional[Path], scope: str, stats: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """Resident budget: every host entry file that exists, counted once.
    Owns stats keys: resident_entries, resident_bytes, resident_lines."""
    findings: List[Dict[str, Any]] = []
    user_agents = resident_entries(home) if scope != "hub" else []
    hub_agents = (hub / "AGENTS.md") if hub and (hub / "AGENTS.md").is_file() else None
    resident_bytes = sum(file_size(path) for path in user_agents) + (
        file_size(hub_agents) if hub_agents else 0
    )
    resident_lines = sum(count_lines(path) for path in user_agents) + (
        count_lines(hub_agents) if hub_agents else 0
    )
    stats["resident_bytes"] = resident_bytes
    stats["resident_lines"] = resident_lines
    stats["resident_entries"] = len(user_agents)
    if resident_bytes > 20_000:
        findings.append(
            finding(
                "resident-budget",
                "medium",
                "Resident context exceeds 20 KB",
                str(user_agents[0] if user_agents else (hub_agents or "")),
                f"User + hub resident instruction is {resident_bytes} bytes / {resident_lines} lines.",
                "Move procedures, examples and state tables into knowledge or skills; keep only rules and pointers.",
                {"bytes": resident_bytes, "lines": resident_lines, "target_bytes": 20_000},
            )
        )
    for path in user_agents:
        lines = count_lines(path)
        if lines > 150:
            findings.append(
                finding(
                    "resident-budget",
                    "medium",
                    "User-level instruction exceeds soft line budget",
                    str(path),
                    f"{lines} lines; soft target is 150.",
                    "Demote long procedures and examples.",
                )
            )
    if hub_agents and count_lines(hub_agents) > 50:
        findings.append(
            finding(
                "resident-budget",
                "medium",
                "Hub instruction exceeds soft line budget",
                str(hub_agents),
                f"{count_lines(hub_agents)} lines; soft target is 50.",
                "Move detail into a knowledge reference doc under knowledge/general/.",
            )
        )
    return findings


def _check_skill_metadata(
    skills: List[Dict[str, Any]], home: Path, stats: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """Skill metadata budget. Owns stats keys: skill_chars."""
    findings: List[Dict[str, Any]] = []
    total_skill_chars = sum(int(skill.get("description_chars", 0)) for skill in skills)
    stats["skill_chars"] = total_skill_chars
    for skill in skills:
        chars = int(skill.get("description_chars", 0))
        if chars <= 500:
            continue
        findings.append(
            finding(
                "skill-budget",
                "high",
                "Skill description exceeds per-item budget",
                skill.get("root", ""),
                f"{skill.get('name')} description is {chars} chars; limit is 500.",
                "Shorten the description to trigger conditions only; move detail into SKILL.md body.",
                {"skill": skill.get("name"), "chars": chars},
            )
        )
    if total_skill_chars > 6_000:
        findings.append(
            finding(
                "skill-budget",
                "high",
                "Skill metadata exceeds total budget",
                str(home / ".agents" / "skills"),
                f"Unique skill descriptions total {total_skill_chars} chars; budget is 6,000.",
                "Trim the longest descriptions first; keep each description to one clear trigger sentence.",
                {"chars": total_skill_chars, "target": 6_000},
            )
        )
    return findings


def _check_skill_copy_drift(skills: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Skill copy drift."""
    findings: List[Dict[str, Any]] = []
    for skill in skills:
        copies = skill.get("copies", [])
        hashes = {copy.get("hash") for copy in copies if copy.get("hash")}
        if len(copies) > 1 and len(hashes) > 1:
            findings.append(
                finding(
                    "skill-copy-drift",
                    "high",
                    "Skill copies drifted",
                    skill.get("root", ""),
                    f"{skill.get('name')} has {len(hashes)} different copies.",
                    "Make copies byte-identical or replace the copy strategy with symlinks where the host supports it.",
                    {"copies": copies},
                )
            )
    return findings


def _check_knowledge_index(
    artifacts: List[Dict[str, Any]], stats: Dict[str, Any]
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Knowledge index coverage and duplicates.
    Owns stats keys: knowledge_total, knowledge_indexed. Returns the knowledge
    artifact list for the downstream structured-notes check."""
    findings: List[Dict[str, Any]] = []
    knowledge = [item for item in artifacts if item.get("kind") == "knowledge"]
    stats["knowledge_total"] = len(knowledge)
    orphan_groups: Dict[str, List[Dict[str, Any]]] = {}
    for item in knowledge:
        if item.get("indexed") is True:
            stats["knowledge_indexed"] += 1
        elif item.get("indexed") is False:
            if Path(item["path"]).name.lower() in COMMON_KNOWLEDGE_NAMES:
                # An index does not index itself.
                continue
            orphan_groups.setdefault(item.get("scope", "unknown"), []).append(item)

    for orphan_scope, items in orphan_groups.items():
        severity = "medium" if orphan_scope != "local" else "low"
        examples = [str(Path(item["path"]).resolve()) for item in items[:10]]
        findings.append(
            finding(
                "orphan-knowledge",
                severity,
                "Knowledge files are not indexed",
                str(items[0]["path"]),
                f"{len(items)} knowledge file(s) in scope '{orphan_scope}' are absent from the relevant README index.",
                "Add each file to its README index, or merge/delete it if obsolete.",
                {"count": len(items), "examples": examples},
            )
        )
    return knowledge, findings


def _check_knowledge_v1(
    artifacts: List[Dict[str, Any]],
    hub: Optional[Path],
    hub_layout: Dict[str, Path],
    stats: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """knowledge/v1 format contract (CTX-11): files that declare the schema
    header get strict format, cross-reference and freshness checks; plain
    notes are never touched. These findings stay outside CHI (same
    discipline as registry-drift) so scores stay comparable.
    Owns stats keys: knowledge_v1_total, knowledge_format_bad, see_also_broken,
    knowledge_stale, knowledge_duplicate_ids."""
    findings: List[Dict[str, Any]] = []
    v1_docs: List[Dict[str, Any]] = []
    schema_mismatches: List[Tuple[Path, str]] = []
    knowledge_root = hub_layout.get("knowledge") if hub is not None else None
    if knowledge_root is not None:
        v1_docs, schema_mismatches = collect_knowledge_v1(artifacts, knowledge_root)
    stats["knowledge_v1_total"] = len(v1_docs)
    knowledge_yaml_stems: Set[str] = set()
    if knowledge_root is not None:
        for item in artifacts:
            if item.get("kind") != "knowledge":
                continue
            candidate = Path(item["path"])
            if candidate.suffix.lower() in {".yaml", ".yml"} and is_under(candidate, knowledge_root):
                knowledge_yaml_stems.add(candidate.stem)
    for mismatch_path, declared in schema_mismatches:
        findings.append(
            finding(
                "knowledge-format",
                "info",
                "knowledge file declares an unsupported schema",
                str(mismatch_path),
                f"declares schema {declared} — current supported is {KNOWLEDGE_SCHEMA}; "
                "the file is skipped by every knowledge/v1 check.",
                f"Fix the header to '{KNOWLEDGE_SCHEMA}', or drop the schema key to keep it a plain note.",
                {"declared": declared, "current": KNOWLEDGE_SCHEMA},
            )
        )
    known_ids: Set[str] = set()
    for doc in v1_docs:
        doc_id = doc["head"].get("id")
        if isinstance(doc_id, str) and doc_id:
            known_ids.add(doc_id)
    format_bad: List[Tuple[str, List[str]]] = []
    broken_refs: List[Tuple[str, List[str]]] = []
    stale_files: List[str] = []
    id_owners: Dict[str, List[str]] = {}
    today = datetime.now(timezone.utc).date()
    for doc in v1_docs:
        head = doc["head"]
        path = doc["path"]
        issues: List[str] = []
        doc_id = head.get("id")
        if not isinstance(doc_id, str) or not doc_id:
            issues.append("id is missing")
        elif doc_id != doc["stem"]:
            issues.append(f"id {doc_id!r} does not match file stem {doc['stem']!r}")
        else:
            id_owners.setdefault(doc_id, []).append(str(path))
        doc_type = head.get("type")
        if doc_type is None:
            issues.append("type is missing (vocabulary: " + ", ".join(sorted(KNOWLEDGE_TYPES)) + ")")
        elif doc_type not in KNOWLEDGE_TYPES:
            issues.append(f"type {doc_type!r} not in vocabulary {sorted(KNOWLEDGE_TYPES)}")
        if "status" in head and not isinstance(head.get("status"), str):
            issues.append("status must be a scalar like active, not a block")
        doc_status = head.get("status")
        if isinstance(doc_status, str) and doc_status not in KNOWLEDGE_STATUSES:
            issues.append(f"status {doc_status!r} not in vocabulary {sorted(KNOWLEDGE_STATUSES)}")
        topic = head.get("topic")
        if not isinstance(topic, str) or not topic.strip():
            issues.append("topic is missing or empty")
        for date_key in ("as_of", "updated"):
            value = head.get(date_key)
            if not isinstance(value, str) or not DATE_ONLY_RE.match(value):
                issues.append(f"{date_key} is missing or not YYYY-MM-DD: {value!r}")
        as_of_value, updated_value = head.get("as_of"), head.get("updated")
        if (
            isinstance(as_of_value, str)
            and isinstance(updated_value, str)
            and DATE_ONLY_RE.match(as_of_value)
            and DATE_ONLY_RE.match(updated_value)
            and updated_value < as_of_value
        ):
            issues.append(f"updated {updated_value} predates as_of {as_of_value}")
        if "see_also" in head and not isinstance(head.get("see_also"), list):
            issues.append("see_also must be an inline list like [id-a, id-b]")
        see = head.get("see_also")
        if isinstance(see, list):
            missing = sorted(
                ref
                for ref in see
                if isinstance(ref, str)
                and ref
                and "/" not in ref
                and not ref.startswith("~")
                and not REGISTRY_REMOTE_FORM.match(ref)
                and ref not in known_ids
            )
            if missing:
                broken_refs.append((str(path), missing))
        if issues:
            format_bad.append((str(path), issues))
        if (
            doc_type in KNOWLEDGE_STALE_TYPES
            and doc_status == "active"
            and isinstance(updated_value, str)
            and DATE_ONLY_RE.match(updated_value)
        ):
            age = (today - datetime.strptime(updated_value, "%Y-%m-%d").date()).days
            if age > KNOWLEDGE_STALE_DAYS:
                stale_files.append(f"{path} (updated {updated_value})")
    stats["knowledge_format_bad"] = len(format_bad)
    stats["see_also_broken"] = len(broken_refs)
    stats["knowledge_stale"] = len(stale_files)
    if format_bad:
        findings.append(
            finding(
                "knowledge-format",
                "medium",
                "knowledge/v1 files violate the format contract",
                format_bad[0][0],
                f"{len(format_bad)} file(s) declare knowledge/v1 but break the contract: "
                + "; ".join(
                    f"{Path(p).name}: {', '.join(items[:3])}" for p, items in format_bad[:5]
                ),
                "Fix the metadata per the CTX-11 contract (reference/spec.md), or drop the schema header.",
                {
                    "count": len(format_bad),
                    "issues": [
                        f"{Path(p).name}: {', '.join(items[:3])}"
                        for p, items in format_bad[:20]
                    ],
                },
            )
        )
    if broken_refs:
        first_path, first_missing = broken_refs[0]
        described = [
            f"{ref} (file exists but does not declare knowledge/v1)"
            if ref in knowledge_yaml_stems
            else ref
            for ref in first_missing[:5]
        ]
        findings.append(
            finding(
                "see-also-broken",
                "medium",
                "see_also references point at ids that do not exist",
                first_path,
                f"{len(broken_refs)} file(s) reference unknown ids; "
                f"first: {', '.join(described)}.",
                "Point see_also at existing ids only; rename both sides together, or drop the stale reference.",
                {"count": len(broken_refs), "refs": first_missing[:10]},
            )
        )
    duplicate_ids = {doc_id: owners for doc_id, owners in id_owners.items() if len(owners) > 1}
    stats["knowledge_duplicate_ids"] = len(duplicate_ids)
    if duplicate_ids:
        first_id, owners = sorted(duplicate_ids.items())[0]
        findings.append(
            finding(
                "duplicate-knowledge-id",
                "medium",
                "The same knowledge id lives in more than one file",
                owners[0],
                f"{len(duplicate_ids)} id(s) are duplicated; {first_id}: {owners[:3]}.",
                "One fact, one file: merge the files or split the ids so each id has exactly one home.",
                {"count": len(duplicate_ids), "ids": sorted(duplicate_ids)[:10]},
            )
        )
    if stale_files:
        findings.append(
            finding(
                "knowledge-stale",
                "medium",
                "State-flavored knowledge files are past the freshness SLA",
                stale_files[0],
                f"{len(stale_files)} active state/index file(s) not updated within "
                f"{KNOWLEDGE_STALE_DAYS} days.",
                "Re-verify the content and bump `updated`, or set status dormant/archived when it no longer needs review.",
                {"count": len(stale_files), "files": stale_files[:10]},
            )
        )
    return findings


def _check_duplicate_canonical(
    registry: Dict[str, Any], stats: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """Same-fact-many-homes from the scan's topic grouping.
    Owns stats keys: duplicate_knowledge."""
    findings: List[Dict[str, Any]] = []
    multi_topics = (registry.get("topics") or {}).get("multi_topics") or []
    stats["duplicate_knowledge"] = len(multi_topics)
    if multi_topics:
        examples = [path for topic in multi_topics[:4] for path in topic.get("paths", [])[:2]]
        reasons = sorted({str(topic.get("reason")) for topic in multi_topics})
        findings.append(
            finding(
                "duplicate-canonical",
                "medium",
                "The same fact has more than one home",
                examples[0] if examples else "",
                f"{len(multi_topics)} topic(s) have more than one source ({', '.join(reasons)}).",
                "Pick one canonical home and replace the others with pointers; keep a copy only when it is generated and verified.",
                {
                    "count": len(multi_topics),
                    "topics": [topic.get("key") for topic in multi_topics[:10]],
                    "examples": examples[:10],
                },
            )
        )
    return findings


def _check_structured_notes(
    knowledge: List[Dict[str, Any]], stats: Dict[str, Any]
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Structured note headers (CTX-09). Opt-in: only notes whose front-matter
    declares a ``type:`` are checked, so legacy prose notes never fire. The
    format follows the Obsidian properties convention (see reference/spec.md);
    truth pointers live in the body as CTX-03 links, not in the header.
    Owns stats keys: note_headers_total. Returns the structured note list for
    the pointer check."""
    findings: List[Dict[str, Any]] = []
    structured_notes: List[Dict[str, Any]] = []
    for item in knowledge:
        if Path(item["path"]).suffix.lower() != ".md":
            continue
        text = read_text(Path(item["path"]), limit=200_000)
        header = parse_note_header(text)
        if header is None:
            continue
        stats["note_headers_total"] += 1
        structured_notes.append(item)
        problems: List[str] = []
        if header.get("_malformed"):
            problems.append(
                f"front-matter cannot be parsed (line {header.get('line')}: "
                f"{header.get('text')})"
            )
        else:
            if not note_header_date(header):
                problems.append(
                    "no machine-readable date (one of "
                    f"{', '.join(NOTE_DATE_KEYS)} as YYYY-MM-DD)"
                )
        if problems:
            findings.append(
                finding(
                    "note-header-malformed",
                    "medium",
                    "Structured note header is not well-formed",
                    item["path"],
                    "; ".join(problems) + ".",
                    "Fix the front-matter (Obsidian properties convention: type + a "
                    "date key), or drop the type key to make it a plain note.",
                    {"problems": problems},
                )
            )
    return structured_notes, findings


def _check_project_layout(
    projects: List[Dict[str, Any]], stats: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """Project .agents layout. Owns stats keys: agents_dirs_total,
    agents_indexed, agents_dirs_compliant, agents_dirs_missing_index,
    agents_dirs_missing_slots, agents_dirs_extra_entries, misplaced_entries."""
    findings: List[Dict[str, Any]] = []
    for project in projects:
        if not project.get("agents_dir"):
            continue
        if project.get("container"):
            # A workspace/group root keeps container-level context; judging it as
            # a project would score scaffolding the group never needed.
            continue
        stats["agents_dirs_total"] += 1
        if project.get("has_index"):
            stats["agents_indexed"] += 1
        unknown = [
            entry
            for entry in project.get("agents_entries", [])
            if entry not in STANDARD_AGENTS_SLOTS and entry not in {"README.md", "AGENTS.md"}
        ]
        slots_ok = set(STANDARD_AGENTS_SLOTS).issubset(set(project.get("standard_slots", [])))
        if project.get("has_index") and slots_ok and not unknown:
            stats["agents_dirs_compliant"] += 1
        elif not project.get("has_index"):
            stats["agents_dirs_missing_index"] += 1
        elif not slots_ok:
            stats["agents_dirs_missing_slots"] += 1
        else:
            stats["agents_dirs_extra_entries"] += 1
        if unknown:
            stats["misplaced_entries"] += len(unknown)
            agents_root = Path(project.get("agents_dir") or "")
            suggested = {
                entry: suggest_slot(entry, (agents_root / entry).is_dir())
                for entry in unknown
            }
            findings.append(
                finding(
                    "misplaced-artifact",
                    "medium",
                    "Project .agents has task-shaped top-level entries",
                    resolved_str(str(project["path"])),
                    f"{len(unknown)} top-level entr{'y' if len(unknown) == 1 else 'ies'} do not match the standard slots.",
                    "Move task bundles under evidence/, plans/, wiki/ or archive/, then add a README index.",
                    {"entries": unknown[:100], "suggested": suggested},
                )
            )
    return findings


def _check_state_freshness(
    artifacts: List[Dict[str, Any]],
    projects: List[Dict[str, Any]],
    hub: Optional[Path],
    hub_layout: Dict[str, Path],
    git_failures: List[str],
    stats: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """State freshness. Plans are state-plane documents too, even though their
    kind is "plan"; select on the plane so project/group scopes are not
    vacuously fresh. The date ladder is declared (verified_at / updated /
    最后更新 / filename date) → owning repository's git date → file mtime,
    each tier reported as its own freshness source.
    Owns stats keys: state_docs_total, state_docs_fresh,
    state_docs_fresh_declared, state_docs_fresh_from_git,
    state_docs_fresh_from_mtime, git_probe_failures. Mutates git_failures."""
    findings: List[Dict[str, Any]] = []
    state_prefixes = ["handoff/", "provision/", "register/", ".agents/plans/"]
    if hub_layout:
        state_prefixes.append(relative(hub_layout["projects"], hub).rstrip("/") + "/")
    state_docs = [
        item
        for item in artifacts
        if item.get("plane") == "state"
        and any(item.get("rel", "").startswith(prefix) for prefix in state_prefixes)
    ]
    stats["state_docs_total"] = len(state_docs)
    commit_dates = git_last_commit_dates(hub) if hub else {}
    if commit_dates is None:
        if str(hub) not in git_failures:
            git_failures.append(str(hub))
        commit_dates = {}
    project_roots = {str(project["id"]): Path(project["path"]) for project in projects}
    project_commit_dates: Dict[str, Dict[str, str]] = {}
    stale_missing: List[str] = []
    stale_old: List[Tuple[str, str]] = []
    for item in state_docs:
        path = Path(item["path"])
        text = read_text(path, limit=500_000)
        verified = (
            item.get("verified_at")
            or extract_verified_date(text)
            or extract_filename_date(path)
        )
        source = "declared"
        if not verified:
            project_root = project_roots.get(str(item.get("project")))
            if project_root is None:
                verified = commit_dates.get(item.get("rel", ""), "")
            else:
                key = str(project_root)
                if key not in project_commit_dates:
                    dates = git_last_commit_dates(project_root)
                    if dates is None:
                        if key not in git_failures:
                            git_failures.append(key)
                        dates = {}
                    project_commit_dates[key] = dates
                verified = project_commit_dates[key].get(item.get("rel", ""), "")
            source = "git"
        if not verified and item.get("mtime"):
            # Files git never saw (e.g. gitignored `.agents/` docs) still carry
            # an mtime; count it as its own source instead of a freshness cliff.
            verified = (
                datetime.fromtimestamp(float(item["mtime"]), tz=timezone.utc)
                .date()
                .isoformat()
            )
            source = "mtime"
        if not verified:
            stale_missing.append(str(path))
            continue
        parsed = parse_date(verified)
        if parsed is None:
            stale_missing.append(str(path))
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        if (datetime.now(timezone.utc) - parsed.astimezone(timezone.utc)).days <= 90:
            stats["state_docs_fresh"] += 1
            stats[FRESH_SOURCE_STATS[source]] += 1
        else:
            stale_old.append((str(path), verified))
    if stale_missing:
        findings.append(
            finding(
                "stale-state",
                "medium",
                "State documents lack a verifiable freshness date",
                stale_missing[0],
                f"{len(stale_missing)} state document(s) have no verified_at or update date.",
                "Add verified_at to project state docs/handoffs/environment docs; refresh active ones before relying on them.",
                {"count": len(stale_missing), "examples": stale_missing[:10]},
            )
        )
    if stale_old:
        findings.append(
            finding(
                "stale-state",
                "medium",
                "State documents are older than 90 days",
                stale_old[0][0],
                f"{len(stale_old)} state document(s) are older than the 90-day SLA.",
                "Re-verify against git/runtime and update verified_at, or archive the document.",
                {"count": len(stale_old), "examples": stale_old[:10]},
            )
        )
    stats["git_probe_failures"] = len(git_failures)
    if git_failures:
        findings.append(
            finding(
                "git-unavailable",
                "high",
                "Repository state could not be read",
                git_failures[0],
                f"{len(git_failures)} repository(ies) could not be queried; tracked state and commit dates are unknown.",
                "Fix git access for these repositories and re-run; SIR and FRS do not count them as clean.",
                {"count": len(git_failures), "repos": git_failures[:10]},
            )
        )
    return findings


def _check_pointers(
    artifacts: List[Dict[str, Any]],
    structured_notes: List[Dict[str, Any]],
    hub: Optional[Path],
    home: Path,
    config: ScanConfig,
    stats: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """Pointers. Owns stats keys: pointer_files_total, pointer_files_scanned,
    pointers_checked, pointers_valid, broken_pointers, naked_pointers."""
    findings: List[Dict[str, Any]] = []
    pointer_files = [
        item
        for item in artifacts
        if Path(item["path"]).suffix.lower() == ".md"
        and (
            Path(item["path"]).name in {"AGENTS.md", "CLAUDE.md"}
            or (
                Path(item["path"]).name == "README.md"
                and (
                    # Project .agents indexes and hub knowledge indexes are
                    # instruction artifacts, including custom hub layouts; tool
                    # entry docs (hub sections and machine zones) carry
                    # pointers like any other entry document.
                    item.get("kind") == "instruction"
                    or item.get("kind") == "tool"
                    or item.get("path", "").endswith(
                        (
                            "/knowledge/README.md",
                            "/tools/README.md",
                            "/.agents/README.md",
                            "/.agents/wiki/README.md",
                        )
                    )
                )
            )
        )
    ]
    broken_by_file: List[Dict[str, Any]] = []
    naked_by_file: List[Dict[str, Any]] = []
    # Structured notes (CTX-09) opt their whole body into pointer checks, so a
    # pointer card's truth links are verified like any CTX-03 pointer.
    seen_pointer_paths = {item["path"] for item in pointer_files}
    pointer_files += [
        item for item in structured_notes if item["path"] not in seen_pointer_paths
    ]
    stats["pointer_files_total"] = len(pointer_files)
    scanned_pointer_files = pointer_files[:500]
    stats["pointer_files_scanned"] = len(scanned_pointer_files)
    for item in scanned_pointer_files:
        path = Path(item["path"])
        text = read_text(path, limit=1_000_000)
        pointers = extract_pointers(text)
        broken: List[str] = []
        for pointer in pointers:
            resolved = resolve_pointer(pointer, path, hub, home, config_roots=config.roots)
            if resolved is None:
                continue
            stats["pointers_checked"] += 1
            if resolved.exists():
                stats["pointers_valid"] += 1
            else:
                broken.append(pointer)
                stats["broken_pointers"] += 1
        if broken:
            broken_by_file.append(
                finding(
                    "broken-pointer",
                    "high",
                    "Broken context pointer",
                    resolved_str(str(path)),
                    f"{len(broken)} pointer(s) do not resolve.",
                    "Fix the path or replace it with a pointer that states when to read the target.",
                    {"pointers": broken[:10]},
                )
            )
        naked = extract_naked_pointers(text)
        if naked:
            stats["naked_pointers"] += len(naked)
            naked_by_file.append(
                finding(
                    "naked-pointer",
                    "medium",
                    "Path in prose is not machine-verifiable",
                    resolved_str(str(path)),
                    f"{len(naked)} file path(s) sit outside a link or code span, so the pointer check never sees them.",
                    "Wrap each path in a markdown link or inline code (CTX-03, reference/spec.md).",
                    {"paths": naked[:10]},
                )
            )
    findings.extend(broken_by_file[:100])
    findings.extend(naked_by_file[:100])
    return findings


def _check_secrets(
    registry: Dict[str, Any], home: Path, stats: Dict[str, Any]
) -> Tuple[
    List[Dict[str, Any]],
    Tuple[Dict[str, Any], List[Dict[str, str]], Set[str], List[str]],
]:
    """Secrets. Owns stats keys: secret_total, inline_bearers,
    secret_outside_root, secret_tracking_unknown, secret_in_git,
    secret_undeclared_outside. Returns the findings plus the
    credential-registry context (registry_info, entries, declared_paths,
    missing_locations) for the registry coverage check."""
    findings: List[Dict[str, Any]] = []
    secret_data = registry.get("secrets", {})
    secret_files = secret_data.get("files", [])
    inline = secret_data.get("inline_bearers", [])
    stats["secret_total"] = len(secret_files)
    stats["inline_bearers"] = sum(int(item.get("count", 0)) for item in inline)
    outside = [item for item in secret_files if not item.get("canonical")]
    stats["secret_outside_root"] = len(outside)
    stats["secret_tracking_unknown"] = sum(
        1 for item in secret_files if item.get("git_tracked") is None
    )
    registry_info = secret_data.get("registry") or {}
    entries = registry_info.get("entries") or []
    declared_paths: Set[str] = set()
    missing_locations: List[str] = []
    declared_entries: Set[str] = set()
    for entry in entries:
        for location in str(entry.get("locations", "")).split(";"):
            location = location.strip()
            if not location or location == "-":
                continue
            pattern = str(home / location[2:]) if location.startswith("~/") else os.path.expanduser(location)
            matches = glob.glob(pattern)
            if not matches:
                missing_locations.append(location)
                continue
            declared_entries.add(str(entry.get("id")))
            for match in matches:
                try:
                    declared_paths.add(str(Path(match).resolve()))
                except OSError:
                    continue
    tracked = [item for item in secret_files if item.get("git_tracked")]
    stats["secret_in_git"] = len(tracked)
    for item in tracked[:20]:
        findings.append(
            finding(
                "secret-in-git",
                "critical",
                "Credential file is tracked by git",
                item["path"],
                "A credential-bearing file is tracked; this must be removed from the index and history, not just deleted.",
                "Stop, rotate the credential, remove it from the index/history, and add an ignore rule.",
            )
        )
    outside_undeclared = []
    for item in outside:
        try:
            if str(Path(item["path"]).resolve()) not in declared_paths:
                outside_undeclared.append(item["path"])
        except OSError:
            continue
    stats["secret_undeclared_outside"] = len(outside_undeclared)
    if outside_undeclared:
        findings.append(
            finding(
                "secret-outside-root",
                "high",
                "Credential files are unregistered outside the canonical root",
                outside_undeclared[0],
                f"{len(outside_undeclared)} credential-bearing file(s) live outside"
                " ~/.agents/credentials and are not in the registry.",
                "Register each location with its scope, or move the value into the canonical root.",
                {
                    "count": len(outside_undeclared),
                    "declared_outside_root": len(outside) - len(outside_undeclared),
                    "examples": outside_undeclared[:10],
                },
            )
        )
    for item in inline:
        findings.append(
            finding(
                "secret-inline",
                "high",
                "Literal bearer token in host configuration",
                item["path"],
                f"{item.get('count', 0)} bearer token(s) are inline; values are redacted.",
                "Replace with an environment/credential reference supported by the host; rotate if the file was shared.",
                {"count": item.get("count", 0), "redacted": item.get("redacted", [])},
            )
        )
    return findings, (registry_info, entries, declared_paths, missing_locations)


def _check_credential_registry(
    registry: Dict[str, Any],
    secrets_ctx: Tuple[Dict[str, Any], List[Dict[str, str]], Set[str], List[str]],
    stats: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """Credential registry coverage. Owns stats keys: credentials_registered,
    credentials_by_scope, credentials_undeclared, credentials_missing."""
    registry_info, entries, declared_paths, missing_locations = secrets_ctx
    findings: List[Dict[str, Any]] = []
    secret_files = (registry.get("secrets") or {}).get("files", [])
    stats["credentials_registered"] = len(entries)
    stats["credentials_by_scope"] = {}
    for entry in entries:
        scope = entry.get("scope", "unknown")
        stats["credentials_by_scope"][scope] = stats["credentials_by_scope"].get(scope, 0) + 1
    if entries:
        undeclared = []
        for item in secret_files:
            try:
                resolved = str(Path(item["path"]).resolve())
            except OSError:
                continue
            if resolved not in declared_paths:
                undeclared.append(item["path"])
        stats["credentials_undeclared"] = len(undeclared)
        stats["credentials_missing"] = len(missing_locations)
        if undeclared:
            findings.append(
                finding(
                    "secret-undeclared",
                    "medium",
                    "Credential file is not registered",
                    undeclared[0],
                    f"{len(undeclared)} credential file(s) are absent from ~/.agents/credentials/registry.md.",
                    "Add an entry with scope (company/personal), site, account, location and keys.",
                    {"count": len(undeclared), "examples": undeclared[:10]},
                )
            )
        if missing_locations:
            findings.append(
                finding(
                    "secret-missing",
                    "medium",
                    "Registered credential location does not exist",
                    registry_info.get("path") or "",
                    f"{len(missing_locations)} registered location(s) resolve to nothing.",
                    "Rotate/restore the secret or drop the stale registry row.",
                    {"count": len(missing_locations), "examples": missing_locations[:10]},
                )
            )
    return findings


def _check_governance_overlap(registry: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Governance document overlap."""
    findings: List[Dict[str, Any]] = []
    governance_docs = registry.get("governance_docs") or []
    if len(governance_docs) > 4:
        findings.append(
            finding(
                "governance-overlap",
                "high",
                "Too many documents claim to define context governance",
                governance_docs[0],
                f"{len(governance_docs)} primary framework documents are present.",
                "Keep one primary framework and label the rest as facets or history.",
                {"docs": governance_docs},
            )
        )
    return findings


def _check_tmp_hygiene(projects: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Tmp and evidence hygiene."""
    findings: List[Dict[str, Any]] = []
    tmp_old: List[str] = []
    for project in projects:
        agents_dir = project.get("agents_dir")
        if not agents_dir:
            continue
        tmp_root = Path(agents_dir) / "tmp"
        if not tmp_root.is_dir():
            continue
        for path in tmp_root.rglob("*"):
            age = age_days(path)
            if age is not None and age > 14 and path.is_file():
                tmp_old.append(str(path))
    if tmp_old:
        findings.append(
            finding(
                "tmp-overdue",
                "low",
                "Temporary files exceed the 14-day TTL",
                tmp_old[0],
                f"{len(tmp_old)} file(s) in .agents/tmp are older than 14 days.",
                "Archive what matters and delete the rest; tmp is not a knowledge store.",
                {"count": len(tmp_old), "examples": tmp_old[:10]},
            )
        )
    return findings


def _check_plugin_manifests(registry: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Plugin manifest drift. A half-installed plugin (manifest file missing)
    is a high finding in its own right and stays in the version comparison as
    a null source, so it can never pass as green by being excluded."""
    findings: List[Dict[str, Any]] = []
    manifests = registry.get("plugin_manifests", {})
    for key, value in sorted(manifests.items()):
        if isinstance(value, dict) and not value.get("exists"):
            path = str(value.get("path") or "")
            findings.append(
                finding(
                    "host-manifest-drift",
                    "high",
                    "Plugin manifest is missing",
                    path,
                    f"plugin manifest missing: {path}",
                    "Reinstall or repair the plugin so every host manifest (codex, zcode, package) is present.",
                    {"key": key, "path": path},
                )
            )
    versions = {
        key: (value.get("version") if value.get("exists") else None)
        for key, value in manifests.items()
        if isinstance(value, dict) and (not value.get("exists") or value.get("version"))
    }
    if len(set(versions.values())) > 1:
        findings.append(
            finding(
                "host-manifest-drift",
                "high",
                "Plugin manifests disagree on version",
                str(manifests.get("package", {}).get("path", "")),
                f"Manifest versions: {versions}",
                "Synchronize Codex, ZCode and package versions before release.",
                {"versions": versions},
            )
        )
    return findings


def _check_registry_drift(
    registry: Dict[str, Any],
    config: ScanConfig,
    hub_layout: Dict[str, Path],
    stats: Dict[str, Any],
    previous_registry: Optional[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Registry drift (CTX-10): the machine table (registry.json), the hub's
    register (register/projects.yaml spec.path entries) and the git roots on
    disk each claim to know which projects exist; disagreement is a finding,
    never a CHI dimension. The human side needs a hub; the machine↔disk edge
    stands on its own for hub-less users.
    Owns stats keys: registry_rows, registry_rows_remote,
    registry_drift_dead_rows, registry_drift_unscanned_rows,
    registry_format_bad, registry_drift_unregistered,
    registry_drift_stale_machine."""
    findings: List[Dict[str, Any]] = []
    home = config.home
    hub = config.hub
    projects = registry.get("projects", [])
    if hub is not None and not (hub / "hub.yaml").is_file() and not (hub / "AGENTS.md").is_file():
        findings.append(
            finding(
                "hub-manifest-missing",
                "high",
                "Attached hub is not recognizable as a hub",
                str(hub),
                f"{hub} has neither hub.yaml nor AGENTS.md, so no hub contract applies to it.",
                "Point config/--hub at a real hub (`guster hub init`), or drop the hub setting.",
                {"hub": str(hub)},
            )
        )
    machine_paths: Set[str] = set()
    machine_projects: Set[str] = set()
    for project in projects:
        try:
            key = str(Path(project["path"]).resolve())
        except OSError:
            continue
        machine_paths.add(key)
        if not project.get("container"):
            machine_projects.add(key)
    human_paths: Set[str] = set()
    dead_rows: List[str] = []
    unscanned_rows: List[str] = []
    register_path: Optional[Path] = None
    register_rows: List[Dict[str, str]] = []
    register_text = ""
    register_display = ""
    if hub is not None:
        register_path = hub / "register" / "projects.yaml"
        register_display = resolved_str(str(register_path))
        if not register_path.is_file() and hub_layout.get("projects") is not None:
            findings.append(
                finding(
                    "registry-drift",
                    "medium",
                    "Hub has no register/projects.yaml",
                    register_display,
                    "The hub declares a projects section but carries no register table, so the "
                    "CTX-10 three-way diff cannot run (0.9.4 replaced projects/_registry.md).",
                    "Create register/projects.yaml (register/v1 header + one row per project); "
                    "see CHANGELOG 0.9.4 for the migration.",
                    {"hub": resolved_str(str(hub))},
                )
            )
        if register_path.is_file():
            register_text = read_text(register_path, limit=1_000_000)
            register_rows = parse_register_rows(register_text)
            hub_root = hub.expanduser().resolve()
            for row in register_rows:
                raw = row.get("path") or ""
                if not raw:
                    continue
                if REGISTRY_REMOTE_FORM.match(raw):
                    stats["registry_rows_remote"] += 1
                    continue
                resolved = resolve_registry_row_path(raw, hub_root, home)
                if resolved is None:
                    continue
                try:
                    key = str(resolved.resolve())
                except OSError:
                    continue
                human_paths.add(key)
                if not resolved.exists():
                    dead_rows.append(raw)
                elif getattr(config, "scope", "machine") == "machine" and key not in machine_paths:
                    unscanned_rows.append(raw)
    stats["registry_rows"] = len(register_rows)
    stats["registry_drift_dead_rows"] = len(dead_rows)
    stats["registry_drift_unscanned_rows"] = len(unscanned_rows)
    if register_path is not None and register_path.is_file():
        format_issues: List[str] = []
        header = parse_yaml_head(register_text)
        if header.get("schema") != REGISTER_SCHEMA:
            format_issues.append(f"schema is {header.get('schema')!r}, expected '{REGISTER_SCHEMA}'")
        if header.get("kind") != REGISTER_KIND:
            format_issues.append(f"kind is {header.get('kind')!r}, expected '{REGISTER_KIND}'")
        if not register_rows and has_top_level_row_keys(register_text):
            format_issues.append(
                "no project rows parsed — expected top-level `- id:` list items under `projects:`"
            )
        seen_ids: Dict[str, int] = {}
        for row in register_rows:
            row_id = row.get("id") or ""
            if not row_id:
                format_issues.append("a row has no id")
            else:
                seen_ids[row_id] = seen_ids.get(row_id, 0) + 1
            if not row.get("path"):
                format_issues.append(f"row {row_id or '(no id)'} has no spec.path")
            as_of = row.get("as_of") or ""
            if as_of and not DATE_ONLY_RE.match(as_of):
                format_issues.append(f"row {row_id or '(no id)'} as_of is not YYYY-MM-DD: {as_of!r}")
            row_status = row.get("status") or ""
            if row_status and row_status not in REGISTER_STATUSES:
                format_issues.append(
                    f"row {row_id or '(no id)'} status {row_status!r} not in vocabulary "
                    f"{sorted(REGISTER_STATUSES)}"
                )
        for row_id, count in seen_ids.items():
            if count > 1:
                format_issues.append(f"id {row_id!r} appears {count} times")
        stats["registry_format_bad"] = len(format_issues)
        if format_issues:
            findings.append(
                finding(
                    "registry-format",
                    "medium",
                    "Register table violates the register/v1 contract",
                    register_display,
                    "; ".join(format_issues[:10]),
                    "Fix the header (schema/kind) and each row (unique id, spec.path, YYYY-MM-DD as_of).",
                    {"count": len(format_issues), "issues": format_issues[:20]},
                )
            )
        if dead_rows:
            findings.append(
                finding(
                    "registry-drift",
                    "medium",
                    "Register rows point at paths that do not exist",
                    register_display,
                    f"{len(dead_rows)} row(s) in the register name a path that is not on disk.",
                    "Fix the row path, or delete the row; a register row must resolve to the project directory.",
                    {"count": len(dead_rows), "rows": dead_rows[:10]},
                )
            )
        if unscanned_rows:
            findings.append(
                finding(
                    "registry-drift",
                    "medium",
                    "Register rows are outside the machine scan",
                    register_display,
                    f"{len(unscanned_rows)} registered path(s) exist but the scan never records them; "
                    "the machine table cannot see what the register claims.",
                    "Add the containing directory to the configured roots (guster init/zones), or fix the row path.",
                    {"count": len(unscanned_rows), "rows": unscanned_rows[:10]},
                )
            )
        unregistered = sorted(machine_projects - human_paths)
        stats["registry_drift_unregistered"] = len(unregistered)
        if unregistered:
            findings.append(
                finding(
                    "registry-drift",
                    "low",
                    "Scanned projects are not registered in the hub",
                    unregistered[0],
                    f"{len(unregistered)} scanned project(s) have no row in the register.",
                    "Add a register/projects.yaml row per project, or waive deliberately unregistered ones in hub.yaml.",
                    {"count": len(unregistered), "examples": unregistered[:10]},
                )
            )
    if hub is not None and (hub / "register").is_dir():
        try:
            register_siblings = sorted((hub / "register").iterdir())
        except OSError:
            register_siblings = []
        for extra in register_siblings:
            if not extra.is_file() or extra.suffix.lower() not in {".yaml", ".yml"}:
                continue
            if register_path is not None and extra == register_path:
                continue
            head = parse_yaml_head(read_text(extra, limit=10_000))
            if head.get("schema") == REGISTER_SCHEMA and head.get("kind") != REGISTER_KIND:
                findings.append(
                    finding(
                        "registry-format",
                        "info",
                        "Register table declares a kind v1 does not validate",
                        resolved_str(str(extra)),
                        f"declares register/v1 kind={head.get('kind')!r} — "
                        "v1 validates kind: projects only.",
                        "This table is accepted as register data but never validated; keep the "
                        "projects table in register/projects.yaml.",
                        {"kind": head.get("kind")},
                    )
                )
    # Machine↔disk baseline. `previous_registry` is the pre-overwrite capture
    # (the default write path compares before storing); when it is not given,
    # the baseline is read from disk, strictly — a corrupt baseline is a
    # visible finding, never a silent skip of the drift check.
    if previous_registry is None:
        persisted_registry, baseline_error = load_json_strict(config.state_dir / "registry.json")
    else:
        persisted_registry, baseline_error = previous_registry, None
    if baseline_error is not None:
        findings.append(
            finding(
                "registry-drift",
                "medium",
                "Machine registry baseline is corrupt",
                str(config.state_dir / "registry.json"),
                "registry baseline corrupt; drift check skipped",
                "Fix or delete registry.json so the machine↔disk drift check has a readable baseline.",
                {"error": baseline_error},
            )
        )
    elif isinstance(persisted_registry, dict) and isinstance(persisted_registry.get("projects"), list):
        persisted_paths: Set[str] = set()
        for project in persisted_registry["projects"]:
            if not isinstance(project, dict) or not project.get("path"):
                continue
            try:
                persisted_paths.add(str(Path(project["path"]).resolve()))
            except OSError:
                continue
        if persisted_paths != machine_paths:
            vanished = sorted(persisted_paths - machine_paths)
            appeared = sorted(machine_paths - persisted_paths)
            stats["registry_drift_stale_machine"] = len(vanished) + len(appeared)
            findings.append(
                finding(
                    "registry-drift",
                    "low",
                    "Machine registry is out of date with disk",
                    str(config.state_dir / "registry.json"),
                    f"{len(vanished)} project(s) listed in registry.json no longer scan; "
                    f"{len(appeared)} on disk are missing from it.",
                    "Re-run `guster scan`/`guster doctor` without --no-write to refresh the machine table.",
                    {"vanished": vanished[:10], "appeared": appeared[:10]},
                )
            )
    return findings


def _waiver_reason(item: Dict[str, Any], waivers: Sequence[Dict[str, str]]) -> Optional[str]:
    target = str(item.get("path") or "")
    for waiver in waivers:
        if waiver["rule"] != item.get("rule"):
            continue
        scope_path = waiver.get("path", "")
        if not scope_path:
            return waiver["reason"]
        root = Path(os.path.expanduser(scope_path))
        try:
            if Path(target).resolve() == root.resolve():
                return waiver["reason"]
            if root.resolve() in Path(target).resolve().parents:
                return waiver["reason"]
        except OSError:
            continue
    return None


def extract_verified_date(text: str) -> str:
    """Declared date from the document header; prose deeper down is not a claim about this file."""
    head = "\n".join(text.splitlines()[:DATE_HEADER_LINES])
    match = re.search(
        VERIFIED_DATE_KEYS + r"\s*\*{0,2}\s*[:：]\s*\*{0,2}\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})",
        head,
    )
    return match.group(1) if match else ""


def extract_filename_date(path: Path) -> str:
    """Only a date that opens the filename counts; a ticket id is not a freshness claim."""
    stem = path.stem.lstrip(".")
    match = re.match(r"(20\d{2})[-_]?(\d{2})[-_]?(\d{2})(?:$|[-_.])", stem)
    if not match:
        return ""
    year, month, day = match.groups()
    try:
        datetime(int(year), int(month), int(day))
    except ValueError:
        return ""
    return f"{year}-{month}-{day}"


def count_lines(path: Path) -> int:
    text = read_text(path, limit=5_000_000)
    return len(text.splitlines()) if text else 0


def file_size(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0
