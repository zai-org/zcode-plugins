---
name: guster-hub
description: Create, attach or validate a lightweight Guster Hub data plane for the Guster plugin. Use when the user says 建文件阵地/Guster Hub/精简 Hub/初始化知识枢纽/接入现有 Hub.
---

# Guster Hub

The Hub is the data plane: a plain repository for durable knowledge and project state. The Guster plugin is the control plane and reads this repository; it does not replace it.

## Lite hub

The lite Hub intentionally ships only:

- `AGENTS.md`, `README.md` and `hub.yaml`
- `knowledge/` with a single index, the `general/` starter note, an
  all-commented knowledge/v1 skeleton next to it, and an empty `projects/`
  subzone to grow into
- `register/projects.yaml`, the project table (register/v1: one row per
  project, with a commented example row in the scaffold)
- `tools/` with an index and inclusion rules, but no tool preinstalled

It does **not** ship `handoff/` or `reports/`. Add those later only when the workflow needs them. Missing optional directories are ignored by the scanner.

Under `hub.yaml` schema 2 the layout is declarative: `knowledge` and `projects` must be declared under `paths` — a missing declaration fails loud — while every other section (such as `tools`) is optional and may live outside the Hub.

There is no mode switch: the scanner follows the directories that exist — `hub.yaml` has no `profile` concept, and a leftover key from an older version is ignored like any unknown top-level manifest key. Knowledge subzones are discovered, not enumerated: every first-level directory under the knowledge root (`general/`, `projects/`, `machines/`, ...) is scanned and index-checked, whatever it is named. A fuller hub is also scanned across `register/`, `handoff/`, `reports/`, `output/`, `.agents/plans/` and `strategy.md` when present. Legacy layouts — `provision/`, `manuals/`, `cron-tasks/`, `openspec/`, `archive/` and the `Human Output/` alias of `output/` — are compat-scanned when present only; they are never structures to create. Generated directories such as `out/` are not knowledge sources. `--scope hub` excludes local wiki and machine-level secrets.

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

Relative paths stay inside the Hub (no `..`, no absolute); any section may instead be declared external (absolute or `~/`). To change them later, edit the `paths` map in `hub.yaml`, then run `guster hub validate`.

The same manifest carries `doctor.waivers`: findings the owner knowingly accepts, each with a `reason` and an optional `path`. Keep them in the hub so the decision is versioned next to the corpus it protects.

3. Validate and score it:

```bash
guster hub validate
guster scan
guster doctor --scope hub
```

4. Add content:

- Create one topic per file under any first-level subzone of `knowledge/` (`general/`, `projects/`, ...).
- Add the file name to `knowledge/README.md`.
- Register a project as a row in `register/projects.yaml` (id, status, as_of, name, spec.path); spec.path must resolve to the project directory on this machine.
- Add a tool only when it is a run-once command: one directory with its own `AGENTS.md`, then a row in `tools/README.md`.
- Put `verified_at: YYYY-MM-DD` in every state document (`最后更新:` is the
  accepted Chinese form; `verified_at` is canonical — see the format spec).
  `verified_at` is the state-document freshness key only; it is not one of
  the CTX-09 header keys.
- Optional structured header (CTX-09): front-matter that declares `type:` plus
  a date key opts the note into machine checks. The accepted date keys are
  `updated`/`date`/`lastmod`/`created` as YYYY-MM-DD (Obsidian properties
  convention). Keep truth sources as body markdown links, never as invented
  header keys.
- YAML knowledge files may opt into the knowledge/v1 contract (CTX-11) by declaring `schema: knowledge/v1` with `id/type/status/topic/as_of/updated` metadata; opted-in files get strict format, see_also cross-reference and freshness checks. The scaffold ships an all-commented skeleton (`knowledge/general/knowledge-v1-skeleton.txt`) showing every field.

## Existing hub

If the directory already exists, use:

```bash
guster hub attach --path <hub>
```

`attach` validates the core layout and backs up the Guster config before changing the hub path. Legacy hubs without `hub.yaml` are accepted with warnings; `guster hub validate` is the strict lite-contract check. Upgrading a 0.9.3 hub: create `register/projects.yaml` (header `schema: register/v1`, `kind: projects`, `updated:` date, one row per project — the old `projects/_registry.md` table), delete `_registry.md`, then re-validate; see CHANGELOG 0.9.4.

## Boundaries

- Never copy private content from another hub into a new one.
- Never add credentials, company secrets, generated caches or scratch files.
- Do not add optional modules just to fill the tree.
- Do not write Hub content from the governance skill; propose durable notes to
  the user and let them (or their capture workflow of choice) file them.
