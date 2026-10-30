# code-review-kit

[中文文档](./README_CN.md)

Structured code review, commit messages and pull-request descriptions for ZCode — performed entirely by the agent on local git diffs. No API keys, no external services, no runtime dependencies: every capability is a skill or slash command that instructs the agent, so reviews run on any machine where ZCode runs.

## What it does

| Capability | How to invoke | What you get |
| --- | --- | --- |
| Code review | `/review` command, or just ask "review my changes" | Severity-grouped findings (`file:line — issue — why — fix`) and a merge verdict |
| Conventional commit | `/commit` command | A Conventional Commits message derived from the staged diff, checked for secrets and debug leftovers before committing |
| PR description | `/pr` command | Copy-ready PR title and body: summary, changes grouped by area, testing steps, risks |

The `code-review` skill also triggers automatically whenever you ask ZCode to review a diff, check recent edits, or audit changes before committing.

## How it works

The agent is the reviewer. The commands and skill teach it a method:

1. **Establish the change set** — staged diff, unstaged diff, or an explicit `base..head` range / branch / files.
2. **Read for context, not just diff** — full file around every hunk; callers are checked when a signature or behavior changes.
3. **Severity-ordered checklist** — 🔴 correctness and security (ship-blockers), 🟡 reliability, performance and test coverage, 🔵 maintainability.
4. **Actionable report** — one line per finding, explicit "no findings" per severity, and a final verdict on what must be fixed before merge.

Reviews are read-only: nothing is modified unless you ask for fixes afterward. If the diff contains a secret, the report redacts it and advises rotating the credential.

## Structure

```text
code-review-kit/
├── .zcode-plugin/
│   └── plugin.json                  # Manifest (required)
├── commands/
│   ├── review.md                    # /review — severity-grouped diff review
│   ├── commit.md                    # /commit — conventional commit from staged diff
│   └── pr.md                        # /pr — PR title and description
├── skills/
│   ├── code-review/
│   │   └── SKILL.md                 # Full review methodology (context-triggered)
│   └── conventional-commits/
│       └── SKILL.md                 # Commit message format reference
├── README.md
└── README_CN.md
```

Component fields in the manifest (`commands` / `skills`) are declared explicitly and point at the standard paths above.

## Usage examples

```text
/review                          # review staged (or, if none, unstaged) changes
/review main..HEAD               # review the whole branch against main
/review src/auth/                # review specific paths
/commit                          # stage-aware conventional commit
/pr                              # PR description vs the repo's default branch
/pr develop                      # PR description against a chosen base
```

The report language follows the conversation language; commit messages themselves stay in Conventional Commits form so tooling can parse them.

## Privacy

The plugin sends nothing anywhere. Diffs are read locally with git, and review output is produced in the session. Whether conversation content leaves your machine is governed by your ZCode/model-provider settings, not by this plugin.
