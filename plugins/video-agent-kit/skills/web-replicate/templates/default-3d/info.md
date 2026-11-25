Using Node.js 20, Tailwind CSS v4, Vite v7 — plus three.js r0.185 for WebGL/3D.

This is the **default-3d** template: the standard React+TS+Vite+Tailwind+shadcn app
(same as `default`) AUGMENTED with a three.js 3D skeleton. Use it for WebGL pages
(3D perspective, particle fields, volumetric light/glow, camera flythroughs, shaders).
For flat 2D pages use the `default` template instead.

Preinstalled for 3D (do NOT reinstall): three@0.185, simplex-noise, @types/three.
NOT installed (by design): gsap, react-three-fiber — use raw three.js in the scene.

════════════════════════════════════════════════════════════════════════════════
 THREE LAYERS — know which you may touch
════════════════════════════════════════════════════════════════════════════════

  src/three/Stage.tsx          Mount component: canvas + renderer lifecycle, rAF loop,
                               resize, pixelRatio, StrictMode guard. DO NOT rewrite.

  src/three/engine/core/       FROZEN, reused by every 3D page — DO NOT rewrite:
    renderer.ts                  WebGLRenderer factory (pixelRatio<=1, sRGB, no tone mapping)
    loop.ts                      rAF ticker, wall-clock (getElapsedTime) + clamped dt
    signals.ts                   scroll->t (0..1) + pointer->(-1..1), rAF-polled
    rng.ts                       mulberry32 seeded RNG (reproducible)
    forensic.ts                  URL hooks: ?t=<0..1> scroll freeze / ?time=<sec> time freeze /
                                 ?freeze / ?autodemo
    ?hud=1                       (Stage) prints the page's clock (time / t / frame) bottom-right: the
                                 values Stage passed to update / render; use it for live capture
    window.__v2c                 { time, t, frame, frozenTime, frozenT } of the last rendered frame, for scripts

  src/three/engine/kit/        OPT-IN per archetype — use what you need, ignore the rest:
    fullscreenQuad.ts            clip-space quad + RawShaderMaterial (plain GLSL, no three
                                 prelude, no camera) — full-screen raymarch / SDF scenes (the
                                 whole frame: soft fused blob subjects and worlds), shader
                                 backgrounds, procedural fields. GLSL in scene/shaders/*.glsl, `?raw`.
    cameraRig.ts                 spline flythrough (CatmullRomCurve3) + orbit controls
    beats.ts                     BEAT-table math primitives: clamp01/smoothstep/remap,
                                 lerpFields (number+THREE.Color), createSplinePair.
                                 The BEAT table itself (stations/keyframes) is YOUR scene code.
    hudBridge.ts                 createHudStore<T>() — scene→React pub/sub for HUD values;
                                 you define the state fields (generic T)
    composer.ts                  EffectComposer + UnrealBloom + OutputPass (bloom starter)
    model.ts                     GLTFLoader (+DRACO) + neutral environment (product/model)
    text.ts                      FontLoader + TextGeometry (3D text)

  src/three/scene/Scene.ts     ★ YOUR WORK. SceneModule interface + a PLACEHOLDER scene
                               marked "REPLACE ME". Delete the placeholder and write the
                               scene that matches the video (particles/shader/geometry/
                               materials/BEAT). This is where the real 3D coding lives.
  src/three/scene/shaders/     GLSL for the fullscreen quad (import with `?raw`).
                               example.frag.glsl is a REPLACE-ME sample showing the header
                               a RawShaderMaterial needs (precision + your uniform decls).
  src/three/scene/contract.ts  Type re-export: `import type { SceneModule, SceneContext }
                               from './contract'` in your scene modules.

  src/three/hud/Hud.tsx        2D overlay (Tailwind, pointer-events:none) — nav/text/labels.
  src/pages/Home.tsx           Assembles <Stage/> + <Hud/> + scroll spacer (delete the
                               spacer if the source page does not scroll).

The SceneModule contract Stage depends on:
  init(ctx) / update(t, dt, time) / render?() / resize?(w,h) / dispose()
    t    = scroll progress 0..1 — stays 0 on a page that never scrolls (?t= overrides)
    dt   = clamped frame seconds (0 under ?freeze)
    time = elapsed seconds — the axis for autoplay/shader pages (?time=<sec> overrides).
           Compute from `time`, don't accumulate `+= dt`, or ?time= can't freeze a frame.
  ctx = { renderer, scene, camera, clock, sizes, rng, signals, forensic }
Stage does NOT assume you use a camera path or composer — a raymarch page can use only
core + kit/fullscreenQuad and drop every other kit module.

Standard app structure (unchanged from default):
  src/components/ui/   50+ shadcn/ui components     src/lib/   shared utils
  src/hooks/           custom hooks                 src/index.css  Tailwind theme
  import { Button } from '@/components/ui/button'
