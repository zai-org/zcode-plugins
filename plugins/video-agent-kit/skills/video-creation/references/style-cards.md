# Style cards

`style_preset` is prepended to every image prompt, so it is the single lever for art
direction consistency across a work. Set it once in the plan and do not vary it per unit.

## Why non-photoreal is mandatory when humans appear

The video generator refuses reference images that may contain a real human face. A
photoreal cast sheet therefore blocks most units with human characters — measured at roughly
two thirds of the units on a mythology piece with a human-heavy cast. Non-human characters
(animals, demons, creatures) pass even when rendered photoreal.

Positive 写实 (realistic) / 照片 (photo) / 真人 (real person) / 实拍 (live-action footage) /
photoreal / photo-realistic / realistic photo / hyperreal / raw photo / dslr markers call for
a face-compatible treatment when human faces appear. With existing continuation
authorization, T18 defaults to “写实质感的风格化人物” (stylized characters with realistic
materials), marks the plan and delivery note “暂定” (tentative), and continues without asking.
This exact treatment keeps realistic materials and light but stylizes the face; it is not a
request for a real person's likeness. A negated marker is the desired wording
(非写实 "non-photoreal", 无照片真实感 "no photographic realism") and is not flagged — but the
negation window is one character, so compounds such as "无照片实拍感" still trip it; write
非实拍 ("not live-action") or drop the word.

A piece whose reference cards carry no human faces (landscape or nature documentary, product
ad, object explainer) may use a photoreal style: the refusal is about real-looking human
faces, not about photorealism. Declare the plan's `format` accordingly. Keep a blocker
only when the original brief explicitly insists on photoreal human faces and rejects
the compatible treatment. See [production.md](production.md#t18-tentative-handling-of-photoreal-human-requests)
for the authorization marker, tentative plan fields and delivery wording.

## Characters from an existing game, anime or film

Fan works name characters the user owns no art for. The video generator's copyright filter
judges the rendered output and refuses a take whose characters look like the official model
(`OutputVideoSensitiveContentDetected… copyright restrictions`) — after it has counted toward the
budget. Cards drawn from the official art (the supplied turnaround sheet, crops of it, or
image_generate fed it as a reference) are what trip it; names, places and story do not. So for
an existing IP, draw each card with `image_generate` from a text description only — the traits
read off the user's reference images (hair, eyes, ears/tails, palette, costume motifs, props)
written into the prompt — and use the reference images to check the result, not as inputs.
Official art also comes as wide or tall sheets: a reference outside aspect 0.4–2.5 fails the
whole take, and `creation_plan_validate` reports it.

## Ride the video model's prior (why the 3D card is the default)

The video generator re-renders every take toward its own cinematic 3D prior. A 2D or
painted keyframe fights it: the take opens looking like the keyframe and drifts to CG within
seconds, and across units the work oscillates between ink-wash or illustration and CG. The
fix is to put the whole pipeline in the generator's native domain — keyframes, cards and
takes all use the 3D animation card below. With it a take held one look from first frame to
last, and a CG-styled human keyframe was accepted without a real-person refusal.

Tiered wording is the moderation key: fully photoreal humans trip both the image service's
safety filter and the video generator's real-person check, while creatures may be rendered as
detailed as you like. So the card says it explicitly — creatures precise and detailed, humans
风格化动画造型 (a stylized animation look).

## Character three-view sheets

Keep identity markers attached to the character: glasses, hair ornaments, fixed carried items and other markers worn on the body stay.
Handheld plot props are moved to prop assets by default and are not put in the character three-view sheet; who holds them, and the action, is arranged in the shot or the keyframe.

## T02 Visual lock for critical props

All props are entered in the v4 `props[]` ledger; only `critical: true` requires a visual lock. For each critical prop make a "one image, one object" design image: the image shows only this one prop — not the person holding it, no second copy and no other prop — with its shape, material, color and identifying details fixed; write the path into that prop's `props[].image`. This card stays outside the character three-view sheet, in line with T03. `critical` is decided by the planning agent from the plot; 1–3 per brief is suggested; more than 5 only gets a reminder.

Every unit in which this prop appears registers it in `prop_ids` and attaches this card in the unit's `reference_images`; the corresponding `video_generate.shots[].reference_images` also passes the same path explicitly (the current generation entry point does not copy the plan's `reference_images` automatically). The card's `label`, the unit description, the design-image prompt and the retained legacy `name` field are all **word-for-word identical** to `props[].label`; do not rotate short names or aliases. Before the first appearance, a phrase such as “未持玄铁剑” ("not holding 玄铁剑", where 玄铁剑 is the example prop's label) describes an empty-handed state and does not count as the prop appearing.

