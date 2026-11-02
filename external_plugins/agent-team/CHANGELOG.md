# Changelog

## 0.5.0 — 2026-11-02

描述：智能体团队：在会话中创建并协调多个 teammate 子会话、共享任务板与成员消息。

- **Lead 模式三档化（issue #9 / 偏差 D28）**：`leadMode` 从二值（orchestrator/collaborator）改为三档——
  - `auto`（**新默认**，按需委派）：会话未建过队时不注入任何模式段（普通单 agent 语义，简单任务直接处理，不再为委派而委派）；该会话曾创建过团队后（`members/` 存在成员目录即持久判定，含 inactive/failed）注入**按需段**（委派价值门槛 + 正反例：问答/单文件小改/调研汇总由 Lead 直接处理并说明一句理由，多角色并行/写域互斥/长任务 fork/点名成员走团队流程），验收与等待语义不变；
  - `always`：保留原 orchestrator 主动编排行为（自主拆活、组队、分派、独立验收）；
  - `off`：完全关闭——hook 不注入任何团队上下文（策略/身份/收件箱/Stop block 全停，session-map 与轮次记录等内部副作用保留），daemon 不注册团队工具（tools/list 0 个，直连调用被拒）。
- **旧值迁移**：`orchestrator`/`collaborator` 统一按 `auto` 处理（daemon 记迁移告警）；runtime-config 升 v2——0.5.0 前落盘的旧文件 leadMode 视为过期回落默认，升级用户不被锁进激进档；宿主 config 直读层归一后判定（旧值→auto 接受）。
- **auto 档中途首建队**：SessionStart 只在 startup/resume 触发，首成员 `spawn_teammate` 成功结果尾部以独立 text 块附一行 `FIRST_SPAWN_NOTE` 指引（不改结果 JSON），后续 resume 自然补全按需段。
- **三通道同步**：工具描述去档位措辞改模式中立（spawn_teammate / team_task_update 两处）；`skills/team-coordination/SKILL.md` 编排节重写为三档（含按需段逐字引用）；文本审计扩为 24 项（D26/D28 三态两文本）。
- e2e：S7 改显式 `always` 跑编排旅程；新增 S8 auto 默认链冒烟（简单任务不建队 + 注入无模式段 + runtime-config=auto）；U-O1 重写为 auto 默认链口径（db 级无模式段断言），U-O2 改旧值迁移场景。
- 本地验收：**869 用例 / 73 文件**全部通过（基线 849 + 20）；覆盖率 statements **91.65%**、branches **85.19%**、functions **92.58%**、lines **93.42%**，门槛不变；`npm run check` 与文本审计 24 项通过。

## 0.4.3 — 2026-11-01

描述：智能体团队：在会话中创建并协调多个 teammate 子会话、共享任务板与成员消息。

- 产物目录 `dist/` 全局更名为 `runtime/`（ZCode 官方插件市场仓库不收录 `external_plugins/*/dist/` 构建产物目录名）：`.mcp.json`、`hooks/hooks.json`、`/team` 命令文档与全部构建/测试/演练脚本同步改引用，行为无变化。
- 面向插件市场发布适配：`README.md` 重写为英文用户文档，新增等价中文 `README_CN.md`（随包分发），两份均新增「网络访问、依赖与副作用」申报章节；manifest author 补充主页 URL。
- 面板入口文档落到具体路径（issue #8）：README 给出官方宿主通用路径（「+」→「查看所有插件」→「个人」→「智能体团队」→「打开」）与宿主含「新标签页」入口时的快捷路径；`/team` 桌面指引同步具体化。
- 本地验收：**849 用例 / 72 文件**全部通过；`npm run check`（typecheck + ZCode 清单校验 + daemon 冒烟 12 项）通过；覆盖率与既有门槛不变。真机验收记录见 PR 材料。

## 0.4.2 — 2026-10-26

描述：智能体团队：在会话中创建并协调多个 teammate 子会话、共享任务板与成员消息。

