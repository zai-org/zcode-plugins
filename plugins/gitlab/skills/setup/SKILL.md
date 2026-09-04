---
name: setup
description: Install-check and authenticate GitLab CLI for the GitLab plugin
---

# Set Up GitLab CLI

Guide the user through verifying the GitLab CLI installation and authenticating
the intended GitLab account before using the plugin's GitLab workflows.

## Arguments

$ARGUMENTS

**Format:** `[hostname]`

- `hostname` - GitLab host to authenticate (optional, defaults to the current
  repository remote host, `GITLAB_HOST`, or `gitlab.com`)

## Examples

```text
/gitlab:setup
/gitlab:setup gitlab.com
/gitlab:setup gitlab.example.com
```

## Instructions

1. Read and complete `../../references/gitlab-cli-preflight.md` in full.
2. If `glab` is missing or outdated, guide the user through installing or
   upgrading to the latest stable release, wait for completion, and verify the
   binary and update check again. Do not pin an older version unless requested.
3. If authentication is missing, guide the user through browser/OAuth login,
   wait for completion, and verify authentication again.
4. On success, report:
   - the installed `glab` version;
   - the latest-stable update check result;
   - the authenticated hostname;
   - the active GitLab username returned by `glab api --hostname <host> user`;
   - that the GitLab workflow skills are ready.
5. Do not create, modify, merge, or delete any GitLab resource as part of
   setup.

## Important

- Never claim setup succeeded until both authentication and identity checks
  pass.
- Never ask the user to paste a token, password, or device code into chat.
- Do not install software or change authentication state without the user's
  explicit participation.
