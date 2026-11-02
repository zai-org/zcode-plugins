# 智能体团队（Agent Teams）

[English](./README.md)

把「Lead + 多个 teammate」的协作方式带进 ZCode：Lead 在会话里创建队友、共享任务板、收发消息，并用 MCP Apps 面板实时看到团队状态。

- 适用：需要并行拆活、希望把实现/审查/测试分给不同成员，或想把一段多步工作交给可复用的成员协作。
- 角色：Lead = 当前会话（你正在对话的 agent）；teammate = 插件创建的独立子会话，与 Lead 共享同一工作目录。
- 载体：桌面 = 「智能体团队」MCP Apps 面板（实时）；CLI = `/team` 文本摘要 + `team-ctl` 工具（可生成静态卡片）。

> 宿主基线：本插件在 **ZCode Desktop 3.16.2 / CLI 0.17.0** 上完成终验（实测基线，非推测）；发布演练另在 Desktop 3.16.3 / CLI 0.17.0 复测通过，桌面入口路径在 Desktop 3.17.1 复测通过。更低版本未验证，不在支持范围内。

## 安装

### 桌面（插件市场 UI）

1. 打开 **插件市场 / Plugin Marketplace**，在市场中找到 **「智能体团队 / Agent Teams」**（分类：开发者工具）。
2. 点 **安装 / Install**；安装后可在 **设置 → 插件 / Settings → Plugins** 中确认与启用。

### CLI

```bash
zcode plugins install agent-team@zcode-plugins-official
zcode plugins enable agent-team@zcode-plugins-official
```

## 启用

- 安装后默认启用；在 **设置 → 插件** 里可查看开关与配置。
- 插件声明的 SessionStart / Stop / UserPromptSubmit hooks **随启用直接生效**，不需要信任授予或 hooks 开关（已在干净环境实测）。
- 桌面默认权限模式下，agent-team 的 MCP 工具首次调用会弹「需要权限」确认；选择「允许（仅本次）」或「始终允许本项目」即可。这是宿主的工具权限，与 hook 无关。

## 在会话中使用（怎么调用）

**面板入口：** 在已有会话右侧点 **「+」**：
- 通用路径（官方 ZCode 3.17.1 实测）：**「查看所有插件」→「个人」→「智能体团队」→「打开」**。
- 宿主在「新标签页」中提供「智能体团队」入口时（官方 3.17.1 尚未提供，需含该入口的宿主版本）：**「新标签页」→「智能体团队」→「打开」**，无需进入插件列表。

装好、启用后**不需要任何专门命令**：团队协作策略已由 SessionStart hook 自动注入会话上下文（D10），在新任务里直接对话即可。共有三个调用面，按需取用：

| 调用面 | 怎么触发 | 干什么 |
|---|---|---|
| 自然语言对话（主通道） | 直接说目标 / 下指令 | 创建队友、分派任务、收发消息等全部操作；策略已自动注入，模型自己知道该用哪些团队工具 |
| `/team` | 会话里输入 `/team` | 输出团队状态文本摘要 + 面板/命令入口（**只读**，不创建/修改任何数据） |
| `/team-coordination` | 输入 `/team-coordination`（全名 `agent-team:team-coordination`） | 手动（重新）加载团队协作策略 skill；长会话策略丢失后恢复用 |

### 1. 直接说目标（默认 `auto`：按需委派）

新建一个任务（**必须是新任务**——旧任务不会刷新插件能力），直接描述目标即可。0.5.0 起默认 `leadMode: auto` 为按需委派语义：会话还没建过队时就是普通单 agent——问答、单文件小改动、纯调研汇总直接处理，不为委派而委派；目标明显值得协作（多角色并行、写域互斥分人、长任务需要独立上下文）时 Lead 才组队：

```text
帮我并行推进两件事：一边给 src/utils 补单元测试，一边审查 README 与 CHANGELOG 的措辞，完成后汇总。
```

会话里建过队后（持久判定——inactive/failed 成员也算），Lead 按委派价值逐请求判断：值得走团队流程的才委派（带验收标准、owner 与独立复核的任务，D26/D27），其余自己直接处理并说明一句理由（issue #9 / D28）。

### 2. 点名指挥与另外两档

任何时候想精确控制，直接下指令：

```text
创建一个叫 reviewer 的队友，让它检查 README 前三段的错别字，然后汇总它的结论。
```

