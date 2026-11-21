# ZCode HappyHorse Video Plugin

[中文](./README_CN.md)

This plugin lets the Agent generate a short video with HappyHorse through the official ZCode ToolHub service: from a text description, from a first-frame image, or from 1–9 reference images. The result is saved into the workspace.

## Components

- MCP server `happyhorse_video` (stdio, Node.js), runtime name `plugin:happyhorse-video:happyhorse_video`, with two tools:
  - `generate_happyhorse_video` submits a task and waits for it;
  - `get_happyhorse_video_result` keeps waiting for a task that is already submitted, without submitting again.
- Skill `generate-happyhorse-video`, which tells the Agent when and how to call the tools.

## Requirements

- A signed-in ZCode session with a connected Coding Plan subscription (individual or team). Usage is charged to that plan.
- A Z.ai account with a phone number (an email address for overseas accounts).
- No token or API key to configure: ZCode passes the signed-in identity to the server on every call.
- Start a new ZCode session after installing or updating the plugin.

## Usage

Ask in plain language, for example "make a 5-second video of a cat running on grass", or "animate `assets/cover.png`". The Agent calls `generate_happyhorse_video`.

| Parameter | Required | Description |
| --- | --- | --- |
| `prompt` | Yes | What the video shows, up to 10,000 characters. With reference images, refer to them as `[Image 1]`, `[Image 2]`, … |
| `duration` | No | Length in seconds, an integer from 3 to 15. Defaults to 5. |
| `resolution` | No | `480P`, `720P`, or `1080P`, case-insensitive. Defaults to `720P`. |
| `ratio` | No | `16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `4:5`, `5:4`, `9:21`, or `21:9`. Defaults to `16:9`. Ignored with `first_frame`. |
| `first_frame` | No | First frame (image-to-video): a workspace image (png, jpeg, webp, up to 10 MiB, uploaded first) or a public `https://` URL. |
| `reference_images` | No | 1–9 reference images for people, objects, or style, same formats. Cannot be combined with `first_frame`. |
| `output_path` | No | Where to save the video inside the workspace; an existing file is not overwritten. Defaults to `generated-videos/`. |
| `request_id` | No | Only when a previous call reported an unconfirmed submission: pass the returned value to replay that same submission. |

## Notes

- Generation usually takes 1–5 minutes. One tool call waits up to about four minutes; if the video is not ready it returns a `task_id`, and `get_happyhorse_video_result` continues waiting.
- Billing is per generated second and depends on resolution (for example about 4.8 CNY for 720P, 5 seconds, including the watermark fee in mainland China). Failed tasks are not charged. Retries of the same submission reuse one `Idempotency-Key`, so network errors and timeouts never submit twice.
- While a submission is unconfirmed, its request body (prompt, parameters, image URLs; no identity) is kept in the plugin data directory, readable only by the current user, so a `request_id` replay sends exactly the same request. It is deleted once the submission is confirmed, or after 24 hours.
- The model and watermark are fixed by the service.
- API requests go only to the ZCode API origin that the host provides in `ZCODE_BASE_URL`; redirects are refused. Results are downloaded from the temporary link returned by the service, which may be on another domain.
- Local input files and `output_path` must stay inside the workspace, and existing files are never overwritten.
