#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

from hook_common import project_dir, read_stdin_json

MEDIA_PATH_RE = re.compile(
    r"[^\s'\"()\[\]<>,;:!?，、。；：！？]+\.(?:mp4|mov|webm|mkv|avi|m4v|mp3|wav|m4a|aac|ogg|opus|flac)(?![0-9A-Za-z_])",
    re.IGNORECASE,
)
MAX_MEDIA = 3
PROBE_TIMEOUT = 4


def duration_seconds(path: Path) -> float:
    if shutil.which("ffprobe") is None:
        return 0.0
    try:
        proc = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            capture_output=True,
            text=True,
            # hooks.json gives the whole hook 15 s for up to MAX_MEDIA probes; a 20 s probe
            # timeout let one slow file get the hook killed before any hint was printed.
            timeout=PROBE_TIMEOUT,
        )
    except (OSError, subprocess.SubprocessError):
        # A slow or unreadable file must not fail the prompt hook with a traceback.
        return 0.0
    if proc.returncode != 0:
        return 0.0
    try:
        value = float((proc.stdout or "").strip())
    except ValueError:
        return 0.0
    return value if value > 0 else 0.0


def resolve_candidate(raw: str, project: Path) -> Path | None:
    sep_positions = [i for i in (raw.find("/"), raw.find("\\")) if i != -1]
    max_start = min(sep_positions) if sep_positions else len(raw) - 1
    for start in range(max_start + 1):
        candidate = raw[start:]
        path = Path(candidate)
        if not path.is_absolute():
            path = project / candidate
        try:
            path = path.resolve()
            if path.is_file():
                return path
        except (OSError, ValueError):
            continue
    return None


def main() -> None:
    data = read_stdin_json()
    prompt = data.get("prompt") or ""
    project = project_dir()
    seen: set[Path] = set()
    lines: list[str] = []

    for match in MEDIA_PATH_RE.finditer(prompt):
        path = resolve_candidate(match.group(0), project)
        if path is None or path in seen:
            continue
        seen.add(path)
        if len(seen) > MAX_MEDIA:
            break
        duration = duration_seconds(path)
        duration_text = f" (~{duration:.0f}s)" if duration > 0 else ""
        lines.append(
            f"[video-agent-kit] Detected local media input {path}{duration_text}. "
            "For speech-aware tasks, run transcribe(input_path) to produce a timed transcript."
        )

    if not lines:
        sys.exit(0)
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": "\n".join(lines),
        }
    }, ensure_ascii=False))
    sys.exit(0)


if __name__ == "__main__":
    main()
