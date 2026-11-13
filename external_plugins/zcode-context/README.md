<div align="center">

# 🧠 zcode-context · 上下文洞察 (Context Insight)

**A context-usage insight dashboard for [ZCode](https://zcode.ai) — inspired by [dsh-context](https://github.com/bowenliang123/dsh-context) for DeepSeek Harness.**

[![Version](https://img.shields.io/badge/version-0.2.0-blue)](#安装)
[![License](https://img.shields.io/badge/license-Apache%202.0-green)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#)
[![ZCode](https://img.shields.io/badge/ZCode-Plugin-orange)](https://github.com/zai-org/zcode-plugins)
[![GitHub Stars](https://img.shields.io/github/stars/AwenJackson/zcode-context?style=social)](https://github.com/AwenJackson/zcode-context/stargazers)

*ZCode 上下文洞察仪表盘 · Token 统计 / 费用估算 / 缓存命中率 / 上下文浏览器 / Agent 编队 · 纯本地数据，无需其他插件，无需系统 Node.js*

</div>

---

## ✨ 功能特性 / Features

### 📊 洞察总览 / Overview
- 六张 KPI 卡：全部会话 · Token 消耗 · 预估费用 · 缓存命中率 · 工具调用（含命令执行成功/失败数）· 活跃时长
- 近 7 天 Token + 费用双柱图、近 8 周活跃热力图（Token / 会话双指标切换）
- 工具调用 Top、命令执行 Top、项目分布排行 —— **点击排行行可筛选相关会话卡**
- 全局悬浮摘要（tooltip）：环形图分段、柱状图、热力图、排行行均有口径说明

### 🗂 会话列表 / Sessions
- 按 Token 总量 / 最近更新 / 当前上下文占比排序，按工作区过滤、标题搜索
- 每张卡：迷你环形上下文占用环（压力色）、轮次、Token、费用、最近消息摘要

### 🔬 单会话上下文 / Per-session Context
- 上下文统计头卡（轮次 / 步骤 / 工具调用 / 回复块 / Token / 费用），可点击跳转
- 当前上下文构成条（系统提示词 / 工具定义 / 用户消息 / 助手回复 / 思考 / 工具结果 + 斜纹压缩预留段）
- **上下文趋势**：总计 / 增量 × 步进 / 轮次四种组合；悬停显示逐步摘要，点击固定 RequestDetail（第 T 轮·第 S 步 / 输入输出 / 缓存命中率 / Δ增量）
- 事件日志（消息 / 工具 / 压缩 / 错误筛选胶囊，行点击展开全文）；文件活动（读写改筛选 + 路径搜索 + 行展开明细）
- **上下文浏览器**：七分组可折叠，系统提示词展开快照前 400 字、工具定义展开工具名清单
- 费用构成环形图（按内置牌价逐类估算，悬停显示估算口径）

### 🤖 Agent 编队 / Formation
- 主/子 Agent 树、Token/费用/请求统计、上下文占用压力条（≥70% 琥珀、≥90% 红）
- **点击子 Agent 节点直接打开该子会话详情**；悬停点亮父链

### ⚡ 数据层
- 数据全部来自本机 ZCode SQLite（`model_usage` / `session` / `part` / `message` / `prompt_snapshot`），**只读、零网络请求、不上报**
- 无需其他插件；**无需系统 `node` 命令**（使用 Electron 内置 Node 运行时）
- 磁盘缓存 + 后台刷新 + 启动预取，打开即出数据

## 📦 安装 / Install

**方式一：本地插件市场**
1. Clone 本仓库到任意目录，例如 `D:\plugins\zcode-context`
2. ZCode → 插件市场 → 添加 → 添加插件市场，填入该目录
3. 安装 **上下文洞察 (zcode-context)**，**完全退出并重开 ZCode**（含托盘进程）
4. 左侧边栏底部出现「上下文洞察」入口

**方式二：从 GitHub 安装（待官方市场收录后可用）**
```
# ZCode 插件市场 → 添加 → GitHub 仓库
https://github.com/AwenJackson/zcode-context
```

> 安装/更新后需要重启 ZCode：插件通过 `app.asar` 注入侧边栏入口与面板（带完整性校验与自动备份，可用 `/remove-panel` 一键卸载）。

## 🔍 数据口径 / Data semantics
- 缓存命中率 = cacheRead / (input + cacheRead + cacheWrite)（与 dsh-context 对齐）
- 耗时分解：模型等待 = Σ首字延迟(ttft)；思考/回复按 reasoning/output token 占比从生成时长拆分；工具执行 ≈ 请求间隙（≤10 分钟）；其他 = 活跃时长 − 上述
- 上下文构成 token 为字符数启发式估算（÷3.5），界面明确标注「估算」
- 费用：内置牌价表（DeepSeek / GLM / 豆包系列）× USD→CNY 7.2，未收录模型用保守默认价

## 🧰 故障排查 / Troubleshooting
- 状态文件：`~/.zcode/zcode-context/runtime/status.json`，日志：`inject.log`
- 重启后无入口：确认 status 为 `injected`；app.asar 被占用时安装钩子会排定收尾进程自动重试
- 仪表盘提示数据库不存在：确认 `~/.zcode/cli/db/db.sqlite` 存在

## 🏷 关键词 / Keywords
`zcode` · `zcode-plugin` · `context-window` · `token-usage` · `token-statistics` · `cost-estimation` · `llm-observability` · `dashboard` · `context-insight` · `agent-monitoring` · `dsh-context` · `deepseek` · `glm` · `sqlite` · `electron`

## 📄 License
[Apache License 2.0](./LICENSE) · 灵感与交互设计参考 [dsh-context](https://github.com/bowenliang123/dsh-context)（感谢 [@bowenliang123](https://github.com/bowenliang123)）
