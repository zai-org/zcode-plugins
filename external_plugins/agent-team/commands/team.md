---
description: 智能体团队 · 状态摘要与面板入口
allowed-tools: Bash
---

/team 命令（stage-5 T5.4）：输出团队状态文本摘要，并按运行环境给出对应载体的入口。
（`team_panel_call` 为 app 专用回环工具（visibility:["app"]），模型不可调。）

**两种用法（2026-11-02 起）**：
- `/team`（无参数）= **只读**状态摘要与面板入口。
- `/team <任务描述>`（带参数）= 先输出状态摘要，**然后用团队真的执行该任务**（见步骤 6）。
  用户输入 `/team` 后跟内容时，意图就是「用团队做这件事」——不要只读状态后自行代劳。

## 执行步骤

1. **读团队数据（主通道 = MCP 工具，不要猜目录）**：
   分别调用 `list_agents`（空参数）与 `team_task_list`（空参数；需全量时加 `limit: 100`）。
   这两个工具的团队身份由宿主 `_meta.session_id` 解析，**与会话环境变量无关**，因此是唯一
   可靠的取数通道。
   - 若任一工具返回 `TEAM_NOT_MEMBER`/报错 → 直接输出 `Team 暂不可用`（en: `Team is unavailable`），
     不要尝试用 Bash 猜目录。
2. **定位 teamDir（仅用于渲染 CLI 指引，失败可省略该段）**：
   优先用当前 hook/daemon 环境里的 `TEAM_PLUGIN_DATA`（`printf '%s' "${TEAM_PLUGIN_DATA:-}"`）；
   取到则 `<teamDir> = <TEAM_PLUGIN_DATA>/teams/<session_id>`。
   **禁止**用「最近修改的 `agent-team*/teams/` 目录」当兜底——多副本并存时会跨数据根捞到
   别的插件的团队（2026-11-02 实测事故：/team 显示了另一个会话的成员，Lead 据此空转）。
   取不到 `TEAM_PLUGIN_DATA` → 省略「CLI 细节」段，仅输出摘要与面板入口。
3. **输出文本摘要**（所有场景都输出；文案与面板词典逐字一致）：
   - JSON 的 `failure` 非空 → 首行 `团队持久记录无效：<failure>`（en: `Invalid persisted Team record: <failure>`），随后照常列最后有效状态；
   - 正常 → 首行 `成员 N · 共享任务 T`；成员逐行 `- <name> — <role/phase>`（lead/active/provisioning/failed）；
     任务逐行 `- <id> <subject> — <待处理|进行中|已完成>（Owner: <ownerName|未分配>）`；
     空任务板 → `暂无共享任务，可以通过对话创建`。
   - en 环境用英文词典值（Members/Shared tasks/Pending/In progress/Completed/Owner/Unowned）。
4. **按运行环境追加载体指引**（三档刷新语义，D4 口径）：
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
6. **带参数时的团队执行（`/team <任务描述>`）**——只在前 5 步状态摘要输出后执行：
   1. 先判断该任务是否值得分工：需要多角色 / 可并行 / 写域互不相交 → 建队；
      **用户已经用 `/team <任务>` 明确表达「用团队做」的意图，这就是委派信号本身**，
      不要再以「任务简单」为由自行代劳；只有确实单角色即可完成（如一句话问答）时，
      才用一行说明「这个任务不需要分工」并直接给出结果。
   2. 建队：`spawn_teammate` 2–3 个成员（名字体现角色，`description` 写清职责，
      `prompt` 必须是自洽完整的初始任务——成员是独立进程，看不到本会话历史）。
   3. 需要协作流水线时用 `team_task_create` 建任务（写 `write_scopes` 划清写域、
      用 `blocked_by` 表达顺序），再 `send_message` 告知成员认领；**不要**只建任务不通知
      （任务就绪不会自动唤醒成员）。
   4. 用 `list_agents` 确认成员在 running/provisioning 后再 `wait_agent`；
      收到进展后重新 `list_agents` 再决定是否继续等。
   5. 收齐成员产出后由 Lead 汇总成最终答复；成员自由文本不会自动推给 Lead，
      需要时用 `send_message` 追问或读成员会话。
   6. **`spawn_teammate` 失败时（套餐模型不可继承）**：不要静默改自干——
      用一行说明「当前 Lead 模型为官方套餐，队友无法继承，本次由我直接完成」，
      然后自己完成，并提示用户可切换到自配第三方模型后再用团队。

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
