# video-agent-kit

`video-agent-kit` uses `video-agent` as the general controller for video tasks and calls domain skills per task. Integrated so far: video understanding, shared speech tools, multi-material editing, single-file processing, subtitles, talking-head condensing, movie recaps, video creation, person replacement and screen-recording replication. The `video-edit` MCP server and the CLI share the same tools.

## First use (environment setup)

After installing ZCode and this plugin on a new computer, run `/setup-guide` first (the [setup-guide](skills/setup-guide/SKILL.md) skill). It checks and installs what the plugin needs: Python 3.10+ with the packages in `requirements.txt`, ffmpeg with libx264/aac/libass, Chinese fonts, Node.js for web replication and Blender for 3D animation (optional). It probes pip, npm, Homebrew, conda-forge and the installers' Chinese mirrors in parallel and uses the fastest one that answers. Python packages are installed automatically; system software is installed after the user agrees, and steps that need a password or manual action come with a command to copy. At session start `hooks/env_check.py` reports gaps from the same checklist. It can also be run directly:

```bash
python3 skills/setup-guide/scripts/env_doctor.py          # check
python3 skills/setup-guide/scripts/env_doctor.py --fix    # check and install the Python dependencies
```

Speech recognition, voiceover, image, video and 3D generation are provided through the signed-in ZCode account (ZCode ToolHub); users do not need their own accounts or keys.

## MCP tools

- `transcribe`: transcribes a local video/audio file and outputs timed text.
- `tts_generate`: generates narration or dubbing audio with a preset voice; one character always uses the same voice id.
- `video_observe`: the single observation entry point for local/remote videos and images; returns per-frame images, contact sheets or transcript evidence for a time window.
- `video_search`: searches videos across the supported sites; returns candidates, paging and failure information.
- `video_metadata`: reads local media properties or remote source metadata.
- `video_download`: saves a complete remote video and returns the local path.
- `video_compare`: helps compare footage using perceptual hashes and temporal alignment.
- `timeline_validate` / `timeline_patch`: validate a timeline; preview or apply structured changes.
- `subtitle_layout` / `subtitle_build`: observe the subtitle region and suggest a layout; build editable cues and ASS/SRT from the current transcript.
- `speech_index` / `speech_plan`: build an index of speech units; turn the main agent's selection into a condensing plan, a continuous script and a plan transcript.
- `speaker_audit` / `speaker_relabel`: find risky speaker labels; write a corrected copy for verified time ranges.
- `video_render`: `kind=timeline/subtitles/speech/narrated` share one rendering entry point; `narrated` renders a narration EDL (voiceover, sentence-level subtitles, optional BGM, residual-frame check at cut points). `kind=match` is also accepted (see Match recaps).
- `video_qc`: `kind=video/subtitles/speech` checks the technical state, subtitles or joins and returns suitable image evidence.
- `detect_shots` / `build_film_index`: cut the whole film into shots (PySceneDetect, frame-level refinement); the film index chains probing, transcription, shot detection and the dialogue axis, and produces a viewing plan.
- `arrange_footage`: dialogue axis, outline-driven footage arrangement (reel/brief), narration anchoring, and re-arrangement against the measured voiceover.
- `synthesize_narration`: batch-synthesizes per-segment voiceover from the narration script, with caching, a sentence-level timeline and ASR back-verification.
- `bind_narration`: binds voiceover sentences to source-film shots and outputs an EDL; `fit_mode=whole_shot` (default: whole-shot picture fitting with a review queue) or `legacy` (tape DP).
- `produce_film`: orchestrates movie-recap production (preflight, voiceover, picture fitting, rendering and QC, with per-stage caching).
- `swap_scan`, `swap_plan`, `swap_storyboards`, `swap_generate`, `swap_assemble`, `swap_verify`: the person-replacement pipeline (`swap` tool group), documented in [video-swap](skills/video-swap/SKILL.md).

