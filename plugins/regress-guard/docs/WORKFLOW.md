# 工作流

> 自动触发为主，人类只在决策点。命令无需手动召唤——说需求即可（v1.12 起计划
> 待人类批准，v1.17 起收尾有流水线）。

## Full 模式（团队/大需求）

```
说需求（自然语言，无需敲命令）
      ↓ UserPromptSubmit 钩子提示 AI 走 plan 流程（含 /regress:init 自动兜底）
/regress:plan 逻辑       → 清单（F1/F2 + 脆弱点拓扑 + 边界 + 实施顺序 + 验收标准/设计取舍/用户所见草图；产品需求读产品上下文卡；修 bug 类先过假设账本），status: planning
      ↓ （顾问预审=方向四问（方向/脆弱点/边界/产品适定——产品适定必带搜索）+判据三问（判据三件齐/When 可观察/验命令可复跑）；有方向性异议必等人）
📋 计划卡片 → 人类 30 秒：批准 / 修改 / 取消      ← 人类决策点 ①
      ↓ plan_approve.py：status→in-progress + approved.at 落产物
      ↓ （预授权任务无异议可 --provisional 临行，进否决窗）
[AI 开发]                ← 边界守卫事前拦截越界编辑；受阻则四问落产物
      ↓                    （人类决策点 ②：给 need 所需的输入/权限）
/regress:finish          → track 回写 F3 → verify 全证据（rescue 自救/感官问人收布尔）→ 代谢沉淀 → 产物干净检查（产品否决已埋 design_rejected 化石）
      ↓                    （人类决策点 ③：感官终验 human_check）
git commit               ← 门禁自跑测试 + locked 复验，通过自动写 done
```

**长任务进度心跳（v1.33 企业级）**：授权自决策任务预计 >30 分钟时，每个阶段边界
（F 项完成/测试转绿/进入下一段）推一条 `progress`——离场人类看到的是"⏳ 进度：
F1 完成，进入 F2"，而不是两小时黑箱后一声终响：

```bash
python3 "<插件路径>/hooks/scripts/lib/notify.py" . progress --title "⏳ 进度 <id>：<阶段一句话>" --body "<下一步是什么>"
```

**企业级推送覆盖（v1.33）**：决策类=plan_approval/blocked/sensory/finish_open/🦴固化候选；
进程类=done（收尾）/progress（心跳）/💬每轮回复；元层=链外看门狗
（systemd timer 每小时体检治理链，死亡时独立报警腿：deploy/watchdog.sh）；
通道故障=全通道失败时本机声音兜底 + 发送台账（~/.zcode/wecom-send.log）可审计。

## 智能体通道定界（v1.28.1，实测）

ZCode 智能体（Agent 工具）的子代理**不受 PreToolUse 治理**（边界/先读后改/执行阀
均不覆盖——2026-09-03 对照实验实锤；业界同构：Claude Code #34692 早期同样形态，
后以"钩子在子代理内触发+载荷带 agent 身份"收口——我们的钩子是 config 级，
宿主跟进后覆盖自动延伸）。纪律：**子代理只做只读分析，写操作归主智能体**。

## 旁路矩阵（v1.29：状态改变通道 × 治理覆盖）

| 通道 | 覆盖 | 依据 |
|---|---|---|
| 主智能体 Edit/Write/ApplyPatch | ✅ 拦截（活体实证） | planning 阻断活体首证 |
| 主智能体 Bash 写目标（rm/mv/cp/tee/truncate/touch/sed -i/dd of= 及 >、>> 重定向） | ✅ v1.29 收口（高置信形态；2> 与 /dev/null 豁免防误拦） | 病例：rm 删边界内文件零拦截；37 项单测 |
| 主智能体 Bash 不可逆命令 | ✅ 执行阀（活体实证） | dd 字样拦截首证 |
| 子代理工具调用 | ⚠️ 定界（宿主领土，见上） | 对照实验实锤 |
| MCP 工具写文件 / 浏览器改外部状态 | ⚠️ 未测定界 | 待病例 |
| 无活跃清单时的任意编辑 | ✅ fail-open（设计语义） | 无边界信息不锁人 |

## git worktree：独立任务舱（v1.27，实测于临时仓）

`git worktree add` 出的每个工作目录是一套独立治理（2026-09-03 四项实测）：
无 `.regress` 的 worktree 守卫放行（fail-open）；自建 `.regress` 后哨兵/边界/
清单自成一体，主仓清单互不可见——base_head 漂移也不会被其他舱的提交污染。
产物层随分支走，**merge 即知识回流**；注意三点：

