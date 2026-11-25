# Screenplay and shot blocks

A narrative piece (`drama`, `film`, `episode`) is written as a screenplay before it is planned. The user's brief is a story outline or a request, not a screenplay: turn it into one, then cut the plan from it. `creation_plan_validate` checks the plan against the screenplay and refuses narrative plans without one.

## Writing the screenplay

Save it as `out/screenplay.md` (or name another project path in the plan's `screenplay`). Write it in the language of the piece. It is a sequence of segments; each segment is one continuous stretch of story of at most 15 s of screen time (the example is from a Chinese-language piece):

```
第2段（约14秒） 日 内 社团活动室
人物：林小溪 周哲
△桌上三瓶水样。林小溪把三份水样滴在白瓷片上，凑近观察。
林小溪：第一步，感官初筛。河水样浑浊泛绿，要怀疑富营养化。
周哲（将信将疑）：泛绿就是脏？
林小溪（OS）：光看颜色还不够。
```

- Heading: segment number, estimated seconds, day/night, interior/exterior, place. English headings work too (`Segment 2 (~14s) DAY INT. club room`).
- `人物` (the cast-list label; `角色`, `出场`, `Characters` and `Cast` are read the same way) lists who is on screen.
- Lines starting with `△` are action: what is visibly done or changes, in the order it happens.
- Spoken lines are `name：line`, with an optional parenthetical for delivery or action (`周哲（皱眉）：…`, where `皱眉` means "frowning"). Mark an inner voice `（OS）` and off-screen narration `（VO）`.

Write the whole story at this level before any shot: the opening question in the first segment, the conflict and its escalation, the turn, and the landing. Every segment should move something: a line that changes the situation or a visible action with a consequence. A segment that only shows a place or a mood is a candidate for cutting.

### Reaching the requested length

When the user asks for a length and the brief's own events do not fill it, the screenplay is where the length comes from — but by **inventing and detailing more of the story**, never by repeating or stretching what the brief already says. The brief is a contract on what must happen, not on how much of the story there is.

- Count what the brief actually gives: distinct events, speaking characters, turns. A brief with three events and no dialogue is a two-minute story — so build the missing minutes out of the same world: a stubborn obstacle before the goal, a secondary figure who resists or misreads the protagonist, a cost paid on the way, a false resolution that is taken back, a quiet scene that shows what is at stake for someone else, a decision made twice with the second one different.
- Every added segment must still carry a change: a line that alters the situation, an action with a consequence, information the audience did not have. Adding a beat that only repeats the previous beat at a slower pace is the failure mode — it reads as padding even when the shot count looks right.
- Keep the brief's fixed points: its characters, its ending, what it says is never revealed, its style. New material serves those; it does not contradict or extend past them.
- Write enough segments that the estimated seconds add up to the requested length before planning, and say in the section heading how the extra material relates to the brief (a pressure added, a witness introduced, a cost paid).
- If the length cannot be reached without contradicting the brief, deliver shorter and say so in the delivery note; do not repeat footage to reach a number.

### No repeated action

The same action, gesture or camera setup may not carry more than two segments in one scene. When a scene needs more time, change what is at stake in it: a different speaker, a new obstacle, an object that changes state, a response that reveals something. Before the plan is cut, read the segments of each scene in order and merge or replace any that repeat the previous one's action with only the trigger renamed ("steps, listens, looks" four times is one segment plus three replacements). Repeated footage is a hard defect at assembly: `creation_timeline_build` refuses a segment whose source range overlaps another segment of the same take, and warns when the same clip bytes are laid again under another shot or take id.

## Cutting the plan from it

- Every plan unit (`sequences[]` or `shots[]`) names the segment(s) it films in `segment` (a number or a list). Every segment is filmed by at least one unit.
- Every line in the plan (dialogue, inner voice, voiceover, block lines) is taken from the screenplay; to change a line, change the screenplay first. Screenplay lines that no unit carries are reported.
- When the story changes during production, edit the screenplay and the plan together and validate again.

## Shot blocks

Each unit describes its shots as `blocks[]`, one per shot, instead of writing them inside the prompt:

| Field | Content |
| --- | --- |
| `start`, `end` | seconds within the generated clip; blocks are contiguous from 0 and end at the unit's `duration` |
| `framing` | wide, medium, close-up…, see [generators.md](generators.md#shot-language) |
| `angle` | optional: eye level, low, over the shoulder, point of view… |
| `movement` | locked-off, push in, follow…; **one dominant movement per block** — compound moves (push then pan then rise) must be split into separate blocks; write the arc as "from [starting composition] to [ending composition], revealing [subject/information]", e.g. `slow push in, from MS to CU, locking onto CH01's trembling hand` |
| `picture` | optional: composition and what is in frame |
| `action` | what visibly happens or changes in this shot |
| `line` | optional `{speaker, text, kind}`; `kind` is `dialogue` (default, spoken on screen), `inner` or `voiceover` (both added in post, no lip movement) |
| `sound` | effects and ambience of the shot |
| `function` | optional: the shot's pacing duty, written as one of these literal values — `开场钩子` (opening hook) / `信息推进` (information advance) / `反应` (reaction) / `反转` (reversal) / `压迫` (pressure) / `爽点` (payoff) / `追看点` (keep-watching hook) / `功能转场` (functional transition). The validator reminds when two consecutive blocks are both no-information filler (a functional transition with no emotional task; it treats a block with no `function` the same as `功能转场`) |

The `action` of a handoff must state the giver, the receiver and the passing itself, laid out in four stages: **start (reaching out) → process (mid-pass) → landing (in hand / release) → secondary motion (withdrawal / reaction)**.
Literal example, from a Chinese-language piece: `甲伸手把信封递向乙；信封在两人之间移动，乙伸手托住；信封落入乙手中后甲松手；甲收回手，乙低头确认信封并点头。` (A reaches out and holds the envelope toward B; the envelope travels between the two and B reaches out to take its weight; once the envelope is in B's hand, A lets go; A draws the hand back, and B looks down to check the envelope and nods.)
When existing state or actions show that the holder changes, the validator only reminds you to check these four stages; it does not write the action for you and adds no hard gate.

The unit's `setting` opens the prompt (place, light direction, wind, wardrobe and anything that must stay fixed) and `notes` closes it. `creation_plan_validate` compiles the prompt from `setting`, the blocks and `notes`, writes it into the plan file and fills `dialogue[]` from the block lines when it is empty. Do not edit a compiled prompt by hand: change the blocks and validate again; a prompt that no longer matches its blocks is an error. A v2 shot is one camera setup and has one block.

When a unit stages a fight, a struggle or a chase, read [action.md](action.md) before writing its blocks: each block's action starts from the previous block's result, and a hit is written with its force, contact, material response and displacement.

A block with neither a line nor an action has nothing happening in it, and a block over 3 s without a line needs an action that carries the story; both are reported. Typical short-form blocks run 1.5–4 s ([story.md](story.md#density-and-pacing)).

### Duration tiers (by shot function)

Shots with different functions get different duration bands, instead of one rule for all:

- **Reaction / prop / eyeline** blocks (`function: 反应`, or an action that is mainly expression and eyes): 0.8–1.5 s — a reaction hits hard because it is short. Note that timestamps in the Seedance dialect are whole seconds (official: in units of 1 second), so on whole seconds this band is **1 s**; the validator's lower bound for reaction blocks is exactly 1 s.
- **Ordinary progression**: 1–3 s.
- **Long line** (a single block carrying 4 s or more of dialogue): 4–6 s is allowed, but `action` must spell out the internal action (gesture, movement, change of eyeline, interaction with the surroundings); standing still and reciting the line is not allowed.
- **Establishing a scene**: 1–2 s, unless the scene itself is the story hook.

### Reaction cut

After a key line lands, and after a critical prop (see the prop ledger in [production.md](production.md)) first appears, **the next block should be a reaction shot**: the expression, eyes, hands, breathing or backward step of the person who saw or heard it. `function: 反应` is meant for this kind of block. Validator reminder (not a hard gate): when the block right after a key line has neither `function: 反应` nor an expression/eyeline action, it suggests adding a reaction.

### Axis and first/last-frame continuity

- Within a scene, keep each character's screen direction stable; when you reverse it on purpose (crossing the axis, a jump cut), say so in that block's `notes`. For a jump cut write the literal `跳切` (jump cut): it is the word the validator looks for before it reminds about two adjacent blocks with the same framing.
- Adjacent blocks must join: the next block's `picture`/`action` should continue naturally from the previous block's ending picture (first/last-frame logic). This matters most for a group of continuous actions produced by splitting a compound camera move — declare the join inside the group, and at generation bind the upstream tail frame with `continuity_from` (mechanism in [production.md](production.md)).

### Cut points, hooks and the information ladder

**Five cut points** (in addition to the reaction cut):

1. After a key line lands → cut to the reaction (the reaction-cut rule in the section above).
2. After a key prop first appears → cut to the eyes of the person who sees it.
3. After a dominant character's action lands → cut to the weaker character losing balance (stumbling, freezing, stepping back).
4. After the power relationship changes → cut to a two-person or three-person relationship composition (positions and eyelines put the new relationship on screen).
5. At the end of a scene or of a 15 s group → leave a visual hook; **do not end a short-drama passage on pure environmental afterglow** (unless the environment itself is the threat or the reversal).

A cut point can also land on a micro-action (a breath that catches, eyes moving away, fingers tightening — see the "blink moment" list in [performance.md](performance.md)); the cut then has a motivation.

**What not to do in dialogue**: do not cover a whole dialogue scene with nothing but even shot/reverse-shot. Before and after a key line, insert a reaction close-up, a prop close-up, an eyeline switch or an oppressive composition, so the audience keeps getting new information every 1–3 seconds.

**Opening hook**: give the hook within the first 1–2 shots of every scene. A menu of four kinds — danger or pressure (being watched / surrounded / given an order), contrast (a dominant figure suddenly turning deferential / a friendly dinner turning into a trap), a secret (the person inside the sedan chair / an old object / someone who has been waiting all along), a desire or goal (getting close to someone / looking into what happened back then).

**Information ladder**: arrange information as a ladder instead of spreading it evenly — hook → character reaction → reveal through a prop or a line → relationship change → pressure escalates → keep-watching hook. Climb at least one step every 1–3 seconds; a step can come from a line, a look, an action, a prop, a position, a sound or spatial pressure.

**Where a keep-watching hook can land**: a new order has just been given / a prop has just been revealed / the weaker character has just realized they are trapped / the power relationship has just flipped / the next scene's action has just begun.

**Read-through formula** (read a scene's shot goals in a row): who is hooked by what → who discovers what → who reacts → how the relationship changes → why the audience wants to see the next second. If it cannot be read through, the shots are too scattered or the rhythm is too slow.

### Shot weight and causality between adjacent shots

**Shot weight**: give more weight (more shot density, close-up emphasis, rhythm changes) to scenes that introduce or reverse the main conflict, reveal hidden information, change a relationship between characters, establish a visual motif, pay off an earlier setup, carry the genre's core emotion, or carry a hook / reaction / reversal / payoff / keep-watching hook; give functional transitions less weight, unless the transition itself has a clear visual or emotional task.

**Six causal links between adjacent shots**: for every pair of adjacent blocks, check "after watching this one, does the audience know why the next one happens?" Acceptable links: eyeline (a look toward something → the next shot shows what is seen), action (a hand reaches out → the next shot shows the object or the consequence), emotion (a reaction → the next shot shows the cause or the aftermath), information (a clue → the next shot shows understanding or escalation), rhythm contrast (a long pause → an abrupt cut in; must be marked as intentional), keep-watching chain (hook → reaction → reversal → consequence → next hook).

### The environment as an actor

The background must respond to the drama; environmental details fit the place and serve the story — no decorative atmosphere unrelated to the plot. A detail lexicon for six kinds of scene:

- Stage / theater: dust in the follow spot, a curtain trembling, the wooden floor vibrating, peeling posters, backstage ropes swaying.
- Interior / massage parlor: a flickering fluorescent tube, a plastic door curtain swaying, steam from towels, streetlight coming in, a wall clock ticking.
- Palace / institution: cold stone echo, banners, ceremonial shadows, deep corridors, polished reflections.
- Street / rainy night: neon streaks, ripples in puddles, headlights sweeping past, drops on the rim of an umbrella, exhaust haze.
- Battlefield / training ground: grit, cloth banners, the wind off a blade, boot impacts, white breath.
- Laboratory / cell: glass reflections, monitor pulses, the sound of metal restraints, cold mist.

Continuity of residual motion: the things that carry over between adjacent units in the same scene — the look at the end of the previous unit, positions, the residual motion of a hem / carriage curtain / dust / rain, prop positions, background sound sources, light direction — should be picked up at the start of the next unit; a visible break is allowed only across a scene change.

### Genre visual-language matrix

The same on-screen action should get a different shot plan in different genres — look at the genre first, then design the shots (the genre comes from the brief; no separate triage step is needed). Each scene may record a `primary_genre` in `notes` (with at most one `secondary_tone` on top; the primary genre sets the rhythm and the audience's emotion, the secondary tone only colors details; **do not blend them evenly**).

| Primary genre | Space / camera | Light and color | Visual functions that must appear | Common failures |
| --- | --- | --- | --- | --- |
| Suspense / power intrigue | occluded compositions, door frames, peeking past a foreground, slow push, prop close-ups | low saturation, directional hard light, local high contrast | an anomaly hook, clues released in layers, misdirection, a reaction after a key line, an unresolved landing | revealing the answer too early; nothing but a dark filter |
| Horror / folk horror | build waiting and fear before revealing the threat; space may be deliberately obscured; a sudden change after stillness | deep shadows, limited light sources, faded materials, a local taboo color | a hint of the threat, quiet intervals, an impact point, an aftermath | high stimulation throughout, no build-up of fear |
| Comedy / light comedy | wide shots for physical gags, closer shots to collect the expression; the space laid out clearly | bright without overexposure, clear color contrast between characters and props | setup, misdirection, reaction, payoff | relying on lines to explain; chaotic cutting that makes the action unreadable |
| Romance / healing | gazes, hands, shared objects, two-person distance compositions | soft when the relationship is close, restrained and cooler when it is distant | hesitation, micro-expressions, a change in relationship distance, emotional afterglow | nothing but empty pretty pictures, the relationship does not move |
| Action / chase | lay out the space before the impact; several angles on the key impact; reaction shots to collect it | high-contrast silhouettes, directional moving light, traces of material damage | goal, obstacle, impact, counterattack, consequence | motion blur hiding the action; a confused axis |
| Fantasy / epic | establish scale, landmarks, difference in mass; rise/descend or pull back at key moments | sculptural, layered haze, a stable main color, restrained energy colors | world rules, a visual motif, a change in power, a landing on scale | piling up effects only; space and characters out of focus |
| Urban / sci-fi | glass and metal reflections, layered city depth, screen light controlling the composition | cool and warm electronic light, limited neon, controlled reflections | technical rules, the relationship between people and the system, an anomaly or a cost | neon filling the screen, lacking narrative information |

**Plot-type tags** (a unit/beat may carry one or more, to help choose shot attributes): chase / pursuit to kill, confrontation, discovery, reveal / reversal, separation, reunion, seduction / flirtation, deception, escape, ambush, negotiation, confession, mourning, comic action, fight, aftermath, transitional passage.

**Genre × short-drama rhythm**: a suspense short drama opens on an anomaly or on being watched and releases a clue or a misdirection every 1–3 s; a comedy short drama does not ruin a physical gag with fast cutting; a romance short drama moves the relationship distance with gazes, pauses, near misses and approaches; a costume power-intrigue drama films control, status pressure, prop evidence and contrasts in etiquette first, and must give a reaction after a line; an action short drama lays out the space before the impact, keeps the impact point short and clear, and lets the reaction shot make the payoff land.

## Micro-screenplay control layer and second-level beats (short-drama scale)

Before writing the screenplay, run through the control layer internally (it produces no document; it constrains the writing directly):

`genre and tone` (what the audience should feel) / `protagonist's goal` (what they actively try to accomplish in this passage) / `core resistance` (which visible person, object, rule or accident blocks the goal) / `starting state` / `key change` (the visible change caused by action or resistance) / `ending landing` (the result of the action, a reaction, a reversal or a suspense).

Minimum conditions: the protagonist's goal, the core resistance, the key change and the ending landing are all non-empty; **the ending state may not be identical to the starting state** (pure loop displays excepted); every event is triggered by the previous action, choice or consequence, and coincidence does not replace causality; when the content does not fit in the duration, cut content; do not pad.

**Second-level beat budget**: divide the target duration among 3–5 visible beats — Beat 1 hook / initial state → Beat 2 active move → Beat 3 resistance / accident → Beat 4 change / reaction → Beat 5 ending landing. Every beat must change one of action, information, relationship, emotion or situation; record start and end seconds and keep the spans contiguous, non-overlapping and summing to the target duration (this corresponds to the blocks' `start`/`end` chain). Time lines at real reading speed, and do not let a line cover the time an action needs. The middle (move – resistance – change) is the body; the opening hook and the ending landing are both short.

**Keyframe-candidate note**: a unit's `notes` may say `keyframe_candidate: yes/no + reason` — a keyframe is worth generating only for shots where the video really needs an anchored composition, a starting point for the performance, or a join across several consecutive shots; a low-cost single-shot unit defaults to 0–1 keyframes. A keyframe is a single finished-frame composition (no grid, no annotation text, no multi-panel collage); a generation request may not use a multi-panel diagram as a first frame or as a character reference.

## Sound design and scoring guidance

Source: Updream's "music and sound-effects designer" skill (cinematic-music-sound-design). Write the `music` declaration and the blocks' `sound` field accordingly.

**Spotting (the ledger of where music enters and leaves)**: for a unit that declares music, also think through — the cue's entry point, its exit point, dialogue-dense zones (no music bed), music-free zones, sync points, transitions, changes of subjective point of view, and the closing. Do not score every visible emotion; first decide what the music does in this passage: reinforce / foreshadow / counterpoint (contrast) / reveal subtext / unify a montage / transform a theme / create temporal momentum / release.

**Six ways out of a cue**: resolve before dialogue enters; cut to silence; bridge into the next scene on a sustained note; leave an unresolved harmony; land on a source sound (the sound of an object in the environment); hand the rhythm to the next scene.

**Selective sync points**: hit only on a first reveal, a decisive contact, a reversal, a visual transformation, or an emotional confirmation; **do not sync on every cut** — let some picture events pass under a continuous phrase, otherwise the score turns mechanical.

**15 s audio contract** (maps directly onto a unit of ≤15 s): one memorable audio idea plus one clear change — orientation (room tone / motif seed) → pulse/motif enters → pressure grows (orchestration or register expands) → hit/drop/reveal (the transient focus) → aftermath or sonic button (tail / silence / unresolved note). Do not force it: passages of sustained dread, realism, comic timing or deliberate silence are excepted.

**Seven uses of silence**: create anticipation, reveal subjectivity, isolate dialogue, amplify an impact, mark shock, end without a false resolution. Where absolute digital silence would sound unnatural, leave room tone or residual detail.

**Nine sound–picture relationships** (advanced use of the `sound` field): sync / foreshadow (the sound arrives before its source) / trail (the sound continues after the cut) / bridge (one sound joins two places) / counterpoint (calm music against a violent picture) / mask (a loud event hides information) / reveal (ambience drops away to expose a small sound) / substitute (the expected impact replaced by silence or an intimate detail) / motif (a repeated sound acquires narrative meaning).

**Mix focus**: for every beat choose one main focus for the listener (dialogue / source action / musical motif / environmental threat / subjective effect) and pull the other layers back to make room — do not make all layers equally loud.

**Writing the `sound` field at a higher level**: name the seven sound layers as needed (dialogue and breath / ambience and room tone / Foley of clothing and body / hard effects / designed effects / music / deliberate silence); for an important sound write its object dimensions (source, material, size and weight, distance, direction, movement, reflection, spectrum, transient and decay). **Write an impact sound as a causal envelope**: wind-up (boot pressure / fabric pulling taut / breath) → transient (a contact sound specific to the material) → body resonance (low-mids scaled to body size) → environmental response (a foot slipping / the ground / debris / water) → follow-through (a scrape / a change of grip / the ring-out) — refuse to let one generic boom do everything; secondary contacts are short and light and must not slow down a fast exchange. Available **subjective perspectives**: objective exterior, close subjective, muffled (inside a helmet), tinnitus filter, distant onlooker, memory or dream.
