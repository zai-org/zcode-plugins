# PNG & Sprite Tools

[简体中文](./README_CN.md)

Browser tools for game and UI PNG assets. Trim transparent padding from one PNG or a batch and add exact padding, or slice a uniform sprite sheet into individual PNG frames. The Agent then wires the exported files into your project.

## Components

| Component | Content |
| --- | --- |
| MCP server `png-trim` | Remote Streamable HTTP server `https://transparent-padding-trimmer.chajian.workers.dev/mcp`, no authentication. Tool `prepare_png_trim`. |
| MCP server `png-batch-trim` | Remote Streamable HTTP server `https://batch-transparent-png-trim.chajian.workers.dev/mcp`, no authentication. Tool `prepare_batch_png_trim`. |
| MCP server `sprite-slicer` | Remote Streamable HTTP server `https://sprite-sheet-slicer.chajian.workers.dev/mcp`, no authentication. Tool `prepare_sprite_grid`. |
| Skill `game-and-ui-png-assets` | Chooses the tool, opens it with a preset, and wires the exported files into the project after confirmation. |
| Command `/png-sprite-tools:png-assets` | Starts the same workflow manually. |

### Tools

| Tool | Arguments | Output in the browser |
| --- | --- | --- |
| `prepare_png_trim` | `padding` 0–512 (default 0), `threshold` 0–254 (default 0), `sample` | One trimmed PNG |
| `prepare_batch_png_trim` | `padding` 0–512, `threshold` 0–254, `sample` | Trimmed PNGs, or one ZIP with all PNGs and a per-file CSV |
| `prepare_sprite_grid` | `width`, `height` 1–4096 (required); `gapX`, `gapY`, `x`, `y` 0–4096; `prefix` (lowercase, max 32, default `sprite`); `skipEmpty`; `sample` | ZIP of PNG frames named by row and column |

`threshold` sets which alpha values count as empty when finding the content bounds. Trimming copies the pixels inside the bounds without resampling. Each tool only returns a preset link (for example `https://transparent-padding-trimmer.chajian.workers.dev/#padding=8&threshold=10&sample=0`) plus the normalized settings; it accepts no images or files. Invalid arguments are rejected.

## How to use

After installing and enabling the plugin, describe what you need, for example:

- Slice this 16×16 sprite sheet with 1 px gaps into frames named hero
- Trim the transparent edges of my icon PNGs and keep 8 px padding
- Crop the empty space around this character PNG

You can also type `/` and choose the `game-and-ui-png-assets` skill or the `png-assets` command.

1. The Agent calls the matching tool and gives you a link.
2. Open it in a desktop browser, choose the local file(s) (static PNG for trimming; PNG, WebP or JPEG for sprite sheets) and check the preview.
3. Download the result and save it into the workspace.
4. The Agent proposes the engine, CSS or component changes that use the new files and applies them after you confirm.

## Dependencies, network access and side effects

- **Network**: MCP calls go to the three `*.chajian.workers.dev/mcp` addresses above. Each tool page is served from the same origin as its MCP server. All are hosted on Cloudflare Workers, which processes standard request data such as IP address as the hosting provider.
- **Privacy**: images are decoded and processed locally in your browser and are not uploaded. The MCP tools receive only the settings above.
- **Accounts and billing**: none. No API key, login or payment.
- **File writes**: the plugin package writes nothing. The skill edits project files only after you confirm the change.
- **Command execution and Hooks**: none.
- **Telemetry**: the plugin package contains no telemetry.

## Source and license

- Plugin package: MIT, © 2026 Penova ([LICENSE](./LICENSE)).
- The three web tools and MCP servers are operated by Penova on `chajian.workers.dev`. Third-party libraries used by the web tools (such as [fast-png](https://github.com/image-js/fast-png) and [fflate](https://github.com/101arrowz/fflate), both MIT) and sample media credits are listed on each tool's Help page; none are bundled in this plugin.
