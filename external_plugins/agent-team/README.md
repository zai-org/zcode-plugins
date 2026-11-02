# Agent Teams

[中文](./README_CN.md)

Bring "Lead + multiple teammates" collaboration into ZCode: the Lead spawns teammates inside a conversation, shares a task board, exchanges messages, and watches live team status in an MCP Apps panel.

- Best for: parallel work you want to split up, handing implementation/review/testing to different members, or delegating a multi-step job to a reusable crew.
- Roles: Lead = the current conversation (the agent you are talking to); teammates = independent child sessions created by the plugin, sharing the Lead's working directory.
- Surfaces: Desktop = the "Agent Team" MCP Apps panel (live); CLI = the `/team` text summary + the `team-ctl` tool (can also render static cards).

> Host baseline: finalized on **ZCode Desktop 3.16.2 / CLI 0.17.0** (measured, not guessed); the release drill was re-verified on Desktop 3.16.3 / CLI 0.17.0, and the desktop entry paths on Desktop 3.17.1. Lower versions are unverified and unsupported.

## Install

### Desktop (Plugin Marketplace UI)

1. Open **Plugin Marketplace** and find **Agent Teams** (category: developer tools).
2. Click **Install**. Afterwards you can confirm and toggle it under **Settings → Plugins**.

### CLI

```bash
zcode plugins install agent-team@zcode-plugins-official
zcode plugins enable agent-team@zcode-plugins-official
```

## Enable

- Enabled by default after install; the switch and its configuration live in **Settings → Plugins**.
- The declared SessionStart / Stop / UserPromptSubmit hooks take effect **as soon as the plugin is enabled** — no trust grant or hooks toggle is needed (verified in a clean environment).
- In the desktop default permission mode, the first agent-team MCP tool call prompts for permission; choose "Allow once" or "Always allow for this project". This is the host's tool permission and unrelated to hooks.

## Using it in a conversation

**Panel entry:** click **"+"** on the right of an existing conversation:
- Universal path (verified on official ZCode 3.17.1): **"All plugins" → "Personal" → "Agent Team" → "Open"**.
- When the host provides an "Agent Team" item in "New tab" (official 3.17.1 does not yet include it; requires a host build with this entry): **"New tab" → "Agent Team" → "Open"** — no need to enter the plugin list.

After install and enable you need **no special command**: the teamwork policy is injected into the conversation context automatically by the SessionStart hook (D10). Just start a new task and describe your goal. There are three invocation surfaces:

| Surface | How to trigger | What it does |
|---|---|---|
| Natural language (main channel) | Just state a goal / give orders | Everything: spawning teammates, assigning tasks, messaging; the policy is auto-injected and the model knows which team tools to use |
| `/team` | Type `/team` | Prints a text summary of team status + panel/command entries (**read-only**, creates/modifies nothing) |
| `/team-coordination` | Type `/team-coordination` (full name `agent-team:team-coordination`) | Manually (re)load the teamwork policy skill; use when a very long session has lost it |

### 1. Just state the goal (default `auto`: on-demand delegation)

Start a **new task** (old tasks do not refresh plugin capabilities) and describe the goal. Since 0.5.0 the default `leadMode: auto` follows on-demand delegation semantics: with no team spawned yet, the session behaves like a plain single agent — questions, small single-file changes and read-only summaries are handled directly; for goals that clearly benefit from multiple roles in parallel, disjoint write scopes, or long tasks needing their own context, the Lead forms a team:

```text
Push two things in parallel: one teammate adds unit tests for src/utils, another reviews the wording of README and CHANGELOG, then summarize.
```

