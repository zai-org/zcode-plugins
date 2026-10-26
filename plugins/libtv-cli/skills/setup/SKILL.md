---
name: setup
description: Install or check LibTV CLI and authenticate the intended account before working with canvases, nodes, models, and generation.
---

# 设置 LibTV CLI

业务技能来自 LibTV 厂商发布的 CLI 技能包 `1.2.0`；来源和归档校验见插件根目录 `upstream.json`，不是第三方重写手册。先检查 `command -v libtv`、`libtv --version`、`libtv --help`。

需要安装时读取 [官方安装说明](../libtv-cli/scripts/install.md)并检查随包安装脚本。macOS/Linux 可在官方技能目录执行 `LIBTV_CLI_VERSION=1.2.0 PROFILE=/dev/null bash scripts/install-libtv-cli.sh`，固定本包对应版本且不自动修改 shell profile；按实际安装路径调用二进制。Windows 使用随包 PowerShell 指引，先说明脚本会写用户 PATH。只在用户授权本机安装/更新的范围内执行。

不要运行手册中的整目录删除/替换技能流程来更新本插件缓存；插件由市场版本管理，升级另行打包。版本不同先检查当前 CLI 帮助。

读取 [登录](../libtv-cli/commands/login.md)和[账号](../libtv-cli/commands/account.md)说明。优先 `libtv account list` 检查现有认证及激活账号；未登录时在可见交互终端运行 `libtv login web --open`，由用户完成浏览器授权。不读取凭证文件，不把短信验证码或 Cookie 放入聊天。

`account info` 会校准本机活跃账户作用域，`account use` 会切换个人/团队账号；仅按用户指定目标执行。核对工作区与画布：workspace 是容器，project 才是画布。优先显式 `--project`，不为查询而随意运行 `workspace use` 或 `project use` 改目录绑定。排障时运行 `libtv status` 可一次性查看登录态、活跃账户/团队和当前目录绑定的工作区/画布/分组；它只读且不发网络请求。

完成时分别说明 CLI 版本、认证、个人/团队范围以及画布访问是否验证；未登录不创建画布，不运行付费生成任务。
