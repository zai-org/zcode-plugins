from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from .config import ProjectConfig
from .extensions import role_policy_for
from .util import (
    GitContext,
    GitError,
    git_changed_paths,
    git_context,
    git_dirty_entries,
    read_json,
    sha256_file,
)

CHECKS_PATH = Path(".galadon/checks.json")

ACTIONS = {
    "build": "Implement the spec, then run `galadon check`.",
    "verify": "Fix the failed checks, then run `galadon check` again.",
    "ship": "Run `galadon ship --env <env>` after checking `--dry-run`.",
    "done": "Loop complete. Update the spec for the next loop, then run `galadon new`.",
}

STALE_CHECK = "The project changed after the last green check; run `galadon check` again."

_DELETED = "<deleted>"
_UNHASHED = "<unhashed>"


def _text(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.is_file() else ""


def actions_for(config: ProjectConfig) -> dict[str, str]:
    return {
        "spec": (
            f"Write {config.paths.spec}: problem, acceptance criteria and non-goals."
        ),
        **ACTIONS,
        "learn": f"Write {config.paths.retro}, then run `galadon check`.",
    }


def spec_ok(root: Path, config: ProjectConfig) -> tuple[bool, str]:
    relative = config.paths.spec
    text = _text(root / relative)
    if not text:
        return False, f"{relative} is missing"
    if "TODO" in text:
        return False, f"{relative} still contains TODO"
    for heading in ("## Problem", "## Acceptance", "## Non-goals"):
        if heading not in text:
            return False, f"{relative} is missing {heading}"
    if not re.search(r"^- \[[ xX]\] ", text, flags=re.MULTILINE):
        return False, f"{relative} needs at least one acceptance checkbox"
    return True, "spec is complete"


def unchecked_acceptance(root: Path, config: ProjectConfig) -> int:
    """Acceptance criteria in the spec that nobody has ticked yet.

    Only the `## Acceptance` section counts: a task list elsewhere in the spec
    is not a claim about this release. Shipping requires every criterion to be
    ticked, so an untouched scaffold cannot ride its placeholder spec to prod.
    """
    text = _text(root / config.paths.spec)
    match = re.search(
        r"^## Acceptance\b[^\n]*(?P<body>.*?)(?=^## |\Z)", text, flags=re.MULTILINE | re.DOTALL
    )
    if match is None:
        return 0
    return len(re.findall(r"^\s*- \[ \] ", match.group("body"), flags=re.MULTILINE))


def retro_ok(root: Path, config: ProjectConfig) -> tuple[bool, str]:
    relative = config.paths.retro
    text = _text(root / relative)
    if not text:
        return False, f"{relative} is missing"
    if "TODO" in text:
        return False, f"{relative} still contains TODO"
    for heading in ("## What changed", "## Next"):
        if heading not in text:
            return False, f"{relative} is missing {heading}"
    return True, "retro is complete"


def _loop_owned(path: str, config: ProjectConfig) -> bool:
    """Files `check`/`ship` rewrite themselves: the evidence, the release
    record, the state directory and the phase block in `AGENTS.md`."""
    return (
        path in {config.paths.evidence.as_posix(), config.paths.release.as_posix(), "AGENTS.md"}
        or path.startswith(".galadon/")
    )


def uncommitted_paths(
    root: Path, config: ProjectConfig, context: GitContext | None = None
) -> list[str]:
    """Changes that would ship under a commit they are not part of, untracked
    files included. Raises GitError when git cannot answer; it used to read as
    a clean tree and switch the guard off."""
    context = context or git_context(root)
    return sorted(
        path
        for _, path in git_dirty_entries(root, context)
        if not _loop_owned(path, config)
    )


def _content_marker(root: Path, path: str) -> str:
    target = root / path
    try:
        if target.is_symlink():
            return f"link:{os.readlink(target)}"
        if not target.exists():
            return _DELETED
        if target.is_file():
            return sha256_file(target)
    except OSError:
        pass
    return _UNHASHED


def _dirty_fingerprint(root: Path, config: ProjectConfig, context: GitContext) -> dict[str, str]:
    return {
        path: _content_marker(root, path)
        for _, path in git_dirty_entries(root, context)
        if not _loop_owned(path, config)
    }


def verification_binding(root: Path, config: ProjectConfig) -> dict[str, Any] | None:
    """What a green check was run against: the commit plus a content hash of
    every uncommitted file. None when nothing versions the project, so there
    is nothing to compare a later run against."""
    try:
        context = git_context(root)
    except (GitError, OSError):
        return None
    if not context.versioned:
        return None
    return {"head": context.commit, "dirty": _dirty_fingerprint(root, config, context)}


def verification_stale(root: Path, config: ProjectConfig, checks: Any) -> bool:
    """True when the project no longer matches what the green check verified."""
    binding = checks.get("binding") if isinstance(checks, dict) else None
    if not isinstance(binding, dict) or not binding.get("head"):
        # Never bound: a project without git, or a record from before bindings.
        return False
    try:
        context = git_context(root)
        if not context.versioned:
            return True
        if context.commit == binding["head"]:
            return _dirty_fingerprint(root, config, context) != binding.get("dirty")
        # The commit moved since the check. That is still current when the only
        # change is committing exactly the files the check saw, unchanged.
        changed = git_changed_paths(root, context, binding["head"], context.commit)
        if changed is None:
            return True
    except (GitError, OSError):
        return True
    recorded = binding.get("dirty") if isinstance(binding.get("dirty"), dict) else {}
    if any(recorded.get(path) != marker for path, marker in _dirty_fingerprint(root, config, context).items()):
        return True
    return any(
        recorded.get(path) != _content_marker(root, path)
        for path in changed
        if not _loop_owned(path, config)
    )


def _green_but_stale(root: Path, config: ProjectConfig, checks: Any) -> bool:
    return isinstance(checks, dict) and checks.get("ok") is True and verification_stale(root, config, checks)


def infer_phase(root: Path, config: ProjectConfig) -> str:
    if not spec_ok(root, config)[0]:
        return "spec"
    checks = read_json(root / CHECKS_PATH, None)
    if checks is None:
        return "build"
    if not isinstance(checks, dict) or checks.get("ok") is not True:
        return "verify"
    release = read_json(root / config.paths.release, None)
    if not isinstance(release, dict) or release.get("ok") is not True:
        return "verify" if _green_but_stale(root, config, checks) else "ship"
    if not retro_ok(root, config)[0]:
        return "learn"
    return "done"


def role_hint(phase: str, root: Path, config: ProjectConfig) -> str:
    return " + ".join(role_policy_for(config, root).assign(phase))


def next_payload(root: Path, config: ProjectConfig) -> dict[str, Any]:
    phase = infer_phase(root, config)
    action = actions_for(config)[phase]
    if phase == "ship":
        unchecked = unchecked_acceptance(root, config)
        if unchecked:
            action = (
                f"{unchecked} acceptance criteria in {config.paths.spec} are still unchecked: "
                "tick each one once it is verified, then run `galadon ship --env <env>` "
                "after checking `--dry-run`."
            )
    elif phase == "verify" and _green_but_stale(root, config, read_json(root / CHECKS_PATH, None)):
        action = STALE_CHECK
    return {
        "project": config.name,
        "phase": phase,
        "role": role_hint(phase, root, config),
        "next": action,
    }


def update_agents_block(root: Path, payload: dict[str, Any]) -> None:
    path = root / "AGENTS.md"
    if not path.is_file():
        return
    text = path.read_text(encoding="utf-8")
    block = (
        "<!-- galadon:begin -->\n"
        f"- phase: {payload['phase']}\n"
        f"- role: {payload['role']}\n"
        f"- next: {payload['next']}\n"
        "<!-- galadon:end -->"
    )
    pattern = re.compile(r"<!-- galadon:begin -->.*?<!-- galadon:end -->", re.DOTALL)
    if pattern.search(text):
        updated = pattern.sub(lambda _: block, text)
    else:
        updated = text.rstrip() + "\n\n" + block + "\n"
    if updated != text:
        path.write_text(updated, encoding="utf-8")


def dump_payload(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2)
