---
name: video2code
description: Replicate a webpage from its screen recording as a runnable project, including its visible content, interactions and motion.
---

Recreate the recording as a runnable project, using code for the visible interface and motion. Use the supplied video path or material manifest; do not assume a fixed filename.

Inspect the recording, implement the scenes and verify the delivered version. Prioritize the differences that most affect the whole result. Use still frames for layout and color; compare actual playback for motion, timing and brief scenes. For detailed multi-scene work, check a representative frame per scene before refining individual details.

Use the available video tools or sample frames with ffmpeg/Python. See [video observation](references/video-observation.md) and [browser checks](references/browser-checks.md) for examples; [web-replicate](../web-replicate/SKILL.md) describes optional templates.

Publish each build with `deploy_website(local_dir="app/dist", type="static")` (stable local URL, same URL on redeploy) and check it in **ZCode's built-in browser** through the `control-browser` skill — snapshots and screenshots for layout and end states, `tab.recording` (WebM → ffmpeg MP4) for motion; see [browser checks](references/browser-checks.md). Never start Playwright or an external Chromium. `preview_build` and `browser_capture` exist only when the task-managed harness runtime is present; if a managed verification is unavailable, use the built-in browser or local checks and report what stayed unverified; do not claim it succeeded. Do not read or disclose runtime authentication information. The replication workflow enables its hooks before the session; otherwise, enable them with `mkdir -p .v2c && touch .v2c/replicate.enabled` in the project directory. The plugin directory for templates and scripts is recorded in `.v2c/plugin_root`.

When an appropriate verifier is available, an independent review may compare a specified build and video interval. Give `v2c-verifier` a focused work order including the build, source path and scope. Do not combine a custom verifier role with inherited full-thread context.

Deliver the project, run instructions, observed differences and unverified areas. A capture or access failure is not evidence of a visual defect.
