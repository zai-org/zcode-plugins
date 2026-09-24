# Managed Browser QA

The managed browser is how ZCode Cycle turns "the UI works" into
evidence. It is a tool inside the governed workflow, not a separate
interface.

## What it is

Each session launches an isolated browser with a temporary profile that
is destroyed on close. Loopback pages (127.x, localhost) open by
default; every other origin is blocked — navigation AND background
requests — until you explicitly approve that origin after the tool
reports `origin-approval-required`. Filled values are redacted from
logs, snapshots and receipts.

## Who may use it

Interactive actions (click, fill, press, upload) are executor-only;
read-only roles may inspect via snapshot, logs and checks. The boundary is the
managed profile's tool list, and the browser tool itself refuses an interactive
action from a read-only role. The PreToolUse hook does not reach a dispatched
role — ZCode runs it for the main session only — so it is not what holds here.

## Evidence

Closing a session persists a receipt: every action with its digest,
timestamp and URL, plus captured logs. For UI-affecting candidates the
daemon adds mandatory gates — `browser:affected-user-flow` requires the
receipt to contain open, check, screenshot, logs, close in order;
`accessibility:affected-user-flow` requires open, snapshot, close. The
orchestrator runs one executor session covering both protocols and
attaches the receipt to verification, bound to the frozen candidate
digest. A skipped browser gate is reported, never hidden.

The accessibility gate does not stop at the operations. The snapshot
carries a summary of the accessibility tree into the receipt — how many
interactive elements it found and how many carry no accessible name — and
the gate fails when any of them are unnamed, naming the roles that were
missing one. A receipt from a browser that recorded no summary cannot
discharge the gate either: there would be nothing to judge.

This is narrower than an accessibility audit and is meant to be. It
catches the failure that makes an interface unusable with a screen reader
— a control that announces as nothing — and it does not claim to have
checked contrast, focus order, or anything else. Point a project-native
check at the gate instead, and it takes precedence: any verification
command whose name contains `a11y`, `accessibility` or `axe` becomes the
accessibility gate for that plan.

## Which browser it uses

Cycle does not download or bundle a browser: it drives one already
installed on your machine, and looks for a stable Chrome, Edge or
Chromium.

| Platform | Looked for, in order |
|---|---|
| Windows | Edge under `PROGRAMFILES`, then Chrome under `LOCALAPPDATA` and `PROGRAMFILES` |
| Linux | `/usr/bin/google-chrome-stable`, `google-chrome`, `microsoft-edge-stable`, `chromium`, `chromium-browser` |
| macOS | Chrome, Edge, then Chromium under `/Applications` |

Set `ZCODE_CYCLE_BROWSER` to an absolute path to use a different
installation. Sessions run headless unless `ZCODE_CYCLE_BROWSER_HEADLESS`
is `false`.

With none of them present the session refuses to start, naming the cause:
*no supported stable Chrome, Edge or Chromium installation was found*. A
mandatory browser gate then cannot be satisfied and the candidate is
refused — which is the intended behaviour, not a failure to handle it.
Install a browser, or point `ZCODE_CYCLE_BROWSER` at one.

## What is certified, and where

The browser and accessibility gates were qualified on **Windows**. On
Linux they are **not certified**: no run has been observed there, because
the qualification environment has no browser installed.

What that does and does not mean. The gate logic, the receipt protocol,
the origin boundary and the redaction are one implementation shared by
both platforms, and the only platform-specific part — the list above — is
covered by tests. So there is no known reason for them to behave
differently on Linux. But "no known reason" is not evidence, and this
project does not record an unobserved row as passed. If you run the
browser gates on Linux and they misbehave, that is a defect worth
reporting rather than a documented limitation.

## Limits

At most two concurrent sessions per project. Screenshots and receipts
live in your user data directory, never in your repository.
