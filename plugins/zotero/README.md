# Zotero for ZCode

[简体中文](README_CN.md) | English

Work with your Zotero library next to the conversation. The agent searches your papers, reads their PDFs page by page together with your own highlights, points at evidence by highlighting passages in the PDF, writes citations and `.bib` files, and can import papers, write notes and organise collections. You browse the same library in a side panel, read PDFs there, and send papers or passages to the agent.

This is an independent integration built on Zotero's local API; it is not made by the Zotero project.

The Git marketplace package contains the compiled MCP server and panel; nothing needs to be built. It needs:

- Node.js 24+ and a ZCode Desktop build with Plugin UI support in a local workspace (web, phone and remote workspaces show plain tool records instead of the panel);
- the Zotero desktop app running on the same computer, with *Settings → Advanced → Allow other applications on this computer to communicate with Zotero* turned on;
- Zotero 7 or later to read; **Zotero 8 or later to make changes** (Zotero 7's local API is read-only — the plugin detects this and turns writing off).

## Use

Install and enable `zotero`, then ask for example:

- "What do the papers in my *Reachability Types* collection say about cyclic references? Show me where."
- "What did I highlight about effect systems last month?"
- "Write the related-work paragraph for my draft and keep `paper/refs.bib` in sync with the *Alias Control* collection."
- "Add arXiv 2503.07328 to my *PL* collection and tag it to-read."

You can also open the panel from the side pane "+" menu.

### Panel

- **Setup** when Zotero is not ready: a checklist of the Zotero app, whether it is open and whether its local API is on. If Zotero is missing or too old, **Send to agent** posts a ready-made message (your system, where the panel looked, your package managers) so the agent installs it, and *Install it yourself* shows the command for your system. If it is installed but closed, **Open Zotero** starts it. If the local API is off, the panel shows exactly which box to tick in Zotero's settings. The panel connects by itself as soon as Zotero answers.
- **Library**: pick My Library, a group library, a collection or a saved search; search titles, authors and years, or full text and notes too; sort; load more. Each row shows the type, authors, year and venue, and a **PDF** chip that opens the reader.
- **Selecting items**: tick items (Shift-click for a range), then **Add to chat** puts them into the agent's context for your next message, or **Ask** sends your question together with the items.
- **Item details**: authors, venue, abstract, your annotations and the agent's highlights, notes, fields, collections, tags and attachments; **Show in Zotero** jumps to the item in the Zotero app.
- **Reader**: the PDF with your Zotero annotations (highlights, underlines, notes, image boxes) and the agent's highlights, marked ✦ in purple. Click a highlight to see its comment; save an agent highlight into Zotero or remove it. Select text to **Quote in chat** (adds the passage with page and item to the agent's context) or **Ask** about it. Page box, zoom, fit width, an annotation sidebar, and **Show in Zotero** opens the PDF in Zotero's own reader.
- Lists the agent shows (`show_items`) appear under a "From the agent" heading; **Back** returns to where you were.
- Changes you make in Zotero appear in the panel within a few seconds. The panel follows ZCode's theme (light / dark) and language (English / Simplified Chinese).

### Tools

| Tool | Purpose |
| --- | --- |
| `list_collections` | Connection status, libraries, collection tree, saved searches |
| `search_library` | Search items by text (optionally full text and notes), collection, tag or saved search |
| `get_item` | Full metadata, abstract, notes and the user's annotations |
| `search_annotations` | The user's highlights and comments across the library |
| `read_fulltext`, `find_in_pdf` | PDF text by page, and phrase search with page numbers |
| `cite` | BibTeX / BibLaTeX / CSL-JSON / RIS, or formatted citations in a CSL style |
| `open_item`, `show_items` | Show a PDF (at a page or quote), an item, or a list of items in the panel |
| `highlight`, `clear_highlights` | Agent highlights with comments in the reader (this session) |
| `save_highlights` | Save agent highlights into Zotero as annotations |
| `add_item`, `attach_pdf` | Import by DOI or arXiv id, or from metadata; attach PDFs from a URL or workspace file |
| `update_item`, `add_note`, `create_collection` | Edit fields, tags and collections; Markdown notes; new collections |
| `export_bib` | Write a `.bib` file into the workspace from a collection and/or items |
| `authorize_writes` | Ask for write access ahead of time |

### Permissions, privacy and network

- The plugin only talks to Zotero on this computer (`127.0.0.1:23119`; another port can be set in the plugin setting *Zotero address*, loopback addresses only). Reading needs no permission.
- **Writing** goes through Zotero's own permission dialog: the first change shows *Allow* / *Always Allow* / *Deny* in Zotero. With *Always Allow*, the key Zotero issues is stored in the plugin's private data folder (file mode 0600) and reused; with *Allow*, Zotero asks again for each change. You can revoke keys in Zotero. ZCode additionally asks for approval before tool calls as configured.
- The plugin cannot delete items, and changes only what the tools describe. Agent highlights stay in the session until saved.
- PDFs are read from the paths Zotero reports for their attachments; nothing else on disk is read. `.bib` exports and workspace PDFs are limited to the workspace, and exports never contain local file paths.
- Network access happens only for importing: `add_item` fetches metadata from `doi.org` or `export.arxiv.org`, downloads arXiv PDFs, and downloads PDFs from links the agent passes. Downloads must be real PDFs up to 100 MB.

## Build from source

The source is in `ui-plugins/zotero`. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
```

Add the absolute path of `dist/local-marketplace` as a local marketplace in the plugin store, then install and enable `zotero`. After source changes, rebuild, refresh the source, reinstall the plugin and test in a new session.

Tests (from `ui-plugins/zotero`):

```sh
pnpm test        # unit and integration tests against a simulated Zotero local API
pnpm test:e2e    # built server and panel in Chrome through the official AppBridge host
pnpm test:setup  # the setup page in Chrome: missing Zotero, hand-off to the agent, Open Zotero, local API off
pnpm live        # read-only checks against the Zotero running on this computer
pnpm live --write  # also creates, then deletes, a test collection and items (Zotero asks for permission)
```
