"""Path bootstrap shared by the command-line entrypoints in this directory.

Running ``python3 recap/<script>.py`` puts ``recap/`` itself first on sys.path;
replace it with the plugin root so modules are only ever imported as
``recap.<name>`` (one module identity) and ``ve_tools`` resolves via the package.
"""
from __future__ import annotations

import sys
from pathlib import Path


def bootstrap() -> None:
    package_dir = Path(__file__).resolve().parent
    plugin_root = str(package_dir.parent)
    sys.path[:] = [p for p in sys.path if Path(p or '.').resolve() != package_dir]
    if plugin_root not in sys.path:
        sys.path.insert(0, plugin_root)
    import recap  # noqa: F401  (adds mcp/ to sys.path)
