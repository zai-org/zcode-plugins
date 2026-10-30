# Cot Peek / 思考小窗

A floating ball that translates English reasoning traces into Chinese in real time. AI thinks in English; this ball speaks Chinese, half a second after each reasoning round lands on disk.

[中文说明](README_CN.md)

![thinking stream](https://raw.githubusercontent.com/cobaltna/cot-peek/main/screenshots/thinking.png)

## What it does

- **Reasoning stream**: watches ZCode's rollout directory with `ReadDirectoryChangesW`; each finished reasoning round is split into segments, translated by three concurrent workers, and shown as it completes. Latency from file write to on-screen text measured at 0.05 to 0.5 seconds.
- **Clipboard translation**: copy any English text while the window is open and get Chinese within a second.
- **Tabbed window**: one window, two tabs, a pause button. Reading position never jumps; the view only follows when you are already at the bottom.
- **Round ball**: a small dark circle docked at the right edge of the screen, with no rectangular frame. Click to expand, click × to collapse. Collapsing pauses all translation.

![clipboard](https://raw.githubusercontent.com/cobaltna/cot-peek/main/screenshots/clipboard.png)

## Install

From ZCode: Settings → Plugin Management → Discover → add the marketplace `cobaltna/cot-peek` → install 思考小窗. Then run `/cot-peek:start` or just tell ZCode to start it.

Standalone: run `install.ps1` from this directory with pwsh. It locates `pythonw.exe` and registers a per-minute scheduled task `ZCodeCotPeek` so the ball appears whenever ZCode runs and quits the moment ZCode exits. Or double-click `start-cot-peek.bat` to start it once.

Requirements: Windows 10/11, any Python 3 with tkinter.

## Side effects and dependencies

Read this before installing:

- **Network access**: translation requests go to three free public web endpoints, in fallback order: Volcengine translate web API (`translate.volcengine.com`), Bing translator (`cn.bing.com`), MyMemory (`api.mymemory.translated.net`). No keys, no accounts, no telemetry. If all three fail, the original English text is kept and marked red.
- **Files read**: `~/.zcode/cli/rollout/model-io-session_*.jsonl` and the system process list. Nothing else.
- **Files written**: only inside the plugin's own directory: `cot_peek.log`, `cot_peek.json`, `cot_peek.lock`.
- **Processes**: runs `pythonw.exe cot_peek.py`; `install.ps1` registers a Windows scheduled task via `schtasks.exe`.
- **No hooks, no MCP servers, no model-context injection, no writes to ZCode data**.

## Third-party services

Translation is performed by Volcengine, Microsoft Bing, and MyMemory public web endpoints. Their availability and terms may change at any time; Cot Peek degrades gracefully when they do. All other code is original, MIT licensed, Python standard library plus tkinter only.

![ball](https://raw.githubusercontent.com/cobaltna/cot-peek/main/screenshots/ball.png)
