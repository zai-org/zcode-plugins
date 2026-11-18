# Changelog

## 1.2.4

- Review-fix round (9 items). Docs: `episode-and-review.md` still said a static
  stretch is only worth cutting past ~8s; the gate's hard threshold is 2s
  (`T301`, with `T304` at 20% of the video), and the doc now says ~2s.
- `render.py` no longer aborts with a bare traceback on malformed input: invalid
  JSON, a non-object episode, a segment that is not an object with a string id,
  duplicate ids and non-numeric `start`/`end` all raise `RenderError` and print
  the usual `FAIL:` line. `verify_delivery.py` likewise skips non-object segments
  with a `FAIL:` entry instead of crashing on `segment.get`.
- Fixed a decode/encode deadlock window in `render_segment`: both ffmpeg
  processes ran with `stderr=PIPE` that nobody read until after the frame loop,
  so a >64KB log froze both pipes. stderr now goes to temp files that are read
  after both processes have exited.
- A failed loudness measurement (`ebur`) is no longer silently skipped: the gate
  prints a `WARN` and records `loudness_lufs: null` in `checks`.
- `verify_delivery.py` now reads `avg_frame_rate` like the gate in `render.py`,
  instead of `r_frame_rate`, so both fps checks judge the same number.
- `.codex-plugin/plugin.json`: description aligned with the current
  `.zcode-plugin` wording (defect/feedback capability up front) and the retired
  `pi` keyword dropped.
- `examples/episode.example.json` no longer crops all three segments: absent
  crop (full frame) is the documented recommendation; explicit `crop` stays an
  opt-in documented in `references/episode-and-review.md`.
- `index.js` parses the SKILL.md frontmatter with a small hand-rolled parser
  (flat scalars plus one nesting level for `metadata`) and the `yaml` dependency
  is gone from `package.json` — the frontmatter is our own controlled subset, so
  the plugin now installs with zero npm dependencies.

## 1.2.3

- New icon: 1-bit monochrome pixel camera, clapperboard and glowing play
  button. Part of the shared pixel family across the six plugins; no code
  changes.

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