- 修正成员实际选模判断：宿主选模条目缺失或损坏时重新应用 Lead 选择，历史调用记录不能证明下一轮 `--resume` 的模型。
- 首轮启动前仍复核 Lead 最新选择，处理培育期间换模；刚应用的选择未变时免重复 RPC。
- 真实子进程非零退出按临时故障退避；失败前已排队的消息合并进失败记录，避免被误当成新消息触发额外重试。
- 创建预检保留原有重名、名额错误顺序；单次继承判定复用同一目录快照，删除未使用的重试返回值与后台重复抑制日志。
- 校正既有 v6 验收材料的证据范围：真实模型调用通过不代表真实输入框与 `/model` 切模交互已经验收。
- 本地验收：**849 用例 / 72 文件**全部通过；覆盖率 statements **91.61%**、branches **85.15%**、functions **92.55%**、lines **93.4%**，原门槛不变。构建、类型检查、ZCode 清单校验、daemon 冒烟、四方版本校验通过；视觉 76 页零漂移、伴生交互 17 项、文本审计 23 项通过。尚未更新本机安装副本或进行本版本真实 ZCode 界面切模验收。

## 0.4.1 — 2026-10-26

描述：智能体团队：在会话中创建并协调多个 teammate 子会话、共享任务板与成员消息。

- **成员模型自动跟随修复轮**（0.4.0 验收发现的 5 个问题全部关闭；无契约/工具面变更，模型可见工具仍 9 个）：
  - **一致性判断改以宿主实际状态为准**：每轮同步前比对的是成员会话在宿主库中的实际选择（`session_entry` 选模条目 → `main_turn` 实际调用），`origin.modelSelection` 降为辅助记录——setModel 成功后、origin 更新前崩溃的恢复盘面不再凭 origin 相同就放行；实际状态无法确认时重新应用 Lead 选择；仅思考强度变化同样识别并同步；首轮已由 createChild 定模的不重复应用（零冗余 setModel）。
  - **失败可见性与重试控制**：解析失败与宿主应用失败统一落 `model-failed.json`（新增 `kind`/`attempts`/`nextAttemptAt`/`leadSignature`/`messageIds` 字段；不重建 pending 队列）。确定性拒绝（官方套餐/目录外/宿主明确不支持）暂停相同选择的自动重试；临时故障（超时/进程/app-server 未就绪）按 5s/15s/30s 退避、最多自动重试 3 次；Lead 换模或用户再次明确发送新消息即解锁。后台补投失败经宿主装配的通知钩子立即刷新成员展示（不等下一次轮次边界）；消息持久保留、不误标 delivered。修复前同一条消息 6 秒内会重复 4 次 setModel 尝试，现在只尝试 1 次。
  - **创建前校验移到成员登记之前**：新增 provider `preflightMemberModel()`，roster 在写入 provisioning 事件前调用——Lead 用官方套餐/无可确认模型/已删除 Provider 时，spawn 请求明确失败且**不增加成员数量、不占用成员名、不创建隐藏子会话**；修正 Lead 模型后原名可重用。供给阶段复检保留（处理预检后配置漂移）；真实供给失败仍是原 failed 成员语义。
  - **旧失败提示按验证成功清除**：宿主实际状态确认「成员与 Lead 已一致」时（无需额外 setModel）即清除旧失败记录与成员行诊断；仅 Lead 改了配置而未恢复成功时提示保留。
  - 既有 [v6 脚本](../zcode-agent-team-plan/stage-8-model-config/e2e-real-model-041.mjs)与[结果报告](../zcode-agent-team-plan/stage-8-model-config/e2e-real-model-041-evidence.json)记录六场景 ALL_PASS（创建继承 / 提交快照注入后跟随 / 选模条目注入后跟随 / daemon 重启恢复团队 / 套餐阻止+抑制 / 切回恢复交付恰一次）。这是**真实模型调用集成验收，切模事件由测试脚本注入，不包含真实输入框或 `/model` UI 交互**；宿主实际调用、会话选择和成员落库记录用于核验运行结果，不代表桌面切模交互已通过验收。两份材料位于本仓库之外。
- 测试 787 → **840**（72 文件；两轮稳定）；覆盖率 branches 83.25% → **85.12%**（达 85% 门槛；0.4.0 时点为既有技术债），statements/functions/lines ≥90% 保持；视觉基线 76 页零漂移；伴生面板交互 17 项全过。

## 0.4.0 — 2026-10-25

描述：智能体团队：在会话中创建并协调多个 teammate 子会话、共享任务板与成员消息。

- **破坏性变更：成员模型全部收敛为「自动跟随 Lead」一条路线**。没有单独的成员模型配置——以下通道整体注销：
  - 面板成员卡右上角**齿轮 + 模型设置弹窗**（含 `team_panel_call` 的 `modelOptions`/`setMemberModel` 两个动作）删除；面板恢复**零变更只读通道**口径（任务板/成员/详情不变）。
  - 对话工具 **`member_set_model` 删除**（模型可见工具 10 → 9；`interrupt:false` 时 8）。
  - `spawn_teammate` 的 **`model` / `thoughtLevel` 参数删除**；MCP 资源 **`team://models` 下线**（模型目录仅 provider 层内部分类使用，白名单脱敏纪律不变）。