- worktree 清理前先确认 `.regress` 变更已随分支提交（finish 步骤 5 会检查——
  未合并就 remove = 学费蒸发）
- journal 同位置追加在两个舱都写过时 merge 必冲突：两边都保留即可
- 边界交叉（两个舱都含同一文件）留给 git merge——冲突检测是 git 的领土

## 多会话同仓（v1.34 会话作用域）

worktree 是**物理隔离**；不开 worktree、多会话直接并行同一仓库时
（2026-09-07 五标本：门禁被他人清单挡/git add -A 扫走他人暂存/清单号
竞争/版本碰撞/活体编辑竞态），治理按**会话归属**切分：

- **身份**：钩子进程带会话 env（Bash 工具进程不带）。UserPromptSubmit
  每轮把它写进会话中继（last-writer-wins，原子写）；plan_approve 批准/
  临行/受阻时给清单盖 `session:` 戳——中继优先，env 兜底
- **门禁**：mine=无戳或戳==本会话；env 缺失时全部视为 mine（老行为）。
  他人清单只在本提交 staged 撞其清单文件时拦（跨会话冲突=集成态检查），
  否则放行+警示——他人清单不再挡你的提交
- **边界**：编辑撞他会话活跃清单边界 → 拦+对焦提示（冲突只在集成点
  现形，编辑时对焦比提交后回滚便宜）；无戳清单保持共享语义
- **哨兵视图**：`python3 hooks/scripts/lib/sentinel.py`——活跃清单 ×
  会话归属 × 悬停时长 × 多会话文件重叠，提交前扫一眼
- **已知边界**：中继错归属一拍时，错向是"自己的清单被当他人的"
  （拦截可见可修），不是静默放行；清单号竞争/他人 git add -A 扫暂存
  仍靠 git 自身与事后审计（F3 检查以我的清单为基准，他人文件天然不在
  我清单内→拦，方向正确）

并行子代理开发的移交界面见 [subagent-playbook.md](subagent-playbook.md)

## 原生计划模式桥（v1.39：批准点对齐）

ZCode 原生计划模式的批准由 plan_bridge 钩子自动转录成治理清单——两条批准
通道，产物层只有一份：

```
ExitPlanMode(计划原文) ──批准──→ PostToolUse → 转录+盖章原子完成
                       ──拒绝──→ PostToolUseFailure → 零残留 + design_rejected 化石
```

- **幂等键** = session + plan_hash：重复事件 no-op；计划修订整档重写（落 plan_refined）
- **双轨合一**：同 session 已有 /regress:plan 的 planning 清单 → 直接盖章它
- **顾问预审豁免有据**：原生批准时人刚逐字读完计划=意图裁决（顾问否决权
  为保护不在场者，人在环即最高裁决）
- 边界从计划文本尽力提取（cap 12），提取不到留空——F3/track 扩界留痕兜底
- 双重防御：成功事件内含拒绝语义（tool_response 特征）也按拒绝处理（拒绝
  载荷语义未证，failure 事件与 response 特征双保险）
- 注册漂移：脚本在而 config.json 未注册时 self_heal 警示（不自动改用户配置），
  修复出口=重跑 install.sh；钩子未生效时 AI 按契约条款 1 补转录（幂等无害）
- **回执（v1.52 试验位 → v1.79 转正默认开）**：转录成功向对话注入一行
  additionalContext（agent 和人都看得见桥在工作）——PostToolUse 契约已经
  ZCode 3.14.0 开源源码证实（hookEventName 严格匹配/唯一 stdout JSON）；
  `RG_PLAN_BRIDGE_RECEIPT=off/0/false` 逃生

## 推送闭环（v1.34：广播 → 可度量可校准）

决策型推送（plan_approval/blocked/sensory/finish_open）送出即落
`~/.zcode/regress-pending.jsonl` 待决台账（正文带〔待决#N〕）；人类回
「有用/误报/忽略」，agent 记 `pending.py resolve <N> <outcome>`——
误报率是推送策略的校准指标（防 alert fatigue：噪音推送腐蚀信任，
与「该推没推」是对称的病）。观察仪表盘：

```bash
python3 hooks/scripts/lib/notify.py stats   # 送达率 + event 分布 + 待决/误报率
```

