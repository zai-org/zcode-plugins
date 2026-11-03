# Video prompt craft for Magnific

Read this before writing a `video_generate` prompt.
Model limits change: `video_models_list` is the truth when it differs from this file.

## Contents

1. Choose the model by the job
2. Fit the call to the model
3. The universal prompt
4. References and keyframes
5. Audio inside the clip
6. Multi-shot and longer pieces
7. Continuity across clips
8. Fixing a bad result
9. Family notes
10. Lens, depth and film look

## 1. Choose the model by the job

| Job | Good first choice | Why |
|---|---|---|
| Hero shot, final quality, references, dialogue | `bytedance-seedance-pro-2.5` (catalog `sota`, rank 1) | Best realism, motion and native audio; 4-30 s; up to 6 shots in one call |
| Same Seedance controls, cheaper | `bytedance-seedance-fast-2.0` (720p, 480p) | Fast drafts with native audio and references |
| Quality-per-credit silent clips, start/end frames | `kling-25`, `kling-30` | About a tenth of Seedance 2.5 1080p per second |
| Cheapest motion and staging drafts | `minimax-video-3_0-max-turbo` (480p, 768p) | Blocking, timing and animatics |
| Drafts that need image, video or audio references | `minimax-video-3_0-max` | References at draft prices |
| Keep a video's motion, change who or what is in it | A motion-transfer model when the catalog lists one, otherwise `video_modify` | Motion transfer and edits of real footage |
| Designed motion graphics, kinetic type, logo stings | `video-motion-1` when the catalog lists it for the user | Authored as code, frame-exact; not footage |

Read `agentRecommendation` in the catalog for the current ranking; it moves as models ship.

## 2. Fit the call to the model

- Copy `slug`, `aspectRatio`, `resolution` and a listed `duration` verbatim from the model's entry.
  Leave out any field the entry does not list (`cameraMotion`, `looks`, `negativePrompt`, `noMusic`, `fps`, `multi_prompt`).
- Duration limits differ: Seedance 2.5 4-30 s; Seedance 2.0 family 4-15 s; Kling 3.0 3-15 s; Kling 2.5 and 2.6 5 or 10 s; Veo 3.1 4, 6 or 8 s; MiniMax H3 Max 5-15 s.
- Aspect ratios differ: Kling and Veo offer only 16:9, 9:16 (and Kling 1:1); no video model offers 4:5 (Seedance offers 3:4).
- Default Seedance to 720p unless the user asked for final 1080p; it is about 2.5 times cheaper.

## 3. The universal prompt

Write in English.
Order: style and mood -> subject and setting -> ONE physically plausible action -> camera (shot size, angle, one movement with a start and an end) -> lighting and atmosphere, with one environmental force (wind, water, moving light) -> audio, when the model has audio.

- One action and one camera move per beat; never "static camera" and "orbit" in the same window.
- Grounded motion beats emotion labels: weight, contact, breath, a held beat.
- Above about 8 seconds, write timecoded beats: `0-3s: ... / 3-7s: ... / 7-10s: ...`, and end on a small continuing action under the last beat instead of a frozen hold.
- Camera vocabulary that lands: locked frame, slow push in, pull back, pan, tilt, human-height tracking, orbit with a set arc, crane with start and end, handheld micro-drift, whip pan, dolly zoom; low, high, overhead, POV.
- For stability say "fixed camera; no push, pan or drift". Inside a risky move, guard what matters: "during the arc, the bottle's label and cap stay exactly as in the product reference".
- Light by source, direction and quality, motivated by something in frame ("the match flame lights his face from below").
- Negatives in prose, aimed at real failures: no duplicate faces, no invented dialogue, no unrequested text, logos or subtitles, no product deformation.

## 4. References and keyframes

- `keyframes.start` (and `keyframes.end` where allowed) take `{type: "image", url: <creation identifier or asset URL>}`; never a `webUrl`.
- `references[]` items:
  - a creation: `{type: "image" | "video" | "audio", url: <creation identifier or asset URL>}`
  - a library asset: `{type: "character" | "product" | "style", custom_model_id: "<library_list id>", name: "<name>"}` with no `url`.
  Library locations are not video references; render the location with `images_generate` and pass that image.
- With a start frame, the clip inherits the frame's aspect ratio on Seedance; read the image's size with `creations_get` instead of guessing a ratio, and describe the move from the frame's actual framing.
- Seedance 2.x and MiniMax H3 cannot combine keyframes with visual references: with a start frame, only `audio` references are allowed.
  So choose: either an approved still as `keyframes.start` (the still already carries identity and product), or references with a text-to-video prompt.
- Give every reference one job and name it in the prompt, in array order: "The first image is the lead's identity sheet; the second is the product, keep its label exact".
- Seedance blocks realistic human faces in uploaded photos and videos; warn the user before they upload real people.

## 5. Audio inside the clip

- Models with native audio (Seedance, Veo, Kling 2.6/3.0) make sound with the picture.
  Pass `withSoundEffects: true` unless the user wants silence; `noMusic: true` keeps dialogue and effects but drops the score.