- **继承机制重做（三源判定 + 每轮执行前同步）**：
  - Lead「最新已确认模型」= 三路按时间戳取最新：① 真实用户**提交消息时**宿主写入的模型快照（输入框切换在提交瞬间生效——修正对宿主 issue #7「条目不随输入框切换刷新」的依赖）；② 会话选模记录（`/model` 命令刷新）；③ 主轮实际模型调用（`query_source='main_turn'` 严格过滤，compact/标题生成/subagent/workflow 等辅助行绝不会被当成 Lead 模型）。旧「条目优先、usage 兜底」固定优先级删除。
  - 同步点 = 成员**每次开始执行前**（`launchTurn` 统一入口，首轮/消息唤醒/恢复团队三路共用）：与成员实际生效选择比对，**有变化才应用**（零变化零开销）；运行中的成员本轮跑完后在下一轮开始时同步（不打断已有工作）；急需切换用现有中断能力结束当前轮次再续跑。
  - **失败绝不静默**：官方 coding plan 套餐（`account:*`/`builtin:*`）、Provider 已删/禁用、解析不出、setModel 被拒——一律**显式报错**（创建失败不落成员；续跑则阻止该轮启动），不再回退宿主缺省冒充继承成功，也不会把旧第三方模型显示为「同步成功」。成员卡保留一行继承失败诊断兜底。
  - 无后台监听、无新配置文件、无模型配置表；`model-pending.json` 队列机器删除。
  - 保留：空目录守卫（目录不可读 = 无法分类 → 照旧尝试、宿主终审）、档位缺省链（defaultVariant → max）、origin 只记实际生效者（`modelSource` 恒 `inherited`；`explicit` 仅历史数据兼容读取）。
- **README/使用手册新增硬性边界声明**：不支持直接继承 GLM 等官方 coding plan 模型配置——成员模型必须来自你在 ZCode 设置中自配的第三方 Provider；Lead 使用套餐模型时团队创建/续跑会报错并指引切换。
- 测试 878 → **787**（成员独立配置通道的 ~90 例随功能注销；继承/同步按新语义重写：三源各路取胜/陈旧条目跟提交/`/model` 跟条目/辅助行过滤/三种不可继承抛错/空目录守卫/每轮同步成功与阻止/套餐切换阻止/legacy 不应用；视觉基线 80 → 76 页，settings 4 张随弹窗下线，全页面反向断言「无齿轮/无弹窗/零凭据输入」）。
- 文档回写：traceability §18 历史台账保留并标注注销关系，新增 §19（F39 收敛登记）；架构说明数据流/降级表/模块地图同步 0.4.0 口径。

## 0.3.2 — 2026-10-25

描述：智能体团队：在会话中创建并协调多个 teammate 子会话、共享任务板与成员消息。

- **第三方模型继承精化（分类优先绕过官方套餐）**：
  - spawn 默认继承只覆盖**模型目录（Provider 注册表）内**的自配第三方模型；Lead 使用官方 coding plan 套餐（`account:*` / `builtin:*` Provider）时**零 setModel 尝试**直接回退宿主缺省，不再产生必败 RPC 与失败日志噪音。
  - 继承链按目录过滤 `session_entry` → `model_usage`（空目录守卫：目录不可读时不过滤，照旧由宿主终审）；新导出 `catalogSupports(catalog, selection)` 作为唯一分类判据。
  - 跳过仍写 `model-failed.json`（防可见性回归），诊断区分两态：官方套餐 →「Lead 当前使用官方套餐模型（provider/model），成员无法继承，已回退宿主缺省；可在 spawn 时指定自配模型或改用第三方模型」；其他目录外模型 →「Lead 模型 provider/model 不在可用目录，已回退宿主缺省」。
  - 显式指定通道与「尝试后失败」路径一字未动（无契约/工具面变更，backend/面板零改动）；origin 仍只记实际生效者。
  - README §2.1 与使用手册补继承边界声明。
