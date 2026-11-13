# Changelog

## 0.1.12

- **登录态导入的坏帧不再能炸掉 daemon。**`POST /v1/profiles/:name/import` 连接源 CDP
  的 WebSocket 后，一条非 JSON 文本帧或二进制帧会在 `onmessage` 里抛 `SyntaxError` 并
  升级为进程级 uncaughtException——daemon 的 fatal 处理走 `app.exit(2)`，整个进程连同
  所有 lease/session 一起下桌。现在坏帧只废掉本次 import：以
  `E_IMPORT_SOURCE_UNREACHABLE`（502）reject 并关闭连接，进程存活。
- **`webSocketDebuggerUrl` 连接前补回环复核。**该地址来自源端点 `/json/version` 响应，
  此前只校验了 HTTP `cdp_url` 的回环边界就直接连 WS，「loopback only」安全边界在 WS
  这一跳有个缺口。现在与 `cdp_url` 同口径复核 hostname，非
  127.0.0.1 / localhost / ::1 直接 400 `E_BAD_REQUEST` 拒绝，且不发起 WS 连接。
- **`clearProfile` 与并发 `create` 同名 profile 的竞态消除。**此前 clearProfile 入口读
  一次 `activeCount` 后，在 clearStorageData / clearCache / 删分区目录 / 删记录的 await
  窗口里穿插同名 create，新 session 会落进正被清空的分区、profiles.json 记录被删、磁盘
  留孤儿分区。现在按 profile 名做进程内互斥：clear 的「占用检查+清理」关键段与 create
  的「登记占用」段共用同一把锁，create 在启动 BrowserSession 之前先登记「即将占用」，
  clear 因此看得见还没 touch 的并发 create（报 `E_PROFILE_LOCKED`），create 失败即撤销
  登记不空拒后续 clear。
- **`extract` 的 `attributes` 逐项校验、fail-loud。**此前非字符串条目被 filter 静默
  丢弃，与同文件 `domains` / `url_prefixes` / `upload_file.files` 的逐项 400 口径不一致；
  现在任一非字符串/空串条目直接 400 `E_BAD_REQUEST` 并点名非法项。

## 0.1.11

- **文档与实现对齐（无行为变化）。**`SKILL.md` 不再把 login 的自动隐藏写到 `watch`
  头上——`watch` 窗口保持可见直到显式再调 `watch`（`show:false`）收起，`login`
  成功才自动隐藏（`keep_visible: true` 例外），与两版 README 一致；`docs/malo-browser.md`
  登录交接规则里的同款失实一并改正，并补上 0.1.8 起存在的
  `POST /v1/profiles/:name/import`（说明 + curl 示例）；`README_CN.md` 补译英文版
  0.1.8 起就有的「Profile 登录态导入」整章（参数、返回字段、错误码、隐私边界）；
  `login-import.ts` 去掉两个无外部消费者的 `export` 修饰符。

## 0.1.10

- **`POST /v1/profiles/:name/import` 的 `domains` 改为逐项校验、fail-loud。**此前
  `[""]` / `[123]` 这类非法条目会被静默过滤成空数组，而空数组在域过滤层等于「匹配
  所有域」——即调用方以为只迁指定域的 cookie，实际全量导入了所有域（隐私边界被击穿）。
  现在任一非法条目直接 400 `E_BAD_REQUEST` 并点名非法项；`domains` 传非数组或空数组
  仍报 400。同时把 `.zcode-plugin` / `.codex-plugin` manifest 与 `package-lock.json`
  根版本从滞留的 0.1.7 同步到当前版本，`SKILL.md` 动作工具枚举补上 0.1.7 新增的
  `upload_file`。

## 0.1.9

- **Human-visible windows now get a Dock icon while they are on screen.** The daemon
  keeps running as an accessory app exactly as before (no Dock icon, no focus stealing,
  no programmatic activation), but the moment a session window is shown for a human
  (`watch` / login handoff) the macOS Dock icon appears, so a window buried behind
  other apps can be raised again by clicking it; the icon disappears once no visible
  window is left. Offscreen and ghost windows never surface an icon and recordings
  stay fully headless. The only focus change is the one the user makes by clicking
  the Dock icon.

## 0.1.8

