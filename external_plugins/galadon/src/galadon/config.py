from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

LAYOUTS = ("none", "webapp", "service", "plugin")
STACKS = ("python", "node", "none")
TEMPLATES = ("web", "api", "static")
ROLES = ("solo", "six-ring", "orchestrator")
ADAPTERS = ("local", "ssh", "k8s")

# The loader is the only description of galadon.yaml. A key it does not read is
# rejected by name: the retired 0.1.0 `tools:` port sat in real config files for
# months doing nothing because unknown keys used to be ignored.
TOP_LEVEL_KEYS = (
    "project",
    "template",
    "role",
    "layout",
    "stack",
    "deploy",
    "checks",
    "paths",
    "ports",
)

# Defaults are the 0.2.x paths: a project without a `paths:` block keeps the
# exact same artifacts and directories.
DEFAULT_PATHS = {
    "spec": "spec/spec.md",
    "evidence": "verify/evidence.md",
    "retro": "wiki/retro.md",
    "release": "release/release.json",
}

DEFAULT_PROBE_READY_SECONDS = 15.0
DEFAULT_KEEP_RELEASES = 5

_DEPLOY_FIELDS = (
    "adapter",
    "env",
    "build",
    "migrate",
    "release",
    "probe_url",
    "probe_expect",
    "artifact",
    "options",
)
_ENV_FIELDS = (
    "build",
    "migrate",
    "release",
    "probe_url",
    "probe_expect",
    "artifact",
    "options",
    "protected",
)
_PORT_KEYS = ("role", "template", "deploy")
_SSH_REQUIRED = ("host", "user", "remote_root", "service", "artifact")

_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
_REFERENCE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*:[A-Za-z_][A-Za-z0-9_]*$")
_SAFE_ENVIRONMENT_FILE = re.compile(r"^/[A-Za-z0-9._/-]+$")


class ConfigError(ValueError):
    pass


@dataclass
class DeployConfig:
    adapter: str = "local"
    env: str = "test"
    build: str = ""
    migrate: str = ""
    release: str = ""
    probe_url: str = ""
    probe_expect: str = ""
    artifact: str = ""
    options: dict[str, Any] = field(default_factory=dict)
    envs: tuple[str, ...] = ()
    protected: bool = False


@dataclass
class ChecksConfig:
    build: str = ""
    test: str = ""
    timeout: int = 300


@dataclass
class PathsConfig:
    spec: Path = Path(DEFAULT_PATHS["spec"])
    evidence: Path = Path(DEFAULT_PATHS["evidence"])
    retro: Path = Path(DEFAULT_PATHS["retro"])
    release: Path = Path(DEFAULT_PATHS["release"])


@dataclass
class PortsConfig:
    """Project-side replacements for the three ports, each pointing at code or
    templates inside the project."""

    role: str = ""
    template: str = ""
    deploy: str = ""


@dataclass
class ProjectConfig:
    name: str
    template: str
    role: str
    deploy: DeployConfig
    checks: ChecksConfig
    layout: str = "none"
    stack: str = "none"
    paths: PathsConfig = field(default_factory=PathsConfig)
    ports: PortsConfig = field(default_factory=PortsConfig)


def render_probe_expect(expect: str, commit: str | None) -> str:
    if "{{COMMIT}}" not in expect:
        return expect
    if not commit:
        raise ConfigError("deploy.probe_expect uses {{COMMIT}} but the project has no git commit")
    return expect.replace("{{COMMIT}}", commit)


def _mapping(value: Any, key: str) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ConfigError(f"galadon.yaml: {key} must be a mapping")
    return dict(value)


def _string(value: Any, where: str) -> str:
    if not isinstance(value, str):
        raise ConfigError(f"galadon.yaml: {where} must be a string")
    return value


def _blank_is_empty(value: Any, where: str) -> str:
    """A key left empty (`build:` with nothing after it) means "not configured".
    It used to be read as the string None and run as a command."""
    return "" if value is None else _string(value, where)


def _enum(value: Any, allowed: tuple[str, ...], message: str, empty: str = "") -> str:
    """An enum-like key. Anything that is not one of the allowed values —
    including a key left empty (`layout:` with nothing after it) — is reported
    with `message`. An empty string means `empty`, when that means anything.
    A caller passes the default for an absent key itself."""
    text = value.strip() if isinstance(value, str) else ""
    if text in allowed:
        return text
    if text == "" and value is not None and empty:
        return empty
    raise ConfigError(f"galadon.yaml: {message}")


