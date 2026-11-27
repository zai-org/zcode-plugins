# Outline Mind Map

Turn the notes you already have into a mind map. Open a Markdown outline (headings and nested bullet lists), an indented text file or an OPML export; the central topic, main branches and sub-topics are laid out automatically on both sides or to the right, each branch in its own colour. Rename or re-level nodes, hide some, add new ones, recolour a branch, then export a crisp SVG and PNG, plus OPML and FreeMind (.mm) files you can keep editing in other mind-map apps, and a cleaned-up Markdown outline. Runs locally; no account or API keys.

## Features

- **Reads real notes**: Markdown headings and nested lists (-, *, 1.), indented text, OPML; bold/links/code marks are cleaned; front matter and code blocks are skipped.
- **Automatic layout**: branches balanced on both sides or all to the right, curved coloured links, sizes by level.
- **Editable**: change text or level, hide nodes, add nodes, recolour a main branch.
- **Palettes**: bright, calm or mono, any background colour.
- **Exports**: SVG, 2× PNG, OPML, FreeMind .mm (keeps left/right sides and branch colours) and a cleaned Markdown outline.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `outline-mindmap/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Turn 开店计划.md into a mind map"
- "Rename 竞争对手 to 竞品调研 and add a 风险 branch"
- "Export PNG and an OPML file"

## Tools

| Tool | Purpose |
|---|---|
| `mindmap_open` | Read the outline and lay out the mind map. Opens the panel |
| `mindmap_edit` | Change settings, edit cells by row, add or remove rows |
| `mindmap_status` | Show the current rows, issues and summary |
| `mindmap_export` | Write mindmap.svg, mindmap.png, mindmap.opml, mindmap.mm and outline.md |

Output goes to `outline-mindmap/<project>/` in the workspace.

## Scope (v0.1)

- Nodes are text only (no images, links or notes on nodes) in v0.1.
- New nodes are added at the end of the outline; set their level to attach them to the last branch.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `outline-mindmap/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/outline-mindmap/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-outline-mindmap test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: resvg-wasm (MPL-2.0), fontkit (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
