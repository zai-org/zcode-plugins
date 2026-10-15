# Grok Bot Dispatch for ZCode (zcode-grokbot-dispatch)

> Plugin id: `zcode-grokbot-dispatch` (renamed from the pre-release id `zcode-dispatch`). Runtime paths are unchanged (`~/.config/zcode-dispatch/`, `~/.local/state/zcode-dispatch/`, `ZCODE_DISPATCH_*` env), so existing config keeps working; if you installed the old `zcode-dispatch` build, uninstall it and install `zcode-grokbot-dispatch`.


Bidirectional task dispatch between the ZCode desktop app and DSH (DeepSeek Harness) / Grok Bot, with `[Project: X]` routing, persistent session↔job mapping and automatic result reporting (direct HTTP by default, Yobiru optional).

## Components
- **Commands**: `/dispatch-dsh <project> <task>`, `/dispatch-grok <project> <task>`, `/dispatch-status <id>`
- **MCP server** (stdio, `node mcp/server.mjs`): tools `dispatch_to_dsh`, `dispatch_to_grokbot`, `dispatch_status`
- **Hooks**: `UserPromptSubmit` (records session↔job mapping) and `Stop` (reports the finished session's result to the dispatching peer)

## Install
1. ZCode → Settings → Plugins → `zcode-plugins-official` → install **zcode-grokbot-dispatch**.
2. Requires Node.js ≥ 22.5 on PATH. `/dispatch-dsh` also requires the `dsh` CLI (override with `DSH_BIN`).
3. Configure peers in `~/.config/zcode-dispatch/config.json` or env vars (env wins), e.g.:
   ```json
   { "transport": "direct", "peers": { "dsh": { "url": "http://<peer-host>:<port>", "keyFile": "~/.config/zcode-dispatch/dsh.key" } } }
   ```
   Relevant env: `ZCODE_DISPATCH_CONFIG`, `ZCODE_DISPATCH_TRANSPORT` (direct|yobiru), `ZCODE_DISPATCH_GROK_PEER`, `ZCODE_DISPATCH_PROJECTS_ROOT` (default `~/Projects`), `ZCODE_DISPATCH_DISCOVERY=0` (disable Tailscale discovery), `DSH_BIN`, `DSH_PROFILE`.
   No endpoint is built in; nothing is sent until you configure a peer.

## Side effects / privacy
- **Network**: the `Stop` hook and the dispatch tools send task text and up to ~3000 chars of the session's final result to the peer **you configured** — by HTTP (default, authenticated with your key file) or, if `transport` is `yobiru`, via the `yobiru` CLI (`yobiru send <peer> ...`). Sessions not started by a dispatch are not reported.
- **Commands executed**: `dsh --profile headless --json <task>` (for `/dispatch-dsh`), `yobiru` (only when transport is yobiru), and `tailscale status` for optional peer discovery (disable with `ZCODE_DISPATCH_DISCOVERY=0`).
- **Files written**: job/session mapping and reports under `~/.local/state/zcode-dispatch/` (and the plugin data dir), mode 0600/0700. Reads config/key files under `~/.config/zcode-dispatch/`.
- **Hooks**: runs on every `UserPromptSubmit` and `Stop` (timeouts 10s/20s); exits quietly when the session is not a dispatched job.
- No telemetry, no third-party services beyond the peer/Yobiru you configure.

## Third-party code
None bundled; uses only Node.js built-in modules.

## License
MIT © semantic-craft — source: https://github.com/semantic-craft/zcode-dispatch