Screen-recording replication gets `deploy_website` through the `runtime` MCP client (serves a build at a stable local URL); opening, screenshotting, interacting with and recording pages all go through the ZCode built-in browser (the official `control-browser` skill, see `skills/video2code/references/browser-checks.md`), and the plugin does not start Playwright/Chromium. `preview_build` and `browser_capture` are offered only when a hosted runtime endpoint (`.v2c/runtime/endpoint.json`) exists in the workspace; in a normal ZCode session the `runtime` server provides `deploy_website` only.

## Skills

Controller entry point:

```text
skills/video-agent/SKILL.md
```

The controller organizes the flow by task:

- **video general understanding**: relook, deep research.
- **video edition**: subtitles, multi-material editing, long-video editing.
- **video creation**: standalone works and serial episodes; duration, aspect ratio and genre are configured by the project.
- **video-to-code**: replicate a web page, game or full-stack application from a screen recording.

The flow is chosen from the task and the capabilities actually available; each domain's detailed method is read on demand. The controller owns the shared source, evidence, time-base and routing rules; domain entry points, workflows and references own their own methods. Checking and repair run through every main line; creation duration is set by the task, and standalone works and serial episodes are not divided by duration. Movie, soccer, basketball and LoL recaps are all integrated. Match recaps reuse `arrange_footage mode=match`, `synthesize_narration mode=match` and `video_render kind=match`, and share the existing MCP/CLI and speech services.

The plugin provides the following skills. `video-agent` is the controller for every video task, and the compatibility `/video-edit` command also points to it.

| Skill | Responsibility |
| --- | --- |
| [video-agent](skills/video-agent/SKILL.md) | Controller and shared evidence rules |
| [video-edit-agent](skills/video-edit-agent/SKILL.md) | Local processing of one existing video/audio file (trim, transcode, compress, GIF, resize, speed, audio-track changes, masking, ffmpeg retouching) |
| [video-understanding](skills/video-understanding/SKILL.md) | Video relook and deep research |
| [video-edit-assembly](skills/video-edit-assembly/SKILL.md) | Multi-material editing |
| [video-speech-workflows](skills/video-speech-workflows/SKILL.md) | Subtitles and talking-head condensing |
| [video-creation](skills/video-creation/SKILL.md) | Standalone works and serial episodes |
| [video-recap-workflows](skills/video-recap-workflows/SKILL.md) | Movie and match recaps |
| [video2code](skills/video2code/SKILL.md) | General method for screen-recording replication |
| [video2game](skills/video2game/SKILL.md) | Game interaction and verification |
| [video2fullstack](skills/video2fullstack/SKILL.md) | Full-stack interaction and backend verification |
| [web-replicate](skills/web-replicate/SKILL.md) | Optional web project templates |

On the ZCode desktop there is also [setup-guide](skills/setup-guide/SKILL.md): the environment check and installation for first use on a new computer.

`skills/` also contains two skills that the table above does not list. The controller in `skills/video-agent/SKILL.md` routes person replacement to the first; the other is entered directly: [video-swap](skills/video-swap/SKILL.md) (whole-person replacement in an existing video, using the `swap_*` tools) and [code2video](skills/code2video/SKILL.md) (builds a 2D or 3D animation from a text brief and renders it to video, using `image_generate` / `model3d_generate`).

`agents/` holds seven subagent definitions: `recap-observer`, `recap-text-reviewer` and `recap-final-reviewer` (movie recap, see Movie recap tools), `creation-verifier` (judges one candidate take for `video-creation`), `v2c-verifier` (compares a source recording with a build), and `c2v-reviewer` / `c2v-3d-reviewer` (visual review of `code2video` renders and 3D motion recordings).

## Match recaps

Soccer arranges footage by event window and then voices it; basketball and LoL pick footage according to the actual voiceover duration. All three are routed through `video-recap-workflows`. Complete source files are registered by half, quarter or game, and observation and transcription reuse the shared tools.

- `arrange_footage mode=match action=ingest/dialogue/arrange`: source ingestion, commentary axis, match footage arrangement.
- `synthesize_narration mode=match`: per-sentence voiceover on the shared TTS, keeping actual durations and script/audio digests.
- `video_render kind=match`: keeps the action alignment and original-audio mixing of the soccer/basketball/LoL kernels; outputs a 1280×720, 25 fps cut plus same-named `.qc.json`, `.placement.json` and `.render_report.json`.

