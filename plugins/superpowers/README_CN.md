# superpowers

[English](./README.md)

面向 ZCode 的全面且经过实战检验的技能库：头脑风暴、测试驱动开发、系统化调试、计划编写与执行、代码评审、子代理驱动开发 —— 基于 [obra/superpowers](https://github.com/obra/superpowers) v7.0.0 打包。

## 它做什么

1. **在每次会话启动时注入技能引导。** 一个 `SessionStart` 钩子会把 `using-superpowers` 技能注入模型上下文，并以强约束的方式告知模型：*只要某个技能可能适用 —— 哪怕只有 1% 的可能 —— 就必须先调用它再行动。* 正是这个引导让整个技能库真正生效，而不是磁盘上的静态文件。
2. **安装 15 个按上下文自动触发的工作流技能。** 技能通过其 `name` + `description` 元数据被发现，并使用 ZCode 原生的 `Skill` 工具以 `superpowers:<名称>` 的形式调用（例如 `superpowers:brainstorming`）。你也可以在输入框的技能选择器中手动调用。

典型效果：在全新会话中发送 *"Let's make a react todo list"*，会先触发 `superpowers:brainstorming` 打磨设计，然后才动手写代码；发送 *"fix this bug"*，会先触发 `superpowers:systematic-debugging`，而不是直接打补丁。

## 技能列表

| 技能 | 用途 |
| --- | --- |
| `brainstorming` | 在动手实现之前，把粗糙的想法打磨成经过验证的设计 |
| `test-driven-development` | RED / GREEN / REFACTOR 纪律：没有失败的测试就不写生产代码 |
| `systematic-debugging` | 用四阶段框架定位根因，而不是修补表象 |
| `writing-plans` | 把验证过的设计转化为包含精确文件改动的实施计划 |
| `executing-plans` | 按任务逐项执行书面计划，每个任务都有验证环节 |
| `subagent-driven-development` | 通过"实现者/评审者"子代理对逐任务执行计划 |
| `dispatching-parallel-agents` | 并行分发相互独立的子代理工作并汇总结果 |
| `requesting-code-review` | 把干净、可评审的变更集交给代码评审者 |
| `receiving-code-review` | 以技术判断回应评审意见，而不是盲目服从 |
| `verification-before-completion` | 只有拿到证据（跑过测试、展示输出）才能声称"完成" |
| `finishing-a-development-branch` | 验证通过后决定合并 / 提 PR / 清理 |
| `using-git-worktrees` | 用隔离的 worktree 支持并行任务和高风险实验 |
| `writing-skills` | 以可测试的纪律创建或修改技能（本库自身的维护方式） |
| `using-superpowers` | 元技能：如何发现并使用技能（会话启动时注入） |
| `diagnosing-superpowers` | 诊断技能未触发或工作流失效的会话 |

## 目录结构

```text
superpowers/
├── .zcode-plugin/plugin.json          # 插件清单
├── skills/<name>/SKILL.md             # 15 个技能，含参考文档、提示词和辅助脚本
├── hooks/hooks.json                   # SessionStart 注册（自动发现，无需在清单中声明）
├── hooks/session-start.mjs            # 引导注入器（Node，零依赖）
├── LICENSE                            # MIT（上游 + 打包）
├── README.md / README_CN.md
```

## 钩子：SessionStart 引导

| 事件 | 匹配器 | 作用 |
| --- | --- | --- |
| `SessionStart` | `startup\|clear\|compact` | 运行 `hooks/session-start.mjs`：读取 `skills/using-superpowers/SKILL.md`，去除 frontmatter，通过 `hookSpecificOutput.additionalContext` 注入模型上下文。 |

副作用说明：

- 该钩子**只读取插件目录内的一个文件**；不写入任何内容、不发起网络请求、不收集任何数据。
- 需要 `PATH` 上有 `node`（任意较新版本；脚本只使用 Node 内置模块）。若技能文件不可读，钩子会干净地退出，会话继续，只是没有引导内容。
- ZCode 在会话启动时会对钩子配置做快照：安装或启用插件后，请**新建会话**以加载引导。
- 手动冒烟测试：

  ```shell
  printf '%s\n' '{"hook_event_name":"SessionStart","session_id":"manual","source":"startup"}' \
    | node hooks/session-start.mjs
  ```

  标准输出必须是以 `hookSpecificOutput.hookEventName = "SessionStart"` 开头的单个 JSON 对象；诊断信息只输出到 stderr。

部分技能在 `skills/*/scripts/` 下带有小型辅助脚本，仅在对应技能的工作流需要时运行（通过解释器调用，例如 `bash scripts/start-server.sh` 或 `node ./render-graphs.js`）；它们只作用于当前工作区。

## 安装

1. 在 ZCode 中打开插件管理（**设置 → 插件管理 → 发现**），找到 **superpowers** 并安装，默认启用。
2. **新建会话**。
3. 冒烟验证：询问 *"What are your superpowers?"* —— 模型应当能描述自己的技能。
4. 实际试用：在全新会话中发送 *"Let's make a react todo list"* —— 模型应当在写任何代码之前先调用 `superpowers:brainstorming`。

## 来源与许可

- 全部技能内容逐字取自 [obra/superpowers](https://github.com/obra/superpowers) **v7.0.0**（commit `bb92a77`），MIT 许可证 © Jesse Vincent。见 [LICENSE](./LICENSE)。
- 本打包所做的 ZCode 适配：`.zcode-plugin` 清单、Node 版 `SessionStart` 钩子、`skills/using-superpowers/references/zcode-tools.md`（ZCode 工具映射）、`using-superpowers/SKILL.md` "Platform Adaptation" 列表中的一行指针，以及 README/LICENSE 文件。其余内容与上游完全一致，便于后续同步上游新版本。
