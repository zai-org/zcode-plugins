---
description: Set a ZCode desktop wallpaper (image or Wallpaper Engine scene) and adapt the UI with Monet colors / 设置 ZCode 壁纸（图片或 Wallpaper Engine 场景），并用 Monet 动态取色适配界面配色
argument-hint: "[image path, scene .pkg/directory, or description]"
---

# ZCode Beautify

The user wants to beautify the ZCode desktop client. $ARGUMENTS

## Steps

1. **Resolve the wallpaper.** If a file path is given in the arguments, use it.
   Otherwise ask the user for a path (absolute path works best). Both static
   images and Wallpaper Engine scene wallpapers (a `.pkg` file or an extracted
   workshop directory containing `project.json`) are accepted.
2. **Check CDP availability.** The running ZCode instance must have its debug
   port enabled. If unsure, run the plugin CLI's status check:

   ```bash
   node "${ZCODE_PLUGIN_ROOT}/dist/cli.js" status
   ```

   or simply try the tool below and read the error.
3. **Apply the wallpaper** with the `set_background` MCP tool, passing the
   absolute path and any `blur` / `dim` preferences the user mentioned. Scene
   inputs are detected automatically and routed to the import pipeline.
4. **Importing a scene wallpaper (动态壁纸):** the first import opens the scene
   in a Wallpaper Engine window, records it, and processes it into a seamless
   loop — this takes tens of seconds to a few minutes and runs stages like
   渲染中 → 录制中 → 处理中. Prefer the dedicated `import_scene_wallpaper` MCP
   tool when the user explicitly asks to import a scene. Requirements:
   Wallpaper Engine and ffmpeg 5+ installed locally (Windows); if the tool
   reports missing dependencies, show the user the install steps (Steam app
   431960 / `winget install Gyan.FFmpeg`) and retry after they confirm. The
   rendered loop is cached — re-imports of the same wallpaper return instantly.
5. **Motion requires serve.** The plugin's MCP server keeps a local background
   service (`serve`) running — it starts automatically with the plugin and
   streams the animated loop. If a tool reports that serve is not running,
   start it:

   ```bash
   node "${ZCODE_PLUGIN_ROOT}/dist/cli.js" serve --detach
   ```

   then use `refresh_theme`. Do not start a second `serve` — the CLI refuses a
   duplicate and names the pid that already owns the port. Without serve the
   poster frame is applied as a static wallpaper instead.
6. **If a tool fails with a CDP/port error**, the running ZCode instance was
   not started with the debug port. Tell the user to run:

   ```bash
   node "${ZCODE_PLUGIN_ROOT}/dist/cli.js" launch
   ```

   (this restarts ZCode with `--remote-debugging-port=9222` and writes the flag
   into the ZCode shortcuts so later launches keep it; unsaved work in other
   apps is not affected, ZCode sessions are persisted), then retry.
7. **Fine-tune without changing the wallpaper** using the `apply_options` MCP
   tool (`blur` / `dim` / `monet` / `wallpaper_visible`) when the user asks to
   adjust the look — no need to re-import anything.
8. **Report the result** and mention:
   - while `serve` runs, a draggable settings panel lives inside ZCode for live
     tuning (blur/dim sliders, Monet toggle, wallpaper swap, scene import with
     progress, library, rotation playlists, reset);
   - `reset_appearance` restores the default look.
