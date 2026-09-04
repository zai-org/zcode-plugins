# zcode-remotion

[English](./README.md)

在 ZCode 中直接创建并校验 Remotion 程序化视频。插件继续以 Remotion 官方 Agent Skills 作为领域知识来源，只补上可靠性层：官方技能引导安装、环境预检、任务路由、自主代表性静帧视觉 QA、最终 MP4 校验，以及可追溯的兼容性基线。

**一句提示 → Remotion 官方技能 → 视觉 QA → 校验过的 MP4。**

源项目：https://github.com/AIwork4me/zcode-remotion

## 安装

在 ZCode 中打开 **设置 → 插件**，在官方插件市场搜索 **zcode-remotion**（显示名：**Remotion for ZCode**），安装并启用即可。

要求：

- Node.js 18 或更高版本（推荐 20/22/24）
- 首次下载包、技能和浏览器组件时需要网络访问
- 用于创建 Remotion 项目和输出文件的可写目录

插件本身不需要 API Key、账号、MCP Server、Hook 或后台服务。

## 快速开始

直接描述你要的视频，例如：

```text
帮我做一个 10 秒的 AI 编程助手产品宣传视频，16:9，现代科技感，并交付最终 MP4。
```

插件自带的 `remotion` 技能会：

1. 检查 Remotion 官方 Agent Skills 是否已完整安装；
2. 如缺失或不完整，调用官方安装器在原作用域内安装 / 修复；
3. 检查 Node 和当前项目的包管理器环境；
4. 把任务路由到对应的 Remotion 官方技能；
5. 先渲染代表性静帧，并自主检查客观视觉问题；
6. 在全量渲染前先修复明显问题；
7. 完成渲染后校验 MP4，再向用户报告成功。

插件的 Commands 列表还提供 **remotion-setup**、**remotion-doctor** 和 **remotion-update** 三条维护工作流。

## 插件补上的可靠性能力

| 能力 | 行为 |
| --- | --- |
| 官方技能引导安装 | 调用官方 `remotion-dev/skills` 安装器，不在插件中复制官方技能 |
| 技能完整性检查 | 按预期技能集合检查磁盘；局部安装会在同一作用域内修复 |
| 环境预检 | 检查 Node、包管理器、Remotion 项目状态和渲染前提 |
| 任务路由 | 将创建、组件编写、字幕、地图、Studio、渲染、多媒体、升级、文档、SaaS、交互等请求路由到对应官方技能 |
| 自主视觉 QA | 全量渲染前先生成代表性静帧并由 Agent 检查；仅在主观选择、品牌歧义或低置信度时询问用户 |
| 产物校验 | 确认 MP4 存在且非空；若有 `ffprobe`，进一步检查时长和分辨率 |
| 兼容性感知 | 随插件携带 Remotion、官方技能和 Mediabunny 的机器可读验证基线 |

## 当前验证基线

Marketplace 包中的 `compatibility/remotion.json` 记录：

- Remotion `4.0.520`
- Remotion 官方 Agent Skills `4.0.520` — 共 12 个
- Mediabunny `1.55.5`

这是**最近一次真实验证通过的基线**，并不意味着更新版本不兼容。doctor / update 工作流会明确区分：当前安装版本、上游最新版本、以及插件记录的验证基线。

## 网络访问与副作用

启用插件本身只会注册 Markdown 技能和命令。真正执行工作流时，Agent 会根据任务在本机运行命令，并可能访问网络。

### 网络访问

根据任务不同，可能访问：

- npm registry，通过 `npm` / `npx` 或当前项目的包管理器；
- GitHub，主要用于从 `remotion-dev/skills` 获取 Remotion 官方 Agent Skills；
- Remotion 官方文档 / Release 页面，用于版本与升级信息；
- Remotion 的浏览器下载地址，在渲染需要 Chrome Headless Shell 时下载组件。

### 本地命令

典型命令包括：

- `node` / `npx`；
- 当前项目使用的包管理器（`npm`、`pnpm`、`yarn` 或 `bun`）；
- Remotion 官方 CLI，例如 `remotion studio`、`remotion still`、`remotion render`、`remotion versions`、`remotion upgrade`、`remotion browser ensure`；
- 官方 `skills` 安装器；
- 可选的 `ffprobe`，用于最终媒体元数据校验。

### 文件写入

工作流可能写入：

- 用户指定项目目录里的 Remotion 源码和依赖；
- 项目中的静帧与 MP4 输出；
- 用户作用域的官方 Remotion 技能（`~/.zcode/skills/` / `~/.agents/skills/`），或按用户明确要求写入项目作用域 `.zcode/skills/`。

插件**不会**安装 Hook、注册 MCP Server、索要凭据，也不会在上述已说明路径之外静默写入长期数据。

## Remotion 官方技能与许可证

本插件**不重新分发** Remotion 官方 Agent Skills，而是调用官方安装器，让用户机器直接从官方来源获取。

- 本集成层使用 MIT License，见 `LICENSE`。
- Remotion 官方 Agent Skills 与 Remotion 软件继续遵循 Remotion 自己的许可证条款，见 `NOTICE.md` 和 https://www.remotion.pro。

## 引导安装后的技能发现

插件自带的 skill 和 commands 在启用插件时自动注册。通过官方安装器外部安装的 Remotion Skills 属于独立技能文件；新建或更新后，请打开 **设置 → 技能**，点击 **刷新**，确认技能已列出并启用。只有刷新后仍未出现时，再新建会话。

## 来源与打包说明

本 Marketplace 包基于 `AIwork4me/zcode-remotion` v0.2.5。源仓中的 CI、demo、验证报告、测试、Release 工具和上游漂移自动化属于维护侧资产，不进入用户安装包。具体差异见 `UPSTREAM.md`。
