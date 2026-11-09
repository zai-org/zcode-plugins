# Blender

[中文](README_CN.md)

A lightweight Z.ai guidance plugin for the official Blender executable. It does not bundle or modify Blender, add a custom CLI, or require MCP or a bridge.

Ask the Agent to “set up Blender” or “use Blender CLI to create a small turtle”. The `setup` skill finds or installs Blender and verifies its executable; the `cli` skill guides modeling and image inspection.

Modeling opens a visible Blender window. Each refinement uses the same project. Before reopening it, close only the task-owned window through Blender’s normal UI save/close flow using a host UI tool. If that cannot be verified, ask the user to save and close the window, and wait before continuing. The Agent reads preview images to decide whether to refine; the final window remains open. This shows iteration results, not necessarily every operation within a long script. The CLI cannot inspect live unsaved edits; a prior save or completion marker is insufficient. Never terminate the process with signals or overwrite the project from another process while awaiting closure. Explicit batch jobs may run headlessly.

Blender includes its CLI; no separate CLI package is needed. Installation requires an explicit request or consent, including prior consent to install Blender if missing; a modeling request alone is insufficient. Host permissions still apply. A visible desktop and an Agent image-reading tool are needed for the full workflow. Platform installation paths differ; Windows and Linux runtime behavior has not been validated for this plugin.

References: [Blender downloads](https://www.blender.org/download/), [CLI manual](https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html), [Python API](https://docs.blender.org/api/current/).

Version 0.4.0 replaces the previous MCP integration. Existing MCP tool names and host/port settings no longer apply; start a new conversation after updating. No account or API key is required. Setup may download Blender; modeling runs local Python and writes project/preview files. This guidance retains the package GPL-3.0-or-later license; Blender itself is distributed separately under its upstream license.