Action placement uses an explicit `event_t`; across quarters and games, ordering is by segment and in-segment time. Long narration gaps are leads for a viewing recheck; conflicting arrangements and stale scripts or audio raise errors. After technical QC, the picture, action completeness and actual sound still have to be checked. For parameters and examples see [Shared notes for match workflows](skills/video-recap-workflows/references/match-editing.md).

## Observation and research

Video Q&A first locates by the question, then watches a shortened window densely; deep research combines input observation, search, candidate verification and evidence organization. All observation uses `video_observe`; there is no need to choose between local and remote tools. Transcription continues to reuse the shared implementation.

The `video-edit` MCP returns `structuredContent`, `isError` and the actual images. `image_delivery` lists the images that were returned, omitted for budget, or failed to read/decode; `image_delivery_status=partial` means delivery is incomplete. Broken images are not returned as ImageContent, and the MIME type comes from the actually decoded format. Transcripts and creation quotes keep the source's original wording; service diagnostics use neutral names. The CLI outputs the same business status and data, with images given as paths for local viewing. Time parameters are always in seconds; `fps` and `num_frames` are mutually exclusive. Frame labels and `time_s` correspond to the source time of the actually decoded frame (error within one source frame). The whole-file recognition for `include_transcript` is cached under `.video_agent/observe_transcripts/` by source bytes and language, so later windows on the same source do not run recognition again; when several windows of the same source are observed in parallel, they wait for the same recognition to finish. `video_compare`'s `crop` accepts only `default` or an arithmetic expression of the form `w:h[:x[:y]]`.

The plugin hooks include a startup environment check, a media-path hint and a session clock for long creation runs; screen-recording replication tasks additionally enable dedicated hooks. For replication, the final build must pass, and visual and interaction quality still has to be verified separately.

The review sub-agents (`c2v-reviewer`, `c2v-3d-reviewer`, `v2c-verifier`) have boundaries: no MCP calls or delegation, writes only under `out/reviews/`, and a round budget. Hooks enforce these only under Claude Code and the task harness, which report sub-agent events and the agent identity to hooks. ZCode does not send `SubagentStart`/`SubagentStop` or `agent_id`/`agent_type`, so under ZCode these boundaries are instructions in the agent prompts rather than enforced limits. The reviewers keep `Bash` because they crop and enlarge images with PIL.

## Long tasks and recovery

Over MCP, the first call to `transcribe`, `tts_generate`, `image_generate`, `video_generate`, `video_render`, `detect_shots`, `build_film_index`, `synthesize_narration`, `produce_film`, `model3d_generate`, `swap_storyboards` or `swap_generate` returns `data.job_id` and the job state immediately. At that point only the submission is done; no final media exists yet. Query with `job_action=status, job_id=...` on the same tool; once the job has finished, this returns the full business result and the actual images. The job's terminal state is at `data.job.status`; the state of the first submission is at `data.status`, and a same-named field in the business result is not the job's terminal state. `job_action=list` lists this project's jobs for that tool; each row has only `job_id`, `status` and the `job` state, and the business result is still collected with `status`. `job_action=cancel` marks the job cancelled: a call in progress cannot be stopped, it runs to its end in the background and its result is discarded. Other tools wait for completion by default and can also be submitted explicitly with `job_action=submit`.

Jobs run on background threads inside the MCP server process: no child worker processes and no `/proc`, so Linux, macOS and Windows behave the same. Job records live in `.video_agent/jobs/`; a running job writes a heartbeat every 5 seconds, and other processes (the CLI, a restarted MCP server) use it to tell whether the job is still running; a heartbeat older than 30 seconds is reported as `interrupted`. Restarting the MCP server interrupts running jobs: call again with the same arguments; video takes, 3D, TTS and person-replacement windows resume their submitted tasks from their own records, while images and ASR run again. Each project runs at most 2 long jobs at once (`VE_MCP_WORKERS`); when the limit is reached, a new long tool call or explicit `submit` queues for a free slot for up to `VE_MCP_QUEUE_SECONDS` (default 120) before returning `project job worker limit reached`. Short tools run inline on a thread and take no job slot. The command line is a one-shot process: `job_action=submit` there runs to completion. 900 seconds is the limit for a single MCP request; generation/ASR/render waits run inside background jobs.