```text
给 reviewer 发个消息：重点看中英文标点混用。
```

```text
列一下现在的成员和任务状态。
```

另外两档：`always` 恢复 0.5.0 之前的主动编排（从首条消息起自主拆活、组队、分派、验收，无需逐条指挥）；`off` 完全关闭智能体团队（不注入任何团队上下文、不注册团队工具）。

模型会把这些话术映射到对应工具（`spawn_teammate` / `send_message` / `list_agents` / `team_task_list` …），你不需要记工具名。

### 2.1 模型与思考强度（自动跟随 Lead，无需设置）

**0.4.0 起，成员模型只有一条路线：自动跟随 Lead 的最新已确认模型与思考强度。** 没有单独的成员模型配置——面板没有齿轮弹窗，`spawn_teammate` 没有 `model` 参数，对话也不能「让某个成员换模型」。你只需要管好 Lead 自己用什么模型，成员每轮开始执行前会自动同步。

```text
创建一个叫 reviewer 的队友，检查 README 前三段的错别字。
```

- **同步时机**：成员每次开始执行前（首轮、后续消息唤醒、恢复团队）都先比对 Lead 最新选择（以宿主会话中的实际选择为准，0.4.1），有变化才应用，无变化零开销；运行中的成员等本轮跑完在下一轮开始时同步（不打断已有工作）。急需切换可先中断该成员，再发消息续跑。
- **「已确认」的含义**：以你**实际提交消息时**的模型为准（宿主在保存消息时写入快照），并用会话选模记录（`/model` 命令）与主轮实际调用记录核对——三路取最新。仅在输入框里切了下拉但还没提交，不承诺同步。
- **失败绝不静默、重试有节制（0.4.1）**：Lead 的模型无法被成员继承时（官方 coding plan、Provider 被删除/禁用、解析不出），创建/续跑会直接报错并说明原因，不会悄悄用别的模型开跑；失败原因在成员行诊断可见，待处理消息保留不丢。同一失败不会无限重试：确定性拒绝（套餐/目录外）暂停自动重试，临时故障（超时等）按 5s/15s/30s 退避最多自动重试 3 次；Lead 换回可用模型或你再发一条新消息即自动恢复交付，恢复成功后旧错误提示自动消失。
- **创建前校验（0.4.1）**：Lead 模型不可继承时，`spawn_teammate` 在登记成员**之前**就报错——不产生 failed 成员、不占用成员名；修正 Lead 模型后原名可直接重用。
- **不支持继承官方 coding plan（硬性边界）**：成员是独立 CLI 进程，宿主不向它下发订阅套餐（`account:*` / `builtin:*` Provider，如智谱 GLM 官方 coding plan）的凭据，因此**不支持直接继承官方 coding plan 模型配置**。Lead 正在用套餐模型时创建/续跑成员会报错；请先在 ZCode 中把 Lead 切换到自配的第三方模型（ZCode 设置 → 模型服务，添加你自己的 Provider + API Key）。

### 3. `/team` 看状态

会话里随时输入 `/team`：首行输出「成员 N · 共享任务 T」，随后逐行列出成员与任务（与面板词典同源同文案），并按运行环境附上面板/命令入口。刷新语义：桌面 MCP Apps 面板自动实时（订阅推送，无需手动刷新）；CLI 每次重跑 `/team` 即最新。

### 4. `/team-coordination` 重载策略

策略的主通道是 hook 自动注入，通常无需手动加载。两种情况会用到这个 skill：

- 超长会话中注入的策略可能被上下文压缩掉（D24）：输入 `/team-coordination`（或让模型「重新加载团队策略 skill」）即可恢复；
- 想确认当前会话按团队纪律工作时，也可以点名加载。

### 一次成功的样子

以「创建 reviewer 检查 README 错别字」为例：

1. 会话里出现「智能体团队」面板（`spawn_teammate` 的结果携带面板打开提示，桌面上会定向打开），成员区显示 `lead`（当前会话）与 `reviewer`；
2. `reviewer` 创建并开始工作，面板/任务板出现任务与状态变化；
3. `reviewer` 完成后向 Lead 汇报，Lead（委派出去的工作先独立复核）汇总给你；
4. `reviewer` 的会话是隐藏子会话，不会和 Lead 平级出现在左侧任务栏。

