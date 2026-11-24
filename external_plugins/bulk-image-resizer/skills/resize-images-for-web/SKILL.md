---
name: resize-images-for-web
description: Batch-resize images to one exact pixel size with the Bulk Image Resizer browser tool, then place the results in the project. Use when the user wants favicons, app or PWA icons, Open Graph or social preview images, thumbnails, product photos or avatars at a fixed width and height, or asks to resize, crop or pad several images at once.
---

# Resize images for web

Help the user produce a set of images at one exact size, then wire them into the project. Answer in the user's language.

## 1. Pick the target size

Work out width × height from the request or the project before calling the tool. Common targets:

| Use | Size | Suggested mode / format |
| --- | --- | --- |
| Favicon / PWA icons | 32×32, 192×192, 512×512 | `fit`, `png` |
| Apple touch icon | 180×180 | `fit`, `png` |
| Open Graph / Twitter card | 1200×630 | `crop`, `jpeg` |
| Product photos | 1200×1200 (or the shop's size) | `fit`, `png` or `jpeg` |
| Avatars / thumbnails | 256×256 or 400×400 | `crop`, `jpeg` |

Each call produces one size. For several sizes (for example a full icon set), call the tool once per size and give the user each link.

## 2. Open the resizer

Call the MCP tool `prepare_bulk_image_resize` from the `bulk-image-resizer` server. It only builds a link; it never receives images.

| Argument | Values | Default | Meaning |
| --- | --- | --- | --- |
| `width` | integer 16–4096 | `1200` | Target width in pixels |
| `height` | integer 16–4096 | `1200` | Target height in pixels |
| `mode` | `fit` or `crop` | `fit` | `fit` keeps the whole image and pads the canvas; `crop` center-crops to fill |
| `format` | `png` or `jpeg` | `png` | PNG keeps transparency; JPEG fills transparent areas with white |
| `example` | `true` or `false` | `false` | Load the three built-in sample images |

Values outside these ranges are rejected with an input validation error.

The result has `structuredContent.preset`, a URL such as `https://bulk-image-resizer.pages.dev/#width=512&height=512&mode=fit&format=png&example=0`, plus `structuredContent.settings`. Give the user the link and the steps:

1. Open the link in a desktop browser.
2. Choose the local JPEG, PNG or WebP files (several at once is fine).
3. Check the previews, then download each image or the ZIP (`resized-<width>x<height>.zip`). Unreadable files are listed with an error and skipped.
4. Save the files into the project (for example `public/` or `static/`) and tell you where they are.

Images are processed locally in the browser and are not uploaded.

## 3. Wire the images into the project

After the user saves the files:

1. Confirm the file names and sizes in the workspace.
2. Propose the code changes, such as `<link rel="icon">` and `apple-touch-icon` tags, the web app manifest `icons` array, `og:image` / `twitter:image` meta tags, or framework metadata (for example Next.js `metadata` or static image imports).
3. Show the edit and get confirmation before changing files. Update the existing tags instead of adding duplicates.

## Limits

- The MCP tool cannot see or read the images; resizing happens only in the user's browser.
- If the tool call fails, give the user the base link `https://bulk-image-resizer.pages.dev/` and ask them to enter the size manually.
