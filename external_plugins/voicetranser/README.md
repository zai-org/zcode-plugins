# VoiceTranser

Local push-to-talk voice input for macOS: hold a global hotkey, speak, release — the transcription is pasted at your cursor. Built for talking to coding agents (and anything else you type into). Fully local, zero external APIs.

This plugin ships an **agent skill** — it does not bundle the tool itself. Once installed, you can say *"install VoiceTranser for me"* and the agent walks the whole chain: prerequisites, clone, deps, model download, launchd service, Karabiner hotkey wiring, accessibility permission, then verifies with the built-in 8-point diagnose script. It also handles ongoing troubleshooting and engine switching.

The runtime is pulled from the upstream repository, so installation needs network access and the tools listed below. The launchd step generates a plist from the current checkout path with `install_launchd.py`; the repository's own plist is an author-local example and is not copied to users' machines.

## What you get

- 🎙️ **Push-to-talk** — Karabiner `right_option` hold-to-talk (or Raycast/Hammerspoon hitting `/toggle`)
- 🧠 **Local STT, three engines** — Qwen3-ASR 0.6B 4bit on MLX/Metal (default, RTF 0.012–0.021, excellent Chinese with punctuation, strong zh-en code-switching) → SenseVoice Small int8 (CPU fallback) → mlx-whisper large-v3 (English/exotic languages)
- 📋 **Auto-paste** at the cursor, macOS notifications at each stage
- 🔧 **Mis-recognition wordlist** (`corrections.json`) — add a line, restart, fixed
- 🛡️ **Self-healing** — launchd KeepAlive + CoreAudio watchdog

## Requirements

macOS **Apple Silicon** (the default engine needs MLX/Metal; Intel Macs can force the CPU engine), Python 3.11+, [uv](https://docs.astral.sh/uv/). Optional but recommended: [Karabiner-Elements](https://karabiner-elements.pqrs.org/).

## Example prompts

- "Install VoiceTranser and wire my right Option key for push-to-talk"
- "语音输入装一下，右 Option 按住说话"
- "Transcription pasted nothing — diagnose VoiceTranser"
- "把 VoiceTranser 切到 CPU 引擎"

## Side effects (disclosed)

Installing/configuring VoiceTranser via this skill will, on your machine:

- **Network**: clone the GitHub repo, install Python deps via uv, download STT models (~230 MB SenseVoice from hf-mirror; ~500 MB Qwen3-ASR auto-fetched on first run). No audio or transcripts ever leaves the machine.
- **Files**: clone the repo, write model files and `~/.cache/huggingface` entries, install a launchd plist into `~/Library/LaunchAgents/`, write logs to `~/Library/Logs/`.
- **Commands**: run `uv`, `launchctl`, `curl` against `localhost:9877`, and the repo's diagnose script. May ask you to grant **Accessibility** permission to your terminal (required for auto-paste) and to add a Karabiner rule (the skill asks before editing Karabiner config or installing brew packages).

## Source & license

Upstream project: https://github.com/Lumos-789/VoiceTranser — MIT.
