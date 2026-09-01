# QVeris

[English](./README.md)

QVeris 通过一套精简的 MCP 工作流为 ZCode 接入外部 API 与实时数据：先发现能力、检查参数契约、按需校验参数和报价，再执行调用。

## 快速开始

1. 在 [QVeris 控制台](https://qveris.ai)创建 API Key。
2. 让 ZCode 桌面进程能够读取 `QVERIS_API_KEY`，然后彻底退出并重新打开 ZCode。
3. 在 ZCode 官方插件广场安装并启用 **QVeris**。
4. 打开 **设置 → MCP**，确认插件内置的 `qveris` 服务已连接。
5. 新建任务并提出需要实时或专业外部能力的请求，例如：“找一个天气能力并查询东京当前天气。”

请勿把 API Key 提交到仓库或粘贴进对话。ZCode 当前尚不能在插件界面中直接填写敏感插件配置，因此本插件从 ZCode 进程继承的环境变量中读取 `QVERIS_API_KEY`。

### 环境变量示例

macOS，在重新打开 ZCode 前执行：

```shell
launchctl setenv QVERIS_API_KEY "your-api-key"
```

Windows PowerShell，执行后注销系统或重启 ZCode：

```powershell
setx QVERIS_API_KEY "your-api-key"
```

Linux 请在桌面启动器使用的环境中定义 `QVERIS_API_KEY`，或从已经导出该变量的终端启动 ZCode。

## 插件内容

- 通过 `npx` 启动、固定为 `0.14.0` 版本的官方 `@qverisai/mcp` 包。
- 一份 QVeris Skill，引导 Agent 按 `discover` → `inspect` → `probe` → `call` 的顺序工作，并处理计费和外部副作用确认。

MCP 服务提供能力发现、详情检查、参数校验、执行调用、用量审计和积分流水查询工具。ZCode 会将它显示为插件内置 MCP 服务。

## 依赖与网络访问

- ZCode 必须能够使用 Node.js `18.2` 或更高版本以及 `npx`。
- 首次启动会从 npm Registry 下载 `@qverisai/mcp@0.14.0`，并在本机执行。
- MCP 包通过 HTTPS 连接 QVeris 服务。执行能力时，所需参数可能发送给被选中的第三方提供商。
- 必须拥有有效的 QVeris 账户和 API Key；部分 `call` 操作会消耗 QVeris 积分。

## 副作用与数据处理

`discover`、`inspect` 和 `probe` 只执行发现或校验。选中的 `call` 可能消耗积分，也可能产生发送消息、下单、修改远程记录等第三方副作用。如果用户当前请求尚未授权相应效果，插件附带的 Skill 会要求先确认。

本插件不包含 Hook，本身不会写入文件。只有在明确请求导出模式时，上游 MCP 包才可能在当前工作区的 `.qveris/exports/` 下写入 JSONL 文件。向外部能力发送机密或个人数据前，请先检查所选能力及提供商。

## 排障

- **Invalid session credential / 0 个工具**：确认 `QVERIS_API_KEY` 是真实密钥而非示例占位符，然后彻底重启 ZCode。
- **找不到 `npx`**：安装 Node.js `18.2+`，再重启 ZCode，让桌面进程读取新的 `PATH`。
- **服务启动超时**：确认能够访问 npm Registry 和 QVeris HTTPS 端点，再停用并重新启用插件。
- **密钥已轮换**：更新 `QVERIS_API_KEY`，并新建 ZCode 任务以重建 MCP 会话。

## 来源与许可证

本插件的市场文件采用当前仓库的 Apache-2.0 许可证。插件启动的官方 [`@qverisai/mcp`](https://www.npmjs.com/package/@qverisai/mcp) 包来自 [`QVerisAI/qveris-agent-toolkit`](https://github.com/QVerisAI/qveris-agent-toolkit)，采用 MIT 许可证。本插件不内置第三方二进制文件或任何凭据。
