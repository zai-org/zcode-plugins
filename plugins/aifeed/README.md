# AIFeed — signed content permissions for agents

[AIFeed](https://aifeed.md) is an open standard (MIT code, CC BY 4.0 specs) for signed
content permissions on the AI web. A site publishes a manifest at `/.well-known/ai.json`
signed with Ed25519, anchors the public key in a DNS `_aifeed` TXT record, and can revoke
it. Agents verify the chain instead of trusting an unsigned, unrevocable text file.

This plugin brings that workflow into ZCode:

- **MCP server** (`aifeed`, stdio, bundled under `engine/`) with six tools:
  - `verify_manifest` — signature + DNS anchor + VERIFIED/UNVERIFIED
  - `fetch_aifeed` — token-budgeted AIFeed Markdown/MAKO with permissions and an optional page-signature check
  - `list_assets` — images, videos, and documents a signed page declares
  - `verify_asset` — download a declared asset and check size/sha-256
  - `select_index` — rank signed delta-index entries within page/token budgets
  - `decide_usage` — is this use (retrieval, training, quoting, ...) allowed?
- **Skill** (`aifeed`) — verify-first and publish flows, so the agent checks permissions
  before fetching and never assumes allow.

## Network, dependencies, and side effects

- The engine is **zero-dependency** (Node standard library only) and runs from this
  plugin directory; no npm install and no runtime downloads.
- Network: HTTPS requests to the domain you ask about (manifest, content, assets, DNS
  TXT lookups). No telemetry; nothing is sent to the plugin author.
- Writes: none. The plugin never writes to your project, home directory, or ZCode data.
- `http://` loopback origins are allowed only when the `allow_private` option is set to
  `1` (local testing).

## Requirements

Node.js 20 or newer (`node` on `PATH`). The engine checks HTTPS-only origins by default.

## Links

- Website and live signed demo origins: https://aifeed.md
- Source, specs, conformance vectors: https://github.com/denyn1/aifeed-protocol
- npm packages: `aifeed` (CLI), `@aifeed/verify` (SDK), `aifeed-mcp-server`, `@aifeed/frameworks`

Honest limits: the specs are a draft, there is no external cryptographic review yet, and
an origin + DNS compromise is undetectable on first contact.

MIT.
