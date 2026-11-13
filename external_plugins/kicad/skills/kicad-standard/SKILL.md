---
name: kicad-standard
description: Use the Standard KiCad edition of the ZCode KiCad plugin for PCB design, checking, rendering, fabrication export, or editing in the official KiCad 10 desktop app.
---

# Standard KiCad edition

Use this skill when `kicad_capabilities` resolves the official KiCad distribution, whether `edition` is `auto` or `standard`.

1. Call `kicad_capabilities` before the first board. Continue only when `resolved_edition=standard`, `distribution=official`, and `edition_ready=true`.
2. If `edition_ready=false`, report `missing_dependencies` exactly. Do not silently switch to a Huaqiu installation; ask the user to select the Huaqiu edition or configure the official `KiCad.app` path.
3. Follow the shared `kicad-board` workflow for part lookup, spec validation, build, DRC, render, GUI round-trip, and manufacturing export.
4. Do not claim Huaqiu part-search, quoting, ordering, or DSH capabilities in this edition.
