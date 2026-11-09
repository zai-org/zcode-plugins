---
name: zotero
description: Work with the user's Zotero library in the Zotero side panel — search papers, read their PDFs page by page and the user's own highlights, point at evidence with highlights in the PDF, cite (BibTeX / CSL styles) and keep a .bib file in the workspace, and add or organise items (arXiv / DOI import, notes, tags, collections). Use when the user mentions Zotero, their library, papers or references they have collected, citations or a .bib file, literature questions ("what do my papers say about…", "what did I highlight…"), or when the panel sends Zotero items or a quoted passage.
---

# Zotero

The plugin talks to the Zotero desktop app on this machine through its local API. The Zotero side panel shows the library, item details and a PDF reader; the user can select items or text there and send them to you. Use this plugin's tools for everything in Zotero: never read or write `zotero.sqlite` or the `storage` folder directly, and do not scrape the Zotero app.

Items are addressed by 8-character keys such as `7ERC5QFW`. A PDF is its own attachment item with its own key; tools that read PDFs accept either the parent item's key or the attachment's key.

## 1. Orient

- Call `list_collections` first in a conversation about the library. It reports whether Zotero is running, whether writes are possible, the collection tree and saved searches.
- `zotero_not_running`: Zotero is installed but closed; ask the user to start it (the panel has an *Open Zotero* button). `zotero_not_installed`: Zotero is not on this computer; tell the user, and offer to install it (section 7) — the panel can send you a setup request with the facts it detected. `local_api_disabled`: tell them to enable *Settings → Advanced → Allow other applications on this computer to communicate with Zotero* (the panel shows the steps). Do not retry in a loop.

## 2. Find and read

- `search_library` searches titles, creators and years; with `mode: "everything"` it also searches PDF full text, notes and annotations. Filter by `collection` (key or name, `Parent/Child` for nested), `tag` or `savedSearch`.
- `get_item` returns metadata, abstract, notes and the user's annotations. Read it before discussing a paper.
- `search_annotations` finds the user's own highlights and comments across the library — use it for "what did I highlight / note about X".
- `read_fulltext` returns PDF text with `--- page N ---` markers (physical page numbers; printed page labels are shown when they differ). Read a range with `pages` (e.g. `"1-3"`); long documents stop at `maxChars` and tell you where to continue. Prefer reading the abstract, introduction and the relevant sections over dumping whole books.
- `find_in_pdf` locates a phrase and returns page numbers with context.

When you state what a paper says, ground it in text you have read and give the page (use the printed label when quoting for a citation, e.g. "p. 15"). If you have not read the relevant part, say so or read it.

## 3. Show evidence in the panel

- `highlight` marks a passage in the PDF with your comment and opens the reader there. Copy the quote from `read_fulltext` / `find_in_pdf` output; short distinctive quotes (a sentence) work best; `"start … end"` spans a longer passage. On `quote_not_found`, re-read the page and copy the text exactly.
- Highlights last for the session. Save them into Zotero only when the user wants that (`save: true`, or `save_highlights`), because it changes their library.
- `open_item` opens a PDF at a page or quote, or an item's details. `show_items` lists the papers you used under a heading — do this after answering a literature question so the user can browse the sources.

## 4. What the user sends from the panel

- A message ending with `Zotero items: - [KEY] Title …` refers to those items; a quoted passage ends with `— “Title”, page N (Zotero item KEY, PDF KEY)`. Use those keys directly.
- Selections the user adds with *Add to chat* arrive as context, not as a request — use them when the user's next message refers to "this", "these papers" or "the selected passage".

## 5. Citations and .bib files

- For LaTeX or Markdown documents, use `export_bib` to write a `.bib` file into the workspace (default `references.bib`) from a collection and/or keys, and cite with the citation keys it returns. Never invent citation keys; rerun `export_bib` after adding papers. Local file paths are removed from exports.
- `cite` returns BibTeX / BibLaTeX / CSL-JSON / RIS entries, or formatted text in a CSL style (`format: "text"`, `style: "apa"`, `"ieee"`, `"chicago-author-date"`, …) with in-text citations.

## 6. Changing the library

Writes go through Zotero's own permission dialog (Zotero 8 or later). The first write asks the user in Zotero to *Allow*, *Always Allow* or *Deny*; tell them to look at Zotero and suggest *Always Allow* to avoid repeated prompts. On `write_denied`, stop and do not retry unless asked; on `writes_unsupported`, explain that this Zotero version is read-only.

- `add_item` with a DOI or arXiv id (or link) fetches metadata from doi.org / arXiv and skips papers already in the library (same DOI). arXiv PDFs are attached automatically; for other papers pass `pdfUrl` only for a direct, openly available PDF link, or `pdfPath` for a PDF in the workspace — do not try to get around paywalls. For books, reports and anything without an identifier, pass `metadata` with an `itemType` and fields.
- `update_item` sets fields and adds/removes tags and collections; `add_note` writes Markdown notes (child notes or standalone); `create_collection` makes collections; `attach_pdf` adds a PDF to an existing item.
- Ask before bulk changes (many items, removing tags or collections). The plugin cannot delete items; if the user wants something deleted, tell them to do it in Zotero.
- After writing, mention what changed and where (the panel shows the item).

## 7. Setting up Zotero

When the user asks you to install or update Zotero — usually with the panel's message *Set up Zotero for the Zotero panel*, which lists the operating system, where it looked and the package managers it found — follow its steps:

- Install Zotero 7 or later with the package manager the message names: `brew install --cask zotero` (Homebrew), `winget install --id DigitalScholar.Zotero -e --source winget --accept-source-agreements --accept-package-agreements`, or `flatpak install flathub org.zotero.Zotero`. Otherwise use the official installer from https://www.zotero.org/download/. Ask before using `sudo`.
- Open Zotero once so it creates its profile (on macOS `open -a Zotero`).
- The local API switch is a checkbox in Zotero's own settings: walk the user through *Settings → Advanced → Allow other applications on this computer to communicate with Zotero* (on Windows and Linux the menu is *Edit → Settings…*). Do not edit Zotero's preference files.
- The panel checks again every few seconds and connects by itself; then call `list_collections`.
