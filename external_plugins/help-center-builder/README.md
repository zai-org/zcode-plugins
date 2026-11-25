# Help Center Builder

Turn a folder of **Markdown / HTML** docs into a **static help center** with category navigation, breadcrumbs, related articles and instant **full-text search** that works offline. When you edit docs, an **incremental build** rewrites only the pages the change affects and tells you why.

## What it does

- **Reads your docs**:
  - Sub-folders become categories; files at the top level go to “General”.
  - Front matter: `title`, `description`, `order`, `tags`, `related`, `updated`, `category`, `draft`. Without a title, a leading `#` / `##` / setext heading is used.
  - An `index.md` in a folder becomes that category's intro; a top-level `index.md` becomes the home page's.
  - HTML files (for example CMS exports) are supported: title, meta description and tags are read; navigation, scripts and inline handlers are removed.
- **Optional `help-center.json`** in the docs folder: `title`, `description`, `accent` colour, `logo`, `footer`, `baseUrl`, `lang`, and category names, descriptions and order.
- **Generates** `help-center/`:
  - Home page with a search hero and category cards; category pages with article lists.
  - Article pages: breadcrumbs, sidebar (the category's articles plus all categories), “On this page” table of contents, related articles (your `related` first, then shared tags and similar titles), and previous / next.
  - Search page and 404 page; `sitemap.xml` and canonical links when `baseUrl` is set.
  - Responsive, light and dark themes. English or Chinese interface, detected automatically.
  - Images and other files are copied, and `.md` links are rewritten to `.html`.
- **Search**: built with [MiniSearch](https://github.com/lucaong/minisearch) at build time and shipped as a script.
  - Works on any static host and straight from disk (`file://`), with no server or external service.
  - Prefix and fuzzy matching; titles, tags and headings weigh more; Chinese / Japanese / Korean are split into characters and pairs.
  - Live dropdown with keyboard navigation (`/` focuses the box), plus a results page.
- **Incremental builds**:
  - Each page records what it depends on: its content, its category's article list, the categories, its related articles, previous / next, site settings and the template.
  - Only pages whose dependencies changed are rewritten, each listed with the reason (for example “related articles changed”). Deleted articles are removed, and changed images re-copied.
  - Use **Full rebuild** to rewrite everything.
- **Checks**: broken links to articles or files, missing `#anchors`, links outside the docs folder, two files producing the same page, missing or duplicate titles, empty articles, unknown `related`, drafts.

## Usage

Ask the agent in ZCode Desktop:

- "Build a help center from the docs folder"
- "I edited a few articles; update the help center"
- "Check the help docs for broken links"

Or use the panel: choose the docs folder, then **Build help center**; later, **Build changes**. Browse the site map and preview any page, and see which pages were rewritten and why. Open `help-center/index.html` in a browser, or upload the folder to a static host (Cloudflare Pages, Netlify, GitHub Pages, S3…).

## Tools

| Tool | Purpose |
|---|---|
| `hc_scan` | Categories, articles and problems in a docs folder (writes nothing) |
| `hc_build` | Build or update the site (incremental; `full` to rewrite everything) |

## Scope (v0.1)

- Hosting is up to you: the output is a plain static folder. Deploying it (for example to Cloudflare Pages) is a separate step.
- No feedback buttons, analytics, comments or login-protected articles (they need a backend).
- One language per site. Code blocks aren't syntax-highlighted. MDX, Liquid and other templating aren't run.

## Privacy, network and files

- Runs locally with no network access and no API keys. The generated site loads nothing from other servers.
- Reads the docs folder. Writes the output folder and `.help-center/builds.json`, and deletes only pages it wrote earlier.

## License

MIT. Uses [marked](https://github.com/markedjs/marked) (MIT), [MiniSearch](https://github.com/lucaong/minisearch) (MIT; also shipped in each generated site) and [yaml](https://github.com/eemeli/yaml) (ISC).
