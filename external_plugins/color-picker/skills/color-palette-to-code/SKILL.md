---
name: color-palette-to-code
description: Pick colors from an image, logo, screenshot or anywhere on screen with the Color Picker browser tool, then write the palette into the project as CSS custom properties, a Tailwind theme, SCSS variables or JSON design tokens. Use when the user wants to extract, sample or match colors from a picture or the screen, build a palette from a brand asset, or turn picked colors into theme code.
---

# Color palette to code

Help the user pick exact colors in the browser, then turn the palette they bring back into code that fits their project. Answer in the user's language.

## 1. Open the picker

Call the MCP tool `prepare_color_picker` from the `color-picker` server. It only builds a link; it never receives images, screen pixels or files.

| Argument | Values | Default | Meaning |
| --- | --- | --- | --- |
| `format` | `css` or `json` | `css` | Palette download format |
| `size` | `1`, `3`, `5` or `11` | `1` | Sample a single pixel, or average a 3×3, 5×5 or 11×11 area |
| `example` | `true` or `false` | `false` | Load the built-in sample image |

Choose arguments from the request:

- Pick `json` when the user wants design tokens, HSL values or alpha values in data form; otherwise `css`.
- Pick `size: 5` (or `11`) for photos, gradients or noisy screenshots; keep `1` for flat logos, icons and UI.
- Only pass arguments from the table. Any other value is rejected with an input validation error.

The result contains `structuredContent.preset`, a URL such as `https://browser-color-picker.pages.dev/?format=css&size=1&example=0`, and the same URL in the text content. Give that link to the user and explain the steps:

1. Open the link in a Chromium-based browser (Chrome, Edge).
2. Choose a local image (PNG, JPEG, WebP, GIF or AVIF), or use the screen eyedropper to pick from anywhere on screen. The eyedropper needs a browser that supports the EyeDropper API and only starts after the user clicks it.
3. Click points to sample, add each color to the palette, then download `color-palette.css` or `color-palette.json`, or copy the values.
4. Paste the palette back into the conversation, or save the downloaded file into the workspace and say where it is.

The image is processed locally in the browser. Do not ask the user to upload the image to the conversation for picking; if they already shared an image, still use the picker to read exact pixel values instead of guessing colors from it.

## 2. Read what comes back

- CSS export: a `:root { --color-1: #RRGGBB; ... }` block. Colors with transparency use 8-digit HEX (`#RRGGBBAA`).
- JSON export: an array of objects with `hex`, `rgb` (`rgb(r g b)` or `rgb(r g b / a)`), `hsl` and `rgba` (four 0–255 integers).
- The user may also paste single values copied as HEX, RGB or HSL.

Keep values exactly as exported. Do not round, re-quantize or "improve" colors unless asked.

## 3. Write the palette into the project

1. Inspect the project to find where colors live: `tailwind.config.*` or a Tailwind v4 `@theme` block, global CSS with `:root` variables, SCSS/LESS variables, a design-token JSON file, or a component library theme.
2. Ask for (or propose) semantic names such as `primary`, `accent`, `surface`, `text`; replace the generic `--color-1`, `--color-2` names.
3. Show the planned edit and get confirmation before changing files. Edit the existing theme location instead of creating a parallel one.
4. When a color is meant for text on a background, compute the WCAG contrast ratio and flag pairs below 4.5:1 (normal text) or 3:1 (large text).

## Limits

- The MCP tool cannot see the image or the screen; colors only come from the user's browser session.
- If the tool call fails (network or server error), give the user the base link `https://browser-color-picker.pages.dev/` and continue from step 2 when they return with a palette.
