# QVeris

[中文文档](./README_CN.md)

QVeris gives ZCode access to external APIs and live data through a small MCP workflow: discover a capability, inspect its contract, optionally validate parameters and pricing, then call it.

## Quick start

1. Create an API key in the [QVeris Dashboard](https://qveris.ai).
2. Make `QVERIS_API_KEY` available to the ZCode desktop process, then fully restart ZCode.
3. Install and enable **QVeris** from the ZCode official plugin marketplace.
4. Open **Settings → MCP** and confirm the plugin-bundled `qveris` server is connected.
5. Start a new task and ask for a live or specialized capability, for example: “Find a weather capability and get the current weather in Tokyo.”

The API key must not be added to this repository or pasted into prompts. ZCode currently cannot accept sensitive plugin settings directly in the plugin UI, so this plugin reads `QVERIS_API_KEY` from the environment inherited by the ZCode process.

### Environment examples

macOS, before reopening ZCode:

```shell
launchctl setenv QVERIS_API_KEY "your-api-key"
```

Windows PowerShell, then sign out or restart ZCode:

```powershell
setx QVERIS_API_KEY "your-api-key"
```

On Linux, define `QVERIS_API_KEY` in the environment used by your desktop launcher or start ZCode from a shell that exports it.

## What the plugin installs

- The official `@qverisai/mcp` package, pinned to version `0.14.0` and launched through `npx`.
- A QVeris skill that guides the Agent through `discover` → `inspect` → `probe` → `call`, with billing and side-effect safeguards.

The MCP server exposes capability discovery, inspection, validation, execution, usage audit, and credits-ledger tools. ZCode namespaces the server as a plugin MCP server.

## Requirements and network access

- Node.js `18.2` or later and `npx` must be available to ZCode.
- The first start downloads `@qverisai/mcp@0.14.0` from the npm registry and executes it locally.
- The MCP package connects to QVeris services over HTTPS. Selected third-party providers may receive the parameters required to execute the capability.
- A valid QVeris account and API key are required. Some `call` operations consume QVeris credits.

## Side effects and data handling

`discover`, `inspect`, and `probe` are read-only discovery or validation operations. A selected `call` can consume credits or cause provider-side effects such as sending a message, placing an order, or changing a remote record. The bundled skill requires confirmation when that effect was not already authorized by the user's request.

The plugin ships no Hooks and does not write files itself. The upstream MCP package may write JSONL exports under the current workspace's `.qveris/exports/` directory only when an export mode is explicitly requested. Review the selected capability before sending confidential or personal data.

## Troubleshooting

- **Invalid session credential / 0 tools**: verify that `QVERIS_API_KEY` contains a real key rather than a placeholder, then fully restart ZCode.
- **`npx` not found**: install Node.js `18.2+` and restart ZCode so the desktop process sees the updated `PATH`.
- **Server startup timeout**: confirm access to the npm registry and QVeris HTTPS endpoints, then disable and re-enable the plugin.
- **Key was rotated**: update `QVERIS_API_KEY` and start a new ZCode task so the MCP session is recreated.

## Provenance and licenses

This plugin's marketplace files are distributed under the repository's Apache-2.0 license. It launches the official [`@qverisai/mcp`](https://www.npmjs.com/package/@qverisai/mcp) package from the [`QVerisAI/qveris-agent-toolkit`](https://github.com/QVerisAI/qveris-agent-toolkit) repository, which is licensed under MIT. No third-party binaries or credentials are vendored in this plugin.
