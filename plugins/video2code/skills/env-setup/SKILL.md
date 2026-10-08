---
name: env-setup
description: "Check and provision the video2code plugin environment: Python/MCP/video packages, ffmpeg/ffprobe, Node/npm, registry, and webapp cache. Browser interaction and recording use ZCode's built-in Browser Use WebView, so Playwright and external Chromium are intentionally not installed."
---

# Env Setup

唯一入口：

```bash
node "<plugin_root>/hooks/run_python.mjs" "<plugin_root>/skills/env-setup/scripts/env_doctor.py"
node "<plugin_root>/hooks/run_python.mjs" "<plugin_root>/skills/env-setup/scripts/env_doctor.py" --fix
```

插件根路径由 SessionStart 输出，并写入 `.v2c/plugin_root`。完整探测给 Bash ≥120s。

## 依赖与影响

| Requirement | Dead without it |
|---|---|
| Python ≥3.10；同一解释器内有 `mcp==1.9.0`, `opencv-python-headless`, `numpy`, `pillow` | MCP 部署/视频工具，抽帧、contact sheet、still/composite；MCP 2.x 已移除插件使用的 Server API |
| `ffmpeg` + `ffprobe` | video MCP 的视频摄入、裁剪、时长探测；以及 url2video 把内置浏览器录出的 WebM 转成交付用的 MP4（主流程必经，不是可选后处理） |
| Node.js ≥20 + npm | webapp 构建 |
| npm registry reachable | 安装 webapp 依赖 |
| ZCode IAB + Browser Use recording API | URL 浏览、截图、交互和录制 |

Playwright、`playwright install chromium` 和独立 Chromium **不是依赖**。浏览器能力由 ZCode
内置 Browser Use 提供，版本不支持时应升级 ZCode，不要在插件环境里补装浏览器。

## 规则

1. 先跑 doctor；只安装它标记缺失的项。
2. `--fix` 只处理用户态、幂等项（Python 包和 node_modules 预热）。ffmpeg/Node 属于系统级，
   只报告要求和脚本给出的示例命令，让用户选择安装方式。
3. `[未探测]` 先修前置后重跑；`·` 是本平台不适用。
4. PATH 改变后重开终端，不要重复安装。
5. npm 网络失败先检查代理/镜像；配置后再重试一次。
6. 最终重新运行 doctor，以 `.v2c/env_report.json` 为回执。
7. Windows 仍需要 Git Bash/WSL 与目录软链权限，因为 web-replicate 脚手架是 shell 脚本。

不要用 Playwright 兜底浏览器能力；不要因为缺 cv2 就临时改用另一套抽帧链。缺少 ffmpeg 时内置
浏览器仍能录出 WebM，但 url2video 的 webm→mp4 转码这步会卡住 —— ffmpeg 属于必装项，别把它
当成可跳过的可选后处理。
