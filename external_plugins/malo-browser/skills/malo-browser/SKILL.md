---
name: malo-browser
description: Install, configure and run Malo Browser (Chinese name 马喽浏览器), a scripted browser demo and agent web-execution tool (Electron stage, hidden 1080p30 recording with evidence files, director console, loopback control API, multi-agent daemon with isolated sessions). Use when the user says "malo-browser", "马喽浏览器", "马喽", "演示浏览器", "网页演示录制", "场景演示", or asks to set up, run or troubleshoot the Malo Browser project.
metadata:
  short-description: Install and run the scripted browser demo tool; troubleshoot it
---

# Malo Browser — install / configure / troubleshoot

Scripted browser demo tool on Electron: scene scripts drive a Chromium stage,
recording is fixed-spec 1920x1080@30fps with mp4 plus evidence files, and a
React director console and loopback HTTP control API sit on top. This skill is
an install/config/troubleshooting shell — it does NOT replicate product logic;
it gets the real GitHub repo running on the user's machine.

## Prerequisites

- Node.js on the 22 line >= 22.12, 24.x, or >= 26 (`engines` is
  `^22.12.0 || ^24.0.0 || >=26.0.0`; the 23 and 25 lines are excluded)
- ffmpeg + ffprobe on PATH (missing → exit code 3)
- macOS (window modes and recording are verified on macOS; hidden mode uses the accessory activation policy)
- Python 3 (only for the bundled fixture static server)
- git

## Install (from the GitHub repo)

```bash
git clone https://github.com/Lumos-789/malo-browser.git
cd malo-browser
npm install
npm run build
```

Sanity gate: `npm run typecheck && npm test` — both green before anything else.

## Run

1. Serve the fixture page (default demo target):

   ```bash
   python3 -m http.server 4788 --bind 127.0.0.1 --directory out/fixture
   ```

2. Hidden 10s recording (no window, no focus steal, no Dock icon):

   ```bash
   npx electron . --mode=record --seconds=10 --out=evidence --label=hidden
   ```

   Produces `evidence/hidden.mp4` + `hidden.evidence.json` (+ overlay check
   frame). Exit 0 only when self-checks pass: duration ±0.5s, 30fps,
   1920x1080, black-frame ratio <50%, overlay really captured.

3. Visible stage for manual browsing: `npx electron . --mode=stage`
4. Director console + control API: `npm run start:control` — the API binds
   127.0.0.1 only; a random token is written to `<out>/control.json` (0600);
   curl examples are in the repository README (`App control API` section).
5. Full scripted scene run:
   `npx electron . --mode=app --autorun=report-review --scenes=fixtures/scenes`

## malo-browser agent runtime

`npm run daemon` starts the background malo-browser broker: one daemon hands out
loopback port leases to multiple agents, and each lease can host isolated
browser sessions with separate cookies, downloads and artifacts. It creates no
visible window and does not take focus. Broker state is written to
`~/.malo-browser/broker.json` (0600); routes, lease rules and the smoke script are
documented in `docs/malo-browser.md`.

Agents discover page tools with `GET /v1/tools` and invoke them through
`POST /v1/sessions/:id/tools/<tool>`. Use `snapshot` for structured page content
(text, headings, links, buttons, inputs, forms, tables, frames, dialogs and
interactive selectors), `extract` for targeted reads, and the action tools for
click/fill/upload_file/press/hover/select/focus/scroll/history. `assert` checks
visible/hidden/text/value/url/count with retry and returns per-check
expected/actual plus a failure screenshot; a failed assertion is HTTP 200 with
`result.ok: false` (not a 5xx), and `run_steps` reports its verdict the same way,
so agent-driven runs end in a pass/fail verdict instead of a vague observation.
`run_steps` runs a batch of those tools back to back and writes a per-step run
report.

Response bodies from the network layer: `network_capture` subscribes the session to
XHR/fetch responses matching URL prefixes, `responses` returns bodies by `seq` (daemon
memory only). Order: subscribe, navigate, interact, then poll — requests sent before the
subscription are missed. Scope: the CDP session attaches to the page target, so OOPIF
(cross-process iframe) and Service Worker requests are never captured.

Login walls and human checks: `watch` shows the real page in an inactive window
(no focus steal; it stays visible until it is hidden explicitly, i.e. another
`watch` call with `show:false`) with a native title bar and a browser toolbar
(address bar plus back/forward/reload), and `login` either fills one-shot
credentials or waits for the human handoff — a successful `login` hides the
handoff window again unless `keep_visible: true`. Credentials stay in memory and
are never written to events or responses.

