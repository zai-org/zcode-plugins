---
description: Open the Color Picker in the browser and turn the picked palette into theme code
---

Use the `color-palette-to-code` skill from the `color-picker` plugin.

Call `prepare_color_picker` with arguments that fit the request (`format`: `css` or `json`; `size`: the number 1, 3, 5 or 11 — not a string; `example`: true only if the user wants the built-in sample), give the user the returned link and the picking steps, then wait for the exported palette and write it into the project after confirming names and location.

Answer in the user's language. Optional request details: $ARGUMENTS
