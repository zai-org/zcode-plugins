# SVG Icon Kit

Turn a folder of SVG icons from different designers and tools into one tidy icon set. It strips editor leftovers from Inkscape, Sketch, Figma and Illustrator, removes scripts and event handlers, adds a missing viewBox, pads icons to a square and makes single-colour icons use currentColor so they take the text colour. Rename icons, recolour them or keep their original colours, then export optimised SVGs, one sprite.svg, React components and a preview page. Runs locally; no upload or API keys.

## Features

- **Clean**: removes comments, metadata, editor attributes (inkscape:, sodipodi:, sketch:, data-name), unused ids and empty groups; moves style="fill:…" into attributes; rounds long decimals.
- **Safe**: drops <script>, foreignObject, onclick-style handlers and javascript: links.
- **viewBox**: adds one from width/height when missing and can pad wide or tall icons to a square, centred.
- **Colour**: single-colour icons become currentColor; multi-colour icons (gradients, badges) keep their colours; or recolour any icon to one colour.
- **Names**: file names become lowercase-dash names (Star Badge.svg → star-badge); duplicates are flagged before export.
- **Outputs**: optimised SVGs, sprite.svg with prefixed ids so gradients don't clash, React components (TSX or JSX, with size prop) plus index, and an index.html preview with colour and size controls.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `svg-icon-kit/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Clean up the icons folder and make a sprite"
- "Turn these SVGs into React components"
- "Make all single-colour icons follow currentColor"

## Tools

| Tool | Purpose |
|---|---|
| `svgkit_open` | Read the icons, clean them and list each with its colours and size. Opens the panel |
| `svgkit_edit` | Change settings, edit cells by row, add or remove rows |
| `svgkit_status` | Show the current rows, issues and summary |
| `svgkit_export` | Write optimised SVGs, sprite.svg, React components, index.html and icons.csv |

Output goes to `svg-icon-kit/<project>/` in the workspace.

## Scope (v0.1)

- Icon-sized SVG files; complex illustrations are cleaned but not deeply optimised (no path merging).
- Text in icons still depends on the viewer's fonts; it isn't converted to outlines.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `svg-icon-kit/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/svg-icon-kit/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-svg-icon-kit test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
