---
name: 1toolring-tools
description: Call pay-per-call third-party tools through 1ToolRing: discover a tool, inspect its price and schema, run it, then read the result.
---

# 1ToolRing tools

Use this skill when the user needs live data or an action that a generic web page cannot answer reliably: web search results, places and maps, product prices, stock/crypto/FX quotes, page scraping, jobs, weather, images, or AI media generation.

## How the tools work

The `1toolring` MCP server exposes four tools:

| Tool | Cost | Use it for |
|-|-|-|
| `discover_tools` | free | Search the catalog. Send a short intent, for example `search`, `price`, `crypto`, `weather`, `places`. |
| `inspect_tool` | free | Read one tool's input schema and the exact price of the next call. |
| `run_tool` | paid | Execute the tool with arguments that match the schema. |
| `get_tool_run` | free | Re-read a run by id when a call is slow or you need the payload again. |

## Working rules

1. Always `discover_tools` first, then `inspect_tool` for the candidate before spending.
2. Tell the user the price from `inspect_tool` when a run costs more than a trivial amount, and let them choose between cheaper and richer tools.
3. Keep arguments minimal and match the schema exactly; a rejected call wastes a round trip.
4. Never invent numbers. If the run returns nothing usable, say so plainly instead of guessing.
5. Balance and top-ups live at https://1toolring.com/pricing; the balance is shown in the API error when it runs out.
