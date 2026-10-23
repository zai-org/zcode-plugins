# regress-guard

> AI 辅助开发的测试回归卡点 + 反脆弱控制体（四公理架构，版本见 plugin.json）
>
> **先读思想**：[docs/PHILOSOPHY.md](docs/PHILOSOPHY.md)——十六条设计哲学与它们背后的真实教训。功能会过时，思想不会。

## 安装（三轨）

**官方市场轨（推荐）**：ZCode 插件市场搜索 regress-guard 一键安装
（官方市场收录后可用；市场安装即含全部钩子，无需 install.sh）。

## 安装（另两轨）

**插件轨（推荐，实验路径）**：本仓已是 marketplace 就绪形态（根目录
`marketplace.json` + `hooks/hooks.json` 全 `${ZCODE_PLUGIN_ROOT}` 相对化）。
在 ZCode 设置 → 插件市场添加个人来源 `github:1339190177/regress-guard`，
安装 regress-guard——钩子经宿主运行时合并自动生效，可随插件开关启停与升级
（git pin 自带完整性校验）。自检脚本已适配双轨（版本面：.source 戳或已装 plugin.json 任一形态）。

**开发轨（现行）**：克隆本仓后 `bash install.sh`（或对 AI 说 `/regress:install`）
——脚本拷贝钩子到 `~/.zcode/regress-guard-hooks` 并写用户级注册，附带三查自检。
两轨只取其一，同装会双份钩子。

## 五分钟上手

1. **环境**：ZCode 客户端（hooks/commands 机制）+ Python 3.10+
2. **安装**：`bash install.sh`（或对 AI 说 `/regress:install`）
3. **接入项目**：任意项目里对 AI 说 `/regress:init`
4. **日常**：说需求 → AI 出计划卡片 → 你「批准/修改/取消」→ 开工；
   提交时 hook 自动跑测试拦问题；卡住看项目里的 `.regress/README.md`

- 人类使用手册：[docs/小白指南.md](docs/小白指南.md)——你只需要会说三类话
- 完整工作流：[docs/WORKFLOW.md](docs/WORKFLOW.md)
- 健康检查：`bash validate.sh`（应 5/5）· 单元测试：`python3 -m pytest tests/ -q`（应全绿）

## 与 ZCode 原生能力的关系（分层，不重复）

本插件遵循第一原则"不做 ZCode 已有的，只做增强层"——原生能力是战友不是对手：

| ZCode 原生 | 本插件的关系 | 分层逻辑 |
|---|---|---|
| 计划模式（EnterPlanMode） | **互补** | 宿主计划模式管**会话权限**（只读探索，批准后放开工具）；本插件 planning 状态管**产物生命周期**（清单未批准，边界守卫拦编辑、批准落 approved.at、临行进否决窗）。一个绑会话、一个绑清单，可叠加：计划阶段建议在宿主计划模式下探索 |
| 智能体（Agent 工具） | **复用** | /regress:plan 步骤 3 的 A/B/C 并行分析（需求理解/改动点/影响面）就是直接委派宿主智能体 |
| TodoWrite | **分层** | 会话内待办（易失）vs 清单 manifest（跨会话、门禁绑定） |
| hooks 事件系统 | **复用** | 全部强制力（11 个注册）骑在宿主 PreToolUse/PostToolUse/Stop/SessionStart 事件上——"外挂宪法"的字面含义 |
| skills / MCP | **复用** | second-opinion 技能、advisor MCP；verify 报告可接 document-skills，GUI 回归可接 browser-use |

## 可选：第二意见顾问生态

部分注入文本会建议调用 `mcp__advisor__consult`（外部第二意见工具）——这是**可选生态**：

- **未安装顾问**：AI 收到降级提示（自行判断并标注「未获第二意见」），全部核心门禁不受影响
- **一票关闭**：`REGRESS_AUTO_CONSULT=off`
- 设计哲学：顾问有一票否决权、无一票批准权（见 `commands/regress:plan.md` 步骤 5a）——
  意见只注入文本、永不执行

