---
description: 收尾流水线：track 回写 → verify 全证据 → 代谢沉淀 → 状态推进 → 汇总报告（一条命令走完收尾，人只出现在决策点）
argument-hint: [manifest-id]
allowed-tools: Read, Write, Edit, Bash, Grep
---

# /regress:finish — 收尾流水线

实施完成后的一条命令收尾：**track → verify → 代谢沉淀 → 提交就绪**。
流程段之间没有人肉粘合剂——中间不需要人，人只出现在两个决策点
（残留 open/flagged 的处置、提交本身）。

找最新 `status != done` 的清单（或用 `$ARGUMENTS` 指定 id），依次执行：

## 步骤 1：track（F3 回写 = 扩界留痕）

按 /regress:track 的完整规则执行：`git diff` + 未跟踪文件对比清单，
F3 直接回写 `actual_changes`（这是开发边界的扩界出口，留痕）。

## 步骤 1.5：自审 diff（v1.41：触发表激活，防空转）

**通读 `git diff`（staged+unstaged），三类各扫一遍**——改错自己写的 diff
只有自己通读才能发现。键按触发表激活（不适用=键不出现，「无」=查过没有）：

- **计划外**（触发：actual_changes 非空）：F3 回写的每个计划外文件——是有意
  扩界还是顺手带上？值=逐文件一句结论或「无」
- **调试残留**（触发：diff 命中 print/console.log/debugger/pdb 且非 tests/）：
  是断言所需的输出还是忘删的探针？值=条目或「无」
- **顺手重构**（无机器触发，纪律位）：计划内文件里夹的函数重命名/移动——
  发现了记进报告（拆批或明示），不静默混入

落产物：清单 frontmatter `self_review:` 下对应键。**提交门禁会拦**
（reason=finish_missing）：触发的键缺失过不了 commit——防"三类全填无"的
形式化由触发表承担（不触发不用填，触发了必须看过）。

## 步骤 2：verify（全证据）

按 /regress:verify 的完整规则执行：

- 跑项目测试——失败自己修再跑；**修复 3 次仍败或需要输入 → 先分流再受阻**：
  知识型阻塞（用法/取舍/报错不懂）先带四问去 consult，顾问能解则继续（标注采纳情况）；
  环境/权限型或顾问不能解 → `plan_approve.py <清单> --block --reason --need`
  （tried 里写明顾问意见），把 need 转达人类，流程到此暂停
  （受阻是合法停止，不是 finish 失败）
- 逐条脆弱点：带 `rescue:` 的失败**先自救再重试**；通过 → `locked`；
  sensory 类 → 问人一个布尔问题，`human_check` 化石落档后转 locked（verify 写
  `human_check:<vid>`，门禁验化石存在性不复跑感官）；
  **验收标准表逐条拿证据（v1.25）——"根治/完成"必须能指回判据，指不回去不许说**；
  实测证伪假设 → 「假设失效记录」+ 地层化石；显式不处理 → `flagged`（写明知悉原因）
- env.lock.json 漂移检测（漂移了要在报告里标红）

## 步骤 2.5：DoD 自检 + 弹性打磨（v1.35：跑通≠完成）

先自检后打磨——**有缺口才打磨，没缺口不强求一轮仪式**（防僵硬，顾问修正）：

1. **DoD 自检**：对照清单「DoD 状态完备性」表（UI 功能）逐状态问"真渲染看过吗"；
   对照「广度矩阵」伴侣清单逐项问"声明与实现一致吗"。全部有证据 → 直进步骤 3
2. **弹性打磨**（自检见缺口才启动）：对缺的状态/粗糙点补一轮——文案、对齐、
   加载反馈、空态引导、交互一致性（frontend-design / ui-ux-pro-max Skill
   在此适用）；补完的证据回填 DoD 表
3. **缺口不清零的出口**：补不了的转 `flagged`（写明为什么本期不做），
   并把缺口写进模块卡片「已知缺口」栏——缺口要么修、要么挂牌、要么进卡片
   待办，三选一，不许蒸发

## 步骤 3：状态推进（机器判据，不由感觉）

- **全部脆弱点 locked/flagged + 测试绿** → 无需手动改 status：直接提交。
  commit 门禁自跑测试复验，通过时自动写 `status: done` + `test_verified_by: hook`
  ——done 是门禁发的，不是自称的
- **有残留 open** → 这是人的决策点，两条路摆给用户：
  ① 列出每条 open，说明锁死还差什么证据；② 显式 flagged（写明知悉原因）
  用户不表态不继续——摆完即推送：`notify.py . finish_open --title "🏁 收尾待决 <id>" --body "<open 清单一句话>"`

## 步骤 4：代谢沉淀位（v1.24：任务结束必过，有料沉淀无料跳过）

任务收尾即代谢入口——规律不靠人想起来才沉淀（病例：v1.23 排障纪律靠人类推动才固化）：