- **取消「简洁/详细」双模式**：成员会话查看视图固定为按轮摘要一种形态。
  - 每轮显示**用户指令 + 动作组 + 每轮结论**：动作组（`toolGroup`）一行汇总本轮全部工具，点击就地展开逐条工具（名称/状态/载荷）；本轮最后一条非空 assistant 文本作为该轮结论。
  - **全量转录不进视图**：需要原始记录时走 `team-ctl`/事件日志/宿主会话库。
  - 计数显示「n 条 · 共 sourceTotal 条转录」（`sourceTotal` = 投影前原始条数）。
  - **mode 参数与切换按钮全部移除**：`team_panel_call` 的 detail 请求/响应均无 `mode`，面板与伴生页无模式切换按钮；CLI 删 `--mode`（`team-ctl transcript <teamDir> <member>` 即摘要形态）。
  - 契约写实保留：`items.kind` 为 `"text"|"toolCall"|"toolGroup"`；`kind:"toolResult"` 从未独立实现，工具结果并入 `toolCall` 载荷。
  - README / 使用手册 / 架构说明 / 运维手册 / 测试手册 / 命令文档 / 追溯矩阵同步改写为单一摘要口径。
- 测试 875 → **878**（本机 env 净化实测两轮稳定，75 文件；分类五态 + `catalogSupports` 新增）。
- 视觉基线 **80 页不变**（无 UI 变更）。
- 模型可见工具面与成员/任务行为不变（仍 10 工具，`interrupt:false` 时 9）。

## 0.3.1 — 2026-10-25

描述：智能体团队：在会话中创建并协调多个 teammate 子会话、共享任务板与成员消息。

- **修复 GitHub #6：模型/思考强度设置失败全程无提示**（单次尝试语义，全链路可见）：
  - `member_set_model` 失败不再包装成"下一轮生效"：空闲成员立即应用失败直接返回 `applied:"failed"` 与宿主原因原文（如"Provider Registry 中不存在 Model"），不落 pending——消灭"每轮静默重试每轮失败"的无限循环。
  - 失败落 `model-failed.json` 并在三个面立即可见：`list_agents` 成员行 diagnostics（对话通道）、面板成员卡诊断行、模型弹窗"上次设置未生效：…（原因）"错误色提示；成员列表模型名保持真实值，不再维持"快成功"观感。
  - 运行中成员的"下一轮生效"若应用失败 = 终态（删 pending + 记失败 + 继续旧模型跑轮）。
  - spawn 继承降级（Lead 模型不可用于成员，如订阅套餐型）同样落诊断——#5 的可见性半边（能力仍待宿主开放）。
  - 任一次成功应用清除失败记录；`02 规格 §9.13` 描述补失败语义（F01 双源同步）。
- 测试 864 → 875；真模型 E2E 十一步 ALL_PASS（含失败路径三面可见性）。

## 0.3.0 — 2026-10-25

描述：智能体团队：在会话中创建并协调多个 teammate 子会话、共享任务板与成员消息。

- **成员会话查看视图新增「简洁/详细」双模式**（detail 契约〔视图修订 2026-10-25〕）：
  - 默认**简洁**（`mode:"summary"`）：按轮投影为「用户指令 + 每轮动作组 + 每轮最终结论」；动作组（`toolGroup`）一行汇总，点击就地展开逐条工具（名称/状态/载荷）。
  - **详细**（`mode:"full"`）：修订前的全量转录流，供审计与排障；行为逐字不变。
  - `team_panel_call` 的 detail 请求新增 `mode`（缺省 `summary`）；响应回显 `mode` 并新增 `sourceTotal`（投影前原始条数）；`items.kind` 增 `toolGroup`（`count` + `tools[]`）。
  - **契约写实**：`kind:"toolResult"` 从未独立实现——工具结果并入 `toolCall` 载荷；本次只改文档口径，不新增类型、不改数据源。
  - **跨模式 `seq`/`cursor` 不通用**：切换模式重置到末页（面板/伴生页）；CLI 每次调用独立。
  - CLI 对等：`team-ctl transcript <teamDir> <member> --mode summary|full`（缺省 summary，与面板共用同一合成函数）。
  - 面板与伴生页新增模式切换按钮；README / 使用手册 / 架构说明 / 运维手册 / 命令文档 / 追溯矩阵同步更新。
