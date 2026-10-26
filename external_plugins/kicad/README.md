# KiCad (ZCode UI plugin)

KiCad 10 inside the conversation. Agents design a two-layer board from a JSON circuit spec — real KiCad symbol/footprint libraries, auto-route, DRC, Gerber/BOM/CPL —
and the **KiCad board** side panel shows the 3D render, the DRC verdict, the part list and every artifact.

## What you need

* macOS with **KiCad 10** (`/Applications/KiCad/KiCad.app`; or set *KiCad.app path* in the plugin settings).
* **uv** (recommended: dependencies are fetched on first start) or a Python with `fastmcp>=4,<5`, `pydantic`, `numpy` (setting *Python with fastmcp*).

## Use

Ask: "Design a 555 LED blinker board with KiCad, check DRC, render it and open the board panel." The sample case is an NE555 astable flasher (about 1 Hz, 9 parts, 34 × 22 mm); the agent starts from `pcb_spec_example`, then `kicad_check_spec_file`, `pcb_build`, `pcb_render`, `pcb_export_fab`, `kicad_export_files` and `kicad_board_view` (see `skills/kicad-board/SKILL.md`).
Open the panel manually from the session panel list at any time.

## The panel: tabs next to the real KiCad windows

The panel is a companion to KiCad's own windows (PCB Editor, Schematic Editor), not an embedded editor. Its tabs show what `kicad-cli` produces headlessly for the newest board (the one you edited in KiCad, once you saved):

