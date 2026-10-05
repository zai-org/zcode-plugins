# Atlassian Jira

通过 [Atlassian 官方远程 MCP 服务器](https://developer.atlassian.com/change-log/blog/2025/07/01/mcp-server-beta/)（Rovo 的一部分）把 ZCode 接入 **Atlassian Cloud** 上的 **Jira** 与 **Confluence**。无需本地服务进程，也不用手动管理 API Token：插件只声明托管端点，首次使用时由 ZCode 在浏览器中完成 OAuth 2.1 登录授权。

## 提供什么

- **MCP 服务器 `atlassian`** — Atlassian 托管端点，提供按 JQL 检索 Issue、读取、创建、编辑、流转、评论 Issue，以及操作 Confluence 页面等工具。
- **技能 `jira`** — 为 Agent 提供的 Jira 工作流指引：构造明确的 JQL、创建前确认项目与 Issue 类型、按 workflow 发现可用流转，以及 Sprint 汇总。

## 目录结构

```
atlassian-jira/
├── .zcode-plugin/
│   └── plugin.json          # 插件清单
├── skills/
│   └── jira/
│       └── SKILL.md         # Jira 工作流指引
├── .mcp.json                # MCP 服务器声明（远程 HTTP）
├── README.md
└── README_CN.md
```

## 使用前提

- 一个启用了 Jira 的 **Atlassian Cloud** 站点。远程 MCP 服务器无法访问自建的 **Jira Server / Data Center**；这类部署请改用 Jira REST API 工具。
- 用户在被查询的站点上需拥有 Jira 许可证。

## MCP 服务器

| 名称 | 类型 | 端点 | 认证 |
| --- | --- | --- | --- |
| `atlassian` | `http`（远程） | `https://mcp.atlassian.com/v1/mcp` | 首次使用时浏览器完成 OAuth 2.1 |

## 快速开始

1. 在 ZCode 插件市场安装本插件。
2. 打开新会话。首次使用时，ZCode 会打开浏览器登录 Atlassian 并授权站点。
3. 试一试这样的提示词：“搜索分配给我的未关闭 Jira Issue，并按状态汇总。”

## 隐私与安全

- **网络访问**：唯一的网络依赖是 Atlassian 托管的 MCP 端点（`mcp.atlassian.com`）。Issue 数据在 ZCode 与 Atlassian 之间传输；插件本身不运行任何本地代码。
- **凭证**：插件不存储任何凭证。OAuth Token 由 ZCode 客户端与 Atlassian 授权服务器处理。
- **第三方服务**：Atlassian Remote MCP Server 由 Atlassian 运营，受[其服务条款](https://www.atlassian.com/legal/customer-agreement)约束。插件仅声明其公开端点，未包含任何封装代码。

## 常见问题

- **401 / 未认证**：打开 ZCode → Settings → MCP 查看 `atlassian` 服务器状态；重启会话以重试 OAuth 授权。
- **连接超时**：Atlassian Cloud 有时响应较慢；可在 `.mcp.json` 中调大 `timeoutMs`。
- **结果为空或没有站点**：确认该站点已在 Atlassian 管理设置中允许 AI/MCP 访问，且用户在该站点拥有 Jira 许可证。
- **端点变更**：如 Atlassian 调整路径，请更新 `.mcp.json` 中的 `url`；当前端点见 Atlassian Remote MCP Server 官方文档。

## 许可证

本插件遵循本仓库的 [Apache-2.0 许可证](../../LICENSE)。
