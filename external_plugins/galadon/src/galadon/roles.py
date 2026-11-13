from __future__ import annotations

from .ports import Phase


class SoloPolicy:
    def assign(self, phase: Phase) -> list[str]:
        return ["agent"]


class SixRingPolicy:
    _mapping = {
        "spec": ["spec"],
        "build": ["dev"],
        "verify": ["test", "check"],
        "ship": ["git"],
        "learn": ["spec", "check"],
        "done": ["agent"],
    }

    def assign(self, phase: Phase) -> list[str]:
        return list(self._mapping.get(phase, ["agent"]))


class OrchestratorPolicy:
    _mapping = {
        "spec": ["orchestrator", "spec"],
        "build": ["orchestrator", "worker"],
        "verify": ["orchestrator", "test"],
        "ship": ["orchestrator", "release"],
        "learn": ["orchestrator", "check"],
        "done": ["orchestrator"],
    }

    def assign(self, phase: Phase) -> list[str]:
        return list(self._mapping.get(phase, ["orchestrator"]))


_POLICIES = {
    "solo": SoloPolicy,
    "six-ring": SixRingPolicy,
    "orchestrator": OrchestratorPolicy,
}


def role_policy_for(name: str) -> SoloPolicy | SixRingPolicy | OrchestratorPolicy:
    return _POLICIES[name]()
