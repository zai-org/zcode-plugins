# orbtile-start（ZCode 版）

[English](README.md)

[Orbtile](https://orbtile.com) 的一个小型入门插件。Orbtile 是一款 macOS 和 Windows 应用，在小键盘上实时显示你的编程智能体的状态。

## 功能

- `orbtile-status` 技能会检查本机：Orbtile 应用是否已安装，Orbtile 的 ZCode 审批钩子是否已开启，应用是否正在运行。如有需要，它会告诉你下一步该做什么。你可以让 ZCode“检查我的 Orbtile 设置”或“为 ZCode 设置 Orbtile”。
- 安装 Orbtile 应用后无需其他设置：Orbtile 会通过 ZCode 的任务文件跟踪任务。之后你可以移除本插件。

## 运行、读取和发送的内容

- 命令：只有在你提出要求时，技能才会运行一个脚本：`scripts/orbtile.sh`（macOS 和 Linux）或 `scripts/orbtile.ps1`（Windows）。
- 读取的文件：`~/.zcode/cli/config.json` 以及常见的应用目录（`/Applications`、`~/Applications`、`%LOCALAPPDATA%\Orbtile`）。在 macOS 上，它会检查是否有名为 Orbtile 的进程在运行。
- 写入的文件：无。
- 网络：无。不发送也不获取任何数据。
- 钩子、MCP 服务器、智能体：无。
- 它不会修改任何文件或设置。它不是 Orbtile 本身：Orbtile 应用会自行设置它的 ZCode 钩子。

## 运行要求

macOS 或 Windows（Orbtile 应用支持的系统）。在 macOS 上使用 `sh`，在 Windows 上使用 PowerShell。在其他系统上，检查结果会说明 Orbtile 不支持该系统。

## 许可证

MIT。由 Orbtile Team 制作。不包含第三方代码或素材。
