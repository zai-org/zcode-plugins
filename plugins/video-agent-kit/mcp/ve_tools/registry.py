"""Combine reviewed tool groups without silently replacing a tool."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from .result import ToolResult
from .run_context import RunContext


ToolHandler = Callable[[dict, RunContext], ToolResult]


@dataclass(frozen=True)
class ToolGroup:
    name: str
    schemas: dict[str, dict]
    implementations: dict[str, ToolHandler]


def merge_tool_groups(*groups: ToolGroup) -> tuple[dict[str, dict], dict[str, ToolHandler]]:
    schemas: dict[str, dict] = {}
    implementations: dict[str, ToolHandler] = {}
    owners: dict[str, str] = {}
    for group in groups:
        if set(group.schemas) != set(group.implementations):
            missing = sorted(set(group.schemas) - set(group.implementations))
            undocumented = sorted(set(group.implementations) - set(group.schemas))
            raise ValueError(
                f"Tool group {group.name!r}: missing implementations {missing}; "
                f"missing schemas {undocumented}"
            )
        for name, schema in group.schemas.items():
            if name in owners:
                raise ValueError(
                    f"Duplicate tool {name!r} in groups {owners[name]!r} and {group.name!r}; "
                    "resolve the overlap before registering both groups"
                )
            if not callable(group.implementations[name]):
                raise ValueError(f"Tool {name!r} in group {group.name!r} has no callable implementation")
            owners[name] = group.name
            schemas[name] = schema
            implementations[name] = group.implementations[name]
    return schemas, implementations
