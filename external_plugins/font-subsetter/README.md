# Font Subsetter

Shrink web fonts to just the characters your site uses — a 10–20 MB Chinese font usually becomes a few dozen KB. Pick the site or project folder: it finds the fonts (.ttf, .otf, .ttc, .woff, .woff2) and the pages (HTML, Vue/Svelte, JS/TS, CSS, Markdown, JSON, YAML, subtitles…), collects the characters that are really shown (code comments and HTML markup are skipped), and subsets each font with HarfBuzz, keeping OpenType features and variable-font axes. A display font can keep only the heading characters. Warns about characters the font doesn't have (with file and line), fonts whose license flag forbids embedding, and outputs that are still large. Exports WOFF2/WOFF (optionally TTF/OTF), a ready-to-use fonts.css, chars.txt, a size report and a preview image drawn with the subset fonts themselves. Runs locally; no account or API keys.

## Features

- **Finds what is shown**: HTML text and alt/title/placeholder, strings in JS/TS/Vue, Markdown, JSON, YAML, CSS content, subtitles — comments and markup skipped.
- **Real subsetting** with HarfBuzz hb-subset: OpenType features, CFF and TrueType outlines, variable-font axes and .ttc collections.
- **Per-font use**: all text, headings only (for display fonts) or just a list of extra characters.
- **Checks**: missing characters with file:line, license embedding flag (OS/2 fsType), variable fonts, large outputs, duplicate names.
- **Exports**: WOFF2, WOFF, TTF/OTF, fonts.css with @font-face (optional unicode-range), chars.txt, report.md and a preview drawn with the subset glyphs.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `font-subsetter/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Subset the fonts in the 官网 folder for the site"
- "Use the serif font only for headings"
- "Export WOFF2 and the CSS"

## Tools

| Tool | Purpose |
|---|---|
| `fontsub_open` | Find the fonts and pages, collect the characters and subset each font. Opens the panel |
| `fontsub_edit` | Change settings, edit cells by row, add or remove rows |
| `fontsub_status` | Show the current rows, issues and summary |
| `fontsub_export` | Write <name>.woff2/.woff, fonts.css, chars.txt, report.md and preview.png |

Output goes to `font-subsetter/<project>/` in the workspace.

## Scope (v0.1)

- Text is read from files, not from a running site: characters produced only at runtime (API data, user input) are not seen — add them as extra characters. HTML/JS scanning is pattern-based, not a full parser.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `font-subsetter/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/font-subsetter/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-font-subsetter test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: Bundles HarfBuzz hb-subset WebAssembly from harfbuzzjs (MIT; HarfBuzz is under the Old MIT license) and Google's woff2 encoder via wawoff2 (MIT; woff2 and Brotli are MIT). The sample fonts are small subsets of Noto Sans/Serif CJK SC under the SIL Open Font License 1.1 (license file next to them)., MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
