# Godot

[中文](README_CN.md)

Develop games with the official Godot CLI and view each iteration in the original desktop editor. This standard plugin provides two skills and an `open` command; it bundles no engine, MCP server, addon or side pane.

## Start

Ask the Agent to “use Godot to create a game and open the editor”, or invoke `open` with a project directory. The setup skill locates a compatible native Godot 4.x installation or installs one from official sources within your authorization. C# projects require the .NET edition and SDK.

| Skill | Purpose |
| --- | --- |
| setup | Locate/install Godot and verify its built-in CLI |
| cli | Edit project files, open the desktop editor, run scenes and export on request |

The Agent works in one local directory containing `project.godot`, edits scripts/scenes/resources, and launches `godot --editor --path "/absolute/project"`. Existing windows and unsaved edits are preserved. External file changes may require focusing the editor or accepting its reload dialog; CLI does not expose the current selection or unsaved editor state. Visible desktop access is required to show windows. Background execution is not a visual verification.

## Dependencies and migration

Godot is the only required runtime. No uv, Python service, MCP credentials or separate model API key is needed; the Agent uses the configured ZCode model. Installing a missing engine requires network access to official distributors. Commands may create project files/import caches, run project code, open windows and write renders/exports under the user's authorization.

When upgrading from 0.3.x, restart the session to unload the previous MCP server. The plugin no longer installs an addon. Existing `addons/godot_mcp`, autoloads and project settings are not automatically removed: inspect their ownership and dependencies before separately migrating the project. Do not delete user modifications or stop unrelated editor processes.

## Validation and license

On macOS with Godot 4.7.2, the installed 0.4.0 plugin was exercised in ZCode using DeepSeek Flash: both skills loaded, project files and mesh/material resources were generated, and native Godot produced PNG renders that were opened for inspection. This validates the functional authoring/render path, not product-model accuracy. Windows/Linux installation and interactive editor reload were not independently validated in this run.

Godot and its icon are MIT licensed; see the repository's `assets/godot/LICENSE.txt`. This plugin uses Godot's official executable and does not bundle hybridindie code.

An enabled legacy addon may keep trying to connect to its retired bridge; these connection errors are not game defects. Check the enabled plugin entry and `.godot/zcode-mcp.json` without exposing its token. With authorization, save/back up the project, disable the addon, and remove only verified unused addon/autoload entries and project credentials. Old state lives under `~/.zcode/plugin-data/godot-native/` or `ZCODE_GODOT_DATA_DIR`; verify project ownership and active clients before authorized cleanup. Shared Python environments must be retained while any legacy client uses them.

Packaging rejects `dist/` in a plugin with no build source, including residual 0.3.x output. Inspect and remove only the stale generated directory before rebuilding; it is never silently included in the CLI package.
