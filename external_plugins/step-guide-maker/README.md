# Step Guide Maker

Turn a folder of screenshots into a step-by-step guide: numbered steps with titles and text, highlight boxes, pixelated private details and crops, exported as a self-contained HTML page, Markdown with images, and a PDF. Write the steps in a simple Markdown file next to the screenshots (`## title`, text, and optional `框:` / `打码:` / `裁剪:` lines in percent), or fill them in per row. When a step has no box, it can draw one automatically around what changed since the previous screenshot. Checks duplicate screenshots, steps text that doesn't match the number of screenshots, steps without a title, boxes outside the image, login screens with nothing blurred and tiny screenshots. Runs locally; no account or API keys.

## Features

- **Steps file**: `## title` / `1.` / `第1步` blocks matched to screenshots in file-name order.
- **Annotations**: highlight boxes with step numbers, pixelation (not reversible) and crops, in percent of the screenshot.
- **Auto box**: when no box is given, outline the area that changed since the previous screenshot (skipped when the whole screen changed).
- **Checks**: duplicates, step/screenshot count mismatch, missing titles, out-of-range boxes, unblurred login screens, tiny images.
- **Exports**: self-contained HTML, Markdown + PNG images, PDF (A4/Letter).
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `step-guide-maker/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make a guide from the 优惠券教程 screenshots"
- "Drop the duplicate screenshot"
- "Export HTML, Markdown and PDF"

## Tools

| Tool | Purpose |
|---|---|
| `steps_open` | Read the screenshots and the steps file and match them up. Opens the panel |
| `steps_edit` | Change settings, edit cells by row, add or remove rows |
| `steps_status` | Show the current rows, issues and summary |
| `steps_export` | Write guide.html, guide.md + images/ and guide.pdf |

Output goes to `step-guide-maker/<project>/` in the workspace.

## Scope (v0.1)

- It does not read text inside screenshots (no OCR): box and blur positions come from you, the steps file or the automatic change detection.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `step-guide-maker/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/step-guide-maker/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-step-guide-maker test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
