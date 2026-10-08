# video2code

[中文说明](./README_CN.md)

`video2code` replicates a webpage from a screen recording. Give it an `.mp4`/`.webm` of a site — or just the site's URL — and it observes the recording frame by frame, writes an explicit replication contract, scaffolds a React + TypeScript + Tailwind project, builds it, deploys it locally, records the result, and compares the two recordings before declaring the job done.

Recording is done by ZCode's built-in Browser Use WebView, which produces WebM natively; `ffmpeg` transcodes it to MP4. **Playwright and a separate Chromium are intentionally not used and not installed.**

## Quick start

1. Install the plugin from the ZCode plugin manager.
2. Check the machine before the first run:

   ```text
   /video2code:env-check
   ```

   `/video2code:env-check --fix` additionally installs the items the doctor can safely provision (pip packages, `node_modules` warm-up). It never installs system software such as `ffmpeg` or Node.js — those are printed as instructions for you to run.
3. Replicate from a local recording:

   ```text
   /video2code:replicate recordings/landing.mp4
   ```

   Or straight from a URL — the plugin records the site first, then replicates it:

   ```text
   /video2code:replicate https://example.com
   ```
4. Review the three deliverables under `out/`: `plan.md` (the replication contract), `verify.jsonl` (per-item verification evidence), and `report.md` (the final report). The built app lands in `app/`, and recordings in `recordings/`.

## Commands

| Command | What it does |
| --- | --- |
| `/video2code:env-check [--fix]` | Environment doctor: Python video packages, `ffmpeg`/`ffprobe`, Node/npm, npm registry reachability, webapp template cache. |
| `/video2code:record <url> [name]` | Record a live site's motion with the built-in WebView to WebM, then transcode to `recordings/<name>.mp4`. |
| `/video2code:replicate <video-or-url> [catalog.json]` | Front-end replication: observe → slice → plan → build → verify against a recording of your own build. |
| `/video2code:replicate-fullstack <video-or-url> [catalog.json]` | Full-stack replication: the same flow plus an Express/SQLite backend, verified by both recording and `curl`. |

## Skills

| Skill | Role |
| --- | --- |
| `env-setup` | The single entry point for environment checks and provisioning. |
| `url2video` | URL → WebM (built-in WebView) → MP4 (`ffmpeg`), with a survey/scripting/review loop. |
| `video2code` | The base replication workflow: layout, visual style, interactions, animations. |
| `video2code-3d` | Additive extension for WebGL/three.js pages: effect recipes, software-render budget, 3D verification rules. |
| `video2fullstack` | Replicate a recorded site as a working front-end **and** back-end project. |
| `web-replicate` | Scaffolds the React + TypeScript + Vite + Tailwind v4 + shadcn/ui project. |

`video2code` and `web-replicate` are designed to be loaded together. `video2code-3d` loads as a third skill only when the reference page turns out to be a real WebGL scene.

## MCP servers and tools

Two stdio MCP servers, declared in both [`.mcp.json`](./.mcp.json) and the plugin manifest. They are split so that CPU-heavy frame extraction cannot block the deploy tool's single-threaded queue.

**`video`** (300 s tool timeout) — reads video, returns images inline for the model to look at:

- `ingest_video` — whole-video ingest: deterministic frame extraction into timestamped contact sheets.
- `clip_video` — higher-density re-look at a specific time window.
- `still_crops` — crop regions out of a still frame.
- `composite_view` — side-by-side comparison collage of source vs. replica.

**`runtime`** (600 s tool timeout) — serves and feeds the build:

- `deploy_website` — serve a built `dist/` over a local `http.server`. Re-deploys reuse the same port and URL so the browser does not have to re-navigate, and the tool refuses to publish a build that references `/assets/...` images which do not exist.

Deployment source and serving directories must be separate: if either contains the other, deployment returns an error before replacing files. Re-deploying the serving directory itself preserves its contents.
- `get_asset` — fetch an asset from a supplied catalog. **Registered only when an asset catalog is present** (`assets_catalog.json` in the project, `V2C_CATALOG_PATH`, or `V2C_HAS_CATALOG=1`); otherwise the tool is not exposed at all.

## Hooks

