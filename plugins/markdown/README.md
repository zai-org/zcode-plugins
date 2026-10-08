# Markdown Editor

[中文](README_CN.md)

A Markdown **UI plugin** for ZCode. Edit workspace files in a side panel alongside your conversation, with Vditor's instant rendering, autosave, an outline, and agent-assisted edits.

## Use it

Install and enable **Markdown Editor** from a marketplace containing this plugin. It requires Node.js 24+ on the host PATH and a ZCode version supporting MCP Apps, `ui.surfaces`, and the `ui://markdown/panel.html` resource. Clients without that support cannot display the editor; installing an MCP server alone does not add a panel.

Open **Markdown Editor** from the session's plugin UI, or ask the agent:

> Open `docs/notes.md` in the Markdown editor.

In the panel:

- **Open file / 打开文件** searches workspace files and recent documents. Create a new file or import a `.md` / `.markdown` file; importing copies its contents into a new workspace file.
- Write in instant-render mode, or switch to source mode. **Format / 格式** expands or collapses a persistent toolbar. Selecting text shows formatting actions and **Add to chat / 添加到对话** near the selection.
- Use the outline to navigate headings. The layout adapts to a narrow side panel and follows the host's light/dark theme. Chinese/English labels follow the host locale.
- Edits save automatically. External changes refresh a clean editor; a dirty editor keeps its draft and asks you to reload the file or overwrite it. Switching files waits for pending saves.
- Math, Mermaid diagrams, highlighting, icons, and editor styles load from packaged resources.

## Agent tools

Paths should be relative to the active workspace. Only `.md` and `.markdown` files are supported.

| Tool | Purpose |
| --- | --- |
| `open_document` | Open an existing file and return its current revision and content. |
| `new_document` | Create a file and open it; an existing file is never silently replaced. |
| `list_documents` | Find workspace Markdown files, optionally filtering their paths. |
| `read_document` | Read content without opening a panel. |
| `write_document` | Replace the complete file. Pass `expectedRevision` from `open_document` to protect newer edits. Omitting it explicitly overwrites the current version. |
| `patch_document` | Apply literal find/replace operations; `all: true` replaces all matches. Supports `expectedRevision`; no matches means no write. |

`commit_draft`, `resolve_conflict`, `get_status`, and `close_document` are app-only tools. The panel uses them for saving, conflict resolution, recovery, and watcher cleanup.

Example: call `open_document({"path":"docs/notes.md"})`, then call `patch_document` with that path, the returned revision as `expectedRevision`, and `ops: [{"find":"Draft","replace":"Ready"}]`. Re-read after a conflict; do not retry a stale overwrite blindly.

## Permissions, data, and limits

- The manifest starts one local Node.js MCP server over stdio in the project directory. It installs no hooks, runs no document-provided shell commands, and starts no runtime HTTP service. The optional development preview starts a loopback-only HTTP fixture.
- Opening/listing/reading exposes requested Markdown contents or paths to ZCode and, for model-visible tool calls, to the active conversation/model. **Add to conversation** sends the selected text (up to 12,288 characters) and document metadata to the host context; it does not submit a chat message itself.
- Saving, agent writes, and imports modify workspace files. New files may create parent directories. Writes use temporary files plus rename/link; existing files are replaced only through explicit write/save operations. Paths and symlink targets are checked against the workspace, and overwriting a symbolic link is rejected.
- Recent documents store relative paths and timestamps in `ZCODE_PLUGIN_DATA`, partitioned by workspace hash. Without that variable, this metadata uses an OS temporary directory. Open files use filesystem watchers and a polling fallback.
- Editor assets are bundled; there is no plugin analytics, cloud account, API key, or model dependency. Dependency installation requires the public npm registry. Remote links/images in a document depend on the host's network and content-security policy; this plugin is not a network isolation boundary.
- Server reads/writes are limited to 8 MiB of UTF-8 content; panel imports are limited to 5 MiB. Discovery is limited to depth 4 and 500 results, skipping hidden/dependency/build directories. Binary files and image uploads are unsupported.
- Revision checks and serialized saves prevent stale writes within this server. They are not an OS-level transaction with other processes: a file modified between the final check and rename can still race. Large-file editing performance depends on the host and document structure.

## Build and check from source

Use Node.js 24+, pnpm 10.33.2, and Python 3.10+. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm typecheck
pnpm lint
pnpm --filter @zcode/plugin-markdown test:e2e
pnpm --filter @zcode/plugin-markdown test:perf
python3 -m unittest discover -s tests
python3 scripts/validate.py
python3 scripts/build_dist.py
git diff --check
```

Browser tests require Google Chrome. The performance probe additionally uses `ps` and is intended for macOS/Linux. Browser tests use a synthetic host bridge and real MCP server; they do not replace testing the installed plugin in ZCode.

`pnpm build` compiles `ui-plugins/markdown/` into this plugin's generated `dist/` and creates `dist/local-marketplace/`. Add that local marketplace in **Settings → Plugin management → Discover → +**, then install/enable Markdown Editor. Generated files are excluded from Git. Distribution packaging rejects a missing or mismatched build marker; **run the pnpm build before Python distribution packaging**, including in release automation.

Manual checks: open/create a Markdown file, type and verify saved text on disk, expand/collapse the toolbar, format a selection, add a selection to the conversation, switch documents, change the file externally, and check narrow/light/dark layouts. Use synthetic sample text for screenshots.

## License and provenance

Plugin source is Apache-2.0 licensed under the repository license. The editor uses [Vditor](https://github.com/Vanessa219/vditor) 3.11.1; it is not affiliated with Typora. MCP integration uses the public Model Context Protocol SDK and MCP Apps SDK. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for component licenses. Builds preserve package license texts in `dist/licenses/`, including notices for Vditor's bundled renderer assets. No third-party service account is required.
