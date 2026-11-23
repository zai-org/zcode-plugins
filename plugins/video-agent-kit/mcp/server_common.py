from __future__ import annotations

import asyncio
import base64
import json
import logging
import sys
from typing import Callable
from pathlib import Path

import mcp.types as types
from mcp.server import Server
from mcp.server.stdio import stdio_server

from ve_tools.official_auth import read_official_auth
from ve_tools.result import ToolResult
from ve_tools.run_context import RunContext, clean_env

log = logging.getLogger(__name__)


def result_to_content(result: ToolResult | str, ctx: RunContext | None = None) -> list:
    return result_to_mcp(result, ctx).content


def result_to_mcp(result: ToolResult | str, ctx: RunContext | None = None) -> types.CallToolResult:
    if isinstance(result, str):
        result = ToolResult(text=result)
    structured = result.to_dict()
    content = []
    returned, omitted, failed = [], [], []
    try:
        max_images = max(0, int(clean_env("VE_MAX_INLINE_IMAGES") or "64"))
        max_bytes = max(0, int(clean_env("VE_MAX_INLINE_IMAGE_BYTES") or str(16 * 1024 * 1024)))
    except ValueError:
        max_images, max_bytes = 64, 16 * 1024 * 1024
    from PIL import Image
    used_bytes = 0
    # 交付类型以实际解码出的格式为准, 不看扩展名: 内容是 PNG 的 .gif/.bmp 照常返回,
    # 扩展名是 .png 但内容非法/不受支持的照样判失败
    deliverable = {"image/jpeg", "image/png", "image/webp"}
    for path in result.image_paths:
        resolved = ctx.resolve(path) if ctx else Path(path).resolve()
        try:
            size = resolved.stat().st_size
            if len(returned) >= max_images or used_bytes + size > max_bytes:
                omitted.append({"path": str(resolved), "reason": "image return budget"})
                continue
            raw = resolved.read_bytes()
            import io
            from PIL import Image
            with Image.open(io.BytesIO(raw)) as decoded:
                actual_mime = Image.MIME.get(decoded.format)
                decoded.verify()
            with Image.open(io.BytesIO(raw)) as decoded:
                decoded.load()
            if actual_mime not in deliverable:
                raise ValueError('unsupported decoded image type')
        except Exception as exc:  # unreadable or malformed image data is failed delivery
            failed.append({"path": str(resolved), "reason": str(exc)})
            continue
        if len(raw) + used_bytes > max_bytes:
            omitted.append({"path": str(resolved), "reason": "image return budget"})
            continue
        content.append(types.ImageContent(type="image", data=base64.b64encode(raw).decode("ascii"),
                                          mimeType=actual_mime))
        returned.append(str(resolved))
        used_bytes += len(raw)
    structured["image_delivery_status"] = "partial" if failed or omitted else "complete"
    structured["image_delivery"] = {"returned": returned, "omitted": omitted, "failed": failed}
    is_error = result.failed or bool(result.image_paths and not returned and failed and not omitted)
    if is_error:
        structured["status"] = "error"
    summary = result.text
    if omitted or failed:
        summary += "\nSome images were not returned. Read image_delivery and use the available image-viewing tools for remaining paths."
    payload = summary + "\n\n" + json.dumps(structured, ensure_ascii=False)
    return types.CallToolResult(content=[types.TextContent(type="text", text=payload), *content],
                                structuredContent=structured, isError=is_error)


def serve(server_name: str, schemas: dict[str, dict], impls: dict[str, Callable], ctx: RunContext) -> None:
    logging.basicConfig(level=logging.INFO, stream=sys.stderr, format=f"[{server_name}] %(levelname)s %(message)s")
    async def list_tools() -> list[types.Tool]:
        return [
            types.Tool(name=name, description=schema["description"], inputSchema=schema["inputSchema"])
            for name, schema in schemas.items()
        ]

    async def call_tool(name: str, arguments: dict, official_auth=None):
        fn = impls.get(name)
        if fn is None:
            return result_to_mcp(ToolResult(text=f"[ERROR] Unknown tool: {name}"), ctx)
        if arguments is None:
            tool_args = {}
        elif isinstance(arguments, dict):
            tool_args = arguments
        else:
            return result_to_mcp(ToolResult(text="[ERROR] tool arguments must be a JSON object"), ctx)

        from ve_tools import jobs
        try:
            import jsonschema
            try:
                jsonschema.validate(tool_args, schemas[name]['inputSchema'])
            except jsonschema.ValidationError as exc:
                raise ValueError(jobs._schema_error(exc)) from None
            from ve_tools.catalog import TOOLS, BUSINESS_SCHEMAS
            business_schema = BUSINESS_SCHEMAS[name]['inputSchema'] if fn is TOOLS.get(name) else schemas[name]['inputSchema']
            return result_to_mcp(await jobs.call(name, tool_args, ctx, fn, business_schema,
                                                  official_auth=official_auth), ctx)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.error("Tool %s failed: %s", name, exc)
            return result_to_mcp(ToolResult(text=f"[ERROR] tool {name} failed: {exc}"), ctx)

    # mcp>=1.22 switched lowlevel Server registration from decorator methods to
    # constructor callbacks. Keep the older decorator path for pinned installs.
    server = Server(server_name)
    if hasattr(server, "list_tools") and hasattr(server, "call_tool"):
        # The ZCode identity of this call is read here, on the event-loop thread: the
        # request context is a contextvar and does not reach worker threads.
        async def call_tool_entry(name: str, arguments: dict):
            return await call_tool(name, arguments, read_official_auth(server=server))

        server.list_tools()(list_tools)
        server.call_tool()(call_tool_entry)
    else:
        async def on_list_tools(_request_context, _params):
            return types.ListToolsResult(tools=await list_tools())

        async def on_call_tool(request_context, params):
            name = params.get("name") if isinstance(params, dict) else getattr(params, "name", None)
            arguments = (
                params.get("arguments") if isinstance(params, dict)
                else getattr(params, "arguments", None)
            )
            return await call_tool(name, arguments,
                                   read_official_auth(request_context=request_context, params=params))

        server = Server(
            server_name,
            on_list_tools=on_list_tools,
            on_call_tool=on_call_tool,
        )

    async def _main() -> None:
        async with stdio_server() as (read, write):
            await server.run(read, write, server.create_initialization_options())

    asyncio.run(_main())
