# Slideshow Video

Make a slideshow video from a folder of photos and a song (put the music file in the folder, or pick it alongside). Photos are put in the order they were taken (from EXIF), each one gets a gentle Ken Burns zoom or pan, and they cross-fade into each other; phone photos are turned the right way up. Set how long each photo stays, pick the transition and how photos fit the frame (fill and crop, or the whole photo over a blurred copy), add captions, and stretch the timing so the video ends with the music. Low-resolution photos, duplicates, unreadable files and photos too short for their transition are flagged before you render. Exports a 1080p MP4 (landscape, square or vertical) and a storyboard PNG of every slide with its time. Runs locally with ffmpeg; no account or API keys.

## Features

- **Ordered by date taken** (EXIF), or by file name; phone photos are rotated upright.
- **Ken Burns motion**: zoom in/out or pan per photo, alternating automatically.
- **Transitions**: fade, dissolve, slide, wipe, circle or none, with adjustable length.
- **Fit**: fill and crop, whole photo on a blurred background, or on a solid colour.
- **Music**: loops if short, fades out if long, or stretch the photos to end with the song.
- **Checks**: low resolution, duplicates, unreadable files, slides shorter than the transition.
- **Exports**: 1080p MP4 (landscape/square/vertical) and a storyboard PNG.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `slideshow-video/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Make a slideshow from the 茶园一日 folder (photos and 茶园小调.mp3)"
- "Drop the duplicate photo, caption the first one 清晨的茶园 and fit it to the music"
- "Export the MP4"

## Tools

| Tool | Purpose |
|---|---|
| `slideshow_open` | Read the photos and music and plan the slideshow. Opens the panel |
| `slideshow_edit` | Change settings, edit cells by row, add or remove rows |
| `slideshow_status` | Show the current rows, issues and summary |
| `slideshow_export` | Write <title>.mp4 and <title>-storyboard.png |

Output goes to `slideshow-video/<project>/` in the workspace.

## Scope (v0.1)

- Needs ffmpeg installed (free; macOS: brew install ffmpeg; Windows: winget install ffmpeg).
- HEIC photos are not read in v0.1 — export them as JPEG first. Rendering takes about a second per photo.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `slideshow-video/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/slideshow-video/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-slideshow-video test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
