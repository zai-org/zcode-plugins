# Generators and prompts

A plan may pin a profile with `generator`. When undeclared, `VE_VIDEO_GENERATOR` decides, defaulting to `video-v2.5`. An unknown explicit profile is an error; the same plan/candidate never silently switches models.

The recommended unit length is ≤15 s. A continuous single-take shot that needs more (15 s < d ≤ 30 s) uses the 30 s tier of Seedance 2.5, and the unit must be bound to a generator with `_gmax>=30` (a per-call maximum of at least 30 s; currently `video-v2.5`). The other profiles do not support 30 s, and anything over 30 s is always rejected; 30 s is the model's capability ceiling, not a project policy. Adjacent same-scene units get a merge reminder only when their total is ≤15 s; a continuous 15–30 s single take no longer gets a merge reminder; multi-shot units are still recommended to be split into ≤15 s.

| Profile | Media length per call | Image/video/audio reference limit | Audio limits | Syntax |
| --- | --- | --- | --- | --- |
| video-v2.5 | 4–30 s | 9 / 3 / 3 | total ≤30 s | `Image N`, `Audio N`, `Shot N (a-bs)` |

Actual model availability is whatever the provider offers. An image or service error affects only the failing item; images that already succeeded are kept.

Every generation request needs at least one visual anchor (an image or a video; first/last frames count too). The tool checks the final visual set after the plan keyframes, `reference_take_id` and the request's `continuity_from` have all been resolved and attached automatically; when the final set is empty it reports an error according to `format`, and audio does not count as a visual anchor. No current format has an automatic exemption; if a format that truly has no visual assets is to be exempted, the format and the conditions must first be made explicit — changing `format` alone cannot bypass the check.

Annotate each reference image with its number, character/object and what to preserve. Character images lock identity, scene images lock space/light sources, prop images lock design, and a keyframe must be a single scene image, not a multi-panel storyboard. The frame roles `first_frame`/`last_frame` mean something different from an ordinary `reference_image`; do not carry the character card's gray background and standing pose into the final video. Choose landscape/portrait keyframes according to the project's aspect ratio, and actually check the returned size and composition.

Two disciplines for attaching references (source: the official multi-view skill):

- **Let the reference image drive; keep the text minimal**: identity details already carried by an attached character card / scene card (face, clothing, build, looks) are not restated in the prompt — the reference image carries the details, and when a textual restatement disagrees with the image the model drifts instead. The prompt writes only what changes (action, emotion, camera); only a subject without a reference image gets a full textual description.
- **Declare each card's role**: when one request attaches several reference images, state the boundary of each image's role — a viewpoint card provides only camera angle/perspective (in a Chinese prompt: "图片 N 仅用于视角参考", i.e. "Image N is used only as a viewpoint reference"), an identity card provides only the person ("图片 N 是谁", i.e. "Image N is <who>"), and the face/clothing in a viewpoint reference is not carried into the film; for modification requests (a redo / a continuation) add a protective sentence: "只改变 X，保持脸、发型、服装、配饰、体型、配色、材质与参考图一致" ("change only X; keep the face, hairstyle, clothing, accessories, build, color scheme and materials consistent with the reference image").

In v4 one candidate may describe several Shot blocks: first give timing/viewpoint/character task, then action, reaction, dialogue/sound effects, reference mapping and end state. Multi-shot execution is generator output behavior; a passing plan does not guarantee real cuts. Check the actual output; if you need precise cut points, generate independent viewpoints and cut them on the timeline. A v2 independent-shot prompt must not also ask for multiple hard cuts.

The model may re-perform a voice reference; correct TTS before generation does not prove the in-clip dialogue is correct. Prevent old dialogue in a reference video from contaminating the current character's voice, and state explicitly what each image/sound is used for. When there is no dialogue, state explicitly that no one speaks; for scenes with background voices, use `ambient_speech_ok`. When the generation service rejects content, report the original failure; the Agent decides how to modify based on the user's content.

