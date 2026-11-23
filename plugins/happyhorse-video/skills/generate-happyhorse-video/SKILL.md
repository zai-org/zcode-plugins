---
name: generate-happyhorse-video
description: Use when the user asks for a HappyHorse video, or wants a short video generated from a description, from a first-frame image, or from reference images of people, objects, or styles. Calls the generate_happyhorse_video and get_happyhorse_video_result tools of the happyhorse-video plugin and saves the result into the workspace.
---

# Generate a HappyHorse video

Use the `generate_happyhorse_video` and `get_happyhorse_video_result` tools from the `happyhorse_video` MCP server.

1. Turn the request into one concrete prompt: subject, action, scene, camera movement, and style. Write it in the user's language.
2. Pick one mode:
   - text only: pass just `prompt`;
   - first frame (the video starts from this image): pass `first_frame`;
   - reference images (people, objects, or style to reuse, not the first frame): pass `reference_images` (1–9) and refer to them in the prompt as `[Image 1]`, `[Image 2]`, … in the same order.
   `first_frame` and `reference_images` cannot be combined. Images must be workspace files (png, jpeg, webp, up to 10 MiB; uploaded automatically) or public `https://` URLs.
3. Pass `duration` (3–15 seconds, default 5), `resolution` (`480P`, `720P`, `1080P`, default `720P`), and `ratio` (`16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `4:5`, `5:4`, `9:21`, `21:9`, default `16:9`) only when the user asks for them. `ratio` has no effect with `first_frame`.
4. Pass `output_path` only when the user names a location inside the workspace; an existing file is not overwritten. Otherwise the video is saved under `generated-videos/` in the workspace.
5. Generation takes 1–5 minutes. When `generate_happyhorse_video` returns a `task_id` because the video is still running, tell the user it is in progress and call `get_happyhorse_video_result` with that `task_id` (and the same `output_path`) to keep waiting.

Every `generate_happyhorse_video` call submits a new task and is billed by seconds and resolution (720P for 5 seconds is about 4.8 CNY; failed tasks are free). Do not generate variations or longer, higher-resolution videos unless the user asks. Never call it again to "retry" a task that is still running — use `get_happyhorse_video_result`. If it reports that the submission was not confirmed and gives a `request_id`, call `generate_happyhorse_video` again later with exactly the same arguments plus that `request_id`.

Reply with the saved file path as a link, and mention that the returned URL is temporary.

If a tool fails, report the error and stop. Do not substitute a hand-drawn SVG, HTML, or any other self-made video or animation. In particular:

- a Coding Plan message means the current ZCode connection has no Coding Plan subscription;
- a Z.ai account message means the account must be linked to Z.ai with a phone number (email for overseas accounts);
- a content-review failure needs a different prompt or image; retrying unchanged is pointless.