Persistent login state: create a session with `{"profile":"work"}` to keep
cookies and storage across sessions and daemon restarts; omit it and the session
closes anonymous. Inspect or clear profiles with `GET /v1/profiles` and
`DELETE /v1/profiles/:name` (409 while sessions still use it). Seed a profile from
an already-logged-in Chromium with `POST /v1/profiles/:name/import` (lease token)
passing `{"cdp_url":"http://127.0.0.1:<port>"}` (loopback only) plus optional
`domains` filter — it pulls cookies live over the source's DevTools endpoint and
writes them into the profile's partition, so logins move over without re-typing
credentials. Chromium data for the daemon lives under `<data-dir>/chromium`.

## Configure

- Common flags: `--url --width --height --out --label --keep-frames
  --window-mode=hidden|inactive|offscreen|ghost|focused --focus-emulation=false
  --control-api=true --control-port --headless=true`
- Scenes: YAML under `fixtures/scenes/` (bundled: `report-review`, plus
  `multi-a` → `multi-b` for multi-scene switching, and `login-demo` for account
  login); the field contract is
  `schemas/scene.schema.json`; step target resolution order is
  `data_demo_id` → `selector` → `text` → `x/y` coordinates.
- Account login: keep profiles in a `0600` file outside git (default
  `~/.config/malo-browser/accounts.json`, override with
  `MALO_BROWSER_ACCOUNTS`). A scene uses only `account_id`; the password comes
  from the profile's `password_env`. `origin` and `login_url` must be
  same-origin, and the profile must define `success_selector` or `success_url`.
  Full contract:
  https://github.com/Lumos-789/malo-browser/blob/main/docs/accounts.md
- Hidden window mode needs focus emulation (on by default) — without it CDP
  physical clicks are dropped.

## Exit codes

| code | meaning |
|---|---|
| 0 | success, all self-checks passed |
| 2 | argument error or general failure (selector not found, assertion failed, port busy, scene validation failed) |
| 3 | ffmpeg/ffprobe missing or failed — install ffmpeg first |
| 4 | recorder failure (e.g. no frames captured) |

## Troubleshoot

- `EBADENGINE` warning/failure → wrong Node line; use a range from `engines`
  (>=22.12 on the 22 line, 24.x, or >=26; not 23/25).
- Exit 0 with no stdout and no files in `<out>` → `ELECTRON_RUN_AS_NODE` is set
  in that shell (`echo $ELECTRON_RUN_AS_NODE`), so Electron ran as plain Node and
  never started the app; re-run with `env -u ELECTRON_RUN_AS_NODE npx electron ...`.
- Exit 3 `E_FFMPEG_MISSING` → install ffmpeg (e.g. `brew install ffmpeg`), re-run.
- Exit 4 / recording failed → read the take's `.evidence.json`; failure still
  leaves evidence (`status: "failed"`, `video: null`, `error.code`). In app mode
  this includes the zero-frame `E_RECORDER_NO_FRAMES` case, which used to only log
  a line — look next to the take: `recordings/<timestamp>_<scene>/take-01.evidence.json`.
- `assert` returned HTTP 200 with `result.ok: false` → the check ran and the page
  did not match; read `result.error.details.checks` (expected/actual) and the
  failure screenshot. Only bad arguments (4xx) or server failures (5xx) are HTTP
  errors.
- `EADDRINUSE` → port occupied; stderr prints a self-help pointer. For the demo
  control API pass `--control-port`, for the daemon pass `--daemon-port`, and for
  a lease exhaust change `--port-min` / `--port-max`.
- Control API 401 → read the token from `<out>/control.json`; send it as
  `Authorization: Bearer <token>` or `x-demo-token: <token>`.
- Director shows a MOCK marker → preload bridge missing; launch via
  `npm start` / `npm run start:control`, not by opening HTML directly.
- `E_SELECTOR_NOT_FOUND` → no visible element matched; check target syntax
  (`fill`'s `text` is the input content — the target needs
  `selector`/`data_demo_id`/`target_text`, or x/y coordinates). A selector with
  invalid syntax is a different error: `E_BAD_REQUEST` (400), not a timeout.
- `E_NAV_BLOCKED` on a `goto` step → the scene's `allow` list does not contain
  that origin; tool-initiated navigation is checked like page navigation.
- `${env:NAME}` only reads `SCENE_`-prefixed variables; other names are refused
  so a third-party scene cannot exfiltrate process secrets.
- `E_ACCOUNT_NOT_FOUND` → account file or `account_id` missing; check
  `MALO_BROWSER_ACCOUNTS` and the available ids in the error.
- `E_ACCOUNT_INVALID` with `0600` or `outside a git worktree` → move the
  profile outside the repo and run `chmod 600 <accounts.json>`.
- `E_ACCOUNT_INVALID` with `environment variable` → export the profile's
  `password_env` in the shell that launches Electron. Never put the password
  in scene YAML.
- A window steals focus during recording → a focusing `--window-mode` was
  passed; the defaults (`hidden`/`inactive`) never take focus.
