---
name: video2game
description: Replicating a browser game shown in a GAMEPLAY screen-recording as a PLAYABLE game — the rules, the core action and its feel, win/loss/death/restart, HUD, art and effects, all driven by real player input. Use whenever the task provides a recording of someone PLAYING a game (steering, jumping, shooting, matching, placing, defending) and asks to replicate / recreate / clone it (复刻/复现/还原) as a working game. If the game renders a true-3D scene, scaffold `default-3d` and follow skills/video2code/references/3d-notes.md.
---

# video2game — replicate a recorded game as a playable game

Faithfully replicate the game demonstrated in the reference video. Two equally weighted goals:

1. **Visual fidelity** — scene composition, art, HUD, effects and motion, same discipline as classic
   video2code (measure off frames, never recall).
2. **Playable fidelity** — the *rules* the video proves must run as a **real simulation driven by
   real player input** in your replica. A pixel-perfect scene that plays itself, ignores input, or
   has no lose condition is a FAILED task, no matter how good it looks.

The video is a **gameplay recording**: a player driving the game. Every observable consequence of
play (HP drops on contact, score ticks on pickup, a wave banner after the last enemy dies, the
death screen, the restart) is evidence about the rule set. Extracting that rule set is as much your
job as reading the art. **The source game already did the game design — your task is extraction,
not invention.** Never add rules, content, or polish the video does not demonstrate.

## Environment (read once, trust it)

First follow [video2code](../video2code/SKILL.md) to activate replication hooks and find the plugin root. Replace `<source-video>` in every example with the user-specified or manifest video path. Managed preview and capture require the separately supplied runtime service; if unavailable, use local checks where possible and report managed verification as unavailable instead of claiming it succeeded.

- **Video**: `<source-video>` (read-only). No frames are pre-attached — extract frames
  with the ffmpeg / CLI recipes in **§Video tooling** (own section below); that is your first job.
- **Project — you scaffold it (plugin mode, nothing is pre-created)** via web-replicate:
  `bash <plugin_root>/skills/web-replicate/scripts/init-webapp.sh "<game-title>"` → creates `app/`
  (React + TS + Vite + Tailwind, common libs preinstalled). `<plugin_root>` is in
  `.v2c/plugin_root`. The game lives in a full-viewport canvas mounted from React; game code goes
  in plain TS modules under `app/src/game/` (no React inside the loop).
- **3D games**: if Phase-1 observation shows a true-3D scene (perspective camera, depth, WebGL
  signals — true 3D perspective/depth, particle fields, volumetric glow, free camera, fractal zoom,
  full-bleed shader), scaffold `default-3d` instead and follow the plugin's
  `skills/video2code/references/3d-notes.md` — its hard rules (raw three.js, no pseudo-3D,
  render-tier parity, software-render budget, chunked-write limits) apply on top of this skill.
- **Deploy & verify**: `npm run build` → `deploy_website(local_dir="app/dist", type="static")`
  (stable local URL; `preview_build` only when the managed harness runtime is present). The runner
  builds the final source after the agent stops; a successful build alone does not establish that
  the game is playable. To **actually play** for verification, drive the deployed game in ZCode's
  built-in browser (`control-browser` skill): `tab.cua.keypress/click/drag` and locator actions
  for input, `tab.screenshot()` for states, `tab.recording.start({actions})` for motion
  (see skills/video2code/references/browser-checks.md). Only on the managed runtime may
  `browser_capture` (`script=<workspace .py file defining async run(page)>`, `kind=record`) replace
  it. Dispatch real keyboard/mouse events; never judge from stills alone.
- **Evidence files** can live under `out/` in the project directory: use `out/plan.md`, `out/verify.jsonl`,
  and `out/report.md` to document the project and its checks.

## Stack — simulation first, boring choices

