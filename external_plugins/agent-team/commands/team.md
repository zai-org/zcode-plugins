---
description: 智能体团队 · 状态摘要与面板入口
allowed-tools: Bash
---

/team 命令（stage-5 T5.4）：输出团队状态文本摘要，并按运行环境给出对应载体的入口。
（`team_panel_call` 为 app 专用回环工具（visibility:["app"]），模型不可调；数据面走
`team-ctl state --json` 读盘重放，只读。）

## 执行步骤

1. **取会话 id**：用 Bash 执行 `printf '%s' "${ZCODE_SESSION_ID:-}"`。为空时（hook env 缺失）
   → 列出 `$HOME/.zcode/cli/plugins/data/agent-team*/teams/` 下最近修改的目录名作为 teamId；
   仍无法确定 → 直接输出 `Team 暂不可用`（en: `Team is unavailable`）并提示稍后重试。
2. **读团队视图**：用 Bash 执行（teamDir 中会话 id 无需转义——`sess_<uuid>` 字符集安全）：
   `node <team-ctl> state <teamDir> --json`
   - `<team-ctl>` = agent-team 插件安装目录下 `runtime/team-ctl.mjs`（plugins.dirs 直载 = 仓库根；
     市场安装 = `~/.zcode/cli/plugins/cache/**/agent-team*/runtime/team-ctl.mjs`，用 ls/glob 定位）；
   - `<teamDir>` = `$HOME/.zcode/cli/plugins/data/agent-team*/teams/<session_id>`（多副本时取
     与当前安装通道一致者；dev 兜底 = `$HOME/.zcode/agent-team-dev-data/teams/<session_id>`）；
   - state 失败/目录不存在 → 视为「尚无团队事件」：输出摘要 `成员 1（Lead）· 共享任务 0`。
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
   - **CLI 细节指引（恒附——桌面与 CLI 都输出）**：headless/TUI 会话可能不暴露运行环境，
     误判会漏掉终端用户必需的入口，因此摘要后一律附：
     `细节：node <team-ctl> state <teamDir>`；
     `成员会话：node <team-ctl> transcript <teamDir> <member>（按轮摘要：用户指令 + 动作组 + 每轮结论）`；
     `高保真（可选）：TEAM_COMPANION=1 的 daemon 在场时 node <team-ctl> open-panel；或
      node <team-ctl> widget <teamDir> --standalone --out /tmp/team-panel.html 后浏览器打开`。
   - **`<team-ctl>` 直接执行**：`runtime/team-ctl.mjs` 自带自执行入口（`node <runtime>/team-ctl.mjs …`
     可用）；`scripts/team-ctl.mjs` 薄启动器等价。两者任选，不要只导出不执行。
5. **刷新语义**（用户问「怎么刷新」时回答）：MCP Apps 面板 = 自动实时（订阅推送 ≤1s）；
   ::visualize 卡片 = 手动（重跑 /team 重渲染）；CLI 摘要 = 随轮次（每次 /team 即最新）。

## 纪律

- 本命令**只读**：不创建/修改/删除任务或成员（变更走对话中的团队工具面）。
- `<teamDir>` 不存在 = 尚无团队事件（隐式 Lead），按空团队摘要输出，不报错。
- 路径定位失败 → 降级为输出「团队状态不可读」+ `team-ctl state` 重试指引（不阻塞、不猜测路径）。
