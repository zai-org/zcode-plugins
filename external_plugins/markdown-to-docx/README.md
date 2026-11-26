# Markdown to Word

Turn Markdown notes and docs into real Word documents that colleagues can open and edit: headings become Word heading styles (navigation pane and table of contents work), and lists, tables, code blocks, quotes, links and local images all come across. Set the Chinese and English fonts separately, add a table of contents and page numbers, and convert files one by one or merge them into a single document. Runs locally; no conversion service or API keys.

## Features

- **Real Word styles**: Heading 1–4, Quote, Code, Caption and List Paragraph, so the navigation pane, outline view and table of contents work, and restyling the whole document takes one click.
- **Everything comes across**: bold, italic, strikethrough, inline code, links, bullet, numbered, nested and task lists, GFM tables (header shading, column alignment, header row repeats on each page), code blocks, block quotes and horizontal rules.
- **Local images**: PNG and JPEG next to the .md file are embedded and scaled to fit the page, with the alt text as the caption.
- **Fonts and layout**: separate Chinese font (微软雅黑, 宋体, 黑体, 楷体…) and Latin font, body size, A4 or Letter, margins, page numbers in the footer and an optional table of contents.
- **Merge or one by one**: combine several files into one document, each starting on a new page, or set a title and output name per file. `<!-- pagebreak -->` forces a page break.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `markdown-to-docx/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Convert 产品说明书.md to Word with a table of contents"
- "Use SimSun for Chinese text, 12 pt"
- "Merge all the .md files in docs into one Word document"

## Tools

| Tool | Purpose |
|---|---|
| `md2docx_open` | Read the Markdown files and preview each document's outline. Opens the panel |
| `md2docx_edit` | Change settings, edit cells by row, add or remove rows |
| `md2docx_status` | Show the current rows, issues and summary |
| `md2docx_export` | Write <name>.docx for each file, or one merged .docx |

Output goes to `markdown-to-docx/<project>/` in the workspace.

## Scope (v0.1)

- Web images (http links) are not downloaded; save them next to the .md file first.
- The table of contents is a Word field: Word fills it when the file opens (or right-click → Update Field).
- No math formulas, footnotes or Mermaid diagrams in v0.1; raw HTML is reduced to its text.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `markdown-to-docx/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/markdown-to-docx/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-markdown-to-docx test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: fflate (MIT), marked (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
