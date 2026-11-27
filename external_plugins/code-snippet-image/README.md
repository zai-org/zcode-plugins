# Code Snippet Image

Turn code into clean images for slides, docs and posts: syntax highlighting for TypeScript/JavaScript, Python, Go, Rust, Java, C/C++, SQL, shell, CSS, HTML, JSON and YAML, six themes, line numbers, highlighted lines, a macOS-style window and a gradient background. Cut any line range out of a file (several snippets per file), common indentation is removed and long lines wrap. Before you share, it warns about API keys, tokens, private keys, hard-coded passwords and URLs with credentials in the snippet, and can mask them in the image. Exports a PNG (at 2× by default) and an SVG per snippet. Runs locally; no account or API keys.

## Features

- **Syntax highlighting** for 12 language families, auto-detected from the extension.
- **Themes**: GitHub dark/light, Dracula, Monokai, Nord, Solarized light.
- **Snippets**: any line range, several per file, highlighted lines, custom window title.
- **Layout**: macOS window or plain, gradient backgrounds, padding, line numbers, dedent, wrapping.
- **Secret check**: API keys, tokens, private keys, JWTs, passwords and credential URLs — with optional masking.
- **Exports**: PNG (1–4× scale) and SVG.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `code-snippet-image/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make an image of pay.ts lines 3–17 with lines 13–16 highlighted, titled verify.ts"
- "Mask the API key and use the dracula theme"
- "Export PNG"

## Tools

| Tool | Purpose |
|---|---|
| `codeimg_open` | Read the code files and lay out the snippet images. Opens the panel |
| `codeimg_edit` | Change settings, edit cells by row, add or remove rows |
| `codeimg_status` | Show the current rows, issues and summary |
| `codeimg_export` | Write <file>[-Lfrom-to].png and .svg per snippet |

Output goes to `code-snippet-image/<project>/` in the workspace.

## Scope (v0.1)

- Highlighting is rule-based (keywords, strings, comments, numbers, calls), not a full parser. Uses the system's monospace font (Menlo / Consolas / DejaVu Sans Mono).

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `code-snippet-image/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/code-snippet-image/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-code-snippet-image test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
