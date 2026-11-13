# ZCode Image Generation Plugin

[中文](./README_CN.md)

This plugin lets the Agent generate an image from a text description, or edit one reference image, through the official ZCode image generation service. The result is saved into the workspace.

## Components

- MCP server `image_generation` (stdio, Node.js), runtime name `plugin:image-generation:image_generation`, with one tool, `generate_image`.
- Skill `generate-image`, which tells the Agent when and how to call the tool.

## Requirements

- A signed-in ZCode session with a connected Coding Plan (individual or team). Connections that use only an API key or a Start Plan cannot use this plugin.
- A Z.ai account with a phone number (an email address for overseas accounts).
- No token or API key to configure: ZCode passes the signed-in identity to the server on every call.
- Start a new ZCode session after installing or updating the plugin.

## Usage

Ask in plain language, for example "draw a cyberpunk orange cat wearing sunglasses", or "turn `assets/cover.png` into a watercolour". The Agent calls `generate_image`.

| Parameter | Required | Description |
| --- | --- | --- |
| `prompt` | Yes | What to draw. |
| `reference_image` | No | One reference image: a workspace path, an `https://` URL, or a `data:image/...;base64` URL. png, jpeg, or webp, up to 10 MiB. Local files are uploaded to ZCode first. |
| `output_path` | No | Where to save the image. Defaults to `generated-images/` in the workspace. |

The tool returns the saved path and a temporary image URL that expires.

## Notes

- One call produces one image and usually takes a few seconds to tens of seconds.
- Model, size, and watermark are fixed by the service.
- API requests go only to the ZCode API origin that the host provides in `ZCODE_BASE_URL`, and redirects are refused. The finished file is downloaded from the temporary URL the service returns, which can be on another host.
- Local input files and `output_path` must be inside the workspace. An existing file is never overwritten.
