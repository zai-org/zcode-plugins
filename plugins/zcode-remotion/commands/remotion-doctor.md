---
description: Diagnose the Remotion + ZCode environment: Node, package manager, official skills, versions, browser and license awareness
---

Run the checks first, collect evidence, then print one compact pass/fail table with fixes. Do not change the environment until the report is complete unless the user explicitly asks you to repair it.

## 0. Resolve the packaged helper path

Do not assume the current workspace is the plugin repository. Resolve the installed plugin root from ZCode's environment:

```text
node -p "process.env.ZCODE_PLUGIN_ROOT || ''"
```

Use the resulting absolute path as `<PLUGIN_ROOT>`.

Machine-readable version sources must stay separate:

- latest Remotion stable: `npm view remotion version`
- latest official skill release: the `version` field from `https://raw.githubusercontent.com/remotion-dev/skills/main/package.json`
- in-project Remotion truth: `npx remotion versions` when available
- last verified plugin baseline: `<PLUGIN_ROOT>/compatibility/remotion.json`

Never infer the skills version from the Remotion package version or vice versa.

## Checks

1. **Node** — `node -v`; PASS when >=18. Fix: install from https://nodejs.org.
2. **npx** — `npx -v`; PASS when it prints a version.
3. **Package manager** — detect by lockfile: `bun.lock` / `bun.lockb` → bun, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `package-lock.json` → npm, otherwise npm as the default recommendation.
4. **Official Remotion skills installed and complete?** Run:

   ```text
   node "<PLUGIN_ROOT>/scripts/skill-paths.mjs"
   ```

   This checks project scope first, then user scope, never unions scopes. Report `N/M present`, missing names, extra `remotion-*` folders and COMPLETE / INCOMPLETE / absent. Incomplete or absent → recommend the `remotion-setup` workflow.
5. **Official skills current?** Read the installed `remotion-best-practices/SKILL.md` version from the detected scope and compare it with the official skills package metadata using SemVer. Installed < latest → outdated; equal → current; installed > latest → ahead/informational; source unreachable → unknown, not failure by guesswork.
6. **Remotion project state** — only when the project declares `remotion` or `@remotion/*` dependencies. Use the detected package manager plus `npx remotion versions` / dependency inspection. All installed Remotion packages must resolve to one consistent version. Compare installed vs latest separately from the plugin's last verified baseline. If installed is newer than the recorded baseline, report: `Installed Remotion is newer than this plugin's verified baseline — check current compatibility evidence before relying on the baseline.` Do not call it incompatible without evidence.
7. **Chrome Headless Shell** — in a Remotion project run `npx remotion browser ensure`. If there is no Remotion project, mark N/A. On failure, report the network/proxy error and point to https://www.remotion.dev/docs/chrome-headless-shell.
8. **License awareness** — informational PASS. Remotion's upstream license terms apply; point to https://www.remotion.pro and this plugin's `NOTICE.md`. Do not attempt to bypass licensing behavior.

## Output

End with:

- one table: Check | Result | Evidence | Fix;
- summary count `X/8 checks passed` (N/A clearly identified);
- compact version block: Remotion installed / latest / verified baseline; official skills installed / latest / expected count; Mediabunny recorded pairing;
- the **single highest-priority next action**; and
- a note that Remotion API-specific questions should use the official `remotion-docs` skill.
