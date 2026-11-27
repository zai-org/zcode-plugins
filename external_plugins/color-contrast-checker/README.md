# Contrast Checker

Check your colour tokens against WCAG contrast rules and fix the pairs that are hard to read. Open your CSS, SCSS or JSON design tokens: text-on-background pairs are found from your CSS rules and token names (including dark-theme overrides and var() chains), or you list them yourself. Every pair shows its ratio and AA/AAA result, with the nearest passing colour — same hue, just lighter or darker — as a suggested fix. Accept fixes or type your own colour, see every pair re-checked, then export fixed token files and a report. Runs locally; no upload or API keys.

## Features

- **Reads your tokens**: CSS custom properties, SCSS $vars, LESS @vars, JSON (nested or W3C $value), with var() and {ref} chains resolved.
- **Finds pairs**: CSS rules with both color and background; names like button-text/button-bg and on-primary/primary; every text colour on the main background; or your own list.
- **Themes**: .dark and other scopes are checked with their overrides.
- **WCAG 2 levels**: AA or AAA, for normal text, large text or UI parts.
- **Nearest passing colour**: same hue and saturation, only lightness changes; the fix goes to the variable that actually holds the colour.
- **Re-checked together**: when one colour is used by several pairs, every pair is checked again with all fixes applied.
- **Output**: fixed copies of your files (same formatting) and a Markdown + CSV report.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `color-contrast-checker/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Check tokens.css for WCAG AA contrast"
- "Which text colours fail on the dark theme?"
- "Fix the failing colours but keep the brand hue"

## Tools

| Tool | Purpose |
|---|---|
| `contrast_open` | Read the token files, find colour pairs and check each one. Opens the panel |
| `contrast_edit` | Change settings, edit cells by row, add or remove rows |
| `contrast_status` | Show the current rows, issues and summary |
| `contrast_export` | Write fixed token files, contrast-report.md and .csv |

Output goes to `color-contrast-checker/<project>/` in the workspace.

## Scope (v0.1)

- WCAG 2.x contrast ratio only (not APCA); colours with transparency are blended over white.
- Colours set inline in HTML or JS aren't read.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `color-contrast-checker/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/color-contrast-checker/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-color-contrast-checker test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