- **New profile login import: `POST /v1/profiles/:name/import`.** Seeds a persistent
  profile with cookies read live from another Chromium's DevTools endpoint
  (`cdp_url`, loopback `http://` only), so a logged-in daily Chrome hands its login
  state to a malo profile without re-typing credentials. The daemon connects to the
  source browser-level WebSocket, calls `Storage.getCookies`, and writes each cookie
  through the Electron cookie store of the target partition — this crosses the
  Chrome/Electron keychain encryption boundary that makes raw profile-file copies
  unreadable. Optional `domains` allowlist filters which cookies move (equal,
  subdomain, or parent matches); `session_cookie_ttl_days` (default 180) re-stamps
  session cookies as persistent so imported logins survive daemon restarts (`0` keeps
  them session-only). The response reports
  `cookies_total / cookies_matched / cookies_written / cookies_failed` with up to 20
  per-cookie errors (e.g. `__Host-` prefix rejections). Import merges, never clears;
  only cookies move (localStorage / IndexedDB stay in the source). Source unreachable
  → 502 `E_IMPORT_SOURCE_UNREACHABLE`; zero matched cookies → 400 `E_IMPORT_EMPTY`.

## 0.1.7

- **New `upload_file` tool.** Sets files on an `input[type=file]` through CDP
  `DOM.setFileInputFiles`, so the input may stay visually hidden; a site whose upload
  button opens a native picker still needs that button clicked first. `selector` must
  match an input and `files` are absolute paths on the host running the browser. A
  missing selector fails as `E_SELECTOR_NOT_FOUND` (400 on the lease endpoint) like the
  other action tools, and the tool is allowed inside `run_steps`. The manifest now
  declares 25 session tools.

## 0.1.6

Full review pass; every item below was reproduced before fixing.

### Isolation and security

- **Shared-profile sessions no longer cross-wire downloads or network state.** Electron
  keeps one `webRequest` listener and one permission handler per session, and
  `will-download` fires for every webContents in the partition. Two sessions on the same
  `profile` used to fight over `setSavePath` (a download started in A could land in B's
  `downloads/`) and the newer session silently disabled the older one's failure
  tracking. Handlers are now installed once per Electron session and dispatched by
  webContents id (`src/main/malo/partition-hooks.ts`); a download with no owner is
  cancelled.
- **The demo stage now blocks redirects, not just navigations.** Server-side 3xx emits
  `will-redirect`, which was never hooked, so an allowlisted origin could 302 to an
  arbitrary one and the remaining steps ran there. Both events share one gate now.
- **`goto` obeys the scene allowlist.** `webContents.loadURL` does not emit
  `will-navigate`, so tool-initiated navigation was unchecked; the runner now asks the
  host policy first (`assertNavigationAllowed`).
- **`${env:NAME}` is limited to `SCENE_*`.** A third-party scene could interpolate any
  `process.env` value (cloud keys, tokens) into a URL or form field, and the allowlist
  was declared by that same scene. All three interpolation implementations share the
  same rule now (the third one, `interpolateScene`, had no guard at all).
- **`demo://` validates the scene id.** The protocol handler used the URL segment as the
  containment root, so `demo://scene/..%2Fprivate%2Fcredential.json` served files one
  level above the scenes root. It now applies `SCENE_ID_PATTERN`, and a 404 no longer
  echoes the resolved filesystem path to the page.
- **`--data-dir=~/.malo-browser` actually expands `~`** instead of creating a literal `~`
  directory (`--out` and `--scenes` too).
- Data dir and session dirs are created 0700; run reports, failure screenshots and
  encoded takes are 0600 (the legacy evidence writer was 0644).
- `GET /health` on a lease endpoint no longer enumerates `lease_id` / `agent_id`
  without a token.

### Recording and evidence

- **A rejected take no longer claims "no video was written"** while a playable mp4 sits
  on disk: the failed-evidence warning names the file and says it failed self-checks.
- Frame temp dirs (`<take>-frames`, `<take>-seq`) are cleaned even when encoding is
  rejected, so a failed take stops leaving hundreds of JPEGs behind.
- `ffmpeg` / `ffprobe` now run with timeouts (120s metadata probe, 250ms/frame encode,
  20min ceiling) and are killed instead of hanging `stop()` forever. Whole-file decode
  passes (blackdetect, ssim) scale their timeout with the video length, so a long take
  is not failed by a flat cap; a buffer overflow reports itself instead of posing as a
  timeout.
- `capture.timeline_frames` reports the encoder's slot count instead of duplicating
  `video.frames`.
- The `steps_completed` / `steps_within_take` checks only consider steps executed inside
  the take; borrowing the whole scene's step list could pass a take that ran nothing.
- A failed evidence write no longer leaves the recorder stuck in "recording".

### Demo pipeline

