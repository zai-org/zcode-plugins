# Course Video Packager

Turn a full lecture recording into a package ready to upload: chapter videos, per-chapter subtitles, covers, a course outline and a zip.

## Features

- **Chapter planning**: on open, the plugin finds long pauses (ffmpeg silence detection) and subtitle gaps and gives the agent a timestamped transcript digest; the agent proposes chapters (title + start + summary) and you adjust them in the panel.
- **Panel**: coloured chapter timeline (with pause ticks and subtitle density), editable chapter table (start, title, summary), frame preview at any time, "New chapter here".
- **Package** (default `course-package/`):
  - `chapters/NN-title.mp4`: exact cuts (re-encoded H.264/AAC) or fast cuts (stream copy, cut at key frames);
  - `chapters/NN-title.srt / .vtt`: cut from the full subtitles and re-timed to start at 0; cues crossing a boundary are trimmed;
  - `covers/NN-title.jpg` per chapter (frame + number + title) and `cover.jpg` for the course;
  - `index.md` outline (lengths, file links, summaries and a chapter list to paste into a video description), `chapters.json`, `chapters.csv`;
  - `<course>.zip` with all of the above; `course.json` keeps the plan so you can reopen, edit and rebuild.

## Usage

Ask the agent in ZCode Desktop:

- "Split lecture-03.mp4 into chapters based on what I talk about and build a publishing package"
- "Use these chapter times and titles, cut the subtitles per chapter too"
- "Rebuild the course package with faster cuts and a red cover colour"

## Tools

| Tool | Purpose |
|---|---|
| `course_open` | Open a recording (its same-name subtitles are picked up), return pauses and transcript, open the panel |
| `course_save` | Validate and save the chapter plan |
| `course_build` | Build chapter videos, subtitles, covers, outline and zip |

## Requires ffmpeg

Uses the ffmpeg installed on your computer (not bundled). macOS: `brew install ffmpeg`; Windows: `winget install ffmpeg`. Set its path in the plugin settings if it is not on PATH.

## Scope (v0.1)

- Input: MP4, MOV, WebM, MKV, M4V; subtitles SRT / VTT.
- No speech recognition: without subtitles you can still split by time (no per-chapter subtitles); generate subtitles first with another tool if needed.
- Not included: extracting slides, uploading to video platforms.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the recording, subtitles and system fonts; writes only inside the output folder in the workspace. ffmpeg is called with argument arrays (no shell). No hooks.

## Build and test (developers)

Source: `ui-plugins/course-video-packager/`. `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source. Tests (need ffmpeg): `pnpm --filter @penova/plugin-course-video-packager test` and `test:e2e` (`E2E_COURSE` can point to a real lecture; we used the 11-minute MITx 6.002x course overview from Wikimedia Commons, CC BY 2.0).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: resvg-wasm (MPL-2.0, unmodified, source https://github.com/yisibl/resvg-js), fontkit (MIT), fflate (MIT), pngjs (MIT), jpeg-js (BSD-3-Clause), MCP SDK and ext-apps (MIT); full list in `dist/THIRD_PARTY_NOTICES.txt`. ffmpeg is not bundled.
