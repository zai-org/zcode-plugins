"""Import a heavy optional dependency on first use instead of at module load.

The MCP server imports every tool module to list its tools; a missing numpy or
Pillow must fail only the tools that use it, not the whole server.
"""
from __future__ import annotations

import importlib
from types import ModuleType


class LazyModule:
    def __init__(self, name: str) -> None:
        self._name = name
        self._module: ModuleType | None = None

    def __getattr__(self, attr: str):
        if self._module is None:
            self._module = importlib.import_module(self._name)
        return getattr(self._module, attr)


def lazy_module(name: str) -> LazyModule:
    return LazyModule(name)
