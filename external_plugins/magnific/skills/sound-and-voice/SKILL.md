---
name: sound-and-voice
description: Create and finish sound with Magnific - voiceovers and narration, character dialogue, lip-sync to an existing shot or a still, music beds and jingles at a given BPM and length, sound effects and ambiences, scoring a cut, voice changing, cleaning a recording, mixing tracks and delivering WAV stems. Use it whenever the user wants Magnific to make or change a voice, VO, narration, dialogue, lip-sync, talking head, music, soundtrack, jingle, SFX, Foley, ambience or audio mix, alone or for a video.
---

# Sound and voice

Sound sells the picture, and it is where AI assistants under-deliver: random voices, music that ignores the cut, and everything baked into one track the editor cannot mix.
Professionals want a directed performance, music that fits the length and tempo, and separate stems.

Follow `magnific-essentials` for pricing, project folders, waiting and delivery.

## 1. Pick the path for speech

| Situation | Path |
|---|---|
| New video where people speak | A native-audio video model; lines in quotes after the speaker (see `cinematic-shots`) |
| Voiceover or narration over picture | `audio_tts`, then `video_audio_mix` |
| An existing shot that needs a line lip-synced | `audio_tts` (or the user's recording), then `video_speak` with `videoUrl` and `audioUrl` |
| A still portrait that should talk | `audio_tts`, then `video_speak` with `imageUrl` and `audioUrl` (talking head) |
| One voice that must stay identical across several clips | `audio_tts` with one `voiceId` per character, then `video_speak` per clip |
| Keep a recorded performance, change the voice | `audio_voice_change` |
| Translate and revoice a short finished video | Transcribe it (the user's script, or `video_analyze`), translate, `audio_tts` in a native voice for that language, then `video_speak` with `videoUrl` and `audioUrl`; have a native speaker review the lines before the paid steps |

`video_speak` is for an exact voice or a supplied track; read `video_speak_models_list` for which models take an image or a video and their audio limits.
Before lip-syncing to an existing shot, make the dialogue track exactly the shot's length (pad with silence before and after the line, where it should start and end; trim if it runs long), so the synced shot keeps every frame and the stem drops into the timeline in sync. In a coding agent that is one ffmpeg command; otherwise generate the line shorter than the shot and say where it starts.

## 2. Voice: cast, direct, then generate

1. **Cast.** `audio_voices_list` with a `search` built from the brief (age, gender, accent, texture, use: "old male gravelly", "warm female narrator british", "young energetic spanish"). Choose from what returns and say why; never take the first voice blindly. Cloned voices are `source: mine`. In chat apps with widgets, `audio_voices_show` lets the user pick.
2. **Read the notation.** Call `audio_tts_direction` with the model you will use before writing `text`; each model reads cues differently:
   - `eleven_v4` (default): inline tags that describe something heard, which can be chained: `[tired, low voice] The light has never gone out... [pause 1s] Not once in forty years.`
   - `eleven_v3`: one short tag per phrase.
   - `eleven_turbo_v2_5`: only `(pause 1s)` works; any other bracket is read aloud.
   - Gemini TTS: put the overall performance note in `systemInstruction`, short cues inline.
   - `seed_audio_1_0`: a scene script with speakers described in prose; only quoted text is spoken; no `voiceId`; `maxDuration` required.
3. **Write to time.** About 2.5 words per second for VO, closer to 2 for a slow, tired or whispered read, and every pause tag adds its length; leave air for the picture. Ellipses add weight; capitals add emphasis.
   When the line must fit a shot, count it before generating and trim the words or the pauses until it fits, so the first take lands; if a take still overruns, shorten the text rather than paying for takes until one fits.
4. **Generate.** `audio_tts` with `text`, `voiceId` (an integer), and `model` if not the default. Two-person dialogue: `speakers` with exactly two voices from the same provider.
5. Lower `stability` (about 0.3) when tags are not landing; raise it (0.7) for flat, consistent reads such as e-learning.

`audio_timing_get` returns word timings of a generated voice, useful to cut picture to the words or to place captions.

## 3. Music

- Standalone track: `audio_music_generate`. Describe genre, mood, instrumentation, tempo in BPM, structure and ending ("instrumental, 120 BPM electro-house, hard kick on the first beat, no intro, button ending at 15 s").
  Length: `google-lyria` and `google-lyria-3` are a fixed 30 s; `google-lyria-3-pro` 30-180 s; ElevenLabs models 10-300 s with `durationSeconds` and `instrumental: true` to drop vocals. Pick the model that can hit the cut's length.
- Scoring an existing cut: `video_music` analyzes the clip and fits the music to it; `mixMode` decides the original audio: `none` keeps it, `lower` ducks the music under it (dialogue, VO), `remove` replaces it.
- Avoid named artists or copyrighted songs in prompts; describe the sound instead.

## 4. Sound effects and ambience

- `audio_sfx_generate` for one-shots and beds: name the source, surface and perspective ("single heavy wooden door slam, interior stone room, close mic"), 1-3 s for one-shots, up to 30 s, `loop: true` for continuous ambience (rain, wind, room tone), `variations` 2-4 for sounds that repeat.
- `video_soundfx` reads the picture and adds matched effects to the clip itself; steer with a prompt only if needed.

## 5. Clean and separate

- `audio_isolate` keeps only the voice of a recording (needs at least 4.6 s); `video_audio_isolate` keeps one described sound from a clip's track.
- `audio_clean_speech` denoises and normalizes speech (target loudness `targetLufs`, default -19). If it fails, fall back to `audio_isolate`.
- `video_extract_audio` pulls a clip's track as MP3 (free).

## 6. Mix and deliver stems

- `video_audio_mix` lays one audio creation over a video (free): `videoVolume` and `audioVolume` 0-100, or mute either. Layer more tracks with successive mixes, VO last.
  Typical starting levels: dialogue or VO 100, music 25-35 under speech, ambience 30-50.
- Editors and mixers want stems: deliver each element on its own with `creations_deliver` profile `wav_48k` (dialogue, music, effects, ambience), plus the mixed picture if asked.
- Lip-synced shots for an edit: deliver `prores_422hq`.
- Say what you could not verify by ear (sync, pronunciation, level balance) and suggest the user listens before locking.
