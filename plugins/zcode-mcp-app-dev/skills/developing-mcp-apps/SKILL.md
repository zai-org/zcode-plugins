---
name: developing-mcp-apps
description: Develop, migrate, build, and test MCP Apps for ZCode using the official MCP Apps SDK. Covers ZCode plugin manifests, persistent panel entries, host capabilities, and standalone distribution.
---

# Develop MCP Apps for ZCode

Use the official `@modelcontextprotocol/ext-apps` package for page communication and the official MCP server SDK for tools/resources. A separate ZCode SDK package is not required.

Read the installed SDK types and its [official quickstart](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/quickstart.md) for standard APIs. Keep SDK dependencies pinned in the plugin build lockfile; do not mix server examples from different major SDK versions.

For ZCode-specific behavior, read [host extensions](references/zcode-host.md). Use [the page example](assets/app.ts) for connection ordering and session widget state. Adapt it to the plugin's needs; it is source owned by the plugin, not a separately versioned runtime dependency.

## Development boundary

- Keep exactly one `App` per page. Register handlers before connecting. If a small loader reads a large UI bundle through MCP resources, pass the same client and its captured initial data to the UI.
- Use `app.callServerTool` and `app.readServerResource` for the plugin's own server. Do not import application source or use workspace dependencies on the ZCode repository.
- Check `getHostCapabilities()` for optional operations and ZCode extensions. A missing required capability needs a clear unsupported message; do not silently change persistence semantics.
- Keep committed documents in the plugin's server, file, or database owner. Host widget state is temporary presentation state. Preserve revision/conflict and cancellation behavior during migrations.
- Existing compatibility pages may use the host's injected `window.zcode` API. Do not access it on a page that creates an official `App`, because it may establish a second connection.

## Build and verify

In zcode-plugins, source/build inputs live in `ui-plugins/<name>/`; install metadata, skills, README and licenses live in `plugins/<name>/`. `pnpm build` bundles and stages runtime files into install directories. Keep developer `node_modules`, tests, and source-only files outside those directories.

1. Update the plugin contract and meaningful tests before changing behavior.
2. Build the actual server and self-contained UI; ship required fonts, workers, WASM, licenses, and external runtime data dependencies.
3. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:artifacts`, `python3 scripts/validate.py`, and `python3 scripts/build_dist.py`.
4. Test the built package outside the checkout. In ZCode verify tool launch, manual panel open, theme, resource load, close/reopen, state restoration, and failure/cancellation paths. Report checks that were not executed.
5. For installable changes, bump both the manifest and matching root marketplace version; keep source package/server versions consistent. Plugin versions evolve independently from the host application.

Do not publish, install into a production profile, or send messages merely because this skill was loaded; follow the user's requested scope.
