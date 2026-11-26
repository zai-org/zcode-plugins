# Changelog Builder

Write release notes without copying commit messages by hand: point it at a git repository and get a CHANGELOG.md grouped by version and by type — features, fixes, performance, breaking changes — plus a clean HTML/Markdown release note for the newest version. Works with Conventional Commits, Chinese prefixes such as 新增/修复 and plain “Add…/Fix…” messages. Reword, re-type or drop entries in a table before exporting. Reads git locally; no GitHub token or API keys.

## Features

- **Releases from tags**: commits are split at each version tag, newest first; changes after the last tag go under “Unreleased” or the version you name.
- **Smart grouping**: Conventional Commits types and scopes, `!` and BREAKING CHANGE, Chinese prefixes (新增, 修复, 优化, 文档…) and plain English “Add/Fix/Bump…” subjects.
- **Editable entries**: change the type, scope or wording, mark something breaking, or leave it out; merge commits are skipped and chore/ci/test are hidden by default.
- **Links**: commit hashes and #123 issue references link to GitHub or GitLab, read from the origin remote or set by hand.
- **Two outputs**: a Keep-a-Changelog-style CHANGELOG.md with Chinese or English headings, and a styled release-notes.html plus paste-ready release-notes.md.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `changelog-builder/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make a changelog for shop-app, call the unreleased part v1.2.0"
- "Only the latest release, headings in English"
- "Write release notes I can paste into GitHub"

## Tools

| Tool | Purpose |
|---|---|
| `changelog_open` | Read the git history and group commits into releases. Opens the panel |
| `changelog_edit` | Change settings, edit cells by row, add or remove rows |
| `changelog_status` | Show the current rows, issues and summary |
| `changelog_export` | Write CHANGELOG.md, release-notes.html and release-notes.md |

Output goes to `changelog-builder/<project>/` in the workspace.

## Scope (v0.1)

- Needs git installed; the repository is only read, never changed.
- Does not call the GitHub/GitLab API, so pull-request titles and labels are not fetched.
- Squash or messy commit histories may need a few entries reworded by hand.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `changelog-builder/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/changelog-builder/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-changelog-builder test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
