# Recording real screens

The skill renders whatever recordings you point `episode.json` at. This page covers how to get clean source takes on common platforms. Whatever tool you use, the rules in the SKILL.md workflow (one real run, no retakes posing as different runs, dedicated test data) apply.

## What a good take looks like

- 1920x1080 or larger, landscape; the renderer crops to a 1080p canvas.
- Steady 30fps or higher; avoid variable-frame-rate phone-mirror captures when possible.
- The whole interaction in one continuous take: entry → action → result read-back.
- No notifications, no unrelated windows, no personal data in frame.

## macOS

**System screen recording** (no install): `Cmd+Shift+5` → Record Selected Portion, or QuickTime Player → New Screen Recording. Records to `.mov`; transcode before use:

```bash
ffmpeg -i take-01.mov -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac take-01.mp4
```

Grant Screen Recording permission to the capturing app in System Settings → Privacy & Security.

## Windows

Xbox Game Bar (`Win+G` → Capture) records the active window as MP4. For window-precise, longer takes OBS Studio (free) with a Window capture source at 1920x1080@30 output is the reliable default.

## Linux

OBS Studio with a Window capture (XComposite) or Screen capture (PipeWire) source. On Wayland use the desktop portal capture; set output to 1920x1080, 30fps, x264 CRF 18–20.

## Browser content: scripted screencast (optional, strongest evidence)

For web apps, a scripted CDP screencast gives a headless, reproducible capture with an evidence file. Any tool that drives Chrome via the DevTools Protocol and calls `Page.startScreencast` works; examples: Playwright with `page.video` context recording, or a small script using chrome-remote-interface. Write `<take>.evidence.json` next to the mp4 so preflight can bind it:

```json
{
  "kind": "cdp-screencast",
  "port": 9222,
  "video": "take-01.mp4",
  "size": [1920, 1080],
  "frames": 312,
  "video_s": 10.4,
  "sha256": "<hex digest of take-01.mp4>"
}
```

`kind` may also be `"browser-demo"` for script-driven demos. Mark the segment `"source": "browser"` in episode.json — a browser segment without a matching evidence file fails preflight. `size` must be exactly 1920x1080 for browser takes, and the recorded duration must match the file within 0.2s.

Headless screencasts contain no mouse cursor — if the audience needs to see where clicks land, inject a highlight from your driver script or annotate click positions in post.

## Cropping to the content area

Take one screenshot of the same window and measure the content rectangle, then set `crop` in episode.json to `[x, y, w, h]` in source pixels. The crop must keep both the operating controls and the result feedback in frame; `x+w` and `y+h` must stay inside the source. Crop beats blur/mosaic for hiding sidebars: mosaic leaks edges and covers controls.
