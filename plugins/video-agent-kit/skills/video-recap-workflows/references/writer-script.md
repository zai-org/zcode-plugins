# Writing the Narration

You cannot write natural speech into a grid. Write the whole story as a natural spoken draft first, then place it into beats like an editor. Do not compose sentences beat by beat against the budget.

## Coordinator draft

Write the whole draft yourself from the packet, then import it; importing sends no model request:

```bash
python3 -B "$VE_RECAP_DIR/recap_script.py" import-draft --draft-file out/coordinator_draft.json
```

```json
{"schema": "recap-coordinator-draft-v1", "packet_id": "<current packet_id>",
 "draft": {"paragraphs": [{"id": "p1", "beat_indices": [1], "text": "Spoken narration only."}],
           "notes": [{"paragraph_id": "p1", "claim": "a phrase quoted from p1", "source_ids": ["D0012"],
                      "uncertainty": "what is still open"}],
           "open_questions": []}}
```

- Bind it to the current `packet_id`; paragraphs together cover every outline beat. A note's `claim` is copied verbatim from its paragraph and cites real packet sources.
- The import checks material, coverage and citations, keeps your original submission, and writes `out/draft_story.md` (spoken text) and `out/script_notes.json`. Notes and production state never enter the voice-over; prose that mentions reviews, missing footage or other production status is rejected.
- An existing draft is replaced only with `--replace-draft`; the previous draft and notes are archived. `editorial_report.json` is written on import with the per-paragraph picture budget and a length estimate.

The same quality rules apply to the draft and to the review:

- Establish early who the protagonist is, what they want and what stands in the way.
- Explain motives only where the evidence supports them. Never turn a promise into a fulfilment.
- Tell important choices, failures, reversals and the ending in full; compress repeated preparation and minor threads.
- Open on a concrete predicament. No forced rhetorical question, no spoiler.
- Give a signpost whenever the character, time or place changes.
- Vary sentence length naturally. Commentary exists only to help understanding; it does not repeat the plot, has no quota, and the ending states the result first instead of reaching for a moral.
- The total length follows the measured rate and the available footage; `editorial_report.json` shows the picture budget per beat (overlaps counted once, original audio and withheld shots deducted). It is an upper bound, not a picture check.

For pacing by genre see [rhythm_templates.md](rhythm_templates.md).

## `out/writer_script.json`

```json
{"beats": [{"idx": 1, "highlight": true, "tone": "Lower and slower here.",
  "sentences": [
    {"text": "One narration sentence.", "point": 1, "role": "cause", "visual_claim": true, "shots": ["shot_0030"]},
    {"text": "The general said only one thing: the uniform comes off, the duty stays.",
     "role": "turn", "point": 2, "visual_claim": false,
     "board": [{"text": "The general said only one thing: ", "shots": ["shot_0153"]},
               {"text": "the uniform comes off, the duty stays.", "shots": ["shot_0157"], "hold": true}]}]}]}
```

- **`visual_claim`** (required, boolean) on every sentence: `true` when the sentence presents something concrete the picture must show (who is there, what visibly happens, where, which object); `false` for reported speech, motives, commentary, bridges and atmosphere. Only `true` sentences are checked against their arranged frames, and a sentence the check contradicts is softened or dropped, so claim only what you expect the footage to show. Sentence ids are `B<beat>S<n>`, for example `B011S003`.
- **Text stays the draft.** Placement may split sentences and add references, but the spoken text and its order match `draft_story.md`. To change wording, revise the draft first, then place and review again. Do not merge several events into one sentence to save characters.
- **Place whole paragraphs.** Put a draft paragraph into one beat or adjacent beats. If it does not fit, write a shorter version of the draft; do not delete sentence by sentence.
- **`point`** on every sentence: the outline point it tells.
- **`role`** (required) is the sentence's narrative function: `setup` (identity, background), `cause` (reason, motive), `action`, `result`, `turn` (reversal), `bridge` (signpost for a change of time, place or thread), `payoff` (a planted detail returns), `flavor` (atmosphere), `comment` (the narrator's own words: unpacking a motive, pointing out a rule, a reaction, a question on the listener's behalf).
- **`highlight: true`** on 5-8 strong beats.
- Keep the remaining rules: no spoilers of later beats; a new character gets their identity before their name; minor characters stay unnamed; for phone calls, reports and off-screen voices, do not name the actor of an action you cannot see.

