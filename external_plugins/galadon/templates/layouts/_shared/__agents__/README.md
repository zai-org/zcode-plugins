# Agent context (`.agents/`)

Local runtime for agents. This directory is gitignored: nothing here is product
truth, and no conclusion in it counts until it moves into `wiki/`.

| Slot | Holds |
|---|---|
| `plans/` | proposals, research, designs, review drafts |
| `wiki/` | project-local long-term knowledge and conclusions |
| `evidence/` | screenshots, recordings, verification and audit evidence |
| `skills/` | project-local scripts and reusable procedures |
| `tmp/` | temporary artifacts; should be filed within 14 days |
| `archive/` | records of finished tasks |

Rules: new artifacts go into a slot, never flat in `.agents/`. When a task ends,
conclusions go to `wiki/`, evidence to `evidence/`, and the process stays in
`archive/`.
