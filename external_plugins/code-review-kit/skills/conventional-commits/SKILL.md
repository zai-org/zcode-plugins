---
name: conventional-commits
description: Write git commit messages in Conventional Commits format derived from the actual diff. Use when creating a commit, writing a commit message, or when the user asks for commit message help.
---

# Conventional Commits

Format: `<type>(<scope>): <subject>` followed by optional body and footers.

## Type — pick the one that describes the dominant change

- `feat` — new user-visible capability
- `fix` — bug fix
- `perf` — performance change with no behavior change
- `refactor` — neither fixes a bug nor adds a feature
- `docs`, `test`, `style`, `build`, `ci`, `chore` — the obvious counterparts

A change that both fixes and adds is `feat` if users would call the result new behavior, otherwise `fix`.

## Subject

- Imperative mood: "add filter", not "added filter" or "adds filter".
- Max 72 characters, no trailing period, no capitalization of the first letter beyond what a proper noun forces.
- Describe the change, not the symptom: "reject expired tokens in auth middleware", not "auth bugfix".

## Scope

Optional, in parentheses. Use it when the repository has natural module boundaries and the change is contained in one; omit it rather than inventing one.

## Body

Only when the *why* is not obvious from the diff. Explain motivation and trade-offs, wrap at 72 characters, blank line after the subject.

## Breaking changes

Either a `BREAKING CHANGE: <explanation>` footer or a `!` after the type (`feat!:`), never both. State what breaks and the migration path.

## Examples

```
feat(search): support quoted phrases in query parser

Queries like "error handling" now match the exact phrase instead of
any of the words, matching user expectations from the support tickets.
```

```
fix(api): return 404 instead of 500 for deleted project ids

Deleted projects were raising NotFoundError inside a generic handler
that mapped unknown errors to 500.
```

Derive the message from `git diff --cached` (or the range being committed), never from the file list alone — file names hide the actual behavior change.

Explain your choices to the user in their language; the commit message itself stays in Conventional Commits form (English type and subject) so tooling can parse it.
