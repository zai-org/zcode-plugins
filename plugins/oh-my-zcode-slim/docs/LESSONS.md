# Lessons from building oh-my-zcode-slim

Operational notes from the 2026-09-09 build/debug session on a MacBook (ZCode desktop, `desktop-attached-remote`) attached to a Raspberry Pi (ZCode server, all state in the Pi's `~/.zcode`). Each of these cost real debugging time; all were verified against server code, session logs, or the usage database.

## 1. Remote custom providers materialize under UUIDs, not names

In remote-attached sessions, the runtime registers custom model providers (the ones you define in the desktop app) under **generated UUID provider ids**, not their display names. A pin like `custom:OpenCode:qwen3.8-max` fails at subagent spawn with `Model provider is not configured: OpenCode` even though the provider works and the model runs — under `custom:<provider-uuid>:qwen3.8-max`.

- Verified by `model_usage` rows: UUID/provider pairs executing after display-name pins failed.
- The workspace provider-registry push (visible in server logs as `workspace/updateProviderRegistry` events) carried only builtin z.ai providers; the UUID providers arrive through a separate session-runtime path.
- UUIDs observed stable across days and reconnects — but they are **per-machine**. Never copy someone's UUID pins; derive your own.

**Rule: pin from evidence.** `scripts/list-models.sh` prints provider/model pairs that have actually completed calls on your machine. Display names and documentation are not evidence.

## 2. Model self-identification is never evidence

After switching a session from DeepSeek to an OpenCode model, the model answered "what model are you?" with the *previous* model's name and deployment id — reciting its session-start context. Models cannot introspect; a self-report is generated text, and a provider switch mid-session is invisible from the inside. The server's usage records (`~/.zcode/cli/db/db.sqlite`, table `model_usage`) are the ground truth.

## 3. `mcpServers` in agent frontmatter is a hard spawn requirement

Every server listed in an agent's `mcpServers` must report `connected` at spawn time or the spawn fails with `Required MCP server is not connected` (recoverable once the server returns — verified in the agent runtime bundle). An agent that lists a flaky remote MCP inherits that flakiness as downtime. This is why shipped agents declare none, and why adding them is documented as an explicit trade-off.

## 4. Provider ids are case-sensitive

`custom:opencode:…` and `custom:OpenCode:…` are different lookups (`parseModelRef` preserves case). When iterating on pins, change one variable at a time and read the provider name out of the error message.

## 5. Desktop-remote topology: where things live

With the desktop app attached to a remote workspace: the server, plugin cache (`~/.zcode/cli/plugins/`), agent files, config (`~/.zcode/cli/config.json`), logs (`~/.zcode/cli/log/`), and the usage DB all live on the **remote host**. Model providers are defined in the desktop app on the **client** and materialized to the remote runtime per session. Local-directory marketplaces picked in the desktop UI resolve their path on the remote host and fail the existence check — use a git/GitHub marketplace source for remote setups.

## 6. Marketplace "refresh" may not pull

The app's plugin refresh did not `git pull` the marketplace clone for a GitHub-source marketplace; the clone stayed at its add-time commit. Restarting the app or removing and re-adding the marketplace produced a fresh clone. Pinning `ref`/`sha` in `marketplace.json` source objects is the suspected fix for update detection (official marketplace entries carry them) — untested.

## 7. Built-in agents cannot be removed

`general-purpose` and `Explore` are welded into every ZCode install; only user-scope agents can be disabled or deleted. Since `Explore` collides conceptually with this suite's `explorer`, the doctrine carries an explicit suite-preference rule — silence was not enough, the orchestrator dispatched the built-in until the rule named it.

## 8. Plugins cannot contribute AGENTS.md

The orchestrator doctrine must install to `~/.zcode/AGENTS.md` out-of-band (`install-doctrine.sh`), with a subagent guard as the first line so specialists that inject AGENTS.md ignore the routing rules.

## 9. Dropped council seats, for the record

Both dropped 2026-09-09, gateway-side failures on our OpenCode provider: `muse-spark-1.3-contributor` (persistent network failures) and `gpt-5.6-luna` (cancelled before launch, twice). The seat pattern itself was fine — five sibling models on the same provider spawned and answered.
