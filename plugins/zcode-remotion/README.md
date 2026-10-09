# zcode-remotion

[中文文档](./README_CN.md)

Create and verify programmatic videos with Remotion directly from ZCode. The plugin keeps Remotion's official Agent Skills as the source of domain knowledge and adds the reliability layer around them: skill bootstrap, environment preflight, routing, autonomous representative-frame visual QA, final MP4 verification, and a recorded compatibility baseline.

**One prompt → official Remotion skills → visual QA → verified MP4.**

Source project: https://github.com/AIwork4me/zcode-remotion

## Install

In ZCode, open **Settings → Plugins**, search the official marketplace for **zcode-remotion** (display name: **Remotion for ZCode**), then install and enable it.

Requirements:

- Node.js 18 or newer (20/22/24 recommended)
- Network access for first-time package / skill / browser downloads
- A writable project directory for generated Remotion projects and outputs

The plugin itself has no API key, account, MCP server, hook, or background-service requirement.

## Quick start

Just ask for a video, for example:

```text
Create a 10-second product promo video for an AI coding agent. 16:9, modern technical style, and deliver the final MP4.
```

The bundled `remotion` skill will:

1. verify that the official Remotion Agent Skills are present and complete;
2. bootstrap or repair them with the official installer when needed;
3. check Node and the project package manager;
4. route the task to the relevant official Remotion skill;
5. render a representative still and inspect it for objective visual defects;
6. fix obvious issues before the expensive full render; and
7. render and verify the final MP4 before reporting success.

The bundled command picker also exposes workflows for **remotion-setup**, **remotion-doctor**, and **remotion-update**.

## What this plugin adds

| Capability | Behavior |
| --- | --- |
| Official skill bootstrap | Installs / repairs the official `remotion-dev/skills` set instead of vendoring a copy |
| Skill integrity | Verifies the expected skill set on disk; a partial install is repaired in the same scope |
| Environment preflight | Checks Node, package-manager context, Remotion project state, and render prerequisites |
| Routing | Maps creation, markup, captions, maps, Studio, render, multimedia, upgrade, docs, SaaS and interactivity requests to the corresponding official skills |
| Autonomous visual QA | Renders and visually inspects a representative still before a full render; asks the user only for subjective or low-confidence decisions |
| Output verification | Confirms the MP4 exists and is non-empty; uses `ffprobe` for duration / dimensions when available |
| Compatibility awareness | Ships a machine-readable tested baseline for Remotion, official skills and Mediabunny |

## Current tested baseline

The Marketplace package records the compatibility state in `compatibility/remotion.json`:

- Remotion `4.0.520`
- official Remotion Agent Skills `4.0.520` — 12 skills
- Mediabunny `1.55.5`

This is a **last verified baseline**, not a claim that newer releases are incompatible. The doctor / update workflows distinguish installed versions, latest upstream versions, and the recorded baseline.

## Network access and side effects

Enabling the plugin itself only registers its Markdown skill and commands. When you use its workflows, the Agent may execute local commands and access the network on your behalf.

### Network access

Depending on the task, it may contact:

- npm registry, through `npm` / `npx` or the detected package manager;
- GitHub, primarily `remotion-dev/skills` for the official Agent Skills;
- Remotion documentation / release pages for version and upgrade guidance; and
- Remotion's browser download endpoints when Chrome Headless Shell is required for rendering.

### Local commands

Typical commands include:

- `node` / `npx`;
- the detected package manager (`npm`, `pnpm`, `yarn`, or `bun`);
- official Remotion CLI commands such as `remotion studio`, `remotion still`, `remotion render`, `remotion versions`, `remotion upgrade`, and `remotion browser ensure`;
- the official `skills` installer; and
- optional `ffprobe` for final media metadata verification.

### File writes

The workflows can write:

- Remotion project files and dependencies in the user's chosen project directory;
- rendered stills and MP4 outputs in the project;
- official Remotion skills into user scope (`~/.zcode/skills/` / `~/.agents/skills/`) or project scope (`.zcode/skills/`) according to the requested scope.

The plugin does **not** install hooks, register MCP servers, request credentials, or silently write long-term data outside these documented paths.

## Official Remotion Skills and licensing

This plugin does **not** redistribute Remotion's official Agent Skills. It invokes the official installer so the user's machine fetches them from the official source.

- This integration layer is MIT licensed; see `LICENSE`.
- The upstream Remotion Agent Skills and Remotion software remain under Remotion's own licensing terms; see `NOTICE.md` and https://www.remotion.pro.

## Skill discovery after bootstrap

The plugin's own skill and commands are registered when the plugin is enabled. The Remotion skills installed by the external official installer are separate skill files. After creating or updating them, open **Settings → Skills**, click **Refresh**, and confirm they are listed and enabled. Start a new conversation only if Refresh does not surface them.

## Provenance

This Marketplace package is derived from `AIwork4me/zcode-remotion` v0.2.5. Repository-only CI, demos, verification reports, tests, release tooling and drift automation are intentionally not included in the installable Marketplace artifact. See `UPSTREAM.md` for the packaging notes.
