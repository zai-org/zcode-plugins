"""ZCode-native adapter for the public Huaqiu part database.

The Huaqiu KiCad distribution bundles the Apache-2.0
``@huaqiu/part-search`` library.  We call that library in a short-lived child
process and do not start DSH, load DSH skills, or hand control to another
agent harness.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any, Callable


HUAQIU_NODE_RELATIVE = Path("Contents/Resources/edge-headless/bin/node")
HUAQIU_PART_SEARCH_RELATIVE = Path(
    "Contents/Resources/edge-headless/dsh-plugins/@huaqiu/node_modules/"
    "@huaqiu/part-search/dist/esm/index.js"
)
OPERATIONS = frozenset({"search", "detail", "models", "supply"})
MAX_SUPPLY_PARTS = 50


def adapter_paths(app: Path) -> dict[str, Path]:
    app = Path(app)
    return {
        "node": app / HUAQIU_NODE_RELATIVE,
        "library": app / HUAQIU_PART_SEARCH_RELATIVE,
        "bridge": Path(__file__).with_name("huaqiu_part_search_bridge.mjs"),
    }


def _error(message: str, code: str, **extra: Any) -> dict[str, Any]:
    return {"ok": False, "error": message, "code": code, **extra}


def _text(value: Any, field: str, *, maximum: int = 200) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty string")
    value = value.strip()
    if len(value) > maximum:
        raise ValueError(f"{field} is too long ({len(value)} > {maximum})")
    return value


def _language(value: Any) -> str:
    if value not in ("zh", "en"):
        raise ValueError("language must be 'zh' or 'en'")
    return str(value)


def search_arguments(
    query: Any,
    *,
    page: Any = 1,
    page_size: Any = 10,
    require_eda_model: Any = True,
    requirements: Any = None,
    language: Any = "zh",
) -> dict[str, Any]:
    query = _text(query, "query")
    if isinstance(page, bool) or not isinstance(page, int) or page < 1:
        raise ValueError("page must be an integer >= 1")
    if isinstance(page_size, bool) or not isinstance(page_size, int) or not 1 <= page_size <= 50:
        raise ValueError("page_size must be an integer from 1 to 50")
    if not isinstance(require_eda_model, bool):
        raise ValueError("require_eda_model must be a boolean")
    if requirements is None:
        requirements = {}
    if not isinstance(requirements, dict):
        raise ValueError("requirements must be an object")
    allowed = {"symbol", "footprint", "model3d", "simulation", "supplier"}
    unknown = sorted(set(requirements) - allowed)
    if unknown:
        raise ValueError(f"unknown requirements: {', '.join(unknown)}")
    if any(not isinstance(value, bool) for value in requirements.values()):
        raise ValueError("every requirements value must be a boolean")
    return {
        "query": query,
        "page": page,
        "pageSize": page_size,
        "requireEdaModel": require_eda_model,
        "requirements": dict(requirements),
        "language": _language(language),
    }


def part_arguments(manufacturer_id: Any, mpn: Any, *, language: Any = "zh") -> dict[str, Any]:
    return {
        "manufacturerId": _text(manufacturer_id, "manufacturer_id"),
        "mpn": _text(mpn, "mpn"),
        "language": _language(language),
    }


def supply_arguments(parts: Any) -> dict[str, Any]:
    if not isinstance(parts, list) or not parts:
        raise ValueError("parts must be a non-empty array")
    if len(parts) > MAX_SUPPLY_PARTS:
        raise ValueError(f"parts has too many entries ({len(parts)} > {MAX_SUPPLY_PARTS})")
    normalized = []
    for index, part in enumerate(parts):
        if not isinstance(part, dict):
            raise ValueError(f"parts[{index}] must be an object")
        unknown = sorted(set(part) - {"manufacturer_id", "mpn"})
        if unknown:
            raise ValueError(f"parts[{index}] has unknown fields: {', '.join(unknown)}")
        normalized.append(
            {
                "manufacturerId": _text(part.get("manufacturer_id"), f"parts[{index}].manufacturer_id"),
                "mpn": _text(part.get("mpn"), f"parts[{index}].mpn"),
            }
        )
    return {"parts": normalized}


def execute(
    operation: str,
    arguments: dict[str, Any],
    *,
    app: Path,
    edition: str | None = None,
    timeout: float = 35,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> dict[str, Any]:
    """Execute one fixed operation through Huaqiu's bundled normalized client."""
    if operation not in OPERATIONS:
        return _error("Unsupported Huaqiu part-search operation", "invalid_operation")
    selected = (edition or os.environ.get("ZCODE_KICAD_EDITION") or "auto").strip().lower()
    selected = {"hq": "huaqiu", "official": "standard", "": "auto"}.get(selected, selected)
    if selected == "auto":
        root = Path(app) / "Contents/Resources/edge-headless"
        selected = "huaqiu" if (root / "dsh").is_dir() or (root / "dsh-plugins").is_dir() else "standard"
    if selected != "huaqiu":
        return _error(
            "Huaqiu part search requires the huaqiu plugin edition",
            "huaqiu_edition_required",
            requested_edition=selected,
        )
    locations = adapter_paths(Path(app))
    missing = [name for name, path in locations.items() if not path.is_file()]
    if missing:
        return _error(
            "The selected Huaqiu KiCad installation is missing its native part-search adapter",
            "huaqiu_part_search_unavailable",
            missing=missing,
        )
    try:
        completed = runner(
            [str(locations["node"]), str(locations["bridge"]), str(locations["library"])],
            input=json.dumps({"operation": operation, "arguments": arguments}, ensure_ascii=False),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return _error("Huaqiu part search timed out", "huaqiu_part_search_timeout")
    except OSError as error:
        return _error(f"Could not start Huaqiu part search: {error}", "huaqiu_part_search_start_failed")
    try:
        response = json.loads((completed.stdout or "").strip())
    except (json.JSONDecodeError, TypeError):
        detail = " ".join((completed.stderr or completed.stdout or "").split())[:500]
        return _error(
            "Huaqiu part search returned an invalid response",
            "huaqiu_part_search_invalid_response",
            detail=detail or None,
        )
    if completed.returncode != 0 or not response.get("ok"):
        remote = response.get("error") if isinstance(response, dict) else None
        message = remote.get("message") if isinstance(remote, dict) else None
        return _error(
            str(message or "Huaqiu part search failed")[:1000],
            "huaqiu_part_search_failed",
            upstream=remote if isinstance(remote, dict) else None,
        )
    return {
        "ok": True,
        "error": None,
        "edition": "huaqiu",
        "source": "Huaqiu public part database",
        "operation": operation,
        "result": response.get("result"),
    }
