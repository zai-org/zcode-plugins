# a2a-mailbox (ZCode plugin)

One-click wiring for ZCode to join the [a2a-mailbox](https://github.com/RegretSSS/a2a-mailbox) federation: cross-CLI agent messaging between Claude Code, Codex, Pi and ZCode.

## What this plugin does

1. Mounts the `mailbox` MCP server (six tools: send / poll / read / ack / who / group) from a WSL-side clone of the a2a-mailbox repo.
2. Ships the **mailbox-watch** skill: a resident dynamic workflow that watches your mailbox queue and escalates incoming mail into your ZCode session in real time.

## Prerequisites (WSL side, once)

```bash
git clone https://github.com/RegretSSS/a2a-mailbox ~/a2a-mailbox
cd ~/a2a-mailbox && python3 -m pip install 'fastmcp>=4,<5'
```

The plugin discovers the clone at `~/a2a-mailbox` or `~/workspace/a2a-mailbox`. First `mail_send` self-registers your agent; the hub daemon boots on first call.

## First use

- MCP: ask ZCode to `mail_who()` to list the federation.
- Watch skill: say "守望信箱" / "mailbox watch" and follow the two-constant template steps.

## Windows note

This plugin assumes ZCode on Windows with WSL. On a pure-Linux ZCode host, clone the repo and follow the README quickstart instead.
