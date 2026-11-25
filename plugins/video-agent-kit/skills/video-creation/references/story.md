# Story layer

Causality (`cause/action/result`, `audience_before/after`) and world state (`continuity`) say what happens and what the audience learns. The story layer says why it matters and why the audience keeps watching. `creation_plan_validate` enforces it: errors for narrative formats (`drama/film/episode`), advisories for the others. Do not start generation while it reports errors.

- `beat.emotion`: the turn the beat performs on its main character, written `A → B` (for example `强撑镇定 → 认出旧物后失守`, "holding a forced calm → breaking down on recognizing the old object"). A single adjective or a pile of moods is not a turn. A beat whose dominant value does not flip has no reason to exist: merge or rewrite it.
- `beat.hook`: the open question this beat leaves and why the next beat must follow. The last beat states the resolution instead of a cliffhanger.
- `beat.stake`: two layers. The surface goal (what the character tries to achieve right now) and the deeper cost of failing (what they would lose, tied to their arc).
- Granularity: at least one beat per ~15 s of planned screen time, and at least as many beats as scenes with coverage. A two-minute piece is therefore eight or more beats, not three.
- `cast.motivation`: `want` is the goal the character would say out loud; `need` is what they actually lack and usually do not admit; `flaw` is the trait that makes them choose badly under pressure (fear, self-deception, obsession, an old wound, a moral blind spot). `want` and `need` are required for every speaking character; `flaw` is strongly recommended.
- `shots[].intent`: the shot's narrative duty, what it does in the story (what changes for a character or the audience, and why at this point). It is not what must be seen; that belongs in `required_visuals`, and the intent may not repeat any of them. At least 25 characters. Camera and blocking go in `reason` or the prompt.

Write each beat, character and shot for itself. `creation_plan_validate` warns when two beats share almost the same `stake` or `hook`, two speaking characters share almost the same `want`, `need` or `flaw`, or two shots in different beats reuse one `intent` sentence with a word swapped: a reused sentence means the field was filled, not designed. Shots inside the same beat may be close.

## T14–T17 Four-part screenplay kit (all the added checks are reminders)

- T14 Four questions on a core relationship: the plan writes `relationships[{a,b,a_wants,b_wants,why_exclusive,a_fears,b_fears,end_change}]`. `a/b` are different `cast_id`s; in narrative formats write one entry for the protagonist with each `supporting/antagonist`, and the direction may be swapped. The two people's wants must be written as different text; `why_exclusive` names both people (by name or ID) and says why both cannot be satisfied at once; write separately what each fears losing most, and how the relationship changes at the end. An antagonist additionally writes `cast[].justification`, saying why he believes he is right. Relationship objects serve the dramatic conflict; they do not replace `cast[].relations`, which is used for visual attribution.
- T15 Per-beat goals and information gap: `beats[].goals{cast_id: goal in this beat}` writes a goal for every speaking character present in the same beat, each different from the others and not copied from the film-level want; `beats[].info_gap` says in one sentence "who knows what, and who does not". Empty goals, a missing character, identical goals or a missing information gap only get a reminder; a silent beat should also write this beat's goal for its visible actor.
- T16 The flaw lands as a bad choice: a key character's `cast[].motivation` gains `flaw_beat`, which references the id of the beat in which this flaw leads to a bad choice; that beat's `action/cause` names the character and writes a filmable action and its cost. In this first version, a missing field, an invalid reference or a character who is not named only gets a reminder; the existing exemptions for extras and `kind:object` remain. The optional `pressure_rule` is written as "trigger → judgment → action → cost", for example "is questioned → concludes the other person looks down on them → makes the evidence public first → exposes a companion".
- T17 The optional `nexus{beat,choice,prop_id?}` marks the concrete choice at which external resistance, relationship conflict and inner conflict are all activated at once. When a narrative format leaves it out, the reminder reads “建议标出三层冲突交汇点” ("suggest marking the point where the three layers of conflict meet"); once a valid `prop_id` is bound, that prop is automatically treated as `critical:true,requires_visual_lock:true` in the effective plan, follows T02's one image one object, fixed naming and same-card attachment, and enters T05's prop expectations. Props are never guessed or invented.

Before locking the plan, check it against common failures: a protagonist who only reacts and never chooses; a coincidence that solves the conflict instead of a character's action; a choice with only one reasonable option; a character who changes without cause; dialogue that announces the theme or tells the audience what to feel; a climax placed so early that the rest deflates.

## T18 Authorized requests for realistic humans

