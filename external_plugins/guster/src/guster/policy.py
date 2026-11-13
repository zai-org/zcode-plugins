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
    NOTE_DATE_KEYS,
    age_days,
    extract_naked_pointers,
    extract_pointers,
    git_last_commit_dates,
    note_header_date,
    parse_date,
    parse_note_header,
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


def run_policy(registry: Dict[str, Any], config: ScanConfig) -> Dict[str, Any]:
    findings: List[Dict[str, Any]] = []
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
        "duplicate_knowledge": 0,
        "note_headers_total": 0,
        "governance_docs": len(registry.get("governance_docs", [])),
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

    # Resident budget: every host entry file that exists, counted once.
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
                "Move detail into guster-hub-reference.md.",
            )
        )

    if scope != "hub":
        # Skill metadata budget
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

        # Skill copy drift
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

    # Knowledge index coverage and duplicates
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

    for scope, items in orphan_groups.items():
        severity = "medium" if scope in {"general", "project", "workgroup"} else "low"
        examples = [relative(Path(item["path"]), Path(item["path"]).parent) for item in items[:10]]
        findings.append(
            finding(
                "orphan-knowledge",
                severity,
                "Knowledge files are not indexed",
                str(items[0]["path"]),
                f"{len(items)} knowledge file(s) in scope '{scope}' are absent from the relevant README index.",
                "Add each file to its README index, or merge/delete it if obsolete.",
                {"count": len(items), "examples": examples},
            )
        )

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

    # Structured note headers (CTX-09). Opt-in: only notes whose front-matter
    # declares a ``type:`` are checked, so legacy prose notes never fire. The
    # format follows the Obsidian properties convention (see reference/spec.md);
    # truth pointers live in the body as CTX-03 links, not in the header.
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

    # Project .agents layout
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
                    project["path"],
                    f"{len(unknown)} top-level entr{'y' if len(unknown) == 1 else 'ies'} do not match the standard slots.",
                    "Move task bundles under evidence/, plans/, wiki/ or archive/, then add a README index.",
                    {"entries": unknown[:100], "suggested": suggested},
                )
            )

    # State freshness. Plans are state-plane documents too, even though their
    # kind is "plan"; select on the plane so project/group scopes are not
    # vacuously fresh. Freshness is declared (verified_at / 最后更新 / filename
    # date) and otherwise falls back to the owning repository's git date.
    state_prefixes = ["handoff/", "provision/", ".agents/plans/"]
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
            stats["state_docs_fresh_declared" if source == "declared" else "state_docs_fresh_from_git"] += 1
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
                "Add verified_at to project cards/handoffs/environment docs; refresh active cards before relying on them.",
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

    # Pointers
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
                    # instruction artifacts, including custom hub layouts.
                    item.get("kind") == "instruction"
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
    scanned_pointer_files = pointer_files[:200]
    stats["pointer_files_scanned"] = len(scanned_pointer_files)
    for item in scanned_pointer_files:
        path = Path(item["path"])
        text = read_text(path, limit=1_000_000)
        pointers = extract_pointers(text)
        broken: List[str] = []
        for pointer in pointers:
            resolved = resolve_pointer(pointer, path, hub, home)
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
                    str(path),
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
                    str(path),
                    f"{len(naked)} file path(s) sit outside a link or code span, so the pointer check never sees them.",
                    "Wrap each path in a markdown link or inline code (CTX-03, reference/spec.md).",
                    {"paths": naked[:10]},
                )
            )
    findings.extend(broken_by_file[:100])
    findings.extend(naked_by_file[:100])

    # Secrets
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

    # Credential registry coverage
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

    # Governance document overlap
    governance_docs = registry.get("governance_docs", [])
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

    # Tmp and evidence hygiene
    tmp_old: List[str] = []
    for project in projects:
        agents_dir = project.get("agents_dir")
        if not agents_dir:
            continue
        tmp_root = Path(agents_dir) / "tmp"
        if not tmp_root.is_dir():
            continue
        for path in tmp_root.rglob("*"):
            if path.is_file() and age_days(path) > 14:
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

    # Plugin manifest drift
    manifests = registry.get("plugin_manifests", {})
    versions = {
        key: value.get("version")
        for key, value in manifests.items()
        if isinstance(value, dict) and value.get("exists") and value.get("version")
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

    scope = getattr(config, "scope", "machine")
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
        r"(?:最后更新|更新时间|更新于|最近核实|最后核实|已核实|verified_at)\s*\*{0,2}\s*[:：]\s*\*{0,2}\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})",
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