## 误报口径与公开基准

误报口径 **human-only**：拦截是否有用由**人事后裁决**（useful / false_positive /
ignored），AI 无投票权——门禁数字不自己给自己打分，比厂商自报口径严。
本仓测试内容本就公开，[benchmarks/](benchmarks/) 基准集是对既有攻击回放用例的
策展，**非新披露**。方法论、实测数字与引用格式见
[benchmarks/README.md](benchmarks/README.md)。

## 四公理架构（v1.8：基于脆弱性前置的分布式认知控制论）

| 公理 | 机制 | 强制力 |
|------|------|--------|
| **一·脆弱性前置** | 清单 `fragile_points` 挂牌（open/locked/flagged）；verify 命令拿证据；环境指纹 env.lock.json 漂移检测 | open 状态 **hook 阻断提交** |
| **二·认知物质化** | 决策链写 `.regress/decisions.md`；文件指纹（mtime+size）——读后被外部改过禁止盲改 | 指纹不匹配 **hook 阻断修改** |
| **三·考古持久化** | 失败/风险动作/用户纠正自动埋入 `.regress/journal/`（append-only，随 git 入库）；/regress:learn 挖跨会话重复失败 | 自动、无感、不可关闭（REGRESS_JOURNAL=off 除外） |
| **四·建议执行分离** | 执行阀：mkfs/dd if=/force push/DROP/TRUNCATE/chmod -R 777/项目外 rm -rf 需显式令牌；顾问意见只注入文本、永不执行 | 无令牌 **hook 阻断**（令牌 `REGRESS_CONFIRM=YES`） |

一句话：不要指望变聪明，要指望变死板——灰尘对得上（指纹）、失败刻在石头上（地层）、拆弹要输密码（令牌）、未挂牌的脆弱点不许出门（V 门禁）。

## 核心能力