发送台账（~/.zcode/wecom-send.log）v1.34 起带 event= 维度；轮末提醒 v1.38
起是独立 `chat` 事件（曾冒充 done——台账 done×375 几乎全是轮末提醒，真 done
仅 3 次）。blocked 推送按「项目+清单 ref+拦截原因指纹」合并（v1.38）：同键
未决 30 分钟窗口内折叠不重发、不重记账，只追加旁路行进 stats（治了多少轰炸
要看得见）——病例：另一项目同清单 6 分钟 6 连推，主动制造 alert fatigue。

## Fast 模式（个人/小改动）

```
[先改好代码]
      ↓
/regress:quick <需求>    → 基于 diff 生成清单（全 actual）
      ↓
git commit               ← 门禁跑测试，通过放行
```

## 测试结果缓存（v1.85：同树重试不重跑全量）

门禁跑全量前先查 `.regress/test-cache.jsonl`：键=测试目录所在 git 仓的
组合哈希（HEAD+status porcelain+diff 补丁+未跟踪内容，`.regress/` 排除）。
TTL 4h 内同键有通过记录 → 跳过全量（stderr ♻️ 复用 + `commit_passed` 事件
带 `cached:true`/`cache_key`）；真跑通过才落账（只缓存通过，上限 50 条）。

立场（顾问裁）：**优化位，非安全边界**——命中大声可审计；伪造缓存者本有
更廉价的 `/regress:bypass`。关闭：环境变量 `RG_TEST_CACHE=off` 或
`.regress/config.json` 的 `test_cache.enabled: false`（ttl_minutes/max_entries
同节可调）。验收环（EARS 勾验）不受缓存影响——它读清单，不读树。

## 特征测试（v1.45：改无测试老代码前先钉住现状）

`/regress:characterize <文件>` 五步：枚举公开入口（私有/外部服务依赖标"不可钉"）
→ **探针真跑**三类输入（典型/空值/边界）落 JSON → 生成断言**真值**的 golden
master pytest（浮点 approx/异常只记类型）→ 跑绿=行为已钉 → 回写 F3+脆弱点
`kind: machine`。证据律沿用：断言探针捕获的真值，不猜 AI 以为的值——
不 mock 外部服务（mock 出的行为不是现状，钉了也是假钉）。

## Bypass 模式（紧急 hotfix）

```
/regress:bypass 10       → 10 分钟赦免窗口（边界/门禁统一放行，赦后记债）
      ↓
git commit               ← 放行（审计日志 + 技术债记账，测试通过的提交才还债）
      ↓
（到期自动恢复严格模式；逾期未还会被哨兵点名）
```

## 信任链

hook 在 commit 时**自己跑测试**（自动探测 jest/pytest/maven/go test）：
- **测试通过** → 写入 `test_verified_by: hook` + `status: done` → 放行
- **测试失败** → 阻断，列出失败用例
- **无测试运行器** → 回退到检查清单 status（降级信任）
- **locked 脆弱点** → 门禁复验 verify 命令（证据律：locked = 此刻能过）；
  sensory 类验 human_check 化石存在性，不复跑感官

## 状态机（v1.20）

```
planning ──批准/临行──→ in-progress ──→ verifying ──门禁测试过──→ done
   │                      │    ↑
   │取消                  受阻 └─解阻
   ↓                      ↓
 cancelled ←──────────────（临行任务否决窗内可取消；正式批准的任务走受阻/完成）
```

`done` 由门禁写入（测试通过时），不由 AI 手动标记。blocked 期间边界守卫拦编辑。

## 责任矩阵（谁做什么）

| 角色 | 职责 | 触发频率 |
|---|---|---|
| **人类（ZCode 外）** | 物理动作（权限/凭据/真机）、感官感知（听/看）、意图理解（批卡前的 30 秒） | 按需 |
| **人类（ZCode 内，必做）** | ①说需求 ②批准/修改/取消卡片 ③答 flagged 疑问 ④转达受阻输入 ⑤感官终验一个词 | 每任务 4-5 句 |
| **人类（ZCode 内，罕见）** | `/regress:install`（新机一次）、`/regress:bypass`（紧急）、否决临行（"停"） | 一次性/紧急 |
| **AI（可被对话引导）** | 需求解析/脆弱点拓扑/清单与卡片/写码修测/越界找路/知识型先问顾问/finish 收尾/提交 | 全程 |
| **hook（铁律层）** | 边界拦截/执行阀/门禁自跑测试/证据律复验/哨兵/地层采集/自愈升级/老项目迁移 | 全程无感 |