Once a team exists in the session (durable — inactive/failed members count), the Lead judges each request by delegation value: delegate work that is worth the team workflow — tasks with acceptance criteria, owners and independent verification (D26/D27) — and handle the rest directly with a one-line reason (issue #9 / D28).

### 2. Precise control and the other two modes

At any time you can give explicit orders:

```text
Create a teammate named reviewer, have it check the first three paragraphs of README for typos, then summarize its findings.
```

```text
Send reviewer a message: focus on mixed Chinese/English punctuation.
```

```text
List the current members and task statuses.
```

Two more modes: `always` restores the pre-0.5.0 proactive orchestration from the very first message (decompose, staff up, assign, verify — no step-by-step steering needed); `off` disables Agent Teams entirely (no team context injected, no team tools registered).

The model maps these phrasings to the right tools (`spawn_teammate` / `send_message` / `list_agents` / `team_task_list` …); you never need to remember tool names.

### 2.1 Model and reasoning effort (auto-follows the Lead, nothing to configure)

**Since 0.4.0 there is exactly one path for member models: automatically follow the Lead's latest confirmed model and reasoning effort.** There is no per-member model configuration — no gear popup in the panel, no `model` parameter on `spawn_teammate`, and no "switch this member's model" instruction. You only manage the Lead's model; members sync before every turn.

```text
Create a teammate named reviewer to check the first three paragraphs of README for typos.
```

- **When it syncs**: before each execution (first turn, wake-up by a new message, team resume) the member compares against the Lead's latest confirmed choice (resolved from the host's actual session state, 0.4.1); applied only on change, zero overhead otherwise. A running member syncs at its next turn start (never interrupted mid-turn); interrupt it first if you need an immediate switch.
- **What "confirmed" means**: the model **at the moment you actually submit a message** (the host snapshots it when saving), cross-checked against the `/model` selection record and the main-turn call history — newest of the three wins. Merely toggling the dropdown without submitting is not guaranteed to sync.
- **Failures are never silent; retries are bounded (0.4.1)**: when the Lead's model cannot be inherited (official coding plan, deleted/disabled Provider, unparseable state), spawning/resuming fails loudly with the reason — it never silently runs a different model. The failure shows in the member's diagnostics and pending messages are preserved. Deterministic rejections (plan/out-of-catalog) suspend auto-retry; transient faults (timeouts) back off 5s/15s/30s, at most 3 auto-retries. Switching the Lead back to a usable model — or sending a new message — resumes delivery and clears the stale error.
- **Pre-spawn validation (0.4.1)**: when the Lead's model is not inheritable, `spawn_teammate` fails **before** registering the member — no failed member, no name consumed; after fixing the Lead's model the same name is reusable.
- **Official coding plans cannot be inherited (hard boundary)**: members are independent CLI processes and the host does not hand subscription-plan credentials (`account:*` / `builtin:*` providers, e.g. GLM official coding plans) to them, so **inheriting an official coding-plan model is not supported**. Spawning/resuming while the Lead uses a plan model fails; switch the Lead to your own third-party model first (ZCode Settings → Model Services, add your own Provider + API key).
- **Solo fallback when teammates are unavailable (0.5.1)**: when the Lead's confirmed model is an official plan model, the Lead is told once per session (SessionStart or the first prompt) that teammates cannot be spawned — it then does all the work itself instead of wasting turns on failing spawns. The note is non-permanent: if you switch the Lead to a third-party model mid-session and a spawn succeeds, the team works normally from then on.

### 3. `/team` for status

Type `/team` any time: the first line reads "Members N · Shared tasks T", followed by one line per member and task (same wording as the panel dictionary), plus panel/command entries depending on the runtime. Refresh semantics: the desktop MCP Apps panel is live (subscription push, no manual refresh); on CLI every `/team` run is fresh.

### 4. `/team-coordination` to reload the policy

The main channel is the automatic hook injection, so manual loading is rarely needed. Two cases:

- In very long sessions the injected policy may be compacted away (D24): type `/team-coordination` (or ask the model to "reload the teamwork policy skill") to restore it;
- Or load it on demand when you want the session to follow team discipline.

### What a successful run looks like

Using "create reviewer to check README typos" as the example:

1. The "Agent Team" panel appears in the conversation (the `spawn_teammate` result carries a panel-open hint and the desktop opens it), showing `lead` (current session) and `reviewer`;
2. `reviewer` starts working; tasks and statuses change on the panel/board;
3. `reviewer` reports back; the Lead (after independent verification, when it delegated the work) summarizes for you;
4. `reviewer`'s session is a hidden child session — it never appears next to the Lead in the left task list.

