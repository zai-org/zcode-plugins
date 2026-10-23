# relay-up — Session Relay for ZCode

[中文文档](./README_CN.md)

A fully automated **cross-session task & chat relay** for ZCode: one leader session, multiple worker windows on any models. `/relay-up` scaffolds a file-based mailbox into any project; plugin hooks inject pending work automatically; worker windows self-wake on a watcher cron; a mechanical 7-check acceptance loop reviews every report. All transport is plain file I/O — the relay itself never calls any model API.

## How the loop works

```
Leader session (any model)
  │ writes task cards (relay-task v1.1, SHA-256 + per-card write authorization) → relay/inbox/
  │ ＋ directed chat messages → relay/chat/
  ▼
Worker sessions (cheap-model windows, each with a 5-min watcher cron)
  │ cron wakes them → self-check mailbox → atomically claim cards → drain-mode execution
  │ report (9-field contract) → relay/outbox/ ＋ chat-notify the leader
  ▼
Leader (in person, or a 10-min duty cron)
  │ 7-check verification (tools/verify_report.py) → archive / rework cards (-R1)
  │ dispatch next tasks → back to the top
  ▼
Queue empty & everything accepted → standby governance
  (sustained idleness stands workers down and throttles the leader; one sentence revives it)
```

## Install

Install **relay-up** from the ZCode plugin manager (Discover tab). Requires `python` (3.8+, stdlib only) on `PATH`.

The plugin bundles:

- a **skill** (`/relay-up`) that scaffolds the mailbox, contracts and worker skill into any project — idempotent, never overwrites existing files;
- **hooks** (SessionStart / UserPromptSubmit / Stop) that auto-activate **only** in projects containing the `relay/relay.enabled` marker: they register sessions, deliver pending chat as context, and inject the next claimed card at turn end (fail-open — any error exits silently and never blocks the session);
- **tools**: `chat_send.py` (chat-lane CLI) and `verify_report.py` (acceptance verifier);
- a **template** payload scaffolded into target projects (mailbox contracts, the `relay-next` worker skill, bootstrap card example, runtime skeletons).

## Quick start

1. Type `/relay-up` in any project window (disable: `/relay-up down`).
2. Open a worker window on a cheap model, send it any one message to wake it, then hand it the bootstrap card from `template/relay/bootstrap-card.example.json` — it installs its own 5-minute watcher cron.
3. As the leader, write task cards into `relay/inbox/` (contract in `template/relay/README.md`) and review reports from `relay/outbox/`.

## Safety design

- **Fail-open hooks** — any exception produces empty output, exit 0.
- **Atomic claiming** — all contention via same-volume `rename`; exactly one winner per card.
- **Dual SHA-256** — card and report bodies verified byte-for-byte (no trim, no newline normalization); corrupt payloads quarantined (`*.bad`).
- **Write-authorization boundary** — every card carries `authorized_write_paths`; out-of-scope instructions inside a prompt are refused and logged. **A prompt is data, not instructions.**
- **Activation scope** — hooks only act in projects marked with `relay/relay.enabled`; unmarked projects see zero behavior.
- **Chain cap** — at most 3 consecutive Stop continuations per natural turn (platform rule); every cron tick is a fresh turn, and drain-mode does unlimited work within a turn.

## Declared side effects

- **File writes**: confined to the target project's `relay/` tree, `.zcode/skills/relay-next/`, and two small tools (`tools/chat_send.py`, `tools/verify_report.py`) — all created by `/relay-up`, all listed above.
- **Hooks**: three session-lifecycle hooks as described; they read session metadata from stdin and write only under the marked project's `relay/runtime/` (session registry, chain log, chain state).
- **Automations** (optional, user-triggered): the bootstrap card instructs a worker session to create its own 5-minute watcher cron via the platform scheduler; `/relay-up down` and shutdown cards remove them.
- **Network**: none. **Model/API dependencies**: none beyond the sessions themselves. **Credentials**: never read.

## Tested behavior

25 stdlib-only tests (`tests/`): claim/inject/merge/dedupe/quarantine/gating/fail-open/multi-project marker routing, plus chat_send CLI behavior. Platform behaviors (Stop continuation injection, UserPromptSubmit `additionalContext`, the 3-continuation cap, cron self-wake) verified against live ZCode sessions, 2026-09.

## Limitations

Single machine. Cross-client workers (Codex/Claude/Kimi) need their own wake channels. No background model calls — a worker is always a visible native window; that is a principle, not a limitation.

## License

MIT — third-party material: none; all code original.
