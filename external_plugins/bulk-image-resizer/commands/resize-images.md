---
description: Open Bulk Image Resizer with an exact size preset and wire the resized images into the project
---

Use the `resize-images-for-web` skill from the `bulk-image-resizer` plugin.

Determine the target width and height (16–4096 px), mode (`fit` or `crop`) and format (`png` or `jpeg`) from the request or the project, call `prepare_bulk_image_resize`, and give the user the returned link and steps. When they have saved the resized files into the workspace, propose and, after confirmation, apply the needed code changes.

Answer in the user's language. Optional request details: $ARGUMENTS