## Tool reference (9 model-visible tools; 8 with `interrupt:false`; 0 with `leadMode:off`)

| Tool | Who uses it | Purpose |
|---|---|---|
| `spawn_teammate` | Lead | Create a named persistent teammate (`context: fresh\|fork`; model auto-follows the Lead, no separate parameter; staff up when the goal clearly benefits from delegation) |
| `send_message` | Everyone | Message another member: delivered at the nearest turn boundary while running; wakes/resumes an idle member |
| `list_agents` | Everyone | List Lead + all teammates with targets and availability (`inactive` = no turn running, not a failure) |
| `interrupt_agent` | Lead | Interrupt a teammate's current turn, preserving its pending inbox (**not registered when disabled → 8 tools**) |
| `wait_agent` | Lead | Wait for the next member/message/task change (never wakes idle members; returns noProgress on timeout) |
| `team_task_create` | Everyone | Create an unassigned task on the shared board (optional `blocked_by` / `write_scopes`) |
| `team_task_list` | Everyone | List tasks: status, owner, revision, blocking, write-scope warnings (paginated/filterable) |
| `team_task_get` | Everyone | Read one task's latest full content (must-read before editing) |
| `team_task_update` | Everyone | CAS task actions via `expected_revision`: claim / release / edit / set_dependencies / complete / reopen / reassign / delete |

There is also an app-only loopback tool `team_panel_call` (panel heartbeat/refresh/detail with **per-turn summaries**; **read-only channel, zero mutation capability**, not model-visible); the diagnostic probe `team_ping` is exposed only with `TEAM_DEBUG_TOOLS=1`.

## Configuration (userConfig)

Edit under **Settings → Plugins → Agent Team**; changes apply to new tasks (running sessions keep the config they started with).

| Option | Default | Description |
|---|---|---|
| `maxMembers` | 8 | Max teammates per team (Lead excluded, failed included) |
| `maxTasks` | 256 | Max tasks on the board |
| `maxMessageBytes` | 65536 | Max bytes per member-to-member message |
| `disposalTimeoutMs` | 5000 | Timeout for team disposal (settlement and reclaim) |
| `interrupt` | true | When off, the model gets 8 tools (`interrupt_agent` is not registered) |
| `leadMode` | auto | `auto`: on-demand delegation (plain single agent until a team exists, then judge by delegation value); `always`: always orchestrate proactively; `off`: disable Agent Teams entirely (no injection, 0 team tools). Legacy values `orchestrator`/`collaborator` are treated as `auto` (issue #9) |

## Network access, dependencies and side effects

| Item | Declaration |
|---|---|
| Network access | **No outbound requests.** The daemon talks to the host over stdio; the teammate ↔ host app-server bridge uses local inter-process channels; the optional companion page (`TEAM_COMPANION=1`) listens on loopback `127.0.0.1` only. Model requests are made by the host using the Providers you configure — unrelated to this plugin |
| Model/API dependencies | Members are driven by the host-bundled `zcode` CLI and follow the Lead's current model every turn (see 2.1); **official coding plans cannot be inherited** (plan credentials are not forwarded); the plugin itself needs no API key |
| File writes | Only the plugin data directory `$ZCODE_PLUGIN_DATA` (`teams/`, `logs/`, `meta/`, checkpoints) plus two whitelisted points in the host task index (member-session hiding anchor, `sidebar-audit --apply`, see D25); the host `db.sqlite` is strictly read-only |
| Command execution | Hooks, the daemon and `team-ctl` are the plugin's own Node scripts (`runtime/*.mjs`) run by the host's Node; teammates are host CLI child processes; the plugin never runs arbitrary shell commands |
| Hooks | SessionStart / Stop / UserPromptSubmit (`hooks/hooks.json`, effective on enable) |
| MCP servers | `team-daemon` (stdio) |
| Third-party code | Inlined MCP SDK and other third-party software with licenses: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) |

## CLI usage

