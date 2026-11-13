<p align="center"><img src="assets/malo-browser/icon.png" width="88" height="88" alt="Malo Browser icon"></p>

<h1 align="center">Malo Browser</h1>

A browser for scripted demos. It is built on Electron + Chromium and splits a web demo
into a Stage (what the audience sees) and a Recorder (fixed-spec capture) without
forking the browser engine; demo flows are written as scene scripts, with a Director
console and a loopback control API on top.

This repository is a working prototype (0.1.x): hidden recording, physical CDP input,
an overlay, 1080p30 output, evidence files and a minimal `.app`. It is also the
`malo-browser` agent runtime: a background daemon hands out port leases so several
agents can drive isolated browser sessions at the same time.

## Install

### Requirements

- Node 22.12+ on the 22 line, 24.x, or 26+ (`engines` is
  `^22.12.0 || ^24.0.0 || >=26.0.0`; the 23 and 25 lines are excluded). The range is
  declared in `package.json`, so a mismatch surfaces during install (yarn fails;
  npm/pnpm print an EBADENGINE warning and fail under `engine-strict`) instead of deep
  inside vite/vitest.
- ffmpeg and ffprobe on `PATH` (resolved from `PATH` first, then the Homebrew/local
  fallback directories); missing binaries exit with code 3.
- macOS for the verified path: window modes and recording are tested there, and hidden
  mode uses the accessory activation policy.
- Python 3 only for the bundled fixture static server (`python3 -m http.server`).
- git.

### From source

```bash
git clone https://github.com/Lumos-789/malo-browser.git
cd malo-browser
npm install
npm run build
```

`npm run build` compiles the main process with tsc and bundles the fixture and the
director console with vite. `npm run typecheck` type-checks the main and renderer
projects without emitting, and `npm test` runs the vitest unit suite.

### Plugin packaging

The repository is both the app and the plugin carrier; there is no second copy of the
source.

- ZCode plugin: `.zcode-plugin/plugin.json` (name `malo-browser`, version kept in sync
  with the repo), skill `skills/malo-browser/SKILL.md` (install / configure /
  troubleshoot; it does not reimplement the product), icon
  `assets/malo-browser/icon.png` (512x512). With the `dev-oss-projects` marketplace
  registered: `zcode plugins install malo-browser@dev-oss-projects -s user`.
- DSH bundle: `package.json` declares `dsh.bundle` (patch -> repo-root
  `cordis.patch.yml`) and `index.js` mounts `skills/` through `bundledSkillDir`.
  `engines.dsh` and the optional `@deepseek-ai/*` peerDependencies are in
  `package.json`; because the peer is optional, it does not affect `npm install` for the
  Electron app.

## Run

Serve the fixture page first (the default demo target), in another terminal:

```bash
python3 -m http.server 4788 --bind 127.0.0.1 --directory out/fixture
```

Default: hidden background recording for 10 seconds.

```bash
npx electron . --mode=record --seconds=10 --out=evidence --label=hidden
```

The default recording shows no window, takes no focus and claims no Dock icon on macOS
(`setActivationPolicy('accessory')`), so you can keep using the machine while it records.

| Command | What it does |
|---|---|
| `npm run build` | main process (tsc), fixture and director (vite) |
| `npm run typecheck` | type-check main + renderer projects, no emit |
| `npm test` | vitest unit suite |
| `npm start` | Director console + Stage; the Stage shows as `inactive` and does not steal focus |
| `npm run start:control` | same, plus the loopback control API on `http://127.0.0.1:7317` |
| `npx electron . --mode=record --seconds=10` | hidden recording (default) |
| `npx electron . --mode=record --window-mode=inactive --seconds=10` | visible but unfocused recording |
| `npx electron . --mode=record --plain --seconds=10` | no interaction, static page only (control run) |
| `npx electron . --mode=app --autorun=report-review --scenes=fixtures/scenes` | run a whole scene headless and produce a take |
| `npx electron . --mode=app --director-check` | invisible check of the Director and the preload bridge |
| `npx electron . --mode=app --headless=true --control-api=true` | windowless background instance with only the control API and recording |
| `npx electron . --mode=stage --window-mode=inactive` | visible Stage for manual browsing |
| `npm run daemon` | malo-browser broker daemon handing out leases to agents |
| `npm run smoke:malo -- <broker.json> <fixture-url>` | real multi-agent / multi-session path |
| `npm run smoke:toolbar` | hidden check of the handoff toolbar (preload, Enter navigation, address sync, back, page viewport) |
| `npm run smoke:control -- report-review` | against a running control API: load scene -> record -> verify evidence |
| `npm run package` | package an unpacked app under `dist/` (Apple Silicon: `dist/mac-arm64/Malo Browser.app`) |
| `./scripts/run-phase0.sh` | Phase 0 primary evidence run (hidden + inactive) |