- **Director shortcuts can no longer kill the app.** Every shortcut rejection used to
  reach the process-level `unhandledRejection` handler, which calls `app.exit()`; a
  routine "no scene loaded" or "nothing to step back to" ended the session. Shortcuts now
  surface the error in the UI.
- **`goto` / `login` no longer break every later visual step.** Navigation drops the
  injected overlay, and only load/switch re-injected it, so `goto` → `click` failed with
  `TypeError: … reading 'click'`. The overlay is now installed on demand (and re-injected
  after navigation as a best-effort step, so a landing page that redirects again cannot
  fail the take); `reset` / `stop` / `prev` recover too.
- `recorder.start` refuses while a scene is still loading instead of recording a
  half-initialised page.
- `runner.load()` is awaited, removing the load/start race that surfaced as
  "场景尚未就绪" on slow or redirected scenes.
- A failed `scene.load` no longer leaks an untracked `BaseWindow`.
- The documented-but-rejected scene fields now parse: `fill.target_text`,
  `press.modifiers`, and x/y coordinates for `click` / `fill` / `highlight` /
  `spotlight` / `mask` (and `target_text` survives normalization instead of being
  dropped).
- `scroll.behavior: smooth` is implemented; `annotate.position` now places the label
  where it says.
- Director step indexing uses one convention (last executed step), so a paused run no
  longer shows the completed step as both "current" and "next"; `app.error` no longer
  inherits a stale step index and screenshot.
- Blackout state is cleared on scene load and on a same-URL scene switch; leaving
  fullscreen re-applies the active scene's viewport instead of the pre-fullscreen one.

### Tools

- Action errors no longer carry the code twice
  (`E_SELECTOR_NOT_FOUND: E_SELECTOR_NOT_FOUND: …`).
- A selector with invalid syntax is `E_BAD_REQUEST` (400) on every tool instead of a
  misleading `E_STEP_TIMEOUT` (504).
- `extract` with an invalid selector is a 4xx instead of HTTP 200 with `count: 0` and an
  undeclared `error` field.
- `assert value` on a password input is rejected; comparing the redacted literal made
  `value: "[redacted]"` pass regardless of the real value.
- `press` validates the key name instead of reporting success for `Enterr`.
- `run_steps` rejects `login` (it can open a handoff window and type credentials) as the
  docs always claimed, and the docs now also list `close`.
- `network_capture` recovers after a failed `Network.disable` instead of being stuck.
- `ProfileStore` writes recover after one failed write instead of failing forever.

### Docs and packaging

- README/README_CN corrected where they contradicted the code: download policy (the agent
  runtime accepts downloads into the session dir, it does not need a scene policy),
  password redaction (`snapshot` returns `""` + `sensitive`, `[redacted]` is the
  interactive text), failed-step screenshots (only `assert`), `--data-dir=~`, and the
  scene-variable/`SCENE_` rule.
- `docs/malo-browser.md`: mutually exclusive login success heuristic, partition dir
  without the `persist:` prefix, updated `run_steps` blocklist, new permission/mode notes.
- The published field contract `schemas/scene.schema.json` accepts the same step fields
  as the runtime (`target_text`, `modifiers`, coordinate targets), and a unit test now
  fails when the two schemas drift apart — that drift is how the fields became
  documented-but-rejected in the first place.
- `SKILL.md`: `EADDRINUSE` advice distinguishes control / broker / lease, invalid
  selector is `E_BAD_REQUEST`, added `E_NAV_BLOCKED` and the `SCENE_` rule.
- `package.json` `files` now ships `docs/` and `schemas/`, which the bundled skill links
  to (the DSH bundle is still installed from the prebuilt Release tarball because `out/`
  is gitignored); `scripts/pack-dsh-bundle.sh` stages the same two directories.
- `package-lock.json` root version caught up with `package.json`.

Tests: 232 → 254.

## 0.1.5

- `scripts/pack-dsh-bundle.sh` builds and packs the prebuilt DSH bundle attached
  to the GitHub release. The DSH plugin is installed from that asset, because
  `out/` is gitignored and a source install would leave `index.js` pointing at a
  compiled entry that does not exist yet.

- Added the `network_capture` and `responses` session tools: subscribe to URL prefixes,
  navigate/interact, then poll the captured XHR/fetch response bodies. Capture reuses the
  page driver's single CDP attach (no second debugger, no focus change); the Network
  domain is enabled lazily with 64 MiB/8 MiB response buffers and disabled when the
  subscription clears.
