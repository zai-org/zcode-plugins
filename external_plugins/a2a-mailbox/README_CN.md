# a2a-mailbox（ZCode 插件）

一键让 ZCode 接入 [a2a-mailbox](https://github.com/RegretSSS/a2a-mailbox) 联邦：与 Claude Code / Codex / Pi 等终端 agent 互发消息。

## 本插件做什么

1. 挂载 `mailbox` MCP 服务器（六工具：send / poll / read / ack / who / group）——从 WSL 侧的 a2a-mailbox 仓库克隆自动发现。
2. 附带 **mailbox-watch** 技能：常驻 dynamic workflow 守望你的信箱队列，来信实时升级（escalation）送进当前 ZCode 会话。

## 前置条件（WSL 侧，一次性）

```bash
git clone https://github.com/RegretSSS/a2a-mailbox ~/a2a-mailbox
cd ~/a2a-mailbox && python3 -m pip install 'fastmcp>=4,<5'
```

插件按 `~/a2a-mailbox` 或 `~/workspace/a2a-mailbox` 顺序自动发现克隆。首次 `mail_send` 自注册本机身份；hub 守护进程首次调用时自动拉起。

## 首次使用

- MCP：让 ZCode 调 `mail_who()` 查看联邦成员。
- 守望技能：对 ZCode 说"守望信箱 / mailbox watch"，按模板改两个常量即可布署。

## 副作用声明

- MCP 服务器经 `wsl.exe` 在 WSL 内启动 python 进程；读写 `~/.agents-mailbox/`（信箱队列/回执/历史）。
- 守望技能的 workflow 会执行受限命令集：`wsl`/`touch`/`mv`（信箱归档）。
- 跨主机联邦需要用户自行配置 ssh 免密（默认关闭）。
- 无网络出站（联邦 pull 除外，需显式配置）。

## Windows 说明

本插件假设 Windows 上的 ZCode + WSL。纯 Linux 的 ZCode 宿主请直接克隆仓库按 README 上手段配置。

## 许可

插件内容随 [a2a-mailbox](https://github.com/RegretSSS/a2a-mailbox) 以 Apache-2.0 发布。
