---
name: consistent-characters
description: Keep the same character, actor, mascot, product or location recognisable across many Magnific images and videos - character sheets, library assets, reference wiring per model, lookbooks, episodes and campaigns. Use it whenever a person, character, product or place must look identical in more than one output, or the user mentions consistency, continuity, the same face, the same outfit, a recurring character, a mascot, a cast, a lookbook or a series.
---

# Consistent characters, products and locations

Consistency is the most requested capability from both film studios and agencies, and the most common reason they leave a tool.
Words alone never hold a face or a product across outputs; references do.
The method: build one strong reference per recurring subject, store it, and pass it on every generation where that subject appears.

Follow `magnific-essentials` for pricing, project folders and waiting.

## 1. Check the library first

`library_list` returns the user's saved characters, products, locations and styles.
A saved asset is the best anchor there is: use it by its numeric `id`.
- In `images_generate`: `{type: "character" | "product" | "locations", identifier: "<id>"}`; the prompt may also mention it as `@<name>` where it appears.
- In `video_generate`: `{type: "character" | "product" | "style", custom_model_id: "<id>", name: "<name>"}` with no `url`. Locations are not video references; render the place as an image and pass that image.
A library id is never a creation identifier, and a creation identifier is never a library id; mixing them up fails with "creation not found".

## 2. No asset yet: build the reference

**Characters.** One character sheet image, no text, labels or annotations:

> Character reference sheet. No text, no labels, no annotations. White neutral background. Studio lighting. Consistent character appearance across all panels.
> LEFT HALF: full body front view, full body back view, face close-up.
> RIGHT HALF: [up to 5 details by priority: distinctive features, hands, signature prop, clothing details, hair, accessories].
> [Full physical description: age, build, skin tone, face shape, hair, eyes, wardrobe with colors and materials.]

Use a high-consistency model (Seedream 5 Pro, or Flux Kontext Max) at 16:9 for detailed sheets, 1:1 for simple characters.
If the user has photos or approved frames of the character, pass them as `image` references to the sheet.
When the sheet is approved, `library_create` with `type: "character"`, a name (letters, digits, `_`, `-`), a description, and 1 to 6 images (the sheet first, plus any approved stills).

**Products.** The user's real product photos are the reference; never redraw a product from words.
Several angles plus a macro of the fragile detail (cap, hinge, logo, texture) hold best.
Save with `library_create` `type: "product"` when it will recur.

**Locations.** One establishing image with no characters: "[Place]. [Time of day and light]. [Atmosphere]. Establishing shot, static camera, no characters, no text."
Reuse it as an `image` reference everywhere the scene is set; save it as `type: "locations"` for image work.

`images_variations` (modes `angles`, `expressions`, `age`, `demographics`) turns one approved image into a grid of consistent variations, each its own creation; useful for turnarounds and expression sheets.
`images_split_grid` cuts any grid image into separate creations, free.

## 3. Generate the set

- Pass the reference on EVERY output where the subject appears, not only the first.
- Keep one model and one aspect ratio across a set; a different model renders the same reference differently.
- Describe what changes (setting, pose, light, expression, action) and let the reference carry identity.
  Do not re-describe the face in new words; conflicting descriptions pull the model away from the reference.
  Do repeat wardrobe and signature props briefly, because they are what audiences track.
- Several subjects in one image: pass each reference and say in the prompt which is which ("the first reference is Mara, the second is the keeper; Mara stands left").
- Different setups are different calls (one prompt each); variants of one setup are one call with `count`.
- Make one image per setup unless the user asks for options; then review every image and redo the off-model ones (see section 5). Unreviewed extra takes waste credits; a targeted redo after review is the job.
- Run independent setups in parallel and wait on them together.

## 4. In video

- With Seedance 2.x and MiniMax H3, a start frame excludes visual references.
  For identity, either start from an approved still that already shows the character (then restate identity in words), or skip the start frame and pass the character as a reference.
- Kling 3.0 references require a start frame; Kling 2.5 and the Veo Fast/Lite models take no references at all.
- Across clips, repeat the continuity anchors word for word: identity and full wardrobe, location geography, light direction, screen direction.
- One voice across clips needs `audio_tts` with one `voiceId`, then `video_speak`; native audio models re-invent voices each call.

## 5. Check and fix

If your client can show you the images, compare each one with the character reference feature by feature: face, hair length and shape, wardrobe and its colour, accessories, apparent age. Write down what differs; a set is consistent only when nothing on that list differs.
If you cannot see pixels, say what you could not verify, and invite the user to flag drift.
When a result drifts:
- re-anchor on the original reference, never on a drifted output;
- add the drifted feature to the prompt as a lock ("same short dark curly hair, same oxblood suit");
- switch to a stronger reference-capable model after one failure instead of repeating the same call.

## Rights

Use only characters the user owns or has rights to.
Do not reproduce real people, celebrities or a specific creator's likeness without consent; Seedance also blocks realistic human faces in uploaded photos and videos.