## 工具速查（模型可见 9 个；`interrupt:false` 时 8 个；`leadMode:off` 时 0 个）

| 工具 | 谁用 | 作用 |
|---|---|---|
| `spawn_teammate` | Lead | 创建一个有名字的持久队友（`context: fresh\|fork`；模型自动跟随 Lead，无独立参数；目标明显值得委派时再组队） |
| `send_message` | 全体 | 给另一个成员发消息：运行中在最近回合边界送达；空闲则拉起/恢复一轮 |
| `list_agents` | 全体 | 列出 Lead 与全部队友的 target 与可用状态（`inactive` = 当前无回合，不代表任务失败） |
| `interrupt_agent` | Lead | 中断一个队友当前回合，保留其待处理收件箱（**配置关闭时此工具不注册 → 8 个**） |
| `wait_agent` | Lead | 等待下一次成员/消息/任务变化（不会唤醒空闲成员；超时返回 noProgress） |
| `team_task_create` | 全体 | 在共享任务板创建一条未分配任务（可带 `blocked_by` / `write_scopes`） |
| `team_task_list` | 全体 | 列出任务：状态、owner、revision、阻塞、写作用域告警（可分页/过滤） |
| `team_task_get` | 全体 | 读取单条任务的最新完整内容（改动前必读） |
| `team_task_update` | 全体 | 用 `expected_revision` 做 CAS 的任务动作：claim / release / edit / set_dependencies / complete / reopen / reassign / delete |

另有一个 app 专用回环工具 `team_panel_call`（面板心跳/刷新/详情（**按轮摘要**）；**只读通道，零变更能力**，模型不可见）；诊断探针 `team_ping` 仅在 `TEAM_DEBUG_TOOLS=1` 时暴露。

## 配置（userConfig）

在 **设置 → 插件 → 智能体团队** 中修改，改完对新任务生效（进行中的会话沿用启动时配置）。

| 配置 | 默认 | 说明 |
|---|---|---|
| `maxMembers` | 8 | 团队内 teammate 数量上限（不含 Lead，含 failed） |
| `maxTasks` | 256 | 任务板任务数量上限 |
| `maxMessageBytes` | 65536 | 成员间单条消息的最大字节数 |
| `disposalTimeoutMs` | 5000 | 团队处置（结算与回收）的超时时间 |
| `interrupt` | true | 关闭后模型只拿到 8 个工具（`interrupt_agent` 不注册） |
| `leadMode` | auto | `auto`：按需委派（建队前=普通单 agent，建队后按委派价值判断）；`always`：始终主动编排；`off`：完全关闭智能体团队（不注入、0 团队工具）。旧值 `orchestrator`/`collaborator` 按 `auto` 处理（issue #9） |

## 网络访问、依赖与副作用

| 项 | 申报 |
|---|---|
| 网络访问 | **无外网请求**。daemon 经 stdio 与宿主通信；teammate 与宿主 app-server 的桥接走本机进程间通道；可选伴生页（`TEAM_COMPANION=1`）仅监听本机回环 `127.0.0.1`。模型请求由宿主按你配置的 Provider 发出，与本插件无关 |
| 模型/API 依赖 | 成员由宿主自带 `zcode` CLI 驱动，逐轮自动跟随 Lead 当前模型（见 2.1）；**不支持继承官方 coding plan**（套餐凭据不下发）；插件自身不需要任何 API Key |
| 文件写入 | 仅写插件数据目录 `$ZCODE_PLUGIN_DATA`（`teams/`、`logs/`、`meta/`、checkpoint）与宿主任务索引的两个白名单点（成员会话隐藏 anchor、`sidebar-audit --apply`，见 D25）；宿主 `db.sqlite` 一律只读 |
| 命令执行 | hooks、daemon、`team-ctl` 全部为插件自带的 Node 脚本（`runtime/*.mjs`），由宿主 Node 运行；`teammate` 为宿主 CLI 子进程；插件不执行任意 shell 命令 |
| Hooks | SessionStart / Stop / UserPromptSubmit（`hooks/hooks.json`，随启用直接生效） |
| MCP servers | `team-daemon`（stdio） |
| 第三方组件 | 内联 MCP SDK 等第三方软件及许可证见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) |

## CLI 用法

