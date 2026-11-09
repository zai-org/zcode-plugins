# maptec-maps

[English](./README.md)

为 ZCode 接入 **Maptec MCP**，支持地点与周边搜索、地理编码、路线规划、距离矩阵、轨迹绑路与 IP 定位。插件注册远程 HTTP MCP 服务，并提供 `maptec-maps` 技能，便于 Agent 发现工具并按 Maptec 规范调用。

上游仓库：[maptec-api/agent-plugins](https://github.com/maptec-api/agent-plugins)。

## 安全与副作用

启用本插件即允许 Agent 通过 HTTPS 访问 Maptec 托管的 MCP 服务；你发起的地图相关请求（地点、地址、路线、IP 等）会发送到 Maptec。

- **网络**：向 `https://mcp.maptec.com/mcp` 发起 HTTPS 请求（Streamable HTTP MCP）。
- **凭据**：需要 Maptec 应用 API Key，在插件设置中配置 `maptec_api_key`（ZCode 将该字段视为非敏感项）；勿在对话或仓库中明文保存密钥。
- **Authorization**：请求头使用**原始 API Key**，不要自行添加 `Bearer` 前缀（除非 Maptec 文档另有要求）。
- **本地执行**：不包含 Hook 或本地 stdio MCP，仅包含远程 MCP 声明与技能文件。
- **计费与配额**：按 Maptec 账户与产品条款计费。

在 [Maptec 控制台](https://lbs.maptec.com/console/) 创建 API Key。

## 安装

1. 在 ZCode **设置 → 插件** 中，从官方市场安装 **maptec-maps**（收录后可用）。
2. 启用插件。
3. 在插件详情 **高级信息 → 配置** 中保存 **Maptec API Key**。也可单独配置已鉴权的 Maptec MCP，并依赖技能完成工具选择。

## 验证

1. 在 **设置 → MCP** 中确认出现 Maptec 的 **Plugin MCP 服务器** 且连接成功。
2. 在工作区提问：「搜索新加坡坐标 1.2868,103.8545 周围 1000 米内的咖啡馆。」
3. 确认 Agent 调用 Maptec 工具返回结果，且未要求在对话中粘贴 API Key。

## 组件

| 组件 | 作用 |
| --- | --- |
| 技能 `maptec-maps` | Maptec MCP 工具选择、参数与结果解读指引 |
| MCP `maptec` | 远程 HTTP Maptec MCP，`Authorization` 携带 API Key |

## 文档

- [Maptec MCP 介绍](https://lbs.maptec.com/docs/en-US/mcp/introduction)
- [Maptec MCP 接入说明](https://lbs.maptec.com/docs/en-US/mcp/overview)

## 许可证

MIT — 见 [LICENSE](./LICENSE)。
