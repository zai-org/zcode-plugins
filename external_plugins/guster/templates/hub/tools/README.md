# Tools

This is the index for manual tools in this hub. The Lite profile ships no tool by default; add one only when it earns a place.

## What belongs here

- Run-once commands that a person or agent invokes deliberately.
- One directory per tool, with an `AGENTS.md` covering purpose, entry point, inputs, outputs, failure behavior and credential references.
- The smallest executable entry point needed to do the job.

## What does not

- Long-running services, cron jobs or background daemons.
- Skills or agent instructions; those belong in the plugin or project `.agents/`.
- Knowledge notes; those belong in `knowledge/`.
- Generated caches, logs or scratch files.

## Index

| Tool | Purpose | Entry point | Credentials |
|---|---|---|---|
| _(none yet)_ | | | |

## Add a tool

1. Create `<name>/` next to this file.
2. Add an `AGENTS.md` with the contract above.
3. Add the entry point.
4. Add a row to the index.
5. Reference credentials by path or variable name only; never commit values.
