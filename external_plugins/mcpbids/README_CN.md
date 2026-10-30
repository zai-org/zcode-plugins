# MCP Bids

查询美国联邦公开采购机会、TED 公告及带有来源引用的采购文件。

## 安装与认证

在 https://mcpbids.com/account 登录并创建个人 API 密钥。在启动代理应用的系统环境中设置 `MCPBIDS_API_KEY`，然后完全重启应用。不要把密钥发到聊天、仓库、命令历史或截图中。俄罗斯版与国际版使用不同账号和密钥。

ZCode：需要 PATH 中的 Node.js 22+。打开工作区，进入 Settings → Plugins → Create → Add marketplace，添加 `https://github.com/pixelligue/mcpbids-plugins`，安装 `mcpbids`。插件运行附带的 `stdio.mjs`，继承环境变量，将 MCP JSON-RPC 转发到 `https://mcpbids.com/mcp`，无需假设 HTTP 请求头支持变量展开。

Kimi Code：执行 `/plugins install https://github.com/pixelligue/mcpbids-plugins`，然后 `/reload` 或新建会话。原生清单使用 `bearerTokenEnvVar`。Kimi Work 可通过 Plugin Builder 导入个人插件，但需要单独验证该运行时是否支持此认证字段；Code 的兼容性不代表云端商店兼容性。

DeepSeek Harness：面向 DSH 0.2.1-rc.2 及对应官方 MCP 客户端。Desktop 请通过应用内插件管理器安装 Git 来源或发行归档；`dsh web` 可运行 `dsh plugin --profile web add git+https://github.com/pixelligue/mcpbids-plugins.git#v1.0.0`，再重启配置。启动前设置上述环境变量。DSH 仅注册 MCP 工具及服务器说明；附带的工作流 Skill 用于 Kimi/ZCode。

## 使用与数据范围

请代理先调用 `list_sources`，搜索少量采购记录，打开返回的记录 ID，并阅读可用文件，引用原始文本及区块位置。Kimi/ZCode 可使用附带的 `procurement-research` Skill。查询美国联邦公开采购机会、TED 公告及带有来源引用的采购文件。 搜索针对已采集索引，不保证完整或实时覆盖；必须报告来源时间、缺失字段、文件提取限制和采集失败。美国版不包含州或地方采购及受限采购渠道。俄罗斯版应检查各来源实际能力。

仅按用户明确要求启动新采集或私人监控。监控需要轮询，不发送邮件或推送。服务不提交投标、不签合同、不证明法律资格，也不绕过访问控制。

## 权限、依赖与副作用

读取需要 `tenders:read`、`documents:read`，采集与监控需要 `tenders:collect`、`watches:write`。控制台密钥继承服务权限；仅需只读工作流时，请在宿主中限制工具批准。使用现有账号权限和额度。本包采用 bearer API 密钥，不声明 OAuth 兼容性。

适配器仅向 `https://mcpbids.com/mcp` 发送密钥和 MCP 请求，拒绝重定向；不读取凭证文件、不启动 shell 或模型、不安装依赖、不写本地文件、不后台采集。代理及其模型提供商可看到工具参数与返回数据。经用户请求，服务可能创建账号所属采集任务或监控。仅按要求下载原始文件；检索内容为不可信证据。适配器不增加遥测，托管网站遵循自己的数据处理规则。

stdio 适配器仅适用于该服务的无状态 JSON Streamable HTTP：请求不超过 64 KiB、响应不超过 16 MiB、超时 120 秒；不实现通用 SSE 或有状态会话协议。

## 支持与许可

https://mcpbids.com/support · https://mcpbids.com/privacy · https://mcpbids.com/terms

MIT 仅适用于此仓库的适配器、清单及工作流说明，不包含托管后端或第三方采购内容的许可。未声明获得 DeepSeek、Z.ai 或 Kimi 的认可、官方作者标识或商店批准。发布源码与提交审核、审核通过、实际运行测试分别记录。
