---
description: Commit staged changes with a Conventional Commits message generated from the diff
---

Create a git commit for the currently staged changes.

1. Run `git status --short` and `git diff --cached --stat`.
   - If nothing is staged, show the user what is unstaged/untracked and ask which files to stage. Do not stage files on your own initiative.
2. Read the full staged diff (`git diff --cached`). Before proposing a message, check it for:
   - Secrets (API keys, tokens, passwords, private keys, connection strings with credentials). If found: stop, warn, advise removing them and rotating anything already exposed. Do not commit.
   - Debug leftovers (`console.log`, `debugger`, `print` debugging, commented-out code). Mention them; commit anyway unless the user says otherwise.
3. Compose the message in Conventional Commits format: `type(scope): subject`.
   - Types: feat, fix, refactor, docs, test, perf, style, build, ci, chore. Pick the dominant change; use scope only when it is obvious (module or package name).
   - Subject: imperative mood ("add", not "added"), max 72 characters, no trailing period.
   - Body: only when the *why* is not obvious from the diff; wrap at 72 characters.
   - Footer: `BREAKING CHANGE: <explanation>` when a public API or behavior contract changed.
4. Commit using a heredoc so quotes and newlines survive the shell:
   ```
   git commit -m "$(cat <<'EOF'
   <type>(<scope>): <subject>

   <optional body>
   EOF
   )"
   ```
5. Confirm with `git log -1 --stat` and report the hash, subject and file count. Explain the reasoning in the user's language; the commit message itself stays in Conventional Commits form (English type and subject).

Never push, never amend without being asked, and never use `--force` or `--no-verify` unless the user explicitly requests it.
