---
description: Open a local Godot project in the original desktop editor using the official CLI
---
Follow the Godot setup skill to locate the official native executable, then the cli skill. Resolve $ARGUMENTS as the intended project directory, defaulting to the current project root containing project.godot. Open it using `godot --editor --path "/absolute/project"`, replacing godot with the verified binary. Reuse an existing window for that project and preserve unsaved user edits. Start the GUI non-blockingly and retain the process identity and logs. Do not install or start MCP, uv, an addon, or a side pane. Verify the visible window when computer-use tools are available; otherwise explicitly report that visual verification is pending.
