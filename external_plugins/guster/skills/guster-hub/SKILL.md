---
name: guster-hub
description: Create, attach or validate a lightweight Guster Hub data plane for the Guster plugin. Use when the user says 建文件阵地/Guster Hub/精简 Hub/初始化知识枢纽/接入现有 Hub.
---

# Guster Hub

The Hub is the data plane: a plain repository for durable knowledge and project state. The Guster plugin is the control plane and reads this repository; it does not replace it.

## Lite profile

The lite Hub intentionally ships only:

- `AGENTS.md`, `README.md` and `hub.yaml`
- `knowledge/` with a single index and one starter note
- `projects/` with a project registry
- `tools/` with an index and inclusion rules, but no tool preinstalled

It does **not** ship `handoff/` or `reports/`. Add those later only when the workflow needs them. Missing optional directories are ignored by the scanner.

The three core roots default to `knowledge/`, `projects/` and `tools/`, but they are configurable. They live in `hub.yaml` under `paths`.

There is no mode switch: the scanner follows the directories that exist, and `profile` in `hub.yaml` is only a label. A fuller hub is also scanned across `handoff/`, `reports/`, `Human Output/`, `provision/`, `manuals/`, `cron-tasks/`, `openspec/`, `archive/`, `.agents/plans/`, `strategy.md` and `knowledge/workgroups/` when present. Generated directories such as `out/` are not knowledge sources. `--scope hub` excludes local wiki and machine-level secrets.

## Workflow

1. Check whether a hub is already attached:

```bash
guster hub status
```

2. Create a new lite hub:

```bash
guster hub init --path <hub> --yes
```

This refuses a non-empty target and attaches the new hub to `~/.agents/guster/config.json`.

Choose custom core paths at creation time:

```bash
guster hub init --path <hub> --knowledge notes --projects work --tools scripts --yes
```

Paths are relative to the Hub and must not escape it. To change them later, edit the `paths` map in `hub.yaml`, then run `guster hub validate`.

The same manifest carries `doctor.waivers`: findings the owner knowingly accepts, each with a `reason` and an optional `path`. Keep them in the hub so the decision is versioned next to the corpus it protects.

3. Validate and score it:

```bash
guster hub validate
guster scan
guster doctor --scope hub
```

4. Add content:

- Create one topic per file under `knowledge/general/` or `knowledge/projects/`.
- Add the file name to `knowledge/README.md`.
- Register a project in `projects/_registry.md`, then create `projects/{slug}.md`.
- Add a tool only when it is a run-once command: one directory with its own `AGENTS.md`, then a row in `tools/README.md`.
- Put `最后更新: YYYY-MM-DD` in every state document.
- Optional structured header (CTX-09): front-matter that declares `type:` plus a date key (Obsidian properties convention) opts the note into machine checks. Keep truth sources as body markdown links, never as invented header keys.

## Existing hub

If the directory already exists, use:

```bash
guster hub attach --path <hub>
```

`attach` validates the core layout and backs up the Guster config before changing the hub path. Legacy hubs without `hub.yaml` are accepted with warnings; `guster hub validate` is the strict lite-contract check.

## Boundaries

- Never copy private content from another hub into a new one.
- Never add credentials, company secrets, generated caches or scratch files.
- Do not add optional modules just to fill the tree.
- Do not write Hub content from the governance skill; use `knowledge-capture` for durable notes.
