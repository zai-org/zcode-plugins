---
description: Set a desktop wallpaper (ZCode or WorkBuddy; image or Wallpaper Engine scene) and adapt the UI with Monet colors
argument-hint: "[image path, scene .pkg/directory, or description]"
---

# Desktop Beautify

The user wants to beautify their desktop client — **ZCode** by default, or
**WorkBuddy** when the plugin was installed from `.codebuddy-plugin/`
(`BEAUTIFY_TARGET=workbuddy`, CDP port 9333). $ARGUMENTS

## Steps

1. **Resolve the wallpaper.** If a file path is given in the arguments, use it.
   Otherwise ask the user for a path (absolute path works best). Both static
   images and Wallpaper Engine scene wallpapers (a `.pkg` file or an extracted
   workshop directory containing `project.json`) are accepted.
2. **Check CDP availability** by running `node <plugin-root>/bundle/cli.js status`
   if available, or simply try the tool below and read the error.
3. **Apply the wallpaper** with the `set_background` MCP tool, passing the
   absolute path and any `blur` / `dim` preferences the user mentioned. Scene
   inputs are detected automatically and routed to the import pipeline.
4. **Importing a scene wallpaper (动态壁纸):** the first import opens the scene
   in a Wallpaper Engine window, records it, and processes it into a seamless
   loop — this takes tens of seconds and runs stages like 渲染中 → 录制中 →
   处理中. Prefer the dedicated `import_scene_wallpaper` MCP tool when the user
   explicitly asks to import a scene. Requirements: Wallpaper Engine and
   ffmpeg 5+ installed locally; if the tool reports missing dependencies, show
   the user the install steps (Steam app 431960 / `winget install Gyan.FFmpeg`)
   and retry after they confirm. The rendered loop is cached — re-imports of
   the same wallpaper return instantly.
5. **Motion requires serve.** The animated loop streams from the local serve
   endpoint. If serve is not running, tell the user to run:
   `node <plugin-root>/bundle/cli.js serve --detach`
   then use `refresh_theme`. Without serve the poster frame is applied as a
   static wallpaper instead.
6. **If a tool fails with a CDP/port error**, the running ZCode instance was
   not started with the debug port. Tell the user to run:
   `node <plugin-root>/bundle/cli.js launch`
   (this restarts ZCode with `--remote-debugging-port=9222` — unsaved work in
   other apps is not affected, ZCode sessions are persisted), then retry.
7. **Fine-tune without changing the wallpaper** using the `apply_options` MCP
   tool (`blur` / `dim` / `monet` / `wallpaper_visible`) when the user asks to
   adjust the look — no need to re-import anything.
8. **Report the result** and mention:
   - `node <plugin-root>/bundle/cli.js serve --detach` keeps a draggable settings
     panel inside ZCode for live tuning (blur/dim sliders, Monet toggle,
     wallpaper swap, scene import with progress, library, reset). Always pass
     `--detach`: a foreground `serve` dies with the shell that started it, and
     the panel then reports itself offline. Do not start a second `serve` —
     the CLI refuses a duplicate and names the pid that already owns the port;
   - `reset_appearance` restores the default look.
