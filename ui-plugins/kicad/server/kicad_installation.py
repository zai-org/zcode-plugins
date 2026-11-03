"""Deterministic discovery of an installed KiCad application.

The plugin supports the official and Huaqiu KiCad 10 distributions.  A user
can still select an exact ``KiCad.app`` path, but the default is intentionally
automatic: inspect the usual macOS application roots, identify each
distribution without starting it, and choose the newest installation matching
the requested edition.

This module only reads application metadata and directory names.  It never
starts KiCad or DSH and never changes an installation.
"""
from __future__ import annotations

import plistlib
import re
from pathlib import Path
from typing import Iterable


DEFAULT_APP = Path("/Applications/KiCad/KiCad.app")
EDITIONS = ("auto", "standard", "huaqiu")


def normalize_edition(value: str | None) -> str:
    normalized = (value or "auto").strip().lower()
    return {"official": "standard", "hq": "huaqiu", "": "auto"}.get(normalized, normalized)


def distribution(app: Path) -> str:
    root = Path(app) / "Contents/Resources/edge-headless"
    if (root / "dsh").is_dir() or (root / "dsh-plugins").is_dir():
        return "huaqiu"
    if Path(app).is_dir():
        return "official"
    return "missing"


def bundle_version(app: Path) -> str:
    try:
        with (Path(app) / "Contents/Info.plist").open("rb") as stream:
            info = plistlib.load(stream)
        return str(info.get("CFBundleShortVersionString") or info.get("CFBundleVersion") or "")
    except (OSError, ValueError, TypeError):
        return ""


def _version_key(version: str) -> tuple[int, ...]:
    numbers = tuple(int(part) for part in re.findall(r"\d+", version)[:4])
    return numbers or (0,)


def _default_roots() -> tuple[Path, ...]:
    return (Path("/Applications"), Path.home() / "Applications")


def _candidate_paths(roots: Iterable[Path]) -> list[Path]:
    found: list[Path] = []
    seen: set[Path] = set()
    for raw_root in roots:
        root = Path(raw_root).expanduser()
        direct = (root / "KiCad/KiCad.app", root / "KiCad.app")
        globbed: list[Path] = []
        if root.is_dir():
            for pattern in ("KiCad*/KiCad.app", "*KiCad*/KiCad.app", "*KiCad*.app"):
                try:
                    globbed.extend(root.glob(pattern))
                except OSError:
                    continue
        for app in (*direct, *globbed):
            try:
                key = app.resolve(strict=False)
            except OSError:
                key = app.absolute()
            if key in seen or not (app / "Contents/MacOS/kicad-cli").is_file():
                continue
            seen.add(key)
            found.append(app)
    return found


def _record(app: Path) -> dict[str, object]:
    return {
        "path": str(app),
        "version": bundle_version(app) or "unknown",
        "distribution": distribution(app),
        "cli_available": (app / "Contents/MacOS/kicad-cli").is_file(),
    }


def select_installation(
    explicit: str | Path | None = None,
    edition: str | None = None,
    *,
    roots: Iterable[Path] | None = None,
) -> dict[str, object]:
    """Select one KiCad.app and describe why it was selected.

    An explicit non-empty path always wins, including when it is missing; the
    capability report must show that exact configuration error instead of
    silently switching installations.  Automatic selection prefers the newest
    installation matching ``standard`` or ``huaqiu``.  With ``auto`` it picks
    the newest detected installation and resolves the edition from its layout.
    """
    requested = normalize_edition(edition)
    explicit_text = str(explicit).strip() if explicit is not None else ""
    if explicit_text:
        app = Path(explicit_text).expanduser()
        item = _record(app)
        return {
            "mode": "explicit",
            "reason": "user_config",
            "requested_edition": requested,
            "resolved_edition": "huaqiu" if item["distribution"] == "huaqiu" else "standard" if item["distribution"] == "official" else None,
            "selected": item,
            "candidates": [item] if app.is_dir() else [],
        }

    records = [_record(app) for app in _candidate_paths(roots or _default_roots())]
    records.sort(
        key=lambda item: (
            _version_key(str(item["version"])),
            bool(item["cli_available"]),
            str(item["path"]),
        ),
        reverse=True,
    )
    expected = {"standard": "official", "huaqiu": "huaqiu"}.get(requested)
    matching = [item for item in records if item["distribution"] == expected] if expected else []
    selected = ((matching if expected else records) or records or [_record(DEFAULT_APP)])[0]
    selected_distribution = str(selected["distribution"])
    resolved = "huaqiu" if selected_distribution == "huaqiu" else "standard" if selected_distribution == "official" else None
    reason = "newest_matching_installation" if expected and matching else "newest_detected_installation" if records else "default_path_not_found"
    return {
        "mode": "automatic",
        "reason": reason,
        "requested_edition": requested,
        "resolved_edition": resolved,
        "selected": selected,
        "candidates": records,
    }
