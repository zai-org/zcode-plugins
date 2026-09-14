# ZCode Langfuse Observability

[English](README.md) · [简体中文](README.zh-CN.md)

面向 ZCode 的社区 Langfuse 观测插件，按每个完成的 ZCode turn 生成一条
Langfuse trace，目标是提交给 ZCode 官方插件市场。

> 当前版本：`0.2.3`。插件遵循 **fail-open**：缺少凭据、Hook 输入损坏、本地
> 状态错误或 Langfuse 请求失败，都不能阻塞 ZCode 会话。

## 采集范围

监听 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、
`PostToolUseFailure` 和 `Stop`。在 `Stop` 时发送：

- session ID；
- 用户 prompt 与最后一条 assistant 回复（可关闭）；
- 工具调用 Langfuse span（名称、输入、输出可分别关闭）；
- assistant generation；
- release、environment、turn ID 和工具数量元数据。

插件**不读取 transcript 文件，也不采集隐藏完整思维链**，只使用 ZCode
Hook stdin 传入的字段。

## 权限与副作用

六个事件都会以当前用户权限启动一个 `node` process Hook。Hook 从 stdin
读取一个 JSON 事件，并向 stdout 写入一个空 JSON 对象；不会启动 shell，也不会
执行用户命令。

Hook 会读取 `ZCODE_CONFIG_PATH` 指定的配置；未设置时读取
`~/.zcode/cli/config.json` 中保存的插件选项。它只会在
`ZCODE_PLUGIN_DATA` 或 ZCode 插件数据目录回退路径下写入有界、哈希化的 JSON
会话状态。`Stop` 时使用本地凭据向用户配置的 Langfuse HTTPS 接口发送请求。
不会读取 transcript 文件或隐藏推理内容。

## 配置

Manifest 中的 `userConfig` 会映射成以下环境变量，例如：

```text
ZCODE_USER_CONFIG_LANGFUSE_PUBLIC_KEY
ZCODE_USER_CONFIG_LANGFUSE_SECRET_KEY
ZCODE_USER_CONFIG_LANGFUSE_BASE_URL
```

同时支持标准变量：

```text
LANGFUSE_PUBLIC_KEY
LANGFUSE_SECRET_KEY
LANGFUSE_BASE_URL
LANGFUSE_USER_ID
LANGFUSE_ENVIRONMENT
LANGFUSE_RELEASE
LANGFUSE_ENABLED
LANGFUSE_CAPTURE_PROMPTS
LANGFUSE_CAPTURE_TOOL_INPUTS
LANGFUSE_CAPTURE_TOOL_OUTPUTS
LANGFUSE_MAX_CAPTURE_CHARS
LANGFUSE_DEBUG
```

`LANGFUSE_BASE_URL` 默认 `https://cloud.langfuse.com`；自建 Langfuse 请填写
HTTPS 地址，例如 `https://langfuse.example.com`。明文 HTTP 地址会被拒绝并回退到
默认 HTTPS 地址。

敏感 secret 不要写入仓库或 `hooks/hooks.json`。Hook 会根据运行时提供的
`ZCODE_PLUGIN_ID` 从 ZCode 的 `plugins.options` 读取本插件配置；这是因为当前
ZCode 不会把全部 `userConfig` 自动注入 process Hook 环境。标准
`LANGFUSE_*` 环境变量优先级更高，可覆盖保存的配置。

关闭内容采集：

```text
LANGFUSE_CAPTURE_PROMPTS=false
LANGFUSE_CAPTURE_TOOL_INPUTS=false
LANGFUSE_CAPTURE_TOOL_OUTPUTS=false
```

关闭后，内容不会写入 Langfuse，也不会写入本地会话状态；仍保留 session、
工具数量等结构化元数据。单字段默认最多采集 20000 个字符，可用
`LANGFUSE_MAX_CAPTURE_CHARS` 调整。

## 第三方软件