Clips are 480p and silent (the generator adds no audio track). A speaking shot still sends its TTS line as `dialogue_audio`; the generator performs to it (mouth rhythm) but the line is not in the clip. `creation_timeline_build` lays that same line back on the voice track from the clip start for a `speech_in_clip` segment with exactly one line audio; a clip generated against several line audios (two speakers, or a line plus in-clip inner voice) cannot be laid back automatically — drop `speech_in_clip` there and bind each line as `voice_clips` in spoken order, or plan one speaking character per clip. Speech checks on these clips report `silent_generator` instead of ASR: judge lip timing on the frames. Ratio is one of 16:9 / 4:3 / 1:1 / 3:4 / 9:16 / 21:9 / adaptive; first/last-frame shots follow the first frame's ratio. `video_generate action=edit` is not available: fix a defect by trimming, generating another take, or regenerating with the change stated.

Optional local voice and face diagnostics may be unavailable in the environment; a diagnostic reported missing cannot count as a review pass.

## Shot language

Choose framing, angle and movement from what the beat must make the audience feel, then write them into the unit's prompt in plain words. Prefer one movement per block; a static frame is a choice, not a default. In narrative work a move must reveal or tighten something; when a block would only drift or push in while nothing happens, cut to a new framing or a reaction instead (see [story.md](story.md#density-and-pacing)).

| Framing | Use it for |
| --- | --- |
| Extreme wide | scale of a place, an opening, a character made small by the world |
| Wide | where people stand relative to each other and the space |
| Full | a whole-body action that must read in one view |
| Medium | conversation and two-person exchange |
| Medium close-up | expression while the line or reaction lands |
| Close-up | the moment a feeling peaks, or a detail the plot turns on |
| Extreme close-up | a single object or gesture that carries meaning; keep it short |

| Angle | Effect |
| --- | --- |
| Eye level | neutral, closest to the character |
| High angle | the subject looks weaker or trapped |
| Low angle | the subject looks stronger or threatening |
| Top-down | an overview, fate, or loneliness |
| Tilted | unease and imbalance; use sparingly |
| Over the shoulder | puts the audience inside one side of a conversation |
| Point of view | what the character sees; good for screens, letters, discoveries |

| Movement | Effect |
| --- | --- |
| Push in | attention tightens, a realization arrives; keep it brief |
| Slow pull out | release, aftermath, revealing the surroundings |
| Pan / tilt | scanning a space, following a gaze |
| Follow / tracking | staying with a moving character |
| Orbit | presenting a subject or a decisive moment |
| Rise / descend | grandeur, or pressure from above |
| Handheld | immediacy and tension; not for calm scenes |
| Locked-off | stability, dialogue, letting the performance carry |

Intensified camera moves for short-drama rhythm (each must have a clear purpose, one per shot; source: the short-drama vocabulary of the official storyboard skill):

| Movement | Short-drama use |
| --- | --- |
| Fast push in / fast dolly in | an opening hook, a key line, a secret revealed, sudden pressure |
| Snap zoom | a character's reaction, a prop exposed, an identity or relationship suddenly made clear |
| Whip pan | from the observer to the observed, from a line to its consequence |
| Handheld shake | a grab, loss of control, an argument escalating |
| Low angle tracking | dominance, a powerful character advancing |
| Rack focus | shifting attention between a prop / a look / a relationship |
| Jump cut | eating, searching, compressing continuous action, comic rhythm |

Emotion to picture, as a starting point: tension → closer framing, handheld or a quick push, cool high-contrast light; warmth → medium framing, locked-off, warm soft light; mystery → a cut to a partial view, deep shadows; grief → close framing, locked-off, desaturated cool tones; joy → medium or full, follow, warm saturated light; dread → close framing from below, a short push, dark high contrast; release → wide, rise or pull out, bright open light.

