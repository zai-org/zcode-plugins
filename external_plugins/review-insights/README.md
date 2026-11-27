# Review Insights

Find out what customers actually praise and complain about. Open reviews exported from your shop (CSV or Excel with the review text and, if you have it, the star rating); every review is split into phrases and grouped into topics such as quality, size, delivery, packaging, price, looks, smell, experience and service, in Chinese and English. You see the top complaints and praise for each topic with real quotes, the negative rate per topic, star distribution, likely duplicate reviews and reviews that fit no topic. Edit the keyword list, fix the tone or topics of any review, then export an HTML report and an Excel workbook. Runs locally; no account or API keys.

## Features

- **Phrase-level topics**: one review can praise the looks and complain about the size; each phrase counts for its own topic.
- **Tone**: from the star rating, refined per phrase, with negation handled (没有色差 is praise, 不太满意 is a complaint).
- **Editable lexicon**: one line per topic, Chinese and English keywords.
- **Manual fixes**: override the tone or topics of any review.
- **Checks**: duplicate texts (possible fake reviews), ratings outside 1–5, empty and untagged reviews.
- **Exports**: an HTML report with quotes and per-topic bars, and an XLSX with a topic summary and tagged reviews.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `review-insights/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Analyse reviews.csv and tell me the top complaints"
- "Add a 面料 topic with 面料, 布料"
- "Export the report"

## Tools

| Tool | Purpose |
|---|---|
| `reviews_open` | Read the reviews and group them by topic. Opens the panel |
| `reviews_edit` | Change settings, edit cells by row, add or remove rows |
| `reviews_status` | Show the current rows, issues and summary |
| `reviews_export` | Write review-report.html and review-insights.xlsx |

Output goes to `review-insights/<project>/` in the workspace.

## Scope (v0.1)

- Keyword-based, not a language model: unusual wording may need new keywords.
- Reads one exported file at a time.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `review-insights/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/review-insights/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-review-insights test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: exceljs (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
