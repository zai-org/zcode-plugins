# TODO Collector

Get every TODO, FIXME, HACK and BUG comment in your code into one list: owners from TODO(name), urgency from !!! or “urgent”, and, in a git repo, who wrote each one and when — so old forgotten items stand out. Set priorities and owners in the table, then export a CSV you can import as issues or a TODO.md checklist grouped by priority, owner or file. Runs locally; no issue tracker account or API keys.

## Features

- **Comments only**: //, #, /* */, --, <!-- --> and ; comments in 50+ languages; markers inside strings and Markdown task lists are ignored, multi-line comments are joined.
- **Owner and urgency**: TODO(name) or @name becomes the owner; FIXME/BUG and !!!, urgent, 紧急 are high priority, HACK/XXX low.
- **Age from git**: with git installed, each line's author and date come from git blame, and items older than a set number of days are flagged.
- **Your tags**: collect any markers — NOTE, OPTIMIZE, 待办 — case-insensitive.
- **Ready to act on**: a UTF-8 CSV for spreadsheets and issue importers, and a TODO.md checklist with file:line links grouped by priority, owner or file.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `todo-collector/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Collect the TODOs in shop-app"
- "Group them by owner and give the cart ones to chen"
- "Also collect NOTE comments"

## Tools

| Tool | Purpose |
|---|---|
| `todos_open` | Scan the folder's source files for TODO-style comments. Opens the panel |
| `todos_edit` | Change settings, edit cells by row, add or remove rows |
| `todos_status` | Show the current rows, issues and summary |
| `todos_export` | Write todos.csv and TODO.md |

Output goes to `todo-collector/<project>/` in the workspace.

## Scope (v0.1)

- Read-only: comments in the code are never changed.
- Author and date need git and a git repository; otherwise those columns stay empty.
- Does not create issues in GitHub/Jira itself — import the CSV there.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `todo-collector/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/todo-collector/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-todo-collector test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
