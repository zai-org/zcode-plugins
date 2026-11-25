# Web Archiver

Keep your own offline copies of web pages: the article text, its images, where it came from and when, and what changed since the last time you saved it.

## Features

- **Capture**: paste one or more URLs (http/https).
  - The article is extracted with Readability. Navigation, ads, scripts and forms are dropped.
  - Lazy-loaded and responsive images are resolved to the real (largest) image.
- **Each capture** goes to `web-archive/<site>/<page>/<UTC time>/`:
  - `article.html`: one self-contained offline file with images embedded, the source URL, capture time, author, publish date and site on top.
  - `article.md`: Markdown with front matter (title, source, captured, author, published); images in `assets/`.
  - `source.html`: the page exactly as downloaded. `text.json`: the article paragraphs. `meta.json`: metadata, including image failures.
  - `screenshot.png` (optional): a full-page screenshot taken with your local Chrome, Edge or Chromium in headless mode, using a temporary profile.
  - `web-archive/index.json` and `index.md` list every page and capture.
- **Changes**: capturing the same URL again compares the article text with the previous capture.
  - Added, removed and edited paragraphs are listed; edits are shown word by word, or character by character for Chinese.
  - The result is saved as `changes.html`. "Text unchanged" when nothing changed.
- **Encodings**: UTF-8, GBK/GB18030, Big5 and other charsets declared in the header or `<meta charset>`.
- **Panel**: paste URLs, capture, browse the archive by page and capture time, read the offline copy, view the changes and the screenshot.

## Usage

Ask the agent in ZCode Desktop:

- "Archive these three articles for my research notes, with screenshots"
- "Capture the pricing page again and tell me what changed since last time"
- "Read the archived copy of the Wikipedia article and summarise it"

## Tools

| Tool | Purpose |
|---|---|
| `archive_capture` | Capture URLs (article, images, offline HTML, Markdown, optional screenshot) and compare with the last capture |
| `archive_list` | Archived pages and their captures |
| `archive_diff` | Compare two captures of a URL and write `changes.html` |
| `archive_read` | Read a capture's Markdown |

## Scope (v0.1)

- Pages behind a login, paywalls and infinite scrolling are not supported.
- Pages whose content is built by scripts may extract incompletely; the screenshot still shows the rendered page.
- Videos, embedded frames and fonts are not saved. Linked pages are not followed.

## Privacy, network and files

- **Network**: only the URLs you give and the images inside those articles are downloaded, with a timeout and size limits. No other services, no API keys or accounts.
- Screenshots start your local browser with a fresh temporary profile (no cookies or logins) that is deleted afterwards. Set `WEB_ARCHIVER_BROWSER` to use a specific browser.
- Writes only `web-archive/` in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/web-archiver/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-web-archiver test` (local test server). `WEB_SAMPLES` points to saved real pages for the extraction tests. `test:e2e` needs Chrome and network.

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: @mozilla/readability (Apache-2.0), linkedom (ISC), turndown and turndown-plugin-gfm (MIT), domino (BSD-2-Clause), jsdiff (BSD-3-Clause), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