```json
{"prop_ids":["sword"],"reference_images":[{"path":"images/sword.png","role":"reference_image","label":"玄铁剑"}]}
```

`creation_plan_validate` gives a reminder for a critical prop whose card is missing, whose card path is unusable or whose naming is inconsistent; it does not remind about ordinary background props without a card. A prop card counts as a normal `reference_image` in T08's final image/video visual-anchor set and still has to respect the generator's actual reference-image limit. "One image, one object" must be verified by looking at the image; path/label validation cannot prove that the image contains only one prop.

## Verified cards

The card texts are prompts in Chinese, the wording they were verified in.

### 3D animation film render (recommended default; verified end to end)

```
三维动画电影渲染风格，风格化非写实建模，电影级CG质感，PBR材质，柔和全局光照，体积光，
龙与生物的鳞甲毛发细节精细，人类角色为风格化三维动画造型、艺术化面部比例、动画角色质感，
暗调史诗配色（玄铁灰、青铜绿、暗金、血红），电影级构图与光影，无文字水印
```

Swap the palette clause per subject. Keyframes (including human close-ups) and takes both
pass the image service and the generator's reference checks; the style stays put inside and
across takes.

### Gongbi heavy-color animation

```
中国传统工笔重彩动画电影风格，非写实手绘质感，平涂厚彩，线条勾勒，
戏曲扮相的程式化五官，绢本设色，青绿山水配色，无照片真实感，
电影级构图与光影，无文字水印
```

Best for mythology, classical novels and wuxia. Holds detail in costume and architecture and
reads as clearly illustrated, so human faces pass.

### Ink-wash freehand

```
中国水墨写意动画风格，非写实，留白构图，墨色浓淡分明，淡彩点染，
笔触可见，宣纸质感，无照片真实感，电影级光影，无文字水印
```

Sparser and cheaper to keep consistent; weaker for crowds and heavy action.

### Modern 2D animation

```
现代二维动画电影风格，非写实赛璐璐上色，干净线稿，柔和渐变，
高饱和色彩，浅景深，电影级构图与光影，无文字水印
```

Best for contemporary or urban subjects, city short drama, ad storyboards.

### 3D render

```
三维动画电影渲染风格，风格化非写实建模，柔和全局光照，次表面散射皮肤质感，
电影级构图，浅景深，无文字水印
```

Keep 风格化非写实 (stylized, non-photoreal) — a realistic 3D human still trips the real-person check.

## What the video model keeps

Reference images pin content and identity, not brushwork. The generator re-renders in its own
generally cinematic look, so the illustrated texture of a keyframe is only partly preserved.
Judge style consistency on the rendered takes, not the keyframes; if the drift matters, state
it in the delivery note rather than fighting it unit by unit.

## Professional character board (the 11-zone spec for sheet_prompt)

Source: Updream's official "professional character board" skill (the most activated skill in the whole library). The character card produced from `sheet_prompt` is written to this spec — **one image covers every viewpoint and feature**: one image generation per character, taking one reference slot, with the front / back / side views all taken from this one image.

Composition of the board (11 zones; a missing key zone counts as missing):

