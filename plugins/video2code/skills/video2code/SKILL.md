---
name: video2code
description: Replicating a webpage shown in a screen-recording video — layout, visual style, interactions, and animations. Use whenever the task provides a recording (mp4, webm, mov, etc.) of a website and asks to recreate / reproduce / replicate / clone / build the page shown in it (复刻 / 复现 / 还原). Load this skill AND `web-replicate` together — two Skill calls in one turn — before implementing. If Phase-1 observation shows the page is a WebGL/3D scene (true 3D depth, particle fields, volumetric light/glow, camera flythrough, shader backgrounds), additionally load `video2code-3d`.
---

# Video2Code

Faithfully replicate a webpage demonstrated in a reference video. Match **layout + visual style + interactions + animations**, not just a static lookalike. Every animation must exist, react to the **same driver** (time / scroll / hover / click / pointer position), and read the same way as the source.

## The visibility baseline — one rule, all four phases

Fidelity is bounded by what a viewer sees. The replica is judged on a same-scale composite at 1×, zoomable to ~3×; that, and nothing finer, is the resolution of every fact this task deals in. The floor cuts **both ways**, and the second direction is the one that gets missed:

- **Nothing sub-visible can fail.** A difference you cannot distinguish at ≤3× is within tolerance by definition — pass it, don't fix it, don't spend budget on it.
- **Nothing sub-visible may be produced.** Not observed, not written into the plan, not carried in `measured`. If establishing a value takes an instrument, that value is not part of this task — in **any** phase, on the **source** side exactly as much as the replica side.

The second clause is not a restatement of the first. A value read off a single source frame in Phase 1 is not yet a *difference*, so a floor written only about differences never reaches it — and by the time Phase 4 arrives, the whole run has been steered by numbers no viewer could see, with a plan full of targets no composite can settle.

**"Measure" in this document always means "read a value off the artifact the tool just showed you, at the granularity your eye resolves on it."** It never means "compute it from the pixel array." Reading a heading's width against the frame is measuring; `np.nonzero` on its ink is not.

Concretely, either side, any phase:

| Carry these | Never produce these |
|---|---|
| positions and sizes to the nearest few px, read off a 1×–3× view | any length claimed to ±1px; glyph ink bounding boxes; per-character advance |
| type size in px at ~2px granularity (14 / 16 / 20 / 32 / 48) | stroke or hairline thickness in px; weight inferred from stroke width |
| color as a nameable, reproducible token (one-shot sample, §4.4) | channel deltas, luminance levels, region mean/std, `Δ≈7`-style reads |
| durations to ~0.1s off timestamped grid cells | ink coverage %, energy ratios, per-pixel row/column profiles, sub-pixel amplitude |
| counts, gaps, fractions of the viewport | any quantity whose two sides differ by less than you can see |

A right-hand-column number appearing in `out/plan.md` or `out/verify.jsonl` is **a defect in its own right**, independent of how good the replica is: it sets a target no viewer asked for, and it makes that id's `pass`/`fail` unfalsifiable by eye — the only way to re-check it is to re-run the same script, which is not evidence. Each phase below restates this floor in its own terms (Phase 1–2 escalation cap, Phase 3 weight tags, §4.3 fix budgets, §4.4 Parity standard). They are all this one rule.

## Stack

Always uses `web-replicate` (React + TS + Vite + Tailwind + shadcn/ui). Pick the **lightest implementation that fits**:

| Use case | Tool |
|---|---|
| Hover/fade, simple slide | CSS transition / keyframes |
| Sticky / pinned / scroll-snap / position coupled to scroll | plain CSS (`position: sticky`, `scroll-snap`) — no library |
| Simple entrance | Tailwind `animate-*` / `tailwindcss-animate` |
| Orchestrated multi-element, scroll-triggered reveal | `framer-motion` |
| True 3D / WebGL — depth, particles, volumetric light/glow, shader bg, camera flythrough | **load `video2code-3d`, scaffold `default-3d`** (raw three.js) |

Reach for the lightest tool that fits — don't escalate to a library for a 200ms fade.

> **This table only decides how to BUILD an effect. It does NOT decide whether the effect is `[S]` or `[D]`** (Phase 3). Those are different questions: implementation is "CSS vs library", classification is "can one frozen frame prove it's correct". A pure-CSS effect (sticky, scroll-snap) can absolutely be `[D]`. Never reason "no library → static."

## File contract — the three artifacts that define "done"

All contract state lives in **files** under `out/` (relative to the project directory). Conversation text carries **zero contract status** — nothing counts as planned/verified/finished until it is in these files:

| File | What | When |
|---|---|---|
| `out/plan.md` | The design spec. Every observable concern is one line starting with `[S<#>]` or `[D<#>]`, carrying **measured numbers** and (for `[D]`) the **source clip time range** that proves it. | Written at end of Phase 3, **before any component code is written**. |
| `out/verify.jsonl` | Append-only verification log. One JSON object per check, status field named `result` — **exact schema in *Exact line formats* below**. `measured` values are read **off the evidence artifact** (composite scale, grid timestamps, tool receipts) at the tolerance's granularity — approximate (`~`) values are fine (see §4.4 *Where the numbers come from*). Never edit or delete earlier lines — a fix is recorded by **appending** a new line for the same id. The last line for an id is its current state. | Appended live during Phase 4 verification. |
| `out/report.md` | Close-out: what shipped, deployed URL, deferred list with reasons. | **Skeleton written in Phase 3** (carries a `V2C_REPORT_SKELETON` marker); **filled as the last act** of the task (marker removed). |

The task is complete only when **every `[S#]`/`[D#]` id in `out/plan.md` has a final `pass` or `defer` line in `out/verify.jsonl`** and `out/report.md` exists. A `defer` is only legitimate after the check was actually attempted to its cap (see §4.3) — never defer an effect you never tried to verify.

### Exact line formats — copy these literally

The close-out audit reads these two files by **literal field name and literal line shape**. A field renamed to a synonym, a value outside the allowed set, or an id moved off the start of its line all read as *"never planned / never verified"*: the work is done and scores zero, with no warning and no tolerance layer. Getting these literals right costs nothing; getting them wrong voids the run.

**`out/plan.md`** — every tagged concern begins its line with the bracketed id and ends with a `{core}`/`{detail}` weight; lines covering a moving region carry a `{render}`/`{footage}` source tag too:

```
[S4] Card grid: 3 columns at 1440px, 24px gutters, card 384×512 (still @2.1s) {core}
[D2] Card hover: lifts 6px, shadow blooms, ~180ms ease-out (source clip 5.2–6.0s; testid=card) {detail} {render}
[D5] Hero reel: full-bleed film, hard cuts ~1s apart (source clip 0.0–3.5s; <video autoplay muted loop>; testid=hero-video; asset=/assets/hero.mp4) {core} {footage}
```

The id is the **first thing on the line, in square brackets**. Not a table row (`| S4 | … |`), not a heading (`### [S4] …`), not `S4.` or `**S4**` — those forms are invisible to the audit, which then sees a plan with zero tagged concerns.

Source tags obey the same literalism: exactly `{render}` or `{footage}`, and a `{footage}` line's `asset=` path must match the file you actually ship. A shipped video the plan never declared, or an `asset=` on a `{render}` line, is a close-out gap — the audit reconciles the two lists.

**`out/verify.jsonl`** — one JSON object per line; the status field is named exactly **`result`**, and its value is exactly one of `pass` / `fail` / `defer`:

```
{"id": "S4", "result": "pass", "evidence": "out/cmp/S4_grid.png", "diffs": [{"what": "gutter reads 26px vs source 24px", "severity": "minor", "disposition": "negligible: within the 1.5× gap tolerance"}], "measured": {"columns": "3 both", "card_w": "src 384 / rep 386", "gutter": "src 24 / rep 26"}, "reason": ""}
{"id": "D2", "result": "fail", "evidence": "out/cmp/D2_hover.png", "measured": {"lift": "src ~6px / rep 0px", "duration": "src ~180ms / rep n/a"}, "reason": "hover handler never fires — lift measures 0px at every beat"}
```

