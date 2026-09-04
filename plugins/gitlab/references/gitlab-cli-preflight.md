# GitLab CLI preflight

Complete this preflight before any skill step that reads or changes GitLab
state. A local-only Git operation does not require it.

## 1. Determine the GitLab host

- Use a hostname explicitly supplied by the user when present.
- Otherwise inspect the current repository's GitLab remote URL and use its
  host.
- If `GITLAB_HOST` is set, treat it as a candidate only when there is no
  explicit host or GitLab remote. Never print the value of credential-bearing
  environment variables.
- Fall back to `gitlab.com` when no host can be inferred.
- Refer to the resolved value below as `<host>`.

Do not expose credentials embedded in a remote URL. Redact them if the URL
must be reported.

## 2. Install or update `glab` to the latest stable release

Run the binary check first:

```bash
command -v glab
glab version
```

If `glab` is present, check for a newer stable release:

```bash
glab check-update
```

If this check cannot complete, report that the latest-version decision is
blocked and stop; do not claim that the installed version is current.

Do not pin an old version unless the user explicitly asks. If the check reports
an update, the default action is to guide the user to upgrade to the latest
stable release before continuing:

- macOS/Linux with Homebrew: `brew upgrade glab`
- Other platforms: use the newest non-prerelease binary at
  https://gitlab.com/gitlab-org/cli/-/releases

If either binary check fails, explain that this workflow requires the official
GitLab CLI and guide the user to install the latest stable release:

- Official instructions: https://docs.gitlab.com/cli/
- Release binaries: https://gitlab.com/gitlab-org/cli/-/releases
- macOS/Linux with Homebrew: `brew install glab`

When the user explicitly invokes `/gitlab:setup`, that request authorizes this
latest-stable install/upgrade path. Show the exact command before executing it;
do not silently replace an existing binary during an unrelated GitLab workflow.
After installation or upgrade, run `command -v glab`, `glab version`, and
`glab check-update` again. Do not continue to authentication or workflow
commands until the binary is available and no update remains. If the user
explicitly declines the upgrade, ask whether they want to continue with the
older version and record that exception in the setup result.

## 3. Verify authentication

Run the host-specific check without `--show-token`, and suppress its output so
older `glab` versions cannot print credential details into the conversation:

```bash
glab auth status --hostname <host> >/dev/null 2>&1
```

If this succeeds, continue to the identity check below. If it fails:

1. Tell the user that GitLab CLI is installed but is not authenticated for
   `<host>`.
2. Prefer the browser/OAuth flow, which keeps credentials out of chat:

   ```bash
   glab auth login --hostname <host> --web --git-protocol https
   ```

   `glab` uses the operating-system keyring by default when one is available;
   do not add a plaintext-storage flag unless the user explicitly chooses that
   trade-off.

3. Ask the user to complete the interactive login in their terminal/browser.
   Run it for them only when they explicitly ask and the current terminal can
   support interaction.
4. If the GitLab instance does not support web/OAuth login, guide the user to
   run interactive `glab auth login --hostname <host>` locally. Never ask the
   user to paste a personal access token, OAuth token, password, device code,
   or credential-store contents into chat.
5. After the user reports completion, run
   `glab auth status --hostname <host> >/dev/null 2>&1` again. Do not treat the
   user's confirmation alone as proof of success.

If authentication still fails, rerun the status check only when needed to
collect a sanitized error, redact host/account details that are not needed,
and show the user the remaining reason. Stop the requested GitLab workflow and
help the user retry or select the correct account. Never fall through to a
GitLab command that will fail or use an unintended identity.

## 4. Verify the active identity

After authentication succeeds, run:

```bash
glab api --hostname <host> user
```

Read the returned JSON `username` and tell the user which host and account will
be used. If the identity is not the one they intended, stop and guide them
through `glab auth logout --hostname <host>` followed by a new login.

`GITLAB_TOKEN`, `GITLAB_ACCESS_TOKEN`, and `OAUTH_TOKEN` can override stored
credentials. Do not print their values or use `glab auth status --show-token`.
If an environment-provided credential is active, explain that fact without
revealing the secret.
