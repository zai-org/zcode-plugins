---
name: typst
description: Write and fix Typst documents (.typ) with a live preview in the Typst side panel — compile with the user's own Typst, read errors with file:line and hints, look at rendered pages as images, point at places in the preview, and export PDFs. Use when the user works on a Typst document (papers, theses, reports, letters, CVs, slides with touying/polylux), mentions Typst or a .typ file, asks to typeset or lay out something in Typst, or when the panel sends a selection, a source location or Typst problems.
---

# Typst workbench

The plugin runs the user's own `typst` (their fonts, packages and version) as a long-running `typst watch` and shows the result in the Typst side panel. **The preview updates by itself whenever a file is saved** — edit `.typ` files with your normal file tools; the plugin never edits files.

## 1. Orient

- Call `status` first. It opens the panel and reports the Typst version, the main file, the other `.typ` files and the latest compile result.
- `typst_missing` / `typst_too_old` / `typst_error`: Typst is not usable. Tell the user, and point them at the Typst panel: it lists what is missing and can send you a setup request with the facts it detected. Do not install software unless the user asks — a message from the panel starting *Set up Typst*, *Update Typst* or *Fix Typst for the Typst panel* is such a request (see section 7).
- `no_main`: pick the file the user would pass to `typst compile` (the one that `#include`s or `#import`s the others) and call `set_main`; ask if it is unclear. If there are no `.typ` files, create `main.typ` — the panel picks it up.
- Follow the project's existing structure and conventions (templates, `#import`ed packages, file layout). Use the user's Typst version's syntax; `status` tells you the version.

## 2. The edit loop

1. Edit the source files.
2. Call `check` right after editing. It waits until Typst has compiled every change already on disk and returns errors and warnings as `file:line:column`, the source line, Typst's `hint:` lines and the call trace (`from …`). Fix errors at the reported location; follow the hints.
3. While the document has errors the panel keeps showing the last version that compiled, so fix errors before asking the user to look.
4. When layout matters (overfull lines, figure and table placement, page breaks, title pages, slides), call `render_pages` for the affected pages (at most 4 per call; default 110 ppi, raise `ppi` to inspect details) and look at the images. Compile errors do not catch layout problems.

Do not run `typst compile` or `typst watch` in a shell for previewing; use these tools. A shell `typst` is fine for one-off tasks the tools do not cover (e.g. `typst fonts`, `typst query`).

## 3. Point at things in the preview

- `show` with `page` scrolls the panel to a page.
- `show` with `quote` highlights rendered text (copy the words as they appear in the document; markup is ignored), or with `file` + `line` (+ `endLine`) highlights what those source lines produce. Add a short `comment` explaining why. Use this after making a change the user should look at, or when answering "where is …".
- Highlights follow the text as the document changes and last for the session; `clear_highlights` removes them.

## 4. What the user sends from the panel

- A quoted passage followed by `— Typst preview, page N` and `Source (file:line):` with a code excerpt is text the user selected or ⌘-clicked in the preview, with the matching source. The location is found by matching text, so it is usually right for prose and approximate for math, generated text (numbering, outlines, bibliographies) and text produced by functions — check the excerpt.
- A message starting *Fix the Typst problems in …* lists the current diagnostics; fix them and run `check`.
- Selections added with *Add to chat* arrive as context, not as a request — use them when the user's next message refers to "this" or "here".

## 5. Export

`export_pdf` compiles with the user's Typst and writes a PDF into the workspace (e.g. `export_pdf { path: "paper.pdf" }`), optionally with a PDF standard (`pdfStandard: "a-2b"`) or a page selection. The preview's own PDF is not in the workspace.

## 6. Citations

Typst reads BibTeX (`.bib`) and Hayagriva (`.yml`) files with `#bibliography("refs.bib")` and cites with `@key`. If the Zotero plugin is available, use its `export_bib` to write the `.bib` file and use the citation keys it returns; never invent keys.

## 7. Setting up Typst

When the user asks you to install, update or fix Typst — usually with the panel's message, which lists the operating system, the folders it searched and the package managers it found — follow its steps:

- Use the package manager the message names: `brew install typst` (Homebrew), `winget install --id Typst.Typst`, `scoop install typst`, or `cargo install --locked typst-cli`. Without one, use a release from https://github.com/typst/typst/releases. Update an old Typst with the tool that installed it.
- Ask before using `sudo`, installing a package manager, or editing shell profiles.
- Confirm with `typst --version` (0.12 or later).
- The panel looks on PATH, in the usual install folders (Homebrew, `~/.cargo/bin`, `~/.local/bin`, …) and in the login shell. If Typst ends up somewhere else, give the user the full path for the plugin setting *Typst path*.
- The panel checks again every few seconds and starts the preview by itself; then call `status`.
