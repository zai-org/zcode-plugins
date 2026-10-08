# git-worktree

面向并行 ZCode 会话的 git worktree 管理——类似 Claude Code 的 `/worktree` 体验：列出、创建、打开、移除和清理隔离工作副本，并针对两类经典事故（误删未提交的改动、两个 worktree 争抢同一分支）内置防护。

对应社区反馈 [zai-org/feedback#132](https://github.com/zai-org/feedback/issues/132) 与 [#220](https://github.com/zai-org/feedback/issues/220) 的体验缺口。

## 为什么需要

ZCode 目前没有内置的 worktree 切换器。想让两个会话同时处理同一个仓库（一人一个特性）的用户，要么在同一目录里互相覆盖，要么手敲 git 命令并撞上 `branch is already used by worktree` 这类难懂的错误。本插件把这套流程变为一等公民：

- **隔离**：每个会话拥有自己的 worktree（目录 + 分支），并行会话绝不会互相覆盖未提交的改动。
- **清晰**：`list` 用表格展示每个 worktree 的分支与脏状态；错误信息会翻译成下一步该做什么。
- **安全**：脏 worktree 未经明确确认绝不移除；主 worktree 与“仅删除已合并分支”的检查防止最容易丢工作的两条路径。

## 安装

设置 → 插件管理 → 发现 → 搜索 `git-worktree` → 安装。要求 `PATH` 上有 git 2.20 及以上。

## 用法

| 调用方式 | 作用 |
|---|---|
| `/git-worktree:worktree` | 默认行为：**创建**——为新会话准备一个隔离 worktree（基于默认分支自动命名、位于仓库同级目录）；输出 File → Open Folder 路径（当前会话仍留在原工作区） |
| `… create <名称> [基准]` | 同上，但显式指定 worktree/分支 `<名称>` 与基准（`origin/HEAD`，否则 `main`/`master`，否则 `HEAD`）；绝不占用默认分支 |
| `… list` | 表格列出所有 worktree：名称、分支、未提交文件数、路径；标注主 worktree |
| `… open <名称>` | 解析 worktree，并给出确切的 File → Open Folder 打开路径 |
| `… remove <名称>` | 拒绝移除主 worktree；先汇总未提交改动，`--force` 前必须明确确认；随后提供“仅已合并”的分支清理 |
| `… prune` | 先展示过期条目，再清理注册表；孤儿目录只报告路径与大小，绝不静默删除 |

附带的 `git-worktrees` 技能在用户问到 worktree 话题时自动触发，把同样的规则带进日常对话（“这个仓库能同时开三个会话吗？”）。

## 三种调用方式

1. **命令**——`/git-worktree:worktree`（无参数即以安全默认值创建；也可用 `list`、`create`、`open`、`remove`、`prune`）。确定性路径：固定流程，内置防护。
2. **提及**——在输入框中输入 `@Git-Worktree`，把附带技能挂载到你的消息上。用自然语言提问（“在隔离环境里修 export 的问题”），worktree 纪律——默认分支保护、脏状态检查、一会话一 worktree——就会作用于你所请求的内容。
3. **自动触发**——当对话涉及 worktree 或并行会话隔离时，技能也会自行加载，在你没想到要求时兜底。

## 副作用、权限与依赖

- 只运行本地 `git` 命令：`worktree add/remove/list/prune`、`status`、`diff --stat`、`branch -d/-D`。无其他二进制、无脚本、无 hooks、无 MCP 服务器。
- 会创建目录（默认位于仓库根目录同级）并删除 worktree 目录——每个破坏性步骤都先要求明确确认。
- 无网络访问、无凭据、数据不出本机。
- 跨平台：纯 git 调用，无特定 shell 语法；已在 Windows 与 POSIX 上验证路径处理。

## 版本与许可

`0.1.0`——manifest 与市场条目保持同步。Apache-2.0，与 [zcode-plugins](https://github.com/zai-org/zcode-plugins) 仓库许可证一致。无第三方代码或资产。
