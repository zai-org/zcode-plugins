# Email Signature Maker

Give everyone on the team the same polished email signature. Pick the staff list, enter the company name, website and logo address, choose one of three templates and your colour, and get one signature file per person that pastes cleanly into Gmail, Outlook or Apple Mail — built with tables and inline styles the way email needs. Each person also gets a plain-text version, and an index page shows every signature with install steps. Runs locally; no signature service or API keys.

## Features

- **From your staff list**: recognises 姓名, 英文名, 职位, 英文职位, 部门, 手机, 电话, 邮箱, 微信 and English headers.
- **Email-safe HTML**: tables and inline styles only, no CSS classes or scripts; clickable phone, email and website links.
- **Three templates**: classic, logo on the side with a divider, or a compact two-liner.
- **Logo**: a hosted https address (recommended), or a picked image embedded with a warning.
- **Plain-text version** for every person, and an index page with all signatures and install steps for Gmail, Outlook and Apple Mail.
- **Extras**: text social links, a disclaimer line, a per-person extra line, Chinese + English.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `email-signature-maker/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make email signatures for everyone in team.csv at 青禾科技"
- "Use the logo-on-the-side template with logo https://qinghe.example/logo.png"
- "Add a disclaimer and our blog link"

## Tools

| Tool | Purpose |
|---|---|
| `sig_open` | Read the team list and preview the signatures. Opens the panel |
| `sig_edit` | Change settings, edit cells by row, add or remove rows |
| `sig_status` | Show the current rows, issues and summary |
| `sig_export` | Write signatures/<name>.html + .txt and index.html |

Output goes to `email-signature-maker/<project>/` in the workspace.

## Scope (v0.1)

- Social links are text links — no brand icons.
- Installing the signature in each mail app is a copy-and-paste step (instructions included).
- Embedded logos are blocked by some mail apps; use a hosted address.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `email-signature-maker/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/email-signature-maker/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-email-signature-maker test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: ExcelJS (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
