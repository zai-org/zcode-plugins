# Flashcard Maker

Turn a word list into printable double-sided flashcards and an import file for spaced-repetition apps. Use a spreadsheet with word, reading (phonetic or pinyin), meaning, example and tags, or a plain text list. Cards are laid out 8, 9, 10, 12, 18 or 24 to a page, with backs mirrored so they line up when you print double-sided (long or short edge). Text shrinks to fit, cut lines and card numbers help when cutting, and you can reverse the cards to practise meaning → word. Edit or skip cards, then export the PDF, an Anki import file with tags, and a CSV for Quizlet and others. Runs locally; no app account or API keys.

## Features

- **Any word list**: spreadsheet columns 单词/word, 音标/拼音/reading, 释义/meaning, 例句/example, 标签/tags — or a .txt with “word<TAB>meaning” or “word - meaning” lines.
- **Double-sided printing that lines up**: backs are mirrored for long-edge or short-edge flipping; or print fronts and backs on separate pages.
- **Grids**: 2×4, 2×5, 3×3, 3×4, 3×6, 4×6 on A4 or US Letter, with cut lines and card numbers.
- **Text fits the card**: words and meanings shrink until they fit; cards that are still too long are flagged.
- **Reverse mode**: meaning on the front, word on the back.
- **Anki import**: anki.tsv with front, back (reading and example included), tags and the deck name; cards.csv for Quizlet and other apps.
- **Checks**: duplicate words, empty fronts or backs.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `flashcard-maker/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make flashcards from words.xlsx, 9 per page"
- "Put the pinyin on the back"
- "Export an Anki file for this list"

## Tools

| Tool | Purpose |
|---|---|
| `flashcards_open` | Read the word list and lay out the cards. Opens the panel |
| `flashcards_edit` | Change settings, edit cells by row, add or remove rows |
| `flashcards_status` | Show the current rows, issues and summary |
| `flashcards_export` | Write flashcards.pdf, anki.tsv and cards.csv |

Output goes to `flashcard-maker/<project>/` in the workspace.

## Scope (v0.1)

- Text cards only — no images or audio on the cards.
- The Anki file creates Basic notes; it does not sync to AnkiWeb.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `flashcard-maker/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/flashcard-maker/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-flashcard-maker test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), pdf-lib (MIT), fontkit (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
