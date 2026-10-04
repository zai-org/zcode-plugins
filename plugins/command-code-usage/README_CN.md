# Command Code 额度面板（command-code-usage）

[English](./README.md)

在对话里直接看 Command Code 套餐用量——5 小时滚动窗口、每周滚动窗口、月度额度或余额，以及各自的重置时间；不用离开终端，也不用打开账单页面。

## 快速开始

在 ZCode 插件管理器里安装 **Command Code 额度面板**，然后直接敲命令，或者干脆用一句话问：

> 我这个 5 小时窗口还剩多少？什么时候重置？

## 组件

| 命令 | 作用 |
| --- | --- |
| `/command-code-usage:quota` | 面板：5 小时窗口、每周窗口、月度额度或余额、重置时间、剩余次数估算，以及某个窗口消耗快于重置速度时的预警 |
| `/command-code-usage:usage` | 同一个面板——别名，两个名字都能用 |

两者接受同样的可选参数：`/command-code-usage:quota --compact`、`--md`、`--json`、`--html`、`--verbose`，或 `--demo hot`（内置样例数据，不联网）。完整参数以 `--help` 为准。

| 技能 | 作用 |
| --- | --- |
| `command-code-usage` | 读取额度，回答关于窗口、重置时间、额度和消耗速度的问题 |

## 运行要求

| | |
| --- | --- |
| 宿主 | ZCode |
| 运行时 | Node.js 18 或更高——脚本只用内置 `fetch`，不安装任何依赖 |
| 套餐 | 需要 Command Code 套餐，且密钥有权调用用量接口。若账号没有 API 访问权限，这些接口会返回 `403`/`407`，面板会直接说明原因，而不是编一个数字出来。 |

## 数据来源与认证

只访问一个主机：**`https://api.commandcode.ai`**（HTTPS）。读取的接口是
`/alpha/whoami`、`/alpha/billing/credits`、`/alpha/billing/subscriptions`、
`/alpha/usage/summary`，以及 `/provider/v1/models`。最后一个不携带任何凭证，只用来判断当前模型是否走 Command Code。

`/alpha/` 下的接口不属于 Command Code 文档化的 provider API。之所以读它们，是因为套餐窗口数据在这些接口上；一旦接口结构变化，面板会报出失败原因，而不是拿旧数据估一个值。`--demo` 不发起任何请求。

密钥按只读方式发现，命中即止：

1. 环境变量 `COMMANDCODE_API_KEY`，其次 `COMMAND_CODE_API_KEY`，再次 `CMD_API_KEY`
2. `~/.commandcode/auth.json`
3. 其他 agent 工具留下的 provider 配置——`~/.zcode/v2/provider_config.json`、`~/.claude/settings.json`、`~/.dsh/settings.yaml`、`~/.dsh/.credentials.yaml`、`~/.codex/config.toml`、`~/.grok/config.toml`

密钥只发往 `api.commandcode.ai`，不发往别处；不会被复制到新位置，不会回显到输出里，也不会写进日志。

## 在你机器上做什么

| | |
| --- | --- |
| Hook | 无——不安装任何 hook，不拦截你的工具调用 |
| MCP server | 无——没有 `.mcp.json`，不启动任何服务进程 |
| 网络 | 只有 `api.commandcode.ai` 一个主机，且只在渲染面板时访问；`--demo` 不发起请求 |
| 执行命令 | 以你传入的参数执行 `node <插件目录>/scripts/cc-usage.mjs`。命令先按安装路径找该脚本，找不到时在 `~/.zcode`、`~/.claude`、`~/.codex`、`~/.grok`、`~/.dsh` 下搜索 `command-code*` 或 `commandcode*` 路径中的同名脚本。除此之外不执行任何东西。 |
| 读取 | 上面列出的凭证文件；另外，当宿主传入会话 transcript 路径时，只读该文件**最后 128 KB**，且仅取最近记录的 `message.model` / `modelId` 字段用于判断当前模型。消息内容既不落盘也不外发。 |
| 写入文件 | `~/.commandcode-usage/last-report.json`（最近一次快照）、`~/.commandcode-usage/models.json`（模型名缓存）。只有显式传 `--html` 时才在你指定的路径生成 HTML 报告。 |
| 失败时的行为 | 密钥缺失、套餐无 API 访问权限、响应无法解析，这三种情况都会给出指明原因的消息，不会编造数值。 |

## 第三方代码、素材与服务

未内联任何第三方代码或素材；命令、技能与脚本都是本项目自有代码。唯一的外部服务是 Command Code 自家的 API，其条款与可用性由 Command Code 决定。MIT 许可——见仓库根目录的 `LICENSE`。
