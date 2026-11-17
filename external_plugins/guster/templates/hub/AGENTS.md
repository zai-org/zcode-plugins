# Guster Hub

This repository is the data plane for agent context. The Guster plugin reads it; it does not replace it.

## Map

- Knowledge index: [{{KNOWLEDGE_PATH}}/README.md]({{KNOWLEDGE_PATH}}/README.md)
- Project registry: [{{PROJECTS_PATH}}/_registry.md]({{PROJECTS_PATH}}/_registry.md)
- Tool index: [{{TOOLS_PATH}}/README.md]({{TOOLS_PATH}}/README.md)
- Hub contract: [hub.yaml](hub.yaml)

## Rules

- One topic per knowledge file. Put durable, reusable knowledge in `{{KNOWLEDGE_PATH}}/general/` or `{{KNOWLEDGE_PATH}}/projects/`.
- Register a project in `{{PROJECTS_PATH}}/_registry.md` before adding `{{PROJECTS_PATH}}/{slug}.md`.
- State documents must carry `verified_at: YYYY-MM-DD`.
- File paths are markdown links or inline code, never naked in prose, so `guster doctor` can verify them (CTX-03).
- Code and tests remain the source of truth; this hub stores decisions and pointers.
- Never store credentials, company secrets, generated caches or scratch files here.

## Optional modules

Add `handoff/` or `reports/` only when the workflow needs them.
