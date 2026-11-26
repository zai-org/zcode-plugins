from __future__ import annotations

from pathlib import Path

from ..config import ProjectConfig
from ..extensions import load_deploy_port
from .local import DeployError, LocalCommandAdapter
from .ssh import SshSystemdAdapter


def adapter_for(config: ProjectConfig, root: Path):
    """The project's DeployPort: its own when `ports.deploy` names one, else a
    bundled adapter."""
    if config.ports.deploy:
        return load_deploy_port(config, root)
    name = config.deploy.adapter
    if name == "local":
        return LocalCommandAdapter()
    if name == "ssh":
        return SshSystemdAdapter()
    raise DeployError(
        f"deploy adapter {name!r} is a declared port but has no implementation in this build; "
        "set ports.deploy in galadon.yaml to your own DeployPort to connect it"
    )


__all__ = ["DeployError", "LocalCommandAdapter", "SshSystemdAdapter", "adapter_for"]