All four are `command` hooks running `python3` against scripts in [`hooks/`](./hooks).

| Event | Script | Behavior |
| --- | --- | --- |
| `SessionStart` (`startup\|clear\|compact`) | `env_check.py` | Reports the plugin root and any missing dependencies into session context, and warms the webapp template in the background. **Never blocks.** |
| `UserPromptSubmit` | `check_video_input.py` | If the prompt mentions a local video path, injects ingest guidance. Detection and cheap probes only — no frame extraction. Advisory. |
| `UserPromptSubmit` | `check_url_input.py` | If the prompt has a site URL *and* a task word (replicate/record/复刻/录制/…), injects `url2video` guidance. Advisory; suppressed when a local video path is also present. |
| `PreToolUse` (`Write\|Edit`) | `check_plan_first.py` | **Blocks** writes under `app/src/` while `out/plan.md` does not exist, so component code cannot be written before the contract. Everything else passes. The same rule self-releases after three consecutive blocks. |
| `Stop` | `check_closeout.py` | **Blocks** turn-end when the replication contract is not closed out, reusing `skills/video2code/scripts/contract_audit.py` so there is one copy of the rules. Skipped entirely when `out/plan.md` is absent or `V2C_NO_CLOSEOUT_HOOK=1`. |

## Requirements

- Python 3.10 or newer, with the packages in [`requirements.txt`](./requirements.txt): `mcp==1.9.0` (2.x removed the `Server` decorator API this plugin uses), `opencv-python-headless`, `numpy`, `pillow`.
- `ffmpeg` and `ffprobe` on `PATH` — required for ingest, frame extraction, duration probing, and the WebM → MP4 transcode. Any 4.x or newer build works.
- Node.js 20 or newer (Vite 7 needs 20.19+/22.12+) plus npm, for building the webapp template.
- A reachable npm registry.
- Browser interaction and recording need no extra install: they run on ZCode's built-in Browser Use WebView.

Run the doctor rather than checking by hand:

```bash
python3 skills/env-setup/scripts/env_doctor.py
python3 skills/env-setup/scripts/env_doctor.py --fix
```

## Side effects, network access, and data

Enabling this plugin grants code-execution trust. Concretely, it will:

- **Execute commands** — `ffmpeg`/`ffprobe` for transcoding and frame extraction, and `skills/web-replicate/scripts/init-webapp.sh`, which runs `npm install` to populate `node_modules`.
- **Write files** — `recordings/` (WebM and MP4), `app/` (the scaffolded project), `out/` (`plan.md`, `verify.jsonl`, `report.md`, comparison images under `out/cmp/`), `.v2c/` (plugin root pointer and hook state, including `.v2c/hook_state/interceptions.jsonl`), and a `node_modules` cache under `/tmp/webapp-node-modules` (override with `NM_LOCAL_ROOT`).
- **Bind a local port** — `deploy_website` starts a `http.server` on port 8765 or the next free port, bound locally, and stops it when the MCP server process exits.
- **Access the network** — the npm registry when installing template dependencies, and whatever site you ask it to record.
- **Send no telemetry** and require no API key, token, or account. There are no credentials in this plugin and nothing is uploaded anywhere.

## User configuration

| Setting | Default | Effect |
| --- | --- | --- |
| `media_resolution` | `medium` | Per-frame resolution tier for frames inlined by `clip_video`: `low` (~70 tokens/frame), `medium` (~256), `high` (~786). |
| `clip_max_frames` | `400` | Cap on frames extracted across all segments of one `clip_video` call; over the cap, frame rate is reduced proportionally. |

Both are passed to the MCP servers as `V2C_MEDIA_RESOLUTION` and `V2C_CLIP_MAX_FRAMES`.

## Third-party content

`skills/web-replicate/templates/default/` and `templates/default-3d/` are project templates vendored into this plugin. Their `package.json` declares React 19, Vite 7, TypeScript, Tailwind CSS v4, Radix UI / shadcn/ui components, framer-motion, lucide-react, recharts, zod and — in `default-3d` — three.js. All are MIT-licensed and installed from the npm registry at scaffold time; only the template source files ship inside the plugin package.

## License

MIT. See [`LICENSE`](./LICENSE).
