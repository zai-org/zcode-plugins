# Command Code Usage

See how much of your **Command Code** plan you have left, without leaving the conversation.

Command Code plans (Go / GOAT / Pro / Max / Teams) pace your monthly credits with two **rolling
windows** — a 5-hour cap and a weekly cap. A window opens on your first request and resets a fixed
time later; it does not follow calendar days, and usage never carries over between windows. So
"can I still finish this task?" cannot be answered from the monthly balance alone. What matters is
how much of the *current* window is left and when it resets.

This plugin reads all three numbers and renders them where you are already looking.

```
Command Code · GOAT                             09-21 00:45 · 30d left in period
──────────────────────────────────────────────────────────────────────────
account  your-name <you@example.com>

5-hour window  ██░░░░░░░░░░░░░░░░░░░░░░   6.3%    $0.89 / $14.00
               resets 04:29 · in 3h 43m
weekly window  █░░░░░░░░░░░░░░░░░░░░░░░   2.5%    $0.89 / $35.00
               resets 09-27 23:29 · in 6d 22h
monthly        ░░░░░░░░░░░░░░░░░░░░░░░░   1.3%    $0.89 / $70.00
               $69.11 remaining

this period  330 requests · 100% success · 96.3M in / 306.9K out tokens
estimate      at your $0.0026 average, room for ≈ 5,064 more requests in the 5-hour window
              (based on your actual model mix this period; pricier models go much shorter)
```

When you are burning fast enough that a window will run out before it resets, it says so:

```
⚠ at the current $4.30/h, the 5-hour window runs out before it resets — exhausted in ~15m 20s
```

## Components

| Type | Name | What it does |
|---|---|---|
| Command | `/quota` | Renders the usage panel in the conversation |
| Command | `/usage` | Alias for `/quota` |
| Skill | `command-code-usage` | Teaches the agent to fetch the panel and to answer "is it enough to finish this task?" from the remaining-requests estimate rather than the monthly balance |

No hooks, no MCP servers, no agents, no background processes.

## Requirements

- **A Command Code plan.** Without one there is nothing to show. On pay-as-you-go rather than a
  subscription it still works, but shows a balance instead of windows.
- **Node.js** on `PATH`. The bundled scripts use only Node built-ins (`node:fs`, `node:http`,
  `node:os`, `node:path`, `node:child_process`, `node:zlib`) and the global `fetch`, so there is
  nothing to install.

## Usage

| Command | Result |
|---|---|
| `/quota` | The panel above |
| `/quota --md` | Markdown table, easier to copy |
| `/quota --compact` | One line, e.g. `CC GOAT · 5h 6% · weekly 2% · monthly 1.2% · $69.16 left` |
| `/quota --json` | Normalised fields plus the raw API responses |
| `/quota --demo hot` | Sample data — previews the warning state without touching the network |

Asking in plain language works too: *"How much Command Code quota do I have left? Is it enough to
finish what we are doing?"*

## Credentials and network access

**Network:** the panel calls four read-only endpoints on `https://api.commandcode.ai` —
`/alpha/whoami`, `/alpha/billing/credits`, `/alpha/billing/subscriptions`, and
`/alpha/usage/summary`. No other host is contacted. Nothing is sent anywhere else, and there is no
telemetry.

**The API key is resolved at runtime, in this order** (first hit wins):

1. the environment variable `COMMAND_CODE_API_KEY`, `CMD_API_KEY` or `COMMANDCODE_API_KEY`;
2. `~/.commandcode/auth.json`, written by logging into the Command Code CLI;
3. `~/.zcode/v2/provider_config.json` — a provider whose `api.baseUrl` points at `commandcode.ai`,
   i.e. the key you already configured in ZCode.

The key is only ever placed in an `Authorization: Bearer` header. **The plugin does not write,
print, log or transmit the key**, and it contains no credentials. `--verbose` reports which source
was used (never the key itself).

