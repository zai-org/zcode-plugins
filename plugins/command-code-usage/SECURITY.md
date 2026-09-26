# Security Policy

## Supported versions

The latest commit on `main` is supported. Fixes land there; there are no backport
branches and no maintained older releases.

## Reporting a vulnerability

Report privately through GitHub: open the **Security** tab of
<https://github.com/Jovan1666/commandcode-usage> and choose **Report a
vulnerability**. If that channel is not available to you, open a normal issue that
says only that you have a security report and how to reach you — put no details in
the issue itself.

The full policy — credential handling, and what is in and out of scope — is the
repository's [SECURITY.md](https://github.com/Jovan1666/commandcode-usage/blob/main/SECURITY.md).

## What this adapter touches

- Ships a command, not a resident widget: it runs only when you invoke it, and it
  has no status-line seat because ZCode exposes no slot for one.
- Reads `~/.zcode/v2/provider_config.json` to find the provider route and the
  credential you configured there.
- Writes `~/.commandcode-usage/models.json`, the 24 h cache of the public model
  catalog, and nothing else.
- Installs through ZCode's own plugin mechanism and writes no ZCode config itself.

One cost note that is not a security note: because the report is produced inside a
model turn, invoking the command spends model tokens. The cache and the catalog
lookup are local; the turn is not.
