# GitLab CLI Workflows for ZCode

[中文文档](./README_CN.md)

This plugin packages the official GitLab CLI (`glab`) Agent Skills for ZCode
and adds a guided installation and authentication flow. It works with
GitLab.com, GitLab Dedicated, and GitLab Self-Managed instances supported by
the locally installed [`glab`](https://docs.gitlab.com/cli/).

## Setup and authentication

- Run `/gitlab:setup [hostname]` to let the agent check the `glab` binary,
  default to the latest stable install/upgrade when it is missing or outdated,
  and guide browser/OAuth login when authentication is missing.
- Every GitLab-backed skill verifies the hostname, authentication state, and
  active username before running its workflow.
- Authentication is rechecked after login. The agent must stop if verification
  still fails or if the active account is not the intended identity.
- The agent never asks the user to paste a token, password, or device code into
  chat.

The plugin does not bundle `glab` or store credentials. When `/gitlab:setup` is
explicitly invoked, the agent shows the latest-stable install/upgrade command
before running it; unrelated GitLab workflows never silently replace the
binary. Environment credentials such as `GITLAB_TOKEN` can override stored
`glab` credentials; the preflight verifies the effective identity without
exposing the secret.

## Skills

| Skill | ZCode command | Description |
|-------|---------------|-------------|
| setup | `/gitlab:setup [hostname]` | Verify `glab`, guide login, and confirm the active account |
| glab | `/gitlab:glab` | Official general GitLab CLI workflow and API guidance |
| glab-stack | `/gitlab:glab-stack` | Official guidance for experimental stacked merge requests |

Natural-language GitLab tasks can also activate the relevant skill without an
explicit slash command.

## Examples

```text
/gitlab:setup gitlab.example.com
/gitlab:glab show merge requests waiting for my review
/gitlab:glab inspect the failed pipeline for the current branch
/gitlab:glab-stack show the current stack without opening an interactive UI
```

## Compatibility

The official skill sources are pinned in [`UPSTREAM.md`](./UPSTREAM.md). The
packaged skills do not depend on the newer `glab skills install` command, so
they work when ZCode can invoke the underlying commands directly. Setup uses
`glab check-update` dynamically instead of hardcoding a release number. The
imported command patterns were smoke-tested against `glab 1.93.0`; experimental
command families must inspect their installed `--help` before execution.

## Safety boundary

This is a prompt/skill layer over the local `glab` executable, not a policy
sandbox. It never receives or stores GitLab credentials itself. Agents must
identify the host, project, account, and target before remote-changing
operations, and must obtain explicit confirmation for destructive actions such
as merge, delete, unprotect, secret/variable mutation, or token changes.

## ZCode packaging

The installable manifest is `.zcode-plugin/plugin.json`;
`.claude-plugin/plugin.json` is kept as a compatibility mirror. The marketplace
entry is maintained in the repository root at [`marketplace.json`](../../marketplace.json).

## License

The imported GitLab CLI skills are MIT licensed. See [`LICENSE`](./LICENSE) and
[`UPSTREAM.md`](./UPSTREAM.md).
