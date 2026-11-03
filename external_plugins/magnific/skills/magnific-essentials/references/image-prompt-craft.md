# Image prompt craft for Magnific

Read this before writing an `images_generate` prompt where quality matters.

## Contents

1. Pick the job contract first
2. New images: the universal prompt
3. Model families
4. Edits: lock first, then the change
5. References
6. Text in images
7. Lens, depth and film look

## 1. Pick the job contract first

What must stay fixed decides the tool and the prompt shape:

| What must stay fixed | Contract | Tool |
|---|---|---|
| Nothing, it is a new image | New image | `images_generate` |
| Everything except one region | Region edit | `images_segment` for a mask, then `images_retouch` |
| Composition and framing, the whole image changes in one instruction | Instruction edit | `images_generate` with the catalog's `image_edit` model and the source first, with `preciseEdit: true` when that model supports it (see `precise-image-edits`) |
| The subject; only the background changes | Background swap | `images_replace_background` (re-lights the subject) or `images_generate` with the source first |
| The exact product, its branding locked, in a new scene | Product in situ | `images_generate` with the product as a reference |
| The physical pack, with new label artwork | Packshot mockup | `images_generate` with a structure reference and an artwork reference |
| Subject and layout, the look changes | Restyle | `images_restyle` or `images_generate` with a style reference |
| Pixels, only size, crop or sharpness change | Non-generative | `images_resize`, `images_crop`, `images_upscale`, `images_expand` |

`images_generate` regenerates every pixel.
Use it as an editor only when the dedicated tools cannot do the job.

## 2. New images: the universal prompt

Write in English whatever language the user speaks.
Order, densest first: subject (count, attributes) -> action or pose -> setting -> composition (shot size, angle, lens feel) -> lighting (source, direction, quality, time of day) -> style or medium -> color and detail.

- One precise detail beats three vague adjectives.
- Write positively; add negatives only where the model has a negative-prompt field.
- Keep one visual register: never photoreal and flat vector in one image.
- Copy aspect ratio, resolution and quality values from the model's catalog entry; never invent them.
- N variants of one idea is one call with `count: N`; different ideas are different calls.

## 3. Model families

| Family (slug prefix) | Write it like | Strengths and traps |
|---|---|---|
| `magnific-one` | The user's own words: subject and moment, medium only if they named one | It directs light, lens and framing itself; adding them makes it worse. Default quality is already its High tier; `quality: high` is Max and costs far more. Required for brand kits. |
| `seedream-*` | Rich descriptive prose with art direction; name the medium (photo, illustration, 3D) | Strong default for photoreal, product, character and reference-guided work; good typography incl. CJK; `seedream-5-pro` allows custom sizes up to 16:1 |
| `imagen-*` (Nano Banana) | Plain instruction sentences; spell out every element, count and position | Excellent at instruction edits and keeping people and products consistent. Nano Banana 2 is `imagen-nano-banana-2-flash`; `imagen-nano-banana-2` is Nano Banana Pro |
| `gpt-*` | Plain directives: layout -> text content -> style -> colors -> constraints | Best for readable text, posters, infographics, UI, diagrams; honors positions like "top-left"; can output transparent backgrounds |
| `flux-*` | One dense paragraph like a photographer's brief, with optics and materials | Fine photoreal detail; `flux-kontext-*` are instruction-edit models |
| `mystic-*` | Photo brief: lens, depth of field, lighting, texture | Photoreal skin and materials; not for cartoon or vector |
| `ideogram-*` | Short, direct | Typography |
| `recraft-*` | Short, design-oriented | Fast first drafts, illustration, vector-like work |
| `imagen-nano-banana-2-lite` | Short | Cheapest and fastest: drafts and volume |

## 4. Edits: lock first, then the change

A caption-style prompt ("A woman in a kitchen holding a black tumbler, preserving all original elements") re-stages the whole image, moves products and corrupts label text.
Each one still costs credits, so never send one.
An edit prompt is an instruction that opens with what is locked and names only the change:

> Keep this image exactly as is: same person, face, hair, expression, pose, framing, lighting, colors and every object. Only replace the paper cup in her right hand with a matte black travel tumbler held the same way. Add nothing else.

The four parts, all on the first attempt:
1. The lock list, grounded in what is actually in the source. For people always lock facial features, face structure, skin tone, expression, hair, pose and framing.
2. The single change, with exact values verbatim (hex colors, exact wording and casing, sizes).
3. Negations: no new objects, text or decorations; nothing not listed changes.
4. For removals: the minimal neutral continuation of what is behind, never invented content.

Also:
- Pass the source as the FIRST reference and say in the prompt what every other reference is for.
- Pass the source's aspect ratio. External `images_generate` defaults to 1:1 and will crop or pad your edit.
- Iterate on the latest accepted result; parallel variants of one base all reference the original.
- After the result lands, check it against the lock list and say plainly if something drifted.
- A paid retry changes one structural thing (re-anchor on the original, harden the lock list with what drifted, or switch to a stronger model or a dedicated tool), never the same call with more emphasis.

## 5. References

`images_generate` takes up to 12 `references`, each `{type, identifier}`:

- `image`: any creation (a photo of a person, product, layout or scene); `identifier` is the creation identifier.
- `character`, `product`, `locations`: a saved library asset; `identifier` is the numeric `id` from `library_list`, never a creation identifier.
- `style`: a library style, or a creation used as a style photo.

A library asset may also be mentioned in the prompt as `@<name>` where it appears in the scene.
State each reference's role in the prompt ("the first image is the product, keep it exact; the second sets the mood and light").

## 6. Text in images

- Quote exact strings and keep them short.
- Prefer `gpt`, `imagen` or `seedream` models for rendered text.
- Small dense text (ingredients, legal lines, fine labels) is unreliable in any diffusion model: say so before the first paid attempt and suggest setting that text in a design tool.
- Proofread the text on the result before calling it right.

## 7. Lens, depth and film look

For photographic stills, location plates and character sheets, describe what the lens does instead of naming it.

- **Lens by job:** 24 mm for establishing plates, 35 mm for a location with a hero object, 50 mm for full-body character sheets, 85 mm for faces. Never a wide lens on a face.
- **Physical depth:** one named focus target, the camera within a few metres of it, aperture fully open, and the layers that go soft named. Otherwise everything renders sharp.
- **Anamorphic signature:** elongated vertical oval highlights on a named surface; a thin horizontal streak flare off a named light in frame, its colour matching the source. Aspect 2.39:1 for cinema plates.
- **Film look without brands:** stock by balance and speed (tungsten-balanced high-speed colour negative at night, daylight-balanced medium-speed by day), grain, lifted shadows that hold detail. Brand names pull in logos.
- **Plate order:** "Cinematic film still" plus place and mood; camera side, height and direction; foreground to background; palette in proportions; named light sources; focus and soft layers; the film-look line; "empty plate, no people, no text, no watermark".
