"""Read saved paragraph audio as cache input; TTS still verifies every binding."""
from __future__ import annotations

import json
import logging
from pathlib import Path

LOG = logging.getLogger(__name__)


def entries(out: Path) -> list[dict]:
    """Rows of the saved production TTS manifest, if any; invalid files are skipped."""
    path = out / 'script_tts.json'
    if not path.is_file():
        return []
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError):
        LOG.warning('Skipping unreadable paragraph audio cache: script_tts.json')
        return []
    if not isinstance(value, list) or any(not isinstance(row, dict) for row in value):
        return []
    # TTS still validates voice/prose/style fingerprints, actual audio bytes
    # and ASR bindings. This module grants no new acceptance authority.
    return value