The tool `inputSchema` sent to MCP clients is a plain object at the root (no `anyOf`/`oneOf`/`allOf`, and no root-level `required`); `job_action` and `job_id` are ordinary optional properties. Required business arguments are written in the tool description and validated by the server: `status`/`cancel` accept only `job_id` (passing business arguments together with them is rejected with `job controls cannot include business arguments`), `list` accepts no other argument, and a new call cannot carry `job_id`. A violation returns a single-line `invalid arguments: ...` or the corresponding exclusivity error.


The CLI runs synchronously by default. A business failure or an argument reading/validation failure prints a structured error and exits 1; success exits 0. Arguments that the schema declares as strings (such as `--query 2024`, `--source 12345`, `--job-id`) keep their literal text and are not converted to numbers. `--job-action submit/status/list/cancel` uses the same job protocol. An interruption does not automatically create a new request: a video candidate that has a task id is resumed with the original take_id; when the task id is missing or the upstream result cannot be confirmed, the take stays reserved/interrupted and the server-side record must be checked first. Image and speech interfaces that have no resumable task id likewise need manual reconciliation; cancelling the local wait does not cancel server-side billing.

The ASR derived-audio cache is bound to the source SHA, the conversion parameters and the actual audio SHA; old caches that have no binding or were modified are extracted again. The bytes actually uploaded are frozen and checked against the binding. The output contains `asr_audio_sha256` and the pre-recognition source SHA-256; the source is checked again when recognition finishes, and if it changed, the old output is kept and an error is raised. The subtitle and speech indexes reject transcripts that lack digests or are stale; an old transcript requires recognition to be run again on the current source. Default ASR output uses a separate directory; explicitly overlapping outputs are protected by file locks. A final subtitled cut can be traced through the render provenance chain to the timeline, the original cut, the transcript and the cues, and can go directly into `creation_review`.

In the current creation plan, keyframes go into generation automatically when the request does not specify them explicitly; a square canvas uses 1:1. Re-reviewing existing takes after the directing goals change requires `creation_verify action=prepare reassess=true`; the original generation recipe is kept, and evidence and verdicts are stored per revision. Voiceover that is too long or conflicts fails explicitly; a wrong image aspect ratio does not trigger a second submission automatically.

Derived audio and chained references in the submission ledger can only be reused read-only by their original SHA; when a reference is damaged or changed, restore the original bytes or create a new candidate. Do not delete the ledger and retry. Audio that was actually padded with silence is bound by source/output SHA and checked against the limits by its final duration at submission time. When the compiler is upgraded, if the rest of the request identity is exactly the same, the original submitted task can still be collected and no new request is created automatically.

Budgeting uses one project, one candidate directory and one fixed set of caps; generation and editing share the reservation, and resuming an original task does not reserve again. When there is only one old candidate ledger it can be adopted automatically; with several ledgers, the cumulative reservation and the server-side tasks must be reconciled first. An independent production budget uses an independent project; moving the plan or changing the output directory cannot reset the budget.

When old review evidence lacks the revision/voice-SHA binding, or an evidence dependency has changed, prepare/record must be run again; an old passing verdict cannot be carried over. `unavailable`, `skipped` or `excluded_thin` does not prove that the voice is consistent, that the audio is silent or that there is no dialogue. A unit ID cannot contain an absolute path, path separators or control characters.


## Compatibility and known limits

- File locks, staging and rollback handle ordinary exceptions; they do not guarantee atomic publication of several files as a whole under SIGKILL or power loss. Recovery still checks SHA and source binding.
- verdict/evidence signatures are for detecting stale or mismatched evidence and cannot prevent malicious forgery; structural validation and local regression tests also do not prove that content, aesthetic or voice judgments are correct.
- Timeline audio rendering still builds a full-length audio bed for each sound track; the resource cost on long, multi-track projects needs dedicated stress testing and optimization.

