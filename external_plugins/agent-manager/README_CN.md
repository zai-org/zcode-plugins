# 智能体管家 (Agent Manager)

一个 ZCode 插件,用于**管理子智能体**:盘点、创建、修改、校验智能体定义文件——并把一个任务**并行派发**给多个智能体,汇总成一份报告。

[English](./README.md)

## 功能一览

| 组件 | 名称 | 作用 |
|---|---|---|
| 技能 | `agent-registry` | 智能体定义管家:盘点、查看、新建、修改、校验、下架智能体定义(用户级 `~/.zcode/agents/` 与工作区级 `<工作区>/.zcode/agents/`)。校验只报告问题,绝不擅自改文件。 |
| 技能 | `agent-team` | 多智能体调度:拆解任务 → 按职责选人 → 独立子任务同消息并行派发 → 汇总合并报告。 |
| 命令 | `/agent-list` `/agent-show` `/agent-new` `/agent-check` `/agent-team` | 盘点 / 查看 / 新建 / 校验 / 派发的快捷入口。 |
| 内置智能体 | `doc-writer` `test-runner` `issue-triage` | 装即用的三个模板:文档整理、测试执行与失败分析、问题分诊排序。 |
| 钩子 | SessionStart | 每次新会话开始时自动输出本地智能体的精简盘点清单。 |

## 安装

1. 打开 ZCode 的 **Plugin Marketplace → Add → Add Plugin Marketplace**。
2. 输入本仓库:`sworddemon85-create/agent-manager-market`(若从官方市场安装则直接搜索)。
3. 找到「智能体管家 Agent Manager」→ **Install**,然后重启 ZCode。

## 试一试

- `/agent-list` —— 列出全部智能体,标出跨作用域重名
- 「新建一个叫 doc-writer 的智能体,负责整理项目文档」—— 走创建流程,生成规范定义
- `/agent-team 审查 src 目录的代码并总结问题` —— 并行派发审查智能体,返回合并报告

## 行为与副作用(披露)

- **文件写入**:新建/修改流程会在 `~/.zcode/agents/` 或 `<工作区>/.zcode/agents/` 下写 Markdown 定义文件;盘点与校验均为只读。
- **命令执行**:SessionStart 钩子运行内置只读脚本(`scripts/inventory.sh`)扫描两级定义目录;派发流程通过 ZCode 的 Agent 工具调用子智能体。
- **钩子**:仅 `SessionStart`;输出作为会话上下文注入,且始终以 0 退出,不会阻塞启动。
- **网络**:插件本身不发起网络请求;内置 `issue-triage` 智能体在你要求核实外部资料时可能使用 WebFetch。
- **无 MCP server、无凭据、无遥测。**
- **Windows 提示**:钩子依赖 PATH 中的 `bash`(Git Bash 即可)。

## 定义格式

每个智能体是一个 Markdown 文件:YAML frontmatter + 正文提示词。

```markdown
---
name: "crawl"
description: "一句话职责,主会话据此决定派不派它"
color: yellow
injectAgentsMd: true
tools: Read, Bash
---

正文 = 该智能体的系统提示词(人设、职责、约束、输出要求)。
```

## 许可证

[MIT](./LICENSE)
