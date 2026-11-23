---
name: video-agent
description: Controller for video tasks covering video understanding (relook, deep research), video editing (subtitles, multi-material assembly, long-source editing, single-file processing and retouching, movie and match recaps) and video creation (standalone work, serial episodes). Selects and combines workflows based on the user's goal and the skills and MCP tools actually available.
---

# Video Agent

Organize the work around the result the user wants. This skill owns the goal, routing, stage hand-offs and the final acceptance check; the domain skills carry the specific methods.

## Environment First

When the session-start check reports missing dependencies or says this computer has not passed the environment check, or a tool fails for an environment reason (a missing Python module, `ffmpeg` not found, a missing encoder or filter, Chinese text rendered as boxes), complete the `setup-guide` skill (`/setup-guide`, ZCode desktop) before the task. Speech recognition, voice-over and image/video generation are services the platform provides; never ask the user to apply for or enter an API key.

## Identify the Goal and Materials

- Pin down the deliverable: an answer, time localization, structured annotation, transcript, subtitles, audio, video or project file, plus any format, duration, language and quality requirements the user specifies.
- Use the material paths the user specifies first. Otherwise look at the working directory and, when present, `.video_agent/materials_manifest.json`, and distinguish source materials, auxiliary materials and existing artifacts. File names are locating clues; judging content requires actual evidence.
- Distinguish segments of one logical work from multiple independent materials. First/second halves, quarters, episodes and match replays can belong to the same analysis or commentary task; the number of files does not decide whether the task becomes material assembly.
- Tasks with materials gather evidence from the materials; text-only production tasks start from the user's brief and do not require a nonexistent source video, ASR or source-video observation.

## Select and Combine Workflows

Pick the domain skill that best matches the task from the skills currently available, then read its workflows or references as needed. A workflow the user names directly takes precedence; when no skill matches, complete the task with the available tools.

| Main line / mode | Selection basis | Main deliverable |
| --- | --- | --- |
| Video understanding / relook | The task needs relooking at relevant segments, additional observation, or verifying or correcting an existing judgment | An answer, localization or corrected conclusion with source and time evidence |
| Video understanding / deep research | The task needs in-depth analysis around a question, synthesizing evidence from multiple places into a research conclusion | An analysis or research result with an evidence chain |
| Video editing / subtitles | Subtitles need to be recognized, produced, translated, adjusted or burned in | The requested subtitle file, or a final video with subtitles |
| Video editing / multi-material assembly | Multiple independent materials need to be selected and assembled into an ordered piece | The assembled final video or project |
| Video editing / single-file processing | One existing file is trimmed, transcoded or compressed, converted to GIF, resized or reframed, retimed, looped, re-audioed, masked or retouched | The processed file, with what changed and how it was checked |
| Video editing / long-source editing | Segments need to be selected, condensed, reordered or finely cut within a long source video | A final video or project that meets the editing goal |
| Video editing / movie recap | A full-length film is retold as a condensed narrated recap built from its own footage | A narrated recap video with script, voiceover and subtitles |
| Video editing / match recap | A full soccer, basketball or League of Legends broadcast is condensed into a narrated account of the match | A narrated match recap with action-aligned footage and subtitles |
| Video editing / person replacement | The performers in an existing video are replaced as whole people (face, hair, wardrobe) by the people in reference images, keeping action, framing and audio | The recast video, with the acceptance record and its limits |
| Video-to-code / replication | A recording is used to recreate a website, game or full-stack application | A runnable code project, with verification and limitations |
| Video creation / standalone work | A complete work such as a film, documentary, ad, MV or explainer is organized around a new brief | The final video, a production plan and any companion results requested |
| Video creation / serial episodes | The story advances episode by episode while preserving cross-episode character, voice, prop and relationship state | A single episode or series, character assets and state records |

Choose the mode by task semantics: selecting, reordering or processing segments of existing content is editing; organizing script, visuals and sound around a new creative brief is creation, whether the materials are existing or newly generated. For creation, duration, aspect ratio and genre follow the project goal; long-source editing is determined by the source materials and the editing goal. For ordinary understanding and Q&A, choose an observation depth that fits the question; do not escalate to full research by default.

- Understanding: read [video-understanding](../video-understanding/SKILL.md) and use its routing to choose relook or deep research. Keep source and time in the results so editing or creation can reuse them.
- Multi-material editing: read [video-edit-assembly](../video-edit-assembly/SKILL.md).
- Single-file processing and retouching (trim, transcode, compress, GIF, aspect, speed, loop, audio track, loudness, masking, grade, denoise, stabilization): read [video-edit-agent](../video-edit-agent/SKILL.md).
- Movie or match recap: read [video-recap-workflows](../video-recap-workflows/SKILL.md).
- Person replacement (recasting an MV, swapping a person; not a face-only swap): read [video-swap](../video-swap/SKILL.md) and its two references before calling the `swap_*` tools.
- Video-to-code: read [video2code](../video2code/SKILL.md); also read [video2game](../video2game/SKILL.md) for playable games or [video2fullstack](../video2fullstack/SKILL.md) for applications with a real backend. Website templates are in [web-replicate](../web-replicate/SKILL.md).
- Subtitles, talking-head condensing and post-edit subtitles: read [video-speech-workflows](../video-speech-workflows/SKILL.md). Talking-head condensing is the long-source editing method currently integrated.
- Creation: read [video-creation](../video-creation/SKILL.md) and choose the standalone-work or serial-episode workflow.
- Transcription, narration and dubbing only: [video-speech-workflows](../video-speech-workflows/SKILL.md). Speech generation uses preset voice ids.

