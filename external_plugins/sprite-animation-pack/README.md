# Sprite Animation Pack

Turn a character's animation frames into a pack your game engine can load: one atlas, every action's frames lined up on the same anchor, frame timing, loops, and import files for Phaser, Godot and Unity.

## Features

- **Input**:
  - A folder of PNG frames. Actions are grouped by sub-folder (`run/1.png`) or by file name without the frame number (`hero_run_01.png` → `run`), and frames are sorted naturally.
  - Or a whole sprite sheet sliced by a grid (cell size or cols/rows), with one action per row or per column. Empty cells are skipped.
  - A solid background (magenta, green, or the corner colour) can be keyed out.
- **Alignment**: every frame is placed in a uniform cell so that its anchor sits at the same point.
  - **feet**: horizontal centre of mass, resting on the lowest pixel. This is the default for trimmed frames.
  - **keep**: the original position, chosen automatically when frames share a padded canvas, which preserves jumps.
  - **center** is also available.
  - Each frame can be nudged by 1 px.
- **Panel**:
  - Action list with name, fps, loop and alignment.
  - Live preview with zoom, ground line and onion skin, plus play/pause/step.
  - Frame strip with duration per frame, nudge, reorder and delete.
  - Settings and the atlas preview.
- **Export** to `sprites/<name>/`:
  - `<name>.png`: atlas with uniform cells and one row per action, with an integer nearest-neighbour scale (1–8×) for pixel art.
  - `<name>.json`: Aseprite format with frame durations and tags. Phaser 3 loads it with `load.aseprite` + `anims.createFromAseprite`; plain atlas loaders read it too.
  - `<name>.tres`: Godot 4 `SpriteFrames`, with per-action speed, loop and relative frame durations. It references the atlas next to it.
  - `<name>.unity.md`: Sprite Editor grid slicing settings, the pivot, and every frame's rectangle.
  - `<name>.phaser.js`: a ready-to-paste snippet.
  - `<name>.sprites.json`: the project, to reopen and change.

## Usage

Ask the agent in ZCode Desktop:

- "Slice hero.png into 32×32 cells — rows are idle, run and jump — and export a pack for Godot and Phaser"
- "Line up the frames in art/knight/ on the feet, make attack play once at 15 fps"
- "Export the runner at 4× for pixel-art scaling"

## Tools

| Tool | Purpose |
|---|---|
| `sprite_open` | Open a frames folder/list, a sprite sheet (+ grid) or a project; group, align and open the panel |
| `sprite_save` | Save names, order, timing, loops, alignment, nudges and settings |
| `sprite_export` | Write the atlas, Aseprite/Phaser JSON, Godot .tres, Unity notes and the project |

## Scope (v0.1)

- PNG frames only (with transparency, or a solid background to key out).
- Uniform cells; no tight packing or rotation.
- Generating new frames ("fill in the missing attack frames") is not included. Generate them with an image tool first, then add them to the folder.
- Unity gets slicing instructions rather than a `.meta` file, because Unity assigns its own GUIDs.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the images you pick. Writes only to `sprites/<name>/` in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/sprite-animation-pack/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-sprite-animation-pack test` and `test:e2e`.
- `E2E_SPRITES` can point to real art. We used the CC0 "Runner character" by Blue Yeti Studios from OpenGameArt, both as the sheet and as trimmed frames.

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: pngjs (MIT), jpeg-js (BSD-3-Clause), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