人类**不需要**做的：说"提交"（AI 自提）、init/plan/track/verify/finish/resume（自动或哨兵指路后 AI 自跑）。

三原则：物理世界的动作只能人做；意图的裁决只能人做；其余默认自动且人可随时介入。

## 自迭代协议（v1.43：两次实战后固化——批2/10 自迭代 run）

自迭代≠自批准（同模型审自己=相关错误整队穿透）；它的形态是**临行机制的成批运用**：

- **授权句式**：`自迭代，N 批`（有界预授权）或 `自迭代，按照你的思想来`（默认 1 批+
  检点回报——首跑校准用）。可加目标与停止条件。
- **否决窗**：整个 run 一个大否决窗——人类随时说"停"；任一批被顾问拦或受阻即停。
- **批内全治理环不豁免**：清单→顾问预审（队列级 consult 一次覆盖+批级引用化石，
  新决策点才追加咨询）→临行→实现→门禁→发布→done 推送→落账。
- **检点节奏**：首跑 1 批即检点；多批 run 在中点做方向检点（复利目标漂移——顾问
  每次只看一份计划，没人查"N 批加起来还在服务原目标吗"——是人检点的唯一职责）。
- **任务来源**：业界对比优先级清单 / decisions 排队项 / 观察项，AI 自选自报。
- **停止条件**：N 批完成 / 顾问拦 / 受阻 / 队列价值耗尽（宁缺毋滥——恒零键删除
  原则同样适用于批）。
- 每批一条 done 推送（离场人类的进度信号）；run 结束出综合检点报告。
- **run 制已验证三形态**（1 批校准制 / 10 批有界制 / 3 批密集制 / 10 批混合制
  含研究批）：研究批（结论落 decisions + 后续批号）是合法产物形态——宁缺毋滥
  的意思不是硬凑代码，是"没代码结论也是交付"。run3（v1.56→1.64）另证两条
  操作纪律：FP verify 须选 15s 内的快子集（全量门禁套件超 5.6 窗口）；被门禁
  拦的是整条工具调用——同命令行里的 git add 不会执行，提交前必须 git status
  核验暂存完整性。

### 自迭代轮收尾检查

自迭代 run 每批收尾（含研究批）过一遍三行：

1. **卡片对齐**：product-arch.md 的模块卡片与本次结构性变更对齐了吗
   （新增/删除/改名/契约变化，验证路径仍走得住）？
2. **焦点重写**：frontier-focus.md 的焦点还指向真前沿吗（被本批改变的
   要重写）？
3. **记忆索引**：MEMORY.md 相关条目刷新了吗（新决策/新踩坑入条）？

动机（2026-09-21 标本）：自迭代模式绕过 finish 代谢位 + 双仓拓扑规则 B
对嵌套仓提交失明 → 卡片停更 v1.83 被对齐审计逮住——自迭代的收尾纪律
不能只靠"批内全治理环"自觉，run 级另设此明文检查位。

## 无感层（自动，零操作）

（v1.81）分发双轨：marketplace 就绪（marketplace.json+hooks 全插件根相对）——
用户可经个人市场源一键安装（插件开关/升级走宿主原生）；开发轨 install.sh 不变。
两轨只取其一（同装双钩子）。

（v1.80）UserPromptSubmit 治理上下文前置：每轮对话注入活跃清单边界行+规律账本
TOP-1 召回行（`RG_PROMPT_CONTEXT=off` 逃生）——防线从"拦截时才教育"前移到"开工前就看见"。

（v1.78）Stop 级版本漂移警示：每轮收尾顺带比对已装副本与源仓版本，新漂移对
首次出现 stderr+chat 各一（消除前不重复）——SessionStart 只跑一次的时代盲区补上。

- 会话启动：自愈/自动升级/老项目迁移/活跃清单哨兵（指路 /regress:resume）
- 编辑时：先读后改 + 文件指纹 + 边界拦截（AI 是第一现场，人看到的只是行为变好）
- 失败/风险/纠正：自动入考古地层，跨会话可考古
- 断点续作：`/regress:resume` 一句话重建现场
- 机器级经验：finish 代谢缝自动落机器事实卡（v1.31，见下节）

## 产品+架构层（v1.35：治"跑通即终点"）