When producing a video from a supplied reference and multiple materials such as photos, clips or audio, also read [video-edit-assembly](../video-edit-assembly/SKILL.md), even if creation or subtitles is the main workflow. Apply its reference-reproduction and audio-mix checks to the assembled result.

For combined tasks, arrange stages by dependency and state each stage's materials, time base and deliverable: for example, localize before cutting, cut before adding subtitles, or write the script before voicing and visual production. When editing hands off from understanding results, keep the source segment localization; when creation moves from brief to script, materials, sound and production, keep the duration allocation. Preview and verify stage by stage, not only the final export. For long videos, attend to chapter progression, cross-segment consistency and total duration; for short videos, to the core message, pacing and resolution.

For complex tasks, keep a brief work log of the chosen workflow, stage inputs and outputs, key constraints and items still to verify. For simple Q&A, answer directly.

## Tool Calls and Jobs

- Long tools (`transcribe`, `tts_generate`, `image_generate`, `video_generate`, `video_render`, `detect_shots`, `build_film_index`, `synthesize_narration`, `produce_film`, `model3d_generate`, `swap_storyboards`, `swap_generate`) return a `job_id` at once. Collect the result by calling the same tool with only `job_action: "status"` and that `job_id`; any other argument in that call is rejected, and a `job_id` is only known to the tool that issued it.
- A project runs two jobs at a time by default. A third long call fails with "project job worker limit reached" until a running job ends, so submit long calls two at a time and collect them before submitting more; short tools wait for a free slot instead.
- The creation tools (`creation_plan_validate`, `image_generate`, `image_crop`, `video_generate`, `creation_verify`, `creation_timeline_build`, `creation_review`, `voice_compare`) share one project lock: issue them one after another, not in parallel.
- Two calls must not write to the same output directory at the same time; for example, register a match with `arrange_footage` before starting transcriptions that write into that directory.

## Evidence and Time Base

- For judgments about specific visuals, actions, text, people and cut points, read the actual frames or the corresponding time window. Transcripts support speech content and cannot on their own prove visual facts.
- Still frames can prove text, composition and occlusion; continuous action, speech sync, subtitle flicker and seams need a time window or the corresponding audio/video evidence. Waveforms and extracted frames do not replace an actual listening conclusion.
- Use an observation density suited to the task: local localization uses the corresponding window, whole-video narrative needs evidence across the whole video, subtitle layout uses representative frames and high-risk regions. State the sampling and the uncovered ranges.
- An image path, a tool's success status or "contact sheet generated" does not mean the image has been read. Read the images the decision requires; record evidence that is missing or unreadable.
- Label every time localization with the source file/segment and source or output time. After cutting, speed changes or reordering, source transcript times are not final-video subtitle times; use a valid time mapping or re-acquire timing against the final video.
- Before reusing caches, transcripts, observations and QC, check that they correspond to the current materials and parameters.
- Distinguish the materials' original speech, visible facts, inferences and newly created content. Keep quotations of original speech verbatim; ASR corrections and factual assertions need a basis; keep uncertainty when it exists.
- Results from model services such as ASR/TTS still need verification for the task. When a needed input or capability is missing, consider whether an alternative satisfies the goal; otherwise state the specific gap, keep the results that allow continuation, and do not claim the task is complete.

## Acceptance Check

Apply the acceptance requirements of the selected domain workflow and check against the user's goal. Single-step transcription, video Q&A and quality checks do not need the full artifact contract of editing or creation.

- Answers and analysis: important conclusions have evidence, time and source are explicit, and uncertainty and observation scope are clear.
- Transcripts, subtitles, annotations and audio: check format, coverage, timing, language, and the content accuracy or sync the task requires.
- Production and editing: verify the version actually delivered; check content selection, narrative, target duration and audio-visual sync. Successful encoding and file existence only prove the artifact was generated; check technical QC and content/viewing quality separately.
- Video-to-code: deliver the source project and run instructions; distinguish build success, behavior checks and visual checks, and state any verification that was unavailable.
- Fixes: return to the stage that produced the problem, update the affected downstream results, then verify the current version.

Deliver the requested results with the necessary usage information, verification results and real limitations. Do not substitute a completion claim for actual delivery.