* **Board**: 3D render (top/bottom), part list. **Live**: what the running PCB Editor has open right now, without ⌘S (see below). **Layers**: one SVG per layer (copper, mask, silkscreen, paste, fab, courtyard, outline), switch layers on and off, mirror for the bottom view.
* **3D**: pre-rendered views (iso, rear, top, bottom, front, side), not an interactive viewer.
* **Schematic**: the `.kicad_sch` found in the edit project (`./kicad/edit/<name>/`), one sheet at a time. The plugin builds boards from the circuit spec and generates no schematic: without one the tab says so (draw it in KiCad's Schematic Editor and save it in that folder).
* **Checks**: DRC with the first violations and their positions (`kicad_checks`, the agent can call it too) and, when a schematic exists, ERC.
* **Library**: search KiCad's symbols and footprints (`pcb_search_parts`) and look at the drawing of one (symbol unit 1, footprint) and its pins.
* **Artifacts**: everything stored for this workspace.


## Live link to the running PCB Editor (KiCad API)

With KiCad's own **"Enable KiCad API"** preference switched on, the panel and the agent can talk to the PCB Editor you already have open, without waiting for ⌘S:

* **Live** indicator in the panel header and a **Live** tab: the parts (reference, footprint, value, x, y, rotation, side), nets and your current selection, read from the editor every 1.5 s while the tab is open (an unchanged board costs almost nothing). Unsaved moves show up at once, and a Δ column shows what changed since the tab was opened. Positions use the same frame as the spec: mm from the board's top-left corner.
* `kicad_live_status` (agent and panel): is the API reachable, which board is open, is it this session's board. If not, one sentence says why and names the setting; every other tab and the ⌘S round trip keep working. If the editor has a different file open the panel says so instead of showing it as the session board.
* `kicad_live_move_footprint` (agent only): moves **one** footprint (and optionally sets its rotation) in the open editor, as one undoable KiCad step (⌘Z). **Nothing is saved**: you press ⌘S as before and the panel imports the save and runs DRC. It refuses unless the editor has exactly this session's board open. There is deliberately no "save" tool.

**Security.** The KiCad API is a plain local Unix socket (`/tmp/kicad/api.sock`, `api-<pid>.sock` for further editors). KiCad asks for no password or token; only your macOS user can connect to the socket file, but *every* process of that user can: your shell, scripts, and a ZCode agent that may run shell commands or Python, with or without this plugin. The protocol has requests for all of the following (this plugin's tests exercised only reads, one move, undo and a zoom action): such a process can read the whole board, change or delete anything in it, save the board or a copy of it to any path it can write (`save_as` with overwrite), revert your unsaved edits, change the selection, run any editor action and (client library permitting) start export jobs. Switch the preference on only while you want it. This plugin uses the socket for reads (documents, footprints, tracks, vias, zones, pads, nets, selection) and for the one commit above; it never saves, reverts, deletes, changes the selection, runs actions or starts or stops KiCad, and it keeps the socket path and the token KiCad hands out inside the server process: neither goes to the panel page, a tool result or an error message.

## A 3D model for other tools

`pcb_export_glb` exports the board as a binary glTF (`.glb`) with KiCad's 3D models, stored as an artifact and copied to `./kicad/out/<name>.glb`, together with a part table: for every part its reference designator, footprint, position, yaw, side, size and bounding box in board millimetres. The file itself names every part node by designator (verified on KiCad 10.0.6), so Blender shows objects `U1`, `R3`, ...; the table gives the same without opening it. Parts whose footprint has no 3D model are not in the file (listed as `parts_without_model`), and the models are KiCad's library models, so heights are nominal. `include_copper` adds flat copper, pad, via, silkscreen and soldermask faces.

## Keep editing in the real KiCad

**Open in KiCad** in the panel (or the agent calling `kicad_open_in_kicad`) exports the board to `./kicad/edit/<name>/` — an ordinary KiCad project you own — and opens it in your local **KiCad PCB Editor**.
Press ⌘S in KiCad and the panel imports the save by itself (a new board artifact plus a DRC run) and shows "edited in KiCad"; the agent can do the same with `kicad_sync_edits`. Re-opening never overwrites what you saved. Automatic launch is macOS-only for now.

## Known issues / not proven

* **Live link, not proven:** whether KiCad's canvas redraws right away after `kicad_live_move_footprint` was not seen with eyes (the editor's own read-back shows the new position and ⌘Z restores the old one, tested on a separate KiCad instance, not on yours). The API has no "unsaved changes" request and no change notification, so the Live tab polls and cannot tell saved from unsaved edits. It needs `kicad-python` (fetched by `uv` on first start; without it the plugin starts without the live link) and was tried on KiCad 10.0.6 on macOS only. Writes were only ever tried on a throwaway board copy in a separate KiCad process.
* **Not an embedded editor.** The tabs are rendered by `kicad-cli`, not by KiCad's own canvas, and are separate from the PCB/Schematic Editor windows: edits still travel through the file (⌘S in KiCad, then the panel imports the save). The tab views do not follow your cursor or selection in KiCad.
* **Schematic tab and ERC need a schematic you drew.** ERC runs with KiCad's stock library tables on a private config, not your own library tables: a symbol from a custom library shows up as a library warning. Several sheets are listed in a selector; only single-sheet schematics were tried.
* **Layers, Schematic and Library are SVG from `kicad-cli`** in KiCad's default colour theme, not your theme. A big schematic is about 1 MB of SVG per sheet: the cat-feeder rev A schematic (0.9 MB) rendered in the real desktop sandbox test (real Electron host, CSP and bridge); a much larger design was not tried, and nothing was tried by hand in the ZCode Dev window.
* **GLB**: tested on the sample board (9 parts, positions/rotations/bottom side checked against pcbnew) and the part table only describes parts that have a library 3D model. Mesh names are footprint names; the designator is the node name.
* **Settings of earlier versions.** Up to 0.4.2 the plugin ran `kicad-cli version` on your own KiCad settings, and KiCad then rewrote one value in `~/Library/Preferences/kicad/10.0/kicad_common.json` (the folder file dialogs start in). From 0.5.0 every KiCad program the plugin starts uses a private config; in a test of that call only this one value changed, and the GUI you open keeps your own settings.

* **"Open in KiCad" says KiCad was not started / PCB Editor crashes right away (macOS).** A KiCad copied into `/Applications` by hand or from a download keeps the download quarantine flag, and macOS then runs only the nested `pcbnew.app` from a temporary copy ("App Translocation"), where `libkicommon.*.dylib` is missing ("Library not loaded" in the crash report). The plugin waits for `pcbnew` to stay running and, if it does not, shows the reason and this fix, which you run yourself (it changes a security attribute, so the plugin never does): `xattr -dr com.apple.quarantine /Applications/KiCad`, then press *Open in KiCad* again. The "Editing in KiCad" banner only means an edit session exists; trust the warning line under the title over it.

## Notes

* Interactive page: ZCode Desktop, local workspaces only (see UI_PLUGIN.md). Other surfaces keep the plain tool records.
* Artifacts are stored per workspace under the plugin data directory; exported files go to `./kicad/out/` in the workspace.
* The KiCad worker (`server/kicad/`) is part of this plugin; its configuration never reads `.env` files.
* Limits: two layers, bare boards, positions are given by the agent, no schematic file. A passing DRC does not prove the circuit is right.

## Requirements, network and side effects

* **KiCad 10** must be installed (`/Applications/KiCad/KiCad.app`, or set *KiCad.app path*). The plugin runs its `kicad-cli`, its bundled Python (pcbnew scripts) and reads its symbol/footprint libraries; KiCad is neither bundled nor modified.
* **Python**: `uv` (recommended) or Python ≥ 3.11 with `fastmcp`, `pydantic`, `numpy` (and `kicad-python` for the live link, optional). **If neither uv nor such a Python is found, or uv cannot fetch the packages (offline first start), the plugin still starts: the panel opens and says what is missing, and the model gets one tool, `kicad_setup_help`.** uv runs with `UV_NO_CONFIG=1`, so a `uv.toml` or `pyproject.toml` in your workspace cannot change where packages come from. **Network**: on first start `uv` downloads those packages (plus kicad-python with pynng, protobuf and jsonschema) (and a Python if none ≥ 3.11 is installed). Nothing else uses the network; there is no telemetry.
CI prepares the Python runtime before starting the 60-second MCP handshake. Dependency preparation logs go to stderr; an unavailable runtime fails the artifact check rather than accepting the setup-help fallback. To prepare it manually, run `node dist/server.mjs --prepare-runtime` from the installed plugin directory; stdout returns `ready` on success. The artifact check uses the same isolated home and cached Python environment in offline mode for its handshake.

* **Commands run**: `kicad-cli` (DRC, render, SVG/GLB/STEP/Gerber export, `sch erc`, symbol/footprint SVG), KiCad's bundled Python, `uv`, and — only when you press *Open in KiCad* or the agent calls `kicad_open_in_kicad` — `open -a "PCB Editor.app"` (macOS), then read-only checks that it stays running: `pgrep -x pcbnew`, and after a failed start `xattr -p com.apple.quarantine` plus a look at `~/Library/Logs/DiagnosticReports/pcbnew-*.ips`. The plugin never changes the quarantine flag itself.
* **Files read**: besides your boards and the KiCad libraries, the "Enable KiCad API" value of `~/Library/Preferences/kicad/*/kicad_common.json` (read only, to tell you whether the API is switched on). **Sockets**: while the panel is open and a board is shown, it asks every 3 s whether KiCad's API answers (a ping and the list of open documents, no board data) to draw the Live indicator, and the Live tab reads the board every 1.5 s; an agent's `kicad_live_*` calls connect to the same local socket (see Security above). Nothing connects while the panel is closed and no agent calls them.
* **Files written**: `./kicad/` in the workspace (specs, exports incl. `kicad/out/<name>.glb`, `kicad/edit/<name>/` KiCad project) and the plugin data directory (artifact store, cache of rendered tab views, KiCad's private config). The file tools (`pcb_spec_example`, `kicad_check_spec_file`, `kicad_export_files`, the GLB export) only use paths inside the workspace (symlinks are resolved, a path that leaves it is refused); `pcb_spec_example` does not replace a spec that differs from the example unless `overwrite=true`, and `kicad_open_in_kicad` never overwrites a board that is already in `kicad/edit/`: it starts `<name>-r2`, `-r3`, … next to it. The bundled worker never reads `.env` or other configuration files. No hooks.

## Third-party

KiCad (GPL-3.0-or-later; its libraries are CC-BY-SA-4.0 with exceptions) is used from your installation and not redistributed. Runtime packages fetched by `uv`: fastmcp (Apache-2.0), pydantic (MIT), numpy (BSD-3-Clause and others), kicad-python (MIT) with pynng (MIT), protobuf (BSD-3-Clause) and jsonschema (MIT). The panel bundles the MCP Apps SDK packages; their licenses ship in `dist/THIRD_PARTY_NOTICES.txt`.
This plugin is independent of the KiCad project and is not affiliated with or endorsed by it; "KiCad" is used to describe compatibility.
