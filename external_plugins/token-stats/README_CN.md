# Token 统计

[English](README.md)

Token 统计在 ZCode 输入框旁显示当前会话的生成速度和已实测的输出 Token 合计。

## 使用方式

1. 安装并启用 **Token 统计**，在 ZCode 桌面端打开本地会话，等待模型生成回复。
2. 将鼠标悬停在输入框工具栏的指标上，查看模型、速度、最近输出、首 Token 用时、输出合计和上下文输入。点击指标可在侧栏查看明细快照。
3. 执行 `/show-token-stats`，或让 Agent 调用 `show_token_stats`，即可在消息流插入一张统计快照。

## 统计口径

ZCode 上报流式估算时，工具栏实时刷新速度。宿主上报最终指标后，工具栏显示实测速率。输出合计最多覆盖该会话最近 20 次有实测数据的模型请求。宿主提供实测输入用量时，插件显示上下文输入。具体数值取决于模型供应商和 ZCode 提供的数据。

## 运行依赖与数据

| 项目 | 行为 |
| --- | --- |
| 客户端 | 支持扩展 API 1.4 的 ZCode 桌面端。本地工作区可用。 |
| 模型或 API | 使用会话现有供应商的指标。扩展无需独立凭据，也不发起模型调用。执行斜杠命令时，会话中的 Agent 会调用只读工具。 |
| 网络 | 插件通过本地宿主 API 和标准输入输出与 ZCode 通信。 |
| 代码执行 | ZCode 加载扩展，并启动本地 Node.js 24 MCP 服务。插件无 Hook 或额外扩展授权。 |
| 本地存储 | 在插件数据目录中按会话保存请求 ID、模型 ID、Token 数值和时序指标。服务读取当前会话的快照。保存的指标范围仅包含上述字段。 |

插件采用 Apache-2.0。安装包包含 [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk)、[MCP Apps SDK](https://github.com/modelcontextprotocol/ext-apps)、[Zod](https://github.com/colinhacks/zod) 及其运行时依赖。相关许可证随 `dist/THIRD_PARTY_NOTICES.txt` 分发。
