from __future__ import annotations

import importlib.machinery
import importlib.util
import inspect
import itertools
import os
import sys
from importlib.machinery import ModuleSpec
from pathlib import Path
from typing import Any

from .config import ConfigError, ProjectConfig
from .roles import POLICIES

# What the ship loop calls on a DeployPort. `preflight` is optional: without
# it a port simply has nothing to check up front.
DEPLOY_METHODS = (
    "describe",
    "bootstrap",
    "teardown",
    "build",
    "migrate",
    "release",
    "probe",
    "rollback",
)

_sequence = itertools.count(1)


def _locate(root: Path, module_name: str) -> ModuleSpec | None:
    """Find `pkg.mod` under `root`, one component at a time: the path finder
    does not descend into a dotted name on its own."""
    search = [str(root)]
    spec: ModuleSpec | None = None
    parts = module_name.split(".")
    for position, part in enumerate(parts):
        try:
            spec = importlib.machinery.PathFinder.find_spec(part, search)
        except Exception as exc:
            raise ConfigError(
                f"galadon.yaml: cannot import {module_name} from {root}: {type(exc).__name__}: {exc}"
            ) from exc
        if spec is None:
            return None
        if position < len(parts) - 1:
            if spec.submodule_search_locations is None:
                return None
            search = list(spec.submodule_search_locations)
    return spec


def _forget_project_modules(root: Path, before: set[str]) -> None:
    """Drop the modules a port import just brought in from the project, so a
    later load — here or in another project — reads them from disk again."""
    prefix = os.path.abspath(root).rstrip(os.sep) + os.sep
    for name, module in list(sys.modules.items()):
        origin = getattr(module, "__file__", None)
        if name in before or "_galadon_port_" in name or not origin:
            continue
        if os.path.abspath(origin).startswith(prefix):
            del sys.modules[name]


def _load(root: Path, reference: str, what: str) -> Any:
    """Import `module:Attribute` from the project and return what it names: an
    object, or an instance when it names a class."""
    module_name, _, attribute = reference.partition(":")
    added = str(root) not in sys.path
    if added:
        sys.path.insert(0, str(root))
    try:
        found = _locate(root, module_name)
        if found is None or found.origin in (None, "namespace") or found.loader is None:
            raise ConfigError(
                f"galadon.yaml: {what} points at {reference!r}, "
                f"but {module_name} is not a module inside {root}"
            )
        # A fresh module under a private name every time: two projects can
        # both ship a `ports` module, and a re-run must see the file as it is
        # on disk now, not a cached copy. A loader refuses to execute a module
        # under a name that is not its own, so the private spec is built
        # around the file that was located.
        before = set(sys.modules)
        # Inside a package the private name sits under the real package, so
        # the spec's own parent is right and relative imports resolve.
        parent, _, _ = module_name.rpartition(".")
        private = f"{parent}._galadon_port_{next(_sequence)}" if parent else f"_galadon_port_{next(_sequence)}"
        spec = importlib.util.spec_from_file_location(private, found.origin)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        try:
            spec.loader.exec_module(module)
        except Exception as exc:
            raise ConfigError(
                f"galadon.yaml: {what} {reference!r} failed to import: {type(exc).__name__}: {exc}"
            ) from exc
        finally:
            _forget_project_modules(root, before)
    finally:
        if added:
            sys.path.remove(str(root))
    target = getattr(module, attribute, None)
    if target is None:
        raise ConfigError(
            f"galadon.yaml: {what} points at {reference!r}, but {module_name} has no {attribute}"
        )
    return target() if inspect.isclass(target) else target


def role_policy_for(config: ProjectConfig, root: Path) -> Any:
    if config.ports.role:
        policy = _load(root, config.ports.role, "ports.role")
        if not callable(getattr(policy, "assign", None)):
            raise ConfigError(
                f"galadon.yaml: ports.role {config.ports.role!r} does not implement the RolePort: "
                "it needs an assign(phase) method"
            )
        return policy
    return POLICIES[config.role]()


def load_deploy_port(config: ProjectConfig, root: Path) -> Any:
    reference = config.ports.deploy
    port = _load(root, reference, "ports.deploy")
    missing = [name for name in DEPLOY_METHODS if not callable(getattr(port, name, None))]
    if missing:
        raise ConfigError(
            f"galadon.yaml: ports.deploy {reference!r} does not implement the DeployPort; "
            f"missing: {', '.join(missing)}"
        )
    if not isinstance(getattr(port, "name", None), str) or not port.name.strip():
        raise ConfigError(f"galadon.yaml: ports.deploy {reference!r} must carry a `name` string")
    return port


def template_dir(config: ProjectConfig) -> Path | None:
    return Path(config.ports.template) if config.ports.template else None
