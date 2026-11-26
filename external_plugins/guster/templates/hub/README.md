# Guster Hub (Lite)

A minimal data plane for the Guster plugin. It holds durable knowledge and project state; governance lives in the plugin.

## Start

```bash
guster hub status
guster scan
guster doctor --scope hub
```

## Add content

- Knowledge: create one topic per file under any first-level subzone of `{{KNOWLEDGE_PATH}}/` (`general/`, `projects/`, ...), then add it to `{{KNOWLEDGE_PATH}}/README.md`.
- Project: add a row to `register/projects.yaml` (id, status, as_of, spec.path, ...) pointing at the project directory.
- Tool: add one directory under `{{TOOLS_PATH}}/` with its own `AGENTS.md`, then register it in `{{TOOLS_PATH}}/README.md`.
- Handoff and reports are optional modules. Add them only when the workflow needs them.
