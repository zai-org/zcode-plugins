# orbtile-start for ZCode

[中文](README_CN.md)

A small starter for [Orbtile](https://orbtile.com), the app for macOS and Windows that shows the live state of your coding agents on a keypad.

## What it does

- The `orbtile-status` skill checks this computer: is the Orbtile app installed, is Orbtile's ZCode approval hook on, and is the app running. It tells you the one next step, if any. Ask ZCode to "check my Orbtile setup" or "set up Orbtile for ZCode".
- Once the Orbtile app is installed, there is nothing more to set up: Orbtile follows ZCode tasks from their files. You can then remove this plugin.

## What it runs, reads and sends

- Commands: the skill runs one script, `scripts/orbtile.sh` (macOS and Linux) or `scripts/orbtile.ps1` (Windows), only when you ask.
- Files read: `~/.zcode/cli/config.json` and the usual app folders (`/Applications`, `~/Applications`, `%LOCALAPPDATA%\Orbtile`). On macOS it checks whether a process named Orbtile is running.
- Files written: none.
- Network: none. It sends nothing anywhere and fetches nothing.
- Hooks, MCP servers, agents: none.
- It changes no files or settings. It is not Orbtile: the app sets up its own ZCode hook.

## Requirements

macOS or Windows, where the Orbtile app runs. On macOS it uses `sh`; on Windows it uses PowerShell. On other systems the check says that Orbtile does not run there.

## License

MIT. Made by Orbtile Team. No third-party code or assets.
