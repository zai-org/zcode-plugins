# Unreal Engine

[中文](README_CN.md)

A non-UI ZCode plugin connecting to a separately installed Unreal Editor through Epic's experimental Unreal MCP. Includes the official `unreal-mcp`, `create-toolset`, and `unreal-skill` skills, adapted for ZCode. No engine binaries, native proxy, or UI panel are bundled.

## Setup

1. Install a UE build that includes `ModelContextProtocol` and `AllToolsets` (documented for UE 5.8), then enable both in the intended project.
2. Ask the agent to open the intended project. The [startup guide](skills/unreal-mcp/references/startup.md) covers Windows, macOS, and Linux engine discovery, GUI launch, bounded readiness checks, and client reconnection. It uses the installed editor executable with `-ModelContextProtocolStartServer`; an already running editor can start the server through `ModelContextProtocol.StartServer` in its console.
3. Install and enable **Unreal Engine** in the ZCode plugin marketplace. The `endpoint` plugin setting defaults to `http://127.0.0.1:8000/mcp`; change it if your editor uses a different port. Do not add a duplicate project MCP connection.
4. Ask ZCode: “Use Unreal MCP to identify the connected project and list the scene actors without changing anything.” A successful read-only tool call verifies live access; a configured endpoint alone does not.

Use `unreal-mcp` for editor operations, `create-toolset` to expose new UE tools, and `unreal-skill` for UE project Agent Skills. See [setup](skills/unreal-mcp/references/setup.md) and [troubleshooting](skills/unreal-mcp/references/operations.md).

Startup may execute local or remote shell commands and update the selected project's plugin configuration, preserving unrelated settings. It does not install engines or compile C++ as an incidental connection repair. For quick smoke tests, use an isolated test map, inspect only relevant toolsets, and leave the editor open. The skill also covers short-name dispatch, explicit parameter defaults, and node-level Blueprint fallback when localized graph DSL fails.

## Connection and safety

The endpoint is resolved on the machine running the ZCode agent. In SSH/WSL/Docker workspaces, loopback points to that environment, not your desktop. UE MCP has no authentication by default: keep it on loopback or use an explicitly protected connection. Verify the project identity before edits when several editors are running. Save before bulk changes; not all MCP changes are undoable. The editor must be running and tool availability depends on enabled UE toolsets.

## Provenance

Skills originate from [EpicGames/unreal-engine-skills-for-claude-code-plugin](https://github.com/EpicGames/unreal-engine-skills-for-claude-code-plugin), pinned in [upstream.json](skills/upstream.json). MIT notices are retained in each skill directory. ZCode adapts connection/setup guidance; this package is maintained by Z.ai and does not imply Epic endorsement. Unreal Engine licensing remains separate. The marketplace icon is served from the plugin assets CDN.
