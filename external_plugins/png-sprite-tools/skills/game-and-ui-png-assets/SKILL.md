---
name: game-and-ui-png-assets
description: Prepare PNG assets with browser tools - trim transparent padding from one PNG or a batch and add exact padding, or slice a uniform sprite sheet into individual PNG frames - then wire the results into the project. Use when the user wants to crop empty transparent space around icons, sprites or cutouts, normalize padding across many PNGs, or split a sprite sheet or tileset into frames for a game engine or UI.
---

# Game and UI PNG assets

Pick the right browser tool, give the user a preset link, then use the exported files in the project. Answer in the user's language. All three MCP tools only build links; they never receive images.

## Choose the tool

| Task | MCP server / tool | Output |
| --- | --- | --- |
| Trim one PNG to its visible pixels and add padding | `png-trim` / `prepare_png_trim` | One PNG |
| Trim many PNGs with the same settings | `png-batch-trim` / `prepare_batch_png_trim` | Single PNGs or one ZIP with trimmed PNGs and a per-file CSV |
| Split a sprite sheet or tileset into frames | `sprite-slicer` / `prepare_sprite_grid` | ZIP of PNG frames named by row and column |

### `prepare_png_trim` and `prepare_batch_png_trim`

| Argument | Values | Default | Meaning |
| --- | --- | --- | --- |
| `padding` | integer 0–512 | `0` | Transparent pixels added on every side after trimming |
| `threshold` | integer 0–254 | `0` | Alpha at or below this value is ignored when finding the content bounds; `0` ignores only fully transparent pixels |
| `sample` | `true` or `false` | `false` | Open the bundled example |

Trimming copies the pixels inside the bounds without resampling. Only static PNG input is supported.

### `prepare_sprite_grid`

| Argument | Values | Default | Meaning |
| --- | --- | --- | --- |
| `width`, `height` | integer 1–4096 | required | Frame size in pixels |
| `gapX`, `gapY` | integer 0–4096 | `0` | Horizontal / vertical gap between frames |
| `x`, `y` | integer 0–4096 | `0` | Offset from the image's top-left corner to the first frame |
| `prefix` | lowercase `a-z0-9_-`, max 32, starting with a letter or digit | `sprite` | File name prefix |
| `skipEmpty` | `true` or `false` | `false` | Skip fully transparent frames |
| `sample` | `true` or `false` | `false` | Open the bundled demo sheet |

Ask for the frame size when the user has not given it; if they know the sheet's columns and rows, compute width and height from the image dimensions. Accepts PNG, WebP or JPEG sheets.

Invalid or missing required arguments are rejected with an input validation error.

## Steps

1. Call the matching tool. Each result has `structuredContent.preset`, a link such as `https://sprite-sheet-slicer.chajian.workers.dev/#width=16&height=16&gapX=1&gapY=1&x=0&y=0&prefix=hero&skipEmpty=0&sample=0`. Give the link to the user.
2. The user opens it in a desktop browser, chooses the local file(s), checks the preview and downloads the result. Files are processed locally in the browser and are not uploaded.
3. The user saves the output into the workspace and tells you where.
4. Wire the assets in after confirming: for example update a Phaser / PixiJS / Godot / Unity import, an animation frame list, a CSS sprite or `<img>` sizes, or an icon component. Show the edit before changing files.

## Limits

- The tools cannot see the images; processing happens only in the user's browser.
- If a call fails, give the base links: `https://transparent-padding-trimmer.chajian.workers.dev/`, `https://batch-transparent-png-trim.chajian.workers.dev/`, `https://sprite-sheet-slicer.chajian.workers.dev/`.