## Environment variables

The public ASR provider is `asr`, using the speech recognition service of the signed-in ZCode account, with no key: local audio is uploaded first (mp3/wav up to 10 MiB each; other formats or larger files are first extracted to 16 kHz mono mp3) and then submitted for recognition; material longer than 30 minutes is recognized in chunks of about 28 minutes and merged. The service has no language parameter; `language` is only recorded. TTS uses the voiceover service of the signed-in ZCode account (WAV 24 kHz), with no key: `VE_TTS_VOICE` sets the default voice (default `zixinnansheng`), and 12 preset voices are available, listed in the `tts_generate` description. The service takes no style instructions, so `style_instructions` is recorded but has no effect; speech rate is adjusted locally with ffmpeg. Long text is split by sentence, synthesized piece by piece and joined. Reusing a voice does not mean that cloning a voice from a supplied sample is supported. TTS requests are ledgered by content: an identical request reuses the recorded audio.

Configuration is read from process environment variables and `.env` files. Precedence is: process environment > project-directory `.env` > plugin-directory `.env`. The ZCode service origin (`ZCODE_BASE_URL`) is injected by the host and never read from `.env`. The plugin has no built-in proxy; network proxying comes from the process environment. The template is `.env.example`.

Common ones:

- `VE_TTS_VOICE`: default voiceover voice
- `VE_NARRATION_TTS_RATE`: speech-rate override for movie-recap voiceover (the voice always comes from `VE_TTS_VOICE`)
- `VE_BGM_DIR`: music library for `video_render kind=narrated`
- `VE_PROJECT_DIR`
- `VE_MCP_WORKERS`: per-project limit of long jobs running at once (default 2)
- `VE_MCP_QUEUE_SECONDS`: how long a long job waits for a free slot when the limit is reached (default 120 seconds)
- `VE_OBSERVE_MAX_FRAMES` / `VE_OBSERVE_FRAME_WIDTH`
- `VE_MAX_INLINE_IMAGES` / `VE_MAX_INLINE_IMAGE_BYTES`
- `VE_VIDEOSITES_MEDIA_DIR`
- `VE_FONT_DIRS` / `VIDEO_EDIT_FONT_DIRS`: font directories, separated by the operating system's path separator

## CLI

The CLI and MCP share the same implementation:

```bash
python plugins/video-agent-kit/cli/video_agent_tool.py transcribe --input_path input.mp4 --language zh --pretty
python plugins/video-agent-kit/cli/video_agent_tool.py tts_generate --text "旁白文本" --voice zixinnansheng --output_path out/narration.wav --pretty
```

Observation and search examples:

```bash
python plugins/video-agent-kit/cli/video_agent_tool.py video_observe --source input.mp4 --start-s 10 --end-s 20 --fps 2 --layout frames --pretty
python plugins/video-agent-kit/cli/video_agent_tool.py video_search --query "waterfall landscape" --pretty
```

Editing examples:

```bash
python plugins/video-agent-kit/cli/video_agent_tool.py timeline_validate --timeline-path out/timeline.json --pretty
python plugins/video-agent-kit/cli/video_agent_tool.py video_render --kind timeline --timeline-path out/timeline.json --output-path out/preview.mp4 --pretty
python plugins/video-agent-kit/cli/video_agent_tool.py video_qc --source out/preview.mp4 --timeline-path out/timeline.json --pretty
```

The shared renderer currently outputs MP4. Timeline rendering supports multiple video/audio/text/image tracks, position, speed change, volume, opacity and clip fade-in/fade-out (on video, image-overlay and audio-track clips). The canvas comes from `sequence.width/height` (or `output_canvas`); the dimensions of the first video source are used only when neither is declared. Effect arrays on clips or tracks, global transitions, transition types other than fade/crossfade/dissolve, transitions on text clips, enabled tracks of an unknown type, and audio tracks that point at a source with no audio are all rejected rather than silently ignored. Speech (talking-head) rendering reuses timeline execution; it currently uses hard cuts, keeps the source frame rate, and outputs a `.transcript.json` bound to the actual cut and plan. The subtitle stage uses the returned `output_transcript`. partial units must be corrected and verified, or the cut must be transcribed again.

