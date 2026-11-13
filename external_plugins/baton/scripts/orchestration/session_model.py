"""Host-neutral contracts for session-driven Baton execution."""

from __future__ import annotations

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
        fields = cls.__dataclass_fields__
        return cls(**{name: data.get(name, field.default) for name, field in fields.items()})

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


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


@dataclass
class ResolveMergeAction(BaseAction):
    kind: ClassVar[str] = "resolve_merge"
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


@dataclass
class WaitAction(BaseAction):
    kind: ClassVar[str] = "wait"
    reason: str
    active_assignments: list[str] = field(default_factory=list)


@dataclass
class BlockedAction(BaseAction):
    kind: ClassVar[str] = "blocked"
    code: str
    reason: str
    ticket_num: int = 0


@dataclass
class CompleteAction(BaseAction):
    kind: ClassVar[str] = "complete"
    revision: int
    resolved_tickets: list[int] = field(default_factory=list)
    worktrees_removed: list[dict] = field(default_factory=list)
    worktrees_skipped: list[dict] = field(default_factory=list)


ACTION_TYPES: dict[str, type[BaseAction]] = {
    action.kind: action
    for action in (
        DispatchAction,
        ResolveMergeAction,
        RecoverAction,
        WaitAction,
        BlockedAction,
        CompleteAction,
    )
}


def action_from_dict(data: dict[str, Any]) -> BaseAction:
    kind = str(data.get("kind", ""))
    action_type = ACTION_TYPES.get(kind)
    if action_type is None:
        raise ValueError(f"unknown session action kind: {kind!r}")
    payload = {k: v for k, v in data.items() if k != "kind"}
    return action_type(**payload)


@dataclass
class ActionBatch:
    run_id: str
    generation: int
    state: str
    actions: list[BaseAction] = field(default_factory=list)
    created_at: str = field(default_factory=utc_now)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ActionBatch":
        return cls(
            run_id=str(data["run_id"]),
            generation=int(data["generation"]),
            state=str(data["state"]),
            actions=[action_from_dict(x) for x in data.get("actions", [])],
            created_at=str(data.get("created_at", utc_now())),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "generation": self.generation,
            "state": self.state,
            "actions": [action.to_dict() for action in self.actions],
            "created_at": self.created_at,
        }


def finalize_task_packet(packet: TaskPacket) -> TaskPacket:
    """Return ``packet`` with a stable hash over its semantic contents."""
    data = packet.to_dict()
    data["task_packet_hash"] = ""
    packet.task_packet_hash = stable_hash(data)
    return packet


__all__ = [
    "ACTION_TYPES",
    "ActionBatch",
    "BaseAction",
    "BlockedAction",
    "CompleteAction",
    "DispatchAction",
    "ExecutionAttempt",
    "RecoverAction",
    "ResolveMergeAction",
    "WaitAction",
    "action_from_dict",
    "finalize_task_packet",
]
