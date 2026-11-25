# BugX

Autonomous code review and testing agent for ZCode. Provides dedicated audit agents, ZCode workflow skills, and an MCP server bridge to catch bugs and verify stability.

## Components

- **Agents (`agents/`)**: `bugx` (audit coordinator) and `bugx-worker` (parallel audit worker).
- **Skills (`skills/`)**: `bugx` and `bugx-zcode` audit workflow skills.
- **MCP Server (`.mcp.json`)**: Connects ZCode to `bugx mcp serve --root ${ZCODE_PROJECT_DIR}` over stdio.

## Prerequisites

Install `bugx-cli` (`>=0.1.4`) locally before enabling this plugin:

```bash
# Python (>=3.11)
pip install bugx-cli

# or Node.js (>=18)
npm install -g bugx-cli
```

Verify installation:

```bash
bugx --version
```

## Capabilities, Permissions & Side Effects

- **Command execution**: Starts the local `bugx mcp serve` stdio process and runs local static analysis or reproducible PoC verification commands inside the active workspace.
- **File writes**: Creates and updates `.bugx/` inside the audited workspace to store coverage ledgers, checkpoints, and verification artifacts.
- **Network access**: Local code audits do not upload source code. Optional cloud sync and anonymous daily heartbeat telemetry can be disabled via `BUGX_TELEMETRY_ENABLED=0` or `bugx config set telemetry.data_sharing false`.
- **Model / API dependencies**: Reuses the user's configured ZCode host model; this plugin does not collect or store external API keys.

## Source & License

- Plugin manifest, agents, skills, and icon assets are authored by BugX (https://bugx.dev) and licensed under MIT.
- The external `bugx-cli` runtime engine is distributed separately via PyPI/npm under BUSL-1.1.
