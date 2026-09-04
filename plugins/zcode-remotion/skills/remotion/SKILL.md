---
name: remotion
description: "Reliable Remotion video workflow for ZCode. Use when the user wants to create, edit, preview, animate, caption, render, export or troubleshoot a programmatic video; mentions Remotion; or says 视频/动画/宣传片/字幕/渲染/出片. Bootstraps Remotion's official Agent Skills, preflights the environment, routes to the right official skill, runs autonomous still-frame visual QA, and verifies the final MP4."
license: MIT
metadata:
  author: AIwork4me
  version: "0.2.5"
---

# Remotion Workflow — ZCode reliability layer

Remotion's official Agent Skills contain the domain knowledge. This plugin does **not** replace or redistribute them. It makes the workflow reliable inside ZCode: bootstrap → preflight → official-skill routing → representative still → Agent visual QA → final render → output verification.

## 0. Resolve packaged resources first

Never assume the user's current working directory is the plugin repository.

When a bundled helper is needed, resolve the installed plugin root from ZCode:

```text
node -p "process.env.ZCODE_PLUGIN_ROOT || ''"
```

Call the printed absolute path `<PLUGIN_ROOT>` and use:

```text
node "<PLUGIN_ROOT>/scripts/skill-paths.mjs" ...
node "<PLUGIN_ROOT>/scripts/skill-names.mjs"
```

The expected official skill list comes only from `<PLUGIN_ROOT>/compatibility/remotion.json`.

## 1. Bootstrap gate — always check official skills before Remotion work

Inspect skill integrity with:

```text
node "<PLUGIN_ROOT>/scripts/skill-paths.mjs"
```

Automatic discovery uses strict scope priority:

1. project: `<project>/.zcode/skills/`
2. user: `~/.zcode/skills/`
3. installer mirror: `~/.agents/skills/`

The first scope containing **any** expected official skill is the detected installation. Scopes are never merged to manufacture a complete result.

Interpret the result:

- **COMPLETE** — every recorded official skill has `SKILL.md`; continue.
- **INCOMPLETE** — repair the detected scope; do not silently fill it from another scope.
- **absent** — bootstrap official skills, defaulting to user/global scope unless the user explicitly asks for project scope.

Official installer — global/user scope:

```text
npx -y skills add remotion-dev/skills -s '*' -y --copy -g
```

Project scope:

```text
npx -y skills add remotion-dev/skills -s '*' -y --copy
```

`--copy` avoids Windows symlink privilege problems.

If installation fails, preserve the requested scope and report the actual error. When GitHub is reachable, a direct fetch from the official `remotion-dev/skills` repository into that same scope is an acceptable recovery path. If truly offline and no cached copy exists, say the official skills cannot be installed now. Never report success without checking the files on disk.

After install / repair, re-run the same scope check and require `COMPLETE`.

The plugin's own skill and commands register with the plugin. Official Remotion skills installed externally are separate files; after creating or updating them, tell the user to open **Settings → Skills → Refresh** and confirm they are listed and enabled. Start a new conversation only if Refresh still does not surface them.

## 2. Environment preflight

Before creating or rendering:

1. Run `node -v`; require Node >=18 (20/22/24 recommended).
2. Detect the project package manager by lockfile: `bun.lock` / `bun.lockb` → bun; `pnpm-lock.yaml` → pnpm; `yarn.lock` → yarn; `package-lock.json` → npm; otherwise npm by default.
3. For a new project, prefer the official Remotion scaffold (`npm create video@latest`, or the matching package-manager equivalent).
4. If an existing project is involved, inspect its Remotion versions before editing and keep all `remotion` / `@remotion/*` packages aligned.
5. Do not treat the plugin's recorded compatibility baseline as a ban on newer versions. It is the last verified state, not an incompatibility assertion.

## 3. Route to Remotion's official skills

Read the installed official `SKILL.md` files as needed and follow them rather than inventing a parallel Remotion API guide.