Subtitles support burn/soft/both; soft file names carry `_softsubs`, so read the actual path from the result. Rendering rebuilds the sidecars from the `ass_path`/`srt_path` recorded in the subtitle package; the paths in the report are the published files. Backslashes and braces in cue text are displayed literally; the language tag of a soft-subtitle track is written on the newly added track (two-letter codes are converted to ISO 639-2). Sources with rotation metadata are laid out by their display size. Soft-subtitle QC checks the actual timed-text track, but the display still has to be checked in a player. Ordinary video technical QC, subtitle F/T and condensing S/A/V content checks follow the domain workflows; images and waveforms are not the same as having listened to the audio.

By default every call uses its own artifact directory (a default directory with nothing written to it is cleaned up, and render staging files are deleted after publication). Over MCP, long tools run as background jobs inside the MCP server process (see Long tasks and recovery; a direct CLI call runs in the CLI process itself), and output paths are protected by cross-process file locks: a later call that writes the same output concurrently fails immediately with `output is owned by another active job`, and the caller should switch to a different path or retry serially. Rendering publishes the cut after validating the input snapshot; QC rejects changes to the recorded source files, plans, cues or cuts, and when it checks subtitle data only, it likewise verifies the transcript and source recorded in the subtitle package. Failing conclusions from `timeline_validate` and `video_qc`, and rejected `timeline_patch` diffs, are written to `output_json` and kept (the result is also marked as failed); only execution errors roll back to the files as they were before the call. A report path cannot point to an existing non-JSON file. Dependency files need to be kept with the project; once inputs are moved away, old reports can no longer re-prove the complete binding.

Install dependencies:

```bash
python3 -m pip install -r plugins/video-agent-kit/requirements.txt
python3 -m pip install --no-deps -r plugins/video-agent-kit/requirements-nodeps.txt
```

The second command installs shot detection (`scenedetect>=0.7`). It must use `--no-deps`: scenedetect declares desktop `opencv-python`, which would overwrite the `opencv-python-headless` build that the plugin uses. `/setup-guide` already installs it this way. Chinese narration subtitles need a CJK font, which can be supplied through `VE_FONT_DIRS`.

## Aggregated subdirection tools

MCP and the CLI both read the tool catalog in `mcp/ve_tools/catalog.py`. The catalog currently contains the `speech`, `understanding`, `editing`, `creation`, `model3d`, `recap` and `swap` tool groups, and both entry points read the same tool set by default. New implementations should reuse shared capabilities first; tools with similar functions should have their semantics, parameters and names unified before they are registered.

When integrating another subdirection, organize the compared schemas and implementations as a `ToolGroup` and register it in `TOOL_GROUPS` in `catalog.py`. Registration checks that schema and implementation names match and that implementations are callable, and rejects same-named tools in different groups; same-named capabilities must be deduplicated or given a compatible name before they are registered.

After adding a capability, update the related skill, command, hooks, environment configuration and dependency notes together.

## Creation tools and configuration

`creation_plan_validate`, `image_generate`, `image_crop`, `video_generate`, `creation_verify`, `creation_timeline_build`, `creation_review` and `voice_compare` are the public creation interfaces. The `creation` group also registers `title_cards` (`action=plan|render`), which composites name/place cards onto a rendered cut. `video_generate` generates or edits immutable candidates depending on `action`; `creation_verify` prepares or records candidate evidence, status or extra diagnostics depending on `action`; `creation_review` prepares real cut-point images and validates whole-film verdicts. ASR/TTS, observation, timeline validation, rendering and QC share the existing tools.

