# Verification: who judges, how it is dispatched

`creation_verify` prepares evidence and validates the record; it does not judge content.
Someone has to actually read every grid and check every line. A main agent that judges its
own takes tends to pass them from a few sparse frame reads and skip the voice check, so judging
is delegated to a dedicated judge, and the main agent keeps the bookkeeping and the production
decisions.

## Roles

- **Main agent**: prepares the evidence of each take, dispatches one judge per take, records
  the judge's verdict file in the ledger unchanged, and decides what to do with the result.
- **Judge** (`agents/creation-verifier.md`): reads the evidence file and every grid of one
  take, writes one verdict file, and ends. It never prepares, records, generates or edits.

Spawn the judge by its role: agent type `creation-verifier`. The runtime installs the
definition as that role, so the judge starts with its own instructions. Do not spawn a generic
sub-agent and paste the definition into the message instead.

## One take, one fresh judge

- For each take, start a new judge and give it only that take. When its verdict file is
  written, the judge is finished: close it and never send it another take, a follow-up or a
  question. A regenerated or edited take, a reassessed take and a rejected verdict each get a
  new judge.
- A judge that has seen other takes carries their grids and opinions into the next verdict, and
  its context grows with every take. A fresh judge starts small, which also keeps the cost per
  take low.
- What the judge needs from earlier rounds travels in the dispatch message (the previous
  verdict from the ledger), never in a judge's memory.

## The dispatch message

Every message to a judge uses exactly this template and nothing else:

```
take_id: <take id>
evidence: <evidence path returned by prepare, e.g. out/creation/verify/U008_t3/revision-1/evidence.json>
plan: <shotlist path> (shot_plan_sha256 <value from the evidence>)
previous_verdict: <the ledger entry of this unit's previous take, copied verbatim> | none
record_error: <the tool's rejection message, copied verbatim> | none
verdict_file: out/creation/verdicts/<take id>.r<review revision>.json
```

Do not add opinions, reasons, expected outcomes or calibration advice ("this is acceptable",
"check whether your failure is too strict", "the director allows this cut"). When the
requirement for a unit changes, change the plan, run `creation_verify action=prepare
reassess=true`, and dispatch a new judge on the new review revision; the plan and the evidence
carry the change.

## Bookkeeping by the main agent

Creation tools share one project lock, so prepare and record calls stay in the main agent, one
at a time:

1. `creation_verify {"action":"prepare","take_id"}` for each take as soon as it is downloaded.
   The evidence file and grids are written under `out/creation/verify/<take>/revision-N/`.
2. Dispatch one judge per take with the template above.
3. When a verdict file appears, pass its content unchanged as the arguments of
   `creation_verify {"action":"record", ...}`. Never edit a verdict, fill a missing check or
   soften a failure. If the tool rejects it (missing check, stale signature, rule violation),
   dispatch a new judge with the rejection in `record_error`.

Judges only read and write their own verdict file, so several can work in parallel while the
main agent keeps preparing and recording.

## When and how many

- After every generation batch, as soon as the takes are downloaded. Do not wait for the
  whole act: identity, voice and state defects found early cost one take; found late they cost
  a chain of them.
