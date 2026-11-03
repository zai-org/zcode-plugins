"""Read-only KiCad installation and integration diagnostics.

The Huaqiu distribution keeps the normal KiCad.app layout and adds its DSH
runtime below ``Contents/Resources/edge-headless``. Detect that layout without
starting DSH: ZCode remains the only agent harness.
"""
from __future__ import annotations

import os
import plistlib
import subprocess
import sys
from pathlib import Path
from typing import Any

from huaqiu_part_search import adapter_paths


EDITIONS = ("auto", "standard", "huaqiu")
HUAQIU_REQUIRED_PLUGINS = (
    "@huaqiu/dsh-kicad",
    "@huaqiu/dsh-kicad-drc",
    "@huaqiu/dsh-tool-kicad-schematic-gen",
    "@huaqiu/dsh-tool-part-search",
    "@huaqiu/dsh-tool-symbol-footprint",
)


def _edition(value: str | None) -> str:
    normalized = (value or "auto").strip().lower()
    return {"official": "standard", "hq": "huaqiu", "": "auto"}.get(normalized, normalized)


def _dsh_plugins(app: Path) -> tuple[Path, list[str]]:
    root = app / "Contents/Resources/edge-headless/dsh-plugins"
    if not root.is_dir():
        return root, []
    names: list[str] = []
    try:
        for entry in root.iterdir():
            if not entry.is_dir():
                continue
            if entry.name.startswith("@"):
                names.extend(
                    f"{entry.name}/{child.name}"
                    for child in entry.iterdir()
                    if child.is_dir() and (child / "package.json").is_file()
                )
            elif (entry / "package.json").is_file():
                names.append(entry.name)
    except OSError:
        return root, []
    return root, sorted(names)


def _bundle_version(app: Path) -> str:
    try:
        with (app / "Contents/Info.plist").open("rb") as stream:
            info = plistlib.load(stream)
        return str(info.get("CFBundleShortVersionString") or info.get("CFBundleVersion") or "")
    except (OSError, ValueError, TypeError):
        return ""


