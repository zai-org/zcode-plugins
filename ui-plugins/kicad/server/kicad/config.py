"""Where the worker finds its data and KiCad. Reads no file at all: both locations come from the environment the plugin server was started with."""
from __future__ import annotations

import os
from pathlib import Path


def data_dir() -> Path:
    d = Path(os.environ["ZCODE_KICAD_DATA_DIR"]).resolve()
    d.mkdir(parents=True, exist_ok=True)
    return d


def kicad_app_dir() -> Path:
    return Path(os.environ.get("ZCODE_KICAD_APP") or "/Applications/KiCad/KiCad.app")