## Side effects

- **Reads** the credential files listed above, and the API endpoints listed above.
- **Writes nothing** by default. No cache, no state, no config changes.
- `--html` writes one HTML file, only when you explicitly pass that flag, to the path you choose
  (default `./command-code-usage.html`).
- `--serve` starts a local HTTP server on `127.0.0.1` (default port 8787) so a browser can poll the
  panel. It is off unless you pass the flag, binds to loopback only, and stops with Ctrl+C.
- The panel shells out to `node <plugin>/scripts/cc-usage.mjs`. That is the only process it starts.

## How the two useful numbers are derived

**"Room for ≈ N more requests"** = remaining allowance ÷ your average cost per request *this
period*. The average comes from your own usage, so the estimate adapts to any plan and any model
mix without hard-coding per-model rates. Because the baseline is your own average, **it stops
holding the moment you switch models** — the panel says so. Command Code's `/provider/v1/models`
returns a model list with no allowance factors or prices, so "how many requests of model X
specifically" cannot be computed from the API.

**The warning** extrapolates your current burn rate. That path has a trap: an hour after a window
opens, extrapolating one hour of activity across seven days will always claim the weekly cap is
about to blow — pure noise. So the script enforces a minimum sample: **under 5% of the window
elapsed it draws no conclusion at all**. No warning therefore means "not enough data yet", not
"you are safe".

## Account shapes it handles

| Situation | What is shown |
|---|---|
| Subscription, plan in the known table | monthly allowance bar plus both windows |
| Subscription, plan not in the table (new or enterprise) | "allowance", with an explicit note that the total is inferred from spent + remaining |
| No active subscription (pay-as-you-go, enterprise pool) | balance only, no meaningless percentage |
| Organisation spend caps configured | extra limit rows (shapes it cannot recognise are skipped, never guessed) |
| No requests yet this period | no request-count estimate, and it says why |

## Bundled scripts

Besides the command the agent runs (`scripts/cc-usage.mjs`), the plugin ships two standalone tools.
Neither runs on its own; they exist for the cases described here.

- `scripts/cc-usage.mjs` — the panel itself. Runnable directly:
  `node scripts/cc-usage.mjs --compact`. The panel adds no state and no cache.
- `scripts/install-user-scope.mjs` — installs the commands and skill into your user-scope agent
  directories (`~/.zcode/commands`, `~/.zcode/skills`) for users who prefer not to go through the
  marketplace. It writes those files and keeps a small manifest of what it wrote so it can update
  or remove them later. **Do not run it on top of a marketplace installation**: user-scope copies
  are discovered first and would shadow the installed plugin. `--uninstall` removes them.
- `scripts/verify-discoverable.cjs` — a read-only diagnostic that re-implements ZCode's own command
  parser, so a "my command does not show up" report can come with evidence. It reads files and
  prints a report; it writes nothing.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `/quota` missing from the `/` menu | The catalogue is snapshotted when a session starts. Fully quit the app and reopen it. |
| Typing `/quota` sends it as a normal message | The command was not discovered. Run `node scripts/verify-discoverable.cjs .` — it re-implements ZCode's own parser and reports diagnostics. |
| "No Command Code credentials found" | Provide one of the three sources above. |
| HTTP 401 on every endpoint | The key is invalid or expired. Re-login, or re-enter it in the ZCode provider settings. |
| Numbers look stale | Window reset times move. Re-run the command rather than reusing an older reading. |
| Requests being rate-limited (429) | Check which window reports `exceeded`, then wait for the reset, buy extra credits, or upgrade. |

## Contributing

Issues and pull requests: <https://github.com/Jovan1666/zcode-command-code-usage>.

Not affiliated with Command Code. The plugin reads your own account's usage through the same
endpoints the official CLI uses.

## License

[MIT](https://github.com/Jovan1666/zcode-command-code-usage/blob/main/LICENSE)
