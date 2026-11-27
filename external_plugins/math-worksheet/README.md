# Math Worksheet

Print arithmetic drills with an answer key in seconds. Pick a grade preset — adding and subtracting within 20, within 100 with or without carrying, times tables, division with remainders, 3-digit sums, 2-digit multiplication — or set your own operations and number ranges. Choose how many problems, horizontal or vertical (column) layout and fill-in-the-blank problems like □ + 5 = 12; change the set number for a fresh sheet, or keep the same number to print the same one again. Edit any problem and it stays when you regenerate. Export the worksheet with a name, time and score line, a matching answer key in red, and a CSV. Runs locally; no account or API keys.

## Features

- **Grade presets**: within 20; within 100 without or with carrying/borrowing; times tables; division with remainders; 3-digit add/subtract; 2-digit × 1-digit; 2-digit × 2-digit and ÷ 2-digit.
- **Custom drills**: choose + − × ÷, number ranges, the largest sum, carrying on/off and remainders.
- **Repeatable sets**: the same set number always gives the same sheet; change it for new problems, without repeats.
- **Fill-in-the-blank**: □ + 15 = 40 and 50 − □ = 18 mixed in.
- **Horizontal or vertical (竖式)** layout, 1–5 per row, adjustable size, name / time / score line.
- **Edit and lock**: change any problem — it is locked and kept when you regenerate.
- **Your own list**: a .txt with one problem per line (37+48, □-5=12) works too.
- **Answer key** in the same layout with answers in red.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `math-worksheet/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make 60 grade-2 addition and subtraction problems with carrying"
- "Times tables, 5 per row, with an answer key"
- "Another set like last week's"

## Tools

| Tool | Purpose |
|---|---|
| `math_open` | Generate the problems. Opens the panel |
| `math_edit` | Change settings, edit cells by row, add or remove rows |
| `math_status` | Show the current rows, issues and summary |
| `math_export` | Write worksheet.pdf, answers.pdf and problems.csv |

Output goes to `math-worksheet/<project>/` in the workspace.

## Scope (v0.1)

- Whole numbers only; fractions and decimals come later.
- Vertical layout is for + − × ; division stays horizontal.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `math-worksheet/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/math-worksheet/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-math-worksheet test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: pdf-lib (MIT), fontkit (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
