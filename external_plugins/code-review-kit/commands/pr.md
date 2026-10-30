---
description: Generate a pull request title and description from the branch diff and commit history
argument-hint: [base branch] (defaults to the repo's default branch)
---

Generate a PR title and description for the current branch.

1. Determine the base branch: the argument if given; otherwise `git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null` (strip the `origin/` prefix); fall back to `main`, then `master`. If none exist, ask the user.
2. Gather the material: `git log --oneline <base>..HEAD`, `git diff <base>...HEAD --stat`, then the full diff — read the full file wherever a hunk lacks context.
3. Write the PR body as markdown:

   - **Title** — one line in conventional style (`type(scope): summary`), max 72 characters, covering the dominant change rather than listing files.
   - **Summary** — 2–4 sentences: what changed and why it matters to the product or the team.
   - **Changes** — bullets grouped by area or module, each describing the concrete behavior change, not file names.
   - **Testing** — how a reviewer verifies this: exact commands to run and their expected results. Note explicitly which paths are untested.
   - **Risks & notes** — breaking changes, migration steps, follow-up work. Omit the section entirely if empty.

4. Output the finished title and body as a copy-ready markdown block, written in the user's language (match the conversation). The title keeps Conventional Commits form.
5. Then offer next steps without executing them: create the PR with `gh pr create` if the `gh` CLI is available, or print the `git push` command with the right upstream. Push and PR creation happen only after the user confirms.

Never push, and never create the PR, without an explicit confirmation from the user.