1. **Main visual portrait** — the largest zone, half-length or bust, defining how recognizable the character is (face, look in the eyes, hairstyle, neckline, chest accessories, temperament); do not let small decorative windows steal the subject.
2. **Full-body three views** — front, side, back: the same person, the same outfit, the same hairstyle, consistent proportions, a neutral standing pose.
3. **Four expression close-ups** — a required zone (not an optional detail window): four equal-size heads for joy / anger / sorrow / mirth, under their own title "表情特写 / EXPRESSION SHEET" (表情特写 means "expression close-ups"); the four panels must be the same face, with no change of age, face shape, makeup or hairstyle because of the expression; a result without a separate four-panel zone = a missing key zone: retry or draw it in.
4. **Face close-up** — a near view of brows and eyes, lip shape, skin texture and expression; when a reference image already exists, replicate it strictly.
5. **Costume layer breakdown** — inner garment / middle garment / outer robe / shawl / belt / hanging ornaments, layer by layer, like a costume design sheet.
6. **Color swatches** — main color / secondary color / shadow color / metal color / pattern color / material reference colors.
7. **Costume material details** — fabric / embroidery / tonal patterns / satin / leather and so on; be specific, do not write "premium materials".
8. **5–8 local close-up windows** — cuffs / neckline / shoulders / waist sash / hem / footwear / weapon attachment points and so on, chosen for identity and for readability in generation.
9. **Hairstyle and hair ornaments** — including the hairstyle from the side and from the back, crowns and hair ornaments.
10. **Personal carried props** — carried items that serve the character design (separate from the prop ledger `props`: what is drawn here is part of the look and carries no plot state).
11. **Character profile zone** — a text zone with name / age / identity / occupation / height / build / temperament.

Discipline at generation (source: the official multi-view skill): every zone on the board **is the same person** — generate with the main reference attached plus a protective sentence (in a Chinese prompt: "只改变区块内容，不改变人物身份、脸、发型、服装、配饰、体型、配色、材质", i.e. "change only the content of the zone; do not change the person's identity, face, hairstyle, clothing, accessories, build, color scheme or materials"); the back/side views are derived from the same main card and do not drift independently.

**Upgrade path on demand**: for a character with many back-view scenes, if the back view inside the big card does not have enough resolution (back-view shots still drift across shots, and the missing-back-card warning has fired), add a separate high-resolution `image_back` card for that character (generate it with the main card attached plus the viewpoint protective sentence); test one first and batch afterwards; do not add cards for everyone by default.

## Lighting DNA (structure and toolbox for lighting_dna)

Source: Updream's official "storyboard lighting design" skill. `lighting_dna` is the lighting contract shared by the whole film. Field structure:

`style_name` (name of the scheme) / `story_reason` (why it suits the story) / `location_logic` (interior/exterior and the practical light sources it rests on) / `time_logic` (time of day or night) / `temperature` (cool / warm / mixed) / `emotional_tone` (emotional task) / `key_light` (key light direction, intensity, hardness, color temperature) / `fill_light` (fill light) / `rim_light` (rim-light rule) / `shadow_design` (shadow depth, edge, light-to-dark ratio) / `palette` (main, secondary and accent colors + saturation) / `atmosphere` (the feel of the air: fog, rain, dust, reflections and so on) / `continuity_lock` (what may not change across the film). When you cannot write all of them, give at least the three items `key_light`/`palette`/`continuity_lock`. **Writing only a short label such as "blue-hour night scene, low-key light" is forbidden.**

Ten common directions (choose by the story):

| Direction | Keywords | Suits stories of |
| --- | --- | --- |
| Blue-hour night | blue hour night, cool moonlight, quiet shadows | loneliness, suspense, parting, a road at night |
| Golden hour | golden hour, warm orange glow, long soft shadows | memory, healing, a journey, farewell |
| Rembrandt light | 45° side key light, triangular cheek highlight | confrontation, a character's inner life, dramatic tension |
| Wong Kar-wai neon | neon haze, magenta cyan, wet reflections | city night, flirtation, loss, repression |
| Overcast diffuse | overcast diffuse, soft low contrast | realism, investigation, calm, everyday life |
| Candlelight / firelight | candlelight, warm flicker, low-key | intimacy, period interiors, danger, ritual |
| Film noir | hard single key, deep shadows, venetian pattern | crime, secrets, betrayal, interrogation |
| Volumetric light | volumetric beams, dust, god rays | discovery, the sacred, forest, ritual |
| Hard noon light | harsh overhead, short hard shadows | scorching sun, oppression, desolation, rawness |
| Warm–cool contrast | warm key + cool ambient, teal-orange | conflict, a contradictory relationship, a temperature gap between inside and outside |