```bash
# /team 命令：输出团队状态文本摘要（桌面/CLI 均可用）
/team

# 直接读盘重放（与 /team 同源）
node <插件目录>/runtime/team-ctl.mjs state <teamDir>            # 文本摘要
node <插件目录>/runtime/team-ctl.mjs state <teamDir> --json     # 机器可读
node <插件目录>/runtime/team-ctl.mjs transcript <teamDir> <member>   # 成员会话摘要（按轮）
node <插件目录>/runtime/team-ctl.mjs widget <teamDir> --standalone --out /tmp/team.html --theme dark --lang zh
node <插件目录>/runtime/team-ctl.mjs tail <teamDir>             # 跟随事件日志
```

`<teamDir>` = `$ZCODE_PLUGIN_DATA/teams/<session_id>`（CLI 下通常是 `~/.zcode/cli/plugins/data/agent-team@<market>/teams/…`）。

## Node 版本要求

daemon、hooks 与 `team-ctl` 都由 Node 运行，要求 **Node ≥ 22**。安装前自检：

```bash
node -v
```

输出应为 `v22.x` 或更高。低于 v22 时 daemon 启动自检会给出警告，面板与工具可能不可用；插件会把实际版本写进 `$ZCODE_PLUGIN_DATA/logs/daemon-lifecycle.jsonl`（字段 `node`、`nodeWarn`）。

## 卸载后数据怎么处理

**先备份，再卸载**。默认卸载会删除团队数据且不可撤销。

```bash
# 1) 找到插件数据目录（安装时的 dataPath；也可从 plugins list --json 读取）
DATA="$HOME/.zcode/cli/plugins/data/agent-team@<market>"
# 2) 备份（保留任务板、成员、消息、事件日志）
tar -czf ~/agent-team-backup-$(date +%Y%m%d).tar.gz -C "$(dirname "$DATA")" "$(basename "$DATA")"
```

实测行为（2026-10-24 干净环境演练）：

| 入口 | 默认卸载 | 可否保留数据 |
|---|---|---|
| CLI | `zcode plugins uninstall agent-team@<market>` **删除整个插件数据目录**（任务板、成员、消息全部消失）；当前版本缓存删除，更早版本缓存与市场注册保留 | 可：`--keep-data` 保留数据目录（事件日志哈希不变），仅移除插件代码与启用项。非交互 shell 需 `--force` |
| 桌面 | 设置 → 插件 → 更多操作 → 卸载，确认框明确提示删除缓存、数据目录与配置；实测**删除数据目录内容**（空目录保留），当前版本缓存删除 | **无** UI 等价选项 |

注意：卸载时仍打开的相关任务窗口，后续活动会在原路径**重建一个空的数据骨架**（`events.jsonl` 为 0 字节），原团队数据不会恢复；不要因为目录又出现而误判为“数据还在”。卸载后建议关闭相关任务窗口。

## 故障排查

### 1. 先确认插件在不在、启没启

```bash
zcode plugins list | grep agent-team
zcode plugins list --json        # 看 version / rootPath / dataPath / diagnostics
```

桌面：**设置 → 插件** 中确认「智能体团队」开关为启用；**设置 → 钩子** 可看到它声明的三条 hook。

### 2. 日志位置（都在插件数据目录下）

| 文件 | 内容 |
|---|---|
| `logs/hooks.jsonl` | 每次 SessionStart / Stop / UserPromptSubmit 的完整 env overlay 与输入摘要——**判断 hook 有没有跑就看这里** |
| `logs/daemon-lifecycle.jsonl` | daemon 启动/回收：pid、node 版本、数据目录、`nodeWarn`、SIGINT 处置 |
| `logs/provider.jsonl` | teammate 轮次与投递细节（排障用） |
| `logs/requests.jsonl`、`logs/meta-log.jsonl` | 工具调用与面板回环记录 |
| `meta/runtime-config.json` | daemon 落盘的有效配置（hook 读取同一份） |
| `teams/<session_id>/events.jsonl` | 团队事件日志（append-only；`team-ctl tail` 可跟随） |
| `teams/<session_id>/coordinator.audit.jsonl` | 协调者锁获取/释放/接任审计 |

### 3. hook 没生效怎么查

