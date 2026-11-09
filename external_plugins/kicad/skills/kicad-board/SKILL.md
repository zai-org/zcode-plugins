---
name: kicad-board
description: Design a 2-layer PCB with the KiCad plugin — circuit spec, real KiCad library lookups, auto-route, DRC, 3D render, Gerber/BOM/CPL export — show it in the KiCad side panel, and hand it to the real KiCad GUI when the user wants to keep editing. Use when the user wants a circuit board designed, checked, edited or exported.
---

# KiCad board design

The `kicad` plugin wraps KiCad 10 (kicad-cli, its libraries and bundled Python). You describe the circuit as a JSON **spec**; the tools check it against the real
libraries, place and route it, run DRC, render it and export fabrication files. You cannot see images: judge by numbers, and let the human look at the panel.

## Workflow

1. **Start from an example.** `pcb_spec_example` writes a small, complete, DRC-clean spec to `./kicad/<name>_spec.json`: `ne555_blinker` (default: an NE555 LED flasher, about 1 Hz, 9 parts, 34 × 22 mm),
   `led_indicator` (3 parts), `ldo_3v3_breakout`, `shift_register_leds`; it also documents every spec field. For your own circuit, copy its format and use `pcb_search_parts` / `pcb_part_info` to get
   library ids and **pin numbers/names/pads — never guess them**.
2. **Check:** `kicad_check_spec_file` (spec in the workspace) or `pcb_check_spec`. Fix every error (unknown ids, pins missing on the footprint, unconnected pins,
   power inputs without a source, courtyard overlaps, parts too close to the edge). It returns `spec_artifact_id`.
3. **Build:** `pcb_build` places parts, routes both layers (GND poured on both) and runs DRC. `ok=true` means 0 DRC errors, 0 unconnected, every net routed. If not,
   read `drc`, `routing.unrouted` and the violations, move parts (closer to their connectors, more spacing), enlarge the board, rebuild.
4. **Look:** `pcb_render` (top/bottom) stores a 3D PNG; `kicad_board_view` opens or refreshes the **KiCad board** panel (render, DRC verdict, part list, artifacts).
5. **Let the user keep editing in KiCad:** `kicad_open_in_kicad` exports the board to `./kicad/edit/<name>/` (a normal KiCad project) and opens it in the real **KiCad PCB Editor**. The
   user edits and presses ⌘S; the panel imports each save by itself, and `kicad_sync_edits` does the same on demand (new board artifact, DRC on it, `changed`/`violations` in the answer).
   After the user says they are done — or whenever the panel shows "edited in KiCad" — call `kicad_sync_edits`, read the DRC verdict, and continue from the edited board's `artifact_id`.
   Never overwrite the user's files: re-opening imports pending saves first, and a board that is already in `kicad/edit/` is never replaced (the next export goes to `<name>-r2`, `-r3`, …). File tools only use paths inside the workspace; `pcb_spec_example` keeps a spec you edited unless you pass `overwrite=true`. If the answer has `launched=false`, KiCad is **not** open: tell the user `launch_note` as it is (on macOS it names the `xattr -dr com.apple.quarantine …` fix the user must run themselves; never run it for them) and do not wait for saves.
6. **Check:** `kicad_checks` returns the DRC violations of the newest board with positions (board mm) and, when the user drew a schematic in the edit project, its ERC; the panel's Checks tab shows the same. A board built from a spec has no schematic, so "no schematic" is normal, not an error.
7. **3D model for the structure/enclosure work:** `pcb_export_glb` writes a `.glb` (stored artifact + `./kicad/out/<name>.glb`) and returns the part table: designator, footprint, position/yaw/side and bounding box in board mm for every part that has a library 3D model. Use that table, not mesh names, to tell parts apart; parts listed in `parts_without_model` are not in the file, so size them from the courtyard; heights are nominal; through-hole pins reach below the board (z < 0). Say these limits when you hand the model over.
8. **Live with the user's open editor (only if KiCad's "Enable KiCad API" is on):** `kicad_live_status` says whether the running PCB Editor is reachable and has THIS session's board open; if not, tell the user its one-sentence `reason` and carry on with the file round trip. `kicad_live_move_footprint(ref, x_mm, y_mm, rotation_deg?)` moves ONE footprint in the user's open window (spec frame: mm from the top-left corner). It is one undoable step (⌘Z) and **nothing is saved**: say so, tell the user to look at the board and press ⌘S if they accept it, then `kicad_sync_edits` imports it with DRC. The user may be editing at that moment: use it for small requested adjustments, never to rework a board, and never move parts the user did not ask about. There is no save tool; do not try to save through any other route (the API socket is the user's).
9. **Export:** `pcb_export_fab` (Gerber + drill, BOM, pos, `pcb_report`), then `kicad_export_files` to copy what you need into `./kicad/out/` in the workspace.

## Rules of the road

* Coordinates are mm, origin = top-left corner of the board, **+y points down**, rotation counter-clockwise. Pin number *n* of the symbol is pad *n* of the footprint.
* Net names are free text; the pin names in the KiCad symbol are what a firmware author needs — report GPIO numbers from `pcb_part_info`, not from net names.
* A DRC pass proves the board is geometrically valid, not that the circuit is right (a reversed LED passes DRC). Say so when you hand a board over.
* Edited boards: `pcb_export_fab` takes gerbers/drill/project from the edited board, but BOM and pos CSV still come from the original spec (it warns). If the user added or swapped parts in KiCad, say so and ask them to update the circuit spec or the BOM by hand.
* Limits: two layers, bare boards (no SMT/LCSC mapping), no automatic part placement beyond the positions you give, no schematic file, no RF/high-voltage/HDI design.
* Artifacts live in the plugin's per-workspace store; files you exported are normal workspace files.
