from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from .config import LAYOUTS, STACKS, ProjectConfig

MISSING_CHECKS = "no checks configured — declare checks.build/checks.test"

# A retro is short-term progress, so every real layout keeps it next to the
# progress notes instead of at the wiki root.
LAYOUT_RETRO = "wiki/progress/retro.md"

AGENT_SLOTS = ("plans", "evidence", "archive", "skills", "tmp", "wiki")


@dataclass(frozen=True)
class LayoutSpec:
    creates: str
    node_entry: str | None
    python_roots: tuple[str, ...] = ()
    shell_checks: tuple[str, ...] = ()
    # Layout whose stack templates this one renders. `service` and `webapp`
    # ship the same app skeleton; keeping two byte-identical copies meant a fix
    # to one silently left the other stale, so `service` reads `webapp`'s.
    stack_templates: str | None = None


# The layout vocabulary was sampled from three unrelated production projects in
# different stacks; each already used the same nine layers.
LAYOUT_SPECS: dict[str, LayoutSpec] = {
    "none": LayoutSpec(
        creates="base template only (default); no layout contract",
        node_entry=None,
    ),
    "webapp": LayoutSpec(
        creates=(
            "server/ src/ (python) web/ e2e/ tests/ scripts/ deploy/ + openspec/ spec/ "
            "wiki/{knowledge,progress,runbook}/ .agents/"
        ),
        node_entry="server/index.js",
        python_roots=("src", "server"),
    ),
    "service": LayoutSpec(
        stack_templates="webapp",
        creates=(
            "server/ src/ (python) tests/ scripts/ deploy/ + openspec/ spec/ "
            "wiki/{knowledge,progress,runbook}/ .agents/"
        ),
        node_entry="server/index.js",
        python_roots=("src", "server"),
    ),
    "plugin": LayoutSpec(
        creates=(
            "bin/<project> src/<project>/ skills/<project>/ docs/ tests/ scripts/ + "
            "openspec/ spec/ wiki/{knowledge,progress,runbook}/ .agents/"
        ),
        node_entry="src/index.js",
        python_roots=("src",),
        # The plugin ships a bash wrapper under bin/, so the build also
        # syntax-checks it instead of trusting a file no compiler reads.
        shell_checks=("bash -n bin/{bin}",),
    ),
}

# One table for every stack's real commands. `{roots}` is filled from the
# layout's python source directories, `{shell}` from its shell checks and
# `{entry}` from its node entry. `-f` is deliberate: without it compileall
# skips a file whose mtime moved within the same second, which made a broken
# entry point pass right after a green check.
STACK_CHECKS: dict[str, tuple[str, str]] = {
    "python": (
        "python3 -m compileall -f -q {roots}{shell}",
        "python3 -m unittest discover -s tests -v",
    ),
    "node": ("node --check {entry}{shell}", "npm test"),
    "none": ("", ""),
}

# The spec truth layer: one living index, one behaviour file per domain, one
# test matrix and one constitution. Each path is named individually in the gate.
SPEC_TRUTH_FILES = (
    "spec/INDEX.md",
    "spec/TESTING.md",
    "spec/CONSTITUTION.md",
)
CONTRACT_FILES = ("AGENTS.md", "openspec/config.yaml", *SPEC_TRUTH_FILES)
CONTRACT_DIRS = (
    "spec",
    "spec/domains",
    "wiki/knowledge",
    "wiki/progress",
    "wiki/runbook",
    *(f".agents/{slot}" for slot in AGENT_SLOTS),
)
CONTRACT_IGNORES = ("out", ".agents")


def package_name(name: str) -> str:
    cleaned = re.sub(r"[^0-9A-Za-z_]", "_", name).strip("_").lower()
    if not cleaned:
        cleaned = "app"
    return f"_{cleaned}" if cleaned[0].isdigit() else cleaned


def npm_name(name: str) -> str:
    cleaned = re.sub(r"[^a-z0-9._~-]+", "-", name.lower()).strip("-")
    if not cleaned:
        cleaned = "app"
    return f"app{cleaned}" if cleaned[0] in "._" else cleaned


def checks_for(layout: str, stack: str, name: str = "") -> tuple[str, str]:
    if layout not in LAYOUT_SPECS:
        raise ValueError(f"unknown layout: {layout}")
    if stack not in STACK_CHECKS:
        raise ValueError(f"unknown stack: {stack}")
    if stack == "none":
        return ("", "")
    spec = LAYOUT_SPECS[layout]
    build, test = STACK_CHECKS[stack]
    shell = ""
    if spec.shell_checks:
        if not name:
            raise ValueError(f"layout {layout} shell checks need the project name")
        shell = "".join(
            f" && {command.format(bin=npm_name(name))}"
            for command in spec.shell_checks
        )
    if stack == "python":
        if not spec.python_roots:
            raise ValueError(f"layout {layout} has no python sources")
        build = build.format(roots=" ".join(spec.python_roots), shell=shell)
    else:
        entry = spec.node_entry
        if entry is None:
            raise ValueError(f"layout {layout} has no node entry")
        build = build.format(entry=entry, shell=shell)
    return (build, test)


def layout_listing() -> str:
    lines = ["layouts (galadon init --layout):"]
    for name in LAYOUTS:
        lines.append(f"  {name:<8} {LAYOUT_SPECS[name].creates}")
    lines.extend(["", "stacks (galadon init --stack):"])
    for stack in STACKS:
        build, test = STACK_CHECKS[stack]
        if stack == "none":
            lines.append(
                f'  none     no checks: galadon check fails with "{MISSING_CHECKS}" '
                "once the spec is complete"
            )
            continue
        display = (
            build.replace("{roots}", "<layout sources>")
            .replace("{entry}", "<entry>")
            .replace("{shell}", "")
        )
        note = " (package.json scripts.test = node --test tests/)" if stack == "node" else ""
        lines.append(f"  {stack:<8} build: {display} | test: {test}{note}")
    for name in LAYOUTS:
        for command in LAYOUT_SPECS[name].shell_checks:
            lines.append("")
            lines.append(
                f"{name} appends to the build command: && {command.format(bin='<project>')}"
            )
    return "\n".join(lines)


def _gitignore_entries(root: Path) -> set[str]:
    path = root / ".gitignore"
    if not path.is_file():
        return set()
    entries = set()
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        entries.add(line.lstrip("/").rstrip("/"))
    return entries


def layout_contract_problems(root: Path, config: ProjectConfig) -> list[str]:
    problems: list[str] = []
    for name in CONTRACT_FILES:
        if not (root / name).is_file():
            problems.append(name)
    for name in CONTRACT_DIRS:
        if not (root / name).is_dir():
            problems.append(f"{name}/")
    if not config.checks.build.strip() or not config.checks.test.strip():
        problems.append(MISSING_CHECKS)
    ignored = _gitignore_entries(root)
    for name in CONTRACT_IGNORES:
        if name not in ignored:
            problems.append(f".gitignore must ignore {name}/")
    return problems
