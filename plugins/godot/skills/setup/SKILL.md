---
name: setup
description: Locate or install the official native Godot editor and verify its built-in CLI before creating, opening or editing a game project.
---

# Godot 环境准备

Godot 桌面编辑器自带 CLI。本插件使用官方可执行文件，不需要 MCP、uv、Python 服务或项目 addon。先完成环境检查，再按 [cli](../cli/SKILL.md) 开发。

1. 检查用户指定的 GODOT_PATH 或 `godot --version`、`godot4 --version`。macOS 可检查 `/Applications/Godot.app/Contents/MacOS/Godot` 和 `~/Applications/Godot.app/Contents/MacOS/Godot`；Windows 检查用户安装/解压位置中的 Godot 可执行文件；Linux 检查 PATH 和 `~/.local/bin/godot`。记录实际绝对路径与版本，含空格的路径必须引用。
2. 优先复用匹配工程版本的 Godot 4.x；不能静默升级或迁移现有工程。C# 工程需要匹配的 .NET 版 Godot 与 SDK，标准版不支持 C#。
3. 缺失时说明将安装的依赖，在任务授权范围内使用现有包管理器或 https://godotengine.org/download/ 官方发行版。macOS 有 Homebrew 时可用 `brew install --cask godot`；其他平台选匹配系统与架构的官方原生发行包，核对官方 SHA256 后解压至用户目录。不覆盖已有安装，不绕过系统安全限制。安装后执行 `--version` 和 `--help`，不能只凭下载成功声称可用。
4. 确认项目目录包含 `project.godot`。新项目创建独立目录并忽略 `.godot/`，不覆盖已有配置。可见编辑器需要本机桌面；远程无图形环境只能运行后台命令，明确说明无法展示窗口。

从旧插件迁移时，不再启动旧 MCP 连接。已有工程的 `addons/godot_mcp`、autoload 和插件设置不自动删除；先确认来源与依赖，保留用户改动。禁用或移除旧 addon 属于单独的工程迁移，不是打开工程的前置条件。

迁移识别：只读检查 `project.godot` 的 `[editor_plugins] enabled` 是否包含 `res://addons/godot_mcp/plugin.cfg`，以及 `.godot/zcode-mcp.json` 是否存在，不输出其中 token。仍启用的旧 addon 会尝试连接已停用的 bridge；这类连接错误来自旧集成，不应作为游戏缺陷修复。用户授权迁移后，先保存/备份工程，在编辑器中禁用该 addon，再确认没有其他客户端依赖它，才能移除对应启用项、addon 与相关 autoload。不要顺带删除其他插件设置。

旧凭据位于 `.godot/zcode-mcp.json`，旧 connection、日志与 Python 环境位于 `~/.zcode/plugin-data/godot-native/` 或原 `ZCODE_GODOT_DATA_DIR`。清理前核对目录归属、项目关联和正在使用它的进程；仅在用户授权清理且无其他客户端使用后移除确认属于该项目的数据。共享 Python 环境必须确认所有旧客户端均不再依赖后才可删除。不自动清空整个数据根目录。

功能兼容性以已安装版本为准：已验证 Godot 4.7.2；执行 `--import`、`--check-only`、导出等命令前先核对本版 `--help`。缺少参数时解释限制并选择该版本支持的交互流程，不能为了参数自动升级工程。
