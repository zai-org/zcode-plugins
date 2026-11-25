# Game SFX Pack

Make the sound effects a game needs from its list of events, clean up the sounds you already have, and deliver them as one consistent, organised pack.

## Features

- **Synthesised sounds**: each event (jump, coin, hit, explosion, laser, power-up, step, whoosh, button click, confirm, error…) is matched to a preset from its name (English or Chinese) and a category folder (player, pickup, combat, ui…).
  - The synthesiser follows the sfxr idea and is written from scratch: oscillators (square, saw, sine, triangle, noise), envelope with punch, pitch slide, vibrato, arpeggio, duty sweep, filters and repeat.
  - Every sound has a **seed**, so it is reproducible. Re-roll the seed for another variation, or tweak pitch, length and slide.
- **Existing sounds**: WAV, or MP3/OGG/FLAC/M4A through your ffmpeg. You can trim leading and trailing silence, and turn a sound into a **seamless loop** with an equal-power crossfade from the end into the start.
- **Consistent loudness**: every sound is matched to one gated RMS target (default -18 dBFS), with peaks kept under -1 dBFS. Each sound also has a relative gain.
- **Export** to `sfx/`:
  - `<category>/<name>.wav` (16-bit, 22.05/44.1/48 kHz) and/or `.ogg` (Vorbis, via ffmpeg).
  - `manifest.json` / `manifest.csv`: event, file, length, loop, loudness, peak, preset + seed or source.
  - `<name>.sfx.json`: the project, to reopen.
- **Panel**: sounds grouped by category, each with play, waveform, measured loudness, preset, 🎲 re-roll, pitch/length/slide sliders, trim/loop/crossfade for files, gain and delete. You can add events by typing them.

## Usage

Ask the agent in ZCode Desktop:

- "Make sounds for my platformer: jump, coin pickup, hurt, death, button click and menu confirm"
- "Turn rain.wav into a seamless loop and match it to the other sounds"
- "Make the jump a bit higher and the explosion longer, then export OGG too"

## Tools

| Tool | Purpose |
|---|---|
| `sfx_open` | Start from events and/or existing files (or a project); open the panel |
| `sfx_save` | Save names, categories, presets, seeds, parameters, trim/loop, gain and settings |
| `sfx_export` | Render everything and export WAV/OGG by category with manifests |

## Scope (v0.1)

- Mono output. Synthesis is pure JavaScript and needs nothing installed. ffmpeg is needed only to read non-WAV files or write OGG.
- Loudness matching uses gated RMS (dBFS), not full LUFS, which is appropriate for short sounds.
- AI-generated sound effects are not included.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the sounds you import. Writes only to the output folder in the workspace.
- ffmpeg (optional) is called with argument arrays, without a shell. No hooks.

## Build and test (developers)

- Source: `ui-plugins/game-sfx-pack/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-game-sfx-pack test` and `test:e2e`.
- `E2E_SFX` can point to real recordings. We used two public-domain rain recordings from Wikimedia Commons.

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`. ffmpeg is not bundled.