### Cutting and protecting

Cut only when a tool reports a shortage (`over_budget`, picture preflight issues, `footage_shortage`). Compressing to "fit the budget" removes the story's breathing room. When you must cut, go from cheapest to most valuable: `flavor` first, then repeated `action`/`result`, then whole minor threads. `setup`, `cause`, `bridge` and `payoff` are never deleted for budget, only shortened with their information kept. These are the glue of the story: a character's identity at first appearance, the cause of an event, the bridge between scenes, who "he" refers to. Without them every sentence is correct and the whole is incomprehensible. Time-translation sentences for structural devices (the flashback's "years earlier", closing an inserted thread, the cold-open payoff) are protected the same way and use `role: bridge`. Repeated commentary is the first thing to delete.

### Seams and spine

Read each beat's last sentence against the next beat's first; if the exit does not lead into the entrance, add a `bridge`. Then tick every link of `story_spine.md`: each needs a sentence that carries it, even at the cost of `flavor`.

## Shot citations

Sentence-level citations are the only source of sentence/picture correspondence.

- **`shots`** for one picture per sentence, **`board`** when the content changes inside the sentence. The `text` of the board parts must concatenate to exactly the sentence text, punctuation included. Cut where the content changes; each part's duration follows its share of characters. `hold: true` stays on that shot instead of running on.
- **`required_shot_ids`** must appear; **`candidate_shot_ids`** are interchangeable options, not all required. **`visual_requirement: "background"`** lets pure explanation, transition or commentary use related context; concrete facts and actions still need verified pictures and must not be downgraded to background to avoid the check.
- **Build a shot list per beat.** For the beat's time window, list each shot: `shot_id | duration | framing | people | action | setting`, from the F records and the coarse index; a shot in a coverage gap is never cited. Never cite a shot that is not in the list.
- **Match each sentence three ways.** (1) Dialogue hit: the line the sentence reports falls inside the shot, the strongest evidence. (2) People: the subject of the sentence must be in the shot; the wrong person vetoes the shot. (3) Meaning: the shot's action and setting fit the sentence. Ties go to a shot that gives each citation at least 2 s, then to one not yet used, then to the earlier one.
- **Order.** A sentence's shots may not precede shots already used by the previous sentence; going back in film time spoils or jumps. One continuous action may span several sentences with the same shot; the assembly report shows the actual overlap.
- **Length.** Cite 1-4 shots per sentence so that sentence duration divided by citations is at least 2 s. Avoid shots under 1.5 s. Prefer complete actions; never cut off an action's result to save seconds.
- Atmosphere sentences may cite nothing (the reel fills). A `bridge` that switches thread must cite the new thread's earliest wide or establishing shot in this beat; if none exists, soften the wording ("word reaches the old man").
- `produce_film` reports `citations` counts and `citation_violations` (per sentence: `duplicate`, `out_of_order`, `consumed`). Any non-zero count means fixing those citations and producing again; a violating sentence degrades to filler picture. Unchanged text reuses all cached speech, so this only re-assembles.

## Tone and punctuation

- **`tone`** is a beat-level delivery instruction only, at most about 16 Chinese characters (a short phrase): "lower, slower", "a little faster, push the emotion up". Write it for highlight, sad and tense beats. Never quote script words in `tone`: the instruction is sent with the sentence and the TTS may speak the quoted words aloud with no matching subtitle. Clauses that quote script words are stripped automatically and echoed in `tone_stripped`; if you see it, rewrite the tone without the words ("land the last blow hard"). Describe delivery, not narrative or acting cues, which invite the TTS to perform. "Finish in about X seconds" speeds up reliably; slowing down works only through emotional description. Slow tones lengthen the audio, and anchoring already tightens the budget for beats whose tone asks for slow delivery; just do not write those beats to the maximum.
- **Punctuate for the ear.** Without a comma, adjacent words run together into a different word or phrase. Only punctuation fixes this; instructions do not. Prefer more commas, and split a sentence that has more than three commas.
- **No embedded quotation.** Patterns like `Name: "line"` make TTS drop the attribution, voice-act the quote or invent dialogue. Narrate it as reported speech.

## Reviews

Review scope, statuses and sentence decisions: [script-review.md](script-review.md).
