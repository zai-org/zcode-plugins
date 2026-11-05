# Agent Manager (智能体管家)

A ZCode plugin for **managing subagents**: inventory, create, edit and validate agent definition files — and dispatch one task to **multiple agents in parallel**, then merge their reports.

[中文说明](./README_CN.md)

## What you get

| Component | Name | Purpose |
|---|---|---|
| Skill | `agent-registry` | Agent definition butler: inventory, view, create, edit, validate or retire agent definition files (user scope `~/.zcode/agents/` and workspace scope `<workspace>/.zcode/agents/`). Validation reports problems; it never edits files on its own. |
| Skill | `agent-team` | Multi-agent dispatcher: split a task → pick agents by their descriptions → dispatch independent subtasks in parallel in a single message → merge results into one report. |
| Commands | `/agent-list` `/agent-show` `/agent-new` `/agent-check` `/agent-team` | Quick access to inventory / view / create / validate / dispatch. |
| Agents (bundled templates) | `doc-writer` `test-runner` `issue-triage` | Ready-to-dispatch agents: documentation writing, test execution with failure analysis, and issue triage. |
| Hook | SessionStart | Prints a compact inventory of locally defined agents at every session start. |

## Install

1. In ZCode open **Plugin Marketplace → Add → Add Plugin Marketplace**.
2. Enter this repository: `sworddemon85-create/agent-manager-market` (or the official marketplace, if installed from there).
3. Find **Agent Manager** → **Install**, then restart ZCode.

## Try it

- `/agent-list` — list all your agents, flagging name conflicts across scopes
- "新建一个叫 doc-writer 的智能体,负责整理项目文档" — walks the creation flow and writes a spec-compliant definition
- `/agent-team 审查 src 目录的代码并总结问题` — dispatches reviewers in parallel and returns a merged report

## Behavior and side effects (disclosure)

- **File writes**: the create/edit flows write Markdown agent definition files under `~/.zcode/agents/` or `<workspace>/.zcode/agents/`. Validation and inventory are read-only.
- **Command execution**: the SessionStart hook runs a bundled read-only bash script (`scripts/inventory.sh`) that scans the two definition directories; dispatch flows invoke subagents via ZCode's Agent tool.
- **Hook**: `SessionStart` only. Its output is injected as session context and it always exits 0, so it never blocks startup.
- **Network**: the plugin itself makes no network requests. The bundled `issue-triage` agent may use WebFetch when you ask it to verify external references.
- **No MCP server, no credentials, no telemetry.**
- **Windows note**: the hook requires `bash` on PATH (Git Bash works).

## Agent definition format

Each agent is one Markdown file: YAML frontmatter plus a system-prompt body.

```markdown
---
name: "crawl"
description: "One-line responsibility; the main session dispatches based on this"
color: yellow
injectAgentsMd: true
tools: Read, Bash
---

Body = the agent's system prompt (role, duties, constraints, output format).
```

## License

[MIT](./LICENSE)
