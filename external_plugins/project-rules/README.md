# project-rules

[简体中文](./README_CN.md)

Brings `CLAUDE.md` and path-scoped rule files to ZCode. ZCode reads only `AGENTS.md` from the project root, so a project coming from Claude Code or Cursor loses its `CLAUDE.md` and per-path rules. This plugin adds them back as model context through two hooks. It never blocks, edits, or rewrites a tool call.

## What it does

| Hook | Matcher | What gets injected |
| --- | --- | --- |
| `SessionStart` | all sources (startup, resume, clear, compact) | `CLAUDE.md` from the project root, if there is no `AGENTS.md` next to it, plus every rule in `.zcode/rules/*.md` that has no `paths:` |
| `PreToolUse` | `Read\|Edit\|Write` | Rules whose `paths:` globs match the tool's `file_path`, plus any path-less rule not yet delivered in this session (for example, one that changed or did not fit the SessionStart budget) |

Each rule is delivered once per session. It is delivered again only when its file content changes, or after a new SessionStart (resume, clear, compaction), because the model context starts over then.

The project root is the session's ZCode working directory.

## Rule files

Put Markdown files directly in `.zcode/rules/` at the project root. Frontmatter is optional.

A rule without `paths:` always applies. It is injected at session start:

```markdown
Run `pnpm test` before finishing a task.
Never commit generated files under dist/.
```

A rule with `paths:` applies when the agent reads, edits, or writes a matching file. For example, `.zcode/rules/typescript.md`:

```markdown
---
paths: src/**/*.ts, src/**/*.tsx
---
Prefer `type` aliases over `interface`.
Use the logger in src/lib/log.ts instead of console.log.
```

`paths:` accepts any of these forms. Cursor's `globs:` key works as an alias, and trailing `# comments` are ignored.

```yaml
paths: src/**/*.{ts,tsx}, *.proto
paths: ["src/api/**", "docs/api/"]
paths:
  - src/db/**/*.sql
  - migrations/
globs: *.sql
```

### Glob syntax

| Pattern | Matches |
| --- | --- |
| `*` | any characters except `/` |
| `?` | exactly one character except `/` |
| `**` | any number of directories, including none: `src/**/*.ts` matches `src/a.ts` and `src/x/y/a.ts` |
| `{a,b}` | either alternative: `*.{ts,tsx}` |
| no `/` in the pattern | the file name at any depth: `*.proto` is the same as `**/*.proto` |
| leading `/` or `./` | anchored at the project root: `/README.md` |
| trailing `/` | everything below that directory: `docs/` |

The tool's `file_path` is made relative to the project root (absolute and relative paths both work) and matched with `/` separators, case-sensitively. A `file_path` that is outside the project both as written and after resolving symlinks never matches. Character classes (`[abc]`) and negation (`!`) are not supported. A rule uses its first 32 globs, and a glob longer than 256 characters is ignored.

## Install

From the GitHub repository, which is a standalone marketplace:

```shell
zcode plugins marketplace add https://github.com/dominiclafleur/zcode-project-rules
zcode plugins install project-rules@project-rules-marketplace
zcode plugins enable project-rules@project-rules-marketplace
```

In the desktop app, open **Plugin Marketplace -> New**, paste the same URL, then install and enable `project-rules`.

If the plugin is listed in the official marketplace, install it from **Settings -> Plugins** by searching for `project-rules`.

Start a **new session** after installing or enabling it. ZCode takes a snapshot of hooks when a session starts.

Requirements: `node` 16 or newer on `PATH`. There are no npm packages, and the plugin makes no network requests.

## Migrating from Claude Code or Cursor

- **CLAUDE.md**: works as-is when the project root has no `AGENTS.md`. If both exist, ZCode reads `AGENTS.md` and this plugin skips `CLAUDE.md` so the instructions are not loaded twice. Move anything you still need from `CLAUDE.md` into `AGENTS.md`.
- **Claude Code rules** (`.claude/rules/*.md`): copy them. Their `paths:` frontmatter is read as-is.

  ```shell
  mkdir -p .zcode/rules && cp .claude/rules/*.md .zcode/rules/
  ```

