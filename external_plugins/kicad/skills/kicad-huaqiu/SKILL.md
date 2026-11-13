---
name: kicad-huaqiu
description: Use the Huaqiu KiCad edition of the ZCode KiCad plugin for PCB design and native Huaqiu public part lookup without starting the bundled DSH harness.
---

# Huaqiu KiCad edition

Use this skill when `kicad_capabilities` resolves the Huaqiu KiCad distribution, whether `edition` is `auto` or `huaqiu`.

1. Call `kicad_capabilities` before the first board. Continue only when `resolved_edition=huaqiu`, `distribution=huaqiu`, and `edition_ready=true`.
2. If `edition_ready=false`, report `missing_dependencies` and `edition.missing_dsh_plugins` exactly. Do not fall back to the official KiCad installation.
3. Follow the shared `kicad-board` workflow for part lookup, spec validation, build, DRC, render, GUI round-trip, and manufacturing export.
4. Prefer `search_hqsch_parts` for Huaqiu part selection, then use `get_hqsch_part` for details and `get_hqsch_part_models` for symbol/footprint/3D/simulation metadata. Use the returned manufacturer id and MPN exactly; never invent either. Use `get_hqsch_supply_chain` only when stock or pricing context is requested.
5. Call `resolve_hqsch_part_for_kicad` after choosing a Huaqiu part. If it recommends a pair, call `compare_hqsch_models_with_kicad` with that exact symbol and footprint before using `spec_part_fields`. The comparison safely reads the public KiCad text models into memory; never fetch a returned URL by another route. A model match still does not prove datasheet electrical or physical compatibility, so review `review.required`. If there is no recommended pair or the models disagree, fall back to `pcb_search_parts` / `pcb_part_info` and never invent a library id.
6. These tools are read-only native ZCode adapters over the public `kiapi.eda.cn` API, allowlisted Huaqiu model hosts, and the installed KiCad libraries. They never install a model or insert parts into the design.
7. Treat all other bundled DSH packages as installation evidence only. ZCode is the active harness; never start the bundled DSH harness or describe quoting, ordering, schematic generation, or symbol installation as callable ZCode features until dedicated tools appear in `available_tools`.