- 测试 836 → **864 passed**（`test/panel/detail.test.ts` 16 → 26；`test/ui-core/detail-render.test.ts` 17 → 28）。
- 视觉基线 76 → **80 页**（新增 detail-summary × light/dark × zh/en 共 4 页）。
- 模型可见工具面与成员/任务行为不变（仍 10 工具，`interrupt:false` 时 9）。
- 遗留登记（GitHub issue 跟踪）：详情文本 markdown/代码块排版未实现（当前纯文本）；`toolResult` 契约偏差已写实；U03 盲测仍未执行；模式选择不跨面板重开保持。

## 0.2.0 — 2026-10-25

描述：智能体团队：在会话中创建并协调多个 teammate 子会话、共享任务板与成员消息。

- **teammate 模型可配置化**（F33–F36，02 规格 §9.13/§10 修订）：
  - spawn 默认**继承 Lead 的模型与思考强度**（Lead 会话 `runtime/model_selection` 权威条目 → `model_usage` 兜底；条目不可用时兜底重试一次，origin 只记实际生效者）。
  - `spawn_teammate` 新增可选参数 `model`（`"providerId$modelId"` 或裸 modelId，经 `team://models` 目录消歧）与 `thoughtLevel`。
  - 新增第 10 个工具 **`member_set_model`**：mid-life 修改成员模型/思考强度；空闲成员立即生效，运行中成员下一轮生效（pending 标记 + 下轮兜底）。
  - 新增只读资源 **`team://models`**：模型目录（运行时注册表 `provider_config.json` 白名单投影，含 config.json 回退；**绝不输出 apiKey/baseURL**）。
  - 面板成员卡右上角**齿轮 → 模型设置弹窗**：provider/模型/思考强度三级联动、当前生效值与来源标识（继承自 Lead / spawn 指定 / 手动修改 / CLI 缺省）、高级模式引导（ZCode 设置加 provider 后刷新；弹窗零凭据输入）。`team_panel_call` 新增 `modelOptions`/`setMemberModel` 两动作——面板通道首个（且唯一）受控变更动作，任务板仍零变更。
  - 生效机制：会话库 `session_entry(runtime/model_selection)`（`session/setModel`，`persistAsWorkspaceLastUsed:false`），headless `--resume` 每轮自动恢复；一次设置全轮次生效。
- 测试 697 → 836；视觉基线 72 → 76（重录 28 + 新增 settings 弹窗 4）。

## 0.1.3 — 2026-10-24

描述：智能体团队：在会话中创建并协调多个 teammate 子会话、共享任务板与成员消息。

- 写域重叠警告仅挂双方 `in_progress` 的任务对（成对对称）：主体为 `completed`/`pending` 时不再产生警告。
- 面板 advisory 警告色由错误红降为警告黄（新增语义令牌 `--at-warning-text`）；红色仅保留给真报错。
- **无 MCP 契约/schema 变化**：工具清单、入参/出参与 TASK_VIEW 字段不变，仅派生口径与颜色变化。

## 0.1.2 — 2026-10-24

描述：智能体团队：在会话中创建并协调多个 teammate 子会话、共享任务板与成员消息。

- 文档定稿版：README 补齐安装/启用/快速上手/工具速查/配置/Node 自检/卸载数据处置/故障排查/宿主基线/限制与偏差（D1–D27）。
- 新增《使用手册》（含桌面 MCP Apps 面板、::visualize 卡片、CLI 文本摘要与静态卡片实拍截图），并随包分发（`docs/使用手册.md` 与 `docs/assets/manual/`）。
- 仓库新增内部移交文档：架构说明（as-built）、运维手册、测试手册（不随包分发）。
- **无运行时行为变更**：与 0.1.1 相比仅文档与包内文档资源变化；阶段二的 0.1.0→0.1.1 升级演练证据继续有效。

## 0.1.1 — 2026-10-24

描述：智能体团队：在会话中创建并协调多个 teammate 子会话、共享任务板与成员消息。

- 升级演练版本：功能与 0.1.0 相同，仅版本号与发布元数据变化，用于验证 0.1.0 → 0.1.1 的升级路径。

## 0.1.0 — 2026-10-24

描述：智能体团队：在会话中创建并协调多个 teammate 子会话、共享任务板与成员消息。

- 首个发布包：stage-1–6 交付内容（域核心、工具面、队友运行时、MCP Apps 面板、成员会话隔离）打包为可安装插件。
- 随包提供 `LICENSE`（MIT）与 `THIRD-PARTY-NOTICES.md`（bundle 内联依赖的许可声明）。
- 构建基线：Node ≥ 22；宿主实测基线 Desktop 3.16.2 / CLI 0.17.0。
