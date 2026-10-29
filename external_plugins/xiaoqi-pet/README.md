# Xiaoqi Desk Pet (小栖桌宠)

A ZCode plugin that puts a small elephant on your desktop. It floats above every window and mirrors what your ZCode sessions are doing — thinking, running tools, waiting for your approval, or finished — with a multi-session task board, color-coded drawer cards, single-task bubbles, desktop notices, and a usage/balance capsule on the pet's belly.

Ported from [dsh-xiaoqi-pet](https://github.com/white-source/dsh-xiaoqi-pet) 1.5.2 (a DeepSeek Harness companion). The HTTP bridge and web overlay were replaced with ZCode plugin hooks feeding local event files — no port, no token. The pet itself comes in two flavors: a **native macOS Swift app** and a **cross-platform Electron app** for Windows / Linux / macOS; both read the same event files.

## Components

| Part | Role |
| --- | --- |
| **Hooks** (7 events) | `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`, `Stop` — each wraps the hook's stdin JSON into an atomic event file. `feed-event.sh` on macOS/Linux; Windows without bash falls back to `feed-event.ps1` automatically. The plugin ships hooks, so ZCode enables the hook runner on install. |
| **Skill** `xiaoqi-pet` | Lets the agent make the pet speak by writing an emote event file. |
| **Command** `/pet-say <text>` | Quick way to have the pet say something. |
| **Native macOS app** `desktop/` | Menu-bar accessory (`LSUIElement`), SwiftUI rendering. Recommended on macOS. |
| **Electron app** `desktop/electron/` | The pet for Windows / Linux (also runs on macOS, but exits when the native app is running so two pets never appear). |

## What the pet shows

- One floating, draggable pet with mood-based breathing, a task-count badge and a caption that follows the most active session.
- **Belly capsule**: by default **today's token usage** from ZCode's local usage database (zero config); with `balance.json` configured it shows your **plan balance** instead. Hover for the breakdown (input / output / reasoning / turns / tool calls / last 7 days). Refreshes every minute; the tray/menu has a manual refresh.
- **One active session** → a compact bubble with the task, current action and elapsed time.
- **Two or more sessions** → color-coded drawer cards (stable per-session colors) with the current checklist item or action, elapsed time and the last few steps; up to 16 sessions.
- **Task board** (click the pet) → *Needs you / In progress / Just finished* groups with bordered, color-coded cards.
- **Notices** → a non-blocking bubble when a session starts waiting for approval or finishes in the background (system notifications in the Electron app).
- Clicking a task card brings ZCode to the front. Drag anywhere; the pin freezes the position (native app). English and Chinese, light and dark.

## Install (two steps: plugin + pet app)

### 1. Install the plugin in ZCode (all platforms)

**Plugin Marketplace → Add → Add Plugin Marketplace**, enter `white-source/zcode-xiaoqi-pet`, then install **Xiaoqi Desk Pet (小栖桌宠)**. This activates the hooks, skill and the `/pet-say` command.

Without the pet app the plugin still works silently — it only writes event files (the hook sweeps leftovers older than a day).

### 2a. macOS: download the native pet

Grab `ZCode-Xiaoqi-Pet-*-macos-arm64.zip` from [Releases](https://github.com/white-source/zcode-xiaoqi-pet/releases/latest), unzip and drag `ZCode Xiaoqi Pet.app` into Applications. The build is unsigned, so on first launch right-click → Open, or:

```sh
xattr -dr com.apple.quarantine "/Applications/ZCode Xiaoqi Pet.app"
open -a "ZCode Xiaoqi Pet.app"
```

Requires macOS 13+. Menu-bar paw icon: show/hide, board, pin, rescan, refresh usage, quit.

To build from source instead:

```sh
cd xiaoqi-pet/desktop
./build.sh --install
```

Requires Xcode command-line tools.

### 2b. Windows / Linux: download the Electron pet

Grab `*-win-x64.zip` (or `-win-arm64.zip`) from [Releases](https://github.com/white-source/zcode-xiaoqi-pet/releases/latest) and run the exe, or download the `*.AppImage` and `chmod +x` it. Linux needs a compositing window manager for transparency.

Running / packaging from source requires Node.js 22+:

```sh
cd xiaoqi-pet/desktop/electron
npm install
npm start               # run directly
npm run dist:win        # Windows zip (x64 + arm64)
npm run dist:linux      # Linux AppImage (x64)
```

See [desktop/electron/README.md](desktop/electron/README.md).

### 3. Try it

Run any ZCode session — the pet wakes up within a second. `/pet-say hello` makes it speak.

## Plan balance: how to configure

ZCode's plan-quota API needs login credentials that ZCode stores encrypted; the plugin does not touch them, so the capsule defaults to local usage. If you have any JSON endpoint that reports a balance (a BigModel billing endpoint, a new-api / one-api relay, or a tiny proxy of your own), drop a `balance.json` into the state directory:

```json
{
  "url": "https://example.com/api/quota",
  "headers": { "Authorization": "Bearer xxx" },
  "valuePath": "data.remaining",
  "label": "Plan balance",
  "prefix": "¥",
  "suffix": ""
}
```

`valuePath` is a dot path into the response (array indexes work, e.g. `data.balances.0.balance`). On fetch failure the last good value is kept and marked stale in the tooltip. State directories:

| Platform | Directory |
| --- | --- |
| macOS | `~/Library/Application Support/XiaoqiPet/` |
| Windows | `%APPDATA%\XiaoqiPet\` |
| Linux | `$XDG_CONFIG_HOME/xiaoqi-pet/` (default `~/.config/xiaoqi-pet/`) |

It contains `feed/` (hook events), `emote/` (pet speech) and optionally `balance.json`.

## How the feed works

`hooks/feed-event.sh` (or `.ps1`) appends one JSON file per hook fire into `feed/`:

```json
{"v":1,"event":"PreToolUse","at":1769600000,"cwd":"/path/to/project","payload":{ …raw hook stdin… }}
```

The pet scans `feed/` once per second, folds the events into an in-memory per-session state machine (the port of the original host-side progress logic, implemented twice — Swift and JS — with identical semantics), and deletes each consumed file. Stale sessions prune themselves: running after 60 min, waiting after 12 h, done after 10 min without events.

**Privacy:** session titles are just the project folder name — no prompt or response content is ever displayed. Hook payloads (which can include prompt text in `UserPromptSubmit` and a response preview in `Stop`) are written to user-only local files and deleted the moment the pet consumes them; an hourly sweep in the hook removes leftovers older than a day. Usage statistics are read-only from `~/.zcode/cli/db/db.sqlite`; the pet never writes it and never talks to the network (except the optional `balance.json` endpoint you configure).

## Troubleshoot

```sh
~/Applications/ZCode\ Xiaoqi\ Pet.app/Contents/MacOS/XiaoqiPet --diagnose
```

prints the feed directory, pending file count, the sessions the pet would render, today/7-day usage and whether a remote balance is configured. `pendingFeedFiles > 0` means the pet is not running or not consuming. On Windows / Linux check the Electron console output.

## Side effects, permissions and third-party material

- **Hooks run a short-lived process on seven events.** ZCode executes `bash "<plugin>/hooks/feed-event.sh" <Event>` (`powershell -File …feed-event.ps1` when bash is unavailable). Each run writes one JSON file of at most 64 KB under the state directory, exits 0, and is capped at a 5 s timeout. It never blocks or edits the session and leaves the event file for the pet to consume.
- **Files written:** `<state>/feed/*.json` and `<state>/emote/*.json`. State directory: macOS `~/Library/Application Support/XiaoqiPet/`, Linux `${XDG_CONFIG_HOME:-~/.config}/xiaoqi-pet/`, Windows `%APPDATA%\XiaoqiPet\`. The desktop pet deletes each event file after reading it; the hook sweeps leftovers older than a day.
- **Network:** the plugin itself makes no network requests. The desktop pet reads ZCode's local usage database (`~/.zcode/cli/db/db.sqlite`) read-only to show today's token count, and only talks to the network if the user creates an optional `balance.json` pointing at their own quota endpoint.
- **Credentials:** none. The plugin never reads, stores or transmits ZCode credentials or API keys.
- **Desktop pet is a separate download.** The pet app is not bundled and is not downloaded or launched by the plugin; users install it themselves from the project's GitHub Releases. The plugin remains harmless (no visible behaviour, no errors) if the app is absent.
- **Third-party material:** pet artwork and UI structure come from [dsh-xiaoqi-pet](https://github.com/white-source/dsh-xiaoqi-pet) (MIT, © 2026 Xiaoqi Desk Pet contributors).

## Compatibility and verification status

- ZCode Desktop with the 7 standard hook events; macOS 13+ (native); Windows 10+ / common Linux distros (Electron 45).
- Verified on this Mac: Swift build, state-machine output against simulated hook events, usage reads, Electron JS syntax. **Windows and Linux were not run on real machines** — the packaging and the PowerShell fallback are written but transparency, tray behavior and hook delivery still need verification on each target OS.
- No runtime dependencies (the Electron app has none beyond Electron itself), no install scripts.

## License

MIT. The Xiaoqi artwork and UI structure are taken from dsh-xiaoqi-pet (MIT, © white-source).
