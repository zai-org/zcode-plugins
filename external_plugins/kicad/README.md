# KiCad (ZCode UI plugin)

KiCad 10 inside the conversation. Agents design a two-layer board from a JSON circuit spec — real KiCad symbol/footprint libraries, auto-route, DRC, Gerber/BOM/CPL —
and the **KiCad board** side panel shows the 3D render, the DRC verdict, the part list and every artifact.

The plugin has two editions backed by one PCB engine, plus an automatic selector:

| Plugin edition | KiCad distribution | Additional readiness checks |
| --- | --- | --- |
| `auto` (default) | Newest detected official or Huaqiu KiCad 10 | Resolves the edition from the installed app before enabling tools |
| `standard` | Official KiCad 10 | Core CLI, pcbnew Python, symbols and footprints |
| `huaqiu` | Huaqiu KiCad 10 | Core checks, bundled Huaqiu components, and the native public-part-database adapter |

With an empty *KiCad.app path*, `auto` searches the system and user Applications directories, identifies each app without starting it, and selects the newest installation. Choosing `standard` or `huaqiu` filters automatic discovery to that distribution. An explicit app path always wins, even when it is missing, so a configuration error is reported instead of silently switching installations.

## What you need

* macOS with **official KiCad 10** or **Huaqiu KiCad 10** in the system/user Applications directory, or set an exact *KiCad.app path* in the plugin settings.
* **uv** (recommended: dependencies are fetched on first start) or a Python with `fastmcp>=4,<5`, `pydantic`, `numpy` (setting *Python with fastmcp*).

## Use

Ask: "Design a 555 LED blinker board with KiCad, check DRC, render it and open the board panel." The sample case is an NE555 astable flasher (about 1 Hz, 9 parts, 34 × 22 mm); the agent starts from `pcb_spec_example`, then `kicad_check_spec_file`, `pcb_build`, `pcb_render`, `pcb_export_fab`, `kicad_export_files` and `kicad_board_view` (see `skills/kicad-board/SKILL.md`).
Open the panel manually from the session panel list at any time.

On first use, or after switching KiCad distributions, call `kicad_capabilities`. Continue only when `edition_ready=true`. It read-only reports automatic/explicit selection, every detected candidate, `requested_edition`, `resolved_edition`, the official/Huaqiu distribution, mismatch status, version, CLI, libraries, pcbnew Python, live IPC, bundled Huaqiu DSH components, currently available tools, and structured missing dependencies. Bundled DSH is detected for diagnostics only; the plugin never starts a second agent harness.

The MCP server is eagerly loaded, so all 25 KiCad tools are present on the first model request of a fresh chat, including with models that do not provide deferred tool search. `kicad_capabilities` also reports the installed `plugin_version`, which lets an acceptance run prove which package actually served the call.

### Huaqiu edition: native part lookup

When `resolved_edition` is `huaqiu` and it is ready, these read-only ZCode tools use the normalized `@huaqiu/part-search` library already inside Huaqiu KiCad:

* `search_hqsch_parts`: search by MPN, manufacturer, category, or keyword, with optional symbol/footprint/3D/simulation/supplier requirements.
* `get_hqsch_part`: component details, attributes, documents, images, lifecycle, and model metadata.
* `get_hqsch_part_models`: symbol, footprint, 3D, and simulation model metadata and URLs (metadata only; nothing is installed).
* `get_hqsch_supply_chain`: stock, MOQ, lead time, distributor links, currency, and price breaks for up to 50 parts.
* `resolve_hqsch_part_for_kicad`: fetch one selected part's normalized detail, search the installed KiCad libraries, verify symbol footprint filters and same-numbered pin/pad mapping, and return ranked candidates plus `spec_part_fields`.
* `compare_hqsch_models_with_kicad`: explicitly download the selected part's public `.kicad_sym` and `.kicad_mod` into memory and compare them with one resolver candidate: pin names/numbers, numbered-pad geometry and sizes, and courtyard dimensions.

These calls go directly to Huaqiu's unauthenticated public endpoint at `https://kiapi.eda.cn`. They do not start DSH, load DSH skills, place an order, install a model, or write to the project. Only the explicit comparison tool downloads model text: it accepts HTTPS from `file.eda.cn` / `file1.eda.cn`, refuses redirects, caps each file at 2 MiB, parses it as untrusted data in memory, and returns hashes rather than model contents. A model match is stronger structural evidence, but both the resolver and comparison deliberately leave electrical pinout and exact physical package confirmation to datasheet review. The Standard edition rejects these tools explicitly.

