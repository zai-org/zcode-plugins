# Langfuse Observability for ZCode

[English](README.md) · [简体中文](README.zh-CN.md)

A community ZCode plugin that sends one Langfuse trace per completed ZCode turn.
It is designed for review and possible inclusion in the ZCode official plugin
marketplace.

> **Status:** early community contribution (`0.2.3`). The plugin is fail-open:
> a missing credential, malformed hook payload, local state error, or Langfuse
> request error must never block a ZCode session.

## What it records

The plugin listens to ZCode's process-hook events:

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`
- `Stop`

At `Stop`, it emits a trace named `ZCode Turn` containing:

- the ZCode session ID;
- the user prompt and final assistant message, when prompt capture is enabled;
- tool calls as Langfuse spans, including names and optional input/output;
- an assistant response generation;
- release, environment, turn ID, and tool-count metadata.

It does **not** read the transcript file or collect hidden chain-of-thought. It
only uses fields delivered in the ZCode hook payload.

## Permissions and side effects

Each of the six events starts a `node` process with the current user's
permissions. The process reads one JSON Hook event from stdin and writes one
empty JSON object to stdout; it does not spawn a shell or run user commands.

The hook reads `ZCODE_CONFIG_PATH`, or
`~/.zcode/cli/config.json` when that variable is unset, to find persisted plugin
options. It writes only bounded, hashed JSON session state under
`ZCODE_PLUGIN_DATA`, or the ZCode plugin data directory fallback. At `Stop`,
it sends HTTPS requests to the configured Langfuse ingestion endpoint using the
local credentials. No transcript files or hidden reasoning are read.

## Architecture

```text
ZCode hook stdin
      │ one JSON object
      ▼
 hooks/entry.mjs ──► TurnTracker ──► JsonStateStore
                         │                  │
                         │                  └─ per-session, atomic, hashed filename
                         ▼
                  LangfuseTraceSink ──► bundled official `langfuse` SDK
                                              │
                                              ▼
                                      Langfuse ingestion API
```

The source is deliberately split into deep modules:

- `src/domain/` — hook and trace data types plus payload extraction;
- `src/application/` — configuration and the turn state machine;
- `src/adapters/` — the filesystem state adapter and Langfuse SDK adapter;
- `src/hooks/` — the small process entry point and fail-open policy.

The distributable `dist/hooks/entry.mjs` bundles the official JavaScript SDK, so
an installed plugin does not need a separate `npm install` at runtime.

## Configuration

The plugin reads ZCode `userConfig` values using the standard ZCode environment
mapping. For example, the manifest key `langfuse_public_key` becomes:

```text
ZCODE_USER_CONFIG_LANGFUSE_PUBLIC_KEY
```

The following ordinary environment variables are also accepted, which is useful
for local smoke tests and managed deployments:

```text
LANGFUSE_PUBLIC_KEY
LANGFUSE_SECRET_KEY
LANGFUSE_BASE_URL
LANGFUSE_USER_ID
LANGFUSE_ENVIRONMENT
LANGFUSE_RELEASE
LANGFUSE_ENABLED
LANGFUSE_CAPTURE_PROMPTS
LANGFUSE_CAPTURE_TOOL_INPUTS
LANGFUSE_CAPTURE_TOOL_OUTPUTS
LANGFUSE_MAX_CAPTURE_CHARS
LANGFUSE_DEBUG
```

`LANGFUSE_BASE_URL` defaults to `https://cloud.langfuse.com`. Set it to your
self-hosted HTTPS URL, for example `https://langfuse.example.com`. Plain HTTP
URLs are rejected and replaced with the default HTTPS endpoint.

For a self-hosted project, configure the public and secret keys in the plugin
configuration. The hook reads its own persisted `plugins.options` entry using
`ZCODE_PLUGIN_ID`; this is needed because current ZCode runtimes do not inject
all `userConfig` values into process-hook environment variables. Standard
`LANGFUSE_*` environment variables override stored options. Never commit
credentials or put them in `hooks/hooks.json`.

### Privacy controls

All capture controls default to `true` for useful traces. Set any of these to
`false` to keep the corresponding content out of both the Langfuse request and
local per-session state:

```text
LANGFUSE_CAPTURE_PROMPTS=false
LANGFUSE_CAPTURE_TOOL_INPUTS=false
LANGFUSE_CAPTURE_TOOL_OUTPUTS=false
```

