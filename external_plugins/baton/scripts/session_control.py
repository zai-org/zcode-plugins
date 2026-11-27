#!/usr/bin/env python3
"""CLI adapter for the deterministic SessionController.

Every verb prints one JSON object. Success is ``{"ok": true, "command": "<verb>",
...}`` with snake_case keys; a domain failure is ``{"ok": false, "command",
"code", "error", ...}``. ``code`` is the stable machine-readable cause and
whatever a model must act on is a field of its own — never JSON inside a
string.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from orchestration.plan_store import PlanStoreError  # noqa: E402
from orchestration.session_controller import (  # noqa: E402
    SessionController,
    SessionControllerError,
)
from orchestration.store_base import BASE_BRANCH_SETTING  # noqa: E402
from orchestration.worktree import (  # noqa: E402
    WorktreeError,
    cleanup_feature_worktrees,
)

# Domain failures the CLI renders as one JSON error object; anything else
# (TypeError, bugs) keeps its full traceback — fail loud, just not ugly.
DOMAIN_ERRORS = (PlanStoreError, SessionControllerError, WorktreeError)

VERBS = ("actions", "bind", "reconcile", "status", "cleanup", "abandon", "adopt", "reopen")


def _controller(args: argparse.Namespace) -> SessionController:
    return SessionController(
        args.project,
        args.feature,
        verification_commands=args.verify,
    )


def _session_id(value: str) -> str:
    """argparse type: a session id identifies one run's claims — never empty."""
    if not value.strip():
        raise argparse.ArgumentTypeError("session id must be a non-empty string")
    return value


def _capacity(value: str) -> int:
    """argparse type: 1..5 parallel assignments (the documented hard cap)."""
    try:
        capacity = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"capacity must be an integer, got {value!r}"
        ) from None
    if not 1 <= capacity <= 5:
        raise argparse.ArgumentTypeError(
            f"capacity must be between 1 and 5, got {capacity} "
            "(baton runs at most 5 parallel assignments)"
        )
    return capacity


def _non_empty(value: str) -> str:
    """argparse type: an agent id names the child that was just spawned."""
    if not value.strip():
        raise argparse.ArgumentTypeError("agent id must be a non-empty string")
    return value


def _ticket_id(value: str) -> str:
    """argparse type: a ticket is named the way tasks.md names it."""
    parts = value.split(".")
    if len(parts) != 2 or not all(part.isdigit() for part in parts):
        raise argparse.ArgumentTypeError(
            f"ticket id must look like N.M (e.g. 2.1), got {value!r}"
        )
    return value


def _print(value: object) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True))


def _envelope(value: object, command: str) -> dict[str, object]:
    if hasattr(value, "to_dict"):
        value = value.to_dict()
    payload = value if isinstance(value, dict) else {}
    return {"ok": True, "command": command, **payload}


