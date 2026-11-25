# Citation Checker

Check a report against the documents it cites: every number, quotation and citation is matched to the source passage, mismatches and unsupported claims are flagged, and one click takes you back to the source page with the passage highlighted.

## Features

- **Reports**: Markdown, Word (.docx), plain text, and also PDF or HTML.
- **Sources**: PDF (text layer), saved web pages (.html), Word, Markdown and text. By default, every supported file in the report's folder.
- **What gets checked**: sentences with a number (years, dates and ordinals are context only), a quotation of 8+ characters (“…”, 「…」, "…") or a citation marker ([1], [1-3], [^1], 【1】, (Smith, 2020), （王磊，2019）).
- **Matching**: each claim is matched to the closest source sentence or pair of sentences (Chinese character pairs, English words, numbers by value). Long table rows are trimmed to the relevant part.
- **Numbers**: compared by value with 万/亿/万亿, thousand/million/billion, %, ‰ and 个百分点/percentage points; rounding in the report is allowed (134.9 万亿 = 1349084 亿). When a number differs, the source figure in the same context is suggested ("5.2% → source says 5.1%").
- **Quotations**: must appear verbatim (whitespace, quote styles and footnote markers ignored). Otherwise the closest source sentence is shown with a word diff.
- **Statuses**: number mismatch, quote mismatch, no source found, needs a look (partial or cross-language match), supported. Also flags support that comes from a different source than the one cited in the reference list.
- **Panel**: claims grouped by status with filters. Each claim shows its numbers in green/red, the source figure and the quote diff, then jumps to the source: PDF pages are rendered with the passage highlighted; web pages and documents show the paragraph in context. Verdict buttons (supported / partly / wrong / unsupported / open) with a note. `j`/`k` move between claims.
- **Export**: a self-contained HTML table or CSV (Excel-friendly) next to the report: claim, location, auto check, verdict, note, source location and passage.

## Usage

Ask the agent in ZCode Desktop:

- "Check report.md against the PDFs in the sources folder and tell me which numbers are wrong"
- "Find claims in my draft that no source supports"
- "Export the citation check table as HTML for my reviewer"

The agent reviews the flagged claims (it reads the sources and can search them in any language) and records verdicts; you can change any of them in the panel.

## Tools

| Tool | Purpose |
|---|---|
| `cite_check` | Check a report against its sources and open the panel |
| `cite_review` | Record verdicts and notes for claims |
| `cite_search` | Search the sources for a passage (keywords, a sentence, numbers) |
| `cite_export` | Write the check table (HTML, CSV or Markdown) |
| `cite_status` | Show saved results and verdicts |

## Scope (v0.1)

- Literal checking only: numbers and wording are compared; whether an argument follows from the source is up to the reviewer (the agent or you).
- Scanned PDFs need OCR first. Sentences split across PDF pages are matched page by page.
- Sources must be local files; save web pages as .html first (for example with Web Archiver).
- Footnote-style citations inside Word footnotes are not read; citation markers in the text are.

## Privacy, network and files

- Runs entirely locally: no network access, no API keys or accounts.
- Writes only `.citation-check/<report>.json` (results and verdicts) and the exported table next to the report. Reports and sources are never modified. No hooks.

## Build and test (developers)

- Source: `ui-plugins/citation-checker/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-citation-checker test`. `CITE_SAMPLES` points to the real sample (China's 2024 statistical communiqué as PDF, the WHO obesity fact sheet page and a brief with planted errors). `test:e2e` needs Chrome.

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: pdf.js (Apache-2.0), linkedom (ISC), fflate (MIT), jsdiff (BSD-3-Clause), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
