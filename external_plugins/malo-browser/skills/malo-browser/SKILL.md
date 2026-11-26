---
name: malo-browser
description: Install, configure, run and drive Malo Browser (Chinese name 马喽浏览器), an agent browser runtime and scripted web demo tool on Electron. The runtime is a background daemon that hands out isolated, profile-backed browser sessions which agents drive over loopback HTTP with 27 session tools (snapshot with iframe content, click/fill/type, assert, login handoff windows, network capture); the demo tool records hidden 1080p30 videos with evidence files. Use when the user says "malo-browser", "马喽浏览器", "马喽", "malo", "agent 浏览器", "演示浏览器", "网页演示录制", "场景演示", or asks to set up, run, drive or troubleshoot Malo Browser.
metadata:
  short-description: Install and run the Malo agent browser runtime and demo tool; drive and troubleshoot it
---

# Malo Browser — install / configure / drive / troubleshoot

Malo Browser is an agent browser runtime: a long-lived daemon gives every agent an isolated
browser session on a private loopback port, and agents drive pages with 27 HTTP tools. The
same repo carries a scripted web demo tool (Stage + Recorder, scene scripts, Director
console, loopback control API). This skill is an install/config/drive/troubleshooting shell —
it does not replicate product logic; it gets the real GitHub repo running and tells an agent
how to use the runtime correctly. The full contract lives in the repo:
`docs/malo-browser.md` (daemon, leases, sessions, profiles, limits) and `docs/malo-tools.md`
(every tool).

## Prerequisites

- Node.js on the 22 line >= 22.12, 24.x, or >= 26 (`engines` is
  `^22.12.0 || ^24.0.0 || >=26.0.0`; the 23 and 25 lines are excluded)
- ffmpeg + ffprobe on PATH (missing → exit code 3)
- macOS (window modes and recording are verified on macOS; hidden mode uses the accessory activation policy)
- Python 3 (the bundled fixture static server, and the optional Python client)
- git

## Install (from the GitHub repo)

```bash
git clone https://github.com/Lumos-789/malo-browser.git
cd malo-browser
npm install
npm run build
```

Sanity gate: `npm run typecheck && npm test && npm run test:client` — all green before
anything else.

## Agent runtime (the main use)

The daemon creates no visible window, does not take focus and does not switch Spaces. Start
it explicitly with `npm run daemon`, or let `clients/python/malo_client.py` start it on
demand (it also renews leases from a background thread and restarts an idle daemon that is
older than the repo). Broker state is written to `~/.malo-browser/broker.json` (0600).

```python
from malo_client import acquire_lease

with acquire_lease("my-agent") as lease:            # heartbeat starts with the lease
    with lease.new_session("work", profile="work") as s:   # profile = persistent login state
        s.call("navigate", {"url": "https://example.com"})
        snap = s.call("snapshot", {"sections": ["text", "buttons", "inputs"]})
        s.call("click", {"text": "Sign in"})
        s.call("fill", {"selector": "#email", "text": "user@example.com"})
        s.call("assert", {"url": "/dashboard", "timeout_ms": 10000})
```

Without the client: `POST /v1/leases` on the broker (`x-malo-broker-token`, body
`{"agent_id","holder"}`), then `POST /v1/sessions` on the lease endpoint, then
`POST /v1/sessions/:id/tools/<tool>` with both `x-malo-lease-token` and
`x-malo-session-token`. `GET /v1/tools` lists every tool with its JSON Schema.

How to drive a page well:

- Read with `snapshot` (pass `sections` to get only the lists you need) and `extract` for
  targeted reads. `interactive[].rect` and `extract mode=rect` give the element center as
  `x`/`y`, ready for `click` / `drag`. Role-based widgets (tabs, options, switches) are in
  `widgets`.
- `frames` lists every visible iframe with an index; its `content` is a nested snapshot.
  Pass `frame: <index>` to `click`, `fill`, `extract`, `assert` and the other page tools to
  act inside one — same-origin, cross-origin and nested iframes all work. If the index is
  stale the call fails and lists the frames that do exist.
- `fill` replaces a value and reads it back; a swallowed input fails with `E_FILL_NOT_LANDED`
  instead of a false success. Use `type` for editors and autocomplete boxes that listen for
  key events. `press` takes a character or a named key; `modifiers` is a bitmask
  (Alt=1, Ctrl=2, Meta=4, Shift=8).
- `scroll` lands at the viewport center (pass `x`/`y` to aim at an inner scroll container)
  and returns once the position has settled.
- `assert` returns HTTP 200 with the verdict on `result.ok`; read `result.checks` for
  expected/actual. `run_steps` batches tools and writes a report.
- `window.open` never opens a new window: the blocked target comes back as
  `result.popup.url`; create the session with `"popup": "adopt"` to open such targets in
  the same page.

Login walls and human checks — do not brute-force them:

- `watch {"show": true}` shows the real page in an inactive window (no focus steal) with a
  toolbar: address bar, back/forward/reload, and three buttons for the human.
- Hand a task to the human with `wait_for {"human": true}`: it returns when they click
  完成 (Done). `login` in `watch` mode does the same for logins (`reason: human_done`).
- 暂停 (Pause) and 停止 (Stop) make every page-changing tool answer 409
  (`E_PAUSED_BY_HUMAN` / `E_STOPPED_BY_HUMAN`); observation tools keep working. Wait for
  the human, or close the session.