```bash
# /team command: prints the team status text summary (desktop & CLI)
/team

# Direct disk replay (same source as /team)
node <plugin-dir>/runtime/team-ctl.mjs state <teamDir>            # text summary
node <plugin-dir>/runtime/team-ctl.mjs state <teamDir> --json     # machine-readable
node <plugin-dir>/runtime/team-ctl.mjs transcript <teamDir> <member>   # per-turn member summary
node <plugin-dir>/runtime/team-ctl.mjs widget <teamDir> --standalone --out /tmp/team.html --theme dark --lang en
node <plugin-dir>/runtime/team-ctl.mjs tail <teamDir>             # follow the event log
```

`<teamDir>` = `$ZCODE_PLUGIN_DATA/teams/<session_id>` (on CLI usually `~/.zcode/cli/plugins/data/agent-team@<market>/teams/…`).

## Node requirement

The daemon, hooks and `team-ctl` all run on Node and require **Node ≥ 22**. Check before installing:

```bash
node -v
```

Expect `v22.x` or higher. Below v22 the daemon startup self-check warns and the panel/tools may be unavailable; the actual version is written to `$ZCODE_PLUGIN_DATA/logs/daemon-lifecycle.jsonl` (fields `node`, `nodeWarn`).

## Uninstalling and your data

**Back up first, then uninstall.** The default uninstall deletes team data irreversibly.

```bash
# 1) Locate the plugin data dir (dataPath at install time; also visible in plugins list --json)
DATA="$HOME/.zcode/cli/plugins/data/agent-team@<market>"
# 2) Back up (keeps the task board, members, messages, event log)
tar -czf ~/agent-team-backup-$(date +%Y%m%d).tar.gz -C "$(dirname "$DATA")" "$(basename "$DATA")"
```

Measured behavior (2026-10-24 clean-environment drill):

| Entry | Default uninstall | Can data be kept? |
|---|---|---|
| CLI | `zcode plugins uninstall agent-team@<market>` **deletes the entire plugin data directory** (board, members, messages); the current version cache is removed, older version caches and the marketplace registration stay | Yes: `--keep-data` keeps the data directory (event-log hash unchanged) and only removes code + enablement; non-interactive shells need `--force` |
| Desktop | Settings → Plugins → more actions → Uninstall; the confirm dialog states cache, data and config deletion; measured: **deletes the data directory contents** (empty dir remains), current version cache removed | **No** UI equivalent |

Note: task windows still open at uninstall time may later **recreate an empty data skeleton** at the old path (0-byte `events.jsonl`); the original team data does not come back — do not mistake the reappearing directory for "data is still there". Close the related task windows after uninstalling.

## Troubleshooting

### 1. First check whether the plugin exists and is enabled

```bash
zcode plugins list | grep agent-team
zcode plugins list --json        # version / rootPath / dataPath / diagnostics
```

Desktop: confirm the "Agent Team" toggle in **Settings → Plugins**; its three hooks show under **Settings → Hooks**.

### 2. Log locations (all under the plugin data directory)

| File | Contents |
|---|---|
| `logs/hooks.jsonl` | Full env overlay and input digest per SessionStart / Stop / UserPromptSubmit — **check here to see whether hooks ran** |
| `logs/daemon-lifecycle.jsonl` | Daemon start/reclaim: pid, node version, data dir, `nodeWarn`, SIGINT handling |
| `logs/provider.jsonl` | Teammate turns and delivery details (debugging) |
| `logs/requests.jsonl`, `logs/meta-log.jsonl` | Tool calls and panel loopback records |
| `meta/runtime-config.json` | Effective config persisted by the daemon (hooks read the same file) |
| `teams/<session_id>/events.jsonl` | Team event log (append-only; `team-ctl tail` follows it) |
| `teams/<session_id>/coordinator.audit.jsonl` | Coordinator lock acquire/release/takeover audit |

### 3. How to investigate hooks not taking effect

