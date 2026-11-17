"""Shared plan data model and stable-hash helpers.

Split out of the retired amendment engine: these contracts are the durable
plan-store schema (``queue.db`` snapshots, ``plan.json``) and are used by the
plan store, the session model, and result envelopes.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any


def utc_now() -> str:
    """Return a stable UTC timestamp for persisted audit records."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def stable_json(data: Any) -> str:
    """Serialize data with deterministic key ordering."""
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def stable_hash(data: Any) -> str:
    """Compute a short, stable hash for plan snapshots and task packets."""
    return hashlib.sha256(stable_json(data).encode("utf-8")).hexdigest()[:16]


@dataclass
class PlanTicket:
    """Machine-readable snapshot of one OpenSpec task in a plan revision."""

    num: int
    title: str
    what_to_build: str
    blocked_by: list[int] = field(default_factory=list)
    status: str = "ready"
    criteria: list[str] = field(default_factory=list)
    required: bool = True
    source_revision: int = 1

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "PlanTicket":
        return cls(
            num=int(data["num"]),
            title=str(data["title"]),
            what_to_build=str(data.get("what_to_build", "")),
            blocked_by=[int(x) for x in data.get("blocked_by", [])],
            status=str(data.get("status", "ready")),
            criteria=[str(x) for x in data.get("criteria", [])],
            required=bool(data.get("required", True)),
            source_revision=int(data.get("source_revision", 1)),
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class PlanRevision:
    """A complete approved plan snapshot."""

    job_id: str
    feature: str
    revision: int
    parent_revision: int | None
    plan_hash: str
    approved_by: str
    approved_at: str
    created_at: str
    tickets: list[PlanTicket] = field(default_factory=list)
    completion_state: str = "active"

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "PlanRevision":
        return cls(
            job_id=str(data["job_id"]),
            feature=str(data["feature"]),
            revision=int(data["revision"]),
            parent_revision=(
                int(data["parent_revision"])
                if data.get("parent_revision") is not None
                else None
            ),
            plan_hash=str(data["plan_hash"]),
            approved_by=str(data.get("approved_by", "")),
            approved_at=str(data.get("approved_at", "")),
            created_at=str(data.get("created_at", "")),
            tickets=[PlanTicket.from_dict(x) for x in data.get("tickets", [])],
            completion_state=str(data.get("completion_state", "active")),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "feature": self.feature,
            "revision": self.revision,
            "parent_revision": self.parent_revision,
            "plan_hash": self.plan_hash,
            "approved_by": self.approved_by,
            "approved_at": self.approved_at,
            "created_at": self.created_at,
            "tickets": [t.to_dict() for t in self.tickets],
            "completion_state": self.completion_state,
        }

    def hashable_dict(self) -> dict[str, Any]:
        data = self.to_dict()
        data["plan_hash"] = ""
        return data


__all__ = [
    "PlanRevision",
    "PlanTicket",
    "stable_hash",
    "stable_json",
    "utc_now",
]
