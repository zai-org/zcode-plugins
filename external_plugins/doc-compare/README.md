# Doc Compare

Compare two versions of a contract, proposal, policy or manuscript and review every change.

## Features

- **Inputs**: `.docx`, `.pdf` with a text layer, `.md` and `.txt`. The two versions can be in different formats, for example the DOCX you sent against the PDF that came back.
  - DOCX: body paragraphs and table cells, with tracked changes accepted. Deleted text and field codes are ignored.
  - PDF: text lines are rebuilt into paragraphs from line spacing, bullets, outdents, font changes and page breaks. Repeating headers, footers and page numbers are removed, and hyphenated line breaks are joined. CJK radical code points that some PDF fonts emit (⻘, ⽅…) are mapped back to normal characters.
- **Alignment**:
  - Unchanged paragraphs are matched first. The remaining paragraphs are paired by similarity, so an edited paragraph shows as **modified** rather than deleted plus added.
  - Paragraphs that moved are detected.
- **Word-level differences**: English is compared by word and Chinese, Japanese and Korean by character. Changes that touch **numbers** (amounts, dates, percentages, Chinese numerals) are flagged with #.
- **Review panel**:
  - A change list with filters by type, numbers and review status.
  - An aligned side-by-side view; unchanged stretches are collapsed and can be expanded.
  - Click a change to jump to it in both versions. Each change has **✓ Confirm**, **? Question** and a note.
  - Review marks are saved and kept when the comparison is re-run.
- **Report**: HTML (insertions and deletions highlighted, status and notes, printable) and CSV for Excel. A report can also contain only the open or questioned changes.
- Options: ignore case and ignore punctuation.

## Usage

Ask the agent in ZCode Desktop:

- "Compare contract-v1.docx with contract-v2.pdf and flag changes to amounts and dates"
- "What changed in the 2026 terms of service compared with 2025? Mark anything about data or AI as questioned"
- "Export the comparison report with only the questioned changes"

## Tools

| Tool | Purpose |
|---|---|
| `compare_open` | Compare two files, list every change with an id, open the review panel |
| `compare_review` | Mark changes ok / question / open with notes |
| `compare_export` | Write `doc-compare/<old>__<new>.html` and/or `.csv` |

## Scope (v0.1)

- Scanned PDFs without a text layer (OCR) are not supported.
- Formatting-only changes (bold, fonts) and table cell-level alignment are not compared. Track-changes DOCX output is not written.
- Old `.doc`, `.pages` and `.rtf`: save as DOCX first.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the two files you choose. Writes only `doc-compare/` in the workspace (review marks and reports). No hooks.

## Build and test (developers)

- Source: `ui-plugins/doc-compare/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-doc-compare test` and `test:e2e`.
- `DOC_SAMPLES` points to the test documents:
  - Two versions of the GitHub Terms of Service (CC0) as Markdown, DOCX and PDF.
  - A fictional Chinese contract in two versions.

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: pdf.js (Apache-2.0, with its CMaps and standard fonts), jsdiff (BSD-3-Clause), fflate (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
