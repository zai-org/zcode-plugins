# WordCraft for ZCode

WordCraft word processing in a ZCode panel, with workspace file opening and host-mediated exports.

## Use

Install and enable `wordcraft` from this marketplace. Open the **WordCraft** session panel, run `/wordcraft:open`, or ask the Agent to call `wordcraft`'s `open_editor` tool. Its optional `path` is relative to the current workspace. Use the application's own file picker or drag-and-drop to open files; Agents can open workspace files with `open_editor(path)`.

Edit with the application's existing tools. Save and Export request ZCode's **Save As** dialog. If saving is cancelled or fails, the error notice offers **Retry export**. After the panel is ready, the Agent can also use all 16 upstream MCP tools against the same live document, including the command dispatchers for the full command catalogue. Call `open_editor` first. MCP saves with explicit paths write into the workspace and report committed files; manual exports continue to use Save As.

## Requirements and limits

- A ZCode release with MCP Apps UI surfaces, WASM CSP support, and `ui/download-file`; Node.js 24 or later for the bundled local MCP server.
- Each MCP operation accepts at most 256 input files / 128 MiB total, with a 128 MiB per-output limit. Workspace imports are limited to 128 MiB; the host Save As interface accepts exports up to 50 MiB. Larger files report an error instead of silently failing.
- The Web version's capabilities apply, including browser graphics/audio and format limitations. This is not the native desktop executable. Printing, fullscreen, clipboard and native audio plugins depend on host/browser capabilities and are not guaranteed.
- Includes LXGW WenKai as a Chinese fallback for the interface and supported text-rendering paths, without system font installation or runtime downloads.
- Starts in Simplified Chinese by default. Untranslated strings retain upstream fallback behavior; language switching and preference persistence remain app-owned.
- Unsaved documents belong to the open panel. Save before closing the panel; the wrapper does not promise document recovery or cross-session synchronization.

## Permissions and data

The server reads requested files only inside the current workspace, including real-path checks against symlink escapes. Packaged application assets are read through MCP in 2 MiB chunks with SHA-256 verification. The wrapper opens no network listener, performs no runtime downloads, and does not send files to an external service. MCP outputs are written atomically inside the workspace, with path and symlink checks. A command can overwrite its requested output file. Closing or losing the panel fails pending requests; timed-out mutations are never replayed automatically. Inspect the document before retrying an operation that was already dispatched. Browser preferences may be stored by the upstream app.

## Build and provenance

UI source: `ui-plugins/wordcraft` and shared adapter `ui-plugins/craft-runtime`. `pnpm build` takes the compiled Web snapshot from the build cache, or compiles the pinned upstream with Rust and Trunk when the cache has none; the snapshot is not committed. `pnpm --filter @zcode/plugin-wordcraft build:web` forces a recompilation. See the shared adapter README for prerequisites and validation.

Upstream: [WordCraft](https://github.com/storytold/wordcraft), version 0.5.0, commit `ad8c26442076e357f5bb88515b25dfbf73c81e2e`. The snapshot is compiled locally using Trunk, not downloaded from a release. `dist/BUILD.json` records provenance and hashes. Upstream and dependency notices are retained under `dist/licenses/`; the Rust application is MIT OR Apache-2.0. ArtCraft branding retains its upstream trademark terms.

This is an independent ZCode integration based on the upstream project, not an official ArtCraft plugin. PdfCraft and DesignCraft omit the separately licensed brand artwork; patches and their hashes are retained in source and build records.

## Background retention

This editor requests background retention so editing can continue while hidden. The host may reclaim inactive pages after 30 minutes when more than four retained pages are in the background. Save changes before leaving; reclamation does not preserve unsaved page memory.