## The panel: tabs next to the real KiCad windows

The panel is a companion to KiCad's own windows (PCB Editor, Schematic Editor), not an embedded editor. Its tabs show what `kicad-cli` produces headlessly for the newest board (the one you edited in KiCad, once you saved):

* **Board**: 3D render (top/bottom), part list. **Live**: what the running PCB Editor has open right now, without ⌘S (see below). **Layers**: one SVG per layer (copper, mask, silkscreen, paste, fab, courtyard, outline), switch layers on and off, mirror for the bottom view.
* **3D**: pre-rendered views (iso, rear, top, bottom, front, side), not an interactive viewer.
* **Schematic**: the `.kicad_sch` found in the edit project (`./kicad/edit/<name>/`), one sheet at a time. The plugin builds boards from the circuit spec and generates no schematic: without one the tab says so (draw it in KiCad's Schematic Editor and save it in that folder).
* **Checks**: DRC with the first violations and their positions (`kicad_checks`, the agent can call it too) and, when a schematic exists, ERC.
* **Library**: search KiCad's symbols and footprints (`pcb_search_parts`) and look at the drawing of one (symbol unit 1, footprint) and its pins.
* **Artifacts**: everything stored for this workspace.


## Live link to the running PCB Editor (KiCad API)

With KiCad's own **"Enable KiCad API"** preference switched on, *Open in KiCad* starts the selected distribution's exact PCB Editor process and waits for its own API socket. The panel and the agent can then talk to that editor without waiting for ⌘S. Re-opening an already connected session reuses it instead of starting a duplicate:

* **Live** indicator in the panel header and a **Live** tab: the parts (reference, footprint, value, x, y, rotation, side), nets and your current selection, read from the editor every 1.5 s while the tab is open (an unchanged board costs almost nothing). Unsaved moves show up at once, and a Δ column shows what changed since the tab was opened. Positions use the same frame as the spec: mm from the board's top-left corner.
* `kicad_live_status` (agent and panel): is the API reachable, which board is open, is it this session's board. If not, one sentence says why and names the setting; every other tab and the ⌘S round trip keep working. If the editor has a different file open the panel says so instead of showing it as the session board.
* `kicad_live_snapshot` (agent and panel): a read-only snapshot of current parts, nets, selection and counts. The agent uses it to read positions before and after an adjustment, without adding a no-op move to KiCad's undo history.
* `kicad_live_move_footprint` (agent only): moves **one** footprint (and optionally sets its rotation) in the open editor, as one undoable KiCad step (⌘Z). **Nothing is saved**: you press ⌘S as before and the panel imports the save and runs DRC. It refuses unless the editor has exactly this session's board open. There is deliberately no "save" tool.

**Security.** The KiCad API is a plain local Unix socket (`/tmp/kicad/api.sock`, `api-<pid>.sock` for further editors). KiCad asks for no password or token; only your macOS user can connect to the socket file, but *every* process of that user can: your shell, scripts, and a ZCode agent that may run shell commands or Python, with or without this plugin. The protocol has requests for all of the following (this plugin's tests exercised only reads and one move commit): such a process can read the whole board, change or delete anything in it, save the board or a copy of it to any path it can write (`save_as` with overwrite), revert your unsaved edits, change the selection, run any editor action and (client library permitting) start export jobs. Switch the preference on only while you want it. This plugin uses the socket for reads (documents, footprints, tracks, vias, zones, pads, nets, selection) and for the one commit above; it never saves, reverts, deletes, changes the selection, runs actions or stops KiCad. `kicad_open_in_kicad` is the sole operation that starts an editor. The socket path and the token KiCad hands out stay inside the server process: neither goes to the panel page, a tool result or an error message.

## A 3D model for other tools

`pcb_export_glb` exports the board as a binary glTF (`.glb`) with KiCad's 3D models, stored as an artifact and copied to `./kicad/out/<name>.glb`, together with a part table: for every part its reference designator, footprint, position, yaw, side, size and bounding box in board millimetres. The file itself names every part node by designator (verified on KiCad 10.0.6), so Blender shows objects `U1`, `R3`, ...; the table gives the same without opening it. Parts whose footprint has no 3D model are not in the file (listed as `parts_without_model`), and the models are KiCad's library models, so heights are nominal. `include_copper` adds flat copper, pad, via, silkscreen and soldermask faces.

## Keep editing in the real KiCad

**Open in KiCad** in the panel (or the agent calling `kicad_open_in_kicad`) exports the board to `./kicad/edit/<name>/` — an ordinary KiCad project you own — and opens it in a fresh process from the selected Standard or Huaqiu **KiCad PCB Editor**. It runs that distribution's exact `pcbnew` executable instead of asking Launch Services to reuse an unrelated standalone editor, then verifies both the process socket and the requested open board. The result separates `launched` from `live_ready`; a project-lock or recovery dialog can make the first true while the second remains false, and `launch_note` says what to check.
Press ⌘S in KiCad and the panel imports the save by itself (a new board artifact plus a DRC run) and shows "edited in KiCad"; the agent can do the same with `kicad_sync_edits`. Re-opening never overwrites what you saved. Automatic launch is macOS-only for now.

## Known issues / not proven

* **Live-link limits:** the API has no "unsaved changes" request and no change notification, so the Live tab polls and cannot tell saved from unsaved edits. It needs `kicad-python` (fetched by `uv` on first start; without it the plugin starts without the live link). Process/socket selection, live snapshots, a 0.25 mm move, immediate read-back and a restoring move were exercised without saving on throwaway board copies in both official KiCad 10.0.6 and Huaqiu KiCad 10.0.7 on macOS. Canvas redraw was not judged visually.
* **Not an embedded editor.** The tabs are rendered by `kicad-cli`, not by KiCad's own canvas, and are separate from the PCB/Schematic Editor windows: edits still travel through the file (⌘S in KiCad, then the panel imports the save). The tab views do not follow your cursor or selection in KiCad.
* **Schematic tab and ERC need a schematic you drew.** ERC runs with KiCad's stock library tables on a private config, not your own library tables: a symbol from a custom library shows up as a library warning. Several sheets are listed in a selector; only single-sheet schematics were tried.
* **Layers, Schematic and Library are SVG from `kicad-cli`** in KiCad's default colour theme, not your theme. A big schematic is about 1 MB of SVG per sheet: the cat-feeder rev A schematic (0.9 MB) rendered in the real desktop sandbox test (real Electron host, CSP and bridge); a much larger design was not tried, and nothing was tried by hand in the ZCode Dev window.
* **GLB**: tested on the sample board (9 parts, positions/rotations/bottom side checked against pcbnew) and the part table only describes parts that have a library 3D model. Mesh names are footprint names; the designator is the node name.
* **Settings of earlier versions.** Up to 0.4.2 the plugin ran `kicad-cli version` on your own KiCad settings, and KiCad then rewrote one value in `~/Library/Preferences/kicad/10.0/kicad_common.json` (the folder file dialogs start in). From 0.5.0 every headless KiCad command uses a private config. The GUI intentionally keeps your own settings, including "Enable KiCad API".

* **"Open in KiCad" says KiCad was not started / PCB Editor crashes right away (macOS).** A KiCad copied from a download can retain the quarantine flag; macOS may block it or an older Launch Services attempt may have produced an App-Translocation crash where `libkicommon.*.dylib` was missing. The plugin watches the exact process it started and, if it exits, shows the crash reason and this fix, which you run yourself (it changes a security attribute, so the plugin never does): `xattr -dr com.apple.quarantine /Applications/KiCad`, then press *Open in KiCad* again. The "Editing in KiCad" banner only means an edit session exists; trust the warning line under the title over it.

## Notes

* Interactive page: ZCode Desktop, local workspaces only (see UI_PLUGIN.md). Other surfaces keep the plain tool records.
* Artifacts are stored per workspace under the plugin data directory; exported files go to `./kicad/out/` in the workspace.
* The KiCad worker (`server/kicad/`) is part of this plugin; its configuration never reads `.env` files.
* Limits: two layers, bare boards, positions are given by the agent, no schematic file. A passing DRC does not prove the circuit is right.

## Requirements, network and side effects

* **KiCad 10** must be installed. By default the plugin discovers official and Huaqiu apps under the system/user Applications directories and selects the newest app compatible with the requested edition; an explicit *KiCad.app path* disables fallback. The plugin runs the selected app's `kicad-cli`, bundled Python (pcbnew scripts), and symbol/footprint libraries; KiCad is neither bundled nor modified.
* **Python**: `uv` (recommended) or Python ≥ 3.11 with `fastmcp`, `pydantic`, `numpy` (and `kicad-python` for the live link, optional). **If neither uv nor such a Python is found, or uv cannot fetch the packages (offline first start), the plugin still starts: the panel opens and says what is missing, and the model gets one tool, `kicad_setup_help`.** uv runs with `UV_NO_CONFIG=1`, so a `uv.toml` or `pyproject.toml` in your workspace cannot change where packages come from. **Network**: on first start `uv` downloads those packages (plus kicad-python with pynng, protobuf and jsonschema) (and a Python if none ≥ 3.11 is installed). In the Huaqiu edition, the Huaqiu part-data, resolver, and model-comparison tools above contact `https://kiapi.eda.cn`; search terms and requested manufacturer/MPN identifiers are sent there. The comparison tool additionally reads the two selected public text-model URLs from the allowlisted Huaqiu file hosts. There is no telemetry.
CI prepares the Python runtime before starting the 60-second MCP handshake. Dependency preparation logs go to stderr; an unavailable runtime fails the artifact check rather than accepting the setup-help fallback. To prepare it manually, run `node dist/server.mjs --prepare-runtime` from the installed plugin directory; stdout returns `ready` on success. The artifact check uses the same isolated home and cached Python environment in offline mode for its handshake.

* **Commands run**: `kicad-cli` (DRC, render, SVG/GLB/STEP/Gerber export, `sch erc`, symbol/footprint SVG), KiCad's bundled Python, `uv`, and — only when you press *Open in KiCad* or the agent calls `kicad_open_in_kicad` — the selected distribution's `PCB Editor.app/Contents/MacOS/pcbnew <board>` (macOS). The launcher watches that exact child and its `api-<pid>.sock`; after a failed start it may read `xattr -p com.apple.quarantine` and `~/Library/Logs/DiagnosticReports/pcbnew-*.ips`. The plugin never changes the quarantine flag itself.
* **Files read**: besides your boards and the KiCad libraries, the "Enable KiCad API" value of `~/Library/Preferences/kicad/*/kicad_common.json` (read only, to tell you whether the API is switched on). **Sockets**: while the panel is open and a board is shown, it asks every 3 s whether KiCad's API answers (a ping and the list of open documents, no board data) to draw the Live indicator, and the Live tab reads the board every 1.5 s; an agent's `kicad_live_*` calls connect to the same local socket (see Security above). Nothing connects while the panel is closed and no agent calls them.
* **Files written**: `./kicad/` in the workspace (specs, exports incl. `kicad/out/<name>.glb`, `kicad/edit/<name>/` KiCad project) and the plugin data directory (artifact store, cache of rendered tab views, KiCad's private config). The file tools (`pcb_spec_example`, `kicad_check_spec_file`, `kicad_export_files`, the GLB export) only use paths inside the workspace (symlinks are resolved, a path that leaves it is refused); `pcb_spec_example` does not replace a spec that differs from the example unless `overwrite=true`, and `kicad_open_in_kicad` never overwrites a board that is already in `kicad/edit/`: it starts `<name>-r2`, `-r3`, … next to it. The bundled worker never reads `.env` or other configuration files. No hooks.

## Third-party

KiCad (GPL-3.0-or-later; its libraries are CC-BY-SA-4.0 with exceptions) is used from your installation and not redistributed. The Huaqiu edition uses `@huaqiu/part-search` (Apache-2.0) in place from the Huaqiu KiCad installation; this plugin does not redistribute it. Runtime packages fetched by `uv`: fastmcp (Apache-2.0), pydantic (MIT), numpy (BSD-3-Clause and others), kicad-python (MIT) with pynng (MIT), protobuf (BSD-3-Clause) and jsonschema (MIT). The panel bundles the MCP Apps SDK packages; their licenses ship in `dist/THIRD_PARTY_NOTICES.txt`.
This plugin is independent of the KiCad project and is not affiliated with or endorsed by it; "KiCad" is used to describe compatibility.
