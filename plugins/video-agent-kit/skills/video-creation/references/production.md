# Production contract, versions and evidence

Recommended project paths: `out/creation/shotlist.json`, `images/`, `clips/`, `clips/takes.json`, `verified.json`, `verdicts.json`, `review_package.json`, and the shared timeline `out/timeline.json`. Tools accept explicit paths; parallel projects use separate project dirs.

T11 image viewing confirmations are stored separately in `out/creation/image_reviews.json`, apart from the verified/verdicts ledgers of candidate videos.

## Plan

Common fields: `schema_version,title,format,screenplay?,generator?,style_preset,style_bible?,lighting_dna?,canvas{width,height,fps},cast[],scenes[],props?,bindings?,relationships?,nexus?,beats[],budget{max_total_generations,max_total_generated_seconds}`. Write duration as `target_duration_seconds` or `target_range_seconds:[lo,hi]`; a gap between total screen time and the target is a plan reminder, and the final delivery is checked against the user's target.

`lighting_dna` (lighting DNA; source: the official unified-lighting skill): the lighting anchor shared by the whole film — key light direction, color temperature, fill light, rim light, shadow quality and atmosphere, written as one fixed passage. It is used like `style_preset`: set it once, every unit inherits it, and it is not rewritten shot by shot; between units only small adjustments for the practical light sources of the scene (window light, street lamp, firelight, screen light) are allowed. Leaving it empty is not an error (the current behaviour is kept); once it is filled in, unit-by-unit variation gets a reminder.

