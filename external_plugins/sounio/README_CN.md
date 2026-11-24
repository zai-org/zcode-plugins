# Sounio

[English](./README.md)

使用本地项目中已有的编译器检查 Sounio `.sio` 源文件，并明确区分源码检查、编译、运行、CI 和科学验证。

## 前提条件

- 已在 ZCode 中安装并启用此插件。
- Sounio 仓库内有 `bin/souc`，或 `PATH` 中已有 `souc` 命令。
- 当前项目中可以访问要检查的 `.sio` 文件。

## 使用方法

在 Sounio 项目中执行 `/sounio:check-sio path/to/file.sio`。该命令先读取项目指令并确认文件存在，再让 ZCode 通过项目包装器或 `PATH` 中已有的编译器执行 `souc check`。它报告退出状态和诊断信息，不会把检查成功称为程序已编译或已运行。

处理 Sounio 源码或编译器诊断时，也可以使用 `sounio-development` Skill。它强调遵循项目自身的指令并准确描述证据范围。

## 权限与副作用

本插件只包含提示文件：没有可执行脚本、Hook、MCP 服务、附带的编译器或凭据要求。检查命令会请 ZCode 对指定文件运行本地编译器；执行前请审阅该 Shell 操作。插件本身不安装软件、不向网络服务发送数据，也不修改项目文件。所选编译器或包装器可能创建或更新临时文件及项目内的生成产物。特别是 Sounio 的 `bin/souc` 启动时可能在仓库中生成 `bin/madaros-linux-x86_64` 和 `bin/.madaros-linux-x86_64.verified`。

插件文本为原创，采用 Apache-2.0 许可。Sounio 是独立的 Apache-2.0 项目，地址为 [Sounio-lang/sounio](https://github.com/Sounio-lang/sounio)。