Images and videos come from the generation services of the signed-in ZCode account and need no configuration (video 4–30 s, 480p, no audio track). No private gateway, credentials, songs or automatically downloaded face models are included. Ordinary proxying is controlled by HTTP(S)_PROXY/NO_PROXY. Projects are isolated through `VE_PROJECT_DIR`; creation operations in the same project are mutually exclusive.

Candidate generation requires a v2/v3/v4 plan and a fixed cumulative budget; failures and interruptions count toward the reservation, and submitted tasks are not resubmitted automatically. Candidates, review images and plans are bound to the current reference bytes; only source spans with a current review approval can enter the creation timeline. In-clip subtitles need real transcript timing; a failure or an exhausted budget keeps the unfinished state. Structural validation does not prove that content or aesthetic judgments are correct.

Core dependencies stay in the shared requirements. The voice-card check of creation uses CAM++ by default: a mounted ONNX graph (`VE_SPEAKER_MODELS_DIR`) is used when present, otherwise the same official weights from ModelScope run in numpy and are downloaded automatically on first use (about 28 MB, cached in `~/.video_agent/models`), with nothing to install. The optional `requirements-voice.txt` (librosa) is only for the older mfcc_f0 / resemblyzer scorers. The optional `requirements-face.txt` together with ONNX models in an explicit `VE_FACEQC_DIR` provides face-reference diagnostics. When these are not installed the capability is explicitly missing; review by actual observation and listening, and do not treat skipped as pass.

## 3D asset tools

`model3d_generate` (the `model3d` tool group) calls the 3D generation service of the signed-in ZCode account. `operation` selects one step: `generate` (front, left, back and right views, or one image → textured GLB), `rig` (automatic rigging; `rig_type=auto` first runs a free riggability check), `animate` (applies up to 5 preset animations to a rig result). Each call creates only one task; the artifacts are in `out/model3d/<output_name>/` (`model.glb`, `preview`, `task.json`), and later steps reference the previous step by its `output_name`.

No key is needed. Before a submission the request key and body are recorded, so after an interruption a repeated call with the same arguments recovers the original task with the original key; once the task id is on disk, a repeated call with the same arguments reuses the finished files or collects the task that is still running, without creating a new task; a different request under the same name needs a new name or `force`. Usage within the project is recorded in `.video_agent/model3d_usage.json`; once it reaches the project limit `VE_MODEL3D_USAGE_CAP` (default 1000), new calls are refused.

## Movie recap tools

The `recap` tool group is provided by the same `video-edit` MCP server and CLI: `detect_shots` → `build_film_index` → `arrange_footage` (dialogue/arrange/anchor) → `synthesize_narration` → `bind_narration` → `video_render kind=narrated` → `video_qc` (`timeline_path` points to shots.json, to check the render provenance), or `produce_film` orchestrates the whole flow. Shot detection, arrangement and binding call no model; voiceover calls TTS; back-verification and indexing call ASR. The fill shots and long-shot portions that `bind_narration fit_mode=whole_shot` adds wait in `data.needs_review` for an actual review against the preview, and are handled through `produce_film approve_segments` or `avoid_shot_ids_by_seg`.

Text review, picture checks and final-cut spot checks for movie recaps are done by the runtime's subagents (`recap-observer`, `recap-text-reviewer` and `recap-final-reviewer` under the plugin's `agents/`): the stage scripts under `recap/` write task files and validate the reports the subagents write. They do not call a separate review model and are not exposed as MCP tools. For the method see [video-recap-workflows](skills/video-recap-workflows/SKILL.md).

## Third-party code and licenses

The plugin is licensed under the MIT License ([LICENSE](LICENSE)). Third-party material is listed with its license and modifications in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md):

- `mcp/ve_tools/campplus_net.py` and `campplus_numpy.py`: the CAM++ speaker-verification network from ModelScope (Apache-2.0, full text in [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt)), trimmed and re-implemented in NumPy.
- CAM++ weights (`iic/speech_campplus_sv_zh-cn_16k-common`, Apache-2.0): not bundled; downloaded once from ModelScope on first use of the voice-card check.
- `skills/web-replicate/templates/*/template/src/components/ui/*`: shadcn/ui components (MIT).
