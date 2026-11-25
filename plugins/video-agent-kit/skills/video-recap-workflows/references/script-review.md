# Script Review

Close the evidence gaps for the main line, identities, climax and ending before locking the text. The review is a text and source check; it never stands in for watching the film or listening to the result.

```bash
python3 -B "$VE_RECAP_DIR/recap_script.py" review
python3 -B "$VE_RECAP_DIR/recap_script.py" check
python3 -B "$VE_RECAP_DIR/recap_script.py" status
```

`review` first estimates the spoken length from the packet's rate and refuses a draft more than about a tenth outside the target window (`draft_duration_outside_target`): fix the length before any review. It then prepares one review round and returns `awaiting_subagent`. A round is several text-review tasks dispatched together: one readability task over the whole scope prose, which owns the problems that span paragraphs (introductions, references, causality, setup and payoff, ending, reveal order, spoken flow), and fact tasks over consecutive beats of at most 45 sentences each, sized evenly and never splitting a beat. Every fact task reads the whole manuscript as context and each beat's sources with their neighbouring context, but reports only its own sentences, so no single report grows with the film. Dispatch all listed tasks through [native-reviews.md](native-reviews.md), wait for them, and rerun. Accepted parts are kept: a rerun lists only the parts still missing or rejected. `prepare-production` prepares the same round when the gate is not current.

The review is bounded: one concentrated pass (one round, however many parts) reports every blocking problem at once; one consolidated fix follows; then at most one targeted recheck of the changed beats, their direct dependents and their neighbours. Suggestions never start another review.

**What blocks.** Only these: a plot fact the sources do not support or that they contradict; a wrong identity or relationship, or two people confused; broken causality on the main line; a wrong number, amount, date, age or score; a twist, identity or outcome revealed before the story reaches it. Wording, pacing, repetition, tone and optional detail are suggestions, collected once.

1. **Readability** is judged from the prose alone: a retelling, located issues (`must_fix` or `suggestion`), first appearances (`introduced`, `needs_introduction`, `incidental`) and six narrative checks (`character_introductions`, `references_and_continuity`, `causal_and_time_links`, `setup_and_payoff`, `ending_resolution`, `spoken_flow`), each `clear`, `needs_revision` or `not_applicable`.
2. **Facts** cover every sentence with claims whose quotes together span its text; each claim is `supported`, `attributed`, `interpretation`, `nonfactual`, `insufficient` or `contradiction`. Only `insufficient` and `contradiction` block. Supported and attributed claims quote primary evidence (dialogue or a frame record) from the beat's own source file; an `interpretation` is the narrator's evident reading of shown material, cites its grounding and never covers an unconfirmed plot fact; `nonfactual` fits only bridge, flavor and comment sentences without names, numbers or negations.
3. **One severity per sentence.** A located `must_fix` blocks. A failing narrative check or missing introduction on a sentence whose located issues are all suggestions is advisory. A failing check that names no sentence blocks the whole manuscript and forces a full recheck.

Results are `out/script_review.json` (the composed whole-manuscript review, bound to the sentences, story plan, per-beat evidence and rules) and `out/script_gate.json` (`status`, `reviews_used`, `reviews_limit`, blockers, resolutions, bound to the current `writer_script.json`, draft and packet). Never hand-write `passed`.

## Statuses

- `passed`: no blocker; suggestions are optional. Continue with production.
- `needs_revision`: fix every blocker in one consolidated draft, import it with `--replace-draft`, update `writer_script.json` and run `review` again. That run is the single recheck.
- `resolved`: blockers remain after the recheck. Each blocked sentence is dropped from the production narration and recorded in `out/sentence_resolutions.json`; to keep one, soften it to what the evidence supports with `recap_script.py resolve --sentence-id <id> --text "<softened>" --reason "<why>"` (`--drop` drops it explicitly). The reviewed manuscript is not rewritten and no further review runs; production continues and the report lists every decision.
- `blocked` (`script_review_budget_spent`): the manuscript was edited after both reviews. Restore the reviewed wording of the listed sentences and express the change with `resolve`.

## Scope of the recheck

`review` picks the scope and records its reasons; do not force extra rounds.

- **Reuse.** When the sentences, their order, the story plan, the per-beat evidence and the rules are unchanged, the saved review is republished even if other `writer_script.json` fields (shots, tone) changed. No task is created.
- **Targeted recheck.** Changed beats, beats that declare a dependency on a changed beat (one hop), adjacent beats, beats whose evidence changed, and the old and new beat of a moved first introduction. Conclusions outside that scope are kept with their original evidence; the reviewer sees the earlier blocking findings in scope and confirms they are resolved without adding style advice.
- **Full recheck** only for a global change: characters or story spine, beats added, removed or reordered, an unlocated blocker in the first review, or more than half of the beats changed.

## Acting on results

- **Collect, then revise once.** Gather every blocker from the gate and author one draft submission in the `recap-coordinator-draft-v1` format. Import it, then place the published text into `writer_script.json` sentences following [writer-script.md](writer-script.md), preserving the exact words and order; this placement is not another prose revision. Apply useful suggestions in the same edit; optional wording never justifies another round.
- **After the recheck, decide per sentence.** `resolve` changes only what is voiced; decisions apply to the production narration and appear in the delivery report.
- **Rejected reports.** A report that fails validation (coverage, a fact part answering other sentences, quotes not found in the sentence or its sources, a supported claim without primary evidence) is dispatched again as the same task with the reason; it is never corrected by you.

`check` lists what is still open for the current draft. `status` shows every stage at once.

## Duration while writing

The packet carries the narration budget (measured or default speaking rate, original audio and holds deducted). Duration checks before review, after real voicing and at delivery run locally. Write to the budget instead of writing freely and squeezing afterwards; cutting order and protected roles are in [writer-script.md](writer-script.md).
