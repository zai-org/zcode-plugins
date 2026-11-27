# Video Frame Grabber

Grab still frames from a video and make a contact sheet. Find a frame at every cut or slide change (scene detection, tuned for camera footage or for slides and screen recordings), or take one every N seconds, or N frames spread evenly. Every frame is a row you can move by editing its time, label, untick, or add at exact moments. Black frames from fades, near-duplicates and times past the end are flagged. Exports the frames as JPG or PNG (named by video, number, time and label), a contact-sheet PNG with timestamps and a CSV list. Runs locally with ffmpeg; no account or API keys.

## Features

- **Scene detection**: a frame after every cut or slide change, with a minimum gap; sensitivity adjustable for slides.
- **Interval or count** modes, skipping the start or end.
- **Editable list**: move a frame by its time, label it, untick it or add exact times.
- **Checks**: black frames (fades), near-duplicates, times past the end, a hint when few scenes are found.
- **Exports**: JPG/PNG frames (optional max width), contact-sheet PNG with timestamps, CSV.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `video-frame-grabber/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Grab a frame at every slide change in 茶课第3讲.mp4"
- "Label the first frame 封面 and add one at 00:40"
- "Export the frames and the contact sheet"

## Tools

| Tool | Purpose |
|---|---|
| `frames_open` | Read the video and find the frames to grab. Opens the panel |
| `frames_edit` | Change settings, edit cells by row, add or remove rows |
| `frames_status` | Show the current rows, issues and summary |
| `frames_export` | Write frames/, contact-sheet.png and frames.csv |

Output goes to `video-frame-grabber/<project>/` in the workspace.

## Scope (v0.1)

- Needs ffmpeg installed (free; macOS: brew install ffmpeg; Windows: winget install ffmpeg).
- Up to 200 frames per project. No in-panel video playback in v0.1.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `video-frame-grabber/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/video-frame-grabber/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-video-frame-grabber test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