对话式开发的产品功能深度/广度瑕疵有四个结构性根因：计划从单一视角推导
（无角色枚举/无伴侣功能/无竞品对照）、首版即终版（无 DoD 状态完备性）、
AI 看不见渲染结果（代码审查发现不了空态尴尬）、架构盲区（无连接点地图、
选型理由随对话蒸发）。四个机制对四因：

| 机制 | 挂点 | 机器强制 |
|------|------|---------|
| 广度矩阵（角色×任务+伴侣10项+竞品，每行配验证路径） | plan 4.9 → 清单「广度矩阵」节 | 卡片行 + 伴侣留空=没想过 |
| DoD 状态完备性（空/错/载真渲染看过） | plan 脆弱点 kind=product → verify | **open 挡提交**（搭脆弱点既有强制） |
| DoD 自检+弹性打磨 | finish 步骤 2.5 | 缺口三选一（修/挂牌/进卡片），不许蒸发 |
| 模块卡片（完成度/能力/依赖/契约/缺口/验证路径） | init 生成 → finish 回写 | 验证路径走不通的卡=过期卡 |
| ADR（context/options/decision/红线） | plan 4.10 → `.regress/adr/` | 红线=grep 类 verify 进 arch 脆弱点 |

知识层配套（装机 Skill，流程层仍以上表为准）：brainstorming/writing-plans/
TDD/systematic-debugging/verification-before-completion/executing-plans
（superpowers 六件）、frontend-design（Anthropic）、office-hours（YC）、
ui-ux-pro-max。

## 全貌+对齐层（v1.40：理解是强制产物，对标 spec-first）

行业对标（Kiro/spec-kit）：spec-first 的本质是理解本身成为强制产物。我们的
等价实现是机器位，不是仪式位（病例：028 新增桥脚本而模块卡片 8 天未回写、
两批跳过 finish 卡片步骤，无机器拦——纪律对狗food实践者本人都会漏）：

| 机制 | 挂点 | 机器强制 |
|------|------|---------|
| scan 三行（入口/测试/动的哪张卡） | plan 步骤 4 清单 frontmatter | **M/L 缺任一行门禁拦**（规则A，空值/占位不算） |
| understood_intent 三件（复述/边界/判据） | 同上 | M/L 缺件拦——复述=行业对齐标配 restatement |
| 卡片新鲜度 scan_check（fresh/stale/absent） | plan 步骤 2a | stale 强制重扫受影响卡；absent M/L 先建卡 |
| 结构变更同步卡片（ADR 事件，tests/docs/md 豁免） | 提交门禁 | **全档含 S/quick**：staged 有结构性增删/改名而卡片未随同 → 拦（规则B）；纯脚手架 scan.card_sync: false 显式豁免；无卡片项目警示不拦 |
| EARS-lite 验收行（When…则…验：命令） | 模板验收标准节 | M/L 用；验命令复用脆弱点 verify 惯例 |
| rollback 能力断言（v1.41） | 清单 frontmatter 一行 | **全档必填**；触及迁移/schema/破坏性 SQL（触发表）时"git revert"默认失效须真答案 |
| self_review 触发表键（v1.41） | finish 步骤 1.5 → 清单 | 键按触发激活（计划外=actual_changes 非空；调试残留=diff 命中模式且非 tests/）；不适用=键不出现，「无」=查过没有——堵空转根源 |

分工逻辑：**S 档豁免的是全貌仪式（规则A），不豁免结构纪律（规则B/rollback）**——
新增/删除/改名文件本就不是"轻量内部改动"。对齐层的歧义检测/假设账本/广度
矩阵不动（已是强项）；本层补的是它们的原材料新鲜度——看不全就对不准。
收官原则（v1.41，顾问）：字段不可验又无后果必空转——**硬化接引信（rollback
默认在逃逸面失效），不接解释（self_review 不触发不填）**；校准看机器代理
（revert 实际率/计划外对上 F3 率），不看填无比例；恒零键删除不措辞。

## 供应链层（v1.42：门禁只验测试不够，还要验安全）

业界用三个真实 CVE 论证 hook 治理必要性（Endor Labs）——本层补密钥与依赖两面：

