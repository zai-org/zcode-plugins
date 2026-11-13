#!/usr/bin/env python3
"""CLI adapter for the deterministic SessionController."""

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
from orchestration.worktree import (  # noqa: E402
    WorktreeError,
    cleanup_feature_worktrees,
)

# Domain failures the CLI renders as one JSON error line; anything else
# (TypeError, bugs) keeps its full traceback — fail loud, just not ugly.
DOMAIN_ERRORS = (PlanStoreError, SessionControllerError, WorktreeError)


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


def _print(value: object) -> None:
    if hasattr(value, "to_dict"):
        value = value.to_dict()
    print(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True))


def _ok(value: object) -> dict[str, object]:
    if hasattr(value, "to_dict"):
        value = value.to_dict()
    return {"ok": True, **value} if isinstance(value, dict) else {"ok": True}


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
    actions.add_argument("--capacity", type=_capacity, default=1)
    actions.add_argument("--base-branch", default="main")

    bind = sub.add_parser("bind")
    bind.add_argument("assignment_id")
    bind.add_argument("claim_token")
    bind.add_argument("agent_id")

    reconcile = sub.add_parser("reconcile")
    reconcile.add_argument("assignment_id")
    reconcile.add_argument("claim_token")
    reconcile.add_argument(
        "--agent-terminal",
        required=True,
        choices=["completed", "failed", "canceled"],
    )
    reconcile.add_argument("--session-id", required=True, type=_session_id)
    reconcile.add_argument("--capacity", type=_capacity, default=1)
    reconcile.add_argument("--base-branch", default="main")

    sub.add_parser(
        "status",
        help="read-only progress snapshot",
    )

    cleanup = sub.add_parser(
        "cleanup",
        help="remove a finished run's worktrees (assignment branches "
        "baton/<feature>-tic-*); never touches the main working tree, "
        "never force-removes dirty worktrees",
    )
    cleanup.add_argument(
        "--include-integration",
        action="store_true",
        help="also remove the baton/<feature> integration worktree (only after merging to main)",
    )
    cleanup.add_argument(
        "--dry-run",
        action="store_true",
        help="preview: list the worktrees cleanup would remove, remove nothing",
    )

    abandon = sub.add_parser(
        "abandon",
        help="operator escape hatch: retire a stuck attempt (releases its lease, "
        "ignores future receipts); it does NOT delete the worktree, branch, "
        "commits, packet or receipt; refused while the attempt is plausibly "
        "still working (active + no failure evidence + most of its lease left) "
        "unless --force",
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
        help="revive an abandoned attempt whose sealed receipt arrived late: "
        "re-verify the receipt and integrate it; refuses when a newer attempt "
        "for the same ticket already sealed or is still in flight",
    )
    adopt.add_argument("assignment_id")

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "cleanup":
            _print(
                cleanup_feature_worktrees(
                    args.project,
                    args.feature,
                    include_integration=args.include_integration,
                    dry_run=args.dry_run,
                )
            )
            return 0
        controller = _controller(args)
        if args.command == "actions":
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
        else:
            result = controller.reconcile(
                args.assignment_id,
                args.claim_token,
                agent_terminal=args.agent_terminal,
                session_id=args.session_id,
                capacity=args.capacity,
                base_branch=args.base_branch,
            )
        _print(_ok(result))
        return 0
    except DOMAIN_ERRORS as exc:
        _print({"error": f"{type(exc).__name__}: {exc}", "command": args.command})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