def _python_can_import_pcbnew(python: Path | None) -> tuple[bool, str | None]:
    if python is None or not python.is_file():
        return False, "KiCad's bundled Python was not found"
    try:
        result = subprocess.run(
            [str(python), "-c", "import pcbnew"], capture_output=True, text=True, timeout=20
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return False, str(error)
    if result.returncode == 0:
        return True, None
    detail = " ".join((result.stderr or result.stdout).split())[:240]
    return False, detail or "the bundled Python cannot import pcbnew"


def inspect_installation(
    app: Path,
    *,
    cli: Path | None,
    version: str,
    python: Path | None,
    python_importable: bool | None = None,
    python_error: str | None = None,
    ipc: dict[str, Any] | None = None,
    requested_edition: str = "standard",
    selection: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return a stable report for the Standard and Huaqiu plugin editions."""
    app = Path(app)
    cli = Path(cli) if cli is not None else None
    python = Path(python) if python is not None else None
    share = app / "Contents/SharedSupport"
    library_paths = {
        "symbols": share / "symbols",
        "footprints": share / "footprints",
        "models_3d": share / "3dmodels",
    }
    library_available = {name: path.is_dir() for name, path in library_paths.items()}
    dsh_root, dsh_plugins = _dsh_plugins(app)
    dsh_runtime = app / "Contents/Resources/edge-headless/dsh"
    huaqiu_adapter_paths = adapter_paths(app)
    huaqiu_adapter_available = {
        name: path.is_file() for name, path in huaqiu_adapter_paths.items()
    }
    if not version or version == "unavailable":
        version = _bundle_version(app) or "unavailable"

    app_available = app.is_dir()
    cli_available = bool(cli and cli.is_file())
    if python_importable is None:
        python_importable, detected_error = _python_can_import_pcbnew(python)
        python_error = python_error or detected_error
    core_ready = bool(
        app_available
        and cli_available
        and python_importable
        and library_available["symbols"]
        and library_available["footprints"]
    )

    if dsh_plugins or dsh_runtime.is_dir():
        distribution = "huaqiu"
    elif app_available and cli_available:
        distribution = "official"
    elif app_available:
        distribution = "unknown"
    else:
        distribution = "missing"

    requested_edition = _edition(requested_edition)
    valid_edition = requested_edition in EDITIONS
    resolved_edition = (
        "huaqiu"
        if requested_edition == "auto" and distribution == "huaqiu"
        else "standard"
        if requested_edition == "auto" and distribution == "official"
        else requested_edition
        if requested_edition != "auto"
        else None
    )
    expected_distribution = {"standard": "official", "huaqiu": "huaqiu"}.get(resolved_edition)
    edition_mismatch = bool(
        core_ready
        and expected_distribution
        and distribution not in (expected_distribution, "unknown", "missing")
    )
    huaqiu_selected = resolved_edition == "huaqiu"
    required_dsh_plugins = list(HUAQIU_REQUIRED_PLUGINS) if huaqiu_selected else []
    missing_dsh_plugins = [name for name in required_dsh_plugins if name not in dsh_plugins]

    ipc = dict(ipc or {})
    live_available = bool(ipc.get("available"))
    missing: list[dict[str, Any]] = []
    if not app_available:
        missing.append({"id": "kicad_app", "optional": False, "reason": f"KiCad.app not found at {app}"})
    if not cli_available:
        missing.append({"id": "kicad_cli", "optional": False, "reason": "kicad-cli was not found"})
    for name in ("symbols", "footprints"):
        if not library_available[name]:
            missing.append({"id": f"kicad_{name}", "optional": False, "reason": f"KiCad {name} library was not found"})
    if not python_importable:
        missing.append({"id": "pcbnew_python", "optional": False, "reason": python_error or "Python cannot import pcbnew"})
    if ipc.get("kipy") is False:
        missing.append({"id": "kicad_python", "optional": True, "reason": ipc.get("reason") or "live KiCad API client is unavailable"})
    if not valid_edition:
        missing.append(
            {
                "id": "kicad_edition",
                "optional": False,
                "reason": f"Unknown edition '{requested_edition}'; choose standard or huaqiu",
            }
        )
    elif edition_mismatch:
        missing.append(
            {
                "id": "kicad_edition_mismatch",
                "optional": False,
                "reason": f"The {requested_edition} edition expects {expected_distribution} KiCad, but detected {distribution}",
            }
        )
    if requested_edition == "auto" and resolved_edition is None:
        missing.append(
            {
                "id": "kicad_edition_auto_detection",
                "optional": False,
                "reason": "No official or Huaqiu KiCad installation could be identified",
            }
        )
    if huaqiu_selected and not dsh_runtime.is_dir():
        missing.append(
            {
                "id": "huaqiu_dsh_runtime",
                "optional": False,
                "reason": "The Huaqiu DSH runtime was not found in this KiCad.app",
            }
        )
    if huaqiu_selected and missing_dsh_plugins:
        missing.append(
            {
                "id": "huaqiu_dsh_plugins",
                "optional": False,
                "reason": "Required Huaqiu KiCad components are missing",
                "missing": missing_dsh_plugins,
            }
        )
    if huaqiu_selected and not huaqiu_adapter_available["node"]:
        missing.append(
            {
                "id": "huaqiu_node",
                "optional": False,
                "reason": "Huaqiu KiCad's bundled Node.js runtime was not found",
            }
        )
    if huaqiu_selected and not huaqiu_adapter_available["library"]:
        missing.append(
            {
                "id": "huaqiu_part_search_library",
                "optional": False,
                "reason": "Huaqiu KiCad's @huaqiu/part-search library was not found",
            }
        )
    if huaqiu_selected and not huaqiu_adapter_available["bridge"]:
        missing.append(
            {
                "id": "huaqiu_part_search_bridge",
                "optional": False,
                "reason": "The ZCode Huaqiu part-search bridge is missing from the plugin installation",
            }
        )

    edition_ready = bool(
        valid_edition
        and resolved_edition in ("standard", "huaqiu")
        and core_ready
        and not edition_mismatch
        and (
            not huaqiu_selected
            or (
                dsh_runtime.is_dir()
                and not missing_dsh_plugins
                and huaqiu_adapter_available["node"]
                and huaqiu_adapter_available["library"]
                and huaqiu_adapter_available["bridge"]
            )
        )
    )

    available_tools = [
        "kicad_board_view",
        "kicad_capabilities",
        "kicad_export_files",
        "kicad_info",
        "kicad_live_status",
        "kicad_sync_edits",
        "pcb_spec_example",
    ]
    if library_available["symbols"] and library_available["footprints"]:
        available_tools.extend(["kicad_check_spec_file", "pcb_check_spec", "pcb_part_info", "pcb_search_parts"])
    if cli_available:
        available_tools.extend(
            [
                "kicad_3d_image",
                "kicad_board_image",
                "kicad_checks",
                "kicad_layer_svg",
                "kicad_layers",
                "kicad_library_preview",
                "kicad_schematic",
                "pcb_export_fab",
                "pcb_export_glb",
                "pcb_render",
            ]
        )
    if core_ready:
        available_tools.extend(["kicad_open_in_kicad", "pcb_build"])
    if live_available:
        available_tools.extend(["kicad_live_status", "kicad_live_snapshot", "kicad_live_move_footprint"])
    if huaqiu_selected and edition_ready:
        available_tools.extend(
            [
                "get_hqsch_part",
                "get_hqsch_part_models",
                "get_hqsch_supply_chain",
                "compare_hqsch_models_with_kicad",
                "resolve_hqsch_part_for_kicad",
                "search_hqsch_parts",
            ]
        )

    return {
        "ok": True,
        "core_ready": core_ready,
        "edition_ready": edition_ready,
        "requested_edition": requested_edition,
        "resolved_edition": resolved_edition,
        "edition_mismatch": edition_mismatch,
        "distribution": distribution,
        "version": version or "unavailable",
        "application": {
            "available": app_available,
            "path": str(app),
            "selection": selection,
        },
        "cli": {"available": cli_available, "path": str(cli) if cli else None, "version": version or "unavailable"},
        "python": {
            "available": bool(python and python.is_file()),
            "path": str(python) if python else None,
            "pcbnew_importable": bool(python_importable),
            "error": None if python_importable else python_error,
        },
        "libraries": {
            "available": library_available["symbols"] and library_available["footprints"],
            "root": str(share),
            **library_available,
        },
        "ipc": {
            "available": live_available,
            "reachable": bool(ipc.get("reachable")),
            "client_available": ipc.get("kipy") is not False,
            "api_enabled_in_preferences": ipc.get("api_enabled_in_preferences"),
            "reason": ipc.get("reason"),
        },
        "dsh": {
            "bundled": bool(dsh_plugins or dsh_runtime.is_dir()),
            "runtime_path": str(dsh_runtime) if dsh_runtime.is_dir() else None,
            "plugins_path": str(dsh_root) if dsh_root.is_dir() else None,
            "plugins": dsh_plugins,
            "exposed_to_zcode": False,
            "note": "Detected only; ZCode does not start the bundled DSH harness.",
        },
        "huaqiu_native_adapter": {
            "available": all(huaqiu_adapter_available.values()),
            "node_path": str(huaqiu_adapter_paths["node"]),
            "part_search_library_path": str(huaqiu_adapter_paths["library"]),
            "components": huaqiu_adapter_available,
            "network_origin": "https://kiapi.eda.cn",
            "authentication_required": False,
            "starts_dsh": False,
            "tools": [
                "search_hqsch_parts",
                "get_hqsch_part",
                "get_hqsch_part_models",
                "get_hqsch_supply_chain",
                "compare_hqsch_models_with_kicad",
                "resolve_hqsch_part_for_kicad",
            ],
        },
        "edition": {
            "name": resolved_edition,
            "requested": requested_edition,
            "automatic": requested_edition == "auto",
            "valid": valid_edition,
            "ready": edition_ready,
            "expected_distribution": expected_distribution,
            "detected_distribution": distribution,
            "required_dsh_plugins": required_dsh_plugins,
            "missing_dsh_plugins": missing_dsh_plugins,
        },
        "available_tools": sorted(set(available_tools)),
        "missing_dependencies": missing,
    }


def detect(
    paths_module: Any,
    ipc: dict[str, Any] | None = None,
    edition: str | None = None,
) -> dict[str, Any]:
    """Collect paths safely, then delegate to :func:`inspect_installation`."""
    app = Path(paths_module.app_dir())
    try:
        selection = dict(paths_module.installation_selection())
    except (AttributeError, TypeError, ValueError):
        selection = None
    try:
        cli = Path(paths_module.kicad_cli())
    except Exception:  # noqa: BLE001 - diagnostics must survive incomplete installs
        cli = None
    try:
        python = Path(paths_module.kicad_python())
    except Exception:  # noqa: BLE001
        python = None
    try:
        version = str(paths_module.kicad_version())
    except Exception:  # noqa: BLE001
        version = "unavailable"
    return inspect_installation(
        app,
        cli=cli,
        version=version,
        python=python,
        ipc=ipc,
        requested_edition=edition or os.environ.get("ZCODE_KICAD_EDITION") or "auto",
        selection=selection,
    )


if __name__ == "__main__":
    import json
    from kicad import paths

    json.dump(detect(paths), sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
