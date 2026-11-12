---
name: generate-image
description: Use when the user asks to draw, generate, or create an image, illustration, poster, icon, or picture from a description, or to restyle or edit an existing image. Calls the generate_image tool of the image-generation plugin and saves the result into the workspace.
---

# Generate an image

Use the `generate_image` tool from the `image_generation` MCP server.

1. Turn the request into one concrete prompt: subject, style, composition, lighting, colour, and any exact text that must appear. Write it in the user's language.
2. If the user supplies or points to an image to restyle or edit, pass it as `reference_image` (a workspace path, an `https://` URL, or a `data:image/...;base64` URL). Only one reference image is supported; png, jpeg, and webp up to 10 MiB.
3. Pass `output_path` only when the user names a location inside the workspace; an existing file is not overwritten. Otherwise the image is saved under `generated-images/` in the workspace.
4. Reply with the saved file path as a link, and mention that the returned URL is temporary.

One call produces one image and takes a few seconds to tens of seconds. Do not call it in a loop to make variations unless the user asks for several.

When the tool returns an error, tell the user what it says. In particular:

- a Coding Plan message means the current ZCode connection has no Coding Plan;
- a Z.ai account message means the account must be linked to Z.ai with a phone number (email for overseas accounts);
- a content-review failure can be retried once with a reworded prompt.

If the tool fails, report the error and stop. Do not substitute a hand-drawn SVG, HTML, or any other self-made image.
