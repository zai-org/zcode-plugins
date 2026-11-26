# License Report

Know what licences you ship: scan a Node.js project's installed dependencies (direct and transitive, npm, yarn or pnpm) and get every package's licence normalised to SPDX, classed as permissive, weak copyleft, strong copyleft, proprietary or unknown. GPL/AGPL and missing licences are flagged until you review them; fix a licence by hand and add a note. Export an Excel report for legal and a THIRD_PARTY_NOTICES.txt to ship with your app. Runs locally on node_modules; no online lookup or API keys.

## Features

- **Every installed package**: walks node_modules including nested and pnpm (.pnpm) layouts, falling back to package-lock.json; direct vs transitive and prod vs dev are shown.
- **Licence found and normalised**: package.json license/licenses, else recognised from the LICENSE file text; “Apache 2.0”, “MIT License”, “GPLv3” and SPDX OR/AND expressions are normalised.
- **Risk classes**: permissive, public domain, weak copyleft (LGPL, MPL, EPL), strong copyleft (GPL, AGPL, SSPL), proprietary and unknown — risky ones are flagged until marked reviewed.
- **Corrections with notes**: type the right licence for a package and note why; the source column shows it was edited.
- **Two outputs**: an Excel report with colour-coded categories and a summary by licence, and THIRD_PARTY_NOTICES.txt with copyright lines and full licence texts for production dependencies.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `license-report/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "List the licences of web-app's dependencies"
- "Which packages are GPL or have no licence?"
- "Make THIRD_PARTY_NOTICES.txt for the release"

## Tools

| Tool | Purpose |
|---|---|
| `licenses_open` | Scan the installed dependencies and classify their licences. Opens the panel |
| `licenses_edit` | Change settings, edit cells by row, add or remove rows |
| `licenses_status` | Show the current rows, issues and summary |
| `licenses_export` | Write license-report.xlsx and THIRD_PARTY_NOTICES.txt |

Output goes to `license-report/<project>/` in the workspace.

## Scope (v0.1)

- Node.js projects only in v0.1 (Python, Go and others later).
- Dependencies must be installed (or a package-lock.json present); nothing is fetched from the registry.
- This is an aid, not legal advice — have someone qualified review copyleft findings.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `license-report/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/license-report/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-license-report test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
