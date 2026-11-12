# litman for ZCode

[中文](./README_CN.md)

[litman](https://litman.dev) keeps every paper you read on your own computer and
lets your AI assistant do the filing. This plugin connects it to ZCode: when
litman is missing, the agent offers to install it, then hands over to litman's
own skills.

litman is a separate open-source program ([GitHub](https://github.com/wqx1999/litman),
AGPL-3.0). It works without this plugin; the plugin only installs it and
connects it to ZCode.

## Use

In any session, ask about litman or your literature library, for example
"set up litman for me". Or type `/litman` in the input box and pick
`$litman-setup` under Skills.

The `litman-setup` skill:

1. Runs `lit --version`. If litman and its skills are already there, it hands
   over to them.
2. Otherwise asks whether to install litman, and installs it only after a clear
   yes, with the official one-line installer.
3. Runs `lit install-skill --agent zcode`, which copies litman's skills to
   `~/.agents/skills`.
4. If you have no library yet, asks where to keep it and runs `lit init`.

ZCode may load litman's skills only in a new session. The agent can open your
library as a new ZCode workspace with `lit agent zcode`.

## Skills

| Skill | Entry | Purpose |
| --- | --- | --- |
| `litman-setup` | `$litman-setup`, or triggered by context | Check, install and connect litman |

## What it does on your machine

- **Network**: downloads the installer from `get.litman.dev`. The installer
  installs [uv](https://github.com/astral-sh/uv), a Python runtime managed by
  uv, and litman from PyPI. Callers in mainland China are served a version of
  the installer that downloads from mirrors reachable there.
- **Commands**: the installer, and `lit` commands (`lit --version`,
  `lit install-skill`, `lit vault list`, `lit init`, `lit agent`). ZCode asks
  for approval as usual.
- **Files**: uv and litman under your home directory (`~/.local/bin` and uv's
  tool directory); the installer adds that directory to your `PATH` if needed
  and creates a litman shortcut. litman's skills go to `~/.agents/skills`; your
  library goes to the folder you choose.
- **No** hooks, MCP servers, model or API services of its own, or credentials.

## License

The plugin is MIT-licensed and bundles no third-party code. litman is
AGPL-3.0; uv is MIT / Apache-2.0.

Questions and bugs: [litman issues](https://github.com/wqx1999/litman/issues).