- Records keep every response's metadata in one 500-entry window, while bodies are kept
  only for subscribed hits up to 200 records and a 16 MiB budget. Each body is capped at
  1 MiB (`body_truncated`); base64 payloads report `body_error: "binary"` instead of a
  lossy UTF-8 decode, and queued bodies report `"pending"`. Query envelopes use
  `has_more`, not `truncated`, so they cannot be confused with `body_truncated`.
- Capture state is session-private and in memory only: bodies never reach logs, evidence,
  traces or run reports, and `MaloNetworkInfo` is unchanged. A capture subsystem failure
  surfaces as `E_CAPTURE_UNAVAILABLE` (`ok: false`) instead of an empty list.

## 0.1.4

- `--mode=record` now leaves failed evidence for every pre-encode throw, including
  opening the stage. An unreachable page writes `<out>/<label>.evidence.json` with
  `status: "failed"`, `video: null`, the real Chromium code (`ERR_CONNECTION_REFUSED`),
  the failing `error.step`, the steps captured so far and any partial `artifacts`; the
  original error and exit code 2 are unchanged. Covered by
  `tests/unit/phase0-failed-evidence.test.ts`.
- `resolveTool` keeps resolving `ffmpeg`/`ffprobe` from `PATH` first and only then from
  the documented Homebrew/local directories; a real miss now throws a typed
  `DemoError` (`E_FFMPEG_MISSING`, exit 3) and the policy is unit-tested via
  `resolveToolOnPath`.

## 0.1.3

- Removed `docs/phase0-report.md`, `docs/phase1.md`, `docs/phase1b.md`: internal
  engineering reports, never linked from the README, the skill or any test.
- Removed `scripts/baseline_chrome.py`. It rebuilt a Chrome baseline from the
  author's private `~/recorder-pipe` virtualenv, so it could not run on another
  machine; `scripts/compare.cjs` still compares two recordings.

## 0.1.2

- `README.md` is English again and `README_CN.md` is its Chinese translation with
  the same section structure (install / run / scene scripts / recording and
  evidence / control API / troubleshooting / side effects / limitations). Both were
  re-checked against the current code for commands, flags, ports, paths and artifact
  names; the plugin packaging notes moved into the shared structure.
- An `assert` failure now uses the same contract as a failed `run_steps` batch:
  HTTP 200 with `result.ok: false`, per-check `expected`/`actual` on
  `result.checks` and `result.error.details.checks`, and the failure screenshot.
  Invalid arguments stay 4xx and real server failures stay 5xx. Callers that keyed
  on the old HTTP 500 must read `result.ok` instead — a 0.1.x contract change.
- App mode now leaves failed evidence when a take dies before encoding: a zero-frame
  `recordStop` (`E_RECORDER_NO_FRAMES`) and any other recorder stop failure write the
  take's `.evidence.json` with `status: "failed"`, `video: null`, `error.code` and
  `error.message` instead of only logging a line, matching `--mode=record`. Exit
  codes and control-API errors are unchanged.

## 0.1.1

- A failed step keeps one error-code prefix: `E_SELECTOR_NOT_FOUND: 找不到元素
  #m` instead of `E_SELECTOR_NOT_FOUND: E_SELECTOR_NOT_FOUND: ...` in stderr,
  the run snapshot and evidence step details.
- An autorun take that fails on a step now stops the recorder and writes
  failed evidence with the real cause, instead of exiting 2 with no artifact.
- Evidence no longer says `passed` for a run with a failed step: it records
  `status: failed`, the run error and `video.partial`, and `recorder.stop` only
  reports `E_EVIDENCE_MISMATCH` when a recording self-check fails.
- The human-handoff toolbar no longer shrinks the page: session `width`/`height`
  are the page viewport again (a 1280x800 session rendered 1280x756 before), and
  screenshots match the requested size. `npm run smoke:toolbar` checks it.
- An invalid scene lists the actual field errors in the message instead of only
  `N error(s)`.
- A busy broker/lease port points at `--daemon-port` / `--port-min`--`--port-max`
  instead of telling the user to change `--control-port`.
- Documented the handoff toolbar, `run_steps`, the session viewport rule, the
  `overlay-before` frame and the `smoke:toolbar` / `smoke:control` scripts;
  `package.json` now declares the published `files` list.

## 0.1.0

- Scene-driven Electron stage, hidden 1920x1080@30fps recording with evidence
  files, window modes, director console and loopback control API.
- `malo-browser` agent runtime: broker daemon, port leases, isolated sessions,
  page tools, `assert`, `run_steps`, login handoff, persistent profiles.
