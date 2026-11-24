# Bulk Image Resizer

[简体中文](./README_CN.md)

Batch-resize local images to one exact pixel size in the browser, then let the Agent wire the results into your project as favicons, app icons, Open Graph images or product and avatar sets.

## Components

| Component | Content |
| --- | --- |
| MCP server `bulk-image-resizer` | Remote Streamable HTTP server `https://bulk-image-resizer.pages.dev/zcode/mcp`, no authentication. Provides one tool, `prepare_bulk_image_resize`. |
| Skill `resize-images-for-web` | Picks the right size, opens the resizer with a preset, and after you save the files updates icon, manifest or meta tags after confirmation. |
| Command `/bulk-image-resizer:resize-images` | Starts the same workflow manually. |

### Tool `prepare_bulk_image_resize`

| Argument | Values | Default | Meaning |
| --- | --- | --- | --- |
| `width` | 16–4096 | `1200` | Target width in pixels |
| `height` | 16–4096 | `1200` | Target height in pixels |
| `mode` | `fit`, `crop` | `fit` | Fit the whole image with padding, or center-crop to fill |
| `format` | `png`, `jpeg` | `png` | PNG keeps transparency; JPEG uses a white fill |
| `example` | `true`, `false` | `false` | Load the built-in sample images |

The tool only returns a preset link to the browser resizer (for example `https://bulk-image-resizer.pages.dev/#width=512&height=512&mode=fit&format=png&example=0`) plus the normalized settings. It accepts no images or files. Invalid arguments are rejected.

## How to use

After installing and enabling the plugin, describe what you need, for example:

- Resize my product photos to 1200×1200 PNG with transparent padding
- Make 1200×630 Open Graph images from these screenshots, cropped to fill
- Prepare 512×512 app icons from my logo files

You can also type `/` and choose the `resize-images-for-web` skill or the `resize-images` command.

1. The Agent calls `prepare_bulk_image_resize` and gives you a link (one per target size).
2. Open it in a desktop browser and choose local JPEG, PNG or WebP files.
3. Download single images or the ZIP `resized-<width>x<height>.zip`; unreadable files are reported and skipped.
4. Save the files into the workspace. The Agent proposes the matching `<link rel="icon">`, manifest `icons`, `og:image` or framework metadata changes and applies them after you confirm.

## Dependencies, network access and side effects

- **Network**: MCP calls go to `https://bulk-image-resizer.pages.dev/zcode/mcp`. The resizer page is served from the same origin. Both are hosted on Cloudflare Pages, which processes standard request data such as IP address as the hosting provider.
- **Privacy**: images are decoded, resized and encoded locally in your browser and are not uploaded. The MCP tool receives only the settings above.
- **Accounts and billing**: none. No API key, login or payment.
- **File writes**: the plugin package writes nothing. The skill edits project files only after you confirm the change.
- **Command execution and Hooks**: none.
- **Telemetry**: the plugin package contains no telemetry.

## Source and license

- Plugin package: MIT, © 2026 Penova ([LICENSE](./LICENSE)).
- The Bulk Image Resizer web tool and MCP server are operated by Penova at `bulk-image-resizer.pages.dev`. Its ZIP export uses [fflate](https://github.com/101arrowz/fflate) (MIT), served by the web tool and not bundled in this plugin.
