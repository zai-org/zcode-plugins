---
name: cinematic-shots
description: Generate film-quality shots and sequences with Magnific - hero shots from an approved keyframe, b-roll and establishing shots, documentary footage, image-to-video, multi-shot scenes, extensions, blocking or 3D previs turned into final renders - choosing the right model, resolution and camera language for each shot and staying inside the budget. Use it for any request to generate, animate, extend or re-render a shot, scene, clip or sequence for a film, series, documentary, music video or brand film.
---

# Cinematic shots

A director judges a shot on three things: does it honor the approved frame, does the camera move with intent, and does it cut with its neighbours.
A producer judges it on a fourth: what it cost.
This skill gets all four right with Magnific's video tools.

Follow `magnific-essentials` for pricing, project folders, waiting and delivery.
Read [video-prompt-craft.md](../magnific-essentials/references/video-prompt-craft.md) before writing the first prompt; it has the model limits, reference rules and camera vocabulary this skill relies on.

## 1. Start from what is approved

- Find the user's approved frames and clips in their project with `creations_search` (by `query` and `reference`, or `folderReference`) before generating anything new.
- An approved keyframe goes in `keyframes.start` as its creation identifier; that is what makes the shot match the boards.
  On Seedance 2.x and MiniMax H3 a start frame excludes visual references, so the frame itself must carry identity and set; restate them in words.
- A recurring character or location belongs in the library; see `consistent-characters`.
- With no approved keyframe, a scene with people or a fixed place still starts from images: build character sheets, a location plate and key-prop images before the first video call and pass them as references (`scene-direction`, "Build references before the scene").
- Blocking, a grey-box 3D render or a rough edit can drive the final: pass it as a `video` reference and open the prompt with "the reference video fixes layout, blocking, camera path and timing; follow it exactly", then describe the final look.

## 2. Choose model and resolution per shot

| Shot | Model | Resolution |
|---|---|---|
| Hero, festival or client-final, dialogue, complex motion | `bytedance-seedance-pro-2.5` | 1080p for the final master |
| Hero shot still being explored, with someone to review takes | same model | `Draft`; `video_finalize_draft` renders the approved take at 1080p, at more than a direct render costs (see `magnific-essentials`) |
| B-roll, establishing, inserts on a budget | `kling-26`, `kling-30` or `kling-25`; price them, and for silent b-roll try the cheapest first | 1080p |
| Animatic, motion test, timing check | `minimax-video-3_0-max-turbo` | 480p or 768p |
| Keep real footage's motion, change the subject or look | A motion-transfer model when `video_models_list` lists one, otherwise `video_modify` | per catalog |

Read `video_models_list` before deciding: recommendations change, and private entries are not for general use.
Price with `simulate_cost` before every shot, and price the whole list against any budget the user gave before generating the first clip.
Model and resolution change the price many times over, so price each combination you are weighing.

## 3. Write the shot like a camera report

For scenes with characters, dialogue, action or several shots, write the prompt with the structure in `scene-direction` (scene blocks in shot 1, anchors and start and end states in every shot).
The camera report below is the minimum for a single shot.

Header line: duration, aspect ratio, style as a cinematography note (lens feel, film stock or grade, era).
Then the shot: framing, ONE camera move with its start and end, ONE action with weight and contact, motivated light, the environmental force (rain, wind, smoke, moving light), and sound.
Above 8 seconds, timecode the beats (`0-3s / 3-6s / 6-8s`) and end on a small continuing action under the last beat (the steam keeps rising, he keeps wiping the counter) so the editor has a usable tail that does not freeze.

Example for an approved keyframe of an old keeper lighting a match:

> 8 s, 16:9. Low-key storm drama, 35 mm anamorphic feel, deep shadows, warm practical light against cold blue night.
> 0-3s: slow push in from medium to medium close-up on the keeper as the match flares; rain streaks the lamp-room glass behind him.
> 3-6s: he lifts the flame to the wick; the great lens catches it and warm light blooms across his face and the brass.
> 6-8s: the beam ignites and sweeps out through the glass; the camera keeps drifting in slowly as the beam sweeps on.
> Sound: storm wind, rain on glass, the match strike, the low hum of the lamp; no music, no dialogue.

## 4. Sequences

- Up to 30 seconds and 6 shots, Seedance 2.5 renders a whole scene in one call with `multi_prompt` (each shot with `index`, `prompt`, `duration`, summing to `duration`).
  One call keeps faces, wardrobe, voices and sound consistent across cuts, so prefer it to separate clips when you are not anchoring each shot on its own keyframe.
- Longer pieces: one clip per shot or scene, then `video_concatenate` in order. Repeat the continuity anchors (identity and wardrobe, set geography, light direction, screen direction, ambience) word for word in every prompt.
- In a `multi_prompt` call, repeat the camera rules, one performance line, identity, wardrobe and light in every shot prompt; see [video-prompt-craft.md](../magnific-essentials/references/video-prompt-craft.md) section 6.
- To continue a shot past its last frame, use `video_extend` with what happens next, or take the last frame with `video_extract_frames` (`["last"]`) as the next clip's start frame. Never pass the source clip as a reference to continue it.

## 5. Batches

Shot lists of 5, 20 or 50 clips are normal for productions.
- Price one, multiply, and confirm the total against the budget before starting.
- Run in small waves (two to four video jobs at a time) and wait for each wave; the account has a video concurrency cap, and a rejected call says how long to wait before retrying.
- Keep a running tally of credits and report it.
- For a list the team will re-run with new inputs, suggest a Space (`guides_get` with `spaces`) so the pipeline is reusable.

## 6. Silent or with sound

Documentary b-roll and shots going to an editor with their own music usually want no score: on native-audio models pass `noMusic: true` for ambience only, or leave `withSoundEffects` off for silence when the model allows it.
Say which you chose.
Dialogue, Foley and music are covered in `sound-and-voice`.

## 7. Fights and physical action

Any fight, brawl, scuffle or combat beat: follow `fight-scenes` for the choreography and coverage, and this skill for model, resolution, pricing and delivery.

## 8. Deliver to post

- Editors want `prores_422hq` (`creations_deliver`); Avid wants `dnxhr_hq`; VFX wants `png_sequence`.
- Upscale or HDR the approved take only (`video-finishing` covers order and settings).
- Name what you made by shot number in the reply, with its link, model, resolution, duration and cost, so it drops straight into the edit.
