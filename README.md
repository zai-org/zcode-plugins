# ZCode Plugins Marketplace

[中文文档](./README_CN.md)

The official plugins marketplace for [ZCode](https://zcode.z.ai), featuring plugins maintained by ZCode and contributions from the community.

Use this repository to browse available plugins, install the marketplace in compatible clients, or propose a new plugin through a GitHub pull request.

## Documentation

- [Contributing guide](./CONTRIBUTING.md) ([中文](./CONTRIBUTING_CN.md))
- [Distribution format](./docs/distribution.md) ([中文](./docs/distribution_CN.md))
- [Plugin development tutorial](./docs/PLUGIN_DEVELOPMENT.md) ([中文](./docs/PLUGIN_DEVELOPMENT_CN.md))
- [UI Plugin capabilities, API and debugging guide](./UI_PLUGIN.en.md), featuring Excalidraw.

## Available Plugins

| Plugin | Category | Description |
| --- | --- | --- |
| [**cloudbase-skills**](./plugins/cloudbase-skills) | `developer-tools` | CloudBase development skills and MCP integration for Web, Mini Program, database, cloud functions, CloudRun, storage, and AI projects. |
| [**blender**](./plugins/blender) | `productivity` | Official Blender Lab MCP integration (MCP-only, no UI panel): inspect and edit Blender scenes, run bpy, search docs, capture screenshots, and render. |
| [**mimosa**](./plugins/mimosa) | `developer-tools` | Local-first security guardrails with pre-write hooks, review and Git gates, security commands, and optional sealed deep scans. |
| [**github**](./plugins/github) | `developer-tools` | GitHub CLI workflows for commits, pull requests, issues, releases, Actions, repositories, and Codespaces. |
| [**gitlab**](./plugins/gitlab) | `developer-tools` | GitLab CLI workflows for merge requests, issues, CI/CD, repositories, releases, and API operations, including self-managed instances. |
| [**alibaba-cloud-cli**](./plugins/alibaba-cloud-cli) | `developer-tools` | Alibaba Cloud CLI workflows for credential setup, profile checks, and safe cloud resource operations. |
| [**lark-cli**](./plugins/lark-cli) | `utilities` | Lark CLI workflows for docs, sheets, Base, calendar, messaging, and other SaaS resources with guided setup and OAuth login. |
| [**dingtalk-cli**](./plugins/dingtalk-cli) | `productivity` | DingTalk Workspace CLI workflows with OAuth/device authorization, profile checks, and optional upstream Skills. |
| [**wecom-cli**](./plugins/wecom-cli) | `productivity` | WeCom CLI workflows for messages, docs, sheets, mail, calendar, meetings, contacts, and todos with QR authentication. |
| [**video2code**](./plugins/video2code) | `productivity` | Replicate a webpage from a screen recording or URL: record with the built-in WebView, observe frames, scaffold a React app, and verify against the source. |

### UI plugins

Excalidraw, OpenPencil, and the nine Craft plugins are community plugins maintained by `zcoder` in [`external_plugins/`](./external_plugins/).

- `excalidraw` `0.2.3`: Create and edit diagrams with Excalidraw and MCP tools.
- `openpencil` `0.3.2`: Edit design files with OpenPencil and MCP tools.
- `zcode-mcp-app-dev` `0.1.1`: Develop MCP Apps for ZCode with official SDKs and a small host-extension reference.

- `photocraft` `0.2.3`: PhotoCraft image editing.
- `vectorcraft` `0.2.3`: VectorCraft vector drawing.
- `pdfcraft` `0.2.3`: PdfCraft PDF editing.
- `designcraft` `0.2.3`: DesignCraft page layout.
- `wordcraft` `0.2.3`: WordCraft word processing.
- `gridcraft` `0.2.3`: GridCraft spreadsheets.
- `deckcraft` `0.2.3`: DeckCraft presentations.
- `cadcraft` `0.2.3`: CADCraft CAD drawings.
- `soundcraft` `0.2.3`: SoundCraft audio editing.

These nine Craft plugins embed pinned Trunk/WASM editors, with workspace imports, saves and all 334 upstream MCP tool definitions connected to the live editor. Native-only capabilities remain subject to the Web platform boundary. See the [adapter documentation](./ui-plugins/craft-runtime/README.md) for build provenance, limitations and validation.

UI plugin runtimes (`plugins/<name>/dist/` / `external_plugins/<name>/dist/`) are build outputs and are not committed. The release pipeline builds them from `ui-plugins/` and publishes the ZIPs; a Git checkout alone cannot install a compiled UI plugin. For source development use Node.js 24+ and pnpm 10.33.2: run `pnpm install --frozen-lockfile` and `pnpm build`, then register `dist/local-marketplace`. Rebuild after changing a plugin's source or version.

### Finance plugins

Ten `finance` plugins covering the sell side, the buy side, corporate banking, and the
corporate finance function. Each pairs one routing agent with domain skills and, except
`accounting-and-reporting`, remote market-data MCP servers that authenticate through the
ZCode host — no data-vendor account to configure. All of them require a paid plan except
`accounting-and-reporting`, which works off your own ledger.

| Plugin | Focus | What it does |
| --- | --- | --- |
| [**write-research**](./plugins/write-research) | Equity research | Earnings work, sector and thematic reports, comps, DCF / LBO / three-statement models, morning notes, integrated reports. |
| [**read-macro**](./plugins/read-macro) | Macro & strategy | Macro state dashboard, index valuation percentiles, cross-asset views, policy and industrial-plan tracking. |
| [**assess-credit**](./plugins/assess-credit) | Fixed income & credit | Bond profiles with valuation and risk metrics, issuer credit assessment, curve and spread analysis, credit watchlists. |
| [**pick-funds**](./plugins/pick-funds) | Fund research | Multi-criteria fund screening, fund and manager profiles, holdings and style analysis, shortlist monitoring. |
| [**watch-positions**](./plugins/watch-positions) | Position monitoring | Persistent watchlists, after-close recaps with move attribution, event alerts, intraday view. |
| [**model-deals**](./plugins/model-deals) | Deal modeling | Accretion/dilution, sources and uses with pro-forma capital structure, precedent transactions, capital-raise dilution. |
| [**vet-companies**](./plugins/vet-companies) | Company due diligence | Structured DD reports, related-party and supply-chain mapping, risk-record screens. |
| [**find-clients**](./plugins/find-clients) | Corporate client acquisition | Prospect screening, park and cluster maps, business-opportunity signals, client portraits. |
| [**run-fpa**](./plugins/run-fpa) | Corporate FP&A | Management reporting, rolling cash and P&L forecasts, budget variance attribution, scenarios, peer benchmarking. |
| [**accounting-and-reporting**](./plugins/accounting-and-reporting) | Accounting & reporting | Month-end close review, ledger reconciliation to root cause, account mapping, statutory statements, three-statement tie-out. |

## Marketplace categories

The `category` field in [`marketplace.json`](./marketplace.json) keeps discovery consistent:

| Category | Use it for | Current plugins |
| --- | --- | --- |
| `developer-tools` | Development, code quality, Git, CI, and engineering workflows | `cloudbase-skills`, `mimosa`, `github`, `gitlab`, `alibaba-cloud-cli` |
| `productivity` | Planning, knowledge work, and personal workflow automation | `video2code` |
| `utilities` | General-purpose helpers that do not fit another category | `lark-cli` |
| `finance` | Finance-domain workflows: markets, accounting, risk, and fintech integrations | `write-research`, `read-macro`, `assess-credit`, `pick-funds`, `watch-positions`, `model-deals`, `vet-companies`, `find-clients`, `run-fpa`, `accounting-and-reporting` |
| `guides` | Documentation, learning, and reference-only plugins | — |
| `other` | A plugin that does not fit the categories above | — |

## Installation

### In ZCode

ZCode includes the official marketplace. Open the plugin manager, choose a plugin, and install it directly.

### Test plugins from source

Run `pnpm install --frozen-lockfile` and `pnpm build`. Add the absolute path to `dist/local-marketplace` through **Plugin Marketplace → New**, then install and enable the plugins you choose. The generated source includes every entry in the root `marketplace.json`, including your own plugins; no plugin list is built into the scripts.

Ordinary plugins and UI plugins share registration, installation, and updates. After editing, rebuild, refresh the local source, and reinstall the selected plugin. Building or running the host's `pnpm dev:desktop` does not install plugins. Use the [existing development workflow](docs/PLUGIN_DEVELOPMENT.md#18-test-a-plugin-locally) for CLI commands and verification; see the [build contract](docs/MCP_APP_BUILD.md) for compilation and staging.

## Community

Have a question about a plugin, or building one of your own? Join the ZCode plugin developers on Discord — that is where we answer questions, share work in progress, and announce marketplace releases.

<a href="https://discord.gg/rhdRRNPqhh">
  <img src="./docs/images/community-discord.png" alt="Join the ZCode plugin developer community on Discord" width="360">
</a>

Developers in mainland China can join our Feishu group instead — see the [中文文档](./README_CN.md#社区).

## Contributing

Community contributions are welcome:

1. Copy [`plugins/example-plugin/`](./plugins/example-plugin) to `external_plugins/<your-plugin-name>/` and follow the [development tutorial](./docs/PLUGIN_DEVELOPMENT.md).
2. Register the plugin in [`marketplace.json`](./marketplace.json), including its category.
3. Provide equivalent English and Chinese documentation.
4. Run the local checks:

```shell
python3 scripts/validate.py
python3 scripts/build_dist.py
```

5. Open a GitHub pull request and complete the contribution checklist. **You must select UI Plugin or Standard plugin in the PR template and list the affected plugin names.** Not applicable is reserved for repository-only changes; see the [classification rules](CONTRIBUTING.md#declare-the-plugin-type-required).

Maintainers review submissions for quality, security, compatibility, and licensing. Accepted changes are published through the official release process, and the pull request receives a status update when publication is complete.

See the [contributing guide](./CONTRIBUTING.md) for the complete requirements.

## License

Apache License 2.0

## MCP Apps

Interactive plugin sources are maintained in `ui-plugins/` and their installable packages in `plugins/` or `external_plugins/`. See [build and verification](docs/MCP_APP_BUILD.md). The optional `zcode-mcp-app-dev` skill provides official SDK guidance and ZCode extension examples; it is not a runtime dependency.
