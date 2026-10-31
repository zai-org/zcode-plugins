---
name: delivery-video
description: Produce trustworthy delivery/acceptance demo videos of real, working software — recorded from actual screen sessions with narration, subtitles and a deterministic quality gate. Use when the user says "record a delivery video", "make a feature demo", "acceptance demo video", "录交付视频", "录个演示", "功能演示", "验收演示视频", "给客户看的功能 demo". Renders real recordings only — no static screenshots, mocks or old footage stitched into a "demo".
metadata:
  short-description: Record, render and gate trustworthy delivery demo videos
---

# Delivery Video

Turn a feature that actually runs into a reviewable delivery video. The video proves only what really happened on screen: never stitch static screenshots, mocks, stale recordings or test logs into a "demo".

## Prerequisites

The skill ships its own pipeline in `scripts/` next to this file (locate them relative to this SKILL.md):

- `render.py` — render episode.json into `screen_demo.mp4` + run the built-in quality gate (`render` / `gate` subcommands)
- `preflight.py` — fail-loud pre-render check of the build directory
- `verify_delivery.py` — verify the finished artifact and its evidence chain

Requires on the host: `python3` (3.9+), `ffmpeg`/`ffprobe` on PATH, and `pip install edge-tts Pillow` (narration synthesis + frame drawing). If any prerequisite is missing, stop and report it — do not silently fall back to a weaker path.

## Completion criteria

A delivery is done only when all of these hold:

- Evidence the current version really runs: git SHA, deployed or local version, real test ticket/account/request IDs.
- Every segment in `episode.json` points at a real recording with a traceable time range.
- The artifact is rendered by `render.py`: 1920x1080, 30fps, h264 + AAC, with narration and burned subtitles.
- The last segment ends on a **result state** — a title, data or success message visible and read back, never on a waiting spinner or a black frame.
- `quality_gate/report.json` has `status: "pass"` and empty `hard_failures`; never loosen thresholds to pass.
- Key frames have been visually inspected; for external deliveries an independent `visual-critic.json` review is required (`verify_delivery.py --require-critic`).
- Anything posted to a ticket, chat or customer channel was gated first (`render.py gate`), and **the uploaded file is the gated file** (matching SHA256).
- A `delivery.md` notes version, evidence, absolute artifact path, SHA256, the actual commands, and the "not yet uploaded/published" status.

A passing gate is not the user's acceptance. Posting to a ticket or group is a delivery action — do it only when the user asks in that turn; public upload or publishing waits for an explicit "send".

## Workflow

### 1. Define what this demo must prove

Confirm from the request and the target project:

- Audience: internal stakeholder, customer, or engineering team.
- The 2–5 key results the demo must cover.
- Environment, version, test accounts/data that can be reproduced.
- Sensitivity: customer names, contacts, internal URLs, credentials, debug panels that must be cropped out.
- Where the artifact lands.

When missing information would materially change the shots or wording, ask once; otherwise use conservative defaults: internal delivery, 60–120s, narration in the user's language, real test environment, landscape 1920x1080.

### 2. Verify first, record second

Before recording, the same version must be demonstrable live:

- Record git state, target environment, deployed SHA or local start command.
- Run the core flow once for real; keep API/page/database evidence and ticket IDs.
- If the feature is broken, versions mismatch or data cannot be reproduced — stop and report the blocker; never pad with old footage.
- Numbers, names and states in the narration must come from that same real run; never fix numbers first and hunt for footage to match.

### 3. Write the storyboard and narration

One segment proves one result:

| ID | case | visual | real action & verification | narration |
| --- | --- | --- | --- | --- |
| 01-entry | F-01 | feature entry | open the page, current version visible | one sentence: what this demo solves |
| 02-action | F-01 | key operation | real click/submit, save evidence | what the user did, what the system answered |
| 03-result | F-01 | result read-back | refresh/read back, result still there | the business outcome, not the internals |

For external deliveries the narration states user-visible facts only — no "build", "API", "database", "pipeline", "deploy" jargon and no internal codenames. Technical acceptance may quote real commands and evidence, still exactly as run. One sentence carries one complete thought; avoid long embedded clauses. The renderer hard-fails AI-cliche patterns ("this is not X, it's Y") and warns on internal jargon.

### 4. Record the real screen

Use the recording tool you have — see [references/recording.md](references/recording.md) for per-platform options (macOS screen recording, OBS, scripted browser screencast). Rules that hold regardless of tool:

- One segment = one continuous real operation; the success feedback and read-back should land inside the same take when possible.
- Never overwrite old takes; new version = new filenames.
- Never substitute footage from a different run, and never cut pieces of different runs into one "success".
- Browser footage recorded by a scripted screencast tool should carry a `<take>.evidence.json` beside it (sha256, size, duration, frames); mark those segments `source: "browser"` — preflight fails a browser segment without evidence.
- Dedicated test accounts and data; crop unrelated customer info, contacts, debug panels.
- If a take shows a long frozen frame, a blank screen, or captured notifications/privacy content — delete it and re-record. Fix the material, not the threshold.

