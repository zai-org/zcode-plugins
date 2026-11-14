# Changelog

## 1.2.2

- **Fixed the dead black-frame check.** `parse_detects` required a space after the
  colon, but ffmpeg prints blackdetect as `black_start:6 black_end:11.966667` with
  no space (silencedetect/freezedetect do print one). A 12s video whose last 6s are
  pure black passed the gate with empty `black_spans`; the regex now accepts both
  formats, so `B101` fires again.
- Detect spans that run to the end of the video are no longer dropped:
  freezedetect emits only `freeze_start` (no `freeze_end`) when the freeze reaches
  EOF, and such spans are now closed at the total duration, so a frozen tail
  triggers `T301`/`T304`.
- Feedback tamper-proofing can no longer be switched off by editing `episode.json`
  (which sits outside every hash chain): `verify_delivery.py` now checks the
  report/markdown hash bindings whenever the gate report carries a `feedback`
  block, not only while episode.json still declares `intent: "feedback"`.
- `preflight.py` no longer demands a `size` field or a 1920x1080 resolution from
  demo-stage evidence, matching the documented demo-stage contract
  (sha256/fps/frames/duration) and `verify_delivery.py`. The build-name rejection
  message now attributes the check to preflight — render.py accepts any directory
  name; preflight is what rejects it.

## 1.2.1

- Docs fix: `references/recording.md` still claimed "the renderer crops to a 1080p
  canvas" — the opposite of the 1.2.0 fix. It now says recordings are scaled/padded
  onto the 1080p canvas and the full frame is shown unless a segment declares an
  explicit `crop`, matching SKILL.md and `episode-and-review.md`.
- `render.py` and `preflight.py` no longer duplicate the crop validation: one shared
  `crop_error()` (in `render.py`) is collected by preflight and raised by render.
  Both entry points reject exactly the same inputs as before; render's message for a
  negative-origin or non-positive crop now names that problem instead of the old
  "exceeds source".
- Comment cleanup: dropped the `LAYOUTS` block comment duplicated by
  `segment_filter`'s docstring, the behavior-restating half of the polyphone comment,
  and a divider comment.

## 1.2.0

- **Root-caused the "only the middle of the screen is recorded" failure.** `render.py`
  used to apply a hard-coded `DEFAULT_CROP = [260, 64, 1340, 780]` to every segment
  that did not declare `crop`, silently trimming 260 px off the left and 320 px off the
  right of any full-window 1920x1080 recording (and `preflight.py` validated browser
  takes against the same silent default while demo-stage takes were validated as full
  frame — the two defaults even disagreed). Frame geometry is now opt-in everywhere:
  `crop` absent = the whole recording is shown; an explicit crop is bounds-checked
  against the real source pixels in both preflight and render and fails loud.
- New episode-level `layout` field: `banded` (default, unchanged dark-canvas look with
  the 1800x866 content box) or `fullbleed` (recording scaled onto the full 1920x1080
  canvas; 16:9 sources map 1:1; case chip stays top-left and subtitles get a dark
  backing box so they stay readable over light pages). Use `fullbleed` when every
  pixel of the screen must stay visible.
- Polyphone lint in `preflight.py`: narration containing 行/重/还/都/长/得/着/差/数/干/应/结/系/弹/屏
  produces a per-occurrence warning with context (e.g. table-row 行 háng vs walking 行
  xíng — prefer 一条/这一单), so TTS mispronunciations are caught before render instead
  of after delivery.
- Tests: `tests/test_render.py` covers full-frame default, explicit-crop placement and
  fullbleed geometry.

## 1.1.2

- Feedback reports are now fully bound to the evidence chain. `render.py` writes the
  artifact SHA256 plus, into `quality_gate/report.json`, a normalized hash of the
  `feedback.json` fields and the exact `feedback.generated.md` bytes.
- `verify_delivery.py` recomputes both hashes. Editing `issue.title`/`issue.actual` (or
  any other report field), editing the markdown, deleting the markdown, or rendering
  with an older report that has no feedback binding now fails with a specific message
  instead of `DELIVERY=PASS`. The video-side binding (artifact SHA256, truncated video,
  stripped audio, re-encoded resolution) is unchanged.
- Tests: `tests/test_feedback_binding.py` covers clean pass, edited title, edited actual,
  edited markdown and deleted markdown; `tests/test_render.py` covers canonical hash
  normalization. Feedback artifacts rendered by 1.1.1 must be re-rendered to gain the
  binding.

## 1.1.1

- Feedback/defect report mode: `intent: "feedback"` plus an `issue` block adds severity
  and phase chips, a repro-steps overlay, and writes `feedback.json` and
  `feedback.generated.md` bound to the artifact SHA256. Quality-gate rules are unchanged.

## 1.0.x (2026-10-31 → 2026-11-02)

- 1.0.0 — first ZCode release: real-recording pipeline (`preflight`/`render`/`verify`), the built-in `delivery-v1` gate, bilingual READMEs.
- 1.0.1 — narration/TTS, subtitle line-breaking and low-bitrate false-positive fixes; preflight checks render dependencies early.
- 1.0.2 — default warnings cleaned up; auditable notices kept.
- 1.0.3 / 1.0.4 — DSH runtime skill registration, then registration scoped to each Agent (plugin shell: `package.json` + `index.js` + `cordis.patch.yml`).
- 1.0.5 / 1.0.6 — desktop-environment hardening; case-driven recording guidance.
