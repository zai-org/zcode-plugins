# Color Picker

[简体中文](./README_CN.md)

Pick exact colors from an image or anywhere on screen in a browser color picker, then let the Agent turn the palette into CSS variables, Tailwind theme colors or design tokens in your project.

## Components

| Component | Content |
| --- | --- |
| MCP server `color-picker` | Remote Streamable HTTP server `https://browser-color-picker.pages.dev/zcode/mcp`, no authentication. Provides one tool, `prepare_color_picker`. |
| Skill `color-palette-to-code` | Opens the picker with suitable settings, reads the exported palette and writes it into the project's theme files after confirmation. |
| Command `/color-picker:pick-colors` | Starts the same workflow manually. |

### Tool `prepare_color_picker`

| Argument | Values | Default | Meaning |
| --- | --- | --- | --- |
| `format` | `css`, `json` | `css` | Palette download format |
| `size` | `1`, `3`, `5`, `11` | `1` | Sample one pixel or average a 3×3, 5×5 or 11×11 area |
| `example` | `true`, `false` | `false` | Load the built-in sample image |

The tool only returns a preset link to the browser picker (for example `https://browser-color-picker.pages.dev/?format=json&size=5&example=0`) plus the normalized settings. It accepts no images, files or screen data. Invalid arguments are rejected.

## How to use

After installing and enabling the plugin, describe what you need, for example:

- Pick colors from my logo and add them as Tailwind theme colors
- Sample the brand colors from this screenshot and create CSS variables
- Open the color picker with JSON export and 5×5 averaging

You can also type `/` and choose the `color-palette-to-code` skill or the `pick-colors` command.

1. The Agent calls `prepare_color_picker` and gives you a link.
2. Open it in a Chromium-based browser such as Chrome or Edge. Choose a local PNG, JPEG, WebP, GIF or AVIF image, or start the screen eyedropper (requires browser EyeDropper API support).
3. Add colors to the palette, then download `color-palette.css` / `color-palette.json` or copy the values.
4. Paste the palette back into the conversation (or save the file into the workspace). The Agent proposes semantic names, shows the edit, and writes it to your theme after you confirm. It can also check WCAG contrast for text and background pairs.

CSS export is a `:root { --color-1: #RRGGBB; ... }` block. JSON export is an array of `{ hex, rgb, hsl, rgba }` objects. Transparent colors keep their alpha.

## Dependencies, network access and side effects

- **Network**: MCP calls go to `https://browser-color-picker.pages.dev/zcode/mcp`. The picker page is served from the same origin. Both are hosted on Cloudflare Pages, which processes standard request data such as IP address as the hosting provider.
- **Privacy**: images and screen pixels are processed locally in your browser and are not uploaded. The MCP tool receives only the three settings above.
- **Accounts and billing**: none. No API key, login or payment.
- **File writes**: the plugin package writes nothing. The skill edits theme files in your project only after you confirm the change.
- **Command execution and Hooks**: none.
- **Telemetry**: the plugin package contains no telemetry.

## Source and license

- Plugin package: MIT, © 2026 Penova ([LICENSE](./LICENSE)).
- The Color Picker web tool and MCP server are operated by Penova at `browser-color-picker.pages.dev`.