### 5. Assemble episode.json

Build directory: `build/screen_demo-<slug>/`. Full field reference: [references/episode-and-review.md](references/episode-and-review.md). Minimal shape:

```json
{
  "voice": "zh-CN-YunxiNeural",
  "rate": "+5%",
  "title": "Feature delivery demo",
  "segments": [
    {
      "id": "01-entry",
      "case": "F-01",
      "label": "Entry",
      "shot": "take-01.mp4",
      "start": 0.5,
      "end": 11.5,
      "crop": [56, 159, 1512, 738],
      "text": "Open the order detail page; the task list and the save action are both here."
    }
  ]
}
```

`shot` is relative to the build directory; `start`/`end` select the range inside that same take; `crop` is `[x, y, w, h]` in source pixels. Speed is clamped to 0.3x–3x: if narration does not fit, split the segment or cut information — never force it.

Run the preflight before rendering:

```bash
python3 <skill>/scripts/preflight.py build/screen_demo-<slug>
```

It checks JSON structure, recordings, intervals, crops, evidence files, cached-TTS contracts and narration red lines. FIX the material on FAIL; do not bring problems to the renderer.

### 6. Render

```bash
python3 <skill>/scripts/render.py render build/screen_demo-<slug>
```

This synthesizes narration (edge-tts, cached per segment), times each segment to the narration, draws the label chip and word-synced subtitles, concatenates, loudness-normalizes to -14 LUFS, then runs the built-in quality gate. Output: `screen_demo.mp4`, `timeline.json`, `cover.png`, `preview_*.png`, `quality_gate/report.json`. Nonzero exit or `gate=fail` = fix and re-render.

### 7. Verify the artifact

```bash
python3 <skill>/scripts/verify_delivery.py build/screen_demo-<slug> --require-critic
```

Checks decode integrity, spec (h264/1080p30/aac), gate report binding (video_sha256), per-shot evidence and the visual critic. Then actually watch it — at least the opening, every key operation, the result read-back and the ending. For an independent review, have a second model/window review key frames without seeing your conclusions first, write `visual-critic.json` (schema in the references file), and only then claim independent review.

### 8. Attachment gate before posting

Any mp4 going into a ticket, group chat or review link passes the gate first — it needs no episode.json:

```bash
python3 <skill>/scripts/render.py gate --video <absolute mp4 path> --work <same dir>/quality_gate-attachment
```

| Gate code | What viewers feel | Correct fix |
| --- | --- | --- |
| `E101` no audio | silent movie, no idea what's on | render via `render.py` with narration |
| `M101`/`M102` wrong res/fps | blurry text, jitter | re-record/re-render; never scale up to fit |
| `M111` low bitrate | text smears into blocks | don't hand-craft low bitrates; cut duration first, re-encode CRF if needed |
| `T301` long freeze | "is the player stuck?" | cut waiting ranges or add narration/interaction |
| `T304` frozen-heavy | sluggish, "laggy" overall | speed up ranges, drop idle segments, give results their own segment |

One artifact has exactly one gated file: record the SHA256 before upload, read it back after posting. Never re-encode a gated file by hand — that breaks the evidence chain.

### 9. Write the delivery note

In the target project (not inside this skill) write `delivery.md`: environment & versions, real evidence (tickets, request IDs, read-backs), artifact absolute path + duration + resolution + SHA256, the recipe (episode.json, takes, quality report, critic file), the actual commands, what the video proves and what it does not, and status "awaiting user review — not uploaded/published".

Reply with the conclusion first, then the artifact path, duration, gate result, SHA256 and the unproven items. Never just "the video is done".

## Common shapes

- Web/desktop UI: window-level recording cropped to the content area; controls, feedback and read-back all in frame.
- CLI/API: dedicated terminal recording real commands and real responses; mask tokens, internal hosts and debug logs.
- Multi-case acceptance: one case per segment; the `case` field becomes the chip, narration covers only that case's delta and result.
- No visual UI: show real API responses, logs or data — never fabricate a fake UI to stand in for the product.
- Engineering acceptance: terminal and evidence frames are fine, but lead with the business conclusion.

## Boundaries

- No static screenshots, animations or mock pages standing in for a real feature; if it doesn't run, fail loud.
- Never touch production data, send messages or fire notifications to "create a shot"; confirm test targets and recoverability before any real side effect.
- No public upload or publishing until the user explicitly says "send" — until then, local review only.
- Never shrink resolution/bitrate/fps to cut file size: deliverables are 1920x1080/30fps; control size with duration; anything re-encoded must re-run the gate, and the posted file must match the gated SHA256.
- Never end on a waiting state ("creating…/loading…"); end on the result itself.
- Never loosen the gate profile, delete gate evidence or skip the critic to manufacture a PASS.
- Company source, customer data, credentials and unreleased business information must not enter public repos or public media directories.