- Light source types (choose 1–2 main sources): daylight / golden hour / moonlight / hard noon light / window light / tungsten lamp / candlelight / firelight / streetlight / neon / screen light / volumetric light in fog.
- Direction and quality (choose 1 dominant one): front light = calm, few shadows; side light = volume and tension; backlight = silhouette, an outline of fate; top light = oppression, judgment; under light = unease, horror; soft light = gentleness, transition; hard light = strong conflict; low-key = dramatic; high-key = bright and light.
- Emotion → warm/cool: happiness / healing / memory = warm light, low contrast, soft shadows; sadness / loneliness / suspense = cool light, low saturation, deep shadows; tension / danger / oppression = hard light, high contrast, the face may be partly hidden; flirtation / haziness = neon, smoke, wetness, low illumination; hope / discovery = backlight, volumetric light, a warm rim light.

Selection principles: the performance comes first (face and eyes readable, deliberate silhouettes excepted); **practical light sources come first** (the light must be explainable by a window, lamp, moon, fire or screen inside the picture); the key-light direction does not jump within one scene; a turning-point shot may raise the contrast but does not break the color key of the whole group; for effects such as fog, rain, flares, dust and reflections, choose at most 1–2 dominant elements.

When injecting it into a generation prompt, write the whole fixed lighting sentence and add a protective sentence (in a Chinese prompt: "只调整光影、色温、阴影、轮廓光、空气感和色彩氛围，不改变人物身份、脸、服装、道具、构图、动作、运镜与剧情内容", i.e. "adjust only light and shadow, color temperature, shadows, rim light, the feel of the air and the color mood; do not change the person's identity, face, clothing, props, composition, action, camera movement or story content"). Lighting negatives: random light-source direction, jumps in color temperature, inconsistent shadows, overexposure, dead blacks with no detail, dirty gray patches, abnormal skin tones.

## Structured style baseline and local patches

Source: the art-development system of Updream's v7 full-pipeline skill.

**Seven layers of style identity** (do not write just one style label in `style_preset`): genre DNA / style symbols (Cthulhu tentacles, Y2K metal, Hong Kong-film neon…) / art style (2D, cel-shaded 3D, realistic cinematic look, thick-paint style, stop motion…) / material (paper cut, clay, felt, oil paint, woodcut, metal…) / era and culture (including forbidden elements) / emotional motif / visual motif (2–4 shapes, objects or environmental symbols that can recur). **Describe art style and material separately; do not merge them into one word.**

**Ten-part structure of the fixed aesthetic prompt** (English preferred; the image model executes it more reliably):

```
[medium and art style], [material/rendering style], [genre and mood],
[lighting design], [color palette], [composition and lens language],
[texture details], [dynamic atmospheric elements],
production-ready visual design, consistent visual identity, no text, no watermark.
```

**Genre → art style reference** (a starting point, not a constraint):

| Genre | Recommended direction |
| --- | --- |
| Serious suspense / power intrigue | realistic cinematic look, thick-paint style, low-saturation CG, oil-paint texture |
| Fairy tale / healing / light comedy | chibi (Q-style), clay, felt, paper cut, warm flat colors |
| Fantasy / epic | CG, thick-paint style, sculptural materials, grand lighting |
| Urban / cyber | realistic CG, neon, glass and metal, strong reflections |
| Folk / uncanny | paper effigies, woodcut, faded cloth, incense smoke, local symbolization |
| Animated character assets | cel-shaded 3D, cel look, clean outlines, reusable design sheets |

**Local style patch (local_style_patch)**: a scene may patch the global baseline — the only things a patch may change are time, weather, local light color, material state and emotional intensity; replacing the global art style, material logic, era and culture, main color relationships or the way characters are rendered is forbidden. A patch is scene-level (used together with the `scene_evolution` ledger); it is not a license to switch styles.