| Layer | Use | Notes |
|---|---|---|
| Sim core | plain TS: fixed-timestep update (accumulator over `requestAnimationFrame` dt, clamped) | **state advances by simulated time, never by frame count** — the verify browser may render at 5 fps and the rules must not change |
| Render | canvas 2D (or three.js via `default-3d` for 3D games) | render reads sim state; it never mutates it |
| Input | keyboard/mouse/touch listeners → an **intent buffer** the sim consumes per tick | intents, not raw events, so buffering/coyote-style forgiveness is implementable and testable |
| HUD | React over the canvas (`pointer-events:none` except real buttons) | every number on the HUD binds to sim state — no decorative counters |
| Audio | Web Audio, event-driven, only if the video evidences sound cues visually (mute icon, visualizer) | optional; never block boot on audio |

Two mandatory forensic hooks, wired from the start (they are how `[G]` rules get verified):

- **`window.GameJudge.snapshot()`** — read-only, returns a JSON-serializable snapshot of rule
  state: phase (`menu/playing/dead/won/paused`), score, hp/lives, level/wave, resource counts,
  entity counts by type. Calling it must never mutate play.
- **`?seed=<n>`** — fixes the RNG seed so a verification run is reproducible. All randomness goes
  through one seeded generator.

## Video tooling (self-contained — no video MCP in this harness)

- **Base strip (Phase 1 first move)**: `mkdir -p out/obs && ffmpeg -i input/video.mp4 -vf "fps=2,scale=768:-2" -q:v 3 out/obs/f_%04d.jpg` → **Read every frame in chronological order** (frame N ≈ t = N/2 s); long videos in batches with notes, never skip a region.
- **Dense segment at a moment** (ambiguities, `[D]`/`[G]` transitions, core-action cadence): `ffmpeg -ss <start> -to <end> -i input/video.mp4 -vf "fps=10,scale=768:-2" -q:v 3 out/obs/<label>_%03d.jpg`, then Read the burst in order.
- **Exact full-res frames / zoomed crops** (batch every timestamp into one call, then Read the outputs in the same turn): `python3 <plugin_root>/skills/video2code/scripts/still.py <video> <t1> <t2> ... [--crop X,Y,W,H] [--scale 2] [--out DIR]`.
- **Same-scale SRC|REP composite** (the standard parity evidence for `verify-S*` and matched-beat `verify-D*` strips): `python3 <plugin_root>/skills/video2code/scripts/composite.py <source_img> <replica_img> --out out/cmp/<ID>.png [--crop X,Y,W,H --scale N]`.
- **Asset crops** (sprites/tiles to ship): `ffmpeg -ss <t> -i input/video.mp4 -frames:v 1 -vf "crop=w:h:x:y" app/public/assets/<name>.png` → Read to confirm, adjust, re-crop. **Grouped small-assets rule**: for a SET of small artworks (sticker grids, icon strips, avatar rows), find the frame where the set is fully crisp, compute the grid geometry once, crop every cell from that frame in a loop — never redraw frame-visible artwork as generic shapes; an occluded cell comes from a neighboring frame.
- Rules: read numbers off the artifacts your tools just showed (eye-resolvable granularity), never pixel-array scripts; batch calls — never one frame per turn; a photograph the video shows is cropped, never redrawn.

## File contract — what "done" means

| File | What | When |
|---|---|---|
| `out/plan.md` | Design spec. Every observable concern is one line tagged `[S#]` (static) / `[D#]` (dynamic/motion) / `[G#]` (game rule), with measured numbers and source timestamps, weight-tagged `{core}` (structure/skeleton, ≥~15–20% of frame, attention anchors) or `{detail}` (other observables); the tag sets the fix budget — {core} ≤4 fix rounds with shrinking delta each, {detail} ≤2, then honest `defer`. Plus a **Game design** section: player contract, core-action state machine, entity table, state-machine map. | End of Phase 3, **before any app code** |
| `out/verify.jsonl` | Append-only log, one JSON object per check: `{"id":"G2","result":"pass"\|"fail"\|"defer","evidence":"<path or snapshot pair>","measured":{...},"reason":"<required for fail/defer>"}`. Fixes append a new line for the same id; never edit old lines. | Live during Phase 4 |
| `out/report.md` | What shipped, controls, how to run, rule summary, deferred list with reasons. | Last act |

