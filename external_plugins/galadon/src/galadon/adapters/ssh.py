from __future__ import annotations

import json
import re
import shlex
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Callable

from ..config import render_probe_expect
from ..ports import Artifact, DeployContext, ProbeResult, Release
from ..util import digest_path, git_commit, now_iso
from .probe import READY_SECONDS, ProbeNotReady, extract_commit, fetch
from .release import (
    ROOT_MARKER,
    DeployError,
    release_name,
    release_version,
    shell_lock,
    shell_retain_previous,
    shell_switch_current,
)

Runner = Callable[..., tuple[int, str, str]]
Clock = Callable[[], datetime]
CommitProvider = Callable[[Path], str | None]

_SSH_OPTIONS = (
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=15",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
)
_SAFE_HOST = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:\[\]-]*$")
_SAFE_USER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
_SAFE_SERVICE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.@-]*$")
_SAFE_DOMAIN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.-]*$")
_SAFE_LISTEN = re.compile(r"^[A-Za-z0-9_.:\[\]-]+$")
_SAFE_MARKER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
_SAFE_PATH = re.compile(r"^[A-Za-z0-9._/-]+$")


def subprocess_runner(
    argv: list[str],
    *,
    cwd: Path | None = None,
    input: str | None = None,
    timeout: int = 300,
) -> tuple[int, str, str]:
    try:
        proc = subprocess.run(
            argv,
            cwd=None if cwd is None else str(cwd),
            input=input,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout or ""
        stderr = exc.stderr or ""
        if isinstance(stdout, bytes):
            stdout = stdout.decode(errors="replace")
        if isinstance(stderr, bytes):
            stderr = stderr.decode(errors="replace")
        return 124, stdout, stderr + f"\ncommand timed out after {timeout}s"
    except OSError as exc:
        return 127, "", f"{type(exc).__name__}: {exc}"
    return proc.returncode, proc.stdout, proc.stderr


def _q(value: Any) -> str:
    return shlex.quote(str(value))


def _parse_fields(stdout: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for line in stdout.splitlines():
        if line.startswith("GALADON_") and "=" in line:
            key, value = line.split("=", 1)
            fields[key] = value
    return fields


class SshSystemdAdapter:
    name = "ssh"

    def __init__(
        self,
        runner: Runner | None = None,
        clock: Clock | None = None,
        commit_provider: CommitProvider | None = None,
        sleep: Callable[[float], None] | None = None,
        probe_ready: float = READY_SECONDS,
    ) -> None:
        self._runner = runner or subprocess_runner
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._commit_provider = commit_provider or git_commit
        self._sleep = sleep or time.sleep
        self._probe_ready = probe_ready

    def _option(self, ctx: DeployContext, key: str) -> str:
        value = ctx.config.deploy.options.get(key)
        return "" if value is None else str(value).strip()

    def _target(self, ctx: DeployContext) -> str:
        host = self._option(ctx, "host")
        user = self._option(ctx, "user")
        if not _SAFE_HOST.fullmatch(host) or not _SAFE_USER.fullmatch(user):
            raise DeployError("deploy.options.host or user is missing or invalid")
        return f"{user}@{host}"

    def _root(self, ctx: DeployContext) -> str:
        root = self._option(ctx, "remote_root").rstrip("/")
        if not root.startswith("/"):
            raise DeployError("deploy.options.remote_root must be an absolute path")
        if not _SAFE_PATH.fullmatch(root):
            raise DeployError(
                "deploy.options.remote_root may only contain letters, digits, "
                "dot, underscore, hyphen and slash"
            )
        parts = PurePosixPath(root).parts
        if len(parts) < 3 or ".." in parts or "." in parts:
            raise DeployError(
                "deploy.options.remote_root must be a specific directory below /"
            )
        return root

    def _service(self, ctx: DeployContext) -> str:
        service = self._option(ctx, "service")
        if not _SAFE_SERVICE.fullmatch(service):
            raise DeployError("deploy.options.service is missing or invalid")
        return service

    def _run(
        self,
        argv: list[str],
        *,
        ctx: DeployContext,
        stage: str,
        input: str | None = None,
        timeout: int | None = None,
    ) -> tuple[str, str]:
        code, stdout, stderr = self._runner(
            argv,
            cwd=ctx.root,
            input=input,
            timeout=timeout or ctx.config.checks.timeout,
        )
        if code != 0:
            detail = (stdout + "\n" + stderr).strip()[-4000:]
            raise DeployError(f"{stage} failed with exit {code}: {detail}")
        return stdout, stderr

    def _remote(
        self,
        ctx: DeployContext,
        script: str,
        stage: str,
        timeout: int | None = None,
    ) -> dict[str, str]:
        stdout, _ = self._run(
            ["ssh", *_SSH_OPTIONS, self._target(ctx), "bash -s"],
            ctx=ctx,
            stage=stage,
            input=script,
            timeout=timeout,
        )
        return _parse_fields(stdout)

    def _local_command(self, ctx: DeployContext, command: str, stage: str) -> None:
        if not command:
            return
        self._run(
            ["/bin/sh", "-c", command],
            ctx=ctx,
            stage=stage,
        )

    def _artifact_path(self, ctx: DeployContext) -> Path:
        configured = ctx.config.deploy.artifact.strip()
        if not configured:
            raise DeployError("deploy.artifact is required for the ssh adapter")
        root = ctx.root.resolve()
        path = (root / configured).resolve()
        if not path.is_relative_to(root):
            raise DeployError(f"deploy.artifact escapes the project root: {configured}")
        return path

    def preflight(self, ctx: DeployContext) -> dict[str, Any]:
        artifact = self._artifact_path(ctx)
        if not ctx.config.deploy.build.strip() and not artifact.exists():
            raise DeployError(
                f"artifact does not exist and no build command is configured: {artifact}"
            )
        root = self._root(ctx)
        service = self._service(ctx)
        drift_check = ""
        notes: list[str] = []
        try:
            unit = self._unit_text(ctx)
        except DeployError as exc:
            unit = ""
            missing = self._missing_bootstrap_keys(ctx)
            reason = f"missing bootstrap keys: {', '.join(missing)}" if missing else str(exc)
            notes.append(
                f"skipping unit drift check: unit template incomplete ({reason})"
            )
        if unit:
            unit_path = f"/etc/systemd/system/{service}.service"
            drift_check = (
                "expected_unit=$(mktemp)\n"
                "cat > \"$expected_unit\" <<'GALADON_UNIT'\n"
                f"{unit}"
                "GALADON_UNIT\n"
                f'if ! cmp -s "$expected_unit" {_q(unit_path)}; then\n'
                '  rm -f "$expected_unit"\n'
                f'  echo "galadon: systemd unit drift detected: {unit_path}" >&2\n'
                '  echo "galadon: run `galadon bootstrap --env <env>` to converge the unit" >&2\n'
                "  exit 78\n"
                "fi\n"
                'rm -f "$expected_unit"\n'
            )
        script = f"""set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
root={_q(root)}
service={_q(service)}
test -d "$root" || {{ echo "galadon: remote_root is missing: $root" >&2; exit 66; }}
test -w "$root" || {{ echo "galadon: remote_root is not writable: $root" >&2; exit 66; }}
command -v systemctl >/dev/null 2>&1 || {{ echo "galadon: systemctl is unavailable" >&2; exit 69; }}
command -v flock >/dev/null 2>&1 || {{ echo "galadon: flock is unavailable" >&2; exit 69; }}
systemctl cat "$service" >/dev/null 2>&1 || {{ echo "galadon: systemd service is not installed: $service" >&2; exit 66; }}
{drift_check}printf 'GALADON_OK=1\\n'
"""
        self._remote(ctx, script, "preflight")
        return {
            "target": self._target(ctx),
            "remote_root": root,
            "service": service,
            "notes": notes,
        }

    def build(self, ctx: DeployContext) -> Artifact:
        self._local_command(ctx, ctx.config.deploy.build, "build")
        path = self._artifact_path(ctx)
        if not path.exists():
            raise DeployError(f"configured artifact does not exist: {path}")
        try:
            digest = digest_path(path)
        except OSError as exc:
            raise DeployError(f"cannot hash artifact {path}: {exc}") from exc
        return Artifact(path=path, digest=digest)

    def migrate(self, ctx: DeployContext) -> None:
        self._local_command(ctx, ctx.config.deploy.migrate, "migrate")

    def release(self, ctx: DeployContext, artifact: Artifact) -> Release:
        commit = self._commit_provider(ctx.root)
        if not commit:
            raise DeployError("cannot determine the git commit for this build")

        self._local_command(ctx, ctx.config.deploy.release, "release hook")
        root = self._root(ctx)
        service = self._service(ctx)
        run_user = self._run_user(ctx)
        release_dir = f"{root}/releases/{release_name(self._clock(), commit)}"

        prepare = f"""set -euo pipefail
root={_q(root)}
test -d "$root" || {{ echo "galadon: remote_root is missing: $root" >&2; exit 66; }}
install -d -m 0755 {_q(root + "/releases")} {_q(root + "/shared")}
test ! -e {_q(release_dir)} || {{ echo "galadon: release directory already exists: {release_dir}" >&2; exit 73; }}
printf 'GALADON_OK=1\\n'
"""
        self._remote(ctx, prepare, "release prepare")

        source = str(artifact.path) + ("/" if artifact.path.is_dir() else "")
        destination = f"{self._target(ctx)}:{release_dir}/"
        self._run(
            [
                "rsync",
                "-az",
                "-e",
                " ".join(["ssh", *_SSH_OPTIONS]),
                source,
                destination,
            ],
            ctx=ctx,
            stage="release rsync",
        )

        finalize = f"""set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
root={_q(root)}
service={_q(service)}
run_user={_q(run_user)}
release={_q(release_dir)}
{shell_lock()}test -d "$release" || {{ echo "galadon: release directory is missing: $release" >&2; exit 66; }}
chown -R "$run_user:$run_user" "$release"
{shell_retain_previous()}{shell_switch_current('"$release"', "new")}if ! systemctl restart "$service"; then
  echo "galadon: service restart failed; restoring previous current" >&2
  if [ -n "$old" ]; then
    ln -sfn "$old" "$root/.current.restore"
    mv -Tf "$root/.current.restore" "$root/current"
    if ! systemctl restart "$service"; then
      echo "galadon: previous release also failed to restart" >&2
    fi
  else
    rm -f "$root/current"
  fi
  exit 1
fi
printf 'GALADON_PREVIOUS=%s\\n' "$old"
printf 'GALADON_CURRENT=%s\\n' "$release"
printf 'GALADON_OK=1\\n'
"""
        fields = self._remote(ctx, finalize, "release finalize")
        return Release(
            env=ctx.env,
            artifact=artifact,
            adapter=self.name,
            metadata={
                "released_at": now_iso(),
                "commit": commit,
                "release_dir": release_dir,
                "previous": fields.get("GALADON_PREVIOUS", ""),
            },
        )

    def _probe(
        self,
        ctx: DeployContext,
        expected_commit: str,
        *,
        check_expect: bool = True,
    ) -> ProbeResult:
        url = ctx.config.deploy.probe_url.strip()
        if not url:
            raise DeployError(
                "deploy.probe_url is required; Galadon refuses to report success without a probe"
            )
        try:
            status, body = fetch(
                url, ready_seconds=self._probe_ready, sleep=self._sleep
            )
        except ProbeNotReady as exc:
            raise DeployError(f"probe request failed: {exc}") from exc.last
        if status != 200:
            raise DeployError(f"probe returned HTTP {status}")
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            raise DeployError(f"probe response is not JSON: {exc}") from exc
        if not isinstance(payload, dict):
            raise DeployError("probe response JSON must be an object")
        actual = extract_commit(payload)
        if actual != expected_commit:
            raise DeployError(
                f"probe commit mismatch: expected {expected_commit}, got {actual or '(missing)'}"
            )
        # A rollback re-check only proves the old version is serving again; probe_expect may
        # describe text that exists exclusively in the failed build.
        if check_expect:
            expect = render_probe_expect(ctx.config.deploy.probe_expect.strip(), expected_commit)
            if expect and expect not in body:
                raise DeployError(f"probe body missing expected text: {expect}")
        return ProbeResult(
            ok=True,
            detail=f"HTTP {status} commit {actual}",
            url=url,
            actual=actual,
        )

    def probe(self, ctx: DeployContext, release: Release) -> ProbeResult:
        expected = str(release.metadata.get("commit", ""))
        if not expected:
            raise DeployError("release metadata is missing the build commit")
        return self._probe(ctx, expected)

    def rollback(self, ctx: DeployContext, release: Release) -> None:
        root = self._root(ctx)
        service = self._service(ctx)
        script = f"""set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
root={_q(root)}
service={_q(service)}
{shell_lock()}test -L "$root/previous" || {{ echo "galadon: no previous release link" >&2; exit 66; }}
target=$(readlink -f "$root/previous")
test -d "$target" || {{ echo "galadon: previous release is missing: $target" >&2; exit 66; }}
case "$target" in
  "$root/releases/"*) ;;
  *) echo "galadon: previous link does not point into $root/releases: $target" >&2; exit 65 ;;
esac
{shell_switch_current('"$target"', "rollback")}systemctl restart "$service"
printf 'GALADON_ROLLBACK_TO=%s\\n' "$target"
printf 'GALADON_OK=1\\n'
"""
        fields = self._remote(ctx, script, "rollback")
        target = (
            fields.get("GALADON_ROLLBACK_TO") or str(release.metadata.get("previous", ""))
        ).rstrip("/")
        version = release_version(target)
        release.metadata["rollback"] = {
            "version": version,
            "target": target,
            "ok": False,
        }
        probe = self._probe(ctx, version, check_expect=False)
        release.metadata["rollback"].update(
            {
                "ok": True,
                "actual": probe.actual,
                "probe": {
                    "ok": probe.ok,
                    "detail": probe.detail,
                    "url": probe.url,
                },
            }
        )

    def _run_user(self, ctx: DeployContext) -> str:
        user = self._option(ctx, "run_user") or "galadon"
        if not _SAFE_USER.fullmatch(user):
            raise DeployError("deploy.options.run_user is invalid")
        return user

    def _manage_user(self, ctx: DeployContext) -> bool:
        raw = ctx.config.deploy.options.get("manage_user", True)
        if isinstance(raw, bool):
            return raw
        return str(raw).strip().lower() not in {"false", "no", "0", "off"}

    def describe(self, ctx: DeployContext) -> str:
        return f"{self._target(ctx)}:{self._root(ctx)}"

    def _missing_bootstrap_keys(self, ctx: DeployContext) -> list[str]:
        return [
            key
            for key in ("domain", "listen", "exec_start", "caddy_block")
            if not self._option(ctx, key)
        ]

    def _bootstrap_values(self, ctx: DeployContext) -> tuple[str, str, str]:
        values = {
            "domain": self._option(ctx, "domain"),
            "listen": self._option(ctx, "listen"),
            "exec_start": self._option(ctx, "exec_start"),
            "caddy_block": self._option(ctx, "caddy_block"),
        }
        missing = self._missing_bootstrap_keys(ctx)
        if missing:
            raise DeployError(
                "bootstrap requires deploy.options domain, listen, exec_start, caddy_block; "
                f"missing: {', '.join(missing)}"
            )
        if not _SAFE_DOMAIN.fullmatch(values["domain"]):
            raise DeployError("deploy.options.domain is invalid")
        if not _SAFE_LISTEN.fullmatch(values["listen"]):
            raise DeployError("deploy.options.listen is invalid")
        if not _SAFE_MARKER.fullmatch(values["caddy_block"]):
            raise DeployError("deploy.options.caddy_block is invalid")
        if "\n" in values["exec_start"] or "\r" in values["exec_start"]:
            raise DeployError("deploy.options.exec_start must be a single line")
        return values["domain"], values["listen"], values["exec_start"]

    def _unit_text(self, ctx: DeployContext) -> str:
        root = self._root(ctx)
        service = self._service(ctx)
        run_user = self._run_user(ctx)
        exec_start = self._bootstrap_values(ctx)[2]
        return f"""[Unit]
Description=Galadon service {service}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User={run_user}
Group={run_user}
WorkingDirectory={root}/current
ExecStart={exec_start}
Restart=on-failure
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
"""

    def bootstrap(self, ctx: DeployContext) -> dict[str, Any]:
        root = self._root(ctx)
        service = self._service(ctx)
        run_user = self._run_user(ctx)
        domain, listen, exec_start = self._bootstrap_values(ctx)
        marker = self._option(ctx, "caddy_block")
        unit_path = f"/etc/systemd/system/{service}.service"
        unit = self._unit_text(ctx)
        block = (
            f"# galadon:begin {marker}\n"
            f"{domain} {{\n"
            "    import access_log\n"
            '    header X-Robots-Tag "noindex, nofollow"\n'
            "    respond /robots.txt `User-agent: *\n"
            "Disallow: /` 200\n"
            f"    reverse_proxy {listen}\n"
            "}\n"
            f"# galadon:end {marker}\n"
        )
        script = f"""set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
root={_q(root)}
service={_q(service)}
run_user={_q(run_user)}
domain={_q(domain)}
listen={_q(listen)}
marker={_q(marker)}
unit_path={_q(unit_path)}

marker_file="$root/{ROOT_MARKER}"
if [ -d "$root" ]; then
  if [ -f "$marker_file" ]; then
    existing=$(cat "$marker_file")
    if [ "$existing" != "$marker" ]; then
      echo "galadon: refusing to bootstrap $root: it belongs to marker $existing" >&2
      exit 65
    fi
  elif [ -n "$(ls -A "$root" 2>/dev/null)" ]; then
    echo "galadon: refusing to bootstrap $root: directory is not empty and carries no {ROOT_MARKER}" >&2
    exit 65
  fi
fi

manage_user={1 if self._manage_user(ctx) else 0}
user_created=0
if [ "$manage_user" -eq 1 ]; then
  if ! getent group "$run_user" >/dev/null 2>&1; then
    groupadd --system "$run_user"
  fi
  if id -u "$run_user" >/dev/null 2>&1; then
    user_created=0
  else
    useradd --system --gid "$run_user" --no-create-home --shell /usr/sbin/nologin "$run_user"
    user_created=1
  fi
else
  id -u "$run_user" >/dev/null 2>&1 || {{
    echo "galadon: manage_user is false but $run_user does not exist" >&2
    exit 66
  }}
fi
install -d -m 0755 "$root"
install -d -m 0755 -o "$run_user" -g "$run_user" "$root/releases" "$root/shared"
printf '%s\\n' "$marker" > "$root/{ROOT_MARKER}"
chmod 0644 "$root/{ROOT_MARKER}"

unit_tmp=$(mktemp)
cat > "$unit_tmp" <<'GALADON_UNIT'
{unit}GALADON_UNIT
if [ -f "$unit_path" ] && cmp -s "$unit_tmp" "$unit_path"; then
  unit_changed=0
else
  install -m 0644 "$unit_tmp" "$unit_path"
  unit_changed=1
fi
rm -f "$unit_tmp"
if [ "$unit_changed" -eq 1 ]; then
  systemctl daemon-reload
fi
systemctl enable "$service" >/dev/null
if [ -L "$root/current" ]; then
  if [ "$unit_changed" -eq 1 ]; then
    systemctl restart "$service"
  else
    systemctl start "$service"
  fi
fi

caddyfile=/etc/caddy/Caddyfile
block_file=$(mktemp)
cat > "$block_file" <<'GALADON_CADDY_BLOCK'
{block}GALADON_CADDY_BLOCK
begin="# galadon:begin $marker"
end="# galadon:end $marker"
new_file=$(mktemp)
has_begin=0
has_end=0
if [ -f "$caddyfile" ]; then
  if grep -Fqx "$begin" "$caddyfile"; then has_begin=1; fi
  if grep -Fqx "$end" "$caddyfile"; then has_end=1; fi
fi
if [ "$has_begin" -ne "$has_end" ]; then
  echo "galadon: incomplete Caddy marker block for $marker" >&2
  exit 65
fi
if [ -f "$caddyfile" ] && [ "$has_begin" -eq 1 ]; then
  awk -v begin="$begin" -v end="$end" -v blockfile="$block_file" '
    BEGIN {{ while ((getline line < blockfile) > 0) block = block line "\\n" }}
    $0 == begin {{ printf "%s", block; skip=1; next }}
    skip == 1 && $0 == end {{ skip=0; next }}
    skip == 1 {{ next }}
    {{ print }}
  ' "$caddyfile" > "$new_file"
elif [ -f "$caddyfile" ]; then
  cp "$caddyfile" "$new_file"
  printf '\\n' >> "$new_file"
  cat "$block_file" >> "$new_file"
else
  : > "$new_file"
  cat "$block_file" >> "$new_file"
fi

backup=""
caddy_changed=0
if [ -f "$caddyfile" ] && cmp -s "$new_file" "$caddyfile"; then
  caddy_changed=0
else
  if [ -f "$caddyfile" ]; then
    backup="$caddyfile.galadon-bak.$(date -u +%Y%m%dT%H%M%SZ).$$"
    cp -p "$caddyfile" "$backup"
  fi
  if [ -f "$caddyfile" ]; then
    cat "$new_file" > "$caddyfile"
  else
    install -m 0644 "$new_file" "$caddyfile"
  fi
  if ! caddy validate --config "$caddyfile" --adapter caddyfile; then
    if [ -n "$backup" ]; then
      cp -p "$backup" "$caddyfile"
    else
      rm -f "$caddyfile"
    fi
    rm -f "$block_file" "$new_file"
    echo "galadon: caddy validate failed; previous config restored and caddy was not reloaded" >&2
    exit 1
  fi
  if ! systemctl reload caddy; then
    if [ -n "$backup" ]; then
      cp -p "$backup" "$caddyfile"
      if ! systemctl reload caddy; then
        echo "galadon: previous Caddyfile restored but caddy reload still failed" >&2
      fi
    else
      rm -f "$caddyfile"
    fi
    rm -f "$block_file" "$new_file"
    exit 1
  fi
  caddy_changed=1
fi
rm -f "$block_file" "$new_file"

printf 'GALADON_USER_CREATED=%s\\n' "$user_created"
printf 'GALADON_UNIT_CHANGED=%s\\n' "$unit_changed"
printf 'GALADON_CADDY_CHANGED=%s\\n' "$caddy_changed"
printf 'GALADON_CADDY_BACKUP=%s\\n' "$backup"
printf 'GALADON_OK=1\\n'
"""
        fields = self._remote(ctx, script, "bootstrap")
        return {
            "target": self._target(ctx),
            "remote_root": root,
            "service": service,
            "user": run_user,
            "user_created": fields.get("GALADON_USER_CREATED") == "1",
            "unit": unit_path,
            "unit_changed": fields.get("GALADON_UNIT_CHANGED") == "1",
            "caddy": {
                "marker": marker,
                "changed": fields.get("GALADON_CADDY_CHANGED") == "1",
                "backup": fields.get("GALADON_CADDY_BACKUP") or None,
            },
        }

    def teardown(self, ctx: DeployContext) -> dict[str, Any]:
        root = self._root(ctx)
        service = self._service(ctx)
        run_user = self._run_user(ctx)
        manage_user = self._manage_user(ctx)
        marker = self._option(ctx, "caddy_block")
        if not marker or not _SAFE_MARKER.fullmatch(marker):
            raise DeployError("teardown requires a valid deploy.options.caddy_block")
        unit_path = f"/etc/systemd/system/{service}.service"
        script = f"""set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
root={_q(root)}
service={_q(service)}
marker={_q(marker)}
unit_path={_q(unit_path)}
run_user={_q(run_user)}
manage_user={1 if manage_user else 0}

marker_file="$root/{ROOT_MARKER}"
if [ ! -f "$marker_file" ]; then
  echo "galadon: refusing to remove $root: $marker_file is missing" >&2
  exit 65
fi
if [ "$(cat "$marker_file")" != "$marker" ]; then
  echo "galadon: refusing to remove $root: marker file does not match $marker" >&2
  exit 65
fi

service_removed=0
if [ -f "$unit_path" ]; then
  systemctl disable --now "$service"
  rm -f "$unit_path"
  systemctl daemon-reload
  service_removed=1
fi

caddyfile=/etc/caddy/Caddyfile
begin="# galadon:begin $marker"
end="# galadon:end $marker"
backup=""
caddy_changed=0
has_begin=0
has_end=0
if [ -f "$caddyfile" ]; then
  if grep -Fqx "$begin" "$caddyfile"; then has_begin=1; fi
  if grep -Fqx "$end" "$caddyfile"; then has_end=1; fi
fi
if [ "$has_begin" -ne "$has_end" ]; then
  echo "galadon: incomplete Caddy marker block for $marker" >&2
  exit 65
fi
if [ "$has_begin" -eq 1 ]; then
  new_file=$(mktemp)
  awk -v begin="$begin" -v end="$end" '
    $0 == begin {{ skip=1; next }}
    skip == 1 && $0 == end {{ skip=0; next }}
    skip == 1 {{ next }}
    {{ print }}
  ' "$caddyfile" > "$new_file"
  backup="$caddyfile.galadon-bak.$(date -u +%Y%m%dT%H%M%SZ).$$"
  cp -p "$caddyfile" "$backup"
  cat "$new_file" > "$caddyfile"
  rm -f "$new_file"
  if ! caddy validate --config "$caddyfile" --adapter caddyfile; then
    cp -p "$backup" "$caddyfile"
    echo "galadon: caddy validate failed; previous config restored and caddy was not reloaded" >&2
    exit 1
  fi
  if ! systemctl reload caddy; then
    cp -p "$backup" "$caddyfile"
    if ! systemctl reload caddy; then
      echo "galadon: previous Caddyfile restored but caddy reload still failed" >&2
    fi
    exit 1
  fi
  caddy_changed=1
fi

rm -rf "$root"
user_removed=0
user_skipped=""
if [ "$manage_user" -eq 1 ] && id -u "$run_user" >/dev/null 2>&1; then
  if userdel "$run_user" 2>/dev/null; then
    user_removed=1
  elif pgrep -u "$run_user" >/dev/null 2>&1; then
    user_skipped="still in use by another service"
    echo "galadon: left $run_user in place: still in use by another service" >&2
  else
    echo "galadon: could not remove system user $run_user" >&2
    exit 1
  fi
fi
printf 'GALADON_SERVICE_REMOVED=%s\\n' "$service_removed"
printf 'GALADON_CADDY_CHANGED=%s\\n' "$caddy_changed"
printf 'GALADON_CADDY_BACKUP=%s\\n' "$backup"
printf 'GALADON_ROOT_REMOVED=1\\n'
printf 'GALADON_USER_REMOVED=%s\\n' "$user_removed"
printf 'GALADON_USER_SKIPPED=%s\\n' "$user_skipped"
printf 'GALADON_OK=1\\n'
"""
        fields = self._remote(ctx, script, "teardown")
        return {
            "target": self._target(ctx),
            "remote_root": root,
            "service": service,
            "service_removed": fields.get("GALADON_SERVICE_REMOVED") == "1",
            "caddy": {
                "marker": marker,
                "changed": fields.get("GALADON_CADDY_CHANGED") == "1",
                "backup": fields.get("GALADON_CADDY_BACKUP") or None,
            },
            "root_removed": fields.get("GALADON_ROOT_REMOVED") == "1",
            "user_removed": fields.get("GALADON_USER_REMOVED") == "1",
            "user_skip_reason": fields.get("GALADON_USER_SKIPPED") or None,
        }
