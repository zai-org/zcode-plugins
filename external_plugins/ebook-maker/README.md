# Ebook Maker

Turn a folder of Markdown chapters into an EPUB and a print-ready PDF, with checks before you publish.

## Features

- **Input**: a folder with one Markdown file per chapter, images and a cover.
  - Chapters are ordered by file name (`01-…`, `02-…`) or by the order saved in `book.json`.
  - Standard Markdown plus tables, footnotes (`[^1]` / `[^1]: …`), code blocks, quotes, nested lists and links between chapters (`02-next.md#heading`).
- **EPUB 3**:
  - Cover, title page, navigation (also `toc.ncx` for older readers), one XHTML file per chapter, a stylesheet and the images.
  - Footnotes become linked notes at the end of each chapter.
  - Links between chapters and headings work in the reader. Every file is checked as well-formed XML.
- **PDF** (A5 by default, also B6 and A4):
  - Cover, title page and a contents page with page numbers.
  - Running heads (book title / chapter title), page numbers, and each chapter on a new page.
  - Footnotes as numbered endnotes after each chapter.
  - Chinese line breaking (no closing punctuation at line start) and justified text. Images are scaled to the page.
  - Bookmarks for every chapter; contents entries, footnote numbers and links are clickable.
  - Uses a Chinese system font (PingFang/Hiragino on macOS, YaHei/SimHei on Windows, Noto CJK on Linux).
- **Checks**:
  - Missing images; broken links between chapters and missing heading anchors; footnotes used but not defined, or defined but unused.
  - Image formats the PDF cannot use; missing title, author or cover.
  - A list of all external links with chapter and line.
- **Panel**: book details (title, subtitle, author, language, publisher, date, blurb, cover, contents depth, PDF size and font size), chapter order, a chapter preview, the checks and a page-by-page view of the exported PDF.

## Usage

Ask the agent in ZCode Desktop:

- "Make an EPUB and a PDF from the chapters in 书稿/"
- "Check my book for missing images and broken links, and list the external links"
- "Set the title, author and cover, put the preface first, then export A5 PDF"

## Tools

| Tool | Purpose |
|---|---|
| `ebook_open` | Read a book folder, list chapters and problems, open the panel |
| `ebook_save` | Save metadata, chapter order and PDF options to `book.json` |
| `ebook_check` | Every problem with file:line, plus all external links |
| `ebook_export` | Write `export/<title>.epub` and/or `.pdf` |

## Scope (v0.1)

- No multi-column layouts, floating images or custom page templates.
- No Kindle formats (KF8/AZW3); most Kindle apps and Send to Kindle accept EPUB.
- No math typesetting. GIF, SVG and WebP images go into the EPUB only; the PDF shows their description instead.
- Remote images (http links) are not downloaded.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads the book folder you choose. Writes only `book.json` and `export/` inside it. No hooks.

## Build and test (developers)

- Source: `ui-plugins/ebook-maker/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-ebook-maker test` and `test:e2e`.
- `EBOOK_SAMPLES` points to the sample books: three stories from Lu Xun's *Call to Arms* (吶喊) and the first two chapters of *Alice's Adventures in Wonderland*, all public domain.

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: marked (MIT), pdf-lib (MIT), fontkit (MIT), fflate (MIT), fast-xml-parser (MIT), pdf.js (Apache-2.0, with its CMaps and standard fonts, for the panel's PDF view), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
