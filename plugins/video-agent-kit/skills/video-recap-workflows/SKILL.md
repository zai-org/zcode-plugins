---
name: video-recap-workflows
description: Make narrated recaps from full films or full soccer, basketball and League of Legends match broadcasts. Selects the domain workflow for evidence, story planning, narration, footage arrangement and final review.
---

# Narrated Recaps

Choose by the source and editing goal:

| Source | Workflow |
| --- | --- |
| Full film | [Movie recap](workflows/movie-recap.md) and the movie guidance below |
| Soccer match | [Soccer recap](workflows/soccer-recap.md): event windows first, narration fitted around confirmed actions |
| Basketball broadcast | [Basketball recap](workflows/basketball-recap.md): all scoring plays retained; measured narration drives footage placement |
| League of Legends game or series | [LoL recap](workflows/lol-recap.md): measured narration drives action selection |

Match workflows share [match editing](references/match-editing.md) and the existing assembly editing judgment. Observe match action windows with `video_observe`; match tools use `arrange_footage mode=match`, `synthesize_narration mode=match` and `video_render kind=match`.

User briefs can simply name the source, desired recap and creative preferences. Apply the selected workflow's defaults for selection, production and delivery without asking the user to supply tool names, agent roles or execution steps. Explicit user preferences override those defaults.

The remaining sections describe **movie recap only**, including isolated film observation, movie review scripts and movie delivery records. Use the selected match workflow for a match task.

## Movie Recap

A recap is a story told to someone who has not seen the film. The coordinator (you) decides what the story is, writes narration a first-time listener can follow, and resolves evidence gaps. Deterministic tools build the indexes, voice the narration, assemble pictures and render. Recap scripts prepare observation and review tasks; you dispatch them with the runtime's native Agent tool, collect their reports and rerun the stage to validate them. The scripts do not call a separate text or vision model service.

Shared evidence and acceptance rules come from [video-agent](../video-agent/SKILL.md).

## Routing

| Need | Read |
| --- | --- |
| The six-step production path, commands and artifacts | [workflows/movie-recap.md](workflows/movie-recap.md) |
| Dispatching subagent tasks and collecting their reports (one protocol for all stages) | [references/native-reviews.md](references/native-reviews.md) |
| Coarse observation, the picture check, D/V/F ids, coverage gaps | [references/evidence.md](references/evidence.md) |
| Duration, story spine, outline, editorial and picture plan, footage arrangement | [references/story-planning.md](references/story-planning.md) |
| Coordinator draft import, `writer_script.json`, visual claims, shot citations, tone and punctuation | [references/writer-script.md](references/writer-script.md) |
| Bounded listener and fact review, recheck scope, sentence decisions | [references/script-review.md](references/script-review.md) |
| Original audio, `prepare-production`, the picture check, `produce_film`, `failed_step` handling | [references/production.md](references/production.md) |
| Spot review, final-video review, listening and playback, report | [references/final-review.md](references/final-review.md) |
| Pacing by genre | [references/rhythm_templates.md](references/rhythm_templates.md) |

## Principles

- **Settle structure while you write.** The outline and the spoken draft are written in one step and reviewed together once. Get identities, causality and reveal order right in the outline; fix every blocking finding in one consolidated edit. Ordinary style suggestions never block or start another review.
- **The outline decides what is told; the budget only guides how much.** Narration is voiced first and pictures follow the real audio: `produce_film` fits whole shots to the measured narration (`fit_mode=whole_shot`), so per-beat character budgets are soft and total narration length is what sets the film length. Never chop footage into fragments to match a sentence's seconds.
- **New seams only at beat and point boundaries.** Inside a beat the picture is a continuous run of source shots, so the rhythm is the original editor's rhythm.
- **Everything stated must be in the source.** Use this film's dialogue and observed frames only. Do not fill gaps from general knowledge of the film, other recaps, or other films' scripts. Pictures prove actions, not thoughts. What was not seen clearly stays uncertain.
- **Images stay with the assigned observer.** Native observation and final-review agents read the actual images. The coordinator reads their validated text evidence and decides what to change; it does not look at frames itself or start observers of its own, because the stage tasks are the only places where a picture judgment can be validated. Keep each assignment bounded and retain uncertainty; a saved report does not empty an agent's context.
- **Checks are real or they stay open.** A review status, hash or `passed` field is written by the tool that actually performed the check. Missing observations, failed speech checks and pending listening stay visible; never copy an old pass or hand-write one.
- **Resume, don't restart.** Every step skips work whose outputs are still bound to current inputs. An unanswered or rejected subagent task is dispatched again as the same task, never renamed, split or handed to another role.
- **Reuse the check when its meaning and inputs still match.** An accepted observation, review or picture verdict stays valid while its inputs are unchanged. Recheck changed beats with their direct dependents and neighbours, only the sentence whose footage was swapped, and only affected render windows and adjacent cuts. A global identity, causality or reveal change needs a full recheck.
- **Bounded, then conservative.** One review, one consolidated fix, at most one recheck; after that a blocked sentence is softened or dropped and the decision recorded. Suggestions are collected once and never start another round.

## Language

Narration follows the task language; a Chinese recap of any film is written in Chinese. Foreign films need no translation step: transcribe with `language="auto"`, read the original-language dialogue axis, and write the outline text and narration in the narration language. Fix one translated name per character and keep it throughout; outline `dlg` references still point to the original-language lines; quoted dialogue in narration is paraphrased, not translated word for word.

## Applicability

The recap is driven by the dialogue axis plus the visual index. For fresh-source profiles (coarse-first indexing) a `sparse_dialogue` warning means dialogue gives few clues: keep the index, add visual evidence, and stop at a stated gap where key plot cannot be verified; silence in ASR does not prove nobody speaks. For other profiles, `sparse_dialogue` means dialogue-driven recap does not apply; fall back to the general editing workflow in [video-agent](../video-agent/SKILL.md).

## Working in stages

A feature film takes far longer than one session. Every stage writes its artifacts
to `out/` as it finishes, and a later session continues from them, so hand the work
back at a stage boundary — after the index, after observation, after the draft is
imported, after the script review, after production — instead of carrying one
session until it is cut off. Say what the next stage is when you hand back. Never
start a long job and hand back before collecting its result.

## Delivery

Deliver `out/final.mp4` with `out/report.md` and the current review records (`script_gate.json`, `spot_review.json`, `final_review.json`, QC and render reports). A started job or a first draft is not a delivery. When the automatic final review is complete and only actual listening or continuous playback remains, the full-length film is a review draft: report it with the checklist and stop. People record listening and playback outside the agent session; acceptance is theirs, not a field you set.

If the user supplies licensed reference scripts, use them only as examples of writing and pacing; they never establish facts about this film.
