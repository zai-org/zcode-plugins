---
name: previs-storyboard
description: Turn a script, scene, treatment or idea into a shot list, storyboard frames and a timed animatic with Magnific - consistent characters and locations, one visual style across frames, cheap draft motion for timing, and a board the team can review. Use it for previs, pre-vis, storyboards, shot lists, animatics, lookbooks of a scene, pitch boards and "visualize this script" requests from filmmakers, agencies and studios.
---

# Previs and storyboards

Previs exists to make decisions cheaply: framing, coverage, pacing and continuity, before anyone pays for final shots.
So the craft here is clarity and consistency at low cost, not polish.
The output is a shot list the crew can read, frames that look like one film, and an animatic that plays at the right length.

Follow `magnific-essentials` for pricing, project folders and waiting.

## 1. Shot list first, in text

Break the scene into beats (setup, turn, payoff), then shots.
One numbered table: `# | dur | size and angle | camera move | action | dialogue or sound | notes`.
- Sizes: EWS, WS, MS, MCU, CU, ECU, insert, OTS, POV.
- Moves: locked, push in, pull back, pan, tilt, track, crane, handheld, orbit (with an arc).
- Keep screen direction and eyelines consistent; flag any line cross.
- Durations should add up to the scene's page time (about one minute per script page).
Show the table before generating anything; it is the contract for everything after it. Save it in the project too (an uploaded text or image sheet), so the crew finds it next to the boards.

## 2. Cast and sets before frames

Consistency across frames comes from references, not from repeating adjectives.
- Look for existing characters, products and locations with `library_list`. Use a library asset by its numeric `id`: `{type: "character" | "product" | "locations", identifier: "<id>"}` in `images_generate`.
- A character without a library entry gets a character sheet first (see `consistent-characters`), then `library_create` if it will recur.
- A recurring location gets one establishing frame with no characters ("[Location]. [Time of day and light]. [Mood]. Establishing shot, static camera, no characters, no text."), reused as an `image` reference for every frame set there.

## 3. Frames: one model, one ratio, one style

- Pick one image model and keep it for the whole board; switching models mid-board breaks the look.
  For clean boards, a fast reference-capable model is enough (check `images_models_list`; Seedream 5 Pro is the general default, Nano Banana 2 Lite is the cheapest draft option).
- One aspect ratio for the board: the delivery ratio (16:9 or 21:9 for cinema, 9:16 for vertical).
- Write a style line once and paste it into every frame prompt: "Storyboard frame, painterly digital sketch, muted palette, clear silhouettes, cinematic lighting, no text, no panel borders."
- Each frame prompt: shot size and angle, who is where, the action at that instant, light. Pass the character and location references on every frame where they appear.
- Generate frames for different shots in parallel calls, then wait on all of them together.
- Cheaper rough option: one image laid out as a 2x2 or 3x3 storyboard grid, then `images_split_grid` to cut it into frames (free). The style is very consistent; the resolution per frame is lower.
- `images_variations` with `variationMode: "storyboard"` turns one frame into a grid of related shots; useful for coverage ideas.

## 4. Animatic: cheap motion, right timing

In a coding agent the cheapest useful animatic is the boards themselves, timed to the shot list with simple push and pan moves, a burned-in timecode and temp sound, built locally with ffmpeg and uploaded: it costs nothing and is what an editor needs to check timing.
Animate on a draft model only the shots whose camera or character motion must be seen, as below.

- Animate each frame as its own short clip with the frame as `keyframes.start`, on a draft model at low resolution: MiniMax H3 Max Turbo (480p/768p, 5-15 s) or Kling 2.5 (5 or 10 s).
  Do not use Seedance 2.5 at 1080p for previs; it costs many times more per second and the frames will be redrawn anyway.
- Clip duration = the shot's duration from the list. Draft models have minimum lengths (MiniMax H3 is at least 5 seconds), so generate the nearest allowed length and trim each clip to its planned length with `video_cut` (free) before joining.
- Prompt only the camera move and the main action; the frame carries the look.
- Price one clip, multiply by the shot count, and stay within the budget; run two to four clips at a time.
- `video_concatenate` the completed clips in shot order.
- Optional scratch audio for timing: a temp VO with `audio_tts` or a temp music bed with `audio_music_generate`, laid with `video_audio_mix`. Say it is temp.

## 5. Working from reference footage

`video_analyze` with `mode: "shot_breakdown"` returns structured shot data (shots, sizes, moves, timing) for 1 to 10 clips, free.
Use it to turn a reference film, a mood reel or the team's own blocking into a shot list to rebuild.

## 6. Hand-off

- Save everything in the production's project (`folderReference` on every call).
- The reply contains the shot list, the frames in order with links, the animatic link and its running time, the credits spent, and the decisions the director still has to make (lens, coverage, anything you assumed).
- For team review, follow the review rule in `magnific-essentials`.
- When the board will be iterated by several people or re-run with new inputs, offer to build it as a Space (read `guides_get` with `spaces` and `spaces-story`), which keeps characters, locations and frames wired together.
- Moving from previs to finals: re-render only approved shots with `cinematic-shots`, using the approved frames as start frames.
