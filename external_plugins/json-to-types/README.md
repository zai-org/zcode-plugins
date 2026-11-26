# JSON to Types

Paste-free type generation: point it at sample JSON — an API response, a config file, a JSONL log — and get TypeScript interfaces, Zod schemas, JSON Schema, Python dataclasses and Go structs. Multiple samples are merged so fields that are sometimes missing become optional and nulls become nullable; dates, emails and URLs are recognised; nested objects get proper names. Mark fields and add descriptions in a table before exporting. Runs locally; no API keys.

## Features

- **Five outputs**: TypeScript interfaces, Zod schemas (in dependency order, with z.infer types), JSON Schema 2020-12 with $defs, Python dataclasses, Go structs with json tags.
- **Learns from many samples**: all files and every array element are merged — optional and nullable fields, integer vs number, unions for mixed types.
- **Formats**: date-time, date, email, url and uuid strings (Zod .datetime()/.email(), JSON Schema format, Go time.Time).
- **Good names**: nested objects become named types (customer → Customer, items → Item); awkward keys are quoted or mapped (Python id → id_ with a comment).
- **Your edits**: mark fields optional/nullable and add descriptions, which become doc comments and schema descriptions.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `json-to-types/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Generate TypeScript types for data.orders in orders-api.json"
- "Also give me a Zod schema and Go structs"
- "Mark note as optional with the description 发票备注"

## Tools

| Tool | Purpose |
|---|---|
| `jsontypes_open` | Infer types from JSON samples and list every field. Opens the panel |
| `jsontypes_edit` | Change settings, edit cells by row, add or remove rows |
| `jsontypes_status` | Show the current rows, issues and summary |
| `jsontypes_export` | Write types.ts, schema.zod.ts, schema.json, models.py and models.go |

Output goes to `json-to-types/<project>/` in the workspace.

## Scope (v0.1)

- Types are only as good as the samples — fields never seen can't be generated.
- No enums or string literal unions in v0.1; recursive structures are typed per level.
- Up to 20 sample files.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `json-to-types/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/json-to-types/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-json-to-types test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
