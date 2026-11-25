# Podcast Studio

Produce a podcast episode from the host and guest recordings: line the tracks up, cut, reduce noise, even out loudness, add an intro and outro, and export, with a project you can reopen and change.

## Features

- **Multitrack**: up to 8 tracks, one per microphone (a single recording works too). Each track has a name, an offset, a gain and a mute switch.
- **Automatic alignment**: GCC-PHAT cross-correlation over the first 5 minutes. It locks onto mic bleed (the other person faintly heard in your mic) or a clap at the start.
  - The confidence of each match is reported. When there is no reliable match, the offset is left alone and you line the tracks up in the panel, with ±10 ms / ±100 ms nudges, against the waveforms.
- **Cuts on all tracks at once**: drag across a waveform, type times, or let the agent add the ranges you name. Cut edges get 15 ms fades so there are no clicks.
  - Long pauses (≥2.5 s) in the mix are listed. One click shortens a pause to 1 s.
- **Processing**: high-pass plus FFT noise reduction (off / light / strong), then the mix. Intro and outro are levelled first. Then two-pass EBU R128 loudness normalisation to -16 LUFS (or -14 / -19 / -23) with a -1.5 dBTP ceiling.
- **Output** (default `podcast/`):
  - `<title>.mp3` (128 kbps stereo with an ID3 title) and/or `<title>.wav` (16-bit, 44.1 kHz).
  - `<title>.cuts.md`: track offsets and every cut, with where it lands in the episode.
  - `<title>.podcast.json`: the project, to reopen, change and render again.
- **Panel**: waveform lanes with a ruler, zoom and scroll; drag-to-cut; a 15-second mix preview from the playhead; a cut list with "listen around this cut"; settings; and the render result with measured loudness.

## Usage

Ask the agent in ZCode Desktop:

- "Line up host.wav and guest.m4a, cut 12:30 to 14:05, add intro.mp3 and outro.mp3 and export an MP3 at -16 LUFS"
- "Shorten every pause longer than 3 seconds and turn the guest down 2 dB"
- "Reopen episode 12 and export a WAV too"

## Tools

| Tool | Purpose |
|---|---|
| `podcast_open` | Open the recordings (or a project), align them, list long pauses, open the panel |
| `podcast_save` | Validate and save tracks, cuts and settings |
| `podcast_render` | Mix, cut, normalise and export MP3/WAV plus the cut list |

## Requires ffmpeg

Uses the ffmpeg installed on your computer (not bundled). Install it with `brew install ffmpeg` on macOS or `winget install ffmpeg` on Windows. If it is not on PATH, set its path in the plugin settings.

## Scope (v0.1)

- Input: WAV, AIFF, FLAC, MP3, M4A/AAC, OGG/Opus, or the audio of MP4/MOV/WebM/MKV.
- Tracks are mixed to a mono voice bed, then output in stereo. Intro and outro are played before and after the episode, without overlap.
- Alignment needs some shared sound (bleed or a clap) in the first 5 minutes. It corrects a constant offset only, not clock drift over very long recordings.
- Not included: removing filler words, AI noise-removal models, music ducking under speech, or chapter markers.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the recordings you pick. Writes only to the output folder in the workspace.
- ffmpeg is called with argument arrays (no shell). No hooks.

## Build and test (developers)

- Source: `ui-plugins/podcast-studio/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests (need ffmpeg): `pnpm --filter @penova/plugin-podcast-studio test` and `test:e2e`.
- `E2E_PODCAST` can point to a folder with `host.wav`, `guest.wav` and `jingle.mp3`. We used a real interview recording (Wikimedia Commons, CC BY 3.0) as the host track. A second microphone was simulated with 1.84 s-delayed bleed under a real lecture voice (MITx, CC BY 2.0).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`. ffmpeg is not bundled.
