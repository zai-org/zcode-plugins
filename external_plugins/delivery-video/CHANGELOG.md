# Changelog

## 1.3.1

- `C301` no longer blocks a normal narrated opening and closing card in a short video.
  1.3.0 failed any video whose cards exceeded 25% of its length, which a 5-second
  narrated opening and a closing card do in everything under about 30 seconds. Cards
  may now take up to 8 seconds regardless of the share, provided the real footage
  runs at least as long as the cards; a slideshow still fails.

## 1.3.0

Behavior changes to know before upgrading:

- Default `layout` is now `fullbleed`: the recording fills the 1920x1080 canvas (1:1 for a
  1080p take). `banded` is still available and unchanged.
- `verify_delivery.py` requires `visual-critic.json`; the `--require-critic` flag is gone.
- The narration cache is content-addressed (`tts/<id>.<key>.mp3|.json`). Files named
  `tts/<id>.mp3|.json` from earlier versions are ignored (preflight lists them) and an
  existing build synthesizes its narration once more.
- Artifacts rendered by earlier versions fail verification until re-rendered, because the
  gate report now has to bind the episode and the timeline.

### Evidence chain

- `quality_gate/report.json` binds `episode.json`, `timeline.json` and `delivery.generated.md`
  next to the artifact SHA256; `timeline.json` records each take's SHA256 and playback speed.
  `verify_delivery.py` fails when any of them, or a take, changed after rendering, and on
  reports without the episode and timeline bindings.
- Playback outside 0.7x–1.5x is called out during the render and disclosed in the generated
  note.
- Optional `evidence` block in `episode.json` carries version facts into the note.

### Render pipeline

- All narration is synthesized and every duration rule is checked before the first frame is
  rendered; every offending segment is listed at once.
- edge-tts service and network failures raise a clean `FAIL:` naming the segment instead of
  a traceback; nothing is left behind on failure.
- `render.py` runs the same validation as `preflight.py` and refuses to render on any error.
  A browser segment without evidence, a slash in a segment id, a corrupt cache and a bad
  evidence `frames` field all end in `FAIL:` lines.
- Karaoke subtitles: spoken characters are lit, the rest wait in grey.
- The scripts no longer write bytecode into the plugin directory, and ffmpeg no longer reads
  stdin.

### Cards

- New `kind: "card"` segment: a renderer-made title card, narrated or silent (`duration`,
  1–8s).
- The gate cuts card intervals out of the black, freeze and silence scans (`exempt` in the
  report) and fails with `C301` when cards cover more than 25% of the video.
  `render.py gate --timeline` supplies the card intervals for an attachment check.

### Review

- The render writes a `review/` packet: full-resolution start/mid/end frames per segment,
  contact sheets and `critic.draft.json`. The per-segment `preview_*.png` files are gone.
- `visual-critic.json` is checked mechanically: bound to the artifact, reviewer named, five
  dimensions scored, every segment and the first and last second reviewed.

### Lint

- The polyphone lint only flags genuinely open readings (206 warnings down to 11 on the same
  220 real narration segments); everyday words such as 结果, 数据, 系统 and 弹出 stay quiet.
- New warnings for narration longer than about 50 spoken characters and for takes smaller
  than the canvas.

### After the independent audit

- A segment id matching its take file no longer destroys the take. Per-segment clips and
  the assembly files live in `clips/` (assembly files start with `_`, which no segment id
  can), take fingerprints are taken before anything is rendered, and preflight rejects a
  take that sits where the renderer writes (`screen_demo.mp4`, `tts/`, `review/`, `clips/`,
  `quality_gate/`).
- The final artifact is staged and renamed once complete, so an interrupted re-render
  leaves the previous artifact intact; timeline, report, notes and the review draft are
  written atomically.
- A take that ends earlier than its header says fails with the real reason instead of
  freezing its last frame; a failed frame source reports both ffmpeg logs.
- Segment ids, rates and build-directory names must match as a whole (a trailing newline
  no longer slips through).
- `case`, `label`, `source`, `phase` and `intent` must be strings; a wrong type is a
  `FAIL:` line instead of a crash after synthesis or a traceback.
- Feedback videos disclose playback speed and retime notes too, and the on-screen retime
  warning names the note that actually exists.
- `verify_delivery.py` requires the `delivery` binding, re-applies the preflight evidence
  rules to evidence-backed takes and checks the evidence fingerprint recorded in the
  timeline.
- A visual review needs every dimension at 0.8 or higher, and any `frame` path it lists
  must exist.
- `L102`: a failed loudness measurement is a hard failure instead of a pass with
  `loudness_lufs: null`.
- A narrated card checks its cached narration in preflight like a shot does.
- Repro steps are cut to the panel width by measured pixels; a Latin run wider than a
  subtitle line is broken instead of running off the canvas.
- `render.py gate --timeline` says that it cannot prove the timeline belongs to the video.
- Tests skip instead of erroring when edge-tts or Pillow is missing from the interpreter.
- Subtitle lines break at spoken-word boundaries: when the length cap falls inside a
  word, the word moves to the next line (checked against the live edge-tts service).

### After a second audit pass

- Playback speed had been inverted since the first release: a segment reported as
  fast-forwarded played its first moments in slow motion, and a slowed segment sped up
  and then froze on its last frame. Output timestamps now divide by the speed, so a
  1.5x segment really shows 1.5 source seconds per output second. The padding that
  replaces the open-ended clone is 0.2s, for frame-count rounding and a sparse last
  frame only.
- Take placement is judged by where the file really lives: case variants such as
  `CLIPS/x.mp4` and symlinks into an output folder are rejected, two segment ids that
  differ only by case are duplicates, and the renderer checks every file it is about
  to write against the takes before rendering anything.
- A failed or interrupted render leaves no staging artifact and no `.tmp` file behind;
  the next render clears any it finds.
- `verify_delivery.py` rejects a report whose loudness was never measured.
- A short Latin word at the end of a full subtitle line moves to the next line instead
  of being cut in half.

### Fixes

- Subtitles and chips use the Simplified-Chinese font face. Face 0 of the macOS collections
  is the Traditional one (PingFang HK, Heiti TC), so Simplified narration used to render with
  Traditional glyph forms and centered punctuation. PingFang is preferred over Heiti and the
  macOS asset location is searched as well.
- The narration lead-in is derived from one constant instead of a hard-coded 150 ms.
- `package.json` `files` lists the whole `scripts/` directory.
- `render.py` is split into `dv_core`, `dv_episode`, `dv_tts`, `dv_gate`, `dv_draw`,
  `dv_notes` and `dv_review` behind the three entry points. Tests grew from 31 to 106,
  including an offline end-to-end render; 138 after the two audit rounds.

## 1.2.5

- An unparsable `avg_frame_rate` (`0/0`) no longer escapes as a bare traceback:
  the quality gate records an `M102` failure and `verify_delivery.py` prints a
  `FAIL:` line; the same division in `render.py` is guarded (tests 29 → 31).
- Preflight and verify error messages say `evidence-backed source` / shot
  instead of `browser`, matching the `source` values the evidence rule covers.
- `check_narration` drops a redundant second `in text` test.

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
