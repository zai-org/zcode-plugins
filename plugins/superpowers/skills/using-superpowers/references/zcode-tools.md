# ZCode Tool Mapping

Skills speak in actions ("dispatch a subagent", "create a todo", "read a file"). On ZCode these resolve to the native tools below.

| Action skills request | ZCode equivalent |
| --- | --- |
| Invoke a skill | `Skill` tool with `skill: "superpowers:<name>"` (e.g. `superpowers:brainstorming`) |
| Dispatch a subagent (`Subagent (general-purpose):` template) | `Agent` tool — pass `subagent_type` (`general-purpose` for implementer/reviewer work, `Explore` for broad read-only searches) plus `description` and the full `prompt` |
| Dispatch subagents in parallel | Make multiple independent `Agent` calls in the same turn |
| Task tracking ("create a todo", "mark complete", older `TodoWrite` references) | `TodoWrite` — send the full updated list; `TodoRead` to check current state |
| Read a file | `Read` |
| Create a file / overwrite a file | `Write` |
| Edit a file | `Edit` (exact string replacement) |
| Run a shell command | `Bash` |
| Search file contents | No dedicated search tool — use `Bash` with `grep` or `rg` |
| Find files by name | `Bash` with `find` or `fd`, or `ls` |
| Fetch a URL | `WebFetch` |
| Web search | `WebSearch` |

## Skills

This plugin installs all Superpowers skills. They appear in the session as `superpowers:<name>` — invoke them with the `Skill` tool. Do not read `SKILL.md` files manually with file tools; the `Skill` tool is the platform's skill-loading mechanism.

## Subagents

The `Agent` tool runs a real subagent with its own context window and returns its final message as the tool result. Pass complete, self-contained prompts — the subagent does not see your conversation. For broad multi-file exploration where you only need the conclusion, prefer `subagent_type: "Explore"`; it reads excerpts instead of whole files and keeps the conclusion, not the dumps.

## Plan mode

ZCode has an explicit plan mode (`EnterPlanMode` / `ExitPlanMode`). Per `using-superpowers`, invoke the `brainstorming` skill **before** entering plan mode, and treat an approved plan as the input to `writing-plans` / `executing-plans`, not as a license to start coding immediately.
