# oh-my-zcode-slim

An [oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim)-equivalent agent orchestration suite for **ZCode**. It turns the primary ZCode session agent into an orchestrator that delegates to specialist subagents — balancing quality, speed, and cost — with a configurable multi-model council for high-stakes decisions and OMOS's workflow skills.

Everything machine-specific (model providers, MCP servers, council seats) is **yours to configure** — the plugin ships only what works everywhere.

## Credits

This suite is a port of **[oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim)** by **[@alvinunreal](https://github.com/alvinunreal)** — [ohmyopencodeslim.com](https://ohmyopencodeslim.com). The specialist roster and agent prompts, the orchestration doctrine and its routing table, and the skills are adapted from their work under MIT. The ZCode-specific parts (plugin packaging, configuration scripts, porting notes) are this plugin's own. See [LICENSE](LICENSE) and the [upstream project](https://github.com/alvinunreal/oh-my-opencode-slim).

## What's in the suite

| Layer | Contents |
|---|---|
| **Agents** (7) | `coder`, `explorer`, `librarian`, `oracle`, `designer`, `observer`, `council` |
| **Skills** (6) | `simplify` (auto-mounted on oracle), `verification-planning`, `deepwork`, `clonedeps`, `worktrees`, `reflect` |
| **Commands** (2) | `/deepwork`, `/reflect` |
| **Doctrine** (`doctrine/AGENTS.md` → `~/.zcode/AGENTS.md`) | Orchestrator role, routing table, delegation mechanics, seat-agnostic council protocol |
| **Council seats** (yours) | `councillor-*` agents you generate with `scripts/add-councillor.sh` — any models you have |

Default model pins use builtin refs (`custom:builtin%3Azai-coding-plan:GLM-5.3` / `GLM-5.3-Flash`), available to every z.ai-authenticated ZCode session. Shipped agents declare **no MCP servers** — see [MCP configuration](#mcp-configuration).

## Install

1. **Plugin**: install and enable `oh-my-zcode-slim` from the marketplace in ZCode's plugin manager. The plugin directory (with the scripts below) lands in the plugin install cache; alternatively clone [the GitHub repo](https://github.com/MartijnDekkers/oh-my-zcode-slim) and use it as a marketplace source.
2. **Doctrine**: from the plugin directory, run `./install-doctrine.sh`. Plugins cannot contribute AGENTS.md files, so this one file installs separately to `~/.zcode/AGENTS.md` (any existing file is backed up to `.bak`). The doctrine is what turns the session agent into the orchestrator — without it you get the specialists but not the routing.
3. **Council seats** (recommended): see the next section.
4. Restart your ZCode session — agents, skills, commands, and AGENTS.md load at session start.

## Configuring your council

The council is whatever `councillor-*` agents exist in your session. The orchestrator dispatches every one of them in parallel with the same question; the `council` agent then synthesizes a structured consensus report (consensus level, agreed/disputed points, recommendation).

From the plugin directory:

```bash
./scripts/list-models.sh                                  # model refs proven to work on your machine
./scripts/add-councillor.sh glm53 'custom:builtin%3Azai-coding-plan:GLM-5.3'
./scripts/add-councillor.sh mymodel 'custom:<provider>:<model>'
./scripts/remove-councillor.sh mymodel
```

Seats are written to user scope (`~/.zcode/agents/`) or, with `--workspace <path>`, project scope for a per-repo council. Two or more seats make the council live; the doctrine refuses to fake a consensus below that. Diversity is the point — seats on different providers/models give the council its value.

**Model pin rules** (see `docs/LESSONS.md` for the full stories): pin format is `custom:<provider-id>:<model-id>`, case-sensitive; a bad pin fails loudly at spawn, which is intended — ping your seats after adding them. In remote-attached sessions, custom providers materialize under UUID provider ids rather than display names; `list-models.sh` prints ids that actually resolve on your machine.

## Overriding shipped agents

Same-named agents at user scope (`~/.zcode/agents/`) or workspace scope (`<repo>/.zcode/agents/`) take precedence over plugin agents. Copy an agent file out, edit the `model` pin or prompt, and your copy wins — that is also how you version per-project variants.

## MCP configuration

Agents may declare `mcpServers` in frontmatter, but **every listed server must be connected at spawn time or the agent refuses to start**. Shipped agents therefore declare none. To wire your servers into an agent:

```bash
./scripts/enable-mcp.sh explorer Terraform codegraph "MS Learn"
```

This copies the plugin agent out to user scope and adds the `mcpServers` line (or edits an existing user copy in place, backed up once). Or leave MCP off and let the orchestrator, which has every server, run lookups itself and paste findings into delegation prompts.

## Side effects, permissions, and dependencies

Required disclosure per the marketplace contribution rules:

- **File writes**: the `coder` and `designer` agents can edit and create files in your workspace within their delegated scope. `install-doctrine.sh` writes `~/.zcode/AGENTS.md` (with `.bak` backup). The seat/MCP scripts write to `~/.zcode/agents/` and, with `--workspace`, to that project's `.zcode/agents/`. `worktrees`/`clonedeps` skills write under the project's `.slim/` directory when invoked.
- **Command execution**: agents may run shell commands within their tool allowlists (`coder`, `designer`: build/test commands when a task authorizes them; read-only agents: non-mutating diagnostics only). The scripts are plain bash around `git`/`sqlite3`/`jq`.
- **Network access**: the plugin itself makes no network requests. When dispatched, the `librarian` agent uses web search/fetch for documentation research. MCP servers wired by the user (optional) access whatever endpoints those servers define.
- **Model/API dependencies**: default pins use the builtin z.ai coding-plan provider available to authenticated ZCode sessions; council seats use whatever models you configure. No API keys are shipped or required by the plugin itself.
- **Hooks / MCP servers**: none included.
- **Third-party material**: prompts, doctrine, and skills adapted from [oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim) (MIT), credited in the section above and in [LICENSE](LICENSE).

## Smoke tests

Run in a fresh session:

1. The subagent list shows the 7 plugin agents plus your `councillor-*` seats.
2. Ping each council seat with a trivial prompt; failures name the provider/model that didn't resolve.
3. Ask coder for a styling change (it refuses and points to designer); ask explorer "where is X" (file:line list); run a council question (structured report); confirm oracle loads `simplify`.
4. Recon questions dispatch `@explorer`, never the built-in `Explore`.
5. `/deepwork` and `/reflect` appear in the `/` menu.

## Remote (SSH) setups

With the desktop attached to a remote workspace, all state lives on the remote host: run the scripts there (inside your SSH session), add marketplaces by git URL rather than local directory, and pin council seats from `list-models.sh` output on the remote host — custom providers materialize under per-machine UUID ids remotely. Details and debugging notes: `docs/LESSONS.md`.

## Source and issues

Development happens at [MartijnDekkers/oh-my-zcode-slim](https://github.com/MartijnDekkers/oh-my-zcode-slim); releases are tagged there.