def build_parser() -> argparse.ArgumentParser:
    """The CLI surface — also the contract the docs are checked against."""
    parser = argparse.ArgumentParser(description="Baton session control")
    parser.add_argument("project")
    parser.add_argument("feature")
    parser.add_argument(
        "--verify",
        action="append",
        help="verification command; the first claim persists it for the run "
        "(repeatable). Passing it again overrides the stored commands for new "
        "packets. Required until a run has commands configured.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    actions = sub.add_parser("actions")
    actions.add_argument("--session-id", required=True, type=_session_id)
    actions.add_argument(
        "--capacity",
        type=_capacity,
        help="parallel assignments, 1-5 (default: what the run stored, else 1); "
        "an explicit value is stored with the run",
    )
    actions.add_argument(
        "--base-branch",
        help="branch the integration branch starts from (default: what the run "
        "stored, else main); an explicit value is stored with the run",
    )

    bind = sub.add_parser("bind")
    bind.add_argument("assignment_id")
    bind.add_argument("claim_token")
    bind.add_argument("agent_id", type=_non_empty)

    reconcile = sub.add_parser("reconcile")
    reconcile.add_argument("assignment_id")
    reconcile.add_argument("claim_token")
    reconcile.add_argument(
        "--agent-terminal",
        required=True,
        choices=["completed", "failed", "canceled"],
    )
    reconcile.add_argument("--session-id", required=True, type=_session_id)
    reconcile.add_argument("--capacity", type=_capacity)
    reconcile.add_argument("--base-branch")
    reconcile.add_argument(
        "--reason",
        default="",
        help="one line on why the subagent ended without a sealed receipt; "
        "recorded for diagnosis only (never decides success)",
    )

    sub.add_parser(
        "status",
        help="read-only progress snapshot",
    )

    cleanup = sub.add_parser(
        "cleanup",
        help="remove a finished run's worktrees and the branches that provably "
        "merged (assignment branches baton/<feature>-tic-*); never touches the "
        "main working tree, never force-removes dirty worktrees, never deletes "
        "an unmerged branch",
    )
    cleanup.add_argument(
        "--include-integration",
        action="store_true",
        help="also remove the baton/<feature> integration worktree, and delete "
        "that branch once it is merged into the base branch",
    )
    cleanup.add_argument(
        "--dry-run",
        action="store_true",
        help="preview: list the worktrees and branches cleanup would remove, "
        "remove nothing",
    )

    abandon = sub.add_parser(
        "abandon",
        help="operator escape hatch: retire a stuck attempt (releases its lease, "
        "ignores future receipts unless adopted); it does NOT delete the "
        "worktree, branch, commits, packet or receipt; refused while the attempt "
        "is plausibly still working (active + no failure evidence + most of its "
        "lease left) unless --force",
    )
    abandon.add_argument("assignment_id")
    abandon.add_argument(
        "--reason",
        default="operator-abandoned",
        help="recorded in the attempt's failure_code / event log",
    )
    abandon.add_argument(
        "--force",
        action="store_true",
        help="bypass the live-attempt guard after reading its refusal data",
    )

    adopt = sub.add_parser(
        "adopt",
        help="revive an abandoned or superseded attempt whose sealed receipt "
        "arrived late: re-verify the receipt and integrate it; refuses when a "
        "newer attempt for the same ticket already sealed or is still in flight",
    )
    adopt.add_argument("assignment_id")

    reopen = sub.add_parser(
        "reopen",
        help="re-run a finished ticket: void its succeeded receipts so the next "
        "actions call claims it again (also restarts a spent retry budget); "
        "refused while an attempt for the ticket is still active",
    )
    reopen.add_argument("ticket", metavar="N.M", type=_ticket_id)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        controller = _controller(args)
        if args.command == "cleanup":
            result = cleanup_feature_worktrees(
                args.project,
                args.feature,
                include_integration=args.include_integration,
                dry_run=args.dry_run,
                base_branch=controller.store.peek_run_setting(BASE_BRANCH_SETTING)
                or "main",
                ran_before=controller.store.has_run_history(),
            )
        elif args.command == "actions":
            result = controller.actions(args.session_id, args.capacity, args.base_branch)
        elif args.command == "bind":
            result = controller.bind_agent(
                args.assignment_id, args.claim_token, args.agent_id
            )
        elif args.command == "status":
            result = controller.status()
        elif args.command == "abandon":
            result = controller.abandon(
                args.assignment_id, reason=args.reason, force=args.force
            )
        elif args.command == "adopt":
            result = controller.adopt(args.assignment_id)
        elif args.command == "reopen":
            result = controller.reopen(args.ticket)
        else:
            result = controller.reconcile(
                args.assignment_id,
                args.claim_token,
                agent_terminal=args.agent_terminal,
                session_id=args.session_id,
                capacity=args.capacity,
                base_branch=args.base_branch,
                reason=args.reason,
            )
        _print(_envelope(result, args.command))
        return 0
    except DOMAIN_ERRORS as exc:
        _print(
            {
                "ok": False,
                "command": args.command,
                "code": getattr(exc, "code", type(exc).__name__),
                "error": f"{type(exc).__name__}: {exc}",
                **getattr(exc, "details", {}),
            }
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
