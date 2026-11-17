"""Multi-agent orchestration data contracts.

``TaskPacket`` is the immutable, hashable-by-construction contract handed to a
builder subagent: goal, acceptance criteria, verification commands, workspace
and resources.

The structured receipt returned by an agent is reused verbatim from
``orchestration/result.py`` (``ResultEnvelope``) — it is **not** redefined
here.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

#: The role a Task Packet declares: the subagent that implements the ticket.
ROLE_BUILDER = "builder"


@dataclass
class TaskPacket:
    """The immutable, hashable-by-construction work contract handed to a
    builder agent.

    A packet fully describes one unit of work: the goal, how success is
    judged (``acceptance_criteria`` / ``verification_commands`` /
    ``output_contract``), what it depends on (``dependencies`` /
    ``base_commit`` / ``artifacts``), where it may touch (``project_path`` /
    ``allowed_paths``), and how the orchestrator should
    behave on ambiguity (``retry_policy``). ``plan_revision`` binds the
    packet to the Live Plan revision that produced it; ``task_packet_hash``
    is the canonical content hash callers use for idempotency.
    """

    task_id: str
    role: str
    goal: str
    acceptance_criteria: list[str] = field(default_factory=list)
    dependencies: list[str] = field(default_factory=list)
    base_commit: str = ""
    artifacts: list[str] = field(default_factory=list)
    project_path: str = ""
    allowed_paths: list[str] = field(default_factory=list)
    verification_commands: list[str] = field(default_factory=list)
    output_contract: list[str] = field(default_factory=list)
    retry_policy: str = "manual-on-ambiguous"
    plan_revision: int = 0
    task_packet_hash: str = ""

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TaskPacket":
        return cls(
            task_id=str(data.get("task_id", "")),
            role=str(data.get("role", "")),
            goal=str(data.get("goal", "")),
            acceptance_criteria=[str(x) for x in data.get("acceptance_criteria", [])],
            dependencies=[str(x) for x in data.get("dependencies", [])],
            base_commit=str(data.get("base_commit", "")),
            artifacts=[str(x) for x in data.get("artifacts", [])],
            project_path=str(data.get("project_path", "")),
            allowed_paths=[str(x) for x in data.get("allowed_paths", [])],
            verification_commands=[str(x) for x in data.get("verification_commands", [])],
            output_contract=[str(x) for x in data.get("output_contract", [])],
            retry_policy=str(data.get("retry_policy", "manual-on-ambiguous")),
            plan_revision=int(data.get("plan_revision", 0)),
            task_packet_hash=str(data.get("task_packet_hash", "")),
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
