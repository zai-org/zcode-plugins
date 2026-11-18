from __future__ import annotations

from .local import DeployError, LocalCommandAdapter
from .ssh import SshSystemdAdapter


def adapter_for(name: str) -> LocalCommandAdapter | SshSystemdAdapter:
    if name == "local":
        return LocalCommandAdapter()
    if name == "ssh":
        return SshSystemdAdapter()
    raise DeployError(
        f"deploy adapter {name!r} is a declared port but has no implementation in this build"
    )


__all__ = ["DeployError", "LocalCommandAdapter", "SshSystemdAdapter", "adapter_for"]
