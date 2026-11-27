# Access Log Analyzer

Make sense of your web server's access logs without setting up an analytics stack. Open Nginx or Apache logs (common or combined format, plain or .gz, several rotated files or a whole folder) and see requests, unique visitors, traffic by hour and day, top pages, 404s, server errors, status codes, referrers and bandwidth. Bots and crawlers are recognised and left out by default; filter by date, path or static files, and drop single URLs. Export an HTML report and CSV tables. Runs locally; logs never leave your computer.

## Features

- **Nginx/Apache logs**: common and combined formats, .gz rotated files, a whole folder at once; unreadable lines are counted, not fatal.
- **Traffic**: requests, unique visitor IPs, bandwidth, an hourly chart and a per-day table (times as written in the log).
- **Problems**: top 404 paths, 5xx errors with counts, every 4xx/5xx request in errors.csv.
- **Bots**: Googlebot, Bingbot, curl, python-requests and other crawlers are recognised by user agent and left out unless you include them.
- **Filters**: date range, path prefix, with or without static files, and untick single URLs in the table.
- **Referrers** grouped by domain, with your own site shown as “(internal)”.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `log-analyzer/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Analyse the logs folder — which pages are most visited and what's returning 404?"
- "Only look at 26 November, bots included"
- "Export the report and the error list"

## Tools

| Tool | Purpose |
|---|---|
| `logs_open` | Read the access logs and summarise traffic, errors and referrers. Opens the panel |
| `logs_edit` | Change settings, edit cells by row, add or remove rows |
| `logs_status` | Show the current rows, issues and summary |
| `logs_export` | Write access-report.html and pages.csv, hourly.csv, daily.csv, errors.csv, referrers.csv |

Output goes to `log-analyzer/<project>/` in the workspace.

## Scope (v0.1)

- Common and combined log formats only in v0.1 (no custom log_format, JSON logs or IIS W3C logs).
- Up to 300,000 requests per project; times are used as written in the log (no time-zone conversion).

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `log-analyzer/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/log-analyzer/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-log-analyzer test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