- cast: stable `id,name,appearance,sheet_prompt,image,voice?/voice_card?` (`voice` is the character's fixed preset TTS voice id, `voice_card` a sample in that voice), optionally `role_type,traits,physique,headshot,visual_anchor?,priority?,states[{id,note,image}]`. Reference paths point to actual files. Keep attached identity markers (glasses, hair ornaments, items always carried on the body); handheld plot props move to prop assets by default and stay out of the character's three-view sheet.
  The character card produced by `sheet_prompt` follows the 11-zone professional character board spec in [style-cards.md](style-cards.md) (main visual + full-body three views + four expression panels + close-ups), so that one card covers the front, back and side views.
  `visual_anchor` is a short phrase for a visual anchor that can be reproduced reliably (hairstyle, signature accessory, an item always carried — source: the official asset schema); when checking identity across shots, compare the anchor first rather than the whole `appearance` passage.
  `priority` ranks story importance, with 1 the highest (source: the official asset schema): protagonist → core supporting characters and antagonists → important scenes → key props → everything else; rank by frequency of appearance across the whole text, contribution to the main plot and reuse across scenes taken together, and build cards in `priority` order.
  `role_type` enum: `protagonist / supporting / antagonist / extra / other` — respectively the protagonist, a key supporting character, an antagonist, a crowd/functional role, and other.
  The motivation `motivation{want,need,flaw}` and the relationship objects are required only for the 1–3 key characters; an `extra` is not required to have want/need, and either does not speak or gets only action-type lines. A protagonist, antagonist or key supporting character must not be relabeled `extra` to get around story responsibilities; the core-layer motivation and turn checks stay. When `role_type` is not set, the existing speaking-character checks apply; `kind:object` remains exempt.
- scene: `id` plus scene definition/image, optionally `visual_anchor?,priority?`; v2 adds `intent,spatial_anchors`. A scene that appears on screen (referenced by at least one unit) without an `image` gets a strong reminder — at least one scene reference image that shows the space, the period, the atmosphere or the key directions (source: a hard requirement of the official storyboard skill); `visual_anchor` works as for cast (reproducible anchors such as a threshold, neon, water mist or an altar).
- `scene_evolution?[]` (optional; source: the official per-scene art evolution table): a ledger of one scene's art state across scenes/stages, structured like the props ledger. Each row has `scene_id`, `phase` (the scene number or story stage), `情绪任务` (emotional task), `光影色彩` (light and color), `材质与状态变化` (material and state changes), `需生成资产?` (assets to generate) and `局部风格补丁?` (local style patch); the Chinese names are the literal keys. Building the ledger is recommended when the same scene appears with 2 or more changes across different times (day/night, before/after rain) or state points (knocked over, burned down, dressed); a row's `scene_id` must exist in `scenes[]`, and `phase/情绪任务/光影色彩/材质与状态变化` must be non-empty. Assembly and review check the scene state against the ledger, to prevent props that rearrange themselves and day/night mix-ups.
- Unit-level `shot_power?` (`低 / 中 / 高`, i.e. low / mid / high — shot weight; the English values `low / mid / high` are accepted too): give `高` to the scenes that carry a hook, a reversal, a crowd-pleasing moment or the payoff of a setup (more shot density and close-up emphasis); give `低` to a functional transition. A unit whose beat `function` is hook/cliffhanger/payoff gets a reminder when `shot_power` is unset or low.
- Beat-level `relationship_change?` (`变好 / 变坏 / 不变 / 不明确`, i.e. better / worse / unchanged / unclear; write these literal values, any other value gets a warning): marks a node of the relationship arc; it works together with T14's four static questions and the relationship-arc guidance in story.md.
- Block-level `complexity?` (`低 / 中 / 高`, i.e. low / mid / high — action complexity; `low / mid / high` are accepted too): a high-complexity block longer than 3 s gets a reminder to split it (same family as the rule of one dominant camera move per shot).
- v4 `props[]` accounts for every prop (write `[]` when there are none): each prop has `id,label,states[],holder,first_appearance,critical`.
  `id` is a stable ID that never changes across the film and is defined only once; `label` is the name used verbatim throughout the film; `states[]` is the enum of legal states (example values: `在鞘 / 出鞘 / 丢失`, i.e. sheathed / drawn / lost); `holder` is the current holder's `cast_id` (write the literal `无`, "none", when nobody holds it); `first_appearance` is the `sequence_id` of the first appearance; `critical` is a bool that the agent decides at planning time by whether the prop affects where the plot goes. 1–3 critical props per brief are recommended; more than 5 only gets a reminder, not a rejection. Every prop is in the ledger; the visual cards, the empty hands before first appearance and the prop expectations at review focus on `critical: true`.
- beat: `id,required_visuals,emotion,hook,stake,goals{cast_id:goal for this scene},info_gap`; v2 narrative adds `scene_id,cause,action,result,audience_before,audience_after`. episode adds `function`.
- v4 `sequences[]`: `sequence_id,segment,beat,scene_id,character_ids,prop_ids?,duration,screen_duration,setting,blocks[],notes?,prompt,dialogue[]`; narrative state adds `continuity{entry_state,exit_state,allowed_changes,cut_type}`. Optionally `keyframes,continuity_from,cast_states,static,ambient_speech_ok,voiceover`.
- v2 `shots[]`: `shot_id,segment,beat,scene_id,character_ids,prop_ids?,duration,screen_duration,setting,blocks[1],notes?,video_prompt,reason,intent,required_visuals,flexible,cut_on,continuity{entry_state,exit_state,allowed_changes,camera_relation,cut_type}`, optionally `reference_from/reference_mode,dialogue,voiceover`. Design generation dependencies and editing adjacency separately.

### T01 Prop state ledger and transfers

Props that appear in a unit are registered in `prop_ids[]`; inside the existing `continuity.entry_state / exit_state`, use the text keys `<prop_id>.state / .holder / .hand` to write the current state, the holder and the holding hand (`左 / 右 / 无`, i.e. left / right / none; these are the literal values). `state` must be one of that prop's `states[]`. `props[].holder` only provides the initial holder for the first-appearance unit and does not put the prop into the character's hands ahead of time; after that the unit ledger governs. Omitted facts carry over in unit order, but the generation prompt only consumes facts that are written out, so a real plan should still copy the full entry/exit at every cut.

When the holder changes within a unit or between adjacent units, there must be a matching text record in `allowed_changes`: `<prop_id>.holder: <giver cast_id> → <receiver cast_id>`, followed by the visible hand-over action; picking up / putting down may use `无` as one end. A record at a cut may sit in the earlier or the later unit. The prop ID, the giver, the receiver and the direction must all agree; a record that only says "the holder changes", or one with the direction reversed or the wrong person, does not stand in for the hand-over. The record still follows T06's start (reaching out) → process (mid hand-over) → landing (in hand / released) → secondary motion (withdrawing / reacting). A scene change or elided time does not replace the prop transfer record either. All structure, enum and transfer checks added by this layer are reminders; no new hard gate is added.

Example (the label, the states and the hand-over sentence are example values in the work's language; `左 / 右 / 无` are the literal hand values):

```json
{
  "props": [{"id":"sword","label":"玄铁剑","states":["在鞘","出鞘","丢失"],"holder":"a","first_appearance":"U02","critical":true}],
  "continuity": {
    "entry_state": {"sword.state":"在鞘","sword.holder":"a","sword.hand":"右"},
    "exit_state": {"sword.state":"在鞘","sword.holder":"b","sword.hand":"左"},
    "allowed_changes": ["sword.holder: a → b；阿甲伸手递出玄铁剑，阿乙左手接过，阿甲松手后回收，阿乙握稳后抬眼回应"],
    "cut_type":"continuous"
  }
}
```

### T04 Affirmative empty-hands state before first appearance

Only for `critical: true`: in every unit before `first_appearance` in which the holder appears, the unit's `setting / blocks[].picture / blocks[].action / notes` must name the holder and state the empty hands affirmatively, for example “阿甲空手站在门口，双手自然垂下” ("A-Jia stands empty-handed in the doorway, both hands hanging naturally") or “阿甲未持玄铁剑，双手空着” ("A-Jia is not holding the black-iron sword; both hands are empty"). The check recognizes `空手`, `双手空着`, `未持<label>` or the English `empty-handed`. Do not write “不要拿玄铁剑” ("do not hold the black-iron sword") or “禁止手持玄铁剑” ("holding the black-iron sword is forbidden") in place of an empty-handed picture; another character being empty-handed does not stand in for the holder being empty-handed either. A unit in which the holder does not appear needs no empty-hands description for that holder. The order of units is judged by the order of `sequences[]`, not by sorting the IDs as text.

For example, with the sword of the example above (`玄铁剑`, "black-iron sword") declared as `first_appearance: "U02"` and `holder: "a"`: `U01` writes “阿甲空手站在门口” ("A-Jia stands empty-handed in the doorway"); only `U02` registers `prop_ids:["sword"]`, the prop state ledger and the prop card, and writes “阿甲右手持玄铁剑，剑在鞘内” ("A-Jia holds the black-iron sword in his right hand, the blade in its sheath"). When, before the first appearance, the prop is already registered or described as present, the ledger already has it in hand, or the holder lacks an affirmative empty-hands statement, only a T04 reminder is given; units are not rewritten automatically and no rejection condition is added.

### Asset design fields and difference check (v7 art development system)

Source: the Updream v7 full-pipeline skill. A character is more than "age + hairstyle + clothing color" — when writing the card and `sheet_prompt`, fill in as needed:

- **Silhouette**: the outline of head and shoulders, torso, hem and limbs that sets the character apart from a distance.
- **Shape language**: circle/square/triangle and their primary-to-secondary proportions, with the personality each implies (circle = approachable, square = orderly and stubborn, triangle = dangerous and sharp).
- **Color hierarchy**: main color about 60%, secondary color about 30%, accent color about 10%.
- **Expression baseline**: one neutral expression plus one for the work's dominant emotion; no collage of exaggerated expressions.
- **Action fit**: the range of motion the screenplay's actions need; the risks of hems, hair and accessories under the key actions.
- **State traces**: visible traces left by occupation, events, scars, stains and ageing (write the traces left by important events into the character image prompt).
- **Signature elements**: 1–2 asymmetric details or bound objects that stay recognizable at any shot size.
- **Same-work difference check**: any two main characters differ clearly in at least three of silhouette, proportions, shape language, main color and signature elements — **hair color alone is not enough to tell them apart**.

**Scene card reinforcement**: add `key_plot` (a summary of the important plot events that happen in this place); the scene image prompt includes **the traces the plot leaves behind** (the mess after a fight, wet marks after rain) — scene consistency is not only space but also plot state.

**Prop classification and design sheets**: props carry `prop_type` (plot_prop / motif / weapon / document / clothing / other); on top of "one image, one prop" (T02), the design sheet adds a functional detail area (who holds, opens or triggers it, and how); **the text content of a document prop is recorded only in the plan/screenplay; the garbled text an image model generates is not readable evidence**.

**Atmosphere image (style first)**: when the world is complex or the art style is not the default, you may first produce one atmosphere concept art to lock the style — it contains a representative scene, lighting, color, materials and visual motifs; distant silhouettes of people are fine, **no specific character's face shown from the front**; do not cram in every character and prop. Produce the asset cards only after it passes.

**Fixed seven-step order for assembling an image prompt**: ① task_contract (generate only one asset now) → ② entity_design (that asset's design fields) → ③ camera_and_layout (three-view / spatial layout / prop design sheet) → ④ continuity_lock (the identity, anchors and states that must be kept) → ⑤ style_lock (the full text of style_preset; **pass the expanded content, not just the ID — the model cannot read an internal list**) → ⑥ local_style_patch (only the items this scene is allowed to change) → ⑦ negative_constraints. **A single-entity prompt contains no description of other characters, scenes or props.**

**Art development QC**: check before generation — can the characters be told apart by silhouette, does the costume structure support the screenplay's actions, does each signature element have a narrative source, is there any unsourced mix of periods or cultures; check after generation — the three angles are accurate, the proportion baseline is consistent, the structure is closed, there are no extra people.

### The eight elements of image generation (common skeleton of every image prompt)

Source: Updream's "image prompt optimization" skill (third in the whole library by activation count). Character cards, scene boards, keyframes and atmosphere images all go through these eight items, **and none may be missing** — fill in whatever was not given with a reasonable default:

1. **Subject**: specific down to pose, facing, expression and surroundings (not "a girl" but "a short-haired girl in a beige knit sweater, turned sideways and looking back, by a café window").
2. **Style decision**: state the main style decisively (photoreal photography / 3D / anime / watercolor / impasto …), adding a secondary influence when needed.
3. **Color analysis**: main color + accent color, warm or cool leaning, type of contrast (high-saturation color clash / low-saturation refined greys / single-color dominance).
4. **Light direction**: where the light comes from, hard or soft, time of day, lighting type (side light / backlight / Rembrandt), tonal strategy (high key / low key).
5. **Composition**: shot size, camera angle, the subject's position and share of the frame, foreground/midground/background layering, depth of field.
6. **Texture and detail**: surface material (matte / frosted / metal), detail density, grain / brushwork, key post-processing.
7. **Atmosphere and mood**: carried by the six items above, not settled by writing a single emotion word.
8. **Resolution**: aspect ratio + sharpness spec (defaults by use: portraits lean vertical, landscapes lean horizontal).

**Fixes for the five kinds of weak prompt**: too brief → expand along the eight elements; a key dimension left hanging → disambiguate and lock one explicit value; imagery/abstraction ("loneliness", "the alienation of cyberpunk") → make it concrete as a drawable subject, light, color and composition; piled-up and chaotic → fix the subject and the main style and delete the contradictory items; already good → only sharpen it, do not tear it down.

**Three priorities for reasonable defaults**: consistency with the clues already given ("ink wash" does not go with impasto) > the most common and most stable reading > output quality. After filling in, list in the delivery note the key assumptions made on the user's behalf.

**Fingerprint words** are more precise than piling up adjectives: photographic portraits use focal length and film stock (`85mm f/1.4`, `Kodak Portra 400`), 3D uses the renderer (`blender style`), designer toys use (`bubble mart style`, a 1:1 head-to-body ratio) — pick the jargon by image type to steer the model precisely onto the style.

**Four principles for the final text**: main things first, secondary things after; concrete beats adjectival ("warm light" is weaker than "soft sunset side light from the upper right"); do not overload (the model cannot find the point among thirty adjectives); no contradictions. Self-check: **hand this prompt to an artist who has never seen the picture in your head — could they draw that image from it, with none of the eight elements missing?**

## Story layer

Beats also carry `emotion,hook,stake`; the 1–3 key characters carry `motivation{want,need,flaw}` and named relationship objects, with functional `extra` roles exempt from want/need. Beats are planned at least one per ~15 s and per covered scene, and `shots[].intent` states narrative duty in at least 25 characters. `creation_plan_validate` keeps the core motivation/turn checks and reminds speaking extras of their dialogue boundary; see [story.md](story.md) for definitions.

T14–T17 additional contract: `relationships[{a,b,a_wants,b_wants,why_exclusive,a_fears,b_fears,end_change}]` gives the protagonist of a narrative film and each supporting/antagonist the full four core relationship questions; an antagonist writes `cast[].justification`. Every beat writes `goals` and `info_gap`, and the speaking characters present have different goals for the scene. A key character's motivation gains `flaw_beat`, and the action/cause of that beat names the character's bad choice; the optional `pressure_rule` uses "trigger → judgment → action → cost". The prop bound by the optional `nexus{beat,choice,prop_id?}` is automatically treated as critical and marked `requires_visual_lock:true`; path-based `creation_plan_validate` (called with `shotlist_path`) saves these two effective flags back into the plan, even when the prompt is already compiled. All new findings go only into warnings; the earlier layers' motivation, turn, duration and prop checks stay.

Narrative plans are cut from `out/screenplay.md` (or the path in `screenplay`): `segment` names the screenplay segment a unit films, `blocks[]` are its shots, and `prompt`/`video_prompt` is compiled from `setting`, `blocks` and `notes` by `creation_plan_validate`; see [screenplay.md](screenplay.md).

`duration` is the generation service's integer seconds; `screen_duration` is the expected used length and may be shorter than the media. Generation-service reference limits, real paths, budget and review versions are the execution contract; genre-specific directing constraints are controlled by `format`. Do not mask a discontinuity by changing ids or scene names.

## Candidates and budget

### T18 Tentative handling of photoreal human requests

In a session that **already has authorization to continue**, a request for photoreal human faces is downgraded by default to "stylized characters with photoreal texture" (the tool writes this label as `写实质感的风格化人物`), marked `暂定` (tentative), and work continues without stopping to ask. A blocker is kept only when the user's original brief explicitly insists on real human faces (for example "must be photoreal real people, stylization is not accepted"); an ordinary preference for a realistic style is not insistence. Animals, landscapes, products and other subjects without real human faces may still use a photoreal style.

The plan keeps the original brief in `user_brief`, and `continue_authorized:true` records that the session already has authorization to continue. `insist_photoreal_humans:true` is only for the case where the original brief explicitly insists on real people, and must not be set to true automatically from the single word "photoreal"; when it is not set explicitly, explicit insistence in the original brief is still recognized. When the session already has the authorization, fill it in directly and do not ask again. A missing authorization flag only gets a reminder and adds no blocker.

The compatible branch saves `style_resolution{status:"暂定",requested_style,effective_style,style_preset,delivery_note}` and `delivery_notes[]`, and changes the effective `style_preset` to a treatment with photoreal materials/lighting and stylized, non-photoreal faces. Path-based plan validation and the later public creation entry points save the decision back into the plan; an image call that omits the style or still writes a real-person style uses this tentative preset. The plan report, the generation results and the assembly results carry the same `暂定` (tentative) delivery note, and the final delivery states plainly what was changed and why. Repeated validation does not add the note again.

The agent, in step with this, makes the character treatment in the style_bible, the character cards and the free-text prompts consistent with the tentative style, keeping the original story, relationships, costumes, light direction and actions; existing reference cards with real human faces must actually be viewed as in T11, replaced with compatible references as needed, and accepted again. The tool does not batch-rewrite these free texts, and it neither adds generation calls automatically nor promises that the material is already compatible. The explicit-insistence branch reports a blocker and keeps the user's requirement; it does not pass off a silent change of art style as completion.

`shots[]` in `video_generate` are generation requests: each item's `shot_id` refers to a logical plan unit (v4 also uses the sequence_id value), `take_id` identifies an immutable candidate, plus `prompt,duration,reference_images[{path,role}],dialogue_audio?/voice_ref?` and optional `reference_take_id,reference_mode`. A project has one candidate directory and one cumulative budget shared by generation and editing; changing `output_dir` or moving the plan does not reset it, and a separate budget needs a separate project. The tool reads caps from the plan. Changing a plan unit, reference bytes or the generation request requires a new take id. Failed and interrupted requests also consume budget. Retrying the same take resumes its already-submitted task (polling until it is ready, terminated or times out) instead of resubmitting; switch to a new take only when the task failed on the server. `concurrency`, `max_shots_per_call`, `timeout_seconds` and `poll_interval_seconds` only control execution and are not part of candidate identity. A request item's `continuity_from` uses the upstream clip's last frame as a world reference: prefer the recorded upstream `take_id` (when a unit id is given, the most recent clip for that unit in `clips.json` is used); candidate identity binds that clip's SHA, and resuming the same task keeps the already-bound upstream candidate. `continuity_from` in the plan is used only for planning validation and is not added to requests automatically.

Small-batch generation is for catching identity/voice/state defects early; batch size is determined by complexity and provider/profile limits. The tool sets a hard cap per call: by default 2 candidates for v4 plans and 4 for v2/v3, explicitly adjustable via `max_shots_per_call` or `VE_CREATION_MAX_SHOTS_PER_CALL`; exceeding it errors before any submission. On failure, locate the cause first and change references, instructions, performance duration or segment selection; avoid retrying the same defect unchanged.

For a unit without dialogue, set `generate_audio:false` in the `video_generate` call as needed, so the model does not add dialogue or music on its own; keep native audio when ambient sound, action sound or an in-clip inner voice should be kept. The switch applies to the whole call, so a mix of sounding and silent units has to be split into batches as needed; do not switch off the dialogue of the same batch for the sake of one empty shot. The plan and generation entry points only remind and do not change the switch automatically; voice-over can keep using the existing voice_clips at assembly.

### Session clock and converging on delivery (time discipline)

Long sessions are timed by the plugin's `session_clock` hook: it checks after every creation tool call and, once the session has run for 180 minutes by default (adjustable with `VE_SESSION_SOFT_DEADLINE_MINUTES`; ≤0 disables it), injects a soft-deadline reminder into the session about every 20 minutes. The reminder is not an error and blocks no call; it belongs to the same family as budget discipline — in the 11-09 runs both arms died from "a verify/redo loop burned through the wall clock, the session was killed, and nothing was left", whereas the agent did obey the budget clause. On receiving the reminder, if `out/preview.mp4` has not been delivered yet: **stop submitting new takes and new verification rounds**, finish assembly, rendering and delivery with the footage that has passed review so far, and truthfully list in the delivery report the unresolved units and the improvements that were given up — leaving a result before the time burns out beats having nothing after it does. If the reminder arrives after delivery, just wrap up normally.

### Fallback discipline for content-blocked images

`image_generate` returns the items blocked by content moderation as a structured `blocked` list (`moderation_blocked` / safety-type errors). On receiving blocked, the same asset gets at most two fallback attempts: ① **one desensitizing rewrite** — remove the triggering wording (age references, violent detail, descriptions of skin) and keep the design intent; ② if it is still blocked, **change the composition/asset direction once** (close-up → full body, two people → one person, adjust the clothing layers); ③ if it is still blocked, **stop**: report the blocker and the blocked asset, continue with the other assets, and do not retry in a loop (the official failure-handling pattern: rebuild the same request only once, and stop if it still fails after the correction). If the blocked asset is a critical prop card or a character's main card, note it in the delivery note following T18's tentative approach; do not pass off a silent design change as the original design.

## T11 Image viewing confirmation

After keyframes, state cards and critical prop cards are generated, the agent must actually view and confirm them before moving on to assembly; the file existing, a successful decode, and the automatic aspect/panel-grid checks passing do not count as content acceptance. First write the image path and its unit / character-state / prop binding into the plan, then call `creation_verify action=image_prepare`, actually read the returned image, compare it against the checklist, and record it in the ledger with `action=image_record`. Keyframes and prop cards are checked for a single frame / one image, one prop; a state card's multi-view layout is explained according to the character asset contract, and a compliant three-view is not treated as a panel-grid defect. On failure, or when observation is impossible, truthfully record fail/uncertain; after replacing the image, view it and record again.

`image_prepare` takes `image_path,image_kind:keyframe|state|prop,shotlist_path?`; it returns the image and an `evidence_signature`, and the ledger entry is still pending. `image_record` uses the same path/kind/plan and the signature, and submits:

```json
{
  "action":"image_record", "image_path":"out/creation/images/prop_letter.png", "image_kind":"prop",
  "evidence_signature":"value returned by prepare", "viewed":true, "image_verdict":"pass",
  "checks":{
    "identity":{"ok":true,"evidence":"pure prop card, no character identity to check"},
    "state":{"ok":true,"evidence":"the old letter is fully unfolded, matching its current state in the screenplay"},
    "props":{"ok":true,"evidence":"only the old letter is in the picture, no extra prop or holder"},
    "count":{"ok":true,"evidence":"exactly one old letter, no ghosting or duplicate"},
    "single_frame":{"ok":true,"evidence":"a single design image of the old letter, no panel grid or collage"}
  },
  "notes":"Actually read the old-letter prop image: unfolded state, count of one, label and design match the plan."
}
```

The confirmation record carries the image bytes, the relevant plan context, the viewing declaration, the per-item observations, the time and the history; replacing the image at the same path or changing the relevant state prompts a new acceptance. `viewed` is the agent's declaration that it actually viewed the image; the tool does not look at the image for the agent. Under this layer's "zero new hard gates", a missing/failed/stale confirmation only gets a reminder at the generation and assembly entry points; this is a workflow responsibility, and a successful tool call must not be treated as acceptance.

When the same failure tag of the same critical prop appears on at least two different takes, the tool returns the advice “先改参考图再重试” ("fix the reference image first, then retry"). A failed `checks.props` writes `prop_ids:[prop ID]`, or names the fixed ID/label in the evidence, so that another prop's error is not attributed to it; re-reviews of the same take are not counted again. This is advice to repair the reference image; it does not force a redo and adds no generation call.

## Fidelity contract for redraws and repairs (supplementary cards / state cards / action=edit)

Source: the character-redraw reference of the Updream script-planning skill and the v7 art system. Any redraw of an existing asset (adding a back/side card, a state card, a local repair) is **a constrained edit, not a reinterpretation**.

**Redraw contract (only these may change)**: the confirmed new pose, unavoidable perspective and occlusion, anatomically necessary limb visibility, pose-driven cloth folds and tension, hair motion driven by pose/gravity/wind, and the way unchanged props are gripped and occluded in the new pose. **Everything else is locked** — "similar", "recognizable" and "roughly the same design" do not qualify.

**Fidelity contract**: with the original canonical reference as the baseline, check section by section — face (shape / feature proportions / eye color / skin / age markers) / hairstyle (parting / outline / length / fixed ornaments) / build (head-to-body ratio / shoulders and hips / limbs) / each clothing layer (layering / neckline / cuffs / closure / pattern) / color scheme (main, secondary and accent colors; sample the colors when the tool allows) / rendering (line weight / shape language / shadow quality) / left-right asymmetric features. Mark each item confirmed / partially_visible / unknown; then pick **5–10 identity-critical features as priority anchors** and compare them one by one after the redraw.

**Prop count conservation**: the final visible count must equal the canonical count — one prop does not become a pair, no background copies are added, and no prop is borrowed from the pose reference. When the requested pose occupies the prop's position, do not remove it silently: choose one of switching hands / placing it beside the body / explicitly removing it, and record the choice in the plan.

**Unknown-detail policy**: never invent an unseen back, a clothing lining, a shoe sole or the reverse side of a prop and then claim it was "preserved" — that is fabrication. When the pose depends on a hidden design: ask for a reference from another view, or choose a pose that keeps the unknown area occluded; a minimal neutral continuation is used only as a last resort and must be disclosed.

**Five reference roles**: canonical_character_reference (identity / design / color / props / art style) / pose_reference (gives only the pose and the contact geometry) / style_reference (gives the rendering language, only when a style change is explicitly requested) / accepted_derivative (an approved pose/style state) / repair_mask (limits the editable pixels only). A pose reference must not contribute face, clothing, build, color or props; repeat the role mapping in the prompt.

**Additions to the T11 acceptance comparison**: when viewing a redrawn result, check — the identity is still the person of the canonical reference (not of the pose reference); the locked items are compared section by section; the prop count is conserved; unknown areas have not been "filled in"; the priority anchors match one by one.

## Candidate review

`creation_verify {action:'prepare',take_id,shotlist_path?,takes_path?}` returns `evidence_signature`, logical expectations, consecutive frames, and ASR/voice/motion diagnostics. A successful prepare only means the evidence was generated. Record after reading the images, action and audio:

```json
{
  "action": "record", "take_id": "unit1_t1", "evidence_signature": "value returned by prepare",
  "overall": "pass", "checks": {
    "identity": {"ok": true, "evidence": "grid 1 cell 2 t=0.5s: observed match"}
  },
  "performance": {"required_visuals":"pass", "causality":"pass", "intended_effect":"pass"},
  "usable_spans": [{"start":0.3,"end":5.4}],
  "notes": "Describe concretely what was seen and heard, and any remaining sampling limits."
}
```

The example shows only one check; an actual record must answer every dimension prepare lists: lipsync, speaker_identity, voice, identity, traits, wardrobe, props, presence, relations, scale, physics, continuity, motion. For non-applicable ones, write evidence with the reason. Failed items carry tags from the defect_tags returned by prepare and cannot be overridden by overall=pass. Voice: a similarity to the voice card at or above the evidence's `fail_below` passes (0.50 for the default CAM++ scorer; state the score and scorer — generated takes re-voice the line, so scores just above the line are normal); below `fail_below` is an automatic failure; when the score is missing, say so and do not pass. Never fake listening. Severity and minor defects follow [verification.md](verification.md#severity-what-makes-a-take-fail).

A passing verdict is bound to the candidate, its plan and references, the evidence it was based on and its usable spans; replacing any of these files at the same path invalidates the review, and assembly rejects candidates whose references changed (restore the original files or select a new take). `status` summarizes the ledger; `speech`/`voices` only provide additional automatic diagnostics and cannot bypass candidate review.

## Assembly and full-film review

`creation_timeline_build` takes `shots[{shot_id,take_id,clip,trim_start,trim_end,segment_id?,speed?,reason,speech_in_clip?,volume?}]` with take_ids, bound to the current `takes_path,shotlist_path,verdicts_path`. Candidates and the selected source ranges must have a current passing review. Multiple selections may come from the same logical unit; each needs its own segment_id. Input voiceover goes in `voice_clips`; music, only when the brief asks for it (see [standalone.md](standalone.md)), uses an explicit `bgm` file.

In-clip dialogue keeps the sync audio track (with the current silent generator, that track is the clip's own line audio laid back at assembly, see [generators.md](generators.md)); to add subtitles, first get real ASR, or transcribe the final video and then use the public subtitle workflow. Timing estimated by `subtitle_text` allocation is not a verified subtitle and is not used in this workflow.

T21: non-dialogue footage that comes with unwanted music may also be judged `mute_audio`; actually hear the audio defect and state it; music that has a source inside the story is kept as the screenplay says. Lay a **same-scene ambient bed** under muted segments: extract ambient sound without dialogue or music from the existing footage of that scene, lay it on the audio track of the shared timeline by its actual source range, and check the level and the cut points. Sound from another scene or BGM cannot stand in for the ambient bed; when no usable ambient sound exists, explicitly keep the silence and record it in the delivery note. The assembly entry point only reminds and does not generate, download or synthesize new sound automatically; after changing the audio track, go through timeline_validate, render/QC and listening back to the finished film as before.

Render/QC use the public tools. `creation_review action=prepare` takes `timeline_path,shotlist_path,render_path` and returns the final package signature, cuts and per-cut images. The verdict file contains `package_signature,cuts[{cut_id,signature,verdict,notes,checks?,repair?}],film{verdict,notes,checks{story_clarity,pacing,intended_effect,audio_coherence}}`; a cut's `checks` must answer the list in the package's `cut_checks`, with reasons for failed/non-applicable items; a cut with overall `verdict:not_applicable` also needs an `exemption`, and the film verdict cannot be not_applicable. Repair routes for failures are reselect/edit/regenerate/replan. `creation_review action=validate` only validates coverage, versions and consistency; the main Agent is responsible for the truthfulness of the judgments.

The plan, input media and output reports/sidecars must use different paths.

A candidate review covers the linked beat, current cast state, character relationships and voiceover/keyframe content; changing referenced content requires a new prepare/review. Unreferenced future beats and states can evolve independently. A final subtitled video can go directly into creation_review.

When there is an audio track but ASR is unavailable, keep warn/unverified; it cannot prove there is no voice. A legitimately empty transcript is handled separately from having no audio track. With no scripted dialogue and no audio track, the technical silence check can pass; if the script requires dialogue but there is no audio track, it fails. Speech hints must still be combined with formal candidate review; the `speech` report is per take.

Unit and take ids must be safe single filename components.

`voices` compares only current, valid voice evidence: `unavailable` means missing or stale evidence (re-prepare), `excluded_thin` means less than 3 seconds of voice. Non-empty text-only ASR is still dialogue and cannot be treated as silence; without time segments you cannot claim sufficient voice coverage.
