# etsy-manager

A [ZCode](https://zcode.z.ai) plugin for managing an Etsy shop: listings, images,
inventory, shipping profiles, orders and reviews — 41 tools on top of the
Etsy Open API v3, powered by a vendored copy of
[aserper/etsy-mcp](https://github.com/aserper/etsy-mcp) (MIT).

The plugin is fully **standalone**: the MCP server is bundled with esbuild into a
single dependency-free file (`vendor/etsy-mcp/server-bundle.mjs`, ~1.3 MB), so it
runs on Windows, Linux and macOS without `npm install`. No credentials are stored
inside the plugin — keys are read from your environment or `~/.etsy-mcp/config.json`.

[README (Türkçe)](./README_TR.md) · [README (中文)](./README_CN.md)

## Requirements

- ZCode (Desktop or CLI)
- **Node.js ≥ 20** on `PATH` (`node` must be runnable). On a VPS:
  `nvm install 22` or NodeSource setup.

## First-time setup

1. Get your app's **keystring** (`apiKey`) and **shared secret** (`sharedSecret`)
   from https://www.etsy.com/developers/apps. When registering an app, set its
   callback URL to `http://localhost:3737/callback`.
2. Create `~/.etsy-mcp/config.json`:
   ```json
   { "apiKey": "your-keystring", "sharedSecret": "your-shared-secret" }
   ```
   (Environment variables `ETSY_API_KEY` / `ETSY_SHARED_SECRET` take precedence.)
3. In the chat say **"connect to Etsy"** — the `authenticate` tool returns an
   OAuth consent URL. Approve it once; tokens are saved to
   `~/.etsy-mcp/tokens.json` and refreshed automatically.

### Headless machines / VPS

The `authenticate` tool returns the consent URL directly in the chat and never
blocks. If the server has no browser, forward the callback port over SSH from
your local computer and open the URL there:

```bash
ssh -L 3737:localhost:3737 user@your-vps
```

Setting `ETSY_NO_BROWSER=1` disables the browser-launch attempt entirely.
Alternatively, copy an existing `~/.etsy-mcp/tokens.json` from an authenticated
machine to skip OAuth (tokens are machine-independent and auto-refresh; treat
the file as a secret).

## Vendored-server patches

- OAuth callback port is fixed (default 3737, override with `ETSY_CALLBACK_PORT`)
  so the redirect URI can be registered in the Etsy app dashboard.
- Credentials are read from `~/.etsy-mcp/config.json` (env vars win).
- Headless/VPS support: the consent URL is printed **and** returned by the
  `authenticate` tool before any browser launch; the tool is non-blocking;
  browser-launch failure never breaks the flow; `ETSY_NO_BROWSER=1` skips it.
- The OAuth callback server binds to loopback only (`127.0.0.1`) — safe on a
  VPS and reachable through an SSH tunnel; a busy port fails fast with a clear
  error instead of hanging.

## Side effects

- Runs a local MCP server (`node scripts/mcp-server.mjs`) that makes HTTPS
  requests to `api.etsy.com` / `www.etsy.com`.
- During OAuth, starts a temporary HTTP server on `127.0.0.1:3737`
  (`ETSY_CALLBACK_PORT`) for up to 2 minutes, and tries to open the consent
  URL in a browser (skippable via `ETSY_NO_BROWSER=1`).
- Reads/writes only inside `~/.etsy-mcp/` (`config.json` you create,
  `tokens.json` it manages). Nothing else is written or read.

## Structure

```
.zcode-plugin/plugin.json      plugin manifest
.mcp.json                      MCP server definition (node scripts/mcp-server.mjs)
scripts/mcp-server.mjs         credential-reading launcher
skills/etsy-manager/SKILL.md   usage guide for the model
vendor/etsy-mcp/server-bundle.mjs  self-contained MCP server (esbuild bundle)
vendor/etsy-mcp/src/           patched upstream TypeScript sources (provenance)
```

## License

MIT — Copyright (c) 2026 [Hugo](https://gozutok.info). Vendored
[aserper/etsy-mcp](https://github.com/aserper/etsy-mcp) is MIT
([its license](./vendor/etsy-mcp/LICENSE)).