1. Confirm the plugin is enabled (hooks do not run while disabled);
2. Open a **new conversation**, then check whether `logs/hooks.jsonl` gained a `sessionstart` record;
3. No record → check **Settings → Hooks** lists the three agent-team hooks (SessionStart / Stop / UserPromptSubmit) and whether the plugin carries `diagnostics` (version/manifest issues);
4. Record exists but the model ignores team policy → check the record's `env_overlay.ZCODE_PLUGIN_ROOT` points at the current install; after upgrades old sessions keep the old version — start a new conversation.

### 4. Common symptoms

| Symptom | Cause and handling |
|---|---|
| `Duplicate plugin hooks file ignored: hooks/hooks.json` in `plugins list` after install | Known warning: the manifest hooks declaration duplicates the host's auto-discovery of the same path; the host ignores it explicitly. All three hooks still run. Cleanup planned for a later version |
| Teammate stuck `provisioning` / cannot be created | Check `logs/provider.jsonl` and `logs/daemon-lifecycle.jsonl`; confirm the `zcode` executable is discoverable (`TEAM_ZCODE_BIN` overrides) and member quota `maxMembers` is not exceeded |
| "Member cannot inherit the Lead model" on spawn/resume | Expected (0.4.0): the only path is following the Lead; when the Lead is on an **official coding plan** (`account:*`/`builtin:*`) or the Provider is deleted/disabled it fails loudly, never silently switching models. Fix: switch the Lead to your own third-party model (ZCode Settings → Model Services) and retry. 0.4.1: spawn pre-checks before registering (no name consumed); the same failure does not retry forever (deterministic rejections suspend; transient faults back off 5s/15s/30s ×3); switching the Lead back or sending a new message resumes delivery and clears the error |
| Desktop tool calls hang or `Client closed` | Known host limitation (D11): desktop callTool does not rebuild the connection after the daemon is idle-reclaimed. Start a new task and call immediately to hit a live daemon; the panel heartbeat keeps it alive as long as possible |
| Panel numbers frozen | The panel refreshes via subscription + heartbeat; cross-check with `/team` or `team-ctl state`. Static cards/views do not probe liveness and are conservative |
| No change after upgrading | The host pins a plugin runtime per conversation: start a new task after upgrading; the CLI's "Restart zcode to apply" hint is the same |
| Old team sessions appear in the left task list | Leftover data: `node runtime/team-ctl.mjs sidebar-audit <teamDir> --apply` archives them (dry-run by default, reviewable) |
| Persisted team record corrupt | Reports `persisted Agent Teams … payload is invalid`. Back up `teams/<session_id>/` first, then re-check with `team-ctl state`; never hand-edit `events.jsonl` (breaks seq continuity) |

### 5. Safely wiping the data directory

Once you no longer need historical teams you may delete `$ZCODE_PLUGIN_DATA` entirely (same data disposal as the default uninstall). **Back up first**; the board and messages cannot be recovered afterwards.

## Limitations and deviations (user-readable, D1–D27)

This plugin is a re-implementation of DSH Agent Teams on ZCode. The deviations below are **registered and acceptance-tested** adaptations from the gap analysis ledger D1–D27 (numbering per that ledger).

