---
name: voicetranser
description: Install, configure and troubleshoot VoiceTranser — a fully local macOS push-to-talk voice input tool (hold a global hotkey, speak, release to transcribe-and-paste into any app). Use when the user wants hands-free voice dictation for coding/agents, asks to install VoiceTranser, wire its Karabiner hotkey / launchd service, switch STT engines, or fix transcription/paste/recording issues.
---

# VoiceTranser — local push-to-talk voice input for macOS

Hold a global hotkey, speak, release → transcription is pasted at the cursor.
Fully local (zero external APIs). Repo: https://github.com/Lumos-789/VoiceTranser

## Facts you need before touching anything

- Target: macOS **Apple Silicon** (the default engine needs MLX/Metal; Intel Macs fall back to the CPU engine).
- Stack: Python 3.11+ managed by **uv**; HTTP server (stdlib); launchd service; Karabiner-Elements hotkey.
- Engines (`STT_ENGINE`): `qwen3-mlx` (default, Qwen3-ASR 0.6B 4bit via mlx-audio, RTF≈0.015, best zh quality, punctuated) → `sensevoice` (CPU fallback, RTF≈0.03) → `mlx-whisper` (en/exotic languages).
- Ports: default 9876; the documented launchd instance uses **9877**.
- Model files: SenseVoice 228 MB via `download_model.py` (hf-mirror); Qwen3-ASR ~500 MB auto-fetched on first run (respects `HF_ENDPOINT`).

## Install flow (do these in order, verify each step)

1. **Preflight**: `uname -m` (expect arm64), `command -v uv` (if missing: `brew install uv` — ask before installing anything).
2. **Clone & deps**:
   ```
   git clone https://github.com/Lumos-789/VoiceTranser.git ~/VoiceTranser && cd ~/VoiceTranser
   uv sync   # if PyPI crawls: UV_DEFAULT_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple uv sync
   uv run python download_model.py
   ```
3. **First-run check**: `uv run python -m voicetranser --config` must print config without error.
4. **Service (recommended)**:
   ```
   uv run python install_launchd.py
   curl -s localhost:9877/status   # expect {"status": "idle"}; model preloads in background
   ```
   `install_launchd.py` writes a per-user plist whose `ProgramArguments` and
   `WorkingDirectory` point at this checkout, then loads it. Do not copy the
   repository's `com.voicetranser-sense.plist`: that file contains the author's
   local paths. Use `--port`, `--engine`, or `--no-load` when needed.
5. **Hotkey — Karabiner-Elements** complex modification (user must have Karabiner installed; add to `~/.config/karabiner/karabiner.json` → `profiles[].complex_modifications.rules`, then enable in the Karabiner UI):
   ```json
   {
     "description": "VoiceTranser: right_option push-to-talk",
     "manipulators": [
       { "type": "basic", "from": { "key_code": "right_option" },
         "to": [{ "shell_command": "curl -s localhost:9877/start > /dev/null" }],
         "to_after_key_up": [{ "shell_command": "curl -s localhost:9877/stop > /dev/null" }] }
     ]
   }
   ```
   No Karabiner? Raycast/Hammerspoon hitting `/toggle` works too.
6. **Accessibility permission** (paste step needs it, grant once): System Settings → Privacy & Security → Accessibility → enable the terminal app. Then `uv run python tests/diagnose.py` — all 8 checks must pass.

## Troubleshoot (in order of likelihood)

- **Nothing pastes** → accessibility permission missing (step 6); re-run diagnose.
- **Hotkey does nothing** → `curl -s localhost:9877/status`; if refused, `launchctl kickstart -k gui/$(id -u)/com.voicetranser-sense` and check `~/Library/Logs/VoiceTranser-sense.log`.
- **Slow first transcription after boot** → model preload still running (cold load can take ~75 s); it is one-time per service start.
- **Bad quality on specific words** → append a mapping to `corrections.json` (whole-word replace, applied post-transcription), restart service.
- **GPU/memory concerns** → engine already caps MLX buffer cache at 1 GB; to fully avoid GPU use switch: `STT_ENGINE=sensevoice` (edit plist/`.env`, restart).
- **Generic health** → `uv run python tests/diagnose.py` (8 checks: deps, models, mic, clipboard, service, logs…). Fix whatever it flags before guessing.

## Switch engines

Edit `STT_ENGINE` in `~/Library/LaunchAgents/com.voicetranser-sense.plist` (overrides `.env`), then `launchctl bootout gui/$(id -u)/com.voicetranser-sense && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.voicetranser-sense.plist`.

## Hard rules

- Never send audio or transcripts anywhere — the whole point is local-only operation.
- Don't install brew packages or modify Karabiner config without asking first.
- After any config change, verify with `diagnose.py` + one real `curl /status` before declaring done.