| 能力 | 实现方式 | 什么时候触发 |
|------|---------|------------|
| **commit 门禁** | hook 自跑测试，exit 2 阻断 | git commit 时 |
| **F3 追踪** | git diff 对比清单 | /regress:track |
| **先读后改** | hook 阻断（ratio=2）+ 文件指纹复核 | Edit/Write 时 |
| **pre-mortem** | Stop hook 注入提醒 | 改≥3 文件时 |
| **自愈+升级** | SessionStart hook | ZCode 启动时 |
| **需求入口检查** | UserPromptSubmit hook | 用户输入时 |
| **提交观测** | git post-commit 钩子（静默/自禁用/monorepo 感知） | 任何来源的提交，含 IDE/终端 |
| **覆盖率信号** | jest --coverage 自动采集 | 每次门禁测试 |
| **经验注入** | 启动时摘要注入（防重复门） | 项目规律变化时 |
| **执行阀** | PreToolUse(Bash) 令牌制 | 不可逆命令时 |
| **开发边界守卫** | PreToolUse(Edit/Write) 事前拦截越界编辑；track 回写即扩界 | 活跃清单存在时 |
| **计划审批落产物** | planning 清单边界内拦编辑；plan_approve.py 转写 approved.{at,note} + base_head 漂移检查；人类可直接填 approved.at（产物直通） | /regress:plan 步骤 5 |
| **现场重建** | /regress:resume 从 .regress/ 产物层单侧重建工作现场（不依赖对话） | 断点续作时 |
| **受阻一等状态** | plan_approve.py --block 四问落产物（阻塞/已试/为何不能绕/需要人类什么）；受阻期间边界守卫拦编辑；--unblock 解阻 | 实施卡住时 |
| **假设失效化石** | 推测被实测证伪→追加 was→reality→evidence + journal add assumption_broken | verify 证伪假设时 |
| **假设账本（软引导）** | 排障任务先检验后动手：假设/检验命令/结果/裁决四列落清单正文；第一嫌疑人=自己最近的 diff；失败即证伪不叠层；宣称跟着证据走（不说"根治"只说"缓解待验证"）。病例：REGRESS-005 三轮防御 6+ 轮部署，真凶是自己上一轮的参数 | /regress:plan 步骤 2e · 排障时 |
| **项目禁改区** | config boundary.forbidden 冻结区通配——与任务无关任何状态都拦；逃生口统一 /regress:bypass（赦后记债） | 编辑冻结区时 |
| **赦免权普适化** | bypass_until 与 commit 门禁同源，边界/提交类流程闸统一认；**不可赦名单两条**：执行阀（物理不可逆，逐次令牌）+ 先读后改（防盲改，读文件成本≈10s，赦它省时间只会引雷） | bypass 有效期内 |
| **解析单一来源** | lib/manifest_fields.py 统一 frontmatter 读取与可编辑性判定；validate 架构守卫保证块正则不出 lib | 维护时 |
| **感官证据（AVS）** | sensory 脆弱点问人只收布尔 → human_check 化石；门禁验化石存在性不复跑感官；拓扑新增 oracle 类（测试替身保真度） | 终验/提交时 |
| **顾问预审·临行** | 计划卡片送顾问预审（一票否决权/无一票批准权）；预授权+无异议 → --provisional 临行进否决窗，哨兵标 🚀 | /regress:plan 步骤 5a |
| **活跃清单哨兵** | SessionStart 注入进行中任务（id/status/open 数/受阻 need）→ 指路 /regress:resume | 每次会话启动 |
| **老项目自动迁移** | SessionStart self_heal 检测 .regress/ 缺零号 README → 从模板幂等补写（永不覆盖定制版） | 每次会话启动 |
| **失忆读者层** | 清单正文写给断上下文的读者：实施顺序一步一响（可观察里程碑）+ 环境准备 + 报错自救（rescue 字段） | /regress:plan 步骤 4.7 |
| **考古地层** | 探测器自动 append 到 journal/ | 每次失败/风险/纠正 |
| **代谢链（规律账本）** | finish 收尾必过沉淀位（有料沉淀无料跳过）；规律记账（再检出=命中）；🍂 半年零命中列降级候选提示人工修剪（永不自动删）；🦴 命中≥3 建议经人批准用 skill-creator 固化为宿主 skill——地层是脂肪，规律是肌肉，skill 是骨骼 | /regress:finish · /regress:learn |
| **需求判据层（软引导）** | 验收标准节（判据/证据/状态——"根治/更好"类词必须挂判据，非功能底线需求阶段定型）+ 设计备选卡（没有备选=没想过）；未门禁化——误用病例出现再议 | /regress:plan 4.8 · verify |
| **产品适定性层（软引导）** | 产品上下文卡（用户/价值观人类填，行业惯例顾问 scout 起草，永不删人类段）+ 草图先行（用户可见功能卡片必备「所见」，否决在草图不在实现后）+ design_rejected 学费化石+ 预审第四问必带搜索（scout 不可用则标注，不以无搜索充数） | /regress:plan 2a·5a · learn |

## 命令

| 命令 | 作用 |
|------|------|
| `/regress:install` / `uninstall` / `update` | 安装/卸载/升级 |
| `/regress:init` | 初始化项目 .regress/ |
| `/regress:plan` | 需求解析 + 改动清单 |
| `/regress:track` | 发现 F3 + 回写 |
| `/regress:verify` | 跑测试 |
| `/regress:quick` | 快速模式 |
| `/regress:bypass` | 紧急绕过 |
| `/regress:learn` | 分析历史 + 框架规则 → 写入 AGENTS.md |
| `/regress:trace` | 交付链视图（意图→过程→产出） |
| `/regress:resume` | 断点续作：产物层单侧重建现场 |
| `/regress:finish` | 收尾流水线：track→verify→状态推进→报告 |
| `/regress:evolve` | 查社区 → 适配 → 沉淀到知识库 |

## 三种工作密度

