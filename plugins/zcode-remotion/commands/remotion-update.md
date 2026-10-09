---
description: Upgrade Remotion through the official CLI path and refresh the official Remotion Agent Skills
---

Bring the current project's Remotion packages and the installed official Remotion Agent Skills up to the latest stable versions using official-first flows. Treat package upgrades and skill refresh as two independent parts and report both.

## 0. Resolve the packaged helper path

Do not assume the user's current workspace is the plugin source repository. Resolve the installed plugin root:

```text
node -p "process.env.ZCODE_PLUGIN_ROOT || ''"
```

Use the resulting absolute path as `<PLUGIN_ROOT>`.

## Part A — Upgrade Remotion packages

Record the current Remotion version before changing anything.

### A1. `@remotion/cli` is installed

Use the official upgrader:

```text
npx remotion upgrade
```

If an older local CLI on Windows fails while spawning the package manager, retry with a current CLI rather than hand-writing a parallel upgrade algorithm:

```text
npx --yes --package=@remotion/cli@latest -- remotion upgrade
```

Then run:

```text
npx remotion versions
```

All Remotion packages should resolve to one version.

### A2. `@remotion/cli` is not installed

Follow the official `remotion-upgrade` skill's manual path:

1. Get the target stable version with `npm view remotion version`.
2. Find every `remotion` and `@remotion/*` dependency in every dependency section / workspace / catalog used by the project.
3. Upgrade all of them to the same target version with the project's detected package manager, preserving its existing version-pin style.
4. If `mediabunny` or `@mediabunny/*` is installed, use the official compatibility page https://www.remotion.dev/docs/mediabunny/version and align it with the target Remotion release.
5. Run the package manager install so the lockfile is updated.
6. Verify resolution with `npx remotion versions` or the matching dependency inspection.

Do not infer a Mediabunny pairing from `npm view mediabunny version`; the relevant value is the pairing documented for the target Remotion version.

## Part B — Refresh official Remotion Agent Skills

Get the canonical recorded skill-name list from the packaged compatibility manifest:

```text
node "<PLUGIN_ROOT>/scripts/skill-names.mjs"
```

Pass the returned names explicitly to the official updater. Do not use shell-specific command substitution and do not rely on a memorized list.

- Project-scope skills: add `-p`.
- User/global-scope skills: add `-g`.

Conceptually:

```text
npx skills update <names printed by skill-names.mjs> --yes <scope flag>
```

If upstream says a recorded skill name is unknown, stop guessing and report the topology change for maintainer review.

After updating, verify the same scope on disk with:

```text
node "<PLUGIN_ROOT>/scripts/skill-paths.mjs" --global
```

or:

```text
node "<PLUGIN_ROOT>/scripts/skill-paths.mjs" --project .
```

Only a COMPLETE report counts as success.

## Report

Return:

- previous Remotion version → new version;
- upgrade path used (official CLI or official manual fallback);
- package consistency PASS / FAIL;
- Mediabunny compatibility result when applicable;
- skills refresh result, scope, resulting `N/M`, and installed skill version;
- relevant breaking-change notes from https://github.com/remotion-dev/remotion/releases and https://www.remotion.dev/docs/upgrading for the crossed version range; and
- after external skills change, remind the user to open **Settings → Skills → Refresh** and confirm they are enabled.
