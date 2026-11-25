# Privacy

TurnLens runs locally inside ZCode. It does not operate a server and does not send data to the plugin author.

## Data read

- The plugin reads the local ZCode session database at `~/.zcode/cli/db/db.sqlite` in read-only mode.
- Tables read: `session`, `turn_usage`, `tool_usage`, `model_usage`, `message`, `part`.
- The user message text is read locally only to estimate the number of tokens typed into the input box. The estimate is computed in memory and is not stored or transmitted.
- The plugin never writes to the database.

## Network

- The plugin does not make network requests.
- The side panel is served by a local MCP stdio server inside ZCode.
- The optional Stop hook asks ZCode to make one additional model request per turn so the assistant can print the precomputed card. That request goes through the user's configured model provider under ZCode's normal terms; the plugin itself does not send data anywhere.

## Local settings

- The automatic card can be disabled by the panel switch, `SESSION_STATS_AUTO_DISABLED=1`, `<project>/.zcode/session-stats.auto-off`, or `<plugin data dir>/auto-display.disabled`.
- The panel switch writes a tiny preference file at `~/.zcode/cli/plugins/data/turn-lens/auto-display.json` so the panel and the Stop hook agree across sessions.
- No analytics, telemetry, accounts, or credentials are collected.

## Contact

MorganWsy — shuyang@email.ncu.edu.cn