`--mode=stage` follows `--window-mode`, and its default is `hidden`; pass
`--window-mode=inactive` (or `focused`) to actually see the Stage.

Common flags: `--url`, `--width`, `--height`, `--out`, `--label`, `--keep-frames`,
`--window-mode=hidden|inactive|offscreen|ghost|focused`, `--focus-emulation=false`,
`--control-api=true`, `--control-port`, `--headless=true`, `--scenes`, `--autorun`,
`--plain`. A misspelled flag fails fast; `--help` prints the full reference and
`--version` prints the version.

The app control API binds only to loopback, generates a random token at startup and
writes it to `<out>/control.json` (0600). Routes and curl examples are in the
[App control API](#app-control-api) section below.

### Window and focus modes

Measured in Phase 0:

| Mode | Behaviour | Recordable | Interactive |
|---|---|---|---|
| `hidden` (default) | window is never shown | yes | yes with focus emulation |
| `hidden` + `--focus-emulation=false` | window is never shown | yes | no, clicks are dropped |
| `inactive` | window is shown without taking focus | yes | yes |
| `offscreen` | window is shown at (-12000, -12000) | yes | yes |
| `ghost` | window is shown with opacity 0 | yes | yes |
| `focused` | window is shown and takes focus | yes | yes |

Headless mode requires `Emulation.setFocusEmulationEnabled` (on by default), otherwise
CDP physical clicks do not take effect.

### malo-browser agent runtime

`malo-browser` is the background web-execution layer for agents: one long-lived daemon
manages port leases, every agent gets a stable port, and one port can host several
isolated sessions. There is no visible window by default; it does not take focus, does
not cover the screen and does not switch Spaces. Screenshots are produced only on
explicit request or as failure evidence.

```bash
npm run daemon
# in another terminal
curl -s http://127.0.0.1:7410/health
cat ~/.malo-browser/broker.json
```

Defaults: broker `127.0.0.1:7410`, lease port pool `7411-7499`, data directory
`~/.malo-browser`. A successful start prints one JSON line and writes
`~/.malo-browser/broker.json` (0600) with `{endpoint, token, pid}`. Only one daemon may
use a data directory: a healthy running instance makes the new process fail loudly, and
a stale `broker.json` left by a stopped instance is overwritten.

Daemon flags: `--daemon-port=7410`, `--port-min=7411`, `--port-max=7499`,
`--lease-ttl-seconds=300`, `--session-idle-seconds=300`, `--max-sessions=4`,
`--data-dir=~/.malo-browser`.

A new session needs both the lease token and its own session token; a session token from
session A cannot read session B (401). `width` / `height` are the page viewport, and the
handoff toolbar does not consume them. Sessions without a `profile` are anonymous and
are wiped on close; sessions created with `{"profile":"work"}` share that profile's
cookies and storage across sessions and daemon restarts. Profile names allow lowercase
letters, digits, dot, underscore and hyphen (max 64 chars). Data lives under
`<data-dir>/leases/<lease-id>/sessions/<session-id>/{downloads,artifacts}`, profile data
under `<data-dir>/chromium`.

`delivery-video` is only a visual-output adapter; it does not define the malo-browser
kernel boundary.

### Verification scripts

- `npm run smoke:malo -- ~/.malo-browser/broker.json http://127.0.0.1:4788` runs the
  real daemon chain (see also [docs/malo-browser.md](docs/malo-browser.md)).
- `npm run smoke:toolbar` builds and drives the handoff toolbar in a hidden window.
- `npm run smoke:control -- report-review` talks to an already running control API; set
  `DEMO_CONTROL_URL` (default `http://127.0.0.1:7317`) and `DEMO_CONTROL_TOKEN` from
  `<out>/control.json`.

## Scene scripts

Scenes are YAML files at `fixtures/scenes/<id>/scene.yaml`, loaded through the
`demo://scene/<id>/...` protocol, which only serves files inside the scene directory.
The field contract is [schemas/scene.schema.json](schemas/scene.schema.json).

### Bundled scenes

- `report-review`: the currently usable demo, 7 steps
  `wait_for -> highlight -> click -> fill -> assert -> spotlight -> annotate`. The page
  loads as `demo://scene/report-review/index.html`.
- `multi-a -> multi-b`: verifies multi-scene switching: 1280x720 switches to 1600x900
  through one continuous screencast, and evidence records `run.scene_ids`.
- `login-demo`: the full account-login path (see below).

Scene actions: `goto`, `login`, `wait`, `wait_for`, `wait_for_presenter`, `click`,
`fill`, `press`, `scroll`, `highlight`, `spotlight`, `annotate`, `mask`, `blackout`,
`assert`, `scene`, `set`, `note`, `screenshot` (19 actions).

### Target resolution

Targeted actions resolve in a fixed order, first match wins:

| Priority | Form | Resolved to |
|---|---|---|
| 1 | `data_demo_id: increment` | `[data-demo-id="increment"]` |
| 2 | `selector: ".btn-primary"` | raw CSS selector |
| 3 | `text: 金额异常` | text match (rules below) |
| 4 | `x: 640` + `y: 360` | viewport point (no selector, last resort) |

Text matching picks the smallest **visible** element (not hidden, has size) whose text
**contains** the target string, and marks it with a runtime attribute for later commands
in the same step. No match, or no target at all, reports `E_SELECTOR_NOT_FOUND` (the
message distinguishes "no element contains this text" from "the step has no resolvable
click or visual target").

Three special cases do not use `text` as the target:

- `fill`: `text` is the input content; the target is `selector` / `data_demo_id` /
  coordinates, or `target_text` names the element to click.
- `annotate`: `text` is the annotation copy; the target must be `selector` /
  `data_demo_id` / coordinates.
- `wait_for`: `text` is the wait condition (wait for text to appear), not a click target.

### Account login

The `login` action uses a `0600` account file outside the repository; a scene stores only
`account_id`, the password is read from `password_env` at runtime, and the action opens
the login page, fills, submits and waits for a success condition.
`fixtures/scenes/login-demo` verifies the whole path. The default account file is
`~/.config/malo-browser/accounts.json`, overridable with `MALO_BROWSER_ACCOUNTS`. The file
must live outside a git worktree, be a regular `0600` file, keep `origin` and `login_url`
same-origin, and define `success_selector` or `success_url`; a plaintext `password` field
is rejected. Format, security boundary, examples and failure troubleshooting:
[docs/accounts.md](docs/accounts.md).

### Scene variables

`vars` holds scene-local strings; `${name}` interpolates them into action fields, and
`${env:SCENE_NAME}` reads an environment variable from the `SCENE_` namespace only — any
other name is rejected, so a third-party scene cannot pull cloud keys or tokens into a
URL or form field.

### Validation

Scene validation reports every error at once; unknown fields, out-of-range times and
missing targets fail before the scene loads.

## Recording and evidence

### Output files

A `--mode=record` run writes, per take:

```text
evidence/
  hidden.mp4
  hidden.evidence.json      # version, viewport, DPR, frames, duration, SHA256, steps, self-checks
  hidden.overlay-frame.png  # overlay check frame (not written with --plain)
  hidden.overlay-before.png # same moment before the overlay (not written with --plain)
```

An app-mode take (autorun or control API) writes
`<out>/recordings/<timestamp>_<scene>/take-01.mp4` plus `take-01.evidence.json`; a failed
`assert` step also writes `<out>/errors/<scene>/step-<index>.png` (other failing actions
carry the error, not a screenshot).

App-mode evidence and the encoded mp4 are written with mode 0600. The document records `status`,
`app`, `scene`, `run` (including `run.scene_ids` for multi-scene takes), `capture`,
`video`, `steps`, `checks`, `warnings` and `error` when the take failed.

### Self-checks

A `--mode=record` take exits 0 only when every self-check passes: no Node in the window,
frames arrived, duration within ±0.5s, 30fps, 1920x1080, black-frame ratio <50%, and the
overlay really ended up in the video (skipped for `--plain`).

App-mode takes check `frames_arrived`, `steps_completed` and `steps_within_take`; a
failed step or a failed check marks the evidence `failed` and the take carries
`video.partial`. Failed self-checks raise `E_EVIDENCE_MISMATCH` with the failing check
ids. In the autorun path a failed step still stops the recorder first, so the take keeps
its video and its failed evidence.

### Failed takes

"Failure also has evidence" holds for every entry point:

- `--mode=record` writes `<out>/<label>.evidence.json` with `status: "failed"`,
  `video: null`, `error.code`, `error.message` and the failing `error.step` whenever the
  run throws before the video is encoded — opening the stage (for example an unreachable
  page, reported as `ERR_CONNECTION_REFUSED`), capture, step or encoding failure.
  `artifacts` lists any partial files that were written before the failure.
- app mode (`--autorun`, control API, IPC) writes the take's `take-01.evidence.json`
  with `status: "failed"`, `video: null`, `error.code` and `error.message` when the
  recorder fails before encoding — including the zero-frame case
  `E_RECORDER_NO_FRAMES` — and then rethrows the original error, so the exit code /
  control-API error is unchanged.
- A take whose recorder succeeded but whose run had a failed step keeps the video
  (`video.partial: true`) and records the step error.
- `--keep-frames` additionally keeps the raw frames of a failed take.

### Exit codes

| Exit code | Meaning |
|---|---|
| 0 | success: every self-check passed (an `--mode=app --autorun` success also prints one JSON line on stdout) |
| 2 | argument error or general failure (page load failure, `E_SELECTOR_NOT_FOUND`, assertion failure, CDP attach failure, scene validation failure, port busy, evidence self-check failure) |
| 3 | ffmpeg/ffprobe missing or failed (`E_FFMPEG_MISSING` / `E_FFMPEG_FAILED`; install ffmpeg) |
| 4 | recorder failure (`E_RECORDER_NO_FRAMES` and other capture/timeline errors) |

## Control API

### App control API

Started with `--control-api=true` (or `npm run start:control`), it binds
`127.0.0.1:7317` by default and drives the same `dispatchCommand` path as the Director:

```bash
curl http://127.0.0.1:$PORT/health
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:$PORT/state
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:$PORT/scenes
curl -X POST -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"cmd":"run.start","args":{"mode":"record"}}' http://127.0.0.1:$PORT/command
curl -N -H "Authorization: Bearer $TOKEN" http://127.0.0.1:$PORT/events
```

`x-demo-token: $TOKEN` is accepted as the equivalent of the bearer header.
`POST /command` returns 200 with `{"ok":true,"result":...}`; `DemoError` maps to 400,
`E_PROFILE_LOCKED` / `E_STEP_TIMEOUT` / `E_RECORDER_NO_FRAMES` to 409, and anything else
to 500. `/events` is SSE: a `: connected` comment, then a `: ping` comment every 15
seconds, and `data:` lines carrying `AppEvent` JSON. The token is in
`<out>/control.json` (0600) as `{url, token, pid}` and is compared with
`crypto.timingSafeEqual`. The server sends no CORS headers, so a cross-origin browser
script cannot call it; the API is for local scripts.

### Agent tool API

The lease endpoint exposes agent tools. `GET /v1/tools` returns the list with JSON
Schema, and a call is `POST /v1/sessions/:id/tools/<tool>` with both the lease token and
the session token:

```bash
curl -X POST http://127.0.0.1:7411/v1/sessions/$SESSION_ID/tools/snapshot \
  -H "x-malo-lease-token: $LEASE_TOKEN" \
  -H "x-malo-session-token: $SESSION_TOKEN" \
  -H "content-type: application/json" \
  -d '{"max_chars":8000,"max_items":120}'
```

Tools: `navigate`, `history`, `events`, `observe`, `snapshot`, `extract`, `click`,
`fill`, `upload_file`, `press`, `hover`, `select`, `focus`, `scroll`, `scroll_into_view`, `wait_for`,
`sleep`, `assert`, `run_steps`, `network_capture`, `responses`, `watch`, `login`,
`profiles`, `close`. `snapshot` returns body text, title, links, buttons, inputs, forms,
tables, landmarks, iframes, dialogs and selectors for interactive elements; `extract`
does targeted reads. `network_capture` subscribes this session to XHR/fetch response
bodies for matching URL prefixes and `responses` returns them by seq, in daemon memory
only. `run_steps` runs a list of those tools in order (stop at the first failure by
default), writes a run report to the session's `artifacts/run-<timestamp>.json`, and
returns `{ ok, step_count, failed_step, steps, report_path }`; `run_steps`, `watch`,
`login`, `profiles` and `close` cannot be nested inside `run_steps`; `network_capture` and
`responses` are session controls and are rejected there too, so captured bodies never
reach a run report.

Status mapping on the lease endpoint: bad arguments, unknown tools, selector-not-found
and navigation policy violations → 400; unknown session → 404; locked profile → 409;
session cap → 429; navigation failure → 502; step timeout → 504; real server failures →
500. A navigation failure carries `details.navigation` (`http_status`, `net_error`,
`net_error_description`, `settle`).

### Profile login import

`POST /v1/profiles/:name/import` seeds a persistent profile with cookies read live from
another Chromium's DevTools endpoint, so a logged-in daily Chrome can hand its login
state to a malo profile without re-typing credentials:

```bash
curl -X POST http://127.0.0.1:7411/v1/profiles/work/import \
  -H "x-malo-lease-token: $LEASE_TOKEN" \
  -H "content-type: application/json" \
  -d '{"cdp_url":"http://127.0.0.1:9223"}'
```

Body: `cdp_url` (required, loopback `http://` only), `domains` (optional allowlist, e.g.
`["example.com","example.org"]` — a cookie matches when its domain equals, is a subdomain of,
or is a parent of an entry), and `session_cookie_ttl_days` (default 180; session cookies
are re-stamped as persistent so the imported login survives daemon restarts; `0` keeps
them session-only). The daemon connects to the source's browser-level WebSocket and calls
`Storage.getCookies`, writes each cookie through the Electron cookie store of the target
profile's partition, and returns
`{ profile, created, source, cookies_total, cookies_matched, cookies_written, cookies_failed, failed }`
(`failed` lists up to 20 per-cookie write errors, e.g. `__Host-` cookies that fail
Chromium's prefix rules; `cookies_failed` counts that capped list, not all failures). Importing merges into whatever the profile already has; it
never clears existing state, and cookies whose login has expired on the server side still
need a real re-login. Source unreachable → 502 `E_IMPORT_SOURCE_UNREACHABLE`; zero
cookies matched → 400 `E_IMPORT_EMPTY`. Only cookies move; localStorage, IndexedDB and
HTTP cache stay in the source browser.

Security boundary: loopback only, `Host` must be `127.0.0.1:<port>` or
`localhost:<port>` (DNS-rebinding guard), JSON only with a 1MB body cap, broker / lease /
session tokens are three separate layers, navigation is `http:`/`https:` only with
URL-embedded credentials rejected, and `window.open` plus permission requests are denied
by default. The old `x-pagehand-*` token headers are still accepted; new scripts use
`x-malo-*`.

### assert and run_steps verdicts

A failed assertion is a business verdict, not a broken service. `assert` answers **HTTP
200** with the verdict on the result:

```json
{
  "tool": "assert",
  "result": {
    "ok": false,
    "passed": false,
    "checks": [{ "kind": "visible", "expected": true, "actual": false, "ok": false }],
    "url": "https://example.com/done",
    "waited_ms": 5001,
    "screenshot": "<artifacts>/failure-<ms>.png",
    "error": {
      "code": "E_ASSERTION_FAILED",
      "message": "E_ASSERTION_FAILED: 断言失败：visible expected true, got false",
      "details": {
        "checks": [{ "kind": "visible", "expected": true, "actual": false, "ok": false }],
        "waited_ms": 5001,
        "screenshotPath": "<artifacts>/failure-<ms>.png"
      }
    }
  }
}
```

On success `result.ok` and `result.passed` are `true`, and `result.checks` holds every
check. So for both `assert` and `run_steps`, read `result.ok` for the verdict:
`run_steps` also answers 200 when the batch ran, with `result.ok: false` plus
`failed_step` and `steps[].error`. Invalid arguments stay 4xx and genuine server
failures stay 5xx.

Contract change in 0.1.2: an `assert` failure used to be HTTP 500 with
`{"ok":false,"error":{"code":"E_ASSERTION_FAILED",...}}`. Callers that treated the 500
status as "assertion failed" must now read HTTP 200 plus `result.ok`. This is a 0.1.x
contract change, hence the explicit note.

### Human handoff

Logins, QR codes and human checks should not be brute-forced by an agent. `watch` and
`login` make "human takes over once, agent gets control back" a contract: the window
appears with `showInactive` by default (no keyboard focus, no Space switch), has a native
title bar and a browser toolbar (back, forward, reload, address bar that accepts only
http/https, Enter to navigate, address synced from the page). `focus: true` is the only
way to bring it to the front. Credentials live only in that call's memory: never written
to disk, events or responses; password fields read `[redacted]` and `assert value` on a
password input is rejected instead of compared. A successful `login`
hides the handoff window again (unless `keep_visible: true`), and the agent keeps the
same session; `watch` stays visible until it is hidden explicitly, and a timed-out
handoff window is not closed automatically. The login state survives only with a
`profile`.

## Project layout

```text
src/main/
  index.ts            # startup, exit codes, top-level failure handling
  cli.ts              # flags
  app.ts              # app mode: scene service, Director, autorun, IPC
  app-controller.ts   # state snapshot, scene loading, run, recording, evidence
  ipc.ts              # Director channel and control commands
  control-dispatch.ts # command dispatch shared by Director IPC and the control API
  control/            # loopback HTTP control API (token + SSE)
  stage-layout.ts     # scene size / policy / visit-order math
  demo-protocol.ts    # demo:// scene protocol (registered per session)
  electron-page-driver.ts  # PageDriver on Electron (CDP physical events)
  electron-overlay.ts      # OverlayPort: cursor/highlight/spotlight/annotate/mask/blackout
  malo/               # malo-browser daemon: port pool, leases, broker, sessions, HTTP
  scenes/             # Zod validation, scene loading, interpolation, script hash
  runner/             # state machine, 19 actions, target resolution
  capture/            # screencast frames, 30fps timeline, ffmpeg, evidence
  security/           # allowlist, path safety, permission and download policy
  windows/            # Stage (BaseWindow + WebContentsView), Director
  phase0.ts           # Phase 0 smoke / --mode=record path
src/renderer/director # presenter console (React + lucide)
src/preload/          # Director bridge (sandbox-safe)
src/fixture/          # React fixture: counter, search, risk rows, animation
fixtures/scenes/      # loadable scenes (report-review, login-demo, multi-a, multi-b)
scripts/
  run-phase0.sh      # primary evidence reproduction
  malo-smoke.mjs     # multi-agent / multi-session daemon smoke
  control-smoke.mjs  # control API: load -> record -> evidence
  toolbar-smoke.mjs  # handoff toolbar (hidden StageWindow)
  malo-web-probe.mjs # site compatibility probe (captures + screenshots)
  compare.cjs        # SSIM comparison between two videos
```

## Troubleshooting

- `EBADENGINE` warning/failure -> wrong Node line; use a range from `engines`
  (>=22.12 on the 22 line, 24.x, or >=26; not 23/25).
- Exit 0 with no stdout and no files in `<out>` -> `ELECTRON_RUN_AS_NODE` is set in that
  shell (`echo $ELECTRON_RUN_AS_NODE`), so Electron ran as plain Node and never started
  the app; re-run as `env -u ELECTRON_RUN_AS_NODE npx electron ...`.
- Exit 3 `E_FFMPEG_MISSING` -> install ffmpeg (e.g. `brew install ffmpeg`) and re-run.
- Exit 4 / recording failure -> open the take's `.evidence.json`: it exists even when no
  video was written (`video: null`, `error.code`). `E_RECORDER_NO_FRAMES` means the
  screencast delivered no frames; check that the page really rendered and that the window
  was not destroyed mid-take.
- `EADDRINUSE` -> the message names the right surface: `--control-port` for the control
  API, `--daemon-port` for the broker, `--port-min`/`--port-max` for the lease pool.
- Control API 401 -> read the token from `<out>/control.json` and send it as
  `Authorization: Bearer <token>` or `x-demo-token: <token>`.
- Director shows a MOCK marker -> the preload bridge is missing; launch via `npm start` /
  `npm run start:control`, not by opening the HTML directly.
- `E_SELECTOR_NOT_FOUND` -> no visible element matched; check target syntax. For `fill`
  the `text` is the input content, so the target needs `selector` / `data_demo_id` /
  coordinates (or `target_text`); for `annotate` `text` is the annotation copy.
- `E_ACCOUNT_NOT_FOUND` -> account file or `account_id` missing; check
  `MALO_BROWSER_ACCOUNTS` and the ids listed in the error.
- `E_ACCOUNT_INVALID` with `0600` or `outside a git worktree` -> move the profile outside
  the repo and run `chmod 600 <accounts.json>`.
- `E_ACCOUNT_INVALID` with `environment variable` -> export the profile's
  `password_env` in the shell that launches Electron; never put the password in scene
  YAML.
- A window steals focus during recording -> a focusing `--window-mode` was passed; the
  defaults (`hidden`/`inactive`) never take focus.
- `assert` returns HTTP 200 with `result.ok: false` -> that is the verdict, not a broken
  service; read `result.error.details.checks` and the failure screenshot.
- malo session 401 -> send both the lease token and the session token; a session token
  from another session is rejected. 404 after a long idle period -> the session was
  reaped, create a new one.
- Daemon refuses to start -> another daemon owns that data directory; stop it or pass a
  different `--data-dir`.

## Side effects

- Writes evidence and recordings under `--out` (default `./evidence`): mp4, evidence
  JSON, overlay check frames, app-mode takes under `recordings/`, failed step
  screenshots under `errors/<scene>/`, and `control.json` (0600) when the control API is
  on.
- Starts ffmpeg/ffprobe child processes while encoding and self-checking; capture itself
  costs CPU while the take runs.
- Binds loopback ports only: control API `7317`, broker `7410`, lease pool `7411-7499`
  (all configurable). No listener on external interfaces.
- Opens windows depending on mode: none by default in record / autorun / headless;
  a visible, unfocused stage with `npm start`; the handoff window for `watch`/`login`.
  Non-interactive macOS modes switch to the accessory activation policy and hide the
  Dock icon; while any human-visible window is on screen the Dock icon is shown so a
  buried window can be raised from the Dock, and it disappears again once none is left.
- The malo daemon keeps running until stopped, writes `~/.malo-browser` (broker.json
  0600, Chromium profile data, per-session downloads/artifacts), and deletes anonymous
  session partitions when those sessions close.
- Login state persists only for named `profile` sessions, until
  `DELETE /v1/profiles/:name`.
- Permissions and `window.open` are denied. Downloads are allowed, but only into the
  session's own `downloads/` directory (sanitized filename); the demo stage additionally
  refuses downloads unless the scene policy allows them.

## Limitations

- Verified on macOS only; other platforms are untested.
- Recording caps at 1920x1080 and a 30fps timeline; evidence self-checks enforce that.
- Not a general-purpose browser: no tabs, bookmarks or multi-tab UI; the handoff window
  only has an address bar plus back/forward/reload.
- Loopback only: no remote access, no multi-user service, no approval flow or remote
  deployment.
- Hidden mode needs focus emulation; with `--focus-emulation=false` physical clicks are
  dropped.
- The agent runtime runs one daemon per data directory, defaults to 4 sessions per lease
  and reaps idle sessions after 300 seconds; it never streams video continuously.
- Login handling is auto-detection plus selector overrides, not a per-site adapter
  layer.
- Sites can block automated or headless browsers at the network / challenge layer; see
  [docs/malo-web-compat.md](docs/malo-web-compat.md). `network_capture` covers the page
  target only: OOPIF (cross-process iframe) and Service Worker requests are not captured.
- 0.1.x contract change: `assert` failures are HTTP 200 with `result.ok: false`, not
  HTTP 500. Callers that keyed on 500 must be updated.

## License

MIT (see [LICENSE](LICENSE)).
