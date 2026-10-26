---
name: setup
description: Locate or install the official Blender application and verify its bundled command-line executable before Blender work.
---

# Blender 环境准备

Blender 应用自带 `blender` CLI，不需要安装另一套 CLI。本插件仅提供操作指引，不包含 Blender、MCP 或桥接服务。

1. 先检查 `blender --version`。找不到时检查常见位置：macOS 的 `/Applications/Blender.app/Contents/MacOS/Blender` 和 `~/Applications/Blender.app/Contents/MacOS/Blender`；Windows 的 `C:\Program Files\Blender Foundation\Blender <版本>\blender.exe`；Linux 的 PATH 或用户指定的解压目录。记录可用二进制的绝对路径，含空格时引用路径。
2. 未安装时，报告检测结果、展示安装命令并说明需要下载和安装桌面应用。仅在用户已明确要求安装或明确同意“缺少时安装 Blender”时执行；普通建模请求不等于安装授权。已有明确授权无需重复询问；没有授权时先询问并等待答复，不自行安装或继续建模。安装官方发行版的常见方式：macOS 有 Homebrew 时使用 `brew install --cask blender`，Windows 有 winget 时使用 `winget install --id BlenderFoundation.Blender --exact`；Linux 使用系统包管理器或从 https://www.blender.org/download/ 获取匹配平台的发行包。遵守宿主权限要求，不擅自提权或替换已有可用版本。安装失败时报告原因，不声称可用。
3. 再运行 `blender --version` 和 `blender --help` 确认实际路径、版本与参数。首次调用 Python 可用 `blender --background --factory-startup --python-exit-code 1 --python-expr "import bpy; print(bpy.app.version_string)"` 验证。

建模需要本机可见桌面。无图形环境时说明限制，不把后台执行描述为用户看得到的窗口。准备完成后按 [cli Skill](../cli/SKILL.md) 工作；无需为了环境检查做耗时渲染。
