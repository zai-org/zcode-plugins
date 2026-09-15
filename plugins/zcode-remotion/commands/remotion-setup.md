---
description: Install or repair the official Remotion Agent Skills and verify the requested ZCode scope
argument-hint: "[--project]"
---

Install or repair the official Remotion Agent Skills, then verify the same requested scope on disk. This workflow is idempotent.

## 0. Resolve the packaged helper path

Do **not** assume the user's current workspace is the plugin source repository.
Resolve the installed plugin root from ZCode's `ZCODE_PLUGIN_ROOT`. A cross-platform way to print it is:

```text
node -p "process.env.ZCODE_PLUGIN_ROOT || ''"
```

Use the resolved absolute path for `scripts/skill-paths.mjs` below.

## 1. Preflight

Run `node -v`. Require Node >=18. If Node is missing or older, stop and point the user to https://nodejs.org.

## 2. Choose the requested scope

- Default: **global/user scope** — official skills are available across projects.
- If `$ARGUMENTS` contains `--project`: **project scope** — pin the skills to the current project.

Never silently switch scope after a failure.

## 3. Inspect the requested scope

Using the resolved plugin root, run:

```text
node "<PLUGIN_ROOT>/scripts/skill-paths.mjs" --global
```

or for project scope:

```text
node "<PLUGIN_ROOT>/scripts/skill-paths.mjs" --project .
```

Expected skill names come only from `<PLUGIN_ROOT>/compatibility/remotion.json`.

Interpret the report:

- **COMPLETE** — every expected skill has `SKILL.md`; report success and stop.
- **INCOMPLETE** — one or more expected skills exist but the set is incomplete; repair this exact scope.
- **absent** — none of the expected skills exists in this scope; bootstrap this scope.

A single router skill is never enough to prove a healthy installation.

## 4. Install / repair with the official installer

Global/user scope:

```text
npx -y skills add remotion-dev/skills -s '*' -y --copy -g
```

Project scope:

```text
npx -y skills add remotion-dev/skills -s '*' -y --copy
```

`--copy` avoids Windows symlink privilege problems and is safe on the other supported platforms.

If the official installer fails:

1. report the actual error;
2. keep the requested scope;
3. if GitHub is still reachable, fetch the official skill folders directly from `https://github.com/remotion-dev/skills` into the same requested scope;
4. if truly offline, use an already-installed/cached copy in that scope if one exists; otherwise state that the official skills cannot be installed now.

Do not invent success from an installer exit code alone.

## 5. Verify on disk

Re-run the **same** `skill-paths.mjs` command used in step 3.
Only a `COMPLETE` report counts as success.

Report:

- scope used;
- `Official Remotion skills: N/M present`;
- missing skills, if any;
- extra `remotion-*` folders, if any; and
- whether repair is still required.

## 6. Finish with discovery and licensing guidance

The plugin's own skill and commands register when the plugin is enabled. The official Remotion skills installed above are external skill files. After creating or updating them, open **Settings → Skills**, click **Refresh**, and confirm they are listed and enabled. Start a new conversation only if Refresh does not surface them.

Tell the user that the official skills were fetched from Remotion's official source and are **not redistributed by this plugin**. Their licensing remains governed by Remotion; see this plugin's `NOTICE.md` and https://www.remotion.pro.
