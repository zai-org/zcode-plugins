from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from . import __version__
from .layout import resolve_hub_layout
from .util import (
    EXCLUDE_DIRS,
    find_git_roots,
    first_heading,
    git_tracked,
    is_indexed,
    is_under,
    iter_files,
    load_json,
    now_iso,
    parse_frontmatter,
    read_text,
    relative,
    sha256_file,
    sha256_text,
)


STANDARD_AGENTS_SLOTS = ["plans", "wiki", "evidence", "skills", "tmp", "archive"]
ARTIFACT_KIND_PRIORITY = {
    "instruction": 0,
    "knowledge": 1,
    "plan": 2,
    "tool": 3,
    "evidence": 4,
    "state": 5,
    "archive": 6,
}
GENERIC_TOPIC_STEMS = {
    "readme",
    "index",
    "agents",
    "notes",
    "notesmd",
    "proposal",
    "tasks",
    "design",
    "spec",
    "plan",
    "todo",
    "changelog",
    "summary",
    "skill",
    "openspec",
    "config",
    "example",
    "template",
}
SECRET_SUFFIX_NAMES = {".env", "config.json", "credentials.json", "credentials.local.json"}
INLINE_CONFIG_FILES = [
    "~/.codex/config.toml",
    "~/.zcode/cli/config.json",
    "~/.dsh/cordis.patch.yml",
]
INLINE_PATTERNS = [
    # Host configs carry tokens in more shapes than one: keep the detector
    # narrow enough to stay quiet, broad enough not to miss a literal key.
    r"\bBearer\s+([A-Za-z0-9._\-]{8,})",
    r"\bsk-[A-Za-z0-9]{16,}",
    r"(?i)\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret[_-]?key)"
    r"\s*[:=]\s*[\"']?([A-Za-z0-9._\-]{16,})",
]
SECRET_ENV_DEPTH = 2
HASH_LIMIT = 8_000_000


@dataclass
class ScanConfig:
    home: Path
    hub: Optional[Path]
    roots: List[Path]
    state_dir: Path
    plugin_root: Optional[Path] = None
    max_depth: int = 5
    scope: str = "machine"
    now: str = field(default_factory=now_iso)
    # Declared machine zones (`config.json` `zones`): {"path": ..., "profile": ...}.
    # "light" zones are tool areas — AGENTS/README artifacts and secrets, no
    # project slots — so a non-git tool layer is governed without pretending
    # each tool is a repository.
    zones: List[Dict[str, str]] = field(default_factory=list)
    # First-run UX: no config.json existed, and roots came from auto-detection.
    # Drives the "run `guster init`" banner; empty candidates fail loud earlier.
    unconfigured: bool = False
    auto_roots: bool = False


def scope_roots(config: ScanConfig) -> Optional[List[Path]]:
    """Directories that define the run's scope; None means the machine-wide view.

    The same boundary filters artifacts and findings, so a scoped report never
    counts a document it can no longer raise a finding about.
    """
    if config.scope == "hub":
        return [config.hub.expanduser().resolve()] if config.hub else []
    if config.scope in {"project", "group"}:
        return [root.expanduser().resolve() for root in config.roots]
    return None


def in_scope_path(value: str, roots: Sequence[Path]) -> bool:
    if not value:
        return False
    try:
        candidate = Path(value).expanduser().resolve()
    except OSError:
        return False
    return any(candidate == root or root in candidate.parents for root in roots)


def default_roots(home: Path) -> List[Path]:
    """Generic first-run candidates; empty when none exist so callers fail loud."""
    candidates = [home / name for name in ("Projects", "code", "dev", "src")]
    seen: Set[str] = set()
    roots: List[Path] = []
    for candidate in candidates:
        if candidate.is_dir():
            resolved = str(candidate.resolve())
            if resolved not in seen:
                seen.add(resolved)
                roots.append(candidate)
    return roots


