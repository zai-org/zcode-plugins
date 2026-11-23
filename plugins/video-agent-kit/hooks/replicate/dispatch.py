from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys


def project_of(raw: bytes) -> Path:
    """VE_PROJECT_DIR, else the event's cwd (the host's project root), else the process cwd."""
    value = (os.environ.get("VE_PROJECT_DIR") or "").strip()
    if value and "${" not in value:
        return Path(value)
    try:
        event = json.loads(raw.decode("utf-8") or "{}")
    except (UnicodeDecodeError, ValueError):
        event = {}
    cwd = event.get("cwd") if isinstance(event, dict) else None
    return Path(cwd) if isinstance(cwd, str) and cwd.strip() else Path.cwd()


def main() -> int:
    raw = sys.stdin.buffer.read()
    project = project_of(raw)
    enabled = (project / ".v2c/replicate.enabled").is_file() or (project / ".v2c/code2video.enabled").is_file()
    if not enabled:
        return 0
    hook = Path(__file__).resolve().with_name("r2_event.py")
    # stdin is already consumed, so hand the same bytes to the event handler.
    result = subprocess.run([sys.executable, str(hook)], input=raw, capture_output=True)
    sys.stdout.buffer.write(result.stdout)
    sys.stderr.buffer.write(result.stderr)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
