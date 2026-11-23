---
description: Review code changes for bugs, security issues and quality problems before they ship
argument-hint: [base..head | branch | file paths] (defaults to staged changes)
---

Review the code changes the user asked for. Do not modify any files — this is a review-only pass; fix things afterward only if asked.

**Pick the target, in this order of precedence:**

1. If arguments were given ($ARGUMENTS), use them: a `base..head` range, a branch name, a commit, or file paths.
2. Otherwise use staged changes: `git diff --cached`.
3. If that is empty, use unstaged changes: `git diff`.
4. If that is empty too, tell the user there are no changes to review and list what could be reviewed instead (recent commits via `git log --oneline -10`, local branches) — do not guess a target.

**Method:**

- Run the diff with enough context (`git diff -U10` or higher) and read the full file around every hunk. Never judge a hunk in isolation.
- When a function signature or behavior changed, check its callers across the repo before claiming it is safe.
- Apply the checklist below in severity order; ignore flagrant-only style rules unless the user asked for a style pass.

**Checklist:**

- 🔴 Correctness: logic errors, broken edge cases (null/empty/zero/huge input), off-by-one, wrong error handling, race conditions, resource leaks, breaking changes to public APIs.
- 🔴 Security: hardcoded credentials or tokens, SQL/command/XSS injection, path traversal, missing authorization checks, unsafe deserialization, secrets reaching logs.
- 🟡 Reliability & performance: unbounded loops or queries (N+1), hot-path allocations, missing timeouts/retries, swallowed errors, silent fallbacks that hide failures.
- 🟡 Tests: behavior changed without a corresponding test change; new code paths with no coverage.
- 🔵 Maintainability: misleading names, dead code, duplicated logic — only what a teammate would flag.

**Output:**

- Group findings under severity headings. Each finding on one line: `file:line — issue — why it matters — suggested fix`.
- For each severity with no findings, say so explicitly in one line.
- End with a verdict paragraph: overall risk, what must be fixed before merge, what can wait.
- Write the report in the user's language, matching the language of the conversation.
- If the diff contains a secret, redact it to its first 4 characters in the output, warn prominently at the top of the report, and advise rotating it.