### Framing progression (across shots)

On top of the emotion mapping of a single shot, the framing of adjacent shots should follow a progression (source: the official storyboard skill):

- **Rising tension**: WS → MS → MCU → CU → ECU, tightening step by step.
- **Release / aftermath**: ECU/CU → MS → WS, widening step by step.
- **Dialogue**: mainly MCU shot/reverse-shot, interleaved with two-shots or reaction close-ups; short-drama dialogue should not use only even shot/reverse-shot — insert a reaction close-up, a prop close-up, an eyeline switch or an oppressive composition before and after a key line.

## Three-axis camera position system (azimuth / elevation / distance)

Source: Updream's official "multi-view character generation" skill. When describing a special viewpoint, adding a viewpoint card or planning keyframes for a multi-shot unit, use the three-axis terms; do not substitute mood words for camera words.

**Horizontal azimuth (8 directions)**: `front view` (front) / `front-right quarter view` (45° front right) / `right side view` (right side) / `back-right quarter view` (45° back right) / `back view` (back) / `back-left quarter view` (45° back left) / `left side view` (left side) / `front-left quarter view` (45° front left).

**Vertical elevation (4 levels)**: `low-angle shot` (-30°), looking up = heroic, oppressive, a sense of mass / `eye-level shot` (0°), level = the standard reference / `elevated angle shot` (+30°), slightly from above = head, shoulders and positions read clearly / `high-angle shot` (+60°), steeply from above = weakness, spatial relationships, an overview of the styling.

**Framing distance (3 levels)**: `close-up` = face, makeup and styling, expression, hairline / `medium shot` = clothing, upper body, performance reference / `wide shot` = full body, silhouette, keyframes, spatial relationships.

**Default strategy**: the regular reference pack = 8 azimuths at eye level, medium shot; **the first stability test = 5 camera positions**, in the order front → front-right quarter → right side → front-left quarter → left side, and only once that is stable expand to the three back directions — **back-view information is what the model most easily fills in wrongly, so the first test does not give priority to generating the back**; character design check = 8 azimuths at eye level, CU + medium; video test = a simple orbit over 3 keyframes.

**Keyframe combinations for a video orbit** (a reference for planning the keyframes of a multi-shot unit): hero entrance = wide front low-angle → medium front-right low-angle → CU eye-level; character check = medium front → side → back → opposite side → front; weakness seen from above = high-angle wide → high-angle medium → eye-level CU; transformation spin = front medium → side medium → back wide → front CU.

