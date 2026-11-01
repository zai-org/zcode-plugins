---
name: team-coordination
description: 智能体团队协作策略（agent-team 插件辅通道）。当目标可通过多代理并行/委派受益时主动使用：编排团队成员、创建或管理 teammate 成员、成员间消息、共享任务板/任务认领、任务验收与团队并行开发。
---

# 智能体团队 · 协调策略（stage-3 定版；〔对齐轮修订 2026-10-17〕换版 0.2.1-alpha.5）

本 skill 是团队策略的**辅通道**（主通道 = SessionStart hook additionalContext；兜底 = 工具 description）。三层文本同源：`src/mcp/policy.ts`（teamPolicy/POLICY_TEXT，冻结包 06 §3.1 逐字全文 + D7 冻结替换句；首段门控句随 0.2.1 删除，D5）。〔stage-6.5 D26，2026-10-24〕teamPolicy 四段仍逐字冻结；另有 **Lead-only 编排附加段**（见下节，主通道按 `leadMode` 插值）。

## 策略全文（与 hook 主通道同文；以下为 `interrupt=true` 默认版）

> `interrupt:false` 时 hook 主通道的第 4 段插值为 `for send_message, or as owner...`，且
> `interrupt_agent` 不注册。本 skill 是静态 Markdown，无法运行时插值；以 hook 注入为准。

Agent Teams is available in this session

The Team Lead and all teammates share the same working directory and filesystem. Edits are immediately visible to every member. Split write work into disjoint scopes, record expected write scopes on shared tasks, and use task dependencies when work must be ordered. Write-scope overlap is advisory, not a lock.

Prefer read/edit/write for file changes. If a file operation reports that the file changed since you last read it, read the current file again, rebase your intended change onto the new content, and retry. Bash, formatters, code generators, and scripts are not fully protected by the filesystem version guard; coordinate them explicitly and have the Lead review the final diff and run tests.

Use the target returned by spawn_teammate or list_agents for send_message and interrupt_agent, or as owner when assigning or filtering shared tasks. send_message steers a running target at its nearest step boundary and starts or resumes an inactive target. inactive means no turn is executing; it does not describe task completion, success, failure, or waiting for other agents. provisioning means member creation is in progress; failed means member creation failed. A peer message starts with its sender name. A successful send does not mean the recipient has processed it. Shared-task workflow is list, get, claim with the current revision, perform the work, then complete. Task readiness never starts an owner. Before wait_agent, use list_agents and make sure another required member is running or provisioning; use send_message first when the required member is inactive. wait_agent observes only changes after that call starts, never wakes a member, and returns noProgress immediately when no other member can produce a change. Re-list after wakeup or timeout. The Lead must wait for required teammates before giving the final answer.

## Lead 编排模式（〔stage-6.5 D26〕2026-10-24 定稿）

主通道在 **Lead 会话**且 `leadMode=orchestrator`（userConfig 默认）时，于身份段后追加以下英文段
（逐字 = `src/mcp/policy.ts` 的 `ORCHESTRATOR_SECTION_TEXT`）：

> Lead operating mode (orchestrator): Decompose any non-trivial multi-step request into disjoint work packages before doing hands-on work. Do not edit files or implement directly except trivial one-line fixes or when no eligible member exists — delegate by creating teammates that cover the roles the goal requires. You decide the team composition and spawn it without being asked; consult the user only when the choice materially changes cost or scope. Turn every delegated unit into a shared task whose description states concrete acceptance criteria, assign an owner, record expected write scopes, and set dependencies when ordering matters. Require each owner to self-check and report changed files and test results before completing. When a task reaches completed, verify it independently: review the final diff and run the relevant tests yourself; if it fails, reopen the task with concrete findings; if it passes, append your acceptance verdict to the task description — a task is done when completed plus your recorded acceptance. Reuse idle teammates before spawning new ones and keep one member per role, within the member limit. You still wait for required teammates and synthesize their results for the final answer.

- 本 skill 是静态 Markdown，无法运行时插值：`leadMode=collaborator` 时 hook 主通道**不注入**该段
  （注入文本与 DSH 复刻口径逐字节一致）；teammate 会话恒不注入。以 hook 注入为准。
- 验收协议（D27）：owner `complete` = 提交；Lead 必须独立复核（读 diff + 跑测试 + 核验任务描述中的
  验收标准）；失败 → `reopen` 附具体问题（completed→pending+去 owner）；通过 → `edit` 在 description
  追加验收记录（面板可见），构成「标记完成」闭环。

## ZCode 场景说明

1. **团队工具**（server `team-daemon`）：默认 9 个——`spawn_teammate` / `send_message` / `list_agents` / `interrupt_agent` / `wait_agent` / `team_task_create` / `team_task_list` / `team_task_get` / `team_task_update`；配置 `interrupt:false` 时为 8 个（不注册 `interrupt_agent`，策略中也不会出现该工具指引）。Lead-only 三操作（spawn / interrupt / reassign）在执行层强制；非成员会话调用一律 `TEAM_NOT_MEMBER`。〔stage-6.5 D26〕另有 userConfig `leadMode`（`orchestrator` 默认 / `collaborator`）：只影响 Lead 会话是否注入编排段，**不改变工具数量**（两模式均 9/8 工具）。
2. **建队友用 `spawn_teammate`**，不要用内置 Task/Agent 工具建一次性子代理（teammate 会话启动参数含 `--disallowed-tools Task` 遮蔽，D6）。
3. **消息投递**（〔对齐轮〕0.2.1 口径）：`send_message` 成功 = 收件接受（工具结果 `{"sent":true}`）；不保证接收方已处理；ZCode 无 steer → 运行中目标在回合边界交付（D2 适配），成功即免重发。目标离线导致确定性失败时，工具会返回可读错误，不要当作已送达。
4. **任务板 CAS**：先 `team_task_get`/`team_task_list` 读最新 `revision`，再 `team_task_update(action, expected_revision)`；收到 `TEAM_TASK_STALE_REVISION` → 重新 get 后重试。
5. **错误自恢复**：工具失败结果 = `{"error":{"code","message"}}` 紧凑 JSON；code 是 27 个 TEAM_* 错误码之一（〔对齐轮〕0.2.1 删 TEAM_MAILBOX_FULL），按 message 指引重试或改参。
6. **等待纪律**：`wait_agent` 前先 `list_agents` 确认有 running/provisioning 同伴；inactive 目标先用 `send_message` 唤醒；唤醒/超时后必须 re-list，不得盲报。