When the session already has continuation authorization, default to “写实质感的风格化人物” (stylized characters with realistic materials): keep the story, the relationships and realistic materials/lighting, and give the characters' faces a stylized, non-photoreal treatment; mark the plan and the delivery note “暂定” (tentative) and continue directly, without stopping to ask about the art style. Keep a blocker only when the user's original brief explicitly insists on photoreal real human faces and rejects the stylized substitute. An ordinary request for a "realistic style" (“写实风格”), or a "must" (“必须”) inside a story action, may not be taken as insisting on real people. For the exact authorization/marking fields see [production.md](production.md#t18-tentative-handling-of-photoreal-human-requests).

## No clichés (a list of melodramatic conflicts)

The following devices may not be used to manufacture drama in place of real conflict: a third party coming between a couple, a car accident, a terminal illness, a forced confession of love, a betrayal without cause. When strong conflict is needed, grow it out of the characters' goals, the four relationship questions (T14) and the pressure of the world (next section); do not take it from the cliché list. One more prohibition on top of the common failures: **emotional manipulation** — do not use a line or narration to tell the audience directly what to feel ("his heart felt as if cut by a knife"); emotion must be shown through filmable action and reaction.

## World-level diagnosis (realistic / non-realistic)

Before writing the screenplay, first answer the structural questions at the level of the world; the answers decide how unavoidable the conflict is:

- **Realistic**: what pressure does this era/environment put specifically on the protagonist? What unresolved problem left over from the backstory weighs on the present? Are social contradictions embedded in the relationships between characters (rather than serving as a backdrop)? How does the previous generation or the old system weigh on this generation?
- **Non-realistic** (rebirth / period costume / xuanhuan fantasy / sci-fi): what are the underlying rules, and where are their boundaries? Do the rules stay consistent midway? What structurally constrains the protagonist in this world? Does the key prop carry both a physical function and a thematic symbol?

Short dramas are mostly non-realistic — write out the three things "rule boundary + cost + taboo" clearly, to keep the setting from changing midway (limited spiritual power in the first 30 s, unlimited power-ups in the last 30 s).

## Five flaw types and gray characters

Fill `cast[].motivation.flaw` according to one of five types: fear / self-deception / obsession / trauma / moral blind spot. The flaw must be able to land on T16's bad choice.

Gray character: a character who provides the turn or the mirror at the dark-night-of-the-soul moment (and may be presented as an opponent earlier on). An antagonist does not have to be purely bad — T14's `justification` says why he believes he is right; a gray character, for their part, delivers a reversal at the protagonist's darkest moment, or reflects the protagonist's own shadow.

## Scene validity and the climax

When a scene (or a group of beats) ends, the dominant value must have flipped polarity (safe → in danger, looked down on → revered, deceived → seeing clearly). A scene without a flip is deleted, merged or rewritten — it only takes up running time.

The climax is the moment of the largest value flip in the whole film: compare the A→B span of `beat.emotion` across the film, and the flip at the climax must be the largest; if a middle beat flips more than the climax, either move the climax later or downgrade the middle beat.

## Character self-test: three conflict auditions

Before a character design is finalized (written into the plan), run it through three conflicts with different types of loss — fields being filled does not mean the character holds up:

1. **Goal frustrated**: when the surface goal is blocked, what bad choice does he make according to his flaw?
2. **Relationship collision**: when he clashes with the wants of T14's core relationship, what does he sacrifice and what does he protect?
3. **Value bottom line**: when he must choose between his bottom line and a high cost, how does he rank them?

The three conflicts must change the type of loss; they may not just repeat the same reaction in a different setting. If none of the three can be answered with a concrete action = the fields were filled, not designed (the same standard: a reused sentence means the field was filled, not designed).

## Relationship arc and OOC boundary

T14's four relationship questions are a static contract; add the dynamic evolution on top — what this relationship believes at the start, what experience causes the change, and where it ends up (linked to the beat-level relationship changes).

OOC (out-of-character) consistency boundary: for each key character write down their most stable tendency in choices, the conditions under which deviation is allowed, and the behavior that would count as OOC — as a reference for writing the performance and for the acceptance judge.

## Density and pacing

Duration is a ceiling to respect, not a quota to fill. Count the story events the brief actually provides (an event is a visible change: a decision, a discovery, a reversal, a new obstacle). When they cannot carry the target length at roughly one event per 8–10 s, either add story material that raises pressure (an obstacle, a counter-move, a misunderstanding, a cost that arrives early) without changing the brief's events, or deliver a shorter film. Never stretch thin material with holds, slow moves and atmosphere.

For narrative formats, plan picture at the rhythm of short-form drama:

- Each `Shot N (a-bs)` block inside a unit carries one beat of action or one exchange and usually lasts 1.5–4 s; a line runs as long as it takes to say plus a short reaction. Change the picture with a cut (a new framing, the listener's reaction, the object that matters) rather than a slow push or drift.
- A camera move is not content. A block whose only change is the camera is dead air unless it reveals information the next beat needs. Silence without action or reaction stays under about 3 s.
- Silent units are rare: if a unit has no line, it must hold a visible action that moves the plot. An inner voice or voiceover laid over a long silent hold is still a hold.
- The first 3 s show the conflict or the question, not an establishing view. The film ends within about 3 s after its final line or image lands, on the payoff or the open question; do not run a long hold or a departure shot after the story has ended.

At assembly, cut every unit to its active window: drop lead-in and tail frames where nothing happens, even when the take passed. When a unit's useful part is much shorter than its generated length, that is the expected outcome, not waste. Each plan unit appears in the edit once per distinct range; reusing the same footage range twice repeats the line.