def _positive_number(value: Any, where: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise ConfigError(f"galadon.yaml: {where} must be a number greater than 0 (got {value!r})")
    return float(value)


def _whole_number(value: Any, where: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ConfigError(f"galadon.yaml: {where} must be a whole number of 0 or more (got {value!r})")
    return value


def _boolean(value: Any, where: str) -> bool:
    if not isinstance(value, bool):
        raise ConfigError(f"galadon.yaml: {where} must be true or false (got {value!r})")
    return value


def _validate_ssh_options(options: dict[str, Any], artifact: str, where: str) -> None:
    values = {
        "host": options.get("host"),
        "user": options.get("user"),
        "remote_root": options.get("remote_root"),
        "service": options.get("service"),
        "artifact": artifact,
    }
    missing = [
        key
        for key in _SSH_REQUIRED
        if values[key] is None or not str(values[key]).strip()
    ]
    if missing:
        raise ConfigError(
            f"galadon.yaml: {where} uses adapter ssh and requires host, user, "
            f"remote_root, service, artifact; missing: {', '.join(missing)}"
        )

    host = str(values["host"]).strip()
    user = str(values["user"]).strip()
    service = str(values["service"]).strip()
    remote_root = str(values["remote_root"]).strip().rstrip("/")
    host_chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.:-[]"
    user_chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-"
    service_chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.@-"
    if not host[0].isalnum() or any(char not in host_chars for char in host):
        raise ConfigError("galadon.yaml: deploy.options.host contains unsupported characters")
    if not user[0].isalnum() or any(char not in user_chars for char in user):
        raise ConfigError("galadon.yaml: deploy.options.user contains unsupported characters")
    if not service[0].isalnum() or any(char not in service_chars for char in service):
        raise ConfigError("galadon.yaml: deploy.options.service contains unsupported characters")
    if not remote_root.startswith("/"):
        raise ConfigError("galadon.yaml: deploy.options.remote_root must be an absolute path")
    remote_root_chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-/"
    if any(char not in remote_root_chars for char in remote_root):
        raise ConfigError(
            "galadon.yaml: deploy.options.remote_root may only contain letters, digits, "
            "dot, underscore, hyphen and slash"
        )
    parts = PurePosixPath(remote_root).parts
    if len(parts) < 3 or ".." in parts or "." in parts:
        raise ConfigError(
            "galadon.yaml: deploy.options.remote_root must be a specific directory below /"
        )


def _validate_options(options: dict[str, Any], where: str) -> None:
    if "probe_ready_seconds" in options:
        _positive_number(options["probe_ready_seconds"], f"{where}.options.probe_ready_seconds")
    if "keep_releases" in options:
        _whole_number(options["keep_releases"], f"{where}.options.keep_releases")
    if "search_index" in options:
        _boolean(options["search_index"], f"{where}.options.search_index")
    for key in ("environment_file", "remote_migrate"):
        if options.get(key) is not None:
            _string(options[key], f"{where}.options.{key}")
    environment_file = options.get("environment_file")
    if environment_file and not _SAFE_ENVIRONMENT_FILE.fullmatch(str(environment_file).strip()):
        raise ConfigError(
            "galadon.yaml: deploy.options.environment_file must be an absolute path on the host "
            "made of letters, digits, dot, underscore, hyphen and slash"
        )


def _deploy_view(deploy_raw: dict[str, Any], override: dict[str, Any], name: str) -> dict[str, Any]:
    """One environment's effective deploy settings: the shared block with the
    environment's overrides on top. `options` merges key by key so an
    environment can change only the host."""
    merged = {**deploy_raw, **override}
    view: dict[str, Any] = {key: merged.get(key) for key in _DEPLOY_FIELDS}
    options = dict(_mapping(deploy_raw.get("options"), "deploy.options"))
    for key, value in merged.items():
        if key not in _DEPLOY_FIELDS and key not in ("envs", "protected") and key not in options:
            options[str(key)] = value
    options.update(_mapping(override.get("options"), f"deploy.envs.{name}.options"))
    view["options"] = options
    return view


def _load_deploy(deploy_raw: dict[str, Any], env: str | None, custom: bool) -> DeployConfig:
    envs_raw = _mapping(deploy_raw.get("envs"), "deploy.envs")
    for name, override in envs_raw.items():
        if not isinstance(name, str) or not _NAME.fullmatch(name):
            raise ConfigError(f"galadon.yaml: deploy.envs has an invalid environment name: {name!r}")
        unknown = sorted(set(str(key) for key in _mapping(override, f"deploy.envs.{name}")) - set(_ENV_FIELDS))
        if unknown:
            raise ConfigError(
                f"galadon.yaml: deploy.envs.{name} has unknown keys: {', '.join(unknown)} "
                f"(allowed: {', '.join(_ENV_FIELDS)})"
            )

    default_env = _string(deploy_raw.get("env", "test"), "deploy.env").strip()
    if not default_env:
        raise ConfigError("galadon.yaml: deploy.env must not be empty")
    selected = env if env is not None else default_env
    if selected != default_env and selected not in envs_raw:
        raise ConfigError(
            f"galadon.yaml defines no deploy.envs.{selected} (defined: "
            f"{', '.join(envs_raw) or 'none'}); add it, or target {default_env}"
        )

    views: dict[str, dict[str, Any]] = {
        name: _deploy_view(deploy_raw, override, name) for name, override in envs_raw.items()
    }
    if default_env not in views:
        views[default_env] = _deploy_view(deploy_raw, {}, default_env)

    adapter = _blank_is_empty(deploy_raw.get("adapter", "local"), "deploy.adapter").strip()
    adapter = adapter or ("custom" if custom else "local")
    if custom:
        if not _NAME.fullmatch(adapter):
            raise ConfigError(f"galadon.yaml: deploy.adapter must be a short name (got {adapter!r})")
    elif adapter not in ADAPTERS:
        raise ConfigError("galadon.yaml: deploy.adapter must be local, ssh or k8s")

    for name, view in views.items():
        where = f"deploy.envs.{name}" if name in envs_raw else "deploy"
        if adapter == "ssh":
            _validate_ssh_options(view["options"], _blank_is_empty(view["artifact"], f"{where}.artifact").strip(), where)
        _validate_options(view["options"], where)

    view = views[selected]
    where = f"deploy.envs.{selected}" if selected in envs_raw else "deploy"
    override = _mapping(envs_raw.get(selected), f"deploy.envs.{selected}")
    protected = (
        _boolean(override["protected"], f"deploy.envs.{selected}.protected")
        if "protected" in override
        else selected.lower().startswith("prod")
    )
    return DeployConfig(
        adapter=adapter,
        env=selected,
        build=_blank_is_empty(view["build"], f"{where}.build"),
        migrate=_blank_is_empty(view["migrate"], f"{where}.migrate"),
        release=_blank_is_empty(view["release"], f"{where}.release"),
        probe_url=_blank_is_empty(view["probe_url"], f"{where}.probe_url").strip(),
        probe_expect=_blank_is_empty(view["probe_expect"], f"{where}.probe_expect").strip(),
        artifact=_blank_is_empty(view["artifact"], f"{where}.artifact").strip(),
        options=dict(view["options"]),
        envs=tuple(envs_raw),
        protected=protected,
    )


def _load_checks(raw: dict[str, Any]) -> ChecksConfig:
    timeout = raw.get("timeout", 300)
    if isinstance(timeout, bool) or not isinstance(timeout, int) or timeout <= 0:
        raise ConfigError(
            f"galadon.yaml: checks.timeout must be a positive whole number of seconds (got {timeout!r})"
        )
    return ChecksConfig(
        build=_blank_is_empty(raw.get("build"), "checks.build").strip(),
        test=_blank_is_empty(raw.get("test"), "checks.test").strip(),
        timeout=timeout,
    )


def _load_ports(raw: Any, root: Path) -> PortsConfig:
    raw = _mapping(raw, "ports")
    unknown = sorted(set(str(key) for key in raw) - set(_PORT_KEYS))
    if unknown:
        raise ConfigError(
            f"galadon.yaml: ports has unknown keys: {', '.join(unknown)} "
            f"(allowed: {', '.join(_PORT_KEYS)})"
        )

    def reference(key: str) -> str:
        value = raw.get(key)
        value = ("" if value is None else _string(value, f"ports.{key}")).strip()
        if value and not _REFERENCE.fullmatch(value):
            raise ConfigError(
                f"galadon.yaml: ports.{key} must point at code inside the project as module:Attribute "
                f"(got {value!r})"
            )
        return value

    template = ""
    if raw.get("template") is not None:
        value = _string(raw["template"], "ports.template").strip()
        directory = Path(value).expanduser()
        if not directory.is_absolute():
            directory = root / directory
        if not (directory / "base").is_dir():
            raise ConfigError(
                f"galadon.yaml: ports.template must be a template directory containing base/ (got {directory})"
            )
        template = str(directory)
    return PortsConfig(role=reference("role"), template=template, deploy=reference("deploy"))


def _validate_path(value: str, key: str) -> Path:
    if not value.strip():
        raise ConfigError(f"galadon.yaml: {key} must not be empty")
    if "\\" in value:
        raise ConfigError(
            f"galadon.yaml: {key} must use forward slashes: {value}"
        )
    path = PurePosixPath(value.strip())
    if path.is_absolute() or ".." in path.parts or path.parts in {(), (".",)}:
        raise ConfigError(
            f"galadon.yaml: {key} must be a relative path inside the project: {value}"
        )
    return Path(*path.parts)


def _load_paths(raw: Any) -> PathsConfig:
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise ConfigError("galadon.yaml: paths must be a mapping")
    unknown = sorted(set(str(key) for key in raw) - set(DEFAULT_PATHS))
    if unknown:
        raise ConfigError(
            "galadon.yaml: paths has unknown keys: "
            f"{', '.join(unknown)} (allowed: {', '.join(DEFAULT_PATHS)})"
        )
    values: dict[str, str] = {}
    for key, default in DEFAULT_PATHS.items():
        value = raw.get(key, default)
        if not isinstance(value, str):
            raise ConfigError(f"galadon.yaml: paths.{key} must be a string")
        values[key] = value
    return PathsConfig(
        spec=_validate_path(values["spec"], "paths.spec"),
        evidence=_validate_path(values["evidence"], "paths.evidence"),
        retro=_validate_path(values["retro"], "paths.retro"),
        release=_validate_path(values["release"], "paths.release"),
    )


def load_config(root: Path, env: str | None = None) -> ProjectConfig:
    """Read galadon.yaml. `env` selects one of `deploy.envs`; None uses the
    default `deploy.env`. The returned deploy settings are that environment's."""
    path = root / "galadon.yaml"
    if not path.is_file():
        raise ConfigError(f"missing {path}; run `galadon init` first")
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        raise ConfigError(f"galadon.yaml is not valid YAML: {exc}") from exc
    if not isinstance(data, dict):
        raise ConfigError("galadon.yaml must contain a mapping")

    unknown = sorted({str(key) for key in data} - set(TOP_LEVEL_KEYS))
    if unknown:
        raise ConfigError(
            f"galadon.yaml: unknown top-level keys: {', '.join(unknown)} "
            f"(allowed: {', '.join(TOP_LEVEL_KEYS)})"
        )

    raw_name = data.get("project")
    name = "" if raw_name is None else _string(raw_name, "project").strip()
    if not name:
        raise ConfigError("galadon.yaml: project is required")

    ports = _load_ports(data.get("ports"), root)
    raw_template = data.get("template")
    if ports.template:
        # A project that ships its own templates also names its own profiles.
        template = raw_template.strip() if isinstance(raw_template, str) else ""
        if not _NAME.fullmatch(template) or not (Path(ports.template) / "profiles" / template).is_dir():
            raise ConfigError(
                f"galadon.yaml: template {template!r} is not a profile under "
                f"{ports.template}/profiles"
            )
    else:
        template = _enum(raw_template, TEMPLATES, "template must be web, api or static")

    raw_role = data.get("role", "solo")
    if ports.role:
        role = raw_role.strip() if isinstance(raw_role, str) else ""
        if not _NAME.fullmatch(role):
            raise ConfigError(f"galadon.yaml: role must be a short name (got {raw_role!r})")
    else:
        role = _enum(raw_role, ROLES, "role must be solo, six-ring or orchestrator")

    layout = _enum(
        data.get("layout", "none"), LAYOUTS, "layout must be none, webapp, service, plugin", empty="none"
    )
    stack = _enum(
        data.get("stack", "none"), STACKS, "stack must be python, node, none", empty="none"
    )

    deploy = _load_deploy(
        _mapping(data.get("deploy"), "deploy"), env, custom=bool(ports.deploy)
    )
    checks = _load_checks(_mapping(data.get("checks"), "checks"))
    paths = _load_paths(data.get("paths"))

    return ProjectConfig(
        name=name,
        template=template,
        role=role,
        deploy=deploy,
        checks=checks,
        layout=layout,
        stack=stack,
        paths=paths,
        ports=ports,
    )
