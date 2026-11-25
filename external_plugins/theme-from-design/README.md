# Theme From Design

Turn a store design (screenshots or mock-ups) into a **Shopify Online Store 2.0** theme. The plugin provides a valid theme skeleton, the agent writes the sections from the design, and every change is checked and previewed. At the end you get a zip you can upload to Shopify.

## Defaults (v0.1)

- **Platform: Shopify Online Store 2.0 only**: Liquid sections with `{% schema %}`, JSON templates, and section groups for the header and footer.
- **Validation**: built-in checks plus **Shopify theme-check** (`@shopify/theme-check-node`, the engine behind `shopify theme check`), bundled with its documentation data and run offline with the recommended config.
- **Preview**: a local approximation using liquidjs and fictional sample data. It is not Shopify's renderer.
- **Upload**: not done. You upload the zip yourself in Shopify admin.

## Features

- **Skeleton** (`theme_new`):
  - Files: `layout/theme.liquid`, header/footer section groups, JSON templates (index, product, collection, page, cart, search, 404), and the `product-card` snippet.
  - Sections: announcement bar, header (logo + menu), footer, image banner, rich text, image with text, featured collection, product, collection grid with pagination, page, cart, search and 404.
  - Settings: `settings_schema.json` / `settings_data.json` with the colours, fonts (Shopify font handles), corner radius and page width taken from the design.
  - Locales and CSS: `en.default` and `zh-CN` locales, `base.css`, and an empty `custom.css` for design-specific styles.
- **Writing** (`theme_write`): the agent writes sections, templates, CSS and locale files. Paths are limited to the theme folders. Each write is checked straight away.
- **Built-in checks**:
  - Liquid syntax, including Shopify tags (`schema`, `style`, `form`, `paginate`, `section(s)`, `render`).
  - Schema validity, section names ≤ 25 characters, and allowed setting types only. `liquid` and `html` settings are refused.
  - Duplicate ids; select and range defaults.
  - `section.settings.*` and `block.settings.*` references must exist in the schema.
  - JSON templates and section groups must point to existing sections, block types and settings.
  - Required files.
- **Shopify theme-check** (`theme_check`): missing translations, missing assets and snippets, unknown filters and objects, deprecated filters and fonts, schema validation against Shopify's JSON schemas, and more. Each problem is reported with file and line.
- **Preview** (`theme_preview` and the panel): renders any template with sample products, collections, menus and a cart. The panel shows it next to the design image at desktop (1280 px) or mobile (390 px) width.
- **Package** (`theme_package`): zip with the theme folders at the root, ready for Online Store → Themes → Add theme → Upload zip file. It refuses while there are errors.
- **Panel**: create a theme from design images, view the design and preview side by side, pick the template and device, run the full check, open any file, and package.

## Usage

Ask the agent in ZCode Desktop:

- "Build a Shopify theme from this homepage design"
- "Add a newsletter section like the one in the design"
- "Check the theme and package it for upload"

## Tools

| Tool | Purpose |
|---|---|
| `theme_new` | Create the OS 2.0 skeleton with brand colours/fonts and link the design images |
| `theme_write` | Write or delete theme files and run the built-in checks |
| `theme_check` | Built-in checks + Shopify theme-check |
| `theme_preview` | Render a template with sample data |
| `theme_package` | Zip the theme for upload |

## Scope (v0.1)

- Only Shopify. Shopline, Youzan and WooCommerce are not supported.
- No uploading to a store, no Shopify CLI login, and no `shopify theme dev`. Use Shopify's own preview after uploading for exact rendering, apps and checkout.
- The preview supports common objects and filters only. Unknown filters pass their input through.
- Images used by sections come from the merchant's store (`image_picker`), so the preview shows placeholders for them.
- Theme Store submission requirements (accessibility audits, performance scores) are not checked beyond what theme-check reports.

## Privacy, network and files

- Runs locally: no network access and no API keys. theme-check runs offline with its bundled documentation data; its online docs update is disabled. theme-check creates an empty cache folder in the user cache directory.
- Writes `themes/<name>/`, `themes/<name>.zip` and `.theme-from-design/` (project and previews). Design images are only read. No hooks.

## Build and test (developers)

- Source: `ui-plugins/theme-from-design/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-theme-from-design test`. `THEME_SAMPLES` points to the fictional design and sections. `test:e2e` needs Chrome.

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: liquidjs (MIT), @shopify/theme-check-node / theme-check-common / theme-check-docs-updater / liquid-html-parser / theme-graph (MIT, including the theme documentation data), fflate (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`. `node-fetch` (used only for the online docs update) is replaced with an empty module.