| 模式 | 步骤 | 适用 |
|------|------|------|
| full | 说需求→批准卡片→实施→finish→commit（门禁发 done） | 团队/大需求 |
| fast | 改代码→quick→commit | 个人/小改动 |
| bypass | bypass→commit | 紧急 hotfix |

## 配置

`.regress/config.json`：
```json
{"strict": true, "read_before_edit_ratio": 2}
```

## 安装架构

代码全局装一次（`~/.zcode/`），数据各项目独立（`项目/.regress/`）。

详见 [小白指南](docs/小白指南.md) · [WORKFLOW](docs/WORKFLOW.md)

<!-- generated: reference start · 本区由 scripts/gen_reference.py 生成，勿手改 -->

**实况（由 gen_reference.py 生成，勿手改本区）**

- 命令：16 个 · hook 注册：11 个事件条目 · 测试函数：563 个

| 命令 | 说明 |
|---|---|
| `/regress:bypass` | 紧急绕过回归卡点（限时 + 审计日志），用于 hotfix 等紧急场景 |
| `/regress:characterize` | 特征测试生成：改无测试老代码前先钉住现状行为（golden master——探针真跑取真值，不猜输出） |
| `/regress:evolve` | 遇到难点时查社区经验→适配项目→沉淀为知识库（不再重复查） |
| `/regress:finish` | 收尾流水线：track 回写 → verify 全证据 → 代谢沉淀 → 状态推进 → 汇总报告（一条命令走完收尾，人只出现在决策点） |
| `/regress:init` | 初始化项目的 .regress/ 数据目录（代码已在全局级安装，这里只建数据） |
| `/regress:install` | 一键安装 regress-guard 到用户级（零配置，装一次全局生效） |
| `/regress:learn` | 分析历史+检测框架规则，输出项目洞察，写入 AGENTS.md |
| `/regress:plan` | 需求→解析→消歧→改动清单。AI 先补全上下文再动手（不问能推断的，只问关键分歧） |
| `/regress:quick` | 快速模式——机器判据达标的小改动专用（合并 plan+track 一步到位） |
| `/regress:resume` | 从 .regress/ 产物层单侧重建工作现场（断点续作，不依赖对话历史） |
| `/regress:stats` | 健康报表：门禁拦截/债务/规律命中/僵尸清单/钩子活性一屏读（观测期仪表盘，只读不改） |
| `/regress:trace` | 查看交付链：需求→会话→事件→提交 的可追溯视图（文本版 Inspector） |
| `/regress:track` | 对比 git diff 发现 F3 并直接回写（AI 完成修改后自动执行，不需用户手动触发） |
| `/regress:uninstall` | 卸载 regress-guard（清理用户级配置 + hook + skill + 命令） |
| `/regress:update` | 检查并更新 regress-guard 到最新版（手动触发；SessionStart 也会自动检测） |
| `/regress:verify` | 跑测试预览结果（提交时 hook 也会自动跑；测试失败 AI 应自行修复重跑） |

<!-- generated: reference end -->

## 副作用声明（透明度契约）

- **执行**：全部钩子为本机 Python 3.10+ 进程（无预编译二进制、无混淆源码）
- **写文件**：项目内 `.regress/`（清单/历史/台账/考古地层）与 `~/.zcode/regress-guard-hooks`（安装副本）
- **命令执行**：仅两类——门禁自跑项目测试运行器（pytest/jest/maven/gradle/go 自动探测）；
  通知通道命令（**仅人工授信项目可配**，未受信一律回退机器级，克隆仓库注入面封堵）
- **网络**：默认零外发。可选拦截通知（企业微信自建应用）——凭据须人工授信且 API 域
  钉官方域；无 MCP、无遥测上传、无第三方分析
- **Hook 面**：PreToolUse（提交门禁/边界守卫/执行阀）、PostToolUse（清单回写桥）、
  UserPromptSubmit（治理上下文）、SessionStart（自愈）、Stop（轮末警示）
- **逃生**：`/regress:bypass N` 分钟级限时赦免（留债审计）；各特性独立 env 开关
