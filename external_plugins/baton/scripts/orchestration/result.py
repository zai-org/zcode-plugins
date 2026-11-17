"""Result Envelope contract for Baton agent outputs."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from orchestration.plan_model import utc_now


@dataclass
class ResultEnvelope:
    """Structured output returned by a worker/agent for one task."""

    task_id: str
    profile_id: str
    status: str
    ticket_num: int
    assignment_id: str
    plan_revision: int
    task_packet_hash: str
    attempt: int = 0
    commit_sha: str = ""
    receipt_path: str = ""
    integration_sha: str = ""
    changed_files: list[str] = field(default_factory=list)
    verification: list[dict[str, Any]] = field(default_factory=list)
    artifacts: list[str] = field(default_factory=list)
    findings: list[str] = field(default_factory=list)
    proposed_followups: list[str] = field(default_factory=list)
    created_at: str = field(default_factory=utc_now)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ResultEnvelope":
        return cls(
            task_id=str(data["task_id"]),
            profile_id=str(data.get("profile_id", "")),
            status=str(data["status"]),
            ticket_num=int(data["ticket_num"]),
            assignment_id=str(data.get("assignment_id", "")),
            plan_revision=int(data.get("plan_revision", 0)),
            task_packet_hash=str(data.get("task_packet_hash", "")),
            attempt=int(data.get("attempt", 0)),
            commit_sha=str(data.get("commit_sha", "")),
            receipt_path=str(data.get("receipt_path", "")),
            integration_sha=str(data.get("integration_sha", "")),
            changed_files=[str(x) for x in data.get("changed_files", [])],
            verification=[dict(x) for x in data.get("verification", [])],
            artifacts=[str(x) for x in data.get("artifacts", [])],
            findings=[str(x) for x in data.get("findings", [])],
            proposed_followups=[str(x) for x in data.get("proposed_followups", [])],
            created_at=str(data.get("created_at", utc_now())),
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