运行时使用 `langfuse` 3.38.20、`langfuse-core` 3.38.20 和 `mustache` 4.2.0，
均为 MIT 许可证。版本、来源和许可证见
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。Langfuse 是用户选择的外部服务，
仓库不会打包凭据。

## 在 ZCode 中本地测试

ZCode 选择本地目录时会按“插件市场”读取，因此仓库根目录包含
`marketplace.json`，其条目指向 `./dist/plugins/zcode-plugin-langfuse`。先运行
`npm run build`，再在 **设置 → 插件 → 添加插件市场 →
选择目录** 中选择本仓库，从“个人”市场安装并启用
`zcode-plugin-langfuse`。正式市场使用版本化 ZIP 和 SHA-256。

## 在线 ZCode 插件市场

从 Release 页下载 `zcode-plugin-langfuse-v<版本>.zip` 并解压，在 **设置 → 插件 → 添加插件市场 →
选择目录** 中选择解压后的插件目录安装。不要把全新检出的源码仓库直接添加为市场：
其中没有 `dist/` bundle（生成目录不入库），Hook 无法启动。开发安装请先在检出目录
运行 `npm install`（`prepare` 钩子会构建 `dist/`），再选择该目录。

- 市场清单：<https://raw.githubusercontent.com/erlinerd/zcode-plugin-langfuse/main/marketplace.json>
- 插件清单：<https://raw.githubusercontent.com/erlinerd/zcode-plugin-langfuse/main/.zcode-plugin/plugin.json>
- 最新 Release（资产：`zcode-plugin-langfuse-v<版本>.zip`）：<https://github.com/erlinerd/zcode-plugin-langfuse/releases/latest>
- Release 页面：<https://github.com/erlinerd/zcode-plugin-langfuse/releases/latest>
- ZCode 官方插件文档：<https://zcode.z.ai/en/docs/plugin>
- ZCode 官方插件市场：<https://github.com/zai-org/zcode-plugins>

本仓库市场名为 `zcode-plugin-langfuse`，`marketplace.json` 使用
`source: "."` 从仓库根目录解析插件。版本化发行文件由 GitHub Actions 的 tag
workflow 生成。

## 开发与构建

需要 Node.js 20+：

```bash
npm ci
npm run check
npm run package:plugin
```

`npm run build` 会把官方 `langfuse` JavaScript SDK 打包进本地 `dist/`。
`npm run build` 会构建完整的 `dist/` 输出：外层是插件市场壳，内层插件目录与
ZCode 官方模板（`zcode-plugins-official`）布局一致：

```text
dist/marketplace.json
dist/plugins/zcode-plugin-langfuse/
├── .zcode-plugin/plugin.json
├── .claude-plugin/plugin.json        （同内容副本，兼容 Claude）
├── hooks/hooks.json                  （指向 hooks/entry.mjs）
├── hooks/entry.mjs                   （密封运行时 bundle）
├── README.md
├── README_CN.md
├── LICENSE
└── THIRD_PARTY_NOTICES.md
```

`dist/plugins/zcode-plugin-langfuse/` 即可安装的插件：包含 `hooks/entry.mjs`
运行时、manifest、hooks、双语 README、许可证与第三方声明。Release
工作流负责把该目录压缩为版本化 ZIP；官方目录与本地目录安装直接使用该插件目录。
整个 `dist/` 均为生成目录，不入库。

目录分层：

- `src/domain/`：Hook 与 trace 数据类型、输入解析；
- `src/application/`：配置与 turn 状态机；
- `src/adapters/`：本地状态和 Langfuse SDK 适配器；
- `src/hooks/`：很薄的进程入口和 fail-open 策略。

更多设计约束见 [DESIGN.md](DESIGN.md)。

项目规范：

- [Agent 指令](AGENTS.md)
- [贡献指南](CONTRIBUTING.md)
- [行为准则](CODE_OF_CONDUCT.md)
- [安全策略](SECURITY.md)
- [发布清单](docs/releasing.md)
