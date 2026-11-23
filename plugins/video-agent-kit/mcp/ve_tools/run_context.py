from __future__ import annotations

import os
from pathlib import Path

_PLUGIN_ROOT = Path(__file__).resolve().parents[2]


def _clean_value(value: str | None) -> str | None:
    """Reject empty values and unexpanded ``${...}`` placeholders left behind
    by config layers that do not support interpolation."""
    if value is None:
        return None
    value = value.strip()
    if not value or "${" in value:
        return None
    return value


def _raw_env(*names: str) -> str | None:
    for name in names:
        value = _clean_value(os.environ.get(name))
        if value is not None:
            return value
    return None


def project_dir() -> Path:
    # Bootstrap: resolved from the process environment only — .env files are
    # themselves located relative to the project dir. The host starts the MCP
    # server in the project directory (manifest mcpServers ``cwd``), so cwd is the fallback.
    value = _raw_env("VE_PROJECT_DIR")
    return Path(value).resolve() if value else Path.cwd().resolve()


def env_files() -> list[Path]:
    """Config files, lowest precedence first: plugin-root .env (kit-wide
    defaults), then project-local .env (per-project overrides), then the
    secrets file the pipeline writes for the container (VE_SECRETS_FILE,
    root-only; credentials are kept out of the process environment there)."""
    files = [_PLUGIN_ROOT / ".env", project_dir() / ".env"]
    secrets = _raw_env("VE_SECRETS_FILE")
    if secrets:
        files.append(Path(secrets))
    return files


def load_secrets_into_process() -> int:
    """Copy the secrets file (VE_SECRETS_FILE) into os.environ for this process and its children
    (the job supervisor subprocesses inherit it). Returns the number of names loaded; 0 when the
    file is absent or unreadable. Values already present in the environment are kept."""
    secrets = _raw_env("VE_SECRETS_FILE")
    if not secrets:
        return 0
    values = _parse_env_file(Path(secrets))
    loaded = 0
    for k, v in values.items():
        if v and k not in os.environ:
            os.environ[k] = v
            loaded += 1
    return loaded


def _parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        # utf-8-sig: tolerate a BOM, which would otherwise corrupt the first key.
        text = path.read_text(encoding="utf-8-sig")
    except OSError:
        return values
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export "):]
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            # Quoted value: strip exactly one symmetric pair; '#' inside stays.
            value = value[1:-1]
        elif value.startswith("#"):
            # The whole value is a comment.
            value = ""
        else:
            # Unquoted value: allow trailing inline comments.
            for marker in (" #", "\t#"):
                idx = value.find(marker)
                if idx != -1:
                    value = value[:idx].rstrip()
                    break
        if key:
            values[key] = value
    return values


def clean_env(*names: str) -> str | None:
    """Read the first usable config value. Precedence: process environment >
    project-local .env > plugin-root .env. Empty values and unexpanded
    ``${...}`` placeholders are skipped at every layer — a broken value in a
    higher layer falls through to the next layer instead of masking it."""
    value = _raw_env(*names)
    if value is not None:
        return value
    for path in reversed(env_files()):
        values = _parse_env_file(path)
        for name in names:
            value = _clean_value(values.get(name))
            if value is not None:
                return value
    return None


class RunContext:
    def __init__(self, session_kind: str = "cli", *, project_root: str | Path | None = None,
                 create_dirs: bool = True) -> None:
        # "mcp" for the long-lived MCP server, "cli" for one-shot direct calls.
        # project_root pins an explicit project (worker threads, read-only status checks)
        # without changing the process environment; create_dirs=False leaves it untouched.
        self.session_kind = session_kind
        self.project_dir = Path(project_root).resolve() if project_root is not None else project_dir()
        self.output_dir = self.project_dir / "out"
        self.work_dir = self.project_dir / ".video_agent"
        if create_dirs:
            self.output_dir.mkdir(parents=True, exist_ok=True)
            self.work_dir.mkdir(parents=True, exist_ok=True)

    def resolve(self, path: str | Path) -> Path:
        p = Path(path)
        if p.is_absolute():
            return p.resolve()
        return (self.project_dir / p).resolve()

    def virtualize(self, path: str | Path) -> str:
        p = Path(path).resolve()
        try:
            return str(p.relative_to(self.project_dir))
        except ValueError:
            return str(p)
