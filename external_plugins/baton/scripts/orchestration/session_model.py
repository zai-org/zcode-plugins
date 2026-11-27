"""Host-neutral contracts for session-driven Baton execution."""

from __future__ import annotations

import dataclasses
from dataclasses import asdict, dataclass, field
from typing import Any, ClassVar

from orchestration.plan_model import stable_hash, utc_now
from orchestration.model import TaskPacket


@dataclass
class ExecutionAttempt:
    """One durable attempt to execute a ticket with a native subagent."""

    assignment_id: str
    run_id: str
    ticket_num: int
    attempt: int
    state: str
    session_id: str
    plan_revision: int
    task_packet_hash: str
    claim_token: str
    lease_expires_at: str
    base_branch: str
    base_sha: str
    worktree_path: str = ""
    worktree_branch: str = ""
    integration_path: str = ""
    integration_branch: str = ""
    packet_path: str = ""
    receipt_path: str = ""
    agent_id: str = ""
    commit_sha: str = ""
    integration_sha: str = ""
    failure_code: str = ""
    created_at: str = field(default_factory=utc_now)
    updated_at: str = field(default_factory=utc_now)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ExecutionAttempt":
        values: dict[str, Any] = {}
        for name, spec in cls.__dataclass_fields__.items():
            if name in data:
                values[name] = data[name]
            elif spec.default is not dataclasses.MISSING:
                values[name] = spec.default
            elif spec.default_factory is not dataclasses.MISSING:
                values[name] = spec.default_factory()
            else:
                raise KeyError(f"execution attempt row is missing {name}")
        return cls(**values)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class SessionControllerError(RuntimeError):
    """A session action cannot be produced from the durable state.

    ``code`` is the stable CLI error code; extra keyword arguments are
    reported next to the message as data, never serialized into it.
    """

    code = "controller"

    def __init__(
        self, message: str = "", *, code: str | None = None, **details: Any
    ) -> None:
        super().__init__(message)
        if code is not None:
            self.code = code
        self.details = details


def display_ticket(ticket_num: int) -> str:
    """``101`` -> ``1.1``: the id tasks.md uses."""
    return f"{ticket_num // 100}.{ticket_num % 100}"


@dataclass
class BaseAction:
    kind: ClassVar[str] = "base"

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["kind"] = self.kind
        return data


@dataclass
class DispatchAction(BaseAction):
    kind: ClassVar[str] = "dispatch"
    assignment_id: str
    ticket_num: int
    task_name: str
    cwd: str
    prompt: str
    claim_token: str
    packet_path: str
    task_packet_hash: str
    ticket_title: str = ""


@dataclass
class ResolveMergeAction(BaseAction):
    kind: ClassVar[str] = "resolve_merge"
    assignment_id: str
    ticket_num: int
    cwd: str
    prompt: str
    claim_token: str


@dataclass
class RepairIntegrationAction(BaseAction):
    """The merged tree failed the run's verification: fix it where it landed.

    Handled exactly like ``resolve_merge`` (a subagent works from ``prompt``
    in ``cwd``, then the main session reconciles again).
    """

    kind: ClassVar[str] = "repair_integration"
    assignment_id: str
    ticket_num: int
    cwd: str
    prompt: str
    claim_token: str


@dataclass
class RecoverAction(BaseAction):
    kind: ClassVar[str] = "recover"
    assignment_id: str
    ticket_num: int
    reason: str
    detail: str = ""
    agent_id: str = ""
    worktree_path: str = ""
    attempt: int = 0
    attempts_used: int = 0
    attempts_max: int = 0
    next: list[str] = field(default_factory=list)


@dataclass
class WaitAction(BaseAction):
    kind: ClassVar[str] = "wait"
    reason: str
    active_assignments: list[str] = field(default_factory=list)


@dataclass
class BlockedAction(BaseAction):
    """Something needs an operator decision before the run can advance.

    ``agent_id`` is set when a subagent is still working on what the block
    made obsolete (a redefined ticket): stop it before retiring the attempt.
    """

    kind: ClassVar[str] = "blocked"
    code: str
    reason: str
    ticket_num: int = 0
    assignment_id: str = ""
    agent_id: str = ""


@dataclass
class CompleteAction(BaseAction):
    kind: ClassVar[str] = "complete"
    revision: int
    resolved_tickets: list[int] = field(default_factory=list)
    worktrees_removed: list[dict] = field(default_factory=list)
    worktrees_skipped: list[dict] = field(default_factory=list)
    branches_deleted: list[dict] = field(default_factory=list)
    branches_kept: list[dict] = field(default_factory=list)
    write_back: dict[str, Any] = field(default_factory=dict)


@dataclass
class ActionBatch:
    run_id: str
    generation: int
    state: str
    actions: list[BaseAction] = field(default_factory=list)
    created_at: str = field(default_factory=utc_now)
    #: Loud, non-blocking notices the forwarder relays to the user (a retry
    #: it should stop the old agent for, a ticket baton refuses to re-run, …).
    warnings: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "generation": self.generation,
            "state": self.state,
            "actions": [action.to_dict() for action in self.actions],
            "warnings": [dict(warning) for warning in self.warnings],
            "created_at": self.created_at,
        }


def finalize_task_packet(packet: TaskPacket) -> TaskPacket:
    """Return ``packet`` with a stable hash over its semantic contents."""
    data = packet.to_dict()
    data["task_packet_hash"] = ""
    packet.task_packet_hash = stable_hash(data)
    return packet


__all__ = [
    "ActionBatch",
    "BaseAction",
    "BlockedAction",
    "CompleteAction",
    "DispatchAction",
    "ExecutionAttempt",
    "RecoverAction",
    "RepairIntegrationAction",
    "ResolveMergeAction",
    "SessionControllerError",
    "WaitAction",
    "display_ticket",
    "finalize_task_packet",
]
