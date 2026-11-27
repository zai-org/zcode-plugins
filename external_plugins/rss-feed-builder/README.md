# Feed Builder

Let readers subscribe to your blog: turn a folder of Markdown posts into RSS, Atom and JSON Feed files in one go. Titles, dates, tags and summaries come from front matter (or the heading and file name), drafts stay out, and links follow your site's URL pattern. Choose excerpts or full posts — images and links are made absolute so they work in feed readers. Runs locally; no feed service or API keys.

## Features

- **Three formats**: RSS 2.0 with content:encoded and dc:creator, Atom 1.0 and JSON Feed 1.1, all from one list.
- **Reads your posts**: YAML front matter (title, date, description, tags, slug, author, draft), else the first heading, a date in the file name or the file date.
- **Links your way**: patterns such as {site}/posts/{slug}/ or {site}/{yyyy}/{mm}/{slug}.html; duplicates are caught.
- **Excerpt or full post**: excerpt up to <!-- more --> or the first paragraph; Markdown rendered to HTML with relative images and links made absolute.
- **Checks before export**: missing site URL, unreadable dates, empty titles and slugs; dates without a time zone use the one you set.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `rss-feed-builder/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make an RSS feed for the posts folder, site https://tea.example"
- "Use full posts and only the latest 10"
- "Change the link pattern to {site}/{yyyy}/{slug}.html"

## Tools

| Tool | Purpose |
|---|---|
| `feed_open` | Read the posts and plan the feed. Opens the panel |
| `feed_edit` | Change settings, edit cells by row, add or remove rows |
| `feed_status` | Show the current rows, issues and summary |
| `feed_export` | Write feed.xml, atom.xml and feed.json |

Output goes to `rss-feed-builder/<project>/` in the workspace.

## Scope (v0.1)

- Markdown posts only; HTML-only sites are not read in v0.1.
- Does not upload the feed — copy the files to your site.
- Shortcodes from Hugo/Jekyll themes are left as text.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `rss-feed-builder/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/rss-feed-builder/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-rss-feed-builder test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: marked (MIT), yaml (ISC), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
