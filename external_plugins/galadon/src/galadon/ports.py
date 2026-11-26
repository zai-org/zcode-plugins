from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from .config import ProjectConfig

Phase = Literal["spec", "build", "verify", "ship", "learn", "done"]


@dataclass
class Artifact:
    path: Path
    digest: str


@dataclass
class Release:
    env: str
    artifact: Artifact
    adapter: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ProbeResult:
    ok: bool
    detail: str
    url: str | None = None
    actual: str | None = None


@dataclass
class DeployContext:
    root: Path
    config: ProjectConfig
    env: str
    commit: str | None = None
