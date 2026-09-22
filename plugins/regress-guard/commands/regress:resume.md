---
description: 从 .regress/ 产物层单侧重建工作现场（断点续作，不依赖对话历史）
allowed-tools: Read, Bash, Grep
---

# /regress:resume — 现场重建（产物自足性）

对话会压缩、会丢上下文；产物层（.regress/）不会。本命令**只从产物重建现场**，
不依赖任何对话历史——这是「以产物为中心」的验收标准：
清单 + 地层 + 决策三样在，工作现场就在。

## 执行

### 1. git 现状

```bash
git status --short && git log --oneline -5
```

非 git 项目跳过。有未提交改动 → 列出文件（对照清单判断是半成品还是漂移）。

### 2. 活跃清单逐份读取

`.regress/manifests/*.md` 中 status ∈ planning / in-progress / verifying / **blocked** 的，逐份提取：

- id / requirement / status / created_at
- **blocked 的清单置顶**：读 `blocked` 四问（reason/tried/unsafe_why/need）——
  这是需要人类处理的事，恢复现场第一件事就是把它亮出来
- 脆弱点：open / locked / flagged 各几个（**open = 禁提交**，优先处理）
- **实施顺序对齐**：清单正文有「实施顺序（一步一响）」表时，对照 git diff 与
  已 locked 的脆弱点推断当前走到第几步——下一步从**第一个未达里程碑的步骤**继续
- **老格式回填**：清单正文缺「环境准备/实施顺序/报错自救」段（v1.15 前创建）→
  提示按新模板回填（写给失忆的读者标准），回填本身就是恢复现场的一部分；
  `.regress/` 里没有 README.md → 按模板同步补上零号入口
- 边界 boundary.include
- approved.at（空 = 还没批，提醒人类批准）
- actual_changes 与 planned_changes 的差（F3 回写了几条）

### 3. 决策考古（方向记忆）

- 读 `.regress/decisions.md` **尾部 20 行**：最近的方向纠正、否决过的方案
  （否决过的方案不重新提出——那是已经交过学费的岔路）
- 跨会话慢性失败：

```bash
python3 "<插件路径>/hooks/scripts/lib/journal.py" . digest
```

digest 非空 → 每条签名查 `journal.py . raw` 找历次现场，归纳根因模式。

- 近期关键化石（假设失效 / 受阻 / 解阻——"为什么"层的叙事）：

```bash
python3 "<插件路径>/hooks/scripts/lib/journal.py" . raw | grep -E 'assumption_broken|task_blocked|task_unblocked' | tail -5
```

### 4. 历史指标

```bash
python3 "<插件路径>/hooks/scripts/lib/history.py" .regress summary
```

- tech_debt > 0 → 有 bypass 未补回归，提醒还债
- outside_gate_commits > 0 → 门禁采用率的诚实镜子

### 5. 知识库

读 `.regress/knowledge-base.json`：条目数 + 最近 3 条的问题关键词
（上次查过的攻略直接用，不再查）。

## 输出格式（现场重建简报）

```
🔁 现场重建 · <git 分支@HEAD短sha>

📋 REGRESS-<id>（<status>）：<需求一句话>
   脆弱点：<n_open> open / <n_locked> locked / <n_flagged> flagged
   边界：<include 列表>
   批准：<approved.at 或 "❗尚未批准（planning）">
   改动：<len(planned)> 计划 / <len(actual)> 已回写

📜 最近决策：<decisions.md 尾部要点，至多 3 条>
⛏️ 慢性失败：<journal digest 摘要 或 "无">
💳 债务：<tech_debt> 笔 bypass 未补回归

下一步（按 status）：
   blocked    → 🛑 最优先：把 blocked.need 转达给人类（受阻等待人类输入）
   planning   → 重新输出计划卡片请人类批准（lib/plan_approve.py 转写）
   in-progress→ 对齐实施顺序表，从第一个未达里程碑的步骤继续；脆弱点未锁死的先锁
   verifying  → 跑 /regress:verify 收尾
```

多份活跃清单 → 逐份输出卡片（按 created_at 排序），下一步只列最旧的一份。

## 自主决策

- 无活跃清单 → 读 `.regress/history.jsonl` 最后几条事件，报告"上个任务已收尾"，
  并列出 decisions.md 要点供开新任务参考
- 无 `.regress/` → "本项目未接入 regress-guard，/regress:init 初始化"
- 信息缺失（字段空/文件不存在）→ 跳过该项并在简报中注明，不猜