- Run 2–3 judges at a time. Never hand the same take to two judges.
- Order generation and judging by the plan's dependencies, not by shot number:
  - **Independent units** (each unit has its own keyframe/cards and no `continuity_from` or
    `reference_take_id` pointing at another unit's take — typical of v2 `shots[]` plans): any
    unit can be generated, judged and regenerated on its own. Judge them in parallel and keep
    generating the next batch meanwhile. Start with the riskiest units (hard interactions,
    readable screens or text, prop hand-offs) to learn early whether the approach works.
  - **Chained units** (a unit takes `continuity_from` or `reference_take_id` from an earlier
    unit's take, or continues a camera take): within one chain, generate the next unit only
    after the one it depends on has a recorded passing verdict — a later regeneration upstream
    would invalidate everything built on it. Different chains are independent of each other.
- The main agent does not read the grids itself while a judge is on the take. After recording,
  it decides per take: `pass` → eligible for `creation_timeline_build`; `regenerate` with a
  `change_plan` → a new take with the one named change (or `video_generate action=edit` for a
  local fix where the generator supports editing — the current one does not) (same request resubmitted is a coin flip, not a retry); `mute_audio` → usable with its
  own audio dropped at assembly. Exhausted budget → report the unit as unresolved, never pass it.

## Severity: what makes a take fail

T11: keyframes, state cards and critical prop cards go through a separate flow, `creation_verify image_prepare → actually view the image → image_record`, and the main agent records the image observations; a returned image or a successful decode is not acceptance. For a props failure on a candidate video, write `checks.props.prop_ids` (or name the fixed ID/label in the evidence). When the same kind of defect on the same critical prop appears in at least two different takes, the first suggestion is “先改参考图再重试” ("fix the reference image first, then retry", the wording the tool returns); it is not a mandatory repair route and adds no verdict dimension.

T21: non-dialogue footage that comes with unwanted non-diegetic music may be judged `mute_audio`; write the evidence of what was actually heard under the `other` tag of an audio check; this must not cover up a visual defect or throw away required dialogue. After assembly, listen back to the same-scene ambient bed, or truthfully note the silence treatment; see [production.md](production.md#assembly-and-full-film-review).

Regenerate only for defects a viewer notices or that break the story:

- broken bodies: extra or missing limbs, merging, clipping, distorted anatomy;
- a duplicated character, or a person the plan does not have;
- a line from the wrong person, or the speaker off screen while the line plays;
- speech in a take without dialogue, or a scripted line that is not spoken;
- a frozen or sticker-like stretch that `usable_spans` cannot cut away;
- the unit's story point is not readable: the action or reaction it exists to show is missing;
- a prop the screenplay names as key to the plot is missing;
- a contradiction of what the plan declares: the unit's `entry_state`/`exit_state` (who holds
  which prop, how many people are present, costume), or a main character's costume and look
  against the current state card;
- a number or text the story turns on is wrong (a rank, an amount, a name on a sign).
- in a fight or chase: a blow lands with no reaction from the body it hits, or a body changes
  place with nothing moving it there (fail `physics` or `continuity`, not `minor:`).

Everything else is a minor defect, i.e. details the plan does not declare: background people's
costume trim, interface icon styles, eyeline direction, proportions in a stylized look (scale is
a defect only when the story depends on it, e.g. the fox must read clearly smaller than the
tiger, not an exact ratio), counts of undeclared small things, a mouth closing slightly early,
and actions in a different order that still read.
A minor defect passes: answer its check `ok: true` with evidence starting `minor:` and the cell
it shows in, and set `usable_spans` to cut those seconds when that is possible.

Each unit gets at most three regenerations. After the third, the main agent takes the best
existing take, cuts around its defects, and lists them in the delivery note.

## What the judge checks per take

Thirteen checks, each with grid-cell evidence or an explicit `n/a: <why>`:
`lipsync, speaker_identity, voice, identity, traits, wardrobe, props, presence, relations,
scale, physics, continuity, motion`; plus `performance` (required visuals, causality,
intended effect) and `usable_spans` (the windows where the action or line actually plays,
not lead-in and tail holds). Objective diagnostics from prepare — transcript overlap,
voice similarity to the character's voice card, frozen spans, blank frames — are auto-fails
the judge cannot overrule. `voice` is one take against the character's card; it says this
line is this character. It does not say the character sounds the same across the whole work.

### T05 Do the props match the ledger

The `props` check gains the question "**do the props match the ledger?**": for `critical: true`, check item by item that the state, the holder, the holding hand (`左 / 右 / 无`, i.e. left / right / none), the count (the same prop should be **1**) and the design card agree. Non-critical props are still all entered in the ledger, with no added item-by-item strict check; the count of ordinary small background objects is not upgraded to a defect by this.

The full-film `creation_review action=prepare` reads the T01 state ledger live from the current plan and outputs `clips[].prop_expectations.entry_state / exit_state`, each row containing `id,label,state,holder,hand,count`. Only the critical props that appear in the unit are listed; a prop that has not yet appeared before its first appearance is not included in the count-1 expectation. A cut's `prop_handoff.left_end / right_entry` take the exit state of the left side and the entry state of the right side respectively, and the reviewer compares the images against them; no second prop state table is maintained. An unregistered state/holding hand keeps `null` or the original wrong value and gets a `warnings` reminder; it must not be guessed into some enum value / left hand / right hand; when the ledger writes `holder: "无"` and no hand is specified, the holding hand is naturally `无`. After changing the ledger, prepare again; the existing file signatures invalidate the old full-film review package.

Example (the label and the states are example values in the work's language; `右` is a literal hand value):

```json
{"entry_state":[{"id":"sword","label":"玄铁剑","state":"在鞘","holder":"a","hand":"右","count":1}],
 "exit_state":[{"id":"sword","label":"玄铁剑","state":"出鞘","holder":"a","hand":"右","count":1}]}
```

The full-film package's `check_questions.props` gives the reviewer question above (the tool emits it in Chinese, beginning “道具与账一致吗”), and `defect_tags.props` keeps the existing tags and adds:

- `prop_duplicate`: two items of the same stable-ID prop appear in the picture, forming a duplicate.
- `prop_count_wrong`: the count in the picture differs from the expected 1; it may be recorded together with `prop_duplicate`.

Write a wrong visible count, the moment it appears, and holding-hand or state differences into the observation/defect record of the existing `props` check; whether to repair is still decided by this file's story-impact and severity rules. T05 adds no required verdict dimension and no automatic rejection; the existing `cut_checks`, the thirteen per-take checks and signature validation stay. The output entry point of this structure and of the new tags is the designated full-film `creation_review`; the prepare/tag registry of candidate `creation_verify` is in `creation_evidence.py`, and its interface is not changed within this layer's file scope.

Voice evidence: `objective.voice` names the scorer and its `fail_below` line (CAM++, the
default scorer: 0.50). A similarity at or above `fail_below` to the character's card passes
`voice`. Generated takes re-voice the line, so good takes often sit just above that line, below
`ok_at`; that range is normal for generated speech, not suspect, and needs no listening. Below
`fail_below` is an automatic failure; no score at all is missing evidence. There is no pending
verdict for voice. Scores are only comparable on the scale of the scorer that produced them.
When the generator returns silent clips (`objective.clip_audio: silent_generator`), nothing is
heard in-clip: the line in the film is the speaker's TTS line laid in at assembly, the clip was
performed to it, and `objective.voice` (basis `tts_line`, one row per speaker) scores that line
against the card. The same rule applies; `lipsync` is judged on the frames — the mouth moving in
the line's rhythm, closed for an inner voice.

## What stays with the main agent

- Cross-take voice consistency before assembly: `creation_verify action=voices` compares the
  current, valid speech evidence of all takes per character; `unavailable` or `excluded_thin`
  means re-prepare or listen, not pass.
- Choosing which passing take and which `usable_spans` go on the timeline, and the full-film
  review (`creation_review`) after rendering — cut evidence comes from the final timeline and
  the real rendered video, not from candidate grids.
- Budget: judges do not spend generation budget; every edit or new take the main agent
  orders does. When it is exhausted, the delivery note states which units remain unresolved
  and why.
