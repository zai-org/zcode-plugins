---
description: 智能体团队 · 状态摘要与面板入口
allowed-tools: Bash
---

/team 命令（stage-5 T5.4）：输出团队状态文本摘要，并按运行环境给出对应载体的入口。
（`team_panel_call` 为 app 专用回环工具（visibility:["app"]），模型不可调。）

**两种用法（2026-11-02 起）**：
- `/team`（无参数）= **只读**状态摘要与面板入口。
- `/team <任务描述>`（带参数）= **直接用团队执行该任务，不输出状态摘要**（见步骤 6）。
  用户输入 `/team` 后跟内容时，意图就是「用团队做这件事」——不要只读状态后自行代劳。

## 执行步骤

1. **读团队数据（主通道 = MCP 工具，不要猜目录）**：
   分别调用 `list_agents`（空参数）与 `team_task_list`（空参数；需全量时加 `limit: 100`）。
   这两个工具的团队身份由宿主 `_meta.session_id` 解析，**与会话环境变量无关**，因此是唯一
   可靠的取数通道。
   - 若任一工具返回 `TEAM_NOT_MEMBER`/报错 → 直接输出 `Team 暂不可用`（en: `Team is unavailable`），
     不要尝试用 Bash 猜目录。
   - **带参 `/team <任务>` 时**：读数据仅用于内部判断（是否需要建队、成员是否已存在），
     **不输出状态摘要**（步骤 3 跳过），直接执行步骤 6。
2. **定位 teamDir（仅用于渲染 CLI 指引，失败可省略该段）**：
   优先用当前 hook/daemon 环境里的 `TEAM_PLUGIN_DATA`（`printf '%s' "${TEAM_PLUGIN_DATA:-}"`）；
   取到则 `<teamDir> = <TEAM_PLUGIN_DATA>/teams/<session_id>`。
   **禁止**用「最近修改的 `agent-team*/teams/` 目录」当兜底——多副本并存时会跨数据根捞到
   别的插件的团队（2026-11-02 实测事故：/team 显示了另一个会话的成员，Lead 据此空转）。
   取不到 `TEAM_PLUGIN_DATA` → 省略「CLI 细节」段，仅输出摘要与面板入口。
3. **输出文本摘要**（**仅无参 `/team` 时输出**；带参 `/team <任务>` 跳过此步直接执行步骤 6）：
   - JSON 的 `failure` 非空 → 首行 `团队持久记录无效：<failure>`（en: `Invalid persisted Team record: <failure>`），随后照常列最后有效状态；
   - 正常 → 首行 `成员 N · 共享任务 T`；成员逐行 `- <name> — <role/phase>`（lead/active/provisioning/failed）；
     任务逐行 `- <id> <subject> — <待处理|进行中|已完成>（Owner: <ownerName|未分配>）`；
     空任务板 → `暂无共享任务，可以通过对话创建`。
   - en 环境用英文词典值（Members/Shared tasks/Pending/In progress/Completed/Owner/Unowned）。
4. **按运行环境追加载体指引**（**仅无参 `/team` 时输出**；带参 `/team <任务>` 跳过此步）：
   - **桌面（ZCode Desktop 会话）**：提示「打开面板：会话右侧『+』→『查看所有插件』→『个人』→『智能体团队』→『打开』；宿主『新标签页』里含『智能体团队』入口时可直接从『新标签页』打开
     （自动实时：订阅推送 ≤1s，无需刷新）」；spawn_teammate 工具已携带 `_meta.ui.surface` 定向打开提示；
   - **桌面内容引用（用户要求可视化卡片时）**：用 Bash 执行
     `node <team-ctl> widget <teamDir> --out <会话可视化目录>/team-widget.html --theme <light|dark> --lang <zh|en>`，
     然后在回复中单独一行输出内容引用（手动刷新 = 重跑 /team）：
     ::visualize{"path":"<--out 的绝对路径>","title":"智能体团队"}
   - **CLI 细节指引（仅在步骤 2 拿到 `TEAM_PLUGIN_DATA` 时输出）**：headless/TUI 会话可能不暴露运行环境，
     误判会漏掉终端用户必需的入口，因此摘要后附：
     `细节：node <team-ctl> state <teamDir>`；
     `成员会话：node <team-ctl> transcript <teamDir> <member>（按轮摘要：用户指令 + 动作组 + 每轮结论）`；
     `高保真（可选）：TEAM_COMPANION=1 的 daemon 在场时 node <team-ctl> open-panel；或
      node <team-ctl> widget <teamDir> --standalone --out /tmp/team-panel.html 后浏览器打开`。
   - **`<team-ctl>` 直接执行**：`runtime/team-ctl.mjs` 自带自执行入口（`node <runtime>/team-ctl.mjs …`
     可用）；`scripts/team-ctl.mjs` 薄启动器等价。两者任选，不要只导出不执行。