| 机制 | 机器强制 |
|------|---------|
| secret_scan（gitleaks-lite 零依赖） | 扫 staged **新增行**（历史密钥是全仓审计工具的职责）：高精度模式（AKIA/ghp_/私钥块/xox/AIza/sk-）不豁免任何路径——真密钥漏在测试里也是漏；通用 key=value 对 tests/ 与 *.md 豁免；命中 → **拦**（bypass 唯一出口）；文档示例串内置允许表 |
| 依赖审计（best-effort） | 锁文件 staged 才触发 `npm audit --json --package-lock-only`（解析漏洞计数只认 high/critical，不信 exit code——顾问修正）；**infra fail-open**（工具缺/超时/网络败 → warn+留痕），**findings fail-closed**（高危才拦）；非 npm 锁 v1 提示人工审计 |
| 降级 | `supply_chain.secrets/deps=false`（沿用 strict 降级先例）；`supply_chain.allowlist` 项目级追加 |
| 项目级 channels 信任（v1.66/1.67/1.68） | 项目 channels 仅机器侧信任表（`~/.zcode/regress-trusted-projects.json`）内项目可用，未受信回退机器级通道+stderr 提示；**授信=人工编辑该表**（`notify.py trust` 只读视图）；**信任解析零环境变量影响（v1.68）**——表路径经 passwd 数据库派生（HOME 间接层同封），RG_TRUST_PROJECT_CHANNELS/RG_TRUSTED_PROJECTS 缝已删（git commit 前缀注入即旁路，测试迁 monkeypatch 模块属性）；**内容钉（v1.72）**：边车 `regress-trusted-projects.fpr.json` 快照受信项目 notify 块——敏感面（channels/wecom 凭据/外发名单）变更即拒回退，人工出口=刷新信任表时间戳；非敏感变更 TOFU 重钉；部署自举=边车缺失首跑钉现状；共残差=agent 直接写表文件（transcript 可见，人侧定期 diff） |
| 钩子入口 env 白名单（v1.69） | launcher.js 构造洁净子进程环境：白名单只透传系统基础（PATH/HOME/LANG/TZ/TMPDIR）+代理+宿主契约五变量（SESSION/PROJECT_DIR/ZCODE_HOME/PLUGIN_ROOT）——`RG_*`/`WECOM_*`/`GIT_*` 注入在入口层失效（宿主 env 的信任/git 读数干扰整族封死；直接 CLI 调用不受影响，其信任面由 v1.68 表制管） |
| wecom 凭据字段门+基域钉住（v1.70） | 项目级 `wecom.corpid/secret/api_base_allowlist` 覆盖须项目受信，否则回退机器级+提示（克隆仓库携假凭据把通知发往自己企微的洞；`agentid/touser/事件开关`不受限=绑机器凭据的合法覆盖）；`WECOM_API_BASE` 仅许本机桩（测试）或机器配置 allowlist，恶域钉回官方域——凭据 POST 外泄面 |

## 机器事实卡（v1.32：跨项目地层，三层结构）

机器级经验（服务器拓扑/通道/环境坑/跨项目工具坑）不属于任何项目——沉在单项目地层里
别的项目借不到，人类被迫人肉跨会话转述（病例：企微通知任务跨会话交接）。

三层结构（形状由构造保证，不靠纪律维持——调研定稿见 REGRESS-2026-017）：

1. **路由层**：skill 描述常驻上下文，pushy 措辞对抗欠触发（平台官方指导）
2. **索引层**：SKILL.md 触发时加载——只有用法两行+日期倒序索引（recency 一眼可扫），
   `facts.py record` 每次落账后机械重建
3. **本体层**：`references/<域>.md` 按需整文件读，同键重录刷新日期+最新表述为准

三条纪律（涉机器事务时）：

1. **先查卡**：服务器/网络通道/本机环境与工具坑 → 读事实卡索引再动手
2. **否定式断言有保质期**：「没有 X 权限/X 不可用」超过一天，引用前必须复查
   （病例：另一会话已部署 ssh 直连，本会话还揣着几小时前的"无权"前提继续推理）
3. **接手跨会话任务先读 journal 尾部**：落账即交接，人不当传输层

铁律：**事实带日期（=最后验证为真）、只当线索不当结论**——可信但过期的事实带权威性
撒谎（病例：/opt 旧端口文件误导排查）。卡的生死判据在 /regress:stats：长期零新增=死重，
摘掉 finish 分支即退场（机制也要代谢）。

## 降级

- `.regress/config.json` → `"strict": false`：门禁降级为仅警告
- `"boundary_enforced": false`：关闭边界守卫
- `/regress:bypass <分钟>`：限时赦免 + 审计（不可赦名单：执行阀=物理不可逆、先读后改=防盲改）