1. 确认插件已启用（禁用状态下 hook 不会运行）；
2. 打开一个**新会话**，然后看 `logs/hooks.jsonl` 是否新增 `sessionstart` 记录；
3. 没有记录 → 看 **设置 → 钩子** 是否列出三条 agent-team hook（SessionStart / Stop / UserPromptSubmit），以及插件是否因版本/清单问题带 `diagnostics`；
4. 有记录但模型没按团队策略行动 → 看该条记录的 `env_overlay.ZCODE_PLUGIN_ROOT` 是否指向当前安装目录；升级后旧会话仍用旧版本，需新开会话。

### 4. 常见现象

| 现象 | 原因与处理 |
|---|---|
| 安装后 `plugins list` 出现 `Duplicate plugin hooks file ignored: hooks/hooks.json` | 已知告警：manifest 的 hooks 声明与宿主自动发现同路径文件重复，宿主显式忽略；三条 hook 仍正常执行，不影响使用。计划在后续版本清理清单 |
| 队友一直 `provisioning` / 无法创建 | 看 `logs/provider.jsonl` 与 `logs/daemon-lifecycle.jsonl`；确认 `zcode` 可执行文件可被发现（`TEAM_ZCODE_BIN` 可覆盖），以及成员名额未超 `maxMembers` |
| 创建/续跑成员时报「成员无法继承 Lead 模型」 | 预期行为（0.4.0）：成员模型唯一路线 = 跟随 Lead，Lead 正在用**官方 coding plan 套餐**（`account:*`/`builtin:*`）或 Provider 已删除/禁用时直接报错，绝不静默换模型。处理：把 Lead 切到自配第三方模型（ZCode 设置 → 模型服务）后重试。0.4.1：spawn 在登记成员前即预检报错（不占成员名）；续跑失败后同一失败不会无限重试（确定性拒绝暂停 / 临时故障 5s/15s/30s 退避×3），Lead 换回可用模型或发新消息即自动恢复交付，旧错误提示随之清除 |
| 桌面工具调用挂起或 `Client closed` | 已知宿主限制（D11）：桌面 callTool 在 daemon 空闲回收后不重建连接。新开一个任务、立刻发起调用可命中存活 daemon；面板心跳已尽量保活 |
| 面板数字不动 | 面板靠订阅+心跳刷新；`/team` 或 `team-ctl state` 可交叉验证真实状态。桌面卡片/静态视图不探测活性，成员状态偏保守 |
| 升级后行为没变 | 宿主按会话固定插件运行时：升级后请新开任务；CLI 更新提示 “Restart zcode to apply” 同理 |
| 旧团队会话出现在左侧任务栏 | 旧数据遗留：`node runtime/team-ctl.mjs sidebar-audit <teamDir> --apply` 归档（默认 dry-run，可复核） |
| 团队持久记录损坏 | 报 `persisted Agent Teams … payload is invalid`。先备份 `teams/<session_id>/`，再用 `team-ctl state` 复核；不要手工改 `events.jsonl`（会破坏 seq 连续性） |

### 5. 安全清理数据目录

确认不再需要历史团队后，可整体删除 `$ZCODE_PLUGIN_DATA`（等价于默认卸载的数据处置）。**删除前先备份**；删除后无法恢复任务板与消息。

## 限制与偏差（用户可读版，D1–D27）

本插件是 ZCode 上对 DSH Agent Teams 的复刻。以下差异均为**已登记、已验收**的适配项，来自《04-能力映射与差距分析》D1–D27（编号以该台账为准）。

