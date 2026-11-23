---
name: code2video
description: Build a runnable 2D or 3D animation from a text brief and optional reference images and render it to a video. 2D is a static-portrait animation with bitmap art generated via the image_generate tool; 3D is a short film whose complex models come from the model3d_generate tool (multi-view generation + rigging) and are animated and rendered in Blender. Read the matching reference first.
---

Implement a runnable animation in code from the text brief, and render it to a video. Materials, if any, are the files the user names (by default under `input/` in the project directory).

First decide whether this task is 2D or 3D, then read only the matching reference and follow its workflow:

| Task | Required reading |
|---|---|
| The task statement explicitly contains the phrase "任务为生成3D动画" ("the task is to generate a 3D animation") | [references/3d.md](references/3d.md) |
| Everything else | [references/story-2d-static.md](references/story-2d-static.md) |

The genre of the script (action, fantasy, realistic and so on) is not a reason to switch to 3D. When the task statement does not explicitly say 3D, always deliver a 2D still-frame animation: do not switch to 3D on your own, and do not call `model3d_generate`.

Both kinds have the same deliverable: the final film must be rendered and written to `out/final.mp4`.

The runtime is a resource-limited container. Before starting work, run `quota` to find the real CPU quota and memory limit (`nproc` and `free` also report the quota; Python's `os.cpu_count()` and `/proc/meminfo` show the host's values and must not be used for planning). Size the number of parallel rendering, frame-capture and encoding processes by the CPU quota; exceeding the memory limit gets the whole container killed and the task fails.
