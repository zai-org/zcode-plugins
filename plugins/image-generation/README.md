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
- Node.js 20 or later on the machine that runs the MCP server (it uses the built-in `fetch`; no npm dependencies).
- Start a new ZCode session after installing or updating the plugin.

## Usage

Ask in plain language, for example "draw a cyberpunk orange cat wearing sunglasses", or "turn `assets/cover.png` into a watercolour". The Agent calls `generate_image`.

| Parameter | Required | Description |
| --- | --- | --- |
| `prompt` | Yes | What to draw. |
| `reference_image` | No | One reference image: a workspace path, an `https://` URL, or a `data:image/...;base64` URL (standard base64 only; URL-safe `-_` and percent-encoded data are refused). png, jpeg, or webp, up to 10 MiB. Local files and `data:` URLs are uploaded to ZCode first and sent as an `https://` link, because the image service accepts only https references. |
| `output_path` | No | Where to save the image. Defaults to `generated-images/` in the workspace. |

The tool returns the saved path and a temporary image URL that expires.

## Notes

- One call produces one image and usually takes a few seconds to tens of seconds.
- Model, size, and watermark are fixed by the service.
- API requests go only to the ZCode API origin that the host provides in `ZCODE_BASE_URL`, and redirects are refused. The finished file is downloaded from the temporary URL the service returns, which can be on another host. Downloads use https only and every redirect hop is checked; if the downloaded content is not a png / jpeg / webp image it is not saved and only the temporary URL is returned.
- Local input files and `output_path` must be inside the workspace. An existing file is never overwritten: if the extension does not match the actual image format it is changed to match, and if the name is already taken a suffix such as `-2` is added. The returned path is the one actually written.