| User intent | Official skill |
| --- | --- |
| Unsure / best-practices router | `remotion-best-practices` |
| Captions / subtitles / transcription presentation | `remotion-captions` |
| Create a new Remotion video project / composition | `remotion-create` |
| Look up Remotion APIs or documentation | `remotion-docs` |
| Studio editing / selectable or interactive elements | `remotion-interactivity` |
| Map animations | `remotion-maps` |
| Write / change React video markup, animation, typography, audio, fonts | `remotion-markup` |
| Media metadata, decoding, conversion, Mediabunny workflows | `remotion-multimedia` |
| Still / MP4 export | `remotion-render` |
| Product / SaaS rendering architecture and licensing context | `remotion-saas` |
| Preview in Remotion Studio | `remotion-studio` |
| Upgrade Remotion dependencies | `remotion-upgrade` |

If upstream skill topology changes, inspect the installed `remotion-*` skills and current official source rather than guessing renamed skills.

## 4. Mandatory no-rework render loop

For requests that should produce a rendered deliverable, do not jump straight from generated code to a final MP4.

### Step 1 — render a representative still

Use the official render guidance to choose a frame that meaningfully represents the composition, for example:

```text
npx remotion still <composition> out/frame.png --frame=<representative-frame>
```

### Step 2 — Agent visual QA

Actually inspect the generated image with the available image / vision capability. Check at least:

- blank or failed render;
- missing image / font / asset;
- clipped or overflowing text;
- obvious overlap or broken layout;
- poor framing;
- unreadable typography or contrast;
- unexpected transparent / black areas; and
- obvious rendering artifacts.

If an objective defect exists: fix the composition → rerender the still → inspect again. Iterate here before the full render.

### Step 3 — decide without unnecessary user interruption

If the representative still objectively passes, continue to the final render automatically.

Ask the user only when:

- the user explicitly requested approval;
- the remaining choice is genuinely subjective;
- brand / aesthetic intent is ambiguous; or
- visual confidence is low.

Do not add a routine “is this frame OK?” checkpoint to an otherwise straightforward render.

### Step 4 — full render

Follow the official `remotion-render` guidance and use the project's package manager / CLI setup. Preserve the requested format, duration, dimensions and frame rate.

### Step 5 — verify the delivered file

Before saying the video is finished:

1. confirm the render command succeeded;
2. confirm the expected MP4 exists;
3. confirm it is non-empty;
4. when `ffprobe` is available, verify a video stream exists and check duration / dimensions against the composition; and
5. report the output path and exactly what was verified.

If `ffprobe` is unavailable, say so. Do not claim metadata verification that was not performed.

## 5. Common failure triage

| Symptom | Likely cause | Next action |
| --- | --- | --- |
| Official skills absent / incomplete | first install, partial install, wrong scope | run the `remotion-setup` workflow; verify the same scope on disk |
| `npx skills add` fails | Node / npm / network / GitHub access | preserve the scope, report the real error, then use the documented recovery ladder |
| Chrome Headless Shell download fails | blocked browser download / proxy | `npx remotion browser ensure`; inspect network/proxy; see https://www.remotion.dev/docs/chrome-headless-shell |
| Composition ID not found | composition not registered or wrong CLI ID | inspect `registerRoot` and `<Composition id=...>` |
| `delayRender()` timeout | unresolved render handle / async resource | make every `delayRender` reach `continueRender`; inspect async metadata/assets |
| Module not found | dependencies not installed / lockfile mismatch | run the detected package manager install and verify dependency resolution |
| Remotion packages disagree on versions | partial upgrade / workspace mismatch | use the `remotion-update` workflow and `npx remotion versions` |
| Licensing message | upstream license condition | explain Remotion's current terms and point to https://www.remotion.pro; never work around licensing checks |

For unknown Remotion-specific errors, use the official `remotion-docs` and `remotion-best-practices` skills before inventing a workaround.

## 6. Reporting standard

A successful video task should end with concise evidence:

- composition / output produced;
- representative still QA: PASS (and fixes made, if any);
- final render: PASS;
- MP4 path and file existence / size check;
- duration / dimensions verification when `ffprobe` was available; and
- any remaining limitation stated explicitly.

Reliability means the claim must match the evidence that actually happened.