Done = every `[S#]`/`[D#]`/`[G#]` id has a final `pass`/`defer` line, `npm run build` passes, the
deployed game **boots to a playable state** (final deploy succeeded and the built-in browser showed it react to input), and report.md
exists. The close-out audit (`python3 <plugin_root>/skills/video2code/scripts/contract_audit.py`,
run it yourself before the report) mechanically tracks `[S]`/`[D]` ids only — `[G]`/`COV1`/`GS1`
coverage is on you, and a graded run reads a missing `[G]` verdict exactly like a missing `[D]`
one. Never `defer` a check you did not attempt.

## Workflow — strict order (base video2code phases, game deltas below)

### Phase 1 — Observe (scene AND play)

Base strip + full chronological Read (§Video tooling). Then write in your message:

```
## Video observation
<3–6 sentences: game type, art style, camera, what the player does>

## Player contract           ← the non-negotiables the replica must honor
- Genre & fantasy: <e.g. lane-dodging endless runner>
- Time structure: real-time | turn-based;  Space: 2D side / 2D top-down / true 3D;  Camera: fixed / scrolling / following
- Input model: <inferred — see below> (confidence: high/med/low)
- Verbs: <move, jump, shoot, place, swap...>
- States seen: menu? onboarding? pause? death? restart? win? rounds/waves? persistence?

## Session timeline
numbered play-by-play with timestamps:
  1. (~0–3s) title screen, "SPACE to start" pulsing
  2. (~4s) run starts; player jumps first gap — rises ~2 tiles in ~0.4s
  3. (~11s) collects coin → score 0→100, coin pop effect
  4. (~19s) hits spike → flash + knockback, hearts 3→2
  ...

## Rules evidence            ← every moment where play changed rule state
  - contact with spike ↔ -1 heart + ~1s invulnerability blink (t≈19s, 34s)
  - 3rd hit ↔ death screen + final score + "retry" (t≈52s)
  - coin ↔ +100 score, pickup is removed (t≈11s, 23s, ...)
  - speed visibly higher at t≈45s than t≈5s → escalation over time

## Ambiguities to clip in Phase 2 (or "- (none)"):
```

**Input inference.** The recording rarely shows the keyboard. Infer the input model from motion
onsets, cursor behavior, and on-screen prompts ("SPACE to start", WASD hints, virtual joystick).
Mark confidence per verb. Where genuinely unobservable, adopt the genre-standard binding, mark it
`(assumed)` in the plan, and list it in report.md controls — an assumed binding is fine; a wrong
*model* (keyboard game built as mouse-only) is a core fail.

**Authored vs procedural.** Decide per region of content: level geometry that repeats identically
across deaths/restarts in the video = **authored** → copy it off the frames exactly, like any `[S]`.
Content that differs run-to-run (spawn positions/timing, drops) = **procedural** → the plan line
records the observed *distribution* (rate, ranges, weights) and says "distribution-matched, not
frame-matched"; verification then judges rates and ranges, never exact positions.

