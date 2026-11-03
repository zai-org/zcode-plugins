---
name: video-finishing
description: Finish and deliver video with Magnific - upscale to 2K or 4K, SDR to HDR, LUT and manual color grades, matching a look, relighting, cleaning up or changing existing footage (remove text, logos and objects, swap elements, restyle), reframing for other aspect ratios, retiming, extending, joining, cutting out the subject, and rendering ProRes, DNxHR or PNG sequences for the edit. Use it for any request to improve, fix, grade, upscale, reformat, clean up or deliver a clip that already exists.
---

# Video finishing

Finishing is where generated footage becomes a deliverable.
Professionals expect three things: changes to existing footage keep everything they did not ask to change, steps run in an order that protects quality, and the master arrives in their pipeline's format.
Finishing tools also bill per second of footage, so a duplicate call is expensive: a 4K upscale is among the priciest calls there are.

Follow `magnific-essentials` for pricing, project folders, waiting and delivery formats.

## 1. Read the source first

Find the clip (`creations_search` in the project) and read `video_metadata` (duration, resolution, fps, audio) before choosing anything.
Several tools cap input at 20 seconds and 200 MB (`video_color_grade`, `video_color_transfer`, `video_vfx`, `video_motion_shake`, `video_remove_background`); `video_relight` processes at most 240 frames.
For a longer clip, cut it into parts with `video_cut` (free), finish each, and join them with `video_concatenate`.

## 2. Order of operations

1. Fix and change content: `video_modify` (clean-ups, swaps, restyles), `video_relight`, `video_remove_background`.
2. Edit: `video_cut`, `video_speed`, `video_extend`, `video_concatenate`, `video_magic_cut`.
3. Reframe: see section 6.
4. Grade: `video_color_grade` or `video_color_transfer`.
5. Upscale: `video_upscale` (resolution, fps, detail).
6. HDR: `video_hdr`, only when an HDR master is asked for.
7. Deliver: `creations_deliver`.

Why this order: generative steps (modify, relight, reframe) regenerate pixels, so anything done before them is lost; grading at the source resolution is cheaper and stays inside the 20 s / 200 MB caps; upscaling last means the final pixels carry the final grade.
Say so if you change the order for a reason.

## 3. Upscale

- Read `video_upscale_models_list` first: it lists the modes (`topaz`, `magnific`, `magnific_precision`), required parameters and ranges.
- Topaz: faithful resolution and fps work; set `targetResolution` as a pixel width (3840 for UHD 4K) or `upscaleFactor`, and an `enhancementModel`; frame interpolation for fps changes.
- Magnific modes: generative detail (`magnificResolution` up to `4k`); precision mode stays closer to the source, which suits locked, approved shots.
- Price it with `simulate_cost` (it bills per second), and call it once. If the call is slow to return, wait on the creation; never re-send it.

## 4. Color

- `video_luts_list` gives catalog LUT ids; `video_color_grade` applies one (`lutId`, `intensity` 0-100) and/or manual `adjustments` (exposure, contrast, saturation, temperature, tint, hue).
  Teal and orange, bleach bypass, warm film and similar looks map to catalog LUTs; soften with `intensity` around 60 to 85 and trim with adjustments.
  A LUT named for one half of a look may need the other half added: for teal and orange, warm the skin and highlights with a small positive `temperature` if the LUT only pushes teal.
  Check one graded frame (`video_extract_frames`, free) before paying for the upscale, and judge it against the look, never against the LUT's name: teal and orange means shadows and sky toward teal, skin, highlights and warm surfaces toward orange, with visible separation between them. A frame that shows only a contrast or saturation lift is not the look yet.
  Compare candidate LUTs on the same frame side by side, pick by what the frame shows, trim with `temperature`, `tint` and `intensity`, and describe the delivered look by what the frame shows.
- `video_color_transfer` matches a clip to a reference still (the approved frame, a film still): best for continuity across shots.
- Grade every shot of a sequence with the same LUT and intensity, then adjust exposure per shot, so the cut matches.

## 5. Change existing footage

- `video_modify` edits footage from a prompt while keeping its motion: remove text, logos, people or objects, swap an element, change wardrobe or weather, restyle.
  Read `video_modify_models_list` for models and resolution ladders, or omit `slug` for auto.
  Write it like an edit order: the exact change, then a preservation list ("keep the performers, their motion, camera path, timing, lighting and grade unchanged").
- Motion transfer (a new character or outfit doing exactly what the source performer does) needs a motion-transfer model through `video_generate`, when the user's `video_models_list` lists one; otherwise use `video_modify` and say the motion may drift.
- `video_camera_angle` re-shoots a clip from another camera position; it regenerates the footage, so it is not a crop.
- `video_relight` changes lighting with 1 to 4 lights or copies the light of a reference image.
- `video_remove_background` cuts out the subject with real alpha (VP9 webm by default); deliver `prores_4444` for compositing.
- Consent: do not swap or recreate a real person's face or voice without the user confirming they have the rights.

## 6. Reframe, retime, join

- To reframe to another aspect ratio, deliver the master (`prores_422hq`) for a reframe in the editor, or re-render an approved generated shot at the new ratio with its first frame as the start frame (`cinematic-shots`), and tell the user which you did.
- `video_zoom` is a free center punch-in or Ken Burns; it keeps the aspect ratio, so it does not reframe.
- `video_speed` with `speedFactor` is free (constant speed); `preset` ramps cost credits. Slow motion below about 0.5x duplicates frames; for real slow motion, upscale with frame interpolation to a higher fps instead.
- `video_cut` trims free. `video_concatenate` joins completed clips (2-10) as a straight cut, free, keeping each clip's audio. `video_magic_cut` generates transition frames so joins blend (paid).
- `video_extend` adds new footage after the last frame, with a prompt for what happens next.
- A Seedance clip made at resolution `Draft` becomes its 1080p final with `video_finalize_draft`: the same shot, not a new generation. Never use `video_generate` to "upgrade" a draft.

## 7. Deliver

- Editorial: `prores_422hq` (Resolve, Premiere, Final Cut), `dnxhr_hq` (Avid), `prores_4444` with alpha, `png_sequence` for VFX.
- Review and social: `h264`, or `hevc_hvc1` for Apple.
- `maxHeight` caps a render at 720 or 1080 for proxies.
- Rendered video carries provenance metadata (creation, model, prompt, date), which studios' legal teams ask for.
- Deliver only after every step has completed; the reply lists each step, the settings used, the credits per step, and the final file link.
