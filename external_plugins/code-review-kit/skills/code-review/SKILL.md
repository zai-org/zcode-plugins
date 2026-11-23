---
name: code-review
description: Review code changes for correctness, security, performance and maintainability issues. Use when the user asks to review code, check a diff, look over recent edits, audit changes before committing, or find bugs in what changed.
---

# Code review methodology

This skill is the full review method; the /review, /commit and /pr commands apply shorter versions of it. The reviewer is the agent itself — every conclusion must come from actually reading the code, never from pattern-matching the diff shape.

## 1. Establish the change set

- Staged changes: `git diff --cached`. Unstaged: `git diff`. Branch vs base: `git diff <base>...HEAD -U10`.
- Outside a git repository, review only the files the user named and say that repo-level checks (callers, history) were skipped.
- Note the change size up front. Over ~400 changed lines, review in passes: correctness first, then security, then everything else.

## 2. Read for context, not just diff

- Read the full file around each hunk; a hunk that looks fine in isolation is often wrong in context.
- When a function signature, return shape, or error behavior changes, grep for its callers and check each one.
- Check adjacent code the diff touches but does not show (initialization, cleanup, config) before declaring a bug or clearing one.

## 3. Checklist, in severity order

**🔴 Correctness (ship-blockers)**
- Logic errors and inverted conditions; edge cases: null/undefined/empty/zero/negative/huge input, unicode, concurrent access.
- Error handling: caught-and-swallowed errors, wrong error types, promises without rejection handling, missing timeouts.
- Resource leaks: files, connections, subscribers, locks not released on every path including the error path.
- Public API or persisted-data changes that break existing consumers.

**🔴 Security (ship-blockers)**
- Hardcoded credentials, tokens, private keys; secrets interpolated into logs or error messages.
- Injection: SQL, shell, XPath, XSS (unsanitized output), path traversal on user-supplied paths.
- Missing authorization checks on new endpoints or actions; trusting client-side data.
- Unsafe deserialization; crypto misuse (weak algorithms, non-random IVs, homegrown schemes).

**🟡 Reliability & performance**
- Unbounded work: N+1 queries, loops growing with request size, unpaginated list endpoints.
- Hot-path allocations, repeated recomputation of loop-invariant values.
- Missing retry/backoff on network calls; silent fallbacks that turn failures into wrong results.

**🟡 Tests**
- Behavior changed with no test change; new branches with no coverage. Suggest the specific missing test case, not "add tests".

**🔵 Maintainability**
- Misleading names, dead code, duplicated logic, magic constants. Only flag what a teammate would; skip personal style.

## 4. Report

- One line per finding: `file:line — issue — why it matters — suggested fix`. The fix must be concrete enough to act on.
- Group by severity; explicitly state when a severity has no findings.
- End with a verdict: overall risk, the short list that must be fixed before merge, what can wait.
- Write the report in the user's language, matching the language of the conversation.
- Review only. Do not edit files unless asked. If a secret appears in the diff, redact it to its first 4 characters, put the warning at the very top of the report, and advise rotation.
