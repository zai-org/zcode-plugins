# Pinyin Annotator

Put pinyin above Chinese text for children's readers, lessons and character cards. Open a text or Markdown file; every character gets its reading from a word-aware dictionary, and the polyphonic characters (多音字) are listed with their context and possible readings. Places where dictionaries usually go wrong, such as 还书, 朝阳, 数星星, 种花 and adverbial 地, are flagged with the likely correct reading so you can confirm it in one edit, or fix a whole word everywhere with a custom reading. Choose tone marks, tone numbers or no tones, flowing text or a 田字格 grid, then export ruby HTML, an A4 PDF, printable character cards and a plain pinyin text. Runs locally; no account or API keys.

## Features

- **Word-aware readings** (银行行长 → yín háng háng zhǎng) with tone sandhi for 一 and 不.
- **Polyphone review**: each 多音字 with its context, automatic reading and possible readings.
- **Misreading hints** for common dictionary mistakes (还书 huán, 朝阳 zhāo, 数星星 shǔ, 种花 zhòng, adverbial 地 de).
- **Two ways to fix**: per occurrence, or a custom word list that applies everywhere; tone numbers like huan2 are accepted.
- **Output styles**: tone marks, numbers or none; flowing text or 田字格; first line as a centred title.
- **Exports**: ruby HTML, A4 PDF, character cards (12 per page with example words from the text) and pinyin text.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `pinyin-annotator/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Add pinyin to lesson.txt"
- "Fix the polyphones it flags"
- "Make character cards for 朝背种数"

## Tools

| Tool | Purpose |
|---|---|
| `pinyin_open` | Annotate the text and list the polyphonic characters. Opens the panel |
| `pinyin_edit` | Change settings, edit cells by row, add or remove rows |
| `pinyin_status` | Show the current rows, issues and summary |
| `pinyin_export` | Write pinyin.html, pinyin.pdf, cards.pdf and pinyin.txt |

Output goes to `pinyin-annotator/<project>/` in the workspace.

## Scope (v0.1)

- Hints cover common cases only; always proofread readings for publication.
- Only Simplified/Traditional Chinese characters get pinyin; other text is kept as is.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `pinyin-annotator/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/pinyin-annotator/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-pinyin-annotator test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: pinyin-pro (MIT), pdf-lib (MIT), fontkit (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
