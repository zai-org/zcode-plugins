"""Single place that knows where KiCad lives.

Override with env ``ZCODE_KICAD_APP`` (path to ``KiCad.app``; default ``/Applications/KiCad/KiCad.app``).
On Linux (Docker) fall back to ``kicad-cli`` on PATH and ``/usr/share/kicad``.
"""
from __future__ import annotations

import os
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path

from .config import kicad_app_dir


class KiCadMissing(RuntimeError):
    """KiCad (kicad-cli / bundled python / libraries) could not be located."""


def _first_existing(*cands: Path | str | None) -> Path | None:
    for c in cands:
        if c and Path(c).exists():
            return Path(c)
    return None


def app_dir() -> Path:
    return kicad_app_dir()


def kicad_cli() -> Path:
    p = _first_existing(
        app_dir() / "Contents/MacOS/kicad-cli",
        shutil.which("kicad-cli"),
        "/usr/bin/kicad-cli",
        "/opt/homebrew/bin/kicad-cli",
    )
    if not p:
        raise KiCadMissing(
            "kicad-cli not found. Install KiCad 10 (brew install --cask kicad) or set ZCODE_KICAD_APP to KiCad.app."
        )
    return p


def kicad_python() -> Path:
    """Interpreter that can ``import pcbnew`` (KiCad's bundled one)."""
    fw = app_dir() / "Contents/Frameworks/Python.framework/Versions/Current/bin/python3"
    p = _first_existing(fw, os.environ.get("ZCODE_KICAD_PCBNEW_PYTHON"), "/usr/bin/python3")
    if not p:
        raise KiCadMissing("KiCad's bundled python (pcbnew) not found; set ZCODE_KICAD_APP or ZCODE_KICAD_PCBNEW_PYTHON.")
    return p


def share_dir() -> Path:
    p = _first_existing(app_dir() / "Contents/SharedSupport", "/usr/share/kicad", "/usr/local/share/kicad")
    if not p:
        raise KiCadMissing("KiCad SharedSupport (libraries) not found.")
    return p


def symbols_dir() -> Path:
    return share_dir() / "symbols"


def footprints_dir() -> Path:
    return share_dir() / "footprints"


def models_dir() -> Path:
    return share_dir() / "3dmodels"


def kicad_available() -> bool:
    """True if kicad-cli, the bundled python and the libraries are all present."""
    try:
        kicad_cli(), kicad_python(), symbols_dir(), footprints_dir()
        return True
    except KiCadMissing:
        return False


def libraries_available() -> bool:
    """True if the official symbol/footprint libraries can be read (needs no executables)."""
    try:
        return symbols_dir().is_dir() and footprints_dir().is_dir()
    except KiCadMissing:
        return False


@lru_cache(maxsize=1)
def kicad_version() -> str:
    try:
        r = subprocess.run([str(kicad_cli()), "version"], capture_output=True, text=True, timeout=30)
        return r.stdout.strip() or "unknown"
    except Exception:  # noqa: BLE001
        return "unavailable"


def kicad_env() -> dict[str, str]:
    """Environment for kicad subprocesses: keep it hermetic (no user config/library tables needed)."""
    env = dict(os.environ)
    # Keep headless runs from touching the user's real KiCad config (~/Library/Preferences/kicad)
    if "KICAD_CONFIG_HOME" not in env:
        from .config import data_dir

        cfg = data_dir() / "kicad_config"
        cfg.mkdir(parents=True, exist_ok=True)
        env["KICAD_CONFIG_HOME"] = str(cfg)
    # KiCad also scans ~/Documents/KiCad at start-up. On macOS that folder is TCC-protected: when the process was spawned from a
    # context without Documents access (e.g. a preview/launcher), the open() blocks forever behind a permission prompt.
    # Point it at a private folder so a headless run never touches the user's Documents.
    if "KICAD_DOCUMENTS_HOME" not in env:
        from .config import data_dir

        docs = data_dir() / "kicad_docs"
        docs.mkdir(parents=True, exist_ok=True)
        env["KICAD_DOCUMENTS_HOME"] = str(docs)
    env.setdefault("KICAD10_FOOTPRINT_DIR", str(footprints_dir()))
    env.setdefault("KICAD10_SYMBOL_DIR", str(symbols_dir()))
    try:
        env.setdefault("KICAD10_3DMODEL_DIR", str(models_dir()))
    except KiCadMissing:
        pass
    return env