5. **刷新语义**（用户问「怎么刷新」时回答）：MCP Apps 面板 = 自动实时（订阅推送 ≤1s）；
   ::visualize 卡片 = 手动（重跑 /team 重渲染）；CLI 摘要 = 随轮次（每次 /team 即最新）。
   **带参 `/team <任务>` 时**：跳过步骤 3–5，直接执行步骤 6。
6. **带参数时的团队执行（`/team <任务描述>`）**——**直接建队执行，不输出状态摘要**：
   1. 先判断该任务是否值得分工：需要多角色 / 可并行 / 写域互不相交 → 建队；
      **用户已经用 `/team <任务>` 明确表达「用团队做」的意图，这就是委派信号本身**，
      不要再以「任务简单」为由自行代劳；只有确实单角色即可完成（如一句话问答）时，
      才用一行说明「这个任务不需要分工」并直接给出结果。
      **不要输出「成员 N · 共享任务 T」等状态摘要**——用户要的是团队干活，不是看状态。
   2. 先用 `team_task_create` 为每个委派单元建共享任务，写清验收标准；
      文件改动填 `write_scopes`，先后依赖填 `blocked_by`。初始 prompt、角色说明或产出文件
      都不能替代任务板记录。
   3. 建队：`spawn_teammate` 创建所需成员（名字体现角色，`description` 写职责）；
      `prompt` 提供完整背景、任务 ID，要求先 get 最新 revision、确认 ready 再 claim，
      然后执行、自检、complete，并通过 `send_message` 向 lead 交付结果。
      复用已有成员时发送相同的任务指引；被依赖阻塞的成员汇报阻塞后结束本轮，
      依赖完成后 Lead 再发消息唤醒（任务就绪不会自动唤醒成员）。
   4. 用 `wait_agent` 收取成员消息，包括成员已 inactive 时的待收结果；先处理返回的
      `messages`，再通过 `list_agents` / `team_task_list` 核对状态。没有消息且无可推进的
      成员时会立即返回 noProgress；仅在确实还需执行或补充结果时才发后续消息。
   5. 收齐产出后由 Lead 独立核验；通过则在任务 description 记录验收结论，失败则
      reopen 并附具体问题，再通知成员返工。最后汇总答复；用消息和任务板交付纯文本结果，
      不为绕过收件箱而额外创建中转文件。
   6. **`spawn_teammate` 失败时（套餐模型不可继承）**：不要静默改自干——
      用一行说明「当前 Lead 模型为官方套餐，队友无法继承，本次由我直接完成」，
      然后自己完成，并提示用户可切换到自配第三方模型后再用团队。
   7. **`spawn_teammate` 返回 `creation:"pending"` 或失败时（其他原因，如 provisioning/RPC 超时）**：
      - pending = 原成员已登记、仍在 provisioning，**不是可执行成员**：用 `list_agents` / `wait_agent`
        观察同一成员；不要重复 spawn 或换名重建。若诊断显示自动确认已停止，明确告诉用户需要接管，
        且旧 turn 可能仍在执行，不要自动重复启动首轮。
      - 明确失败时用一行说明原因及接管方式，再由 Lead 决定直接完成或等待用户指示；
        不因 RPC 超时断言「宿主未创建」。

## 纪律

- **无参数时严格只读**：`/team` 不创建/修改/删除任务或成员。
- **带参数时必须真的建队执行**（步骤 6）：只输出状态、然后把活自己干，是本命令明令禁止
  的行为（2026-11-02 用户实测体感问题：连输两次 `/team <任务>` 都没建队）。
- 成员/任务数据**只来自 MCP 工具**（`list_agents` / `team_task_list`）；Bash 侧只用于渲染
  可选的 CLI 指引，绝不用于推断团队内容。
- **不得跨副本猜目录**：禁止用「`agent-team*/teams/` 最近修改目录」等 glob 兜底。多副本并存
  （dev 直载 + 市场副本）时该兜底会读到别的插件的团队，导致 Lead 依据错误成员列表行动
  （2026-11-02 实测事故）。拿不到 `TEAM_PLUGIN_DATA` 就省略 CLI 段。
- `<teamDir>` 不存在 = 尚无团队事件（隐式 Lead），按空团队摘要输出，不报错。
- 路径定位失败 → 省略 CLI 细节段，仅输出摘要与面板入口（不阻塞、不猜测路径）。
