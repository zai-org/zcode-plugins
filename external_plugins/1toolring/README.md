# 1ToolRing

Pay-per-call access to thousands of tools from third-party providers through a single 1ToolRing key: web search, maps and places, shopping and prices, market data, web pages, images, weather, jobs and more. The price is shown before every call and failed calls are never charged.

| | |
|-|-|
| MCP endpoint | `https://mcp.1toolring.com/mcp` (Streamable HTTP) |
| Authentication | OAuth 2.1 sign-in when prompted, or an API key from https://app.1toolring.com/keys |
| Tools | `discover_tools` (free), `inspect_tool` (free), `run_tool` (paid), `get_tool_run` (free) |
| Docs | https://docs.1toolring.com/overview/ |
| Example queries | "Find a supplier price for a Raspberry Pi 5", "What is the weather in Pontianak tomorrow?", "Search the web for the latest GLM release notes" |

## Install

Install the plugin from the ZCode marketplace, then complete the OAuth sign-in when ZCode asks for it. To use a key instead, set the API key field in the plugin configuration (leave it empty to keep OAuth).

## What goes to the network

Every tool call is sent over HTTPS to `https://mcp.1toolring.com/mcp`. No credentials are stored in the plugin package; the API key you enter stays in the local ZCode configuration.

## Licence and provenance

Plugin wrapper by Khaisa Studio, MIT licensed. The hosted service is operated by Khaisa Studio: https://1toolring.com. Source and examples: https://github.com/khmuhtadin/1toolring-mcp.
