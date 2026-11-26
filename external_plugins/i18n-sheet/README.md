# i18n Sheet

See every translation of your app side by side: open the locale files (JSON or YAML) and get one row per key and one column per language. Missing and empty strings, placeholders that don't match ({name}, %s, {{count}}…), changed HTML tags and text that was never translated are flagged. Fix things in the grid, hand an Excel sheet to translators, import their sheet back and write the locale files out in the same format. Runs locally; no translation service or API keys.

## Features

- **One grid for all languages**: JSON and YAML, nested or flat keys, arrays, Rails-style `ja:` roots; the language comes from the file or folder name (zh-CN.json, fr/common.json).
- **Placeholder check**: {name}, {{name}}, %s, %1$s, %{name}, ${name} and ICU {count, plural…} must match the base language — mismatches block export.
- **Gaps and drift**: missing or empty strings, keys that only exist in other languages, HTML tag differences and strings identical to the base language.
- **Translator round trip**: export translations.xlsx with missing cells highlighted and placeholders listed, then open the filled-in sheet (or a CSV) with the files to import it.
- **Faithful write-back**: same format, nesting, key order and indentation; missing strings can be left out, filled from the base language or written empty.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `i18n-sheet/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Open locales/en.json, zh.json and ja.yml and show what's missing"
- "Export a sheet for the translators"
- "Import ja-done.xlsx and write the locale files back"

## Tools

| Tool | Purpose |
|---|---|
| `i18n_open` | Read the locale files into one grid and check them. Opens the panel |
| `i18n_edit` | Change settings, edit cells by row, add or remove rows |
| `i18n_status` | Show the current rows, issues and summary |
| `i18n_export` | Write the locale files back and translations.xlsx |

Output goes to `i18n-sheet/<project>/` in the workspace.

## Scope (v0.1)

- One namespace at a time (e.g. all common.json files); open other namespaces as separate projects.
- Does not translate anything itself — no machine translation service.
- YAML comments and anchors are not preserved when the file is written back.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `i18n-sheet/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/i18n-sheet/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-i18n-sheet test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), yaml (ISC), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