- Dialogue: quote every line, attribute it to its speaker with delivery ("she says quietly, amused: \"...\""), one speaker per beat, about 4 syllables per second of screen time.
- An exact voice, a supplied recording, or one voice across several clips: generate silent or with ambience, then `audio_tts` plus `video_speak`.
- A Seedance `audio` reference guides rhythm, mood and voice; it does not paste the audio in or clone the voice.

## 6. Multi-shot and longer pieces

- A model with `multishot.allowed` takes up to 6 shots in one call via `multi_prompt` (each `{index, prompt, duration}`; Seedance needs `duration`, shot durations sum to `duration`).
  One call keeps characters, voices and sound consistent across cuts, so prefer it over separate clips up to the model's maximum.
- Each shot prompt is read on its own, so repeat in every shot the rules that must hold everywhere: the camera rules (for example "three-quarter angles, never straight-on"), one performance line (natural, breath before each line, small reactions), identity and wardrobe, and the light. A rule stated only in shot 1 is often lost by shot 3.
- When the protagonist must stay readable, keep them in every shot; a point-of-view insert or a cutaway without them is where viewers lose track and identity drifts.
- Beyond one call's maximum: plan the clips (`video_plan` helps on plans that include it), generate each, then `video_concatenate` 2-10 completed clips in playback order.
  Concatenation keeps each clip's own audio; lay a continuous music or VO bed afterwards with `video_audio_mix`, or score the joined cut with `video_music`.

## 7. Continuity across clips

- Repeat the anchors verbatim in every clip: identity and full wardrobe, location geography and prop positions, time of day and light direction, screen direction, ambient sound bed.
- To continue a clip, use `video_extend`, or take its last frame (`video_extract_frames` with `["last"]`) as the next clip's `keyframes.start`.
  Never pass the source clip as a reference to continue it.
- A start frame drops identity references on Seedance and H3, so restate identity in the prompt.

## 8. Fixing a bad result

Change one thing per paid retry, aimed at the visible failure:

| Failure | Fix |
|---|---|
| Floating, weightless bodies | Describe weight transfer and contact with the ground or object |
| Stiff cloth, hair, water | Name one force acting on several elements (wind from the left) |
| Overacting | Breath, micro-actions, a held beat |
| Camera flies around | Constrain pace and give the move an endpoint |
| Identity or product drifts | Repeat anchors; add a guard inside the move; use a sheet or macro reference |
| Thin, fake soundstage | Name the environmental force and room tone |
| Motion freezes mid-air or a beat plays as a still | Remove freeze language such as "hangs in the air for an instant"; describe the motion as an event with weight and timing ("the noodles arc up and drop back into the wok") |

Never regenerate a result nobody has looked at, and never retry automatically.

## 9. Family notes

- Seedance 2.5: prompts up to 30,000 characters; header (duration, ratio, style as a cinematography note, reference contract, audio policy), then timecoded body, then a footer with failure-specific negatives and an ending that keeps a small action moving. No `seed`.
- Kling: cinematic descriptive prose; prompts up to 2,500 characters; `kling-25` at 720p requires `keyframes.start`; Kling 3.0 references require a start frame.
- Veo 3.1: rich detailed prompts, explicit camera grammar, ambient sound first then dialogue in quotes; 4, 6 or 8 seconds; 16:9 or 9:16.
- MiniMax H3: good for exploring motion and staging cheaply; H3 Max Turbo takes no references.
- `video-motion-1`: write a design brief, not a scene: intent -> copy in quotes -> timecoded beats -> motion -> look -> assets; never ask it for photoreal people or camera moves through a 3D world.

## 10. Lens, depth and film look

Generators obey visual evidence, not lens names: write what the lens does to the picture.

- **Lens by job, given to video models as field of view in degrees:** establishing and locations 84° (24 mm), a location with one hero object 63° (35 mm), tight interiors 57° (40 mm), dialogue and performance 47° (50 mm), close-ups and inserts 29° (85 mm). Never put a face on a wide lens; it stretches. Add "lens locked for the whole shot" so the framing does not drift into a zoom.
- **Make depth physical:** name one focus target, put the camera within a few metres of it, say the aperture is fully open, and name the layers that go soft. Without a named focus target the frame renders sharp everywhere.
- **Anamorphic signature as objects:** "elongated vertical oval highlights on [a named surface]" and "a thin horizontal streak flare off [a named light in frame]", warm off tungsten or fire, cool off LED or daylight. No light in frame, no flare.
- **Film look without brand names:** describe stock by balance and speed (tungsten-balanced high-speed colour negative for night, daylight-balanced medium-speed for day), plus grain and highlight roll-off. Camera, lens and film brands pull in logos and unrelated imagery.
- **Anchor the camera:** one side, one height, one direction ("three-quarter angle from the left of the counter, lens at seated eye height, looking diagonally across"). The diagonal is what makes depth read.
