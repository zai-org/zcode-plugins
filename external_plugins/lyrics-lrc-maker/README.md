# Lyrics Timer

Give song lyrics a timeline and export LRC and SRT. Pick the lyrics (plain text, one line per lyric line, or an existing LRC to re-time) and the song; the sung phrases are detected from the audio and each lyric line is matched to them in proportion to its length, so long lines that span two breaths and short lines sharing one phrase still land in the right place. Nudge any line by editing its time, shift the whole song with an offset, add title and artist tags, then export a standard LRC, an enhanced word-by-word LRC for karaoke players and an SRT for video editors. Without audio, lines are spaced evenly for you to adjust. Runs locally with ffmpeg; no account or API keys.

## Features

- **Automatic timing** from the song: sung phrases are found from the loudness envelope and lines are matched by length (one line across phrases, or several lines in one).
- **Re-time existing LRC** files, including lines with several time tags.
- **Nudge and shift**: edit any start/end, or apply a global offset in milliseconds.
- **Checks**: times out of order, missing or malformed times, lines after the end of the song.
- **Tags**: title, artist, album, by, length.
- **Exports**: LRC, enhanced (word/character-timed) LRC and SRT.
- **Panel**: pick input files, adjust settings, see problems, edit any cell in the table, preview the result and export — all in the ZCode side panel. Edits are saved in `lyrics-lrc-maker/<project>.project.json` and kept until you re-open the inputs.

## Usage

Ask the agent in ZCode Desktop:

- "Time 晚风茶馆.txt to 晚风茶馆.mp3"
- "Move 一盏灯光 to 00:23.40 and shift everything 200 ms later"
- "Export LRC and SRT"

## Tools

| Tool | Purpose |
|---|---|
| `lrc_open` | Read the lyrics and time them to the song. Opens the panel |
| `lrc_edit` | Change settings, edit cells by row, add or remove rows |
| `lrc_status` | Show the current rows, issues and summary |
| `lrc_export` | Write <title>.lrc, <title>.enhanced.lrc and <title>.srt |

Output goes to `lyrics-lrc-maker/<project>/` in the workspace.

## Scope (v0.1)

- Needs ffmpeg installed for audio (free; macOS: brew install ffmpeg; Windows: winget install ffmpeg).
- Timing is estimated from loudness, not speech recognition: songs with loud backing music need more nudging. No in-panel audio playback in v0.1.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the files you choose. Writes only the `lyrics-lrc-maker/` folder in the workspace. No hooks.

## Build and test (developers)

- Source: `ui-plugins/lyrics-lrc-maker/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-lyrics-lrc-maker test` and `test:e2e` (needs Chrome; sample files in `test/samples/`).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`.
