"""Where the worker finds its data and KiCad."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from kicad_installation import select_installation


def data_dir() -> Path:
    d = Path(os.environ["ZCODE_KICAD_DATA_DIR"]).resolve()
    d.mkdir(parents=True, exist_ok=True)
    return d


@lru_cache(maxsize=1)
def kicad_installation() -> dict[str, object]:
    return select_installation(
        os.environ.get("ZCODE_KICAD_APP"),
        os.environ.get("ZCODE_KICAD_EDITION"),
    )


def kicad_app_dir() -> Path:
    return Path(str(kicad_installation()["selected"]["path"]))
