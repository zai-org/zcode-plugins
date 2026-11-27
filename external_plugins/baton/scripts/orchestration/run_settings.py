"""Run-wide settings and how the integration branch relates to its base.

Mixed into :class:`orchestration.session_controller.SessionController`, which
provides ``store``, ``feature`` and ``verification_commands``. This module
never imports the controller, so the dependency stays one-way.
"""

from __future__ import annotations

from typing import Any

from orchestration.session_model import SessionControllerError
from orchestration.store_base import (
    BASE_BRANCH_SETTING,
    CAPACITY_SETTING,
    VERIFICATION_COMMANDS_SETTING,
)

DEFAULT_CAPACITY = 1
DEFAULT_BASE_BRANCH = "main"


class RunSettingsMixin:
    """What a run remembers between calls, so flags need saying once."""

    def _run_settings(
        self, capacity: int | None, base_branch: str | None
    ) -> dict[str, Any]:
        """Resolve the run-wide settings.

        A passed flag is an explicit (re)declaration and is persisted; an
        omitted one reuses what the run stored; nothing stored falls back to
        the default. A ``reconcile`` that forgets ``--capacity`` therefore
        keeps a parallel run parallel instead of quietly narrowing it.
        """
        stored = self.store.run_settings(
            [CAPACITY_SETTING, BASE_BRANCH_SETTING, VERIFICATION_COMMANDS_SETTING]
        )
        resolved = dict(stored)
        for key, value, default, validate in (
            (CAPACITY_SETTING, capacity, DEFAULT_CAPACITY, _valid_capacity),
            (BASE_BRANCH_SETTING, base_branch, DEFAULT_BASE_BRANCH, _valid_base_branch),
        ):
            if value is not None:
                chosen = value
            elif stored.get(key) is not None:
                chosen = stored[key]
            else:
                chosen = default
            validate(chosen)
            if chosen != stored.get(key):
                self.store.set_run_setting(key, chosen)
            resolved[key] = chosen
        return resolved

    def _verification_commands(self, settings: dict[str, Any]) -> list[str]:
        """Resolve the run-wide commands, persist an explicit override, fail loud."""
        stored = settings.get(VERIFICATION_COMMANDS_SETTING) or []
        if self.verification_commands:
            commands = list(self.verification_commands)
            if stored != commands:
                self.store.set_run_setting(VERIFICATION_COMMANDS_SETTING, commands)
            return commands
        if stored:
            return [str(command) for command in stored]
        if self.store.latest_completion()["complete"]:
            return []
        raise SessionControllerError(
            f"no verification commands configured for run {self.feature!r}; "
            'pass --verify "<command>" on actions (or reconcile) — it is persisted '
            "for every packet in the run",
            code="verification-unconfigured",
        )

    def _stored_commands(self) -> list[str]:
        return self.store.run_verification_commands()


def _valid_capacity(value: Any) -> None:
    if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= 5:
        raise ValueError("capacity must be between 1 and 5")


def _valid_base_branch(value: Any) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("base_branch must be a non-empty branch name")


def _sync_warnings(sync: dict[str, Any], branch: str) -> list[dict[str, Any]]:
    base = sync.get("base_branch", "")
    if not sync.get("base_found", True):
        return [
            {
                "code": "base-branch-missing",
                "base_branch": base,
                "message": (
                    f"base branch {base} does not exist; the integration branch "
                    f"{branch} is used as-is"
                ),
            }
        ]
    if sync.get("note"):
        return [
            {
                "code": "integration-sync-failed",
                "base_branch": base,
                "message": (
                    f"{branch} holds nothing unmerged but could not be fast-forwarded "
                    f"to {base} ({sync['note']}); new assignments build on the stale "
                    "tip. Clean the integration worktree and call actions again."
                ),
            }
        ]
    if sync.get("fast_forwarded"):
        return [
            {
                "code": "integration-fast-forwarded",
                "message": (
                    f"{branch} held nothing unmerged and was fast-forwarded to {base}"
                ),
            }
        ]
    behind = int(sync.get("behind") or 0)
    if behind:
        return [
            {
                "code": "integration-behind-base",
                "base_branch": base,
                "behind": behind,
                "message": (
                    f"{branch} holds unmerged work and is {behind} commit(s) behind "
                    f"{base}; assignments build on the integration branch, so merge "
                    f"{base} into it yourself if those commits matter here"
                ),
            }
        ]
    return []


__all__ = ["RunSettingsMixin", "_sync_warnings"]
