---
name: precise-image-edits
description: Edit an existing image with Magnific while keeping everything else intact - remove or replace an object, change a product, color, expression, wardrobe or text, extend the canvas, relight, fix skin, swap a background - on approved art, photos and frames. Use it for every "change only X", "remove this", "replace that", "keep everything else the same", "fix this image" or "don't regenerate it" request, and before touching any image the user calls approved or final.
---

# Precise image edits

On an approved image, the client paid for every pixel they did not ask you to change.
The most damaging habit with AI tools is "editing" by regenerating the whole image: faces shift, products move, label text breaks.
Caption-style edit prompts ("..., preserving all original elements") re-stage the whole image and break label text.
So pick the most local tool that can do the change, and write edit prompts as instructions that lock first.

Follow `magnific-essentials` for imports, pricing, project folders and waiting.

## 1. Find the source

Locate the exact image (`creations_search` in the project, or the identifier the user gave) and edit that one.
If the user refers to "the image" after you delivered a result, they mean your latest result.
Iterations build on the last accepted version; parallel alternatives all start from the original.

## 2. Pick the most local tool

| Change | Tool | Notes |
|---|---|---|
| One object or region (replace, remove) | `images_segment` then `images_retouch` | Segment returns a mask at once (describe the thing, or give points/boxes); retouch `replace` needs a prompt for the region, `erase` removes it |
| Several separate regions | One segment + retouch per region, each on the previous result | Chain so all fixes end in one final image |
| A whole-image instruction that must keep framing (expression, wardrobe color, time of day, swap a held product) | `images_generate` with the model `agentRecommendation` gives for `image_edit`, the source as the first `image` reference. When that model supports `preciseEdit` (the `images_generate` description says which do), set `preciseEdit: true`; otherwise pass the source's aspect ratio | `preciseEdit` edits the first reference in place and takes no `aspectRatio`; without it the model makes a new image from the reference, so check it closely (section 6) |
| Only the background | `images_replace_background` | Re-lights the subject to match; use the lock-first `images_generate` route if the subject's light must not change |
| Cut-out | `images_remove_background` | |
| More canvas, new ratio | `images_expand` | Keeps the original pixels |
| Tighter framing, exact pixels | `images_crop`, `images_resize` | Not AI |
| Sharpness, resolution | `images_upscale` | Use a precision or low-creativity setting to keep detail faithful |
| Lighting only | `images_relight` | 1 to 4 lights with direction, color and intensity |
| Skin | `images_skin_enhancer` | |
| Camera angle | `images_change_camera` | Regenerates the view; not pixel-preserving |

Outside that row, `images_generate` is the last resort for edits, used only for a whole-image creative rework.

## 3. Masks and retouch

- `images_segment` with a plain prompt ("the paper cup in her right hand", "the small sign on the back wall"); add a box or points when the image has several candidates.
- `images_retouch` with the original as `creationIdentifier` and the mask as `maskCreationIdentifier`.
  - `replace`: the prompt describes only what the masked region becomes, matched to the scene: "a matte black stainless travel tumbler held the same way, same lighting and perspective as the hand".
  - `erase`: no prompt needed; the model fills with the plausible background.
- Pick a model from `retouch_models_list` when the user cares about the look, or leave Auto.
- Mask slightly larger than the object for replacements that change silhouette (a cup becoming a tumbler).

## 4. Lock-first instruction prompts

For `preciseEdit` or any reference-based edit, open with the lock, then the single change, then the negations:

> Keep this image exactly as is: same person, face, hair, expression, pose, clothing, framing, lighting, colors and every object. Only change her sweater from grey to deep forest green (#1F4D3A), same knit texture and fit. Add nothing; nothing else changes.

- Lock what is actually in the image; for people always the face, hair, skin tone, expression, pose and framing.
- Quote exact values (hex colors, the exact text with its casing).
- Removals: describe the minimal neutral continuation of what is behind, never new content.
- Pass the source's aspect ratio on any `images_generate` edit that takes one; the default is 1:1 and would crop the edit.

## 5. Text in the image

Replacing a headline or label is possible with GPT and Ideogram models for short text, but small dense type is unreliable.
Say so before the first paid attempt and offer the alternative: generate the image without the text and set the type in a design tool.

## 6. Check, then report

- Price the edit with `simulate_cost` using the exact arguments, source image included in `references[0]`; a `preciseEdit` quote fails without it.
- Wait for each result and keep the chain: segment, retouch, next segment on the retouched image, next retouch.
- An edit can come back smaller than its source. When the edit joins a set, check the delivered file's pixel size (not only the creation's metadata) and offer `images_upscale` to match.
- Check the edit against the words of the request at 100% around its borders: sample the new object's colour against the asked one (matte black is near 0, not charcoal), look for smears where it meets the subject and for ghosts of anything removed, and redo the region once if it fails.
- If you cannot see pixels: say what you changed and what the user should check (mask edges, the new object's scale, anything near the edit).
- If something drifted, re-anchor on the original, tighten the lock or the mask, and try once more; never loop.
- Save into the same project as the source (`folderReference`). The approved original stays untouched; in the reply, point to the new version's link and suggest a version name for the team (for example `campaign_hero_final_v2`).