- **The key is `result`.** Not `verdict`, not `status`, not `outcome`. *Verdict* is this document's English word for the judgment you reach; the JSON key that records it is `result`. Extra keys of your own (`kind`, `tier`, `method`, …) are harmless — a missing or renamed `result` is fatal.
- **The value is `pass`, `fail`, or `defer`.** Nothing else. Not `partial`, not `n/a`, not `ok`, not `skipped`. An id you could not settle is a `defer` carrying a `reason` (and only after §4.3's cap has actually been spent) — never a fourth state you invent for it.
- **`id` matches the plan's bracketed id exactly** — `"S4"`, not `"S4-anchorB"` or `"S4 grid"`. Need to record several judgments against one id? Append several lines with the same `id`; the last one is its state.

## Evidence tools

Two MCP tools make and SHOW you evidence images in one round (inline in the tool result — no follow-up `Read`); parameter details live in the tool schemas:

- `still_crops` — full-res frames at exact timestamps from the source video or your own recordings, optional crop/scale zoom. Batch every instant you currently want to see into one call.
- `composite_view` — same-scale SRC|REP composite, the standard Parity evidence form; crop+scale makes a **zoomed regional composite** — prefer it over any per-pixel measurement script.

Equivalent CLI scripts (`still.py`, `composite.py` under `<plugin_root>/skills/video2code/scripts/`, plugin root announced at session start; fallback `cat .v2c/plugin_root`) remain for Bash pipelines, but a script run costs an extra `Read` round — default to the tools.

## Workflow — strict order, nothing collapsible

Replication runs through four phases in this exact order. Complete each before the next — no merging, no reordering, no skipping.

`〈ingest the video〉 → 〈observation + ambiguities〉 → clip_video the ambiguities and [D] candidates → write out/plan.md → init webapp → build (assets → components) → npm run build → deploy_website → ZCode Browser Use IAB → verify sweep (append out/verify.jsonl) → batch-fix + re-verify → out/report.md`

---

### Phase 1 — Observe

**Ingest.** If the task input already provides pre-extracted, timestamped frames or contact sheets of the video, `Read` them directly. Otherwise call `ingest_video` on the video file — one call covers the whole duration at layout-level sampling and inlines timestamped overview sheets (do **not** substitute a few coarse `clip_video` segments: that path caps at 180s total and its detail-level sampling wastes budget on an overview). Either way, study the entire video end-to-end before anything else.

**Browser chrome in the recording.** Some captures (annotation-platform screen recordings) carry the browser's own chrome — a tab/address-bar strip along the top edge. It is not page content: read every layout fact, measurement and framing against the page region below it, and do not reproduce the chrome in the replica.

Then write a brief observation **in your response**:

```
## Video observation
<3–6 sentence free-form summary: what kind of page, visual style/mood, core interactions and notable animations, anything that will shape the implementation>

**Ambiguities to clip in Phase 2** (or "- (none)"):
  - <thing you couldn't tell from one watch>
  - ...
```

Keep the summary tight — Phase 3 will re-structure layout / tokens / animations in detail. The **Ambiguities list is load-bearing**: every item drives a `clip_video` call in Phase 2.

**Layout stills — one batched extraction, driven by the sheet.** The contact sheet is your index: every cell is timestamped. Pick each major section's **settled moment** (section fully in place, entrance motion finished) off the sheet, then pull those full-resolution frames in **ONE `still_crops(video, times=[...])` call** — all sections' timestamps in the same call. One settled frame per section is the complete layout evidence — pull an extra offset only for a section-to-section spacing measurement; do not `Read` frame files one by one or re-pull near-duplicate moments. **Measure, don't recall — read off these stills** at the visibility baseline's granularity (values your eye resolves on the frame the tool showed you; never a pixel-array computation)**:** the heading's width as a fraction of the viewport; column widths; margin/whitespace rhythm; type scale; each section's complete element inventory (side rails, badges, secondary copy — the pieces most easily lost). For **repeated elements** (card grids, logo walls, list rows): items fully visible per viewport, item width as a viewport fraction, gaps, stagger rhythm — and per item: aspect ratio, media-area width fraction, corner rounding, any curvature or tilt **with its sign** (bows toward or away from center; leans which way) — signs are binary facts, write them down explicitly; a remembered impression routinely flips them. For each **text role** (display heading, section heading, body, caption): serif vs sans, case, italic/outline, letter-spacing — and the display size **in absolute px off the frame** (to the nearest ~2px, read against the frame — not derived from a glyph bounding box), not by feel. These stills are the evidence the Phase 3 `[S]` lines must cite. **Animated-in content (cards, captions, overlays that fade/slide in): locate the settled frame before you crop** — a coarse sheet cell routinely catches these mid-entrance, and guessing tight-crop timestamps against a half-faded element turns one extraction call into three. Spend one call on a short dense series around the appearance (4–6 closely spaced times, full frames), pick the first complete-and-static frame, then take every tight crop at that exact timestamp.

**Site tours (multi-page).** When the video visits multiple distinct pages (full-viewport transitions / URL-bar changes), build a **multi-page site** (client-side routing, one route per page). List the pages in the observation; each page gets its own layout in the plan and its own `[S]`/`[D]` concerns.

**WebGL / 3D pages.** While observing, decide whether this is a WebGL page. Signals (any one is enough, judged from what's on screen — not from guessing the tech): true 3D perspective/depth (occlusion changes with viewpoint, perspective zoom) · a particle field (thousands of independently moving points) · volumetric light / glow / fog · a continuous free camera flythrough or orbit (not explainable by a CSS transform) · infinite-detail fractal zoom · a full-bleed animated shader background. If so, say so in the observation, **load `video2code-3d` now** (a third `Skill` call) and scaffold with the `default-3d` template in Phase 4. A card flip / slight tilt / parallax that a single CSS `perspective()` covers is **not** a WebGL page — stay 2D.

**Rendered or footage? — classify every moving region.** A page can move because it *renders* (WebGL, canvas, CSS/JS animation, a scroll-driven camera) or because it *plays a video file* (a hero reel, a project hover preview, a background film). The two demand opposite builds: rendered motion you must **write**; a `<video>` element you must **ship as a video asset**. Hand-drawing a film reel is as wrong as replaying a rendered scene. Decide this per moving region while observing; Phase 3 records the verdict as a `{render}`/`{footage}` tag, and the close-out audit checks the shipped assets against it.

| Reads as `{footage}` | Reads as `{render}` |
|---|---|
| live-action or pre-rendered film (people, cities, product shots) | particle fields, geometry, shader patterns |
| hard cuts, an editor's rhythm (tunnel → skyline → arch) | continuous camera move, no cut points |
| fixed-length loop with a visible seam | motion that never repeats |
| **no coupling at all** to scroll or pointer — it runs on its own clock | scroll drives the camera or the progress |
| play/mute chrome | frame rate wobbles under load; vector-crisp at the page's DPR |

Three rules settle it:
1. **`{render}` is the default, and doubt resolves to `{render}`** — the same shape as the `[S]`/`[D]` test below. `{footage}` is the cheap answer, so it needs positive evidence, not merely the absence of contrary evidence.
2. **Interaction that changes the *content* of the picture — not merely its playback position — forces `{render}`, no exceptions.** Drag a handle and watch the scene's glow spread and its background hue flip: that is a running program, whatever it looks like. A `<video>` cannot do it.
3. A page you just called WebGL is `{render}` across its whole scene layer. There is no footage exception for a rendered scene, however photoreal (see `video2code-3d`).

---

### Phase 2 — Clip ambiguous moments

Call `clip_video` with the exact ranges. **Batch ALL the windows you currently want into one call** — back-to-back calls with 1–2 segments each return the same information for extra rounds; split only when the caps force it. Limits: ≤8 segments, ≤60s each, ≤180s total. **Keep a window ledger:** track the ranges you have already clipped; before each new call, subtract covered ranges — new windows should target uncovered time or a *tighter micro-window inside* a covered range (the motion-ROI crop zooms in harder on a short window; that is the only reason to re-clip). The tool annotates overlaps with what a previous call already covered. Prioritize: **animation > motion-/scroll-coupled effects > hover states > one-off transitions**.

**Clip triggers — two independent obligations:**
1. **Ambiguity-driven:** clip at least one segment per Phase 1 ambiguity. An ambiguity list of `- (none)` skips *only* this obligation.
2. **`[D]`-driven (not skippable):** every effect you expect to tag `[D]` in Phase 3 **must** have a source clip. You need it twice — as the Phase 3 *evidence rule* (a clip showing the effect mid-progress forbids an `[S]` tag) and as the Phase 4 *side-by-side comparison* against your own recording. "I have no ambiguities" does **not** excuse skipping these: confidence is not evidence.

You may only reach Phase 3 with zero clips when the page has **no** motion, scroll-coupling, or hover/click animation at all.

**Evidence-escalation cap (Phases 1–2):** chasing one detail in the source video is capped at **three inspection attempts total** — crop/zoom stills, a `clip_video` segment, and any analysis script all count against the same cap. Still unresolved? Write it into the Ambiguities list with your best hypothesis and move on — Phase 4 verifies against your own deploy at full resolution, which usually settles it for free; blind-guessing crop coordinates over and over on a ~2px detail is the signature failure here. **The visibility baseline governs observation, not just verification: a value you can only establish with a measurement script is a value no viewer can see — it needs no number, no plan constant, and no further probe.** When eyeball reads keep disagreeing at ≤3× zoom, that instability IS the answer: write the mechanism with a confidence marker (Phase 3) and stop measuring. Rephrasing the question ("now I'm checking the cursor, not the color") does not reset the cap — attempts count against the underlying detail, whatever the probe is named. **Negative findings generalize:** once two representative elements of a family show no entrance animation / no fade-in, extend that conclusion to the whole family.

**Determine each effect's DRIVER by tracking the visible cursor** (the recording shows a visible cursor marker):
- deformation/response follows the cursor **path** (angle/offset varies with cursor position) → pointer-driven (`mousemove`), even if the effect also runs ambiently — some pages layer both; when ambiguous, implement **both** layers;
- changes **only during a drag** → drag-gated;
- motion with the cursor **parked or absent** → time-driven autoplay;
- motion locked to **scroll position** (advances and reverses with scroll) → scroll-driven.
The driver decides both the implementation and how Phase 4 must trigger the recording; getting it wrong burns the whole 3-attempt recording budget on a mechanism that can't fire.

**Read the frames, then write the motion spec yourself.** For every clipped effect, derive its spec **from the frames alone** before implementing: which element, which transform (translate / scale / rotate — and around which axis / 3D perspective flip / curvature bend / parallax), start and end states, approximate duration and easing. Frame timestamps give you the duration; the intermediate frames give you the transform type. Task-provided hints about motion are coarse pointers at best — the frames are the only ground truth.

**Phase 1+2 round budget:** for a 30–60s video, observation + clipping should land within **~15 rounds total**. Past that, stop investigating — write what's left into the Ambiguities list with your best hypothesis and move on: Phase 4 verifies against your own deploy at full resolution, where those questions settle for free.

---

### Phase 3 — Write `out/plan.md`

Spell out everything you intend to build, then `Write` it to `out/plan.md`. This file is the design baseline that Phase 4 verification will hold the replica against. Tag every **observable** concern with `[S<#>]` (static) or `[D<#>]` (dynamic):

```
# Plan — <site>
## Layout strategy
[S1] Three-column grid at 1440px; heading spans 0.42 of viewport width (still @12.0s) {core}
...
## Component breakdown (untagged — architectural)
- ...
## Design tokens
[S2] Colors: primary #FACC15, bg #1e293b, ... (still @3.5s) {core}
...
## Interactions & animations
[S3] Trash icon → red on hover (instant — the end state is the whole story) {detail}
[D1] Modal entrance: 250ms fade+scale (source clip 8.2–10.0s; framer-motion; testid=modal-panel) {detail} {render}
[D2] Gallery: left heading pins while images scroll under (source clip 18.3–20.0s; CSS sticky; testid=gallery-pin) {core} {render}
...
```

Tag rules:
- **The bracketed id opens the line, literally** (see *Exact line formats*). Prose lines, bullets and sub-sections around them are free-form — but a tagged concern that starts with anything else (a table cell, a `###` heading, `S4.`) is invisible to the close-out audit, which then reads the plan as having no tagged concerns at all.
- **Visibility is the only test for whether to tag.** If it shows up on screen, tag it — regardless of what drives it (`useState`, props, CSS, a library). Skip a line only when it produces *no* visible result. "It's just transient `useState`" is **not** grounds to skip a visible state-change.
- **Coverage — close the loop.** Every interaction/animation named in the Phase 1 observation, and every moment clipped in Phase 2, must map to at least one tagged line. Silently dropping an effect — no tag, no verify entry, no check — is the *same failure* as misclassifying it, and harder to catch.
- Number `[S<#>]` and `[D<#>]` as two independent sequences, continuous, no gaps, no duplicates.
- **Weight-tag every line at plan time: end each `[S#]`/`[D#]` line with `{core}` or `{detail}`.** `{core}` — structure-critical: the page-level layout skeleton and scroll→chapter mapping; any entity whose share of the frame reaches **~15–20%+ at ANY anchor state** (judge by its maximum across states); and **attention anchors regardless of area** — the brand mark, display-level headings, any element the video dwells on or zooms into. A core entity's structure, look, and signature motion are all core concerns. `{detail}` — every other observable concern (smaller subjects, visible details). The tag is fixed at plan time and decides the fix budget in §4.3. Deltas invisible at ≤3× zoom carry NO weight tag — they sit below the visibility baseline: zero fix rounds, no scripted probing, and no plan constant of their own. The plan's entity list is a build guide, **not** a bound on verification: the §4.2 difference scan judges whatever is on the composite, listed or not.
- Every `[D]` line also names the `data-testid` its element will carry (`testid=...`). Phase 4 builds the attribute straight from the plan and verification selects by it — naming it once here is what prevents guessed selectors, grep hunts for your own naming, and wasted recordings later.
- **Source-tag every line that covers a moving region: add `{render}` or `{footage}`** next to the weight tag (`... {core} {render}`). This is the Phase-1 rendered-or-footage call, written down where the audit can read it. `{render}` — the source generates these pixels at run time, so **your code must generate them too**: no mp4/webm/gif/APNG/animated-WebP asset, no numbered frame sequence, no blitting source frames into a canvas. All the same thing; all barred. `{footage}` — the source page is itself playing a video file, so shipping one is the faithful build. **A `{footage}` line must carry two things or it does not count: the source clip range that shows the footage signals, and `asset=/assets/<name>.mp4`** naming the file you will ship. Untagged lines are read as `{render}`; doubt resolves to `{render}`. Static lines over still regions need no source tag.
- Every `[S]` line carries the **measured numbers** read off the Phase 1 stills; every `[D]` line carries the **source-measured numbers** from the Phase 2 clip (duration and amplitude always; direction/axis/origin, stagger order and interval, easing character where the effect has them) plus the clip time range and the implementation approach. A line written from memory is a guess, not a design decision. **Every number here must be one you read, not one you computed** — a constant distilled by scripting the source frame (ink bbox, stroke thickness, per-character advance, channel delta) is barred by the visibility baseline even when it is arithmetically correct: it becomes a Phase-4 target no composite can settle, so the id can then only be closed by re-running the same script. **When the source measurement itself is low-confidence** (compression noise, sub-pixel amplitude, ambiguous readings), write the *mechanism* — what couples to what, in which direction — with a confidence marker, **not a derived constant**: a precise number distilled from weak data becomes a false verification target in Phase 4.

**Static vs Dynamic — a verification question, not an implementation question.**

> **The only test:** Can you name a single screenshot — one frozen frame, at a state you can navigate to and hold still — that on its own proves this line is correct?
> - **Yes → `[S]`.** The truth is a fixed configuration; one still frame is ground truth.
> - **No → `[D]`.** The truth lives in how two things change *together* as a continuous input advances — **elapsed time, scroll position, or pointer/drag position**. No single frame can prove a coupling.

Worked examples:
- Final layout, colours, typography, an instant modal pop, a hover state you can hold open → **`[S]`**.
- 300ms scale+fade modal entrance → **`[D]`** (the truth is the timing/easing *between* frames).
- Sticky header pinning; parallax; scroll-snap; scroll-progress reveal; drag-coupled carousel → **`[D]`, even though every one of these is plain CSS**.

**Tie-break — default toward rigor:** if you cannot name the one proving screenshot, it is `[D]`. "It's only CSS", "there's no easing", "it has a trigger so it must be simple" are **not** reasons to call something `[S]`.

**Evidence rule:** if a Phase 2 clip shows the effect *mid-progress* across two or more frames, it **cannot** be `[S]`. Reconcile the tag with what the clip actually shows — don't assert "static" against your own footage.

**`out/plan.md` must exist before any component code is written.** If you find yourself editing `src/` without the plan file on disk, stop and write it first.

**Write the `out/report.md` skeleton in the same turn as the plan** — issue both `Write` calls in one message, the plan first. The deliverable then exists from the very start; a run cut short later leaves a fileable report on disk instead of nothing. The skeleton is a placeholder carrying a marker you remove only when you finalize it at close-out:

```
<!-- V2C_REPORT_SKELETON -->
# Report
**Shipped:** (tbd)
**Deployed URL:** (tbd)
**Deferred (id → reason):** (tbd)
```

Grading treats a report still carrying the `V2C_REPORT_SKELETON` marker as **unfilled** (no credit). At close-out you replace the placeholders with the real content and delete the marker line.

---

### Phase 4 — Build, deploy, verify

#### 4.1 Build

1. Initialize the project per `web-replicate` (init script → project at `app/`). **WebGL/3D page** (per Phase 1): scaffold with the `default-3d` template (`init-webapp <title> default-3d`) and follow `video2code-3d` for the scene, recipes, software-render budget, and 3D verify rules.
2. **Assemble before polishing:** first put up **every section as a placeholder component** wired into a page that builds and deploys — coverage first — then flesh out one component/effect system at a time. Never leave a section unstubbed while polishing another. **Cap pre-verify polish:** before the first `out/verify.jsonl` line lands, do not iterate the *same* visual detail more than **twice** — get coverage and run the first sweep, then fix against evidence. Polishing a detail you have not yet judged against the source burns rounds blind; this is a separate, earlier failure from the post-sweep **tiered fix-round regime** (§4.3), which only starts once verification is underway. **Batch the writes:** independent new files (components, hooks, SVG assets) go as parallel `Write` calls, 3–4 per turn; collect every planned change to one file into a single `Edit` per turn — one hunk per round doubles the build's round count (the build is the sync point, not each file).
3. Ship image assets and real copy as you build each component (see **Image assets** below) — wire real `/assets/...` paths before writing the JSX that references them, and read the real **text** (headings, body copy, captions, button labels) off the frames; never lorem ipsum.
4. While implementing interactive/animated elements, add stable `data-testid` attributes — they are the selectors verification will need. Give every **text-less interactive control** (icon buttons, arrow buttons, dot navs) an `aria-label` too: the browser element list shows only tag+text, so unlabeled buttons all read as `button: ''` and cannot be told apart when you need to click them during your own verification.
5. `npm run build` → `deploy_website(local_dir="app/dist", type="static")` → **first deploy only：**按 ZCode 官方 `control-browser` skill 用 IAB 打开 URL，等待 `domcontentloaded`，再用 `domSnapshot()`/`tab.screenshot()` 确认可达与视觉状态。
6. **Any `src/` edit invalidates the current build:** edit(s) 和 `deploy_website` 可在同一轮完成；部署保留相同 URL。随后恢复同一个 IAB tab 并 `reload()`，等待具体页面状态或 `tab.playwright.waitForTimeout(settleMs)`，再截图/录像。部署工具不再持有浏览器，也不返回截图。Never capture, record, or judge a build older than your latest edit. 长加载动画可放进 `tab.recording.start({settleMs,...})`，其最终 WebM 再由 `still_crops(recording,[t_end])` 取稳定帧。

#### 4.2 Verify — sweep first, fix in batches

**Adversarial mindset:** you are trying to prove the replica **wrong**. Hunt specifically for blank/flat sections where the source has content or atmosphere, and for the signature effects most likely to have shipped broken (3D / perspective / parallax / scroll-pinning). Sweep `[D]` ids in that risk order; simple fades last.

**The verdict instrument is a difference scan on the image — not a checklist fill-in.** A composite is judged by *finding differences*, the way a viewer plays find-the-differences. "Does it match what I planned?" is the wrong question and produces blind verdicts. For every SRC|REP artifact, before any verdict on the ids it covers:

1. **Scan the whole composite, block by block** — every distinct visual block on either side (subjects, background layers, patterns/textures, shadows/reflections, cards/text, overlays). List every visible difference, ranked by prominence at 1×. Differences of **shape and structure** — how many of something, what geometry, what arrangement, regular vs irregular, crisp vs diffuse — weigh exactly as much as dimensions and colors.
2. **Full-frame anchor composites: name at least 3 candidate differences before any verdict.** You may argue a candidate negligible afterwards; you may not skip the naming. Genuinely fewer than 3? Then say per block why the two sides are indistinguishable — when they truly are, that justification is easy; the floor only bites when you are about to gloss. Regional/zoomed composites: the scan still comes first, but may return fewer (or zero, with a one-line why).
3. **Pixels are the only admissible source.** You know what you built, and the source may print its own labels/readouts on screen; neither is evidence. Matching config values, mode numbers, or intent does not make two sides look alike — and your builder's knowledge actively pulls you toward seeing them as alike; treat it as interference, not information. In one audited run all four chapters' particle figures passed as "(m,n) … both", read off on-screen mode readouts, while the composites showed a sparse irregular figure on the SRC side and a regular ring-and-spoke web on the REP side — four false passes from one shortcut.
4. **The scan lands in the ledger.** Rows judged from a composite carry a `diffs` array: `{"what": "<one line>", "severity": "prominent"|"minor", "disposition": "fix"|"defer"|"negligible: <why>"}`. `pass` is legal only while nothing is left at `"fix"`. A prominent difference needs no pre-existing plan row to be actionable — it rides the (anchor) id it surfaced under into the §4.3 fix loop or an honest defer; "the plan never listed it" is how it got missed, not a reason to skip it. The diff lists are themselves evidence: scans that come back empty near close-out, after rounds of non-empty scans, read as fatigue, not fidelity.

**The first capture pass IS the sweep.** Judge and ledger from the very first artifacts captured after deploy — including the `fail`s. Do not take an unledgered "reconnaissance" lap (capture every section, eyeball it, fix by impression, then re-capture everything for the formal sweep): that acquires the same evidence twice for one verdict. A capture round that produces no verify line for any id should make you stop and judge what you already hold.

**Sweep — evidence by artifact, judgment by id, fixes deferred:**
1. Acquire evidence efficiently up front — composites batched, parallel `Read`s, recordings of unrelated regions in one turn. The evidence unit is the **artifact**; one artifact usually covers several ids.
2. Judge: run the **difference scan** (above) over the artifact, then hold each covered id's plan numbers against it per the Parity standard (§4.4).
3. Record one line per id for `out/verify.jsonl` — `{"id": …, "result": "pass"|"fail", …}` in the literal schema above — carrying the scan's `diffs` (composite-judged ids) and `measured` source→replica pairs (for `fail`, the measured delta in `reason`). Do NOT edit source code yet. Never stamp several ids off evidence you haven't examined per-id.

**Append at the moment of judgment.** The bookkeeping unit is the evidence artifact: the moment you finish judging an artifact's ids, append those lines in one `cat >> out/verify.jsonl` call, and let that bookkeeping **ride in the same turn as the next acquisition** (append calls first, then the next capture call — pairing them halves the sweep's round count). A `fail` is written when it is discovered, never reconstructed later; do NOT hold judged lines for an end-of-run ledger dump — the file's append timeline is part of the evidence. One artifact usually settles several ids; write them together. Never write a line for a check you haven't actually run.

**Chaining the audit onto an append: use `--progress`.** Running the contract audit in the same `Bash` call as an append (`cat >> … <<EOF … EOF` then `node "<plugin_root>/hooks/run_python.mjs" "…/contract_audit.py"`) is good round economy — keep doing it, but pass `--progress`. The shell returns the *last* command's exit code, so a bare audit that still has gaps (normally just "report.md is still the skeleton", which is the expected state until close-out) makes the whole call come back as a tool error even though your append landed fine. `--progress` prints the identical gap list and exits 0, so a successful append reads as successful. Drop the flag only for the final self-audit in §4.6, where a non-zero exit is the point.

Discipline (each a hard rule):
- **One id, one line, one examined verdict.** Every line cites the artifact it was actually judged from — ids covered by one artifact are judged one by one against it, never stamped in a batch.
- **No `pass` without a tool result that actually shows the effect.** Scrolling *past* the target, or two identical captures, proves nothing.
- **No `pass` without source-paired evidence.** For layout `[S]` ids: the same-scale SRC|REP composite (§4.4). For `[D]` ids: the recording proves the motion happened, but the closing line must cite a **matched-beat SRC|REP artifact** — source-clip frame vs recording frame at the same beats, one composite strip (recording path as supporting note). Build it in **ONE call**: `composite_view` accepts video paths on both sides — `composite_view(source=<Phase-2 clip>, replica=<your recording>, beats=[[t_src, t_rep], ...], out_path="out/cmp/<ID>_....png")` extracts and pairs the beats itself; no per-side `still_crops` needed. An artifact showing only the replica is a *working shot*: it can find bugs, it can never close an id — you would be certifying against your memory of the source, and memory certifies "a plate with patterns", not this plate. Save paired artifacts under `out/cmp/` **named after the id(s) they certify** (`out/cmp/D3_hover.png`; a shared artifact carries every id it covers, `out/cmp/D4_D12_reveal.png`) — the close-out audit keys on both the path and the name. `measured` carries **both sides as values read off the artifact**; a bare `"match"` is an impression, not a measurement — and a shared label or config value written once for both sides (`"(3,5) both"`) is a label, not a read; for visually-judged classes the verdict is "indistinguishable on the composite", citing the composite. The `evidence` field is a **bare artifact path** (a shared artifact: its one merged-name path) — viewport/beat annotations and `+`-joined path lists belong in `measured`/`reason`, never in `evidence`; the close-out audit parses that field as a path.
- **A `fail` → `pass` flip requires fresh evidence from THIS fix round** — the new `pass` line must cite a new capture, not the pre-fix one.
- **One capture per clean id.** Re-shooting a region you already judged adds zero evidence.

After the sweep: batch-edit files for **all** failed ids and append one `deploy_website(...)` **in the same turn** (auto-build, stable URL). Then recover the same IAB tab, reload once, and capture fresh evidence with Browser Use. Re-verify **only** the failed ids plus any passed id the fix plausibly touched (same file/section); give the fresh capture one glance for collateral regressions and stop — every other passed id stays passed, its evidence line stays valid. **Exception — global-system edits.** A fix that touches a shared visual system (layout skeleton / scroll mapping / camera / lighting / post-processing / a shared sim or animation core) invalidates evidence page-wide, not per-section. After that fix batch deploys, re-shoot the **anchor set** — the capture views your current evidence lines cite — in one batched capture round, build a fresh full-frame SRC|REP composite per anchor, and re-judge **every** anchor id through the difference scan (the 3-candidate floor applies), appending a fresh line per id. No anchor keeps its old line on a glance — "looks unchanged" is not a verdict.

#### 4.3 Caps

- **Fix budget follows the plan row's weight tag (Phase 3).** `{detail}`: **≤2 fix rounds**, then a `defer` line with the measured delta (`"reason": "duration 2.1× source after 2 fix rounds"`). `{core}`: **≤4 fix rounds** — a structure-critical miss is worth twice a detail's budget — but every core fix round must end in fresh paired evidence whose measured delta is **smaller than the previous round's**; two consecutive rounds without measurable shrink → `defer` immediately, remaining budget notwithstanding (the stop signal is the slope, not the count). For ids with no readable number (visually-judged classes), the shrink test uses the `diffs` severity ladder instead: the id's worst remaining diff must step down each fix round (prominent → minor → gone from the scan); two consecutive rounds stuck at the same severity → `defer`. A core `defer` never parks quietly: it leads the report's known-gaps. Sub-visible deltas have **no budget at all** (visibility baseline) — do not measure them, do not touch them. **At any cap the only exit is an honest `defer`** — a `pass` whose own cited composite still shows the delta is a false entry, not a fix.
- **Per-id recording cap:** a `[D]` id that has triggered **3** `tab.recording.start()` attempts without passing converts to `defer` — a 4th recording is never the answer; by then it's a real defect, not a flaky selector.
- **Evidence-escalation cap for a subtle effect:** **three inspection attempts total per id** — crops (`still_crops(your_recording.webm, [t...], crop, scale=2)`, timestamps from the trace `@t`), frame-diffs, and self-written measurement scripts all count against the same cap. Still inconclusive → verify the mechanism instead (paired before/after captures with an off-center cursor) or `defer`. A 4th probe script is never the answer.
- **Null-probe rule:** a probe reporting "no effect / 0" is evidence only after it passes a **self-check** (same frame vs itself → identity) and a **positive control** (a case where the effect is known present, e.g. the source clip). Before touching `src/` over a null reading, pixel-diff the two captures directly: pixels differ → the effect IS rendering and the probe is broken — fix the measurement, never the implementation.
- **Never `defer` an id whose check was never attempted.**
- **Evidence freshness gate.** Evidence captured before your last `src/` edit certifies a build you did not ship. If **any** code edit lands after the final sweep — even a one-line tweak — re-shoot the anchor set once (one batched capture round), build fresh SRC|REP composites, re-judge every anchor id per §4.2, and only then finalize. Plan the endgame so the final sweep IS the last thing before the report; an edit after it always buys exactly one more anchor round.
- Do not **finalize** `out/report.md` (fill the placeholders / remove the `V2C_REPORT_SKELETON` marker) while any plan id has no final `pass`/`defer` line. The Phase-3 skeleton is expected to be on disk; only its *finalization* is gated.

#### 4.4 Tool per id + Parity standard

**Parity standard — what counts as a mismatch (every `[S]` AND `[D]` id).** Judge side-by-side against source evidence (Phase 1 still for S; Phase 2 clip for D):

**Visibility floor.** The task-wide **visibility baseline** (top of this document), restated for verification — it binds observation and planning identically. Fidelity is bounded by what a viewer can see: a difference you cannot distinguish on the composite — including a crop-zoomed composite at up to ~3× (`composite_view` with crop+scale) — is within tolerance by definition. Pass it; do not measure it, do not fix it. An effect or delta detectable only by instrumentation is invisible to the viewer too, and does not need to exist in the replica.

**Where the numbers come from.** Every number used to pass or fail an id must be readable off an evidence artifact: dimensions off the (zoomed) composite, durations off timestamped grid cells (source clip grid vs your recording grid), values from tool receipts. Approximate values (`~2.0s`) at the tolerance's granularity are exactly right — never finer. **A script-computed number can never fail an id and never carries a pass by itself**; it may only appear as a supplementary note in `measured`. Scripted image work is limited to three uses — **this whitelist is task-wide, not verification-only: it is the complete list of what a script may do to an image in any of the four phases**:
1. **making evidence** — crop / scale / composite / grid assembly (unrestricted);
2. **binary pixel-diff** — "did anything change between these two captures", must include a same-frame self-check, used only to validate evidence (e.g. exposing two identical captures);
3. **one-shot color sampling** — at most one round per side, for the whole task; results feed tokens/notes, never a fail.

Any scripted measurement beyond these three is **out of contract**, not merely expensive: it counts against the evidence-escalation cap (§4.3), is subject to the null-probe rule, and its output may not enter `out/plan.md` or `out/verify.jsonl` at all. The signature failure — measuring the source frame's ink boxes, stroke thicknesses and luminance levels before writing code, then closing ids against those numbers instead of against a composite — produces a run whose every verdict is a self-comparison of two scripts, with no viewer-visible claim anywhere in the ledger.

| Tier | Definition | Examples | Disposition |
|---|---|---|---|
| **Tier-1 — structural** | present/absent or right/wrong | missing or invented element; overlapping elements; proportion glaringly off; **geometry sign flipped** (edge bows the wrong way, tilt leans the wrong way, wrong axis); D: wrong trigger, wrong animated property, wrong direction, effect absent | `fail` immediately |
| **Tier-2 — quantitative** | structure matches but a measured value exceeds tolerance | see thresholds | `fail` with the measured delta; joins the same batch fix round — never a solo fix |
| **Within tolerance** | deviation below threshold | — | `pass`, but write the measured delta into `measured` |

| Class | Check | Tolerance |
|---|---|---|
| Arrangement | items fully visible per viewport; column/row gap; item width as viewport fraction; stagger direction & offset | count ±1; gap ≤1.5×; width ±20%; stagger direction must match |
| Item geometry | aspect ratio; media/content width fraction; corner rounding; curvature/deformation depth | aspect ±20%; media fraction ±20%; rounding present-vs-absent binary; depth ±30%; curvature/tilt **sign** is Tier-1 |
| Typography | serif vs sans; case / italic / outline / letter-spacing; heading:body size ratio; weight step | family & treatments binary; size ratio ±20% |
| Motion (D) | duration; amplitude; child stagger order & interval; easing character (snap vs glide) | duration 0.67×–1.5×; amplitude ±30%; stagger order must match |
| **Anything not listed above** (pattern/figure shape and structure, brightness, texture grain, positions, hue) | the §4.2 difference scan on the (zoomed) composite | visible at 1×–3× → a real finding: structural in nature → Tier-1, quantitative → Tier-2; indistinguishable at ≤3× = pass. The visibility floor is the **only** shield — "no table row names this" is not one |

Cite numbers, not impressions — "feels slower" is not a verdict; "source ~0.3s, replica ~1.2s (grid timestamps)" is. For classes judged visually, "indistinguishable on the zoomed composite" IS a legitimate verdict — write that, citing the composite as evidence, instead of manufacturing a number. **Do not polish below tolerance**: a within-tolerance delta is a pass by definition; re-fixing it burns budget for zero fidelity gain.

**`[S]` ids (settled end state; valid only when the transition into it is instant or incidental):**

| Sub-case | Tool |
|---|---|
| Visible at load | IAB `tab.screenshot()`；响应式先 `setViewportSize()` |
| Hover end-state (instant) | snapshot-proven locator 或 `tab.cua.move()` → wait → screenshot |
| Click → new state (instant) | snapshot-proven locator `.click()` → `tab.screenshot()` |
| Sequenced | Browser Use locator/CUA actions → `tab.screenshot()` |

> 过渡结束后再截图（`tab.playwright.waitForTimeout(300)` 或等一个具体的稳定状态）才证明**终态**。If the hover/click plays a visible animation, that effect is `[D]`: record it.

For layout-bearing `[S]` ids the pass bar is a **same-scale `composite_view` against the full-resolution source frame** of the same region — read the Parity dimensions **off that composite** (it comes back inline; the saved path is the evidence path). Details too small at full scale (thin lines, small type, 1–2px features): zoomed regional composite, judged visually — the finest instrument the fidelity bar requires (a mis-aimed crop fails *visibly*; a mis-aimed measurement band returns a plausible wrong number). **Zoom by narrowing the `crop`, not by raising `scale`:** the delivered image is capped at ~2000px on the long edge and a side-by-side composite is twice as wide as one panel, so a full-width 1440px crop shows the same detail at `scale` 1, 2 or 3 — the extra magnification is silently undone. A crop ≤333px wide gets a true 3×. The receipt prints the factor that actually took effect and the delivered size; trust those, not the numbers you asked for. Two things narrowing the crop does *not* fix: an explicit `mode` may itself be costing resolution (the receipt names the effective resolution the other stacking direction would give — read that line before keeping your `mode`), and a dense image can be shrunk by the inline **byte** budget even with its long edge under 2000px, which neither a narrower crop nor a lower `scale` avoids — on a multi-row `beats` strip the only lever is fewer beats per call. One composite per section may serve every `[S]` id of that section. **Re-read the source frame at verify time** — where the plan text contradicts the frame, the frame wins: correct the plan line and judge against the frame (a spec that recorded a geometry sign backwards must not certify a replica that faithfully implements the error).

**Full-frame anchor parity — component rows do not sum to the page.** Camera framing, global particle/texture density, luminance mood, and scroll mapping live *between* per-section ids; a ledger of component passes can certify a page whose every chapter is framed wrong. Give each major chapter / scroll state one `[S]` id whose evidence is a **full-frame same-scale SRC|REP composite** at that state's anchor (these anchors are the same views the §4.2 anchor set re-shoots). Its verdict IS the §4.2 difference scan run over the whole frame (the 3-candidate floor applies), plus two numeric reads: **framing** — horizon height / subject's share of frame, ±20%; **state onset** — the chapter's card/state appears within ±10% of the scroll range of where the source shows it. Whatever the scan surfaces is judged on its own prominence — an entity present on one side only, a pattern whose structure differs, a mood that reads differently at 1× — whether or not any plan row or tolerance-table class names it. When the SRC side carries browser chrome (a tab/address bar — see Phase 1), read framing and onset against the page region below the chrome strip; "SRC shows a tab bar, REP does not" is not a candidate difference and does not count toward the 3-candidate floor.

**One capture chain per id.** Layout/static ids尽量复用同一组 IAB screenshots；只有状态依赖 DOM/scroll/hover 的 section 才单独用 locator/CUA 定位并截图。不要对同一 section 重复走全页和 live 两条证据链。

**`[D]` ids:** `tab.recording.start()` (§4.5). The driving input — time, scroll, or hover/click — goes **inside** the `actions` arg.
- **Scroll-coupled** (sticky / parallax / scroll-snap / reveal): the interaction is a `scroll`/`scrollTo` action, and the recording must capture the **coupling itself** — the pinned element holding position while the rest moves, across the scroll.
- **Hover/click appearance animation:** the hover/click *is* the interaction; the recording must capture the **motion**, not the resting frame.
- **Exception — simple one-shot transitions** (plain fade/slide/scale entrance, no 3D, no perspective, no scroll-coupling): several tightly spaced IAB screenshots fired after the trigger are acceptable **iff** at least one frame shows the element mid-transition. All transform-coupled effects still require a recording.

A single end-state screenshot does NOT verify motion or coupling.

**Mechanism present ≠ id passed.** Once the recording shows the effect exists, hold it against the **source clip itself, not your recollection of it**: one `composite_view(source=<Phase-2 clip>, replica=<your recording>, beats=[[t_src, t_rep], ...], out_path="out/cmp/<ID>_....png")` call builds the matched-beat SRC|REP strip directly from both videos — make that strip the closing evidence, with duration (recording `@t` span vs source clip span), amplitude, direction/axis/origin, stagger order and interval, easing character all read off it. Plan text and memory are not a source side. An effect that fires on the right trigger but runs 3× slower is a Tier-2 `fail` with the measured delta — not a pass.

> **Land inside the target region before you judge it.** Never scroll a large fixed pixel amount in one jump. Use selector-based `scrollTo` or steps of ≤ one viewport, confirm the region is on screen, then capture. Two identical captures = your scroll had no effect; diagnose, don't pass.

#### 4.5 ZCode `tab.recording` constraints

| Constraint | Limit |
|---|---|
| `[D]` ids per recording | up to 3, when their triggers chain into one ≤10s flow in the same region. Each id still gets its own verify line citing the shared recording. Unrelated regions → separate recordings. |
| Duration | ≤10s |
| Interactions | ≤4 (waits + the chained triggers) |
| Positioning | `{type:"scrollTo",selector,…}` 定位，再用 2–3 个不超过一屏的 `scroll` 动作拍 coupling；不要猜一个巨大像素跳转。**Scroll-triggered entrances 必须"走进去"才会触发**：先 `scrollTo` 到目标**之前**的一节，再用 ≤1 屏的 `scroll` 步推进 —— 直接 `scrollTo` 目标常常落在 reveal 已经播完的位置，拍到的是静止终态。**Tall pinned/scroll-coupled containers (≥1.5 viewports, e.g. a 300vh h-scroll pin): 一次 `scrollTo` 落点无法保证在 pin 的起始态**，同样先对齐到它上一节，再用 2–3 个 ≤1 屏的显式 `scroll` 驱动 coupling。 |
| Pointer-coupled effects (tilt / pan / magnetic) | 用多个带 `durationMs` 的 `move` 做 sweep（光标划过元素，才能拍到完整 coupling 曲线），再静置；`hover` 只停在元素中心，对 distance-coupled effect 输出**为零**。要拍 hover-**out**/leave 过渡，必须 `move` 到**另一个元素**上 —— 在同一元素内挪一点很可能仍在命中区内，`mouseleave` 根本不触发。 |
| Pure-wait | 只有 `wait` 的 actions **默认不可作 `[D]` 证据**；唯一例外是 Phase-2 clip 已证明该动效纯时间驱动、零 scroll/pointer 耦合（`{render}` 区域在光标静止、不滚动时自己在动），此时在 verify line 里显式记下这条 autoplay 判定再放行。其余情况 actions 至少含一个真实 trigger。`{footage}` 的 carousel/reel 根本不是录像目标：走 footage 路线验（plan 里声明素材 + 逐帧比对）。 |
| Selectors | `[data-testid="..."]` or `button:has-text("exact text")`. Never `:nth-child(N)` or unqualified `.btn` |

**Read the interaction trace before the frames.** The tool result lists, per action, whether it ran and where the target sat relative to the viewport, each line with an `@t` timestamp on the recording's own timeline (page load counts — actual duration often exceeds requested). If the trace shows the target out of frame or a center-hover on a distance-coupled element, the recording is **invalid evidence** — fix the interaction plan and re-record once; don't burn rounds analyzing frames the trace already disqualified. The result inlines timestamped frame grids sampled from the recording — anchor on the `@t` of the triggering action when locating the effect.

**Batch the follow-up crops.** When judging a recording needs zoomed stills (`still_crops(recording, [t...], crop, scale)`), collect **every timestamp and region you want from that recording into one turn** — one call per recording (≤12 timestamps), parallel calls when several recordings are pending. Every extra crop round re-reads the whole history; trickling one crop per round over a recording you already hold is the signature late-phase waste.

**Plan recordings around coverage, not one-per-id.** Group `[D]` ids by page region and trigger chain; aim for the fewest recordings that give every id a mid-motion capture. A page with a dozen D ids should normally need 4–6 recordings plus a burst or two for simple entrances. **Same element carrying multiple effects (e.g. a scroll entrance AND a pointer-coupled pan): one recording serves both — chain the triggers with a settle gap so the motions don't overlap on film**: 先 `scrollTo` 到目标之前一节再用 ≤1 屏的 `scroll` 步走进去（entrance plays, judge id A from this span） → `wait` until the entrance fully settles (~1–1.5s) → 带 `durationMs` 的 `move` sweep 或 `hover`（judge id B from this span）。Each id's verify line cites the same recording with its own `@t` span. Recording the same element twice, or sweeping before the entrance settles (two motions superimposed = unjudgeable evidence, a wasted attempt), are both avoidable with this pattern. One exception to merging: an id likely to need a fix-and-re-record cycle (novel mechanism, first of its kind on the page) records **alone** — re-recording a merged take re-films every id in it.

Pair each recording with `clip_video` of the corresponding source moment and compare the coupling (what stays put vs what moves). Both sides arrive as timestamped frame grids — **the side-by-side visual read of those two grids IS the `[D]` verdict instrument**; durations and stagger intervals come off the printed cell timestamps. The pass criterion is **same transform type**, not "something moved": source shows a 3D rotation / perspective flip / curvature bend / parallax and yours shows a plain translate + fade → `fail`. A multi-stage scroll choreography that can't fit one ≤10s recording → split into multiple `[D]` ids, one per stage.

#### 4.6 Close-out — `out/report.md`

**Final motion sweep (mandatory, before the report):** give the Phase-1 contact sheet (and your clip grids) one last scan for any motion or visible state change that never became a tagged plan id. Anything found goes back through the loop — clip → tag → verify — before close-out; a silently missed effect is the same failure as a failed one.

**Self-audit (mandatory, before finalizing the report):** run the contract audit yourself — `node "<plugin_root>/hooks/run_python.mjs" "<plugin_root>/skills/video2code/scripts/contract_audit.py"` (plugin root announced at session start; fallback `cat .v2c/plugin_root`). It mechanically checks the whole contract — coverage, D-id paired evidence under `out/cmp/`, evidence↔id attribution, freshness — and prints a gap list. Fix every gap (missing paired strips: one `composite_view` beats call per id), re-run until it reports clean, and only then finalize `out/report.md`. The Stop hook runs the exact same audit — finishing with gaps just bounces you back here with extra rounds burned; auditing yourself first is always cheaper.

**The contract belongs to the session that took it on, not to the directory.** The Stop hook only enforces closeout on the session that claimed the contract (claiming happens when you write `out/plan.md` or `app/src/**`), so a replication that *another* session left unfinished in this workspace never becomes your obligation — you get an advisory, not a block. Two consequences: (a) if the user's request this turn is unrelated to a contract you claimed earlier, state the open gaps in one line and **ask** whether to close it out — if they say no, write `.v2c/contract_abandoned` with a one-line reason and finish normally, rather than grinding through a task the user no longer wants; (b) `.v2c/contract_abandoned` is the *user's* exit, never a shortcut around your own gaps — don't write it for a contract the user still wants.

When every plan id has a final `pass`/`defer` line, write `out/report.md`:

```
# Report — <site>
**Shipped:** <1–2 sentences on what the deployed page does>
**Deployed at:** <url>
**Deferred (known limitations):**
- D3: <reason from its defer line>
- (omit if none)
```

Then give a short closing message in the same turn as the report `Write`. Skipping the report leaves no record of what shipped vs what was consciously traded off.

---

## Image assets

**Goal: every image-bearing region's final look survives a side-by-side against the source frame.** How you get there is your call — per region, choose the means; the verify sweep, not the sourcing method, guarantees quality.

**Hard floor (non-negotiable):**
- **Zero external network requests** in the shipped page — no hotlinked images, no CDN fonts.
- No broken `<img>` and no obvious placeholder color-blocks where the source shows real imagery. (`deploy_website` scans the build for referenced-but-missing `/assets/` files and lists them — fix every one before calling the task done.)
- Real **copy** from the frames — headings, body, captions, button labels. Never lorem ipsum.

**Resources & options — decide per region by content type:**
- **If the task provides an asset catalog** (a thumbnail sheet with `ref` labels like `a01`): the catalog is a resource, not an obligation. Decide per region first, then download in **batches** — `get_asset(refs=["a01","a05",...])` fetches all the images you've chosen for a page/region in one call and inlines a preview per image (one call per image wastes a round each) — **judge the preview**: content matches → use the returned `/assets/...` path; content wrong / resolution too low / cropped badly → **reject that ref** and pick another or fall back to the routes below. Never force a wrong image into a region just to use the catalog — a wrong photo hurts fidelity more than a drawn stand-in. Reference only the returned local path; never an external URL; not every region needs a catalog image.
- **Photographic / complex real-scene regions (no catalog, or refs rejected): crop the source frame.** If the region appears fully visible, unoccluded and settled in some frame, extract it directly — `still_crops(video, [t], crop, save_to="<name>.png")` writes the file to `public/assets/` in the webapp and returns a low-res thumb to confirm the region (batch every region into one turn) — then reference it via `<img src="/assets/<name>.png">`. A cropped source pixel is the strongest possible parity evidence; never hand-draw a photograph the video already shows in full. **Crop is off-limits when:** (a) part of the region must animate independently (an inner layer rotates/moves while the rest holds — build layered: crop or draw the static base, SVG/DOM the moving layer); (b) the region carries **copy or animated text** — text is always real DOM text (hard floor), never pixels; (c) no frame shows the region complete and clean — then draw; (d) **the region is tagged `{render}`** — see the hard limit below.
- **The hard limit on sourced pixels: a sourced asset is ONE FROZEN FRAME.** This whole route ships stills, and `still_crops(save_to=)` is its only sanctioned channel — it records provenance (source, timestamp, crop) in `.v2c/assets_manifest.json`, which the close-out audit reconciles against what is actually in `public/assets/`. Writing image assets there by hand with `ffmpeg` bypasses that ledger and is off-contract. **Motion is never sourced.** For a `{render}` region — anything the source page draws at run time — you may not ship the source's own moving pixels in any form: not an mp4/webm/gif/APNG/animated WebP, not a numbered frame sequence, not source frames blitted through a canvas. They are one move wearing different clothes, and each is a total substitution of the source for the work. **The one exception is a `{footage}` region** — where the source page is itself playing a video file — and there shipping a clip is the correct build, provided the plan declared it with `asset=` (see Phase 3). If a rendered scene is too complex to author faithfully, build the honest approximation and write the shortfall into `report.md` Known-gaps; a replayed source render is not a lesser version of the task, it is a different task.
- **Simple icons, marks, glyphs, geometric/flat/pattern illustration: draw them** — inline SVG / canvas, CSS gradients/textures/patterns, pseudo-3D construction for icons (match the rendering style: a 3D/skeuomorphic icon needs a pseudo-3D stand-in, not a flat glyph). For a **logo or custom mark**: first crop-zoom the source frame (`still_crops(video, [t], crop, scale=2)`) until you can describe its construction — stroke count, angles, gaps, letterform quirks — then draw; never substitute a generic glyph. This menu is a starting point, not a whitelist — mix approaches per region as fits.
- **3D model / texture / HDRI assets do not exist in this environment** — a WebGL scene's subjects are never loaded, they are built: procedurally for mechanical/geometric subjects, as a stylised approximation for organic/photoreal ones. The ladder and the recipes live in `video2code-3d`.

**Judgment reference:** photographic imagery → real pixels (catalog image if provided, else a source-frame crop) beat a drawn substitute; geometric/illustrative/pattern imagery and icons → a faithful redraw in the matching rendering style beats a mismatched photo.

---

## Anti-patterns

**Skipping observation / planning**
- Skipping the written observation, or listing ambiguities but never clipping them ("I will implement ..." guesses).
- Writing `- (none)` for ambiguities to skip Phase 2 while the video clearly has motion / scroll / hover-click animation — clips are also the `[D]` evidence base and the Phase 4 comparison source.
- An effect visible in the video (or clipped) that never becomes a tagged plan line — silent omission dodges tag, verify entry, and check ("just transient `useState`" included).

**Mis-classifying `[S]` vs `[D]` (the costliest mistake — it silently downgrades verification)**
- Tagging a scroll- or pointer-coupled effect (sticky, parallax, scroll-snap, reveal, drag) as `[S]`; reasoning "it's only CSS / no library / no easing, so it's static"; resolving doubt toward `[S]` to skip a recording — classification is *whether one frozen frame proves it* (Phase 3), and the tie-break lands on `[D]`.

**Bad verification discipline**
- Skipping hover verification (hover bugs ship silently), or verifying an animated hover/click with only a settled screenshot — the resting frame proves the end state; the motion is `[D]`, record it.
- A visual class passed because a **label matches** — shared config/mode values, on-screen readouts, or knowing what you built are not sameness evidence; only the composite is (§4.2 scan, rule 3).
- A composite-judged row with no `diffs` scan behind it — or scans trending to empty near close-out without the per-block justification.
- A `pass` written at the fix cap while the id's own cited composite still shows the delta — the cap's only exit is an honest `defer`. In one audited run a 0.5-frame-wide shadow, plainly present in SRC and absent in REP on the very composite the line cited, was passed as "prominent both"; the ledger then certified a page missing half its closing composition.
- Tuning code after evidence was captured and shipping without a freshness pass — in one audited run 11 of 13 cited evidence artifacts predated the last code edit: the ledger certified a build that was never shipped. Working shots taken while tuning are not evidence; global-system edits and any post-sweep edit trigger the anchor re-shoot (§4.2/§4.3).
- Closing ids on replica-only artifacts, "comparing to the source" from memory — in one audited run 20 of 24 ids passed with no source pixel in their evidence; three chapters' camera framing had drifted wholesale and every row passed, while the 4 ids judged on SRC|REP composites were exactly the ones whose defects got caught and fixed. Paired evidence (§4.2) is what makes verify able to see at all.
- 对 scroll- 或 pointer-coupled 的效果录一段只有 `wait` 的 pure-wait 片子 —— coupling 根本不触发，film 里只有静止层；纯时间驱动的 autoplay 判定只留给 Phase-2 clip 已证明"光标静止、不滚动也在动"的效果，而白拍一条照样烧掉该 id 3 次录制机会中的一次。

**Wasted rounds (every extra round re-reads the whole history — late-session rounds are the most expensive)**
- Re-reading a file you just wrote/edited "to confirm" — a clean Write/Edit result IS the confirmation.
- Re-deploying, re-screenshotting, or navigating to the same URL after a redeploy without a change in between — no new evidence. Redeploy 后只需恢复同一 IAB tab 并 reload 一次。
- Debugging an updated `public/` asset through more code edits while the capture refuses to change — two identical pixel reads of the same URL mean the browser served **cache**, not your new file: rename the asset (cache-bust) and redeploy before touching anything else. In one audited run three successive "fixes" chased a rectangle the cache had already outlived.
- A bare shell `sleep` before a capture（用 `tab.playwright.waitForTimeout()` 或录像 action 的 `settleMs`/`delayAfterMs` 代替）, or an `npm run build` round before every deploy (`deploy_website` auto-rebuilds; build separately only for the full output).
- A turn containing a single "mover" call — a `deploy_website` with no edits beside it, a scroll with no following observation, or a solo `npm run build` the deploy would run anyway. Attach the mover to the work that makes it necessary.
- Re-guessing a tight-crop timestamp round after round (29.45s → 29.31s → …) to catch a moving element fully visible — pull one dense series (Phase 1: 4–6 closely spaced times, one call) and pick the settled frame off it.
- One file per round during build, or the same file `Edit`ed across consecutive rounds — independent new files are parallel `Write`s in one turn; collect a file's hunks into one turn.
- Serial rounds for independent calls — captures, `Read`s of several stills/grids, verify appends riding with the next acquisition (§4.2), batched `still_crops` per recording (§4.5): batch them in one turn.
- Duplicate evidence: the same sections through both the full-page-crop chain and live per-section captures (§4.4); re-shooting a region already judged; an unledgered "reconnaissance" lap before the sweep (§4.2); re-making the whole composite set after a fix round instead of only the ids the fix touched.
- A capture round followed by a `composite_view` round on that capture when both can be requested in one turn. Browser actions share one IAB tab and scroll state: keep their order explicit，never treat them as parallelizable.
- Making an evidence image with a Bash script and `Read`ing it next round — `still_crops` / `composite_view` return it inline；视觉证据通过 IAB screenshot/recording 获取。

**Missing real assets / content**
- Shipping `<img>` with a placeholder or non-existent `src`, or a CSS colour block where the source has a real photo/logo.
- Hotlinking an external URL instead of a local `/assets/...` file.
- Lorem ipsum instead of the real copy visible on the frames.
- **Shipping the source's own moving pixels for a `{render}` region** — an ffmpeg-cut backdrop clip, a frame sequence, source frames blitted through a canvas. It scores perfectly on a pixel composite and reproduces nothing; the composite is a proxy for having built the thing, not the thing itself. The tell that you are about to do it is an argument for why *this* source is too hard to author — write that into Known-gaps instead, over an honest approximation.
- Writing image assets into `public/assets/` with a hand-rolled `ffmpeg` call instead of `still_crops(save_to=)`, leaving them absent from `.v2c/assets_manifest.json`.
