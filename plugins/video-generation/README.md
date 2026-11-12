# ZCode Video Generation Plugin

[中文](./README_CN.md)

This plugin lets the Agent generate a short video from a text description, from reference images, videos, or audio, or from a first (and last) frame, through the official ZCode video generation service. The result is saved into the workspace.

## Components

- MCP server `video_generation` (stdio, Node.js), runtime name `plugin:video-generation:video_generation`, with two tools:
  - `generate_video` submits a task and waits for it;
  - `get_video_result` keeps waiting for a task that is already submitted, without submitting again.
- Skill `generate-video`, which tells the Agent when and how to call the tools.

## Requirements

- A signed-in ZCode session with a connected Coding Plan (individual or team). Connections that use only an API key or a Start Plan cannot use this plugin.
- A Z.ai account with a phone number (an email address for overseas accounts).
- No token or API key to configure: ZCode passes the signed-in identity to the server on every call.
- Start a new ZCode session after installing or updating the plugin.

## Usage

Ask in plain language, for example "make a video of a cartoon bird flying across a blue sky, fixed camera", or "animate `assets/cover.png`". The Agent calls `generate_video`.

| Parameter | Required | Description |
| --- | --- | --- |
| `prompt` | Yes | What the video shows. |
| `images` | No | Up to 9 reference images: workspace paths, `https://` / `asset://` URLs, or `data:image/...;base64` URLs. Local files (png, jpeg, webp, up to 10 MiB) are uploaded to ZCode first. |
| `videos` | No | Up to 3 reference videos, `https://` or `asset://` URLs only. |
| `audios` | No | Up to 3 reference audio clips (wav / mp3): URLs, `data:audio/...;base64`, or workspace paths up to 2 MiB. |
| `first_frame` / `last_frame` | No | First frame, and optionally last frame. Cannot be combined with reference media. |
| `output_path` | No | Where to save the video. Defaults to `generated-videos/` in the workspace. |
| `request_id` | No | Only when a previous call reported an unconfirmed submission: pass the returned value to replay that same submission. |

## Notes

- Generation usually takes several minutes. One tool call waits up to about four minutes; if the video is not ready it returns a `task_id`, and `get_video_result` continues waiting.
- Every `generate_video` call consumes quota. Retries of the same submission reuse one `Idempotency-Key`, so network errors and timeouts never submit twice.
- While a submission is unconfirmed, its request body (prompt, material URLs, inlined local audio; no identity) is kept in the plugin data directory, readable only by the current user, so a `request_id` replay sends exactly the same request. It is deleted once the submission is confirmed, or after 24 hours.
- Duration, aspect ratio, model, and watermark are fixed by the service.
- API requests go only to the ZCode API origin that the host provides in `ZCODE_BASE_URL`, and redirects are refused. The finished file is downloaded from the temporary URL the service returns, which can be on another host.
- Local input files and `output_path` must be inside the workspace. An existing file is never overwritten.
