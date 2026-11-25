# Product 3D Showcase

Turn a glTF/GLB product model into a consistent set of marketing assets: multi-angle product images, a 360° turntable video and a web 3D viewer.

## Features

- **Studio scene**: three.js with a neutral room environment, key/fill/rim lights (presets: studio, soft, dramatic), ACES tone mapping and exposure control.
  - The model is centred, placed on the floor and auto-framed so it fills the shot the same way for every angle.
  - An optional soft ground shadow is rendered on an invisible floor, so it also works on transparent backgrounds.
- **Angles**: presets (front, three-quarter left/right, side, back, top) or your own. Drag the live preview to a view and press **+ Add this view**. Each angle has a name, yaw, pitch and zoom.
- **Product images**: one PNG per angle, square, 256–4096 px, on white, transparent or any colour.
- **360° turntable video**:
  - Rendered frame by frame and encoded with WebCodecs (VP9/VP8) into WebM, so it is smooth and frame-exact even on slow machines. Length and size are configurable; 30 fps.
  - With ffmpeg installed, an H.264 MP4 (yuv420p, faststart) is also written for shops and social media.
- **Web 3D viewer**: `viewer/index.html` + `viewer.js` + `model.js`. It opens from disk (file://) with no server and no network, with drag-to-rotate, zoom, auto-rotate and the same lighting. You can put it on any static host.
- **Models**: `.glb`, or `.gltf` with external `.bin` and textures, which are inlined automatically.

## Usage

Ask the agent in ZCode Desktop:

- "Make white-background product shots of bottle.glb: front, 45° left and right, side and back"
- "Add a 6-second 360° video and a web 3D viewer, with transparent PNGs"
- "Use softer lighting and add a low hero angle"

## Tools

| Tool | Purpose |
|---|---|
| `showcase_open` | Open a model with optional settings; shows what is inside (meshes, materials, textures, size) |
| `showcase_save` | Save angles, lighting, background, shadow, exposure, sizes, video and viewer options |
| `showcase_export` | Render and save all outputs in the open panel |

Output goes to `showcase/<model>/`: `<angle>.png`, `turntable.webm` (+ `.mp4`), `viewer/` and `showcase.json` (the settings, reused next time).

## Scope (v0.1)

- glTF 2.0 only. Convert OBJ/FBX/USDZ first, for example with Blender (File → Export → glTF 2.0).
- Draco/meshopt-compressed and KTX2-textured models are not supported yet.
- Rendering needs WebGL in the panel. The video background is never transparent; with a transparent background, the video uses white.
- No AI image generation or background scenes.

## Privacy, network and files

- **Everything runs locally.** No network, no uploads, no API keys or accounts.
- Reads only the model you choose and the files it refers to. Writes only to the output folder in the workspace.
- ffmpeg (optional) is called with argument arrays, without a shell. No hooks.

## Build and test (developers)

- Source: `ui-plugins/product-3d-showcase/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-product-3d-showcase test` and `test:e2e`.
- `E2E_MODELS` points to a folder with `WaterBottle.glb` and `avocado/` from the Khronos glTF-Sample-Assets (CC0).

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: three.js (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`. ffmpeg is not bundled.