**Core action read** (the game's most repeated verb): from a dense clip, measure its cadence —
anticipation, action, impact, recovery — at ~0.1s granularity, plus spatial amplitude in viewport
fractions (jump height ≈ 2 tile-heights; dash ≈ 1/4 screen). **Visibility baseline**: judged on a
1× side-by-side, zoomable to ~3× — a difference indistinguishable at ≤3× is within tolerance, and
frame-perfect timings / sub-pixel physics constants are below the floor: write the *mechanism and
its visible magnitude*, tune to match by eye at 1× against the clip.

### Phase 2 — Clip

One dense clip per Phase-1 ambiguity, per `[D]` candidate, **and per rule transition you plan to
tag `[G]`** (the frames around the consequence are the evidence of what exactly changed). Frame-step
the core action once at high fps to read its cadence. Priorities: rule transitions ≥ core action >
other animations > idle effects.

### Phase 3 — Plan (`out/plan.md` before any code)

```
# Plan — <game>
## Layout strategy
[S1] Full-viewport canvas, HUD top-left hearts + top-right score ... {core}
## Design tokens
[S2] Palette roles: world #1a1c2c, player #f4f4f4, danger #e43b44, pickup #f7d354 ... {core}
## Game design                ← load-bearing
Player contract: <one line — genre, time structure, space, camera, input>
Core action state machine: idle → anticipation(0.1s crouch) → rise(0.4s, ~2 tiles) → fall → land(recovery ~0.1s) → ready; buffered input during fall (observed t≈27s: pre-press jump executes on landing)
Entities: player(hp3), spike(static hazard), coin(+100), slime(patrols 2-tile span)...
Game states: menu → playing → dead → (retry) → playing;  win: none observed
Authored: level layout of first ~60 tiles (read off t≈4–50s). Procedural: none observed.
## Interactions & animations
[D1] Coin pickup: pop-scale + rise-fade ~0.3s (clip 11.0–11.6s) {detail} {render}
[D2] Hit feedback: white flash + knockback ~0.2s + 1s blink (clip 19.0–20.4s) {core} {render}
## Game rules
[G1] Jump: rises ~2 tiles in ~0.4s, buffered during fall (t≈4s, 27s) {core}
[G2] Spike contact: -1 heart, ~1s invulnerability, knockback (t≈19s, 34s) {core}
[G3] Coin: +100 score, removed on pickup (t≈11s, 23s) {core}
[G4] Death at 0 hearts → death screen with final score → retry restarts run (t≈52–55s) {core}
[G5] Scroll speed escalates over run (~1.5× by t≈45s vs start) (t≈5s vs 45s) {detail}
```

Tag rules:
- `[S]`/`[D]`: **can one frozen frame at a holdable state prove it?** Yes → `[S]`; the truth lives
  in how two things change together (time/scroll/pointer/input) → `[D]`. The bracketed id opens the
  plan line literally; verify lines use the `result` field with value `pass`/`fail`/`defer`; the
  playfield is always `{render}` (never ship source-recording pixels).
- **`[G]` test: where does the truth live?** If the concern is about *rules* — what input causes,
  what contact costs, when the run ends, what score/resources do — it is `[G]`, and the truth must
  live **in the simulation**, reachable through real input. One moment is often both `[D]` (the
  effect) and `[G]` (the rule); tag both, they verify differently.
- Every entity and transition named in Rules evidence maps to ≥1 `[G#]` line. Silent omission =
  failure. `[S]/[D]/[G]` are three independent gapless sequences; every line cites timestamps.
- A rule below the visibility floor (exact RNG, frame-perfect windows) gets a mechanism line with a
  confidence marker, never an invented constant.

### Phase 4 — Build, deploy, verify by playing

**4.1 Seed todos** — one write, all pending: build todos (scaffold / sim core / input / entities /
render+art / HUD / states / build+deploy) → one `verify-S#/D#/G#` todo per plan tag → coverage +
completeness sweeps → `summary-final`.

**4.2 Build order — sim before skin:** sim core (fixed timestep + seeded RNG + `GameJudge`) →
input intents → entities & rules (`[G]` lines) → render + art → HUD → menu/death/restart states.
Art: crop real sprites/tiles out of source frames at full resolution (§Video tooling — grouped
small-assets rule: for a SET of small artworks, find the frame where the set is fully crisp, compute
the grid once, crop every cell from it; never redraw frame-visible artwork as generic shapes), or
author code-native art at matched silhouette and palette when frames can't yield a clean asset. **The playfield is
always `{render}`** — shipping source-recording pixels as the scene or as sprite animation is the
same Tier-0 void as in the 3D rules (skills/video2code/references/3d-notes.md). Then `npm run build` → `deploy_website(local_dir="app/dist", type="static")` → open the URL in the built-in browser and confirm the game **boots
and reacts to one input** before any per-id verification.

**4.3 Verify sweep — one id at a time, fixes deferred and batched:**
- `verify-S*`: same-scale SRC|REP composite (§Video tooling `composite.py`; source frame vs
  screenshot of the same state), judged block-by-block. `verify-D*`: motion evidence recorded
  while YOU drive the input — an attract-mode recording proves nothing about a `[D]` that the
  source triggers by play; close it with a matched-beat SRC|REP strip (source clip frame vs your
  recording frame at the same beat, composited).
- `verify-G*`: evidence must be **played, two-pronged**:
  1. **Journey prong**: a built-in-browser recording (`tab.recording.start({actions})` with the
     real input events — keypress/click/drag — inside `actions`; on the managed runtime,
     `browser_capture` with a script) replays the
     recorded play — dispatch the real input events (keydown/click/drag), record, and show the
     consequence the video showed. Where feel is the claim (`[G1]` cadence), compare the replica
     recording against the source clip at matched beats.
  2. **State prong**: `GameJudge.snapshot()` before/after the action asserts the rule numerically —
     `{"score":0}→{"score":100}`, `{"hp":3}→{"hp":2,"invuln":true}`, `{"phase":"playing"}→{"phase":"dead"}`.
     Paste both snapshots into `measured`.
  - **What can never pass a `[G]`**: an autoplay/demo mode with no input; scripted keyframes that
    bypass the sim; a rule present in code but never exercised; console.log output instead of
    snapshots; asserting against your own constants instead of observed behavior. If disabling the
    input listeners would not change your evidence, it is not evidence of play.
- One JSON line appended per judged check at the moment of judgment; `fail` → `pass` only with
  fresh played evidence from this fix round; fix budgets follow the weight tag ({core} ≤4 with
  shrinking delta, {detail} ≤2), then `defer` with reason.

**4.4 Coverage pass (mandatory — the video is the ground truth, not your plan):**
Re-Read ~12 evenly spaced base-strip frames asking: *"what entity, HUD element, effect, or rule
consequence is visible here that no plan tag covers?"* A power-up that appears once, a combo
counter, a pause overlay all count. Append new `[S/D/G]` lines for findings (appending now is
expected) and verify or defer each. Then append
`{"id":"COV1","result":"pass","measured":{"frames_reviewed":N,"new_tags":[...]}}`.

**4.5 Game-state completeness sweep (mandatory, played):**
One continuous session against the deploy: boot → start → first meaningful action → take damage /
fail once → death (or the failure state the video shows) → restart → confirm the run actually reset
(score/hp/level back to initial snapshot) → reach the furthest milestone the video reaches (wave 2,
boss, win screen). Every state the video shows must be **reachable by playing** and exit correctly.
Also confirm: no console errors, input works after restart, the sim survives the verify browser's
low fps without rule changes. Append
`{"id":"GS1","result":...,"measured":{"states_reached":[...],"restart_resets":true}}`. The failure
this catches: a death screen that was styled but unreachable, or a restart that keeps last run's score.

**4.6 Close-out** — every id final (including COV1 and GS1) → run the audit
(`python3 <plugin_root>/skills/video2code/scripts/contract_audit.py`; fix every gap it lists for
`[S]`/`[D]`) → `out/report.md` (shipped summary, controls table incl. `(assumed)` bindings, rule
summary, known gaps, deferred list) → stop.

## Anti-patterns (graded-run rejections)

Base video2code ones all apply (coding before plan; lorem ipsum; end-state screenshot for a `[D]`;
claiming unperformed verification; redrawn artwork; frozen recorded-width layout). Game-specific:

- **The demo-reel cop-out**: a canned animation that looks like gameplay but ignores input and runs
  no rules. The defining failure of this skill — every `[S]`/`[D]` can pass while the task fails.
- **Invented content**: enemies, upgrades, menus, difficulty settings, sounds the video never
  shows. Replicate the evidence; don't pad the scope. (Corollary: don't "improve" the balance.)
- Wrong input *model* (mouse game built keyboard-only; tap game requiring hover) — assumed
  *bindings* are fine when marked, a wrong model is a core fail.
- Sim state advanced by frame count, or rules that change under the verify browser's low fps;
  physics exploding because dt was never clamped.
- Shipping source-recording pixels as playfield, background, or sprite frames — Tier-0 void.
- HUD numbers not bound to sim state (a score that animates but never reflects `snapshot().score`).
- `[G]` "verified" from code reading or console.log — no journey prong, no snapshot prong.
- Death/win/restart styled but unreachable by play (GS1 exists to catch this); restart leaking
  previous-run state.
- Missing `GameJudge.snapshot()` or a snapshot that mutates play; randomness that ignores `?seed=`.
- Treating the title screen's attract mode or a cutscene as the gameplay to replicate, while the
  recorded *play* goes untagged.
- One giant single-file write (the 3D skill's chunked-write limits apply to game code too).
