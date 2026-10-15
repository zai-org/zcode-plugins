# Grok Bot Dispatch for ZCode（zcode-grokbot-dispatch，Grok Bot 双向派活）

> 插件 id：`zcode-grokbot-dispatch`（由预发布 id `zcode-dispatch` 更名）。运行时路径不变（`~/.config/zcode-dispatch/`、`~/.local/state/zcode-dispatch/`、`ZCODE_DISPATCH_*` 环境变量），原配置继续可用；如装过旧的 `zcode-dispatch`，请先卸载再安装 `zcode-grokbot-dispatch`。


ZCode 桌面版与 DSH（DeepSeek Harness）/ Grok Bot 之间的双向派活插件：按 `[Project: X]` 路由、会话↔job 持久映射、任务完成后自动回报结果（默认 HTTP 直连，Yobiru 可选）。

## 组件
- **命令**：`/dispatch-dsh <项目> <任务>`、`/dispatch-grok <项目> <任务>`、`/dispatch-status <id>`
- **MCP 服务**（stdio，`node mcp/server.mjs`）：工具 `dispatch_to_dsh`、`dispatch_to_grokbot`、`dispatch_status`
- **Hooks**：`UserPromptSubmit`（记录会话↔job 映射）、`Stop`（把派活会话的结果回报给派活方）

## 安装
1. ZCode → 设置 → Plugins → `zcode-plugins-official` → 安装 **zcode-grokbot-dispatch**。
2. 需要 PATH 中有 Node.js ≥ 22.5；`/dispatch-dsh` 还需要 `dsh` CLI（可用 `DSH_BIN` 指定）。
3. 在 `~/.config/zcode-dispatch/config.json` 或环境变量中配置对端（环境变量优先），例如：
   ```json
   { "transport": "direct", "peers": { "dsh": { "url": "http://<对端主机>:<端口>", "keyFile": "~/.config/zcode-dispatch/dsh.key" } } }
   ```
   相关环境变量：`ZCODE_DISPATCH_CONFIG`、`ZCODE_DISPATCH_TRANSPORT`（direct|yobiru）、`ZCODE_DISPATCH_GROK_PEER`、`ZCODE_DISPATCH_PROJECTS_ROOT`（默认 `~/Projects`）、`ZCODE_DISPATCH_DISCOVERY=0`（关闭 Tailscale 发现）、`DSH_BIN`、`DSH_PROFILE`。
   插件不内置任何 endpoint，未配置对端时不会对外发送任何内容。

## 副作用与隐私
- **网络**：`Stop` hook 与派活工具会把任务文本及会话最终结果（最多约 3000 字符）发送给**你自己配置的**对端——默认走 HTTP（用你的 key 文件鉴权）；`transport` 设为 `yobiru` 时通过 `yobiru` CLI（`yobiru send <peer> ...`）发送。非派活产生的会话不会回报。
- **执行命令**：`dsh --profile headless --json <任务>`（`/dispatch-dsh`）、`yobiru`（仅 yobiru 模式）、`tailscale status`（可选的对端发现，`ZCODE_DISPATCH_DISCOVERY=0` 关闭）。
- **写入文件**：job/会话映射与回报记录写在 `~/.local/state/zcode-dispatch/`（及插件数据目录），权限 0600/0700；读取 `~/.config/zcode-dispatch/` 下的配置和 key。
- **Hooks**：每次 `UserPromptSubmit` 与 `Stop` 触发（超时 10s/20s）；非派活会话直接静默退出。
- 无遥测；除你配置的对端/Yobiru 外不访问任何第三方服务。

## 第三方代码
无，仅使用 Node.js 内置模块。

## 许可证
MIT © semantic-craft —— 源码：https://github.com/semantic-craft/zcode-dispatch
