# 3D pages/games — hard rules for WebGL replication

Test (any one signal means 3D): true perspective depth / occlusion that changes with the viewing angle · particle fields · volumetric light/fog · a continuous free camera ·
infinite fractal zoom · a full-screen shader background. Card flips / slight tilts that CSS `perspective()` can cover are **not** 3D.

## Hard rules
- **Use raw three.js only** (the default-3d template). No react-three-fiber/drei, and **never hand-roll a canvas-2D pseudo-3D engine** (self-written perspective projection / fake depth sorting is the number-one quality incident).
- **Never ship the source recording's own pixels as the scene** (background video segments / frame sequences / per-frame canvas textures) — the scene layer is always `{render}`, with no exception at any fidelity; a violation voids the task. The only legitimate seam: a `<video>` the source page itself is playing (the VideoTexture content is the footage).
- **There are no 3D model / texture / HDRI assets to load** — generate every subject procedurally: mechanical/geometric subjects exactly, organic/photoreal subjects as a stylized approximation, with the gap written into the report's Known-gaps.

## Template map (default-3d)
- `src/three/Stage.tsx` + `engine/core/*` — **frozen, do not rewrite** (renderer / rAF wall-clock loop / scroll→t / pointer signals / seeded rng / the ?t ?time ?freeze ?autodemo forensic hooks).
- `engine/kit/*` — opt in as needed: cameraRig / beats (BEAT table + splines) / hudBridge / composer / model / text.
- `scene/Scene.ts` — **your work**: implement `SceneModule { init(ctx)/update(t,dt,time)/dispose() }` and delete PlaceholderScene. Put GLSL in `scene/shaders/*.glsl` and import it as a string.
- The HUD is fixed chrome (logo/nav/telemetry); content that moves with scrolling goes in the `pages/` scroll layer, do not fake scrolling inside the fixed HUD.

## Effect recipes at a glance
Particle field / shape morph → the `scene/particles.ts` recipe (the most common); volumetric light / bloom → EffectComposer+UnrealBloom+`FogExp2`, two lines; scroll-driven camera → the camera is a **pure function** of scroll progress t, plus a BEAT table; PBR-heavy product page → start from MeshStandardMaterial+rim light. Before writing, look at the ready-made implementation of the corresponding kit in the template.

## Software-rendering survival budget (read before coding)
The verification browser may be SwiftShader (1.5–20fps). The same code must survive at both ends:
- Advance everything by wall-clock `dt` (the loop already clamps it), and integrate physics in fixed substeps; **never advance by frame count**.
- `pixelRatio ≤ 1` (already set); respond to `ctx.forensic.lite` → turn off AA, halve the particles, skip heavy post-processing.
- Material downgrade table: Physical/iridescence → Standard + phase-based color shift; heavy PBR → baked color + rim light; record downgrades in Known-gaps.
- Low fps must not block correctness: never hang a verdict on fps or on an animation-stability check.

## Hard limits on chunked writes (output truncation killed 34/48 pre-template 3D tasks)
- **At most one file of >200 lines** per turn; the other calls in the same turn do only small edits/reads.
- **Never Write in one go** a file that will exceed ~350 lines: write the skeleton first (imports/types/function shells), then fill in one system per turn with Edit.
- Split the scene into modules by system (`particles.ts` / `shaders/*.glsl` / `beats.ts`), which keeps within the limits naturally.

## 3D verification additions
- Judge the render tier at the first capture (smooth = hardware GL; single-digit fps = software rendering); after that, read every duration from video timestamps, not the wall clock.
- Full-frame anchor comparison still applies: framing (horizon height / subject's share of the frame ±20%) + state onset (±10% of the scroll range).
- When the scene is "too hard to write": make an honest approximation + Known-gaps. **Two wrong excuses**: "the source is a video too, so ship video" and "per-frame textures also count as rendering" — both are substitution, not replication.
