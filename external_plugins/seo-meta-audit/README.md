# SEO Meta Audit

Check every page of your website for the basics search engines look at — titles, descriptions, H1 headings, image alt text, language and mobile tags — and fix titles and descriptions right in a table. Lengths are measured the way results are shown (Chinese characters count double), duplicates across pages are caught, and a search-result preview shows how a page will look. Save fixed copies, or apply the changes to the pages with backups and one-click undo. Runs locally on your files; no SEO service or API keys.

## Features

- **Title and description checks**: missing, too short or too long by display width (Chinese counts double), and duplicates across pages.
- **Page basics**: number of H1s, images without alt text, <html lang>, viewport meta and Open Graph tags.
- **Fix in the table**: edit titles and descriptions with live widths and a search-result preview.
- **Careful rewriting**: only the title, description and optional og:title/og:description and lang are touched — the rest of the HTML stays byte-for-byte the same.
- **Copies or in place**: export fixed copies, or apply to the originals with backups and an undo; audit.csv lists every finding.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `seo-meta-audit/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Audit the SEO of the pages in site/"
- "Rewrite the about page's title and description"
- "Apply the fixes to the original pages and add lang=zh-CN"

## Tools

| Tool | Purpose |
|---|---|
| `seo_open` | Read every page's meta tags and audit them. Opens the panel |
| `seo_edit` | Change settings, edit cells by row, add or remove rows |
| `seo_status` | Show the current rows, issues and summary |
| `seo_export` | Write fixed page copies and audit.csv (apply/undo on request) |

Output goes to `seo-meta-audit/<project>/` in the workspace.

## Scope (v0.1)

- Static HTML files only; pages rendered by JavaScript or a CMS are not read.
- Alt text is reported, not edited, in v0.1.
- Does not fetch rankings or crawl the live site.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `seo-meta-audit/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/seo-meta-audit/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-seo-meta-audit test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