Every captured field is bounded by `LANGFUSE_MAX_CAPTURE_CHARS` (default
`20000`). Metadata-only mode still reports timing/session/tool-count structure,
but not prompt, response, tool input, tool output, or error text.

## Development

Requirements: Node.js 20 or newer.

```bash
npm ci
npm run check
npm run package:plugin
```

`npm run build` builds the complete `dist/` output, structured as a ZCode
marketplace shell whose single entry uses the official plugin layout (same
shape as the `zcode-plugins-official` template):

```text
dist/marketplace.json
dist/plugins/zcode-plugin-langfuse/
├── .zcode-plugin/plugin.json
├── .claude-plugin/plugin.json      (identical copy for Claude compatibility)
├── hooks/hooks.json                (points at hooks/entry.mjs)
├── hooks/entry.mjs                 (sealed runtime bundle)
├── README.md
├── README_CN.md
├── LICENSE
└── THIRD_PARTY_NOTICES.md
```

`dist/plugins/zcode-plugin-langfuse/` is the installable plugin: its
`hooks/entry.mjs` runtime, manifest, hooks, dual-language README, license, and
third-party notices. The release workflow compresses the tree into the
versioned ZIP; the official catalog and local directory installs consume the
plugin directory as-is. Everything under `dist/` is generated and not
committed.

The hook can be smoke-tested without credentials:

```bash
printf '%s\n' '{"hook_event_name":"Stop","session_id":"smoke","last_assistant_message":"ok"}' \
  | ZCODE_PLUGIN_DATA="$(mktemp -d)" \
    LANGFUSE_DEBUG=true \
    node dist/plugins/zcode-plugin-langfuse/hooks/entry.mjs
```

Expected stdout is one empty hook result object:

```json
{}
```

Diagnostics, when enabled, go to stderr. They never contain keys or full
prompts.

## Third-party software

The runtime uses `langfuse` 3.38.20, `langfuse-core` 3.38.20, and `mustache`
4.2.0. Each dependency is MIT-licensed; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for versions, provenance, and
source links. Langfuse is an external service selected by the user and is not
bundled with credentials.

## Local installation for testing

ZCode treats a selected directory as a **plugin marketplace**, so this repository
includes `marketplace.json` at its root; its entry points at
`./dist/plugins/zcode-plugin-langfuse`. Build first, then use **Settings →
Plugins → Add marketplace → Select directory** and choose this repository.
Install `zcode-plugin-langfuse` from the resulting personal marketplace, enable
it, and configure its `userConfig` values.

The plugin manifest is at `.zcode-plugin/plugin.json`; the hook declaration is
at `hooks/hooks.json`.

## Install a release

Download `zcode-plugin-langfuse-v<version>.zip` from the release page, extract it, and add
the extracted plugin directory as a local marketplace via **Settings →
Plugins → Add marketplace**. Do not add a fresh checkout of this repository as
a marketplace: it has no `dist/` bundle (generated, not committed), so hooks
cannot start. For a development install from a checkout, run `npm install`
first — the `prepare` hook builds `dist/`.

- Marketplace manifest: <https://raw.githubusercontent.com/erlinerd/zcode-plugin-langfuse/main/marketplace.json>
- Plugin manifest: <https://raw.githubusercontent.com/erlinerd/zcode-plugin-langfuse/main/.zcode-plugin/plugin.json>
- Latest release (asset: `zcode-plugin-langfuse-v<version>.zip`): <https://github.com/erlinerd/zcode-plugin-langfuse/releases/latest>
- Release page: <https://github.com/erlinerd/zcode-plugin-langfuse/releases/latest>
- Official ZCode plugin documentation: <https://zcode.z.ai/en/docs/plugin>
- Official ZCode plugin marketplace: <https://github.com/zai-org/zcode-plugins>

The repository marketplace is named `zcode-plugin-langfuse`, and its
`marketplace.json` resolves the plugin from `source: "."`. Versioned release
assets are generated by the tagged GitHub Actions workflow.

Before submitting a marketplace change, verify:

1. `npm run check` passes;
2. `npm run package:plugin` creates and validates the release ZIP;
3. `hooks/hooks.json` contains no unsupported hook events;
4. no credentials are present in the repository, package, or logs;
5. disabling prompt/tool capture behaves as documented.

## Project policies

- [Agent instructions](AGENTS.md)
- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md)
- [Release checklist](docs/releasing.md)
- [Design notes](DESIGN.md)

## License

MIT. See [LICENSE](LICENSE).
