# Command Code Usage (command-code-usage)

[简体中文](./README_CN.md)

See your Command Code plan usage inside the conversation — the 5-hour and weekly rolling
windows, monthly credits or balance, and when each one resets — without leaving the terminal
or opening a billing page.

## Quick start

Install **Command Code Usage** from the ZCode plugin manager, then either run a command or
just describe what you want to know:

> How much of my 5-hour window is left, and when does it reset?

## Components

| Command | What it does |
| --- | --- |
| `/command-code-usage:quota` | The panel: 5-hour window, weekly window, monthly credits or balance, reset times, a remaining-requests estimate, and a warning when a window is burning faster than it resets |
| `/command-code-usage:usage` | The same panel — an alias, so either name works |

Both take the same optional arguments — `/command-code-usage:quota --compact`, `--md`,
`--json`, `--html`, `--verbose`, or `--demo hot` for offline sample data. `--help` lists
the authoritative set.

| Skill | Role |
| --- | --- |
| `command-code-usage` | Reads the quota and answers questions about the windows, reset times, credits and burn rate |

## Requirements

| | |
| --- | --- |
| Host | ZCode |
| Runtime | Node.js 18 or newer — the script uses the built-in `fetch` and installs nothing |
| Plan | A Command Code plan whose key may call the usage endpoints. Without API access those endpoints answer `403`/`407` and the panel says so instead of printing a number. |

## Data sources and authentication

One host only: **`https://api.commandcode.ai`** (HTTPS). The endpoints it reads are
`/alpha/whoami`, `/alpha/billing/credits`, `/alpha/billing/subscriptions`,
`/alpha/usage/summary`, and `/provider/v1/models`. The last one sends no credential and is
used only to tell whether the current model is routed to Command Code.

Endpoints under `/alpha/` are not part of Command Code's documented provider API. They are
read because they carry the plan windows; if one changes shape the panel reports the failure
rather than estimating from stale data. `--demo` calls nothing.

The key is discovered read-only, first hit wins:

1. `COMMANDCODE_API_KEY`, then `COMMAND_CODE_API_KEY`, then `CMD_API_KEY`, from the environment
2. `~/.commandcode/auth.json`
3. provider configs other agent tools leave behind — `~/.zcode/v2/provider_config.json`,
   `~/.claude/settings.json`, `~/.dsh/settings.yaml`, `~/.dsh/.credentials.yaml`,
   `~/.codex/config.toml`, `~/.grok/config.toml`

The key is sent to `api.commandcode.ai` and nowhere else. It is never copied to another
location, never echoed into the output, and never logged.

## What it does on your machine

| | |
| --- | --- |
| Hooks | none — the plugin installs no hooks and does not intercept your tools |
| MCP servers | none — no `.mcp.json`, no server process |
| Network | one host, `api.commandcode.ai`, and only while rendering the panel; `--demo` makes no calls |
| Executes | `node <plugin>/scripts/cc-usage.mjs` with the flags you passed. The command looks for that script at its installed path and, failing that, searches `~/.zcode`, `~/.claude`, `~/.codex`, `~/.grok` and `~/.dsh` for a copy under a `command-code*` or `commandcode*` path. Nothing else is executed. |
| Reads | the credential files listed above, and — when the host passes a transcript path — the last 128 KB of that transcript, only to pick up the `message.model` / `modelId` field of recent entries. No message content is stored or sent anywhere. |
| Writes files | `~/.commandcode-usage/last-report.json` (the last snapshot) and `~/.commandcode-usage/models.json` (a model-name cache). An HTML report is written only when you pass `--html`, to the path you give on the command line. |
| Degrades gracefully | a missing key, a plan without API access, and an unparsable response each produce a message naming the cause. It does not invent a figure. |

## Third-party code, assets and services

No third-party code or assets are vendored; the commands, the skill and the script are this
project's own. The only external service is Command Code's own API, and its terms and
availability are Command Code's. Licensed MIT — see the `LICENSE` file in the repository.
