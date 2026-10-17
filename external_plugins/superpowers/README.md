# superpowers

[中文文档](./README_CN.md)

A comprehensive, battle-tested skills library for ZCode: brainstorming, test-driven development, systematic debugging, planning, code review, and subagent-driven development — packaged for ZCode from [obra/superpowers](https://github.com/obra/superpowers) v7.0.0.

## What it does

1. **Bootstraps skills awareness at every session start.** A `SessionStart` hook injects the `using-superpowers` skill into the model context, wrapped so the agent treats it as a hard rule: *if a skill might apply — even a 1% chance — invoke it before acting.* This bootstrap is what makes the rest of the library active instead of inert files on disk.
2. **Installs 15 workflow skills that auto-trigger by context.** Skills are discovered from their `name` + `description` frontmatter and invoked with ZCode's native `Skill` tool as `superpowers:<name>` (e.g. `superpowers:brainstorming`). You can also invoke them explicitly from the composer's skill picker.

Typical effect: a request like *"Let's make a react todo list"* triggers `superpowers:brainstorming` to refine the design **before** any code is written; *"fix this bug"* triggers `superpowers:systematic-debugging` before any patching.

## The skills

| Skill | Use it for |
| --- | --- |
| `brainstorming` | Refine a rough idea into a validated design before any implementation |
| `test-driven-development` | RED / GREEN / REFACTOR discipline: no production code without a failing test first |
| `systematic-debugging` | Find root causes with a four-phase framework instead of patching symptoms |
| `writing-plans` | Turn a validated design into a detailed implementation plan with exact file changes |
| `executing-plans` | Execute a written plan task by task, with verification per task |
| `subagent-driven-development` | Execute a plan via per-task implementer/reviewer subagent pairs |
| `dispatching-parallel-agents` | Fan out independent subagent work and collect the results |
| `requesting-code-review` | Hand a clean, reviewable changeset to a code-reviewer |
| `receiving-code-review` | Respond to review feedback with technical judgment, not blind compliance |
| `verification-before-completion` | Claim "done" only with evidence (tests run, output shown) |
| `finishing-a-development-branch` | Decide merge / PR / cleanup after verification passes |
| `using-git-worktrees` | Isolated worktrees for parallel tasks and risky experiments |
| `writing-skills` | Create or edit skills with testing discipline (used to maintain this library) |
| `using-superpowers` | The meta-skill: how to find and use skills (injected at session start) |
| `diagnosing-superpowers` | Diagnose sessions where skills did not trigger or the workflow failed |

## Structure

```text
superpowers/
├── .zcode-plugin/plugin.json          # manifest
├── skills/<name>/SKILL.md             # 15 skills with references, prompts, and helper scripts
├── hooks/hooks.json                   # SessionStart registration (auto-discovered)
├── hooks/session-start.mjs            # bootstrap injector (Node, no dependencies)
├── LICENSE                            # MIT (upstream + packaging)
├── README.md / README_CN.md
```

## Hook: SessionStart bootstrap

| Event | Matcher | What it does |
| --- | --- | --- |
| `SessionStart` | `startup\|clear\|compact` | Runs `hooks/session-start.mjs`, which reads `skills/using-superpowers/SKILL.md`, strips the frontmatter, and returns it as `hookSpecificOutput.additionalContext` so it enters the model context. |

Side effects, explicitly:

- The hook **reads one file inside the plugin directory**. It writes nothing, makes no network requests, and collects nothing.
- It requires `node` on `PATH` (any recent version; the script uses only Node built-ins). If the skill file cannot be read, it exits cleanly and the session continues without the bootstrap.
- ZCode snapshots hook configuration when a session starts: after installing or enabling the plugin, open a **new session** to see the bootstrap.
- Manual smoke test:

  ```shell
  printf '%s\n' '{"hook_event_name":"SessionStart","session_id":"manual","source":"startup"}' \
    | node hooks/session-start.mjs
  ```

  Stdout must be a single JSON object with `hookSpecificOutput.hookEventName = "SessionStart"`. Diagnostics go to stderr only.

Some skills ship small helper scripts under `skills/*/scripts/` and run them only when the skill's workflow calls for it (invoked through their interpreter, e.g. `bash scripts/start-server.sh` or `node ./render-graphs.js`); they operate on the current workspace.

## Install

1. In ZCode, open the plugin manager (**Settings → Plugin Management → Discover**), find **superpowers**, and install it. It is enabled by default.
2. Start a **new session**.
3. Smoke check: ask *"What are your superpowers?"* — the agent should describe its skills.
4. Try it: send *"Let's make a react todo list"* in a clean session — the agent should invoke `superpowers:brainstorming` before writing any code.

## Provenance and license

- All skill content is vendored from [obra/superpowers](https://github.com/obra/superpowers) **v7.0.0** (commit `bb92a77`), MIT License © Jesse Vincent. See [LICENSE](./LICENSE).
- This packaging's ZCode-specific changes: the `.zcode-plugin` manifest, the Node `SessionStart` hook, `skills/using-superpowers/references/zcode-tools.md` (tool mapping for ZCode), one pointer line in `using-superpowers/SKILL.md`'s "Platform Adaptation" list, and the README/LICENSE files. Everything else is verbatim upstream so future upstream releases can be re-synced cleanly.
