from __future__ import annotations

import json
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from ..config import render_probe_expect
from ..ports import Artifact, DeployContext, ProbeResult, Release
from ..util import digest_path, git_commit, now_iso, run_shell
from .probe import READY_SECONDS, ProbeNotReady, extract_commit, fetch
from .release import (
    DeployError,
    ReleaseLayout,
    deploy_lock,
    release_name,
    release_version,
    retain_previous,
    switch_current,
)

Clock = Callable[[], datetime]
CommitProvider = Callable[[Path], str | None]


class LocalCommandAdapter:
    name = "local"

    def __init__(
        self,
        clock: Clock | None = None,
        commit_provider: CommitProvider | None = None,
        sleep: Callable[[float], None] | None = None,
        probe_ready: float = READY_SECONDS,
    ) -> None:
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._commit_provider = commit_provider or git_commit
        self._sleep = sleep or time.sleep
        self._probe_ready = probe_ready

    def describe(self, ctx: DeployContext) -> str:
        return f"local workspace {ctx.root}"

    def bootstrap(self, ctx: DeployContext) -> dict[str, Any]:
        raise DeployError("local adapter has no bootstrap step; there is nothing to provision")

    def teardown(self, ctx: DeployContext) -> dict[str, Any]:
        raise DeployError("local adapter has no teardown step; there is nothing to remove")

    def _run(self, command: str, ctx: DeployContext, stage: str) -> None:
        if not command:
            return
        code, stdout, stderr = run_shell(command, ctx.root, timeout=ctx.config.checks.timeout)
        if code != 0:
            detail = (stdout + "\n" + stderr).strip()[-2000:]
            raise DeployError(f"{stage} failed with exit {code}: {detail}")

    def build(self, ctx: DeployContext) -> Artifact:
        self._run(ctx.config.deploy.build, ctx, "build")
        configured = ctx.config.deploy.artifact.strip()
        if configured:
            path = ctx.root / configured
            if not path.exists():
                raise DeployError(f"configured artifact does not exist: {configured}")
        else:
            path = ctx.root / ".galadon" / "artifact.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(
                json.dumps({"project": ctx.config.name, "built_at": now_iso()}, ensure_ascii=False)
                + "\n",
                encoding="utf-8",
            )
        try:
            digest = digest_path(path)
        except OSError as exc:
            raise DeployError(f"cannot hash artifact {path}: {exc}") from exc
        return Artifact(path=path, digest=digest)

    def migrate(self, ctx: DeployContext) -> None:
        self._run(ctx.config.deploy.migrate, ctx, "migrate")

    def _layout(self, ctx: DeployContext) -> ReleaseLayout:
        configured = str(ctx.config.deploy.options.get("root") or "").strip()
        if configured:
            root = Path(configured).expanduser()
            if not root.is_absolute():
                root = ctx.root / root
        else:
            root = ctx.root / ".galadon" / "deploy"
        return ReleaseLayout(root.resolve())

    def _commit(self, ctx: DeployContext) -> str:
        return (ctx.commit or self._commit_provider(ctx.root) or "").strip()

    def release(self, ctx: DeployContext, artifact: Artifact) -> Release:
        layout = self._layout(ctx)
        artifact_root = artifact.path.resolve()
        if layout.root == artifact_root or layout.root.is_relative_to(artifact_root):
            raise DeployError(
                f"release root {layout.root} is inside artifact {artifact_root}; "
                "set deploy.options.root outside the artifact"
            )
        commit = self._commit(ctx)
        version = commit or artifact.digest[:12]
        target = layout.release_dir(release_name(self._clock(), version))
        with deploy_lock(layout):
            self._run(ctx.config.deploy.release, ctx, "release")
            try:
                layout.ensure()
                if target.exists() or target.is_symlink():
                    raise DeployError(f"release directory already exists: {target}")
                target.mkdir(parents=True)
                if artifact.path.is_dir():
                    shutil.copytree(artifact.path, target, symlinks=True, dirs_exist_ok=True)
                else:
                    shutil.copy2(artifact.path, target / artifact.path.name)
                previous = retain_previous(layout)
                switch_current(layout, target)
            except OSError as exc:
                shutil.rmtree(target, ignore_errors=True)
                raise DeployError(f"cannot publish release {target}: {exc}") from exc
        return Release(
            env=ctx.env,
            artifact=artifact,
            adapter=self.name,
            metadata={
                "released_at": now_iso(),
                "version": version,
                "commit": commit or None,
                "release_dir": str(target),
                "previous": str(previous or ""),
            },
        )

    def _probe(
        self,
        ctx: DeployContext,
        expected: str,
        *,
        check_expect: bool,
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
            return ProbeResult(ok=False, detail=str(exc), url=url)
        if status != 200:
            return ProbeResult(ok=False, detail=f"HTTP {status}", url=url)
        body = body.strip()
        try:
            payload: Any = json.loads(body)
        except json.JSONDecodeError:
            payload = None
        if isinstance(payload, dict):
            actual = extract_commit(payload)
            if actual is None:
                return ProbeResult(
                    ok=False,
                    detail="probe JSON is missing the commit field",
                    url=url,
                )
            if actual != expected:
                return ProbeResult(
                    ok=False,
                    detail=f"probe commit mismatch: expected {expected}, got {actual or '(missing)'}",
                    url=url,
                    actual=actual or None,
                )
            return ProbeResult(
                ok=True,
                detail=f"HTTP {status} commit {actual}",
                url=url,
                actual=actual,
            )
        if not check_expect:
            return ProbeResult(
                ok=True,
                detail=f"HTTP {status} (text body; version not asserted)",
                url=url,
                actual=body or None,
            )
        if body != expected:
            return ProbeResult(
                ok=False,
                detail=(
                    "probe body does not exactly match deploy.probe_expect: "
                    f"expected {expected!r}, got {body[:200]!r}"
                ),
                url=url,
                actual=body[:200] or None,
            )
        return ProbeResult(ok=True, detail=f"HTTP {status}", url=url, actual=body)

    def probe(self, ctx: DeployContext, release: Release) -> ProbeResult:
        expect = render_probe_expect(
            ctx.config.deploy.probe_expect.strip(),
            str(release.metadata.get("commit") or "") or None,
        )
        if not expect:
            raise DeployError(
                "deploy.probe_expect is required for the local adapter; "
                "a bare HTTP 200 is not a version probe"
            )
        return self._probe(ctx, expect, check_expect=True)

    def _rollback_expected(self, ctx: DeployContext, version: str) -> str:
        # A static probe_expect is a marker both releases emit, so the re-probe
        # asserts what the release gate asserted; only a {{COMMIT}} template
        # ties the probe body to the rolled-back version.
        expect = ctx.config.deploy.probe_expect.strip()
        if expect and "{{COMMIT}}" not in expect:
            return expect
        return version

    def rollback(self, ctx: DeployContext, release: Release) -> None:
        layout = self._layout(ctx)
        with deploy_lock(layout):
            target = layout.previous_release()
            version = release_version(target)
            switch_current(layout, target, suffix="rollback")
            release.metadata["rollback"] = {
                "version": version,
                "target": str(target),
                "ok": False,
            }
        try:
            probe = self._probe(ctx, self._rollback_expected(ctx, version), check_expect=False)
        except DeployError as exc:
            raise DeployError(
                f"rolled back to {version} at {target}, but the re-probe failed: {exc}"
            ) from exc
        release.metadata["rollback"].update(
            {
                "ok": probe.ok,
                "actual": probe.actual,
                "probe": {
                    "ok": probe.ok,
                    "detail": probe.detail,
                    "url": probe.url,
                },
            }
        )
        if not probe.ok:
            raise DeployError(
                f"rolled back to {version} at {target}, but the re-probe failed: {probe.detail}"
            )