**Hard requirements for a standard character three-view sheet** (the camera positions of the character card's three views): three positions, front / right / back (azimuth 0/90/180, eye-level, full-body wide); an orthographic, long-lens reference feel (no wide-angle distortion, no high or low angles); the same full-body proportions, head-top height, foot baseline and share of the frame; a neutral standing pose with the arms slightly away from the torso; a pure white background with even neutral light; **handheld plot props are moved out of the three-view sheet by default** (identity markers attached to the body may stay). Examples that do not qualify: a 45° front-right view is not a valid side view; a face in profile on a frontal torso is not one either; three near-frontal views / three outfits / three expressions / several characters in one image are not a three-view sheet.

**Three more movement terms** (with their emotion mapping): `Orbit` = obsession, an emotional deadlock, a sense of ritual, a vortex of energy; `Crane Down` = fate, scale, institutional pressure, revealing a battlefield or a stage; `Locked-off Hold` = dead silence, shock, oppressive stillness — **the frame is still, but the subject or the environment must be moving**.

## Special-viewpoint transfer (viewpoint reference × identity reference)

Source: the special-viewpoint transfer rules of the official multi-view skill; this is the full form of the "declare each card's role" rule (B4 above). When generating "a new image of a character from a special viewpoint" (adding a back card / side card, a viewpoint test image):

**Roles of the two references**: the viewpoint reference image provides only camera viewpoint, elevation, perspective, framing, compositional proportions, camera height and the character's share of the frame; the identity reference image (the character card) provides only face, facial features, hairstyle, clothing, accessories, build, age, materials, color scheme, props and art style. **Do not apply the person's identity, clothing, face, scene or style from the viewpoint reference to the character of the identity reference.**

**Six-step prompt construction**: ① lock character consistency (a whole paragraph declaring that every feature of the identity reference stays unchanged) → ② declare the viewpoint transfer (adopt only the camera parameters of the viewpoint reference) → ③ three-axis camera terms (azimuth/elevation/distance) → ④ pose constraint (a stable standing pose or a simple action during the test stage; avoid occluding identifying features) → ⑤ background constraint (a clean background or a light scene, with the perspective following the target viewpoint) → ⑥ negative constraints.

**Core sentence pattern in Chinese** (for a Chinese-language prompt; reusable as a whole paragraph):

```
请以[角色卡]为唯一人物身份参考，严格保持同一个人的脸、五官、发型、服装、配饰、体型、年龄、材质、配色和画风不变；[视角参考图]只用于相机视角、俯仰角、透视、景别、构图比例和镜头高度。生成一张该角色处在该特殊视角下的新图。只改变相机视角，不改变人物任何特征。
```

In English: "Use [character card] as the only identity reference for the person, and strictly keep the same person's face, facial features, hairstyle, clothing, accessories, build, age, materials, color scheme and art style unchanged; [viewpoint reference image] is used only for camera viewpoint, elevation angle, perspective, framing, compositional proportions and camera height. Generate a new image of this character seen from that special viewpoint. Change only the camera viewpoint; do not change any feature of the person."

**Negative list**: a changed face / changed hairstyle / changed clothing / changed accessories / changed build or age / changed art style / inheriting the person's identity from the viewpoint reference / `only tilting the head instead of changing camera viewpoint` (the most common false success in viewpoint transfer).

**Five acceptance checks** (compare against them when viewing the image for T11): is the new image still the person of the identity reference; did the viewpoint really change camera height and perspective (not a tilted head, a raised chin or a crop); is the extension of clothing and hair on the back/side plausible; under a high or low angle, did the background perspective change along with it; in a wide shot, is the whole body complete and uncropped. **Generation strategy**: test only 1 image first and batch after it passes; when several images in the same round continue the same person, the later images must keep the original identity reference attached or build on the earlier results, and must not drift independently.

## Duration gate for user-supplied video material (verify the duration before viewing)

For video material supplied by the user (not produced by this pipeline), the order of handling is fixed: **on an attach request the tool first verifies the duration (reading only the duration metadata) and judges it against the profile; only after it complies may you watch it, extract frames from it, transcribe it or describe its content**; do not look at the content before the verdict (do not call a duration-probing tool yourself as a way to look at the content). An unknown duration, or metadata that is not precise enough, counts as not passed.

- **video-v2.5**: external reference videos must total ≤30 s and be at most 3 per request (a single file over 30 s is stopped by the general hard gate `_material_gate`; several files that add up to more than 30 s are stopped by a sum at the attach-resolution layer).
- An over-limit verdict is registered under a stable identifier (path + sha256) in `.video_agent/rejected_materials.json` and **stays in force permanently within this project**: even if the user then asks to "reference only part of it", that version and anything previously obtained from it may not be referenced.
- There are only two ways to recover: the user trims the file and supplies a new one (the new content goes through the gate again); or switch to an independent text description. When the task depends on rejected material, state the limitation clearly and go on to finish with the remaining compliant material; do not fill in information from the excluded material.
- Self-produced takes (pipeline outputs under `out/creation/` and `.video_agent/`) are not subject to this gate — their duration is guaranteed by the generation side. Images and first/last-frame images involve no duration; audio references are validated at the submission layer against the profile's `max_audio_seconds`.
