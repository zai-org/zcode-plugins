# Offline Site Packer

Turn a built **static website** (docs, help centre, product site) into an offline copy that opens by double-clicking `index.html`, with no server and no internet.

## What it does

- **Crawl**: starts at `index.html` and follows every internal link (`<a>`, `<link>`, `<script>`, `<img>`, `srcset`, `<source>`, `<video poster>`, `<iframe>`, inline styles, `<style>` blocks, CSS `url()` and `@import`).
- **Fix links for file://**:
  - Root-relative (`/css/site.css`), pretty (`/guide/`) and extension-less (`/guide/install`) URLs become relative file paths (`../css/site.css`, `guide/index.html`, `guide/install.html`). Anchors are kept.
  - With **Public URL** set, absolute links to the live site (`https://docs.example.com/…`) are made local too.
- **Collect files**: only pages and files that are actually used are copied. Pages and files nothing links to are listed, and can be included on request.
- **Offline search**: every page gets a search box (button or ⌘K / Ctrl+K) backed by a **MiniSearch** index stored as a JS file, so it works from `file://`.
- **Report**:
  - Broken links and missing files (with the page they are on).
  - External links (which need internet).
  - Orphan pages and unused files.
  - Scripts that use `fetch()`, which browsers block on `file://`.
- **Output**: `<site>-offline/` plus `<site>-offline.zip`. The original site is never changed.

## Usage

Ask the agent in ZCode Desktop:

- "Make an offline copy of the docs site in dist/"
- "Check this site for broken links"
- "Pack the help site into a zip that works without internet"

Or use the panel: choose the folder, optionally enter the public URL, then **Check only** or **Pack for offline**.

## Tools

| Tool | Purpose |
|---|---|
| `site_check` | Crawl and report without writing anything |
| `site_pack` | Write the offline folder (+ zip) with rewritten links and search |

## Scope (v0.1)

- Static, already-built sites only. Run your generator first (Hugo, Docusaurus, VitePress, Jekyll and so on). Sites that need a server (PHP, APIs, SPA routing without a static export) are out of scope.
- JavaScript is copied unchanged. Features that `fetch()` local data will not work from `file://`, and the report warns about them.
- External resources (CDN fonts and scripts, embedded videos) are not downloaded; they are listed as external links.
- The output folder must be outside the site folder. An existing output folder is replaced only if this plugin created it.

## Privacy, network and files

- Runs locally with no network access and no API keys.
- Reads the site folder. Writes the output folder, the zip, and `.offline-site-packer/last.json` (the last report).
