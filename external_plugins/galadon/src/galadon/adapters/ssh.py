from __future__ import annotations

import json
import subprocess
import time
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any, Callable

from ..config import render_probe_expect
from ..ports import Artifact, DeployContext, ProbeResult, Release
from ..util import digest_path, git_commit, now_iso
from .probe import ProbeNotReady, extract_commit, fetch, readiness, require_probe_url
from .release import DeployError, keep_releases, release_name, release_version
from .ssh_scripts import (
    SAFE_DOMAIN,
    SAFE_HOST,
    SAFE_LISTEN,
    SAFE_MARKER,
    SAFE_PATH,
    SAFE_SERVICE,
    SAFE_USER,
    bootstrap_script,
    caddy_block,
    finalize_script,
    prepare_script,
    preflight_script,
    rollback_script,
    teardown_script,
    unit_text,
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


def _parse_fields(stdout: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for line in stdout.splitlines():
        if line.startswith("GALADON_") and "=" in line:
            key, value = line.split("=", 1)
            fields[key] = value
    return fields


def remote_migrate(options: dict[str, Any]) -> str:
    return str(options.get("remote_migrate") or "").strip()


class SshSystemdAdapter:
    name = "ssh"

    def __init__(
        self,
        runner: Runner | None = None,
        clock: Clock | None = None,
        commit_provider: CommitProvider | None = None,
        sleep: Callable[[float], None] | None = None,
        probe_ready: float | None = None,
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
        if not SAFE_HOST.fullmatch(host) or not SAFE_USER.fullmatch(user):
            raise DeployError("deploy.options.host or user is missing or invalid")
        return f"{user}@{host}"

    def _root(self, ctx: DeployContext) -> str:
        root = self._option(ctx, "remote_root").rstrip("/")
        if not root.startswith("/"):
            raise DeployError("deploy.options.remote_root must be an absolute path")
        if not SAFE_PATH.fullmatch(root):
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
        if not SAFE_SERVICE.fullmatch(service):
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
        # The probe is checked before anything is built or touched: a missing
        # or malformed probe URL used to be discovered with the release live.
        probe = require_probe_url(ctx.config.deploy.probe_url)
        artifact = self._artifact_path(ctx)
        if not ctx.config.deploy.build.strip() and not artifact.exists():
            raise DeployError(
                f"artifact does not exist and no build command is configured: {artifact}"
            )
        root = self._root(ctx)
        service = self._service(ctx)
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
        unit_path = f"/etc/systemd/system/{service}.service"
        self._remote(ctx, preflight_script(root, service, unit, unit_path), "preflight")
        return {
            "target": self._target(ctx),
            "remote_root": root,
            "service": service,
            "probe": probe,
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
        # This hook runs on the machine that ships. `options.remote_migrate` is
        # the one that runs on the host, inside the new release.
        self._local_command(ctx, ctx.config.deploy.migrate, "migrate")

    def release(self, ctx: DeployContext, artifact: Artifact) -> Release:
        commit = (ctx.commit if ctx.commit is not None else self._commit_provider(ctx.root) or "").strip()
        if not commit:
            raise DeployError("cannot determine the git commit for this build")

        self._local_command(ctx, ctx.config.deploy.release, "release hook")
        root = self._root(ctx)
        service = self._service(ctx)
        run_user = self._run_user(ctx)
        options = ctx.config.deploy.options
        release_dir = f"{root}/releases/{release_name(self._clock(), commit)}"

        self._remote(ctx, prepare_script(root, release_dir), "release prepare")

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

        finalize = finalize_script(
            root, service, run_user, release_dir, remote_migrate(options), keep_releases(options)
        )
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
                "pruned": fields.get("GALADON_PRUNED", "").split(),
            },
        )

    def _probe(
        self,
        ctx: DeployContext,
        expected_commit: str,
        *,
        check_expect: bool = True,
    ) -> ProbeResult:
        url = require_probe_url(ctx.config.deploy.probe_url)
        try:
            status, body = fetch(
                url, ready_seconds=readiness(ctx, self._probe_ready), sleep=self._sleep
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
        fields = self._remote(ctx, rollback_script(root, service), "rollback")
        if fields.get("GALADON_FIRST_RELEASE") == "1":
            # Nothing was live before this release. The host is back to that
            # state: no `current`, service stopped. There is nothing to re-probe.
            release.metadata["rollback"] = {
                "version": None,
                "target": None,
                "ok": True,
                "first_release": True,
                "service_stopped": True,
            }
            return
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
        if not SAFE_USER.fullmatch(user):
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
        if not SAFE_DOMAIN.fullmatch(values["domain"]):
            raise DeployError("deploy.options.domain is invalid")
        if not SAFE_LISTEN.fullmatch(values["listen"]):
            raise DeployError("deploy.options.listen is invalid")
        if not SAFE_MARKER.fullmatch(values["caddy_block"]):
            raise DeployError("deploy.options.caddy_block is invalid")
        if "\n" in values["exec_start"] or "\r" in values["exec_start"]:
            raise DeployError("deploy.options.exec_start must be a single line")
        return values["domain"], values["listen"], values["exec_start"]

    def _unit_text(self, ctx: DeployContext) -> str:
        return unit_text(
            self._service(ctx),
            self._run_user(ctx),
            self._root(ctx),
            self._bootstrap_values(ctx)[2],
            self._option(ctx, "environment_file"),
        )

    def bootstrap(self, ctx: DeployContext) -> dict[str, Any]:
        root = self._root(ctx)
        service = self._service(ctx)
        run_user = self._run_user(ctx)
        domain, listen, _ = self._bootstrap_values(ctx)
        marker = self._option(ctx, "caddy_block")
        unit_path = f"/etc/systemd/system/{service}.service"
        block = caddy_block(
            domain, listen, marker, bool(ctx.config.deploy.options.get("search_index", False))
        )
        script = bootstrap_script(
            root, service, run_user, domain, listen, marker, unit_path,
            self._unit_text(ctx), block, self._manage_user(ctx),
        )
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
        if not marker or not SAFE_MARKER.fullmatch(marker):
            raise DeployError("teardown requires a valid deploy.options.caddy_block")
        script = teardown_script(
            root, service, marker, f"/etc/systemd/system/{service}.service", run_user, manage_user
        )
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