| ID | What you will observe |
|---|---|
| D1 | Team events live in the plugin's own data directory (JSONL), not the Lead's session log; session export/rollback excludes team events |
| D2 | "Interrupting a running member" is delivered at the next turn boundary (the host has no steer primitive); messages queue while the target runs — never dropped or duplicated |
| D3 | `context:"fork"` falls back to "fresh + Lead's completed-turn transcript (truncated)" when a true fork is impossible; not KV-prefix sharing |
| D4 | The main UI is the in-conversation MCP Apps panel; no upstream hover button/popover/pin; the `::visualize` snapshot card is desktop-only |
| D5 | Member sessions stay out of the left task list by default; the panel offers a read-only member conversation view. Legacy visible rows can be archived with `sidebar-audit` |
| D6 | The Lead still sees the host's built-in Task tools (cannot be disabled); teammates have Task disabled and team tools are policy-preferred |
| D7 | One sentence about "file version conflicts" in the policy text is replaced with ZCode file-tool semantics; everything else is verbatim |
| D8 | The coordinator is ephemeral: the daemon is reclaimed by the host when idle and any instance can take over; a momentary `TEAM_DISPOSED` error may appear during handover — just retry (measured takeover ≤5s) |
| D9 | No SessionEnd hook: disposal is best-effort at daemon exit plus reconciliation on next start; under very short grace only a reconcilable state may remain |
| D10 | The policy is injected into message context by the SessionStart hook, not the system prompt; injected text does not land in the transcript; disabling hooks triggers a fail-loud warning |
| D11 | Desktop callTool may hang / `Client closed` after daemon reclaim without recovering in that session; a new task recovers. Teammates use separate processes and are unaffected |
| D13 | Tool entries declare no `outputSchema` (host limitation); output contracts are pinned by tests |
| D14 | With missing identity, error messages use an `<unknown>` placeholder |
| D15 | Argument type errors return `TEAM_INVALID_ARGUMENT` with `param "<key>" must be …`; these are tool-face messages within the existing 27-code set |
| D16 | When two daemons serve one team (proxy mode): `list_agents` may conservatively show active members as `inactive`; `wait_agent` waits conservatively and never falsely reports noProgress |
| D17 | Idle reclaim does **not** terminate teammate turns by default (keep-asleep); set `TEAM_DRAIN_ON_DISPOSE=kill` to drain fully |
| D18 | "Delivered" to the Lead means the hook injection receipt (the host has no direct injection primitive; injection is not in the transcript); externally it is still `{sent:true}` |
| D19 | Hooks read the config persisted by the daemon; before the first daemon start they use defaults (e.g. `interrupt=true`) |
| D20 | Waking an idle Lead is a gray feature: by default no new turn is started and messages stay pending; `TEAM_WAKE_LEAD=1` enables it |
| D21 | Static cards do not probe liveness: member status maps conservatively from phase (active→inactive, lead always inactive); only the live panel/companion shows running |
| D22 | The diagnostic tool `team_ping` is not in the model tool list by default (9 model-facing tools, 8 with `interrupt:false`); `TEAM_DEBUG_TOOLS=1` exposes it |
| D23 | Historical event names/old checkpoints auto-upgrade: legacy `team/message` normalizes to `team/message/queued`, old delivered structures to string arrays; historical teams stay readable |
| D24 | Policy text injects on SessionStart (startup/resume); in very long Lead sessions it may be lost to context compaction — reload the skill or start a new task |
| D25 | The plugin writes only two whitelisted points in the host task index (session-hiding anchor tombstone, `sidebar-audit --apply`); `db.sqlite` is strictly read-only |
| D26 | `always` mode (pre-0.5.0 default `orchestrator`): the Lead proactively staffs/assigns/accepts and does not implement itself (except one-line fixes or when nobody can take it) |
| D27 | Task `complete` means "submitted": the Lead must independently verify before acceptance; failures are `reopen`ed with concrete findings, passes append an acceptance note to the task |
| D28 | Since 0.5.0 the default is `auto` (issue #9): no mode section is injected before a team exists; after the first teammate the on-demand section applies (delegation-value judgment with positive/negative examples); `off` disables injection and team tools entirely; legacy `orchestrator`/`collaborator` values migrate to `auto`; a stale pre-0.5.0 runtime-config is treated as unset |
| D29 | When the Lead's confirmed model is an official plan model (issue #5), hooks inject a one-time solo note (do all work yourself, don't call spawn_teammate; non-permanent — a later successful spawn restores normal team use) and the spawn error message offers the same fallback; detection is optimistic (unknown/failed reads never trigger the note) |

## Documentation

- [User manual with screenshots (Chinese)](docs/使用手册.md)
- [Repo wiki: architecture, flows and source navigation (source repo only, not shipped)](docs/repo-wiki.md)
- Internal handover docs (source repo `docs/`, not shipped): `架构说明-as-built.md`, `运维手册.md`, `测试手册.md`
- [Changelog](CHANGELOG.md), [License](LICENSE), [Third-party notices](THIRD-PARTY-NOTICES.md)
- Source repository: <https://github.com/Vincent-chk/zcode-agent-team>
