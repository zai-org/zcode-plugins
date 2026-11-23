#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
MCP_ROOT = PLUGIN_ROOT / "mcp"
sys.path.insert(0, str(MCP_ROOT))

from ve_tools.catalog import TOOLS  # noqa: E402
from ve_tools.run_context import RunContext  # noqa: E402
from ve_tools.result import ToolResult  # noqa: E402


class ArgumentParseError(Exception):
    pass


class StructuredArgumentParser(argparse.ArgumentParser):
    """argparse 阶段的错误 (未知工具名、缺参数) 默认打 usage 并 exit 2;
    改为抛出, 由 main 与其它错误一样输出 status=error 的 JSON 并 exit 1。"""

    def error(self, message: str) -> None:  # type: ignore[override]
        raise ArgumentParseError(message)


def emit(result: ToolResult, pretty: bool) -> None:
    payload = result.to_dict()
    if pretty:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(json.dumps(payload, ensure_ascii=False))
    if result.failed:
        raise SystemExit(1)


def main() -> None:
    # allow_abbrev=False: 工具参数用 --<name> 直传, 前缀缩写会把 --pre 吞成 --pretty、
    # 把 --args 判成 ambiguous (第四轮实测)
    parser = StructuredArgumentParser(description="Run video-agent-kit tools without starting the MCP server.",
                                      allow_abbrev=False)
    parser.add_argument("tool", choices=sorted(TOOLS))
    parser.add_argument("--args-json", help="JSON object passed directly to the tool.")
    parser.add_argument("--args-file", help="Path to a JSON file containing tool arguments.")
    parser.add_argument("--project-dir", help="Project directory used for relative paths and outputs.")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print the structured result.")
    try:
        known, unknown = parser.parse_known_args()
    except ArgumentParseError as exc:
        emit(ToolResult(text=f"[ERROR] invalid arguments: {exc}",
                        data={"usage": parser.format_usage().strip()}, is_error=True),
             "--pretty" in sys.argv[1:])
        return

    if known.project_dir:
        import os

        resolved = str(Path(known.project_dir).resolve())
        os.environ["VE_PROJECT_DIR"] = resolved

    try:
        args = load_args(known.args_json, known.args_file)
        args.update(parse_unknown_flags(unknown, string_arguments(known.tool)))
        from ve_tools import jobs
        ctx = RunContext()
        business = jobs.validate_arguments(known.tool, args)
        if args.get("job_action") in {"list", "status", "cancel"}:
            result = jobs.control(known.tool, args, ctx)
        elif args.get("job_action") == "submit":
            # A job thread would die with this one-shot process: run the call to completion.
            result = jobs.run_inline(known.tool, {k: v for k, v in args.items() if k != "job_action"}, ctx)
        else:
            result = TOOLS[known.tool](business, ctx)
    except (Exception, SystemExit) as exc:
        result = ToolResult(text=f"[ERROR] tool {known.tool} failed: {exc}", is_error=True)
    if result.failed and _needs_identity(result):
        # ZCode services (ASR, TTS, image/video/3D generation) need the signed-in account,
        # which only MCP tool calls carry: say which MCP call replaces this command.
        handoff = (result.data or {}).get("handoff") or {"mcp_tool": known.tool, "arguments": locals().get("business", {})}
        result.data = {**(result.data or {}), "handoff": handoff,
                       "next": f"call the MCP tool {handoff['mcp_tool']} with handoff.arguments instead of this command"}
    emit(result, known.pretty)


def _needs_identity(result: ToolResult) -> bool:
    from ve_tools import toolhub
    if not toolhub.identity_missing():
        return False
    blob = json.dumps({"text": result.text, "data": result.data}, ensure_ascii=False, default=str)
    return "handoff" in (result.data or {}) or "no ZCode identity" in blob


def load_args(args_json: str | None, args_file: str | None) -> dict:
    if args_json and args_file:
        raise SystemExit("Use --args-json or --args-file, not both.")
    if args_file:
        try:
            value = json.loads(Path(args_file).read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise SystemExit(f"--args-file must contain valid JSON: {exc}") from None
        return require_json_object(value, "--args-file")
    if args_json:
        try:
            value = json.loads(args_json)
        except json.JSONDecodeError as exc:
            raise SystemExit(f"--args-json must be valid JSON: {exc}") from None
        return require_json_object(value, "--args-json")
    return {}


def require_json_object(value: object, source: str) -> dict:
    if not isinstance(value, dict):
        raise SystemExit(f"{source} must contain a JSON object.")
    return value


# Flags whose values are always strings (paths, free text); never type-coerced
# so inputs like --video-path 002 keep their literal spelling.
STRING_FLAG_SUFFIXES = ("path", "dir", "file", "json", "text", "prompt")

CANONICAL_INT_RE = re.compile(r"-?(?:0|[1-9]\d*)")
CANONICAL_FLOAT_RE = re.compile(r"-?(?:0|[1-9]\d*)\.\d+")


def string_arguments(tool: str) -> frozenset[str]:
    """Arguments the tool schema declares as plain strings: --query 2024 or an all-digit
    --job-id must stay text instead of being coerced to a number and then rejected."""
    from ve_tools.catalog import BUSINESS_SCHEMAS

    properties = BUSINESS_SCHEMAS.get(tool, {}).get("inputSchema", {}).get("properties", {})
    names = {name for name, schema in properties.items()
             if isinstance(schema, dict) and schema.get("type") == "string"}
    return frozenset(names | {"job_id", "job_action"})


def parse_unknown_flags(items: list[str], string_names: frozenset[str] = frozenset()) -> dict:
    parsed: dict[str, object] = {}

    def keep_text(name: str) -> bool:
        return name in string_names or name.endswith(STRING_FLAG_SUFFIXES)

    idx = 0
    while idx < len(items):
        key = items[idx]
        if not key.startswith("--"):
            raise SystemExit(f"Unexpected argument: {key}")
        body = key[2:]
        if "=" in body:
            # --flag=value 形式: 不拆开会被解析成布尔键 "flag=value", 参数静默丢失
            name, raw = body.split("=", 1)
            name = name.replace("-", "_")
            parsed[name] = raw if keep_text(name) else coerce_value(raw)
            idx += 1
            continue
        name = body.replace("-", "_")
        if idx + 1 >= len(items) or items[idx + 1].startswith("--"):
            parsed[name] = True
            idx += 1
            continue
        raw = items[idx + 1]
        parsed[name] = raw if keep_text(name) else coerce_value(raw)
        idx += 2
    return parsed


def coerce_value(value: str) -> object:
    if value in {"true", "false"}:
        return value == "true"
    stripped = value.strip()
    if stripped.startswith(("{", "[")) or stripped == "null":
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            return value
    # Only coerce canonical numeric spellings so values like "002" survive as
    # strings instead of collapsing to 2.
    if CANONICAL_INT_RE.fullmatch(value):
        return int(value)
    if CANONICAL_FLOAT_RE.fullmatch(value):
        return float(value)
    return value


if __name__ == "__main__":
    main()