def dedupe_artifacts(items: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Keep one record per path so ratios count files, not scan passes."""
    best: Dict[str, Tuple[int, Dict[str, Any]]] = {}
    order: List[str] = []
    for item in items:
        path = item["path"]
        rank = ARTIFACT_KIND_PRIORITY.get(str(item.get("kind")), 9)
        current = best.get(path)
        if current is None:
            order.append(path)
            best[path] = (rank, item)
        elif rank < current[0]:
            best[path] = (rank, item)
    return [best[path][1] for path in order]


def topic_key(path: Path) -> str:
    stem = path.stem.strip().lower().lstrip(".")
    stem = re.sub(r"[-_ ]?20\d{6}$", "", stem)
    stem = re.sub(r"[-_ ]?\d{4}-\d{2}-\d{2}$", "", stem)
    return stem


def derive_topics(
    artifacts: Sequence[Dict[str, Any]],
    skills: Sequence[Dict[str, Any]],
) -> Dict[str, Any]:
    """Group knowledge into facts and report the ones with more than one home."""
    knowledge_all = [
        item
        for item in artifacts
        if item.get("kind") == "knowledge"
        and Path(item["path"]).name.lower() not in {"readme.md", "agents.md"}
    ]
    knowledge = [item for item in knowledge_all if item.get("hash")]
    unhashed = sum(1 for item in knowledge_all if not item.get("hash"))
    consumed: Set[str] = set()
    topics: List[Dict[str, Any]] = []

    by_stem: Dict[str, List[Dict[str, Any]]] = {}
    for item in knowledge:
        stem = topic_key(Path(item["path"]))
        if not stem or stem in GENERIC_TOPIC_STEMS or len(stem) < 4:
            continue
        by_stem.setdefault(stem, []).append(item)
    for stem, items in sorted(by_stem.items()):
        hashes = {item["hash"] for item in items}
        if len(hashes) > 1:
            topics.append(
                {
                    "key": stem,
                    "reason": "same-name-different-content",
                    "sources": len(hashes),
                    "paths": [item["path"] for item in items],
                }
            )
            consumed.update(item["path"] for item in items)

    by_hash: Dict[str, List[Dict[str, Any]]] = {}
    for item in knowledge:
        if item["path"] in consumed:
            continue
        by_hash.setdefault(item["hash"], []).append(item)
    for digest, items in by_hash.items():
        topics.append(
            {
                "key": topic_key(Path(items[0]["path"])) or digest[:8],
                "reason": "duplicate-content" if len(items) > 1 else "single",
                "sources": len(items),
                "paths": [item["path"] for item in items],
            }
        )

    for skill in skills:
        copies = skill.get("copies") or []
        hashes = {copy.get("hash", "") for copy in copies} or {skill.get("hash", "")}
        topics.append(
            {
                "key": f"skill:{skill['name']}",
                "reason": "skill-copy-drift" if len(hashes) > 1 else "single",
                "sources": len(hashes) if len(hashes) > 1 else 1,
                "paths": [copy.get("root", "") for copy in copies] or [skill.get("root", "")],
            }
        )

    multi = [topic for topic in topics if int(topic.get("sources", 1)) > 1]
    return {
        "total": len(topics),
        "multi": len(multi),
        "multi_topics": multi,
        "unhashed": unhashed,
    }


def scan(config: ScanConfig) -> Dict[str, Any]:
    home = config.home
    hub = config.hub
    scope = config.scope
    roots = [root for root in config.roots if root.exists()]
    git_roots = find_git_roots(roots, max_depth=config.max_depth)
    project_roots: List[Path] = list(git_roots)
    known = {item.resolve() for item in project_roots}
    for root in roots:
        resolved = root.resolve()
        if resolved in known:
            continue
        if resolved == home.resolve() and not has_project_marker(root):
            # `~/.agents/` is the user-level context root; the home directory is
            # a workspace, not a project, unless it carries its own markers.
            continue
        if looks_like_project(root):
            project_roots.append(root)
            known.add(resolved)

    projects: List[Dict[str, Any]] = []
    project_tracked: Dict[str, Optional[Set[str]]] = {}
    used_ids: Set[str] = set()
    for root in sorted(project_roots, key=lambda item: str(item)):
        tracked = git_tracked(root)
        project_tracked[str(root)] = tracked
        project = scan_project(
            root=root,
            group=root.parent.name,
            tracked=tracked,
            now=config.now,
            taken=used_ids,
        )
        used_ids.add(project["id"])
        projects.append(project)

    mark_containers(projects)
    index_texts = load_index_texts(home, hub, projects)

    walk_errors: List[str] = []
    artifacts: List[Dict[str, Any]] = []
    zones = [
        item
        for item in config.zones
        if Path(item["path"]).expanduser().is_dir()
    ]
    if scope != "hub":
        artifacts.extend(scan_project_agents(projects, index_texts, project_tracked, walk_errors))
        artifacts.extend(scan_zones(zones, walk_errors))
    artifacts.extend(scan_hub_knowledge(hub, index_texts, walk_errors))
    if scope != "hub":
        artifacts.extend(scan_local_wiki(home, index_texts, walk_errors))
    artifacts = dedupe_artifacts(artifacts)
    scoped = scope_roots(config)
    if scoped is not None:
        # Scoped runs must not carry artifacts whose findings they filter out:
        # that inflates ICR/FRS/PHR denominators and depresses the score.
        artifacts = [item for item in artifacts if in_scope_path(item["path"], scoped)]

    skills = scan_skills(home) if scope != "hub" else []
    topics = derive_topics(artifacts, skills)
    secret_files = scan_secret_files(
        home,
        hub,
        projects,
        project_tracked,
        zones=zones,
        include_home=scope != "hub",
        errors=walk_errors,
    )
    credential_registry = scan_credential_registry(home)
    inline_bearers = scan_inline_bearers(home) if scope != "hub" else []
    governance_docs = find_governance_docs(home, hub)
    if scope == "hub" and hub:
        governance_docs = [
            item for item in governance_docs if is_under(Path(item), hub)
        ]
    manifests = scan_plugin_manifests(config.plugin_root) if scope != "hub" else {}

    registry: Dict[str, Any] = {
        "version": 1,
        "plugin": {"name": "guster", "version": __version__},
        "generated_at": config.now,
        "scope": config.scope,
        "home": str(home),
        "hub": str(hub) if hub else None,
        "state_dir": str(config.state_dir),
        "unconfigured": config.unconfigured,
        "auto_roots": config.auto_roots,
        "workspaces": [str(root) for root in roots],
        "scan_errors": {"count": len(walk_errors), "examples": walk_errors[:10]},
        "zones": [
            {
                "path": str(Path(item["path"]).expanduser()),
                "profile": item.get("profile", "light"),
                "tools": count_zone_tools(Path(item["path"]).expanduser()),
            }
            for item in zones
        ],
        "projects": projects,
        "skills": skills,
        "topics": topics,
        "artifacts": artifacts,
        "secrets": {
            "canonical_roots": [
                str(home / ".agents" / "credentials"),
            ],
            "files": secret_files,
            "inline_bearers": inline_bearers,
            "registry": credential_registry,
        },
        "governance_docs": governance_docs,
        "plugin_manifests": manifests,
        "summary": summarize(
            projects,
            skills,
            artifacts,
            secret_files,
            inline_bearers,
            count_project_cards(hub, walk_errors),
        ),
    }
    return registry


def mark_containers(projects: List[Dict[str, Any]]) -> None:
    """A directory holding other scanned projects is a workspace/group, not a project.

    Group-level AGENTS.md files are instruction assets of the group; counting the
    container as a project inflates the project count and turns one container's
    partial `.agents/` into a permanent placement failure.
    """
    roots = [Path(project["path"]) for project in projects]
    for project in projects:
        root = Path(project["path"])
        project["container"] = any(root in other.parents for other in roots if other != root)


def looks_like_project(root: Path) -> bool:
    return (
        has_project_marker(root)
        or (root / ".agents").is_dir()
        or (root / "skills").is_dir()
    )


def has_project_marker(root: Path) -> bool:
    return (
        (root / "AGENTS.md").is_file()
        or (root / "CLAUDE.md").is_file()
        or (root / "package.json").is_file()
    )


def scan_project(
    root: Path,
    group: str,
    tracked: Optional[Set[str]],
    now: str,
    taken: Optional[Set[str]] = None,
) -> Dict[str, Any]:
    agent_files = find_agent_files(root, max_depth=3)
    agents_dir = root / ".agents"
    agents_entries: List[str] = []
    standard_slots: List[str] = []
    has_index = False
    if agents_dir.is_dir():
        try:
            agents_entries = sorted(
                item.name for item in agents_dir.iterdir() if item.name != ".DS_Store"
            )
        except OSError:
            agents_entries = []
        standard_slots = [slot for slot in STANDARD_AGENTS_SLOTS if (agents_dir / slot).exists()]
        has_index = agents_index_present(agents_dir)

    status = "unknown"
    for agent_file in agent_files:
        text = read_text(agent_file, limit=200_000)
        match = re.search(r"\*\*状态\*\*\s*[:：]\s*(.+)", text)
        if match:
            status = match.group(1).strip()
            break

    project_id = unique_project_id(root.name, root, taken)
    return {
        "id": project_id,
        "path": str(root),
        "group": group,
        "git_root": str(root),
        "agent_files": [relative(path, root) for path in agent_files],
        "agents_dir": str(agents_dir) if agents_dir.is_dir() else None,
        "agents_entries": agents_entries,
        "standard_slots": standard_slots,
        "has_index": has_index,
        "skills": find_project_skills(root),
        "tools": find_project_tools(root),
        "status": status,
        "last_scan": now,
        "container": False,
        "git_state": "ok" if tracked is not None else "error",
        "tracked_count": len(tracked) if tracked is not None else None,
    }


def agents_index_present(agents_dir: Path) -> bool:
    """An index must have content; an empty placeholder indexes nothing."""
    for name in ("README.md", "AGENTS.md"):
        path = agents_dir / name
        try:
            if path.is_file() and path.stat().st_size > 0:
                return True
        except OSError:
            continue
    return False


def unique_project_id(name: str, root: Path, taken: Optional[Set[str]] = None) -> str:
    """Slug id; a same-name sibling gets a short path-hash suffix so
    `project:{id}` index keys never overwrite each other."""
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", name.strip()).strip("-")
    base = cleaned or sha256_text(str(root))[:10]
    if taken is not None and base in taken:
        return f"{base}-{sha256_text(str(root))[:8]}"
    return base


def find_agent_files(root: Path, max_depth: int = 3) -> List[Path]:
    results: List[Path] = []
    for name in ("AGENTS.md", "CLAUDE.md"):
        candidate = root / name
        if candidate.is_file():
            results.append(candidate)
    root_depth = len(root.resolve().parts)
    for current, dirs, files in os.walk(root):
        current_path = Path(current)
        depth = len(current_path.resolve().parts) - root_depth
        if depth >= max_depth:
            dirs[:] = []
        dirs[:] = sorted(d for d in dirs if d not in EXCLUDE_DIRS and not d.startswith(".git"))
        for name in ("AGENTS.md", "CLAUDE.md"):
            candidate = current_path / name
            if candidate.is_file() and candidate not in results:
                results.append(candidate)
    return sorted(results, key=lambda item: str(item))


def find_project_skills(root: Path) -> List[str]:
    roots = [root / "skills", root / ".agents" / "skills", root / ".claude" / "skills"]
    found: List[str] = []
    for skill_root in roots:
        if not skill_root.is_dir():
            continue
        for child in sorted(skill_root.iterdir()):
            if (child / "SKILL.md").is_file():
                found.append(str(child))
    return found


def find_project_tools(root: Path) -> List[str]:
    tools_root = root / "tools"
    if not tools_root.is_dir():
        return []
    found: List[str] = []
    for child in sorted(tools_root.iterdir()):
        if child.is_dir() and ((child / "AGENTS.md").exists() or (child / "README.md").exists()):
            found.append(str(child))
    return found


def load_index_texts(home: Path, hub: Optional[Path], projects: Sequence[Dict[str, Any]]) -> Dict[str, str]:
    texts: Dict[str, str] = {}
    if hub:
        layout = resolve_hub_layout(hub)
        texts["hub"] = read_text(layout["knowledge"] / "README.md", limit=2_000_000)
        tools_root = layout.get("tools")
        if tools_root:
            texts["tools"] = read_text(tools_root / "README.md", limit=2_000_000)
    texts["local_wiki"] = read_text(home / ".agents" / "wiki" / "README.md", limit=2_000_000)
    for project in projects:
        agents_dir = project.get("agents_dir")
        if agents_dir:
            texts[f"project:{project['id']}"] = read_text(
                Path(agents_dir) / "README.md", limit=1_000_000
            )
    return texts


def artifact_record(
    path: Path,
    kind: str,
    plane: str,
    scope: str,
    project_id: Optional[str],
    indexed: Optional[bool],
    tracked: Optional[Set[str]] = None,
    base: Optional[Path] = None,
) -> Dict[str, Any]:
    text = ""
    if path.suffix.lower() in {".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".toml"}:
        text = read_text(path, limit=1_000_000)
    frontmatter, body = parse_frontmatter(text)
    size = 0
    mtime = 0.0
    try:
        # One stat, no exists-then-stat window: a file deleted mid-scan reads
        # as absent (0), never as a crash.
        info = path.stat()
        size = info.st_size
        mtime = info.st_mtime
    except OSError:
        pass
    tracked_flag: Optional[bool] = False
    if tracked is None:
        # Unknown is not "untracked": a failed git probe must stay visible.
        tracked_flag = None
    elif base is not None:
        try:
            tracked_flag = str(path.resolve().relative_to(base.resolve())) in tracked
        except (OSError, ValueError):
            tracked_flag = False
    oversized = size > HASH_LIMIT
    file_hash = "" if oversized else sha256_file(path)
    return {
        "path": str(path),
        "rel": relative(path, base) if base else str(path),
        "kind": kind,
        "plane": plane,
        "scope": scope,
        "project": project_id,
        "size": size,
        "mtime": mtime,
        "hash": file_hash,
        "hash_error": not oversized and not file_hash,
        "frontmatter": frontmatter,
        "title": first_heading(body if text else "", path.stem),
        "indexed": indexed,
        "git_tracked": tracked_flag,
        "verified_at": frontmatter.get("verified_at") or frontmatter.get("updated", ""),
        "stale_after": frontmatter.get("stale_after", ""),
        "status": frontmatter.get("status", ""),
    }


def scan_project_agents(
    projects: Sequence[Dict[str, Any]],
    index_texts: Dict[str, str],
    project_tracked: Dict[str, Optional[Set[str]]],
    errors: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    for project in projects:
        root = Path(project["path"])
        tracked = project_tracked.get(project["path"], set())
        for agent_rel in project.get("agent_files", []):
            path = root / agent_rel
            records.append(
                artifact_record(path, "instruction", "instruction", "project", project["id"], None, tracked, root)
            )
        agents_dir = project.get("agents_dir")
        if not agents_dir:
            continue
        agents_path = Path(agents_dir)
        index_text = index_texts.get(f"project:{project['id']}", "")
        index_path = agents_path / "README.md"
        if index_path.is_file() and not index_path.is_symlink():
            records.append(
                artifact_record(
                    index_path, "instruction", "instruction", "project", project["id"], None, tracked, root
                )
            )
        for slot, kind, plane in (
            ("plans", "plan", "state"),
            ("wiki", "knowledge", "knowledge"),
            ("evidence", "evidence", "evidence"),
            ("archive", "archive", "evidence"),
        ):
            slot_root = agents_path / slot
            if not slot_root.is_dir():
                continue
            if slot_root.is_symlink():
                # A shared slot (e.g. a wiki linked from a sibling checkout) is
                # scanned under the project that owns the real directory.
                continue
            for path in iter_files(slot_root, suffixes={".md", ".json", ".yaml", ".yml"}, errors=errors):
                if "openspec" in path.parts[:-1]:
                    # OpenSpec store config and change metadata are state, not knowledge.
                    continue
                if path.is_symlink():
                    continue
                indexed = is_indexed(path.name, index_text) if kind == "knowledge" else None
                records.append(
                    artifact_record(path, kind, plane, "project", project["id"], indexed, tracked, root)
                )
    return records


def scan_hub_knowledge(
    hub: Optional[Path],
    index_texts: Dict[str, str],
    errors: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    if not hub:
        return []
    records: List[Dict[str, Any]] = []
    tracked = git_tracked(hub)
    knowledge_index = index_texts.get("hub", "")
    layout = resolve_hub_layout(hub)
    knowledge_index_path = layout["knowledge"] / "README.md"
    if knowledge_index_path.is_file():
        records.append(
            artifact_record(
                knowledge_index_path, "instruction", "instruction", "project", None, None, tracked, hub
            )
        )
    default_suffixes = {".md", ".json", ".yaml", ".yml"}
    groups = [
        (layout["knowledge"] / "general", "knowledge", "knowledge", "general", True, default_suffixes),
        (layout["knowledge"] / "projects", "knowledge", "knowledge", "project", True, default_suffixes),
        (layout["knowledge"] / "workgroups", "knowledge", "knowledge", "workgroup", True, default_suffixes),
        (layout["projects"], "state", "state", "project", False, default_suffixes),
        (hub / "handoff", "state", "state", "project", False, default_suffixes),
        (hub / "provision", "state", "state", "project", False, default_suffixes),
        (hub / "reports", "evidence", "evidence", "project", False, default_suffixes),
        (hub / "Human Output", "evidence", "evidence", "project", False, default_suffixes),
        (hub / "manuals", "state", "state", "project", False, default_suffixes),
        (hub / "cron-tasks", "state", "state", "project", False, default_suffixes | {".plist"}),
        (hub / "openspec", "plan", "state", "project", False, default_suffixes),
        (hub / "archive", "archive", "archive", "project", False, default_suffixes),
        (hub / ".agents" / "plans", "plan", "state", "project", False, default_suffixes),
    ]
    for root, kind, plane, scope, check_index, suffixes in groups:
        if not root.is_dir():
            continue
        for path in iter_files(root, suffixes=suffixes, errors=errors):
            indexed = None
            if check_index and kind == "knowledge":
                indexed = is_indexed(path.name, knowledge_index)
            records.append(
                artifact_record(path, kind, plane, scope, None, indexed, tracked, hub)
            )
    strategy = hub / "strategy.md"
    if strategy.is_file():
        records.append(
            artifact_record(
                strategy, "state", "state", "project", None, None, tracked, hub
            )
        )
    tools_root = layout.get("tools")
    for path in iter_files(tools_root, suffixes={".md"}, max_depth=3, errors=errors) if tools_root else []:
        if path.name in {"AGENTS.md", "README.md"}:
            records.append(
                artifact_record(path, "tool", "capability", "project", None, None, tracked, hub)
            )
    return records


def scan_local_wiki(
    home: Path,
    index_texts: Dict[str, str],
    errors: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    root = home / ".agents" / "wiki"
    if not root.is_dir():
        return []
    index_text = index_texts.get("local_wiki", "")
    records: List[Dict[str, Any]] = []
    for path in iter_files(root, suffixes={".md"}, skip_dirs=EXCLUDE_DIRS | {"assets"}, errors=errors):
        if path.is_symlink():
            # Compatibility links point at a canonical file already counted.
            continue
        records.append(
            artifact_record(
                path,
                "knowledge",
                "knowledge",
                "local",
                None,
                is_indexed(path.name, index_text),
            )
        )
    return records


def count_zone_tools(root: Path) -> int:
    """Tool count for a zone summary: flat zones hold tools at depth 1,
    grouped zones (like common/company) hold them at depth 2."""
    if not root.is_dir():
        return 0
    count = 0
    for child in sorted(root.iterdir()):
        if not child.is_dir() or child.name.startswith("."):
            continue
        if (child / "AGENTS.md").exists() or (child / "README.md").exists():
            count += 1
            continue
        for grandchild in sorted(child.iterdir()):
            if not grandchild.is_dir() or grandchild.name.startswith("."):
                continue
            if (grandchild / "AGENTS.md").exists() or (grandchild / "README.md").exists():
                count += 1
    return count


def scan_zones(
    zones: Sequence[Dict[str, str]],
    errors: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Light-profile zone scan: entry docs and nothing else.

    A declared tool zone is not a project tree. The light profile collects
    AGENTS.md/README.md so pointer health and freshness can see them, and the
    caller feeds the zone root to the secret scan; slot compliance never
    applies because a tool is not a repository with `.agents/` slots.
    """
    records: List[Dict[str, Any]] = []
    for zone in zones:
        root = Path(zone["path"]).expanduser()
        for path in iter_files(root, suffixes={".md"}, max_depth=3, errors=errors):
            if path.is_symlink() or path.name not in {"AGENTS.md", "README.md"}:
                continue
            records.append(
                artifact_record(
                    path,
                    "tool",
                    "capability",
                    "zone",
                    None,
                    None,
                    None,
                    root,
                )
            )
    return records


def extra_skill_roots() -> List[Tuple[str, Path]]:
    """Extra skill hosts from GUSTER_EXTRA_SKILL_ROOTS (name=path, os.pathsep separated).

    Declared hosts are configuration, not guesses: a malformed entry or a missing
    directory stops the run instead of silently dropping the host."""
    roots: List[Tuple[str, Path]] = []
    for item in os.environ.get("GUSTER_EXTRA_SKILL_ROOTS", "").split(os.pathsep):
        item = item.strip()
        if not item:
            continue
        name, sep, raw = item.partition("=")
        if not sep or not name.strip() or not raw.strip():
            raise ValueError(f"GUSTER_EXTRA_SKILL_ROOTS entries must be name=path: {item!r}")
        root = Path(raw.strip()).expanduser()
        if not root.is_dir():
            raise ValueError(
                f"GUSTER_EXTRA_SKILL_ROOTS host {name.strip()!r} directory does not exist: {root}"
            )
        roots.append((name.strip(), root))
    return roots


def scan_skills(home: Path) -> List[Dict[str, Any]]:
    roots = [
        ("agents", home / ".agents" / "skills"),
        ("codex", home / ".codex" / "skills"),
        ("dsh", home / ".dsh" / "skills"),
        ("claude", home / ".claude" / "skills"),
    ] + extra_skill_roots()
    raw: List[Dict[str, Any]] = []
    for host, root in roots:
        if not root.is_dir():
            continue
        for skill_md in sorted(root.glob("*/SKILL.md")):
            text = read_text(skill_md, limit=500_000)
            frontmatter, _ = parse_frontmatter(text)
            name = frontmatter.get("name") or skill_md.parent.name
            description = frontmatter.get("description", "")
            raw.append(
                {
                    "name": name,
                    "root": str(skill_md.parent),
                    "host": host,
                    "description": description,
                    "description_chars": len(description),
                    "hash": sha256_file(skill_md),
                }
            )

    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for item in raw:
        grouped.setdefault(item["name"], []).append(item)

    skills: List[Dict[str, Any]] = []
    for name in sorted(grouped):
        copies = sorted(grouped[name], key=lambda item: item["root"])
        primary = copies[0]
        skills.append(
            {
                "name": name,
                "root": primary["root"],
                "host": primary["host"],
                "description": primary["description"],
                "description_chars": len(primary["description"]),
                "hash": primary["hash"],
                "copies": [
                    {"host": item["host"], "root": item["root"], "hash": item["hash"]}
                    for item in copies
                ],
            }
        )
    return skills


def find_env_files(root: Path, max_depth: int = SECRET_ENV_DEPTH) -> List[Path]:
    """`.env` files under a project, bounded by depth so the scan stays cheap."""
    found: List[Path] = []
    stack: List[Tuple[Path, int]] = [(root, 0)]
    while stack:
        current, depth = stack.pop()
        try:
            entries = list(current.iterdir())
        except OSError:
            continue
        for entry in entries:
            if entry.is_file() and entry.name == ".env":
                found.append(entry)
            elif (
                entry.is_dir()
                and depth < max_depth
                and not entry.name.startswith(".")
                and entry.name not in EXCLUDE_DIRS
                and not entry.is_symlink()
            ):
                stack.append((entry, depth + 1))
    return sorted(found)


def scan_secret_files(
    home: Path,
    hub: Optional[Path],
    projects: Sequence[Dict[str, Any]],
    project_tracked: Dict[str, Optional[Set[str]]],
    zones: Sequence[Dict[str, str]] = (),
    include_home: bool = True,
    errors: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    candidates: List[Path] = []
    if include_home:
        for root in (home / ".agents" / "credentials",):
            if root.is_dir():
                candidates.extend(
                    path
                    for path in iter_files(root, errors=errors)
                    if path.is_file() and path.suffix.lower() != ".md"
                )
    if hub:
        tools_root = resolve_hub_layout(hub).get("tools")
        if tools_root and tools_root.is_dir():
            for path in iter_files(tools_root, max_depth=3, errors=errors):
                if path.name in SECRET_SUFFIX_NAMES or path.name.startswith("credentials.") or path.name.endswith(".local.json"):
                    candidates.append(path)
    for zone in zones:
        candidates.extend(find_env_files(Path(zone["path"]).expanduser()))
    for project in projects:
        candidates.extend(find_env_files(Path(project["path"])))

    seen: Set[str] = set()
    records: List[Dict[str, Any]] = []
    for path in candidates:
        try:
            resolved = str(path.resolve())
        except OSError:
            continue
        if resolved in seen:
            continue
        seen.add(resolved)
        canonical = is_under(path, home / ".agents" / "credentials")
        tracked: Optional[bool] = None
        for project in projects:
            project_root = Path(project["path"])
            if not is_under(path, project_root):
                continue
            tracked_set = project_tracked.get(str(project_root))
            if tracked_set is None:
                tracked = None
            else:
                try:
                    rel = str(path.resolve().relative_to(project_root.resolve()))
                except ValueError:
                    rel = ""
                tracked = rel in tracked_set
            break
        if tracked is None and not any(is_under(path, Path(p["path"])) for p in projects):
            # Outside every scanned repository there is nothing that could track it.
            tracked = False
        try:
            size = path.stat().st_size
        except OSError:
            size = 0
        records.append(
            {
                "path": str(path),
                "canonical": canonical,
                "git_tracked": tracked,
                "size": size,
                "kind": infer_secret_kind(path),
            }
        )
    return records


def scan_credential_registry(home: Path) -> Dict[str, Any]:
    """Read the credential registry table; it never contains secret values."""
    path = home / ".agents" / "credentials" / "registry.md"
    entries: List[Dict[str, str]] = []
    warnings: List[str] = []
    if path.is_file():
        for line_no, line in enumerate(read_text(path, limit=1_000_000).splitlines(), start=1):
            stripped = line.strip()
            if not stripped.startswith("|"):
                continue
            cells = [cell.strip() for cell in stripped.strip("|").split("|")]
            if cells[0] in {"ID", ""} or set(cells[0]) <= {"-", ":"}:
                continue
            if len(cells) < 6:
                # An entry-shaped row that cannot be an entry is a broken row,
                # not silence: ID|scope|site|account|kind|locations are required.
                warnings.append(
                    f"line {line_no}: expected at least 6 columns "
                    f"(ID|scope|site|account|kind|locations), got {len(cells)}: {stripped[:80]}"
                )
                continue
            entries.append(
                {
                    "id": cells[0],
                    "scope": cells[1],
                    "site": cells[2],
                    "account": cells[3],
                    "kind": cells[4],
                    "locations": cells[5],
                    "keys": cells[6] if len(cells) > 6 else "",
                    "used_by": cells[7] if len(cells) > 7 else "",
                    "status": cells[8] if len(cells) > 8 else "",
                }
            )
    return {
        "path": str(path) if path.is_file() else None,
        "entries": entries,
        "parse_warnings": warnings,
    }


def infer_secret_kind(path: Path) -> str:
    name = path.name.lower()
    if name.endswith(".env") or name.endswith(".env.example"):
        return "env"
    if "token" in name or "secret" in name or "credential" in name:
        return "token"
    if name.endswith((".json", ".yaml", ".yml", ".toml")):
        return "config"
    return "file"


def scan_inline_bearers(home: Path) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    for raw in INLINE_CONFIG_FILES:
        path = home / raw[2:] if raw.startswith("~/") else Path(raw)
        if not path.is_file():
            continue
        text = read_text(path, limit=2_000_000)
        values: List[str] = []
        for pattern in INLINE_PATTERNS:
            for match in re.finditer(pattern, text):
                value = match.group(1)
                redacted = f"{value[:4]}...{value[-4:]}"
                if redacted not in values:
                    values.append(redacted)
        if values:
            records.append({"path": str(path), "count": len(values), "redacted": values})
    return records


def find_governance_docs(home: Path, hub: Optional[Path]) -> List[str]:
    # Framework docs, not topic authorities. A doc that labels itself a facet
    # ("分册") belongs to the primary framework and does not compete with it.
    named = {
        "agent-context-map.md",
        "codex-context-stack.md",
        "context-engineering-principles.md",
        "knowledge-taxonomy.md",
        "project-agents-layout.md",
    }
    candidates: List[Path] = []
    if hub:
        general = resolve_hub_layout(hub)["knowledge"] / "general"
        if general.is_dir():
            candidates.extend(path for path in general.iterdir() if path.name in named)
    candidates.extend(
        path
        for path in (home / ".agents" / "wiki").glob("*.md")
        if path.name in named
    )
    primary = []
    for path in candidates:
        header = "\n".join(read_text(path, limit=4000).splitlines()[:5])
        if "分册" not in header:
            primary.append(str(path))
    return sorted(primary)


def scan_plugin_manifests(plugin_root: Optional[Path]) -> Dict[str, Any]:
    if plugin_root is None:
        return {}
    manifests: Dict[str, Any] = {}
    for label, rel in (
        ("codex", ".codex-plugin/plugin.json"),
        ("zcode", ".zcode-plugin/plugin.json"),
        ("package", "package.json"),
    ):
        path = plugin_root / rel
        data = load_json(path, {})
        manifests[label] = {
            "path": str(path),
            "exists": path.is_file(),
            "version": data.get("version") if isinstance(data, dict) else None,
            "name": data.get("name") if isinstance(data, dict) else None,
        }
    return manifests


PROJECT_CARD_NAMES = {"_registry.md", "readme.md", "agents.md"}


def count_project_cards(hub: Optional[Path], errors: Optional[List[str]] = None) -> int:
    """Project cards known to the hub, not the project roots a run scanned."""
    if not hub:
        return 0
    root = resolve_hub_layout(hub)["projects"]
    if not root.is_dir():
        return 0
    return sum(
        1
        for path in iter_files(root, suffixes={".md"}, max_depth=1, errors=errors)
        if path.parent == root and path.name.lower() not in PROJECT_CARD_NAMES
    )


def summarize(
    projects: Sequence[Dict[str, Any]],
    skills: Sequence[Dict[str, Any]],
    artifacts: Sequence[Dict[str, Any]],
    secret_files: Sequence[Dict[str, Any]],
    inline_bearers: Sequence[Dict[str, Any]],
    project_cards: int = 0,
) -> Dict[str, Any]:
    return {
        "projects": len(projects),
        "containers": sum(1 for project in projects if project.get("container")),
        "project_cards": project_cards,
        "agents_dirs": sum(1 for project in projects if project.get("agents_dir")),
        "agents_with_index": sum(1 for project in projects if project.get("has_index")),
        "git_errors": sum(1 for project in projects if project.get("git_state") == "error"),
        "skills": len(skills),
        "skill_copies": sum(len(skill.get("copies", [])) for skill in skills),
        "artifacts": len(artifacts),
        "knowledge": sum(1 for item in artifacts if item.get("kind") == "knowledge"),
        "state": sum(1 for item in artifacts if item.get("kind") == "state"),
        "evidence": sum(1 for item in artifacts if item.get("kind") == "evidence"),
        "secret_files": len(secret_files),
        "secret_outside_root": sum(1 for item in secret_files if not item.get("canonical")),
        "secret_in_git": sum(1 for item in secret_files if item.get("git_tracked")),
        "inline_bearer_files": len(inline_bearers),
        "inline_bearers": sum(item.get("count", 0) for item in inline_bearers),
    }
