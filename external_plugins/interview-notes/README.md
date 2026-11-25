# Interview Notes

Turn a user interview recording and its transcript into a needs list in which every item quotes the interviewee's own words, and every quote plays back that moment of the recording.

## Features

- **Transcript import**: SRT, WebVTT (`<v Name>`), and timestamped text exports such as Feishu Minutes / Tencent Meeting (`Name 00:01:02` headers) or `[00:01:02] Name: text` lines. Lines starting with `Name:` set the speaker, and the speaker carries over to the following lines.
- **Needs extraction by the agent**: the agent reads the transcript with line ids (`[u12 01:05 Name]`) and submits needs: title, detail, category, priority and quotes. Each quote must point to a real line, and the quoted words must appear in that line. Anything else is dropped or replaced by the full line, with a warning.
- **Panel**:
  - Needs list with priority, category, and status (open / confirmed / rejected). Click ▶ on a quote to hear it.
  - Transcript with speaker colours. You can rename a speaker; giving two speakers the same name merges them. You can also fix the speaker of a single line, and use "+ quote" to add a line to the selected need.
- **Export** to `interviews/`:
  - `<name>.md`: needs with quotes, plus the full transcript.
  - `<name>.csv`: one row per quote, UTF-8 BOM for Excel.
  - `<name>.html`: a self-contained page whose quotes play the recording at that moment. The recording is linked by relative path.
  - The working file `<name>.interview.json` lets you reopen and continue. Re-running the extraction keeps your status for needs with the same title.

## Usage

Ask the agent in ZCode Desktop:

- "Go through interview-0412.m4a and list what the user needs, with their exact words for each point"
- "The first speaker is me, the second is Ms Li — rename them and redo the needs"
- "Export the confirmed needs as a CSV and an HTML page I can send to the team"

## Tools

| Tool | Purpose |
|---|---|
| `interview_open` | Open a recording and its transcript (a same-name file is picked up), return the transcript with line ids, open the panel |
| `interview_submit` | Save the extracted needs and quotes (validated against the transcript), optionally rename speakers |
| `interview_export` | Write Markdown, CSV and the click-to-play HTML page |

## Requires ffmpeg

Playback in the panel uses the ffmpeg installed on your computer (not bundled). Install it with `brew install ffmpeg` on macOS or `winget install ffmpeg` on Windows. If it is not on PATH, set its path in the plugin settings.

## Scope (v0.1)

- Input: MP3, M4A, WAV, OGG/Opus, AAC, FLAC, or the audio of MP4/MOV/WebM/MKV, together with a transcript.
- **No speech recognition**: bring a transcript from your meeting or transcription tool.
- Not included: merging several interviews into one affinity map, or syncing to Jira/Feishu.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts. The needs are written by the agent you already use in ZCode.
- Reads only the recording and transcript. Writes only to `interviews/` in the workspace.
- ffmpeg is called with argument arrays (no shell). No hooks.

## Build and test (developers)

- Source: `ui-plugins/interview-notes/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests (need ffmpeg): `pnpm --filter @penova/plugin-interview-notes test` and `test:e2e`.
- `E2E_INTERVIEW` can point to a real interview. We used a 5-minute interview of Abhinav Srivastava by Rupika Sharma (Wikimedia Commons, CC BY 3.0) with its 105-cue English subtitles.

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`. ffmpeg is not bundled.
