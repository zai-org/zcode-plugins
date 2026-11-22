---
name: generate-video
description: Use when the user asks to generate, make, or animate a video, clip, or motion shot from a description, from reference images/videos/audio, or from a first (and last) frame. Calls the generate_video and get_video_result tools of the video-generation plugin and saves the result into the workspace.
---

# Generate a video

Use the `generate_video` and `get_video_result` tools from the `video_generation` MCP server.

1. Turn the request into one concrete prompt: subject, action, scene, camera movement, and style. Write it in the user's language.
2. Pick one mode:
   - text only: pass just `prompt`;
   - reference media: pass `images` (up to 9), `videos` (up to 3, `https://` or `asset://` only), and/or `audios` (up to 3, wav / mp3);
   - first/last frame: pass `first_frame`, optionally `last_frame`. Frames cannot be combined with reference media.
   Image and audio paths must be inside the workspace. Images are uploaded automatically. Each local audio file must be under 2 MiB, and the whole request under 4 MiB, so use `https://` for anything larger.
3. Pass `duration` (seconds, 4–30, or -1 to let the model decide; default 4) when the user asks for a length, and `ratio` (`16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `21:9`, `adaptive`; default `16:9`) when the user asks for a shape such as portrait or square. With `first_frame`, leave `ratio` out or use `adaptive`.
4. Pass `output_path` only when the user names a location inside the workspace; an existing file is not overwritten. Otherwise the video is saved under `generated-videos/` in the workspace.
5. Generation takes several minutes. When `generate_video` returns a `task_id` because the video is still running, tell the user it is in progress and call `get_video_result` with that `task_id` (and the same `output_path`) to keep waiting.

Every `generate_video` call submits a new task and consumes quota. Never call it again to "retry" a task that is still running — use `get_video_result`. If it reports that the submission was not confirmed and gives a `request_id`, call `generate_video` again later with exactly the same arguments plus that `request_id`.

Reply with the saved file path as a link, and mention that the returned URL is temporary.

When a tool returns an error, tell the user what it says. In particular:

- a Coding Plan message means the current ZCode connection has no Coding Plan;
- a Z.ai account message means the account must be linked to Z.ai with a phone number (email for overseas accounts);
- a content-review or rejected-material failure can be retried once with a reworded prompt or different material.

If the tool fails, report the error and stop. Do not substitute a hand-drawn SVG, HTML, or any other self-made video or animation.