| 编号 | 你会看到什么 |
|---|---|
| D1 | 团队事件写在插件自己的数据目录（JSONL），不写进 Lead 会话日志；会话导出/回滚不包含团队事件 |
| D2 | “运行中插话”只能在下一次回合边界送达（宿主没有 steer 原语）；目标运行中时消息排队，不会被丢弃或重复 |
| D3 | `context:"fork"` 在无法真正 fork 时用“fresh + Lead 已完成回合转录（截断）”实现；不是 KV 前缀共享 |
| D4 | 主 UI 是会话内 MCP Apps 面板；没有原版的头部 hover 按钮/弹层/pin；`::visualize` 快照卡片仅桌面可用 |
| D5 | 成员会话默认不进左侧任务栏；面板内提供成员会话查看视图（只读）。旧版遗留的可见行可用 `sidebar-audit` 归档 |
| D6 | Lead 仍能看见宿主内置 Task 工具（无法禁用）；teammate 侧已禁用 Task，团队工具优先由策略引导 |
| D7 | 策略文本中“文件版本冲突”一句替换为 ZCode 文件工具的等价语义；其余逐字 |
| D8 | 协调者是“瞬时”的：daemon 空闲会被宿主回收，任一实例可接任；协调者交替的瞬间可能出现 `TEAM_DISPOSED` 临时错误，重试即可（实测接任 ≤5s） |
| D9 | 没有 SessionEnd hook：处置靠 daemon 退出时尽力执行 + 下次启动对账；极短宽限下可能只留下可对账的状态 |
| D10 | 策略通过 SessionStart hook 注入到消息上下文，而非系统提示；注入文本不落 transcript；被禁用 hook 时会有 fail-loud 警告 |
| D11 | 桌面 callTool 在 daemon 被回收后可能挂起/`Client closed` 且本会话不恢复；新任务可恢复。teammate 走独立进程不受影响 |
| D13 | 工具条目不声明 `outputSchema`（宿主限制）；输出契约由测试锚定 |
| D14 | 身份缺失时错误消息里用 `<unknown>` 占位 |
| D15 | 参数类型错误返回 `TEAM_INVALID_ARGUMENT`，消息为 `param "<key>" must be …`；这些是工具面消息，错误码仍属既有 27 码 |
| D16 | 同一团队由两个 daemon 服务时（代理模式）：`list_agents` 的 active 成员可能保守显示 `inactive`；`wait_agent` 保守等待、绝不误报 noProgress |
| D17 | daemon 空闲回收默认**不终止**队友轮次（keep 休眠态）；如需要彻底回收可设 `TEAM_DRAIN_ON_DISPOSE=kill` |
| D18 | 给 Lead 的“已送达”以 hook 注入回执为准（宿主无直达注入原语，注入不落 transcript）；对外仍是 `{sent:true}` |
| D19 | hook 读取 daemon 落盘的配置；首次 daemon 启动前 hook 使用默认值（如 `interrupt=true`） |
| D20 | 空闲 Lead 的唤醒是灰度功能：默认不拉起新回合，消息持久待命；`TEAM_WAKE_LEAD=1` 才启用 |
| D21 | 静态卡片无活性探测：成员状态按 phase 保守映射（active→inactive、lead 恒 inactive）；实时面板/伴生面板才显示 running |
| D22 | 诊断工具 `team_ping` 默认不在模型工具列表（模型面 9 个，`interrupt:false` 时 8 个）；`TEAM_DEBUG_TOOLS=1` 才暴露 |
| D23 | 历史事件名/旧 checkpoint 自动兼容：旧 `team/message` 归一为 `team/message/queued`，旧 delivered 结构归一为字符串数组；历史团队数据可读 |
| D24 | 策略文本在 SessionStart（startup/resume）注入；Lead 极长会话中途可能因上下文压缩丢失，可重新加载 skill 或开新任务 |
| D25 | 插件只写宿主任务索引的两个白名单点（会话隔离 anchor 墓碑、`sidebar-audit --apply`）；`db.sqlite` 一律只读 |
| D26 | `always` 档（0.5.0 前的默认 `orchestrator`）：主动组队/分配/独立验收，不亲自实现（除一行级修复或无人可派） |
| D27 | 任务 `complete` 是“提交”，Lead 需独立复核后才算验收完成；失败会 `reopen` 并附具体问题，通过则在任务描述里追加验收记录 |
| D28 | 0.5.0 起默认 `auto`（issue #9）：建队前不注入任何模式段；首个队友创建后注入按需段（委派价值判断+正反例）；`off` 完全停注入并注销团队工具；旧值 `orchestrator`/`collaborator` 统一迁移 `auto`；0.5.0 前的 runtime-config 落盘视为过期 |

## 文档

- [使用手册（截图版）](docs/使用手册.md)
- [Repo Wiki：架构、流程与源码导航（仅源码仓库，不随插件包分发）](docs/repo-wiki.md)
- 内部移交（源码仓库 `docs/`，不随包分发）：`架构说明-as-built.md`、`运维手册.md`、`测试手册.md`
- [变更记录](CHANGELOG.md)、[许可证](LICENSE)、[第三方声明](THIRD-PARTY-NOTICES.md)
- 源码仓库：<https://github.com/Vincent-chk/zcode-agent-team>