```bash
python3 "<插件路径>/hooks/scripts/lib/journal.py" . digest
```

- **digest 非空 / 本次有 rescue 回填 / top_f3 有新共变** → 执行 /regress:learn 的沉淀
  流程（规律入 AGENTS.md 标记块 + `rules_ledger.py . record` 记账），汇报新增规律条数
- **机器级分支（v1.31）**：沉淀里若有机器味事实（服务器拓扑/通道/环境坑/跨项目工具坑）→
  `python3 "<插件路径>/hooks/scripts/lib/facts.py" record "<标题>" "<一句话+验证命令>" [域]`
  （同键重录自动刷新日期；落 ~/.zcode/skills/machine-facts/，跨项目可借，人类无感）
- **模块卡片回写（v1.35 起；v1.40 升机器位）**：本任务动了用户可见能力/模块结构 → 更新
  `.regress/product-arch.md` 对应卡（完成度提档/能力增行/缺口增删/依赖变化；
  顺手校对卡上的验证路径还走得通吗）；重大选型若发生在实施中 → 补 ADR。
  纯内部零结构变化 → 报告一行「卡片无变化」。
  **提交门禁会拦**（v1.40 规则B）：staged 有结构性增删/改名而卡片未随同 staged →
  block（病例：028 新增桥脚本卡片 8 天未回写无人拦）；纯脚手架确不需进卡 →
  清单 scan 加 `card_sync: false` 并写明理由
- **验收行勾选（v1.55 升机器位）**：M/L 清单「## 验收标准」每行验证过后行尾加
  `✅`——done 盖章时门禁校验全勾（缺节/未勾/占位/判据缺（验：命令）都拦）；
  纸面验收不是反馈，勾过的才算数
- **顾问采纳落账（v1.49）**：本批评审带顾问意见 → 落一条 advisor_adoption
  事件（journal add advisor_adoption，adoption ∈ adopted/partial/rejected）——
  与回复中的标注义务同源（回复里写「已咨询第二意见：采纳」，台账里也要有同条），
  采纳率在 /regress:stats 第 10 项可查
- 全空 → 报告一行「无可沉淀，代谢跳过」——不硬凑
- 顺带跑 `rules_ledger.py . health`：命中 ≥3 的稳定规律输出「建议固化 skill」卡片
  （🦴 经人批准后用 skill-creator 固化——**自动固化的错误经验会以技能的形式高速复发**）

## 步骤 5：产物干净检查（v1.27：学费随分支走）

```bash
git status --porcelain .regress 2>/dev/null
```

- 非空 → 汇报「.regress 有 <n> 项未提交——清单/地层/决策是学费，随分支走才不丢
  （worktree 场景：remove 前未合并 = 蒸发）」
- 命令失败（非 git 项目）→ 报告一行「产物层无版本保护（非 git），地层只活在
  单份工作区」，后续不重复提醒
- 双仓库项目（.regress 与代码分属两仓，如 dogfood 工作区）→ 在 .regress 所属仓库执行

## 步骤 6：汇总报告

```
🏁 收尾完成 · REGRESS-<id>
  改动：F1/F2（计划内）+ F3 × <n>（已回写留痕）
  脆弱点：<n_locked> locked / <n_flagged> flagged / 0 open
  测试：<passed>/<total> 通过<+覆盖率>
  债务：<tech_debt> 笔 bypass 未补回归（>0 要提示还债）
  环境：<与 env.lock 一致 或 ⚠️已漂移：项>

可以提交（门禁复验后自动标 done）。
```

**离场召回（v1.31.1）**：汇总输出后推送 done 事件——离场人类靠它知道"回来收货"：

```bash
python3 "<插件路径>/hooks/scripts/lib/notify.py" . done --title "🏁 完成 <id>：<需求一句话>" --body "<manifest 的 requirement 原文：任务内容简介>｜测试 <passed>/<total>｜债务 <debt>｜<残留或干净>"
```

（一条/任务，频率天然低；干净收尾与 finish_open 二选一触发，不双响。
标题只写任务名——【项目名】前缀与 🕐 时间由 notify 层自动注入，v1.31.2；
正文首位放任务内容简介（requirement 原文，不另行改写——离场人类回看时知道
"这任务是干啥的"，不用回来问），v1.31.2 补。）

## 自主决策

长任务心跳（P1#13 接线）：授权自主推进的任务，每完成一个阶段边界（单个 F 落地/
半小时过半）推送一次——人不在屏前也看得见进度，治"两小时黑箱"：

```bash
python3 "<插件路径>/hooks/scripts/lib/notify.py" . progress --title "⏳ 清单id·阶段n" --body "本阶段一句：动了什么/下一阶段"
```

- 清单已是 done/completed → 报告"已收尾"，只输出债务/漂移检查
- 测试全绿但用户不在场 → 报告就绪状态并停，不代答 open 的处置
- 小改动收不了尾（无清单）→ 提示下次走 /regress:quick 或先 /regress:plan