- **Cursor rules** (`.cursor/rules/*.mdc`): copy them with a `.md` extension. `globs:` is read as `paths:`. Rules without globs become always-on, and Cursor's `alwaysApply` and `description` fields are ignored.
- **Not carried over**: `@path` imports inside `CLAUDE.md` (they stay as plain text), `CLAUDE.local.md`, `~/.claude/CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.md` files in subdirectories, and subdirectories of `.zcode/rules/`.

## Limits

- **Size**: each rule is cut at 4000 characters and `CLAUDE.md` at 8000. A truncated item ends with a note that tells the model to Read the file for the rest. One injection is capped at 12000 characters and at 30000 bytes of hook output, which keeps it under ZCode's 32 KiB hook stdout limit. Rules that do not fit are deferred to a later Read/Edit/Write call they apply to, and a note names up to five of them.
- **Timing**: PreToolUse context reaches the model together with the tool result. In the usual Read-then-Edit flow, the model sees a file's rules before it edits that file. A `Write` that creates a new file runs before the model sees the rule, so the rule applies to follow-up edits.
- **Triggers**: only `Read`, `Edit`, and `Write` calls that carry a `file_path`. Bash, Grep, Glob, and patch-style edits do not trigger path rules. A call whose hook input exceeds 1 MiB (for example a `Write` of a very large file) is skipped.
- **Discovery**: only `*.md` files directly inside `.zcode/rules/`, up to 200 files of at most 1 MiB each and 2 MiB in total; a file that would pass the total is skipped. Rule files are re-read on every Read/Edit/Write call, so edits apply without restarting.
- **Root**: `CLAUDE.md` and `.zcode/rules/` are looked up in the ZCode working directory only, not in parent directories.
- **Cost**: each Read/Edit/Write call starts a short-lived Node process, which usually takes tens of milliseconds.

## Data and side effects

- **Reads**: `CLAUDE.md`, whether `AGENTS.md` exists, and `.zcode/rules/*.md` in the project. Symlinked `CLAUDE.md` or rule files that resolve outside the project are skipped.
- **Writes**: `${ZCODE_PLUGIN_DATA}/state.json`, or `~/.zcode/project-rules/state.json` when `ZCODE_PLUGIN_DATA` is not set, and a short-lived `state.lock`. The state file holds session ids, rule file paths, and content hashes, and only your user can read it. A session is pruned 7 days after its last state write, which happens at SessionStart and whenever a rule is injected. Nothing is written to the project or to the plugin directory.
- **No** network access, MCP server, commands, or skills. Besides the `node` process itself, nothing is executed.
- The hook never returns deny, ask, or rewritten input, and it always exits 0, so tool calls always proceed. On an unexpected error it prints nothing. If the state file cannot be written, SessionStart context is still injected, but PreToolUse injects nothing.

## Troubleshooting

- **Nothing is injected**: start a new session after enabling the plugin. Check that **Settings -> Hooks** lists the two `project-rules` hooks, that rule files end in `.md`, and that each has a non-empty body below the frontmatter.
- **Diagnostics**: start ZCode with `PROJECT_RULES_DEBUG=1` in its environment, and the hook writes diagnostics to stderr.
- **Manual run** from your project directory, with `<plugin-dir>` set to the installed plugin path:

  ```shell
  printf '%s\n' '{"hookEventName":"PreToolUse","sessionId":"manual","cwd":"'"$PWD"'","toolName":"Read","toolInput":{"file_path":"src/index.ts"}}' \
    | ZCODE_PLUGIN_DATA=/tmp/project-rules-manual node <plugin-dir>/hooks/rules.js
  ```

## Development

```shell
node test/test.mjs
```

The self-test needs no ZCode install and no marketplace. It spawns `hooks/rules.js` with SessionStart and PreToolUse payloads and checks the output for these cases: matching and non-matching paths, dedupe, re-injection after a content change, the size and read budgets, hostile globs, symlinks that leave the project, parallel calls, stale and stuck locks, corrupt or oddly shaped state, stale-session pruning, oversized stdin, and an unwritable or unset data directory.

## License

MIT. See [LICENSE](./LICENSE).
