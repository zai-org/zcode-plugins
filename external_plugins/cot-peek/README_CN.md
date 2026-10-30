# 思考小窗 / Cot Peek

一颗悬浮球，实时把 ZCode 的英文思维链翻成中文。AI 用英文思考，这颗球用中文讲给你听，每轮思考落盘后半秒内出译文。

[English](README.md)

![思考流翻译](https://raw.githubusercontent.com/cobaltna/cot-peek/main/screenshots/thinking.png)

## 功能

- **思考流翻译**：用 ReadDirectoryChangesW 监听 ZCode 的 rollout 目录，每轮思考切成小段，三路并发翻译，逐段上屏。从写入到出译文实测 0.05 到 0.5 秒。
- **划词翻译**：窗口开着时复制一段英文，1 秒内出中文。
- **标签页窗口**：一个窗口两个标签页加一个暂停按钮。阅读位置永不跳动，只有视口停在底部才自动跟随。
- **圆形悬浮球**：44 像素的圆，贴在屏幕右缘，圆外没有底框。点球展开，点 × 收起，收起即暂停。

![划词翻译](https://raw.githubusercontent.com/cobaltna/cot-peek/main/screenshots/clipboard.png)

## 安装

从 ZCode 装：设置 → 插件管理 → 发现 → 添加市场 `cobaltna/cot-peek` → 安装「思考小窗」。然后运行 `/cot-peek:start`，或直接对 ZCode 说「启动思考小窗」。

独立安装：在 pwsh 里运行本目录的 `install.ps1`。脚本会找到 pythonw.exe 并注册每分钟检查的计划任务 `ZCodeCotPeek`，ZCode 一运行小球就出现，ZCode 一退出小球即时跟随退出。也可以双击 `start-cot-peek.bat` 单次启动。

要求：Windows 10/11，任意带 tkinter 的 Python 3。

## 副作用与依赖

安装前请读这一段：

- **网络访问**：翻译请求发往三个免费公共网页接口，按序降级：火山翻译网页版 `translate.volcengine.com`、微软必应翻译 `cn.bing.com`、MyMemory `api.mymemory.translated.net`。不需要 key，不需要账号，无任何遥测。三个全挂时保留英文原文并标红。
- **读取的文件**：`~/.zcode/cli/rollout/model-io-session_*.jsonl` 与系统进程列表，仅此两项。
- **写入的文件**：只在插件自己的目录里写 `cot_peek.log`、`cot_peek.json`、`cot_peek.lock`。
- **进程**：运行 `pythonw.exe cot_peek.py`；`install.ps1` 通过 `schtasks.exe` 注册 Windows 计划任务。
- **没有 hook，没有 MCP server，不注入模型上下文，不写 ZCode 的任何数据**。

## 第三方服务

翻译由火山翻译、微软必应、MyMemory 的公共网页接口完成，可用性与条款随对方变化，接口变动时工具自动降级。其余代码全部原创，MIT 协议，只用 Python 标准库加 tkinter。

![悬浮球](https://raw.githubusercontent.com/cobaltna/cot-peek/main/screenshots/ball.png)
