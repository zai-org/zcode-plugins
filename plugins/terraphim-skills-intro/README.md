# Terraphim Skills Introduction

[中文文档](./README_CN.md)

Three Community skills bring Terraphim's local code search, operational learning,
and agent memory workflows to ZCode.

## Install

1. Install the command dependencies:

   ```shell
   brew tap terraphim/terraphim
   brew install terraphim-grep terraphim-agent
   ```

2. Verify the installed command surface:

   ```shell
   terraphim-grep --version
   terraphim-agent --version
   terraphim-agent learn --help
   terraphim-agent memory --help
   ```

3. Open **Settings → Plugin management → Discover**, select
   **Terraphim Skills Introduction**, and install it.
4. Start a new ZCode session so the three skills are discoverable.

The plugin never installs software automatically. If Homebrew is unavailable,
download the appropriate signed archive from
[Terraphim Clients v1.21.14](https://github.com/terraphim/terraphim-clients/releases/tag/v1.21.14)
and verify it against that release's `SHA256SUMS`.

## Skills

| Skill | Purpose | Example request |
| --- | --- | --- |
| `terraphim-grep` | Search bounded local code and documentation, offline by default. | “Use Terraphim Grep to find the authorization callback and show two lines of context.” |
| `terraphim-agent-learn` | Inspect failures and capture a verified operational correction. | “Capture what we learned from this failed deployment for the next session.” |
| `terraphim-agent-memory` | Retrieve role-scoped memory and inspect its provenance. | “Retrieve memory about OAuth redirect validation and cite the source.” |

The Agent checks the installed command's `--help` before relying on a changing
command surface. Search is read-only. Learning and memory writes happen only
after an explicit request and remain within the selected local scope.

## Permissions and side effects

- No credentials, executable binaries, hooks, background tasks, or telemetry are
  bundled with this plugin.
- `terraphim-grep` reads only the paths selected for a search.
- `terraphim-agent learn` and `terraphim-agent memory` may write to the user's
  configured local Terraphim store only when the user asks for a write.
- Optional model synthesis may send selected context to the model provider that
  the user configured and may incur that provider's charges. The skills keep
  synthesis disabled unless the user requests it.
- The plugin contains only Apache-2.0 Community skills. It does not include or
  unlock proprietary Core or Premium instructions.

Browse the neutral
[Community, Core, and Premium catalogue](https://terraphim-skills.md/skills/)
for other workflows. Opening the catalogue does not start checkout or payment.

Privacy policy: <https://terraphim-skills.md/legal/privacy/>

Terms of service: <https://terraphim-skills.md/legal/terms/>

Source: [Terraphim Skills Introduction v0.2.2](https://github.com/terraphim/terraphim-cursor-plugin/tree/v0.2.2).
The bundled [LICENSE](./LICENSE) and [NOTICE](./NOTICE) apply to this plugin.
