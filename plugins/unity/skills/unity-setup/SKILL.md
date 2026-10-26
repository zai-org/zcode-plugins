---
name: unity-setup
description: Install Unity CLI and the matching Unity Editor, check the local environment, and resolve first-run setup or licensing blockers in ZCode. Use before Unity CLI workflows to check version compatibility, or when installation, licensing, or Editor reconnection needs troubleshooting.
---

# Unity installation and environment checks

Use the bundled [official Unity CLI skill](../unity-cli/SKILL.md) for CLI installation instructions and all Unity development workflows. This skill adds local environment detection, first-run setup, and version compatibility guidance. The plugin does not register an MCP server.

## Check the environment

Resolve the helper path relative to this skill directory, then run:

```sh
node "<this-skill-directory>/scripts/check-environment.mjs" --project "/absolute/project/path" --cli "unity"
```

The helper reports JSON without installing software or changing project files. It requires Node.js; if unavailable, use `unity --version`, `unity editors -i`, `unity pipeline list`, and `unity status` directly. Standard-location Editor detection is only a hint; registered custom installations appear in `unity editors -i`. A missing CLI does not prove the Editor is absent. The helper does not prove a live Editor operation succeeded.

Read `ProjectSettings/ProjectVersion.txt` before selecting an Editor. Install the project's exact version; do not silently migrate an older project to Unity 6 just to use Pipeline. Use the official skill's installation reference for supported platforms and version-specific commands.

## Install missing components

Follow the official skill's CLI installer instructions. If the user manages tools through a package manager, the official alternatives are `brew install --cask unity-cli` on macOS and `winget install Unity.CLI` on Windows. Keep an existing installation's update method. Unity Hub is available at https://unity.com/download; installing Hub alone is not installing an Editor.

Verify `unity --version` and `unity command --help`. If PATH has not refreshed, use the CLI executable's absolute path, including for the helper's `--cli` argument. Do not use the Editor executable as the CLI. PowerShell invokes a quoted executable path with `&`.

Install only missing components needed for the task. Editor downloads are large: check disk space and select only needed platform modules. First invocation may prompt for anonymous analytics consent; handle the choice in an interactive terminal. Automated diagnostics use non-interactive mode.

## First-run blockers

- Signing into Unity and activating an Editor license are separate steps. Inspect `unity license --help` and license status; let the user complete account, MFA, license selection, and terms acceptance. Do not select a paid plan implicitly.
- An Editor can be running while blocked on **Unity Editor Software Terms**. After the user handles that dialog, wait for package import and compilation before checking Pipeline again.
- When setting up Pipeline, use the intended project's absolute path. Installing a package into the manifest does not prove it loaded in the Editor. Verify the target with a read-only CLI operation following the official skill.
- If remote checks fail because UU reports a locked Windows session, restore the existing remote session through the user; do not alter lock-screen security settings.

Official installation and package references:
- https://docs.unity.com/en-us/unity-cli/use-unity-cli
- https://docs.unity.com/en-us/unity-cli/unity-pipeline/unity-pipeline-package

## Version compatibility

These overrides come from a Windows smoke test reported on 2026-10-22 with CLI `1.0.0-beta.6`, Editor `6000.3.26f1`, and Pipeline `0.9.0-exp.1`. They take precedence over conflicting bundled upstream examples for that combination. For other versions, inspect installed `--help` and the running Editor's command discovery instead of assuming either syntax applies.

- **Keep the working CLI version.** Do not automatically update as a prerequisite for a task. In beta.6, `self-update` is absent; `upgrade` exists, but `unity upgrade --check` reported `0.1.0-beta.3` for an installed `1.0.0-beta.6`. Treat that as an update-feed anomaly and skip the update, not as evidence that an upgrade is needed. Do not run `upgrade`, reinstall, or switch channels to fix this warning. If an update is explicitly requested, verify the target is newer using semantic version ordering (including prereleases), confirm the official source/channel, and stop if the target cannot be established. The plugin cannot repair the upstream update feed.
- **Discover command names and argument schemas.** Run `unity command --project-path "<project>"` and inspect the returned schema before mutations. Pass a multiword command name as one quoted argument; do not translate it into an underscore alias. For example:

  ```sh
  unity command --project-path "<project>" "editor status" --format json
  unity command --project-path "<project>" "scene list_open" --format json
  ```

  These are beta.6 examples, not a guarantee for every Pipeline version. Discover `script eval` and Play-mode commands instead of copying older `eval` / `editor_play` aliases.
- **Use JSON output without `--no-pager`.** `unity projects list --format json` works in the tested version; `--no-pager` is not accepted. Only use flags present in installed help. The environment helper uses `UNITY_NO_PAGER=1` rather than this unsupported flag.
- **Distinguish asset and scene paths.** For an asset selector, use the exact project-relative path starting with `Assets/` (for example `Assets/__ZCodePluginTest__`) or a GUID accepted by the command schema. A bare name can resolve as a scene object. Verify the target before deleting it; do not broaden deletion to make a failed selector succeed.
- **Allow bounded reconnection after domain reload.** Play transitions and script import/compilation can briefly disconnect Pipeline. After a known reload trigger, poll read-only status for the intended project after 2, 4, 8, and 8 seconds (at most four retries). Once ready, inspect actual state or the discovered compilation-status command before continuing. Do not blindly repeat the original mutation: it may already have succeeded. If automatic compilation is active, wait for its result instead of issuing another recompile. Persistent connection failures require checking compilation errors, Safe Mode, and Pipeline loading; do not assume every disconnection is normal.
- **Preserve scene state during smoke tests.** Record whether the scene was dirty before testing. Use a disposable scene/project for mutations when possible. Delete only objects and assets created by this test, exit Play mode if the test entered it, and report remaining dirty state. Do not save or discard a user's pre-existing scene changes just to claim cleanup. A successful smoke test does not imply Player builds or test-runner coverage.
