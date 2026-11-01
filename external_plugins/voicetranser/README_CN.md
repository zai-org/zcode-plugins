# VoiceTranser

macOS 本地按住说话语音输入：按住全局热键说话、松开即转写粘贴到光标处。为「跟编程助手对话」以及一切打字场景而生。完全本地运行，零外部 API。

本插件提供的是 **agent 技能**，不内嵌工具本体。安装后对 agent 说「帮我装 VoiceTranser」，它就会走完整条链：前置检查、clone、依赖、模型下载、launchd 常驻服务、Karabiner 热键接线、辅助功能权限，最后用内置 8 项自检脚本验证收工。日常排障与引擎切换也由它接管。

## 你会得到什么

- 🎙️ **按住说话** — Karabiner `right_option` 按住录音松开出稿（也可用 Raycast/Hammerspoon 触发 `/toggle`）
- 🧠 **本地 STT，三引擎** — Qwen3-ASR 0.6B 4bit MLX/Metal（默认，RTF 0.012–0.021，中文近完美自带标点、中英夹杂强）→ SenseVoice Small int8（CPU fallback）→ mlx-whisper large-v3（英文/小语种）
- 📋 **自动粘贴**到光标处，各阶段 macOS 通知反馈
- 🔧 **误识词表**（`corrections.json`）— 发现误识加一行重启即生效
- 🛡️ **自愈守护** — launchd KeepAlive + CoreAudio 死锁看门狗

## 环境要求

macOS **Apple Silicon**（默认引擎需要 MLX/Metal；Intel 机型可强制走 CPU 引擎）、Python 3.11+、[uv](https://docs.astral.sh/uv/)。推荐装 [Karabiner-Elements](https://karabiner-elements.pqrs.org/)。

## 示例指令

- "Install VoiceTranser and wire my right Option key for push-to-talk"
- "语音输入装一下，右 Option 按住说话"
- "Transcription pasted nothing — diagnose VoiceTranser"
- "把 VoiceTranser 切到 CPU 引擎"

## 副作用披露

通过本技能安装/配置 VoiceTranser 会在你的机器上：

- **网络**：clone GitHub 仓库、uv 安装 Python 依赖、下载 STT 模型（SenseVoice ~230MB 走 hf-mirror；Qwen3-ASR ~500MB 首次运行自动拉取）。音频与转写文本永不离开本机。
- **文件**：clone 仓库、写模型文件与 `~/.cache/huggingface` 缓存、安装 launchd plist 到 `~/Library/LaunchAgents/`、日志写到 `~/Library/Logs/`。
- **命令**：运行 `uv`、`launchctl`、对 `localhost:9877` 的 `curl`、仓库自检脚本；可能需要你为终端授予**辅助功能**权限（自动粘贴必需），并添加一条 Karabiner 规则（改 Karabiner 配置或装 brew 包之前技能会先征询）。

## 源码与许可

上游项目：https://github.com/Lumos-789/VoiceTranser — MIT。