- `login` in `password` mode fills one-shot credentials (kept in memory only) or waits for
  the handoff. `focus: true` is refused unless the daemon runs with `--allow-focus`.

Persistent login state: create a session with `{"profile":"work"}` to keep cookies and
storage across sessions and daemon restarts; without it the session closes anonymous.
`profiles` lists, clears and previews stale profiles (`action: prune` is a dry run until
`apply: true`). Seeding a profile from a logged-in Chromium (`POST /v1/profiles/:name/import`)
requires an explicit `domains` list. Profiles are shared by name across every agent on the
machine.

Every session also writes `artifacts/events.jsonl` (path returned as `events_log`); poll
`events` with `next_after` and check `dropped`.

Rules that keep the machine usable: never try to bring a window to the front; close sessions
and release leases when done; do not start the shared daemon with
`--remote-debugging-port` — that port has no authentication and exposes every session and
profile in the daemon. Playwright-style direct CDP work belongs in its own daemon
(`--data-dir`), started explicitly.

## Demo tool

1. Serve the fixture page: `python3 -m http.server 4788 --bind 127.0.0.1 --directory out/fixture`
2. Hidden 10s recording (no window, no focus steal, no Dock icon):
   `npx electron . --mode=record --seconds=10 --out=evidence --label=hidden` →
   `evidence/hidden.mp4` + `hidden.evidence.json`; exit 0 only when self-checks pass.
3. Visible stage for manual browsing: `npx electron . --mode=stage`
4. Director console + control API: `npm run start:control` (loopback only; token in
   `<out>/control.json`, 0600)
5. Full scripted scene: `npx electron . --mode=app --autorun=report-review --scenes=fixtures/scenes`

Scenes are YAML under `fixtures/scenes/`; the contract is `schemas/scene.schema.json`.
Account login keeps profiles in a 0600 file outside git (default
`~/.config/malo-browser/accounts.json`, override `MALO_BROWSER_ACCOUNTS`); a scene only names
`account_id`, the password comes from the profile's `password_env`. Details:
`docs/accounts.md`.

## Configure

- Daemon: `--daemon-port=7410 --port-min=7411 --port-max=7499 --lease-ttl-seconds=300
  --session-idle-seconds=300 --max-sessions=16 --max-sessions-total=64
  --artifact-ttl-hours=168 --visible-grace-seconds=1800 --profile-cache-idle-hours=72
  --profile-ttl-days=0 --idle-exit-seconds=1800 --allow-focus --proxy-server --data-dir`.
  The Python client passes extra flags at cold start via `daemon_args=` or `MALO_DAEMON_ARGS`.
- Demo: `--url --width --height --out --label --keep-frames
  --window-mode=hidden|inactive|offscreen|ghost|focused --focus-emulation=false
  --control-api=true --control-port --headless=true`. Hidden window mode needs focus
  emulation (on by default) — without it CDP physical clicks are dropped.

A misspelled flag fails fast; `--help` prints the full reference.

## Exit codes

| code | meaning |
|---|---|
| 0 | success, all self-checks passed |
| 2 | argument error or general failure (selector not found, assertion failed, port busy, scene validation failed) |
| 3 | ffmpeg/ffprobe missing or failed — install ffmpeg first |
| 4 | recorder failure (e.g. no frames captured) |

## Troubleshoot

- `EBADENGINE` → wrong Node line; use a range from `engines`.
- Exit 0 with no stdout and no files in `<out>` → `ELECTRON_RUN_AS_NODE` is set; re-run with
  `env -u ELECTRON_RUN_AS_NODE npx electron ...`.
- Exit 3 / 4 → install ffmpeg, or read the take's `.evidence.json` (`status: "failed"`,
  `error.code`).
- `EADDRINUSE` → `--control-port` (control API), `--daemon-port` (broker), `--port-min` /
  `--port-max` (lease pool).
- daemon exits at once with `已有 daemon 在使用数据目录` → reuse it, or pass another `--data-dir`.
- Client says the running daemon is older than the repo but still has leases → wait for the
  other agents, or stop the daemon yourself (the error names them and the pid).
- `E_RESOURCE_LIMIT` (429) → the session cap named in the message is full; close sessions or
  raise the flag.
- `E_PAUSED_BY_HUMAN` / `E_STOPPED_BY_HUMAN` (409) → the human paused or stopped the session
  from its window; wait for resume or close the session.
- `E_SELECTOR_NOT_FOUND` mentioning an iframe → the `frame` index is stale; snapshot again.
- `assert` is HTTP 200 with `result.ok: false` → the verdict; read `result.checks` and the
  failure screenshot.
- 404 right after a page was closed over the CDP debug port → the session ended with its page.
- `${env:NAME}` in scenes only reads `SCENE_`-prefixed variables (third-party scenes cannot
  read process secrets); `E_ACCOUNT_*` → check `MALO_BROWSER_ACCOUNTS` and the `password_env`.

## Verify changes

```bash
python3 -m http.server 4788 --bind 127.0.0.1 --directory out/fixture   # in another terminal
npm run smoke:malo        # starts an isolated throwaway daemon, runs the full chain, stops it
npm run smoke:toolbar     # handoff toolbar and its human-signal buttons, hidden window
```
