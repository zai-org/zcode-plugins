"""The single git subprocess wrapper shared by every orchestration module."""

from __future__ import annotations

import subprocess
from pathlib import Path


def run_git(
    args: list[str],
    *,
    cwd: str | Path,
    error: type[Exception],
    timeout: int = 30,
    check: bool = True,
) -> subprocess.CompletedProcess:
    """Run ``git <args>`` in ``cwd`` and raise ``error`` on failure.

    ``error`` is the caller's exception type (``WorktreeError``,
    ``ReceiptError``), so each module keeps its own failure surface while
    sharing one implementation. Spawn failures and timeouts always raise;
    a non-zero exit raises only when ``check`` is set (tolerant callers
    inspect ``returncode`` themselves).
    """
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        raise error(f"git {' '.join(args)} failed: {exc}") from exc
    if check and result.returncode != 0:
        detail = (result.stderr or "").strip() or (result.stdout or "").strip()
        raise error(
            f"git {' '.join(args)} failed (exit {result.returncode}): "
            f"{detail or 'no output'}"
        )
    return result
