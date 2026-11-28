# Recipe Scaler

Scale a folder of recipes to the number of people, convert units and get one merged shopping list and printable recipe cards. Reads plain Markdown recipes in Chinese or English (五花肉 500 g, 生抽 2 汤匙, 鸡蛋 3 个, 盐 适量, 1 1/2 cups flour), scales each to its own target servings or one number for all, and converts to metric (g, ml) or US (oz, cup) with sensible rounding — whole eggs and tomatoes, spoons in quarters, grams to 5. The shopping list adds up the same item across recipes (鸡蛋 / eggs, 番茄 / 西红柿), groups it by aisle and leaves out what you already have at home. Catches recipes without servings, unreadable amounts like 两三, unknown units, an ingredient listed twice, ingredients never used in the steps, recipes without steps and scaling so big that seasoning should be tasted. Exports A5 recipe cards with scaled amounts, steps and total time, a shopping list PDF with checkboxes, a CSV and the scaled recipes as Markdown. No account or API keys; runs on your computer.

## Features

- **Scaling**: per-recipe target servings or one number for all; sensible rounding for eggs, spoons and grams.
- **Units**: keep, metric (g, ml) or US (oz, cup); Chinese units 斤、两、汤匙、茶匙 understood.
- **Shopping list**: same items merged across recipes, grouped by aisle, pantry items left off.
- **Checks**: missing servings, unreadable amounts, unknown units, duplicates, ingredients unused in steps.
- **Exports**: A5 recipe cards, shopping list PDF/CSV, scaled Markdown.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `recipe-scaler/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Scale the recipes in recipes to 6 people"
- "Make one shopping list from these recipes"
- "Export recipe cards and the shopping list"

## Tools

| Tool | Purpose |
|---|---|
| `recipe_open` | Read the recipes and scale them. Opens the panel |
| `recipe_edit` | Change settings, edit cells by row, add or remove rows |
| `recipe_status` | Show the current rows, issues and summary |
| `recipe_export` | Write recipe-cards.pdf, shopping-list.pdf, shopping-list.csv and recipes-scaled.md |

Output goes to `recipe-scaler/<project>/` in the workspace.

## Scope (v0.1)

- Weight and volume of the same item aren't converted into each other (no density table).

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `recipe-scaler/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/recipe-scaler/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-recipe-scaler test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
