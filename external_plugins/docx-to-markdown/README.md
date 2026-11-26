# Word to Markdown

Move Word documents into a notes app, wiki, static site or Git repository as clean Markdown: headings, bold and italic, lists (including nested ones), tables, links, quotes and code come across, and embedded pictures are saved into an images folder with working relative links. Convert many files at once and rename the outputs. Runs locally; no upload or API keys.

## Features

- **Structure from styles**: Heading 1–6 (also outline levels and Chinese style names), the document Title as the single H1, block quotes from Quote styles, and the TOC field and hidden text left out.
- **Lists that keep their shape**: bullet and numbered lists from Word numbering or List styles, nested levels indented correctly.
- **Tables**: GFM tables with merged cells flattened, line breaks as <br> and pipes escaped.
- **Images**: pictures are extracted to an images folder (name pattern configurable) with URL-encoded relative links and their alt text.
- **Clean inline formatting**: bold, italic, strikethrough, links, inline code and code blocks from monospace fonts or Code styles; Markdown characters in plain text are escaped. Optional <u> underline and YAML front matter.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `docx-to-markdown/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Convert 员工手册.docx to Markdown"
- "Convert every Word file in 资料 and add a YAML title"
- "Keep Word's heading levels as they are"

## Tools

| Tool | Purpose |
|---|---|
| `docx2md_open` | Read the Word files and preview the Markdown. Opens the panel |
| `docx2md_edit` | Change settings, edit cells by row, add or remove rows |
| `docx2md_status` | Show the current rows, issues and summary |
| `docx2md_export` | Write <name>.md for each file plus its <name>_images/ folder |

Output goes to `docx-to-markdown/<project>/` in the workspace.

## Scope (v0.1)

- Only .docx; save old .doc files as .docx first.
- Comments, footnotes, tracked-change deletions, text boxes and equations are not carried over in v0.1.
- Colors, fonts and page layout are dropped on purpose — Markdown has no place for them.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `docx-to-markdown/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/docx-to-markdown/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-docx-to-markdown test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: fflate (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
