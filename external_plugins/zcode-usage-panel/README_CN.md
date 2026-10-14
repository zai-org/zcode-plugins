# zcode-usage-panel

[English](./README.md)

ZCode MCP App 插件：在会话右侧边栏常驻「用量面板」，实时展示当前会话的用量明细。

## 功能

- **顶部汇总**：总 tokens（输入/输出/缓存拆分）、模型调用次数、工具调用次数、平均/当前 TPS、正在运行的工具
- **TPS 曲线**：最近 40 次模型调用的生成段 TPS（`output / (duration − TTFT)`）sparkline，含均值虚线
- **提示词构成**（v0.2.0）：扫描系统提示词的组成——AGENTS.md 指令（用户全局+项目级）、记忆项目、技能清单（用户级/插件/App 内置三源；每组与每条 SKILL.md 同时给出「清单常驻估算」与「全文字符」两口径）、MCP server 声明与本会话实际调用过的 MCP、子代理定义；若会话的 model-io JSONL 头部尚未被滚动丢弃，还会展示真实注入记录（各模块字符量 + 工具清单）
- **下拉明细**（可折叠区块，展开状态跨重开记忆）：
  - 工具明细：内置 / MCP（按 server 分组）/ Skill（具体 skill 名），列含次数、次数/耗时占比、总/平均耗时、输出量（工具输出字节数）、错误数
  - 模型明细：按 model × agent × 来源（主对话/子代理/压缩…）的 token 细分、占比、平均 TPS
  - 最近轮次
- **子会话并入**（v0.2.0）：子代理（parent_id 挂靠）的模型调用与工具调用全部计入会话统计，模型明细以"来源"区分
- **会话切换**：默认跟随最新交互会话（自动模式），可固定最近 20 个会话之一
- **动态更新**：`resources/subscribe` 订阅推送（约 1s），无订阅能力回退 2s 轮询

## 环境要求

- 支持 MCP App（会话侧栏面板）的 ZCode Desktop
- `PATH` 上有 **Node.js ≥ 24**（server 使用内置 `node:sqlite` 模块，零原生依赖）

## 安装

从 ZCode 官方插件市场安装 **zcode-usage-panel**，在**有活跃会话**的任务里通过右侧边栏"+"菜单打开。

## 权限与副作用

- **只读访问 `~/.zcode/cli/db/db.sqlite`**（ZCode 本地用量库，`mode=ro` 打开），绝不写入该文件或任何其他文件。
- **无网络访问**、无命令执行、无 Hook、无第三方服务。
- 面板页面与 server 均为自包含 bundle，运行时零 npm 依赖；构建期依赖（esbuild、TypeScript、MCP SDK）不进入安装包。
- 除开源构建工具链外（见 `package.json`，均为 MIT/Apache-2.0 许可），不捆绑第三方代码、素材或服务。

## 已知边界

- 面板需活跃会话才出现在边栏"+"菜单（宿主 `availability: "session"` 行为）。
- db.sqlite 是 ZCode 内部 schema（0.16.x 验证），版本升级后查询可能失效——面板会显示降级错误而非白屏。
- HTML resource 宿主上限 4 MiB（当前产物约 610KB）。

## 开发

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # 产物输出到 payload/dist/（server.mjs + index.html）
npm run smoke       # 用真实 server bundle 跑完整 MCP JSON-RPC 链路
```

`npm run smoke` 支持 `SERVER_PATH` / `NODE_BIN` 环境变量指定其他产物与运行时（发布验证用系统 Node 跑 payload 下的 bundle 时使用）。

## 许可证

[MIT](./LICENSE)
