---
name: account-mapping
description: A mapping between two charts of accounts — multi-book consolidation, a system migration, or a presentation change — with balance conservation proved rather than assumed, one-to-many and many-to-one relations surfaced for confirmation instead of resolved silently, and every 口径 change named. Triggers on "科目映射", "科目对照", "两个账套怎么合", "新旧科目转换", "科目表迁移", "重分类", "报表口径调整", "合并口径", "chart of accounts mapping", "account reclassification".
---

# Account Mapping and Reclassification

**先载入 `xlsx-author` 技能，再动手建表。** 出处载体（Class A 的 `Source:` 批注 /
Class B 的 `来源` 表加 `来源编号` 列）、四色含义、「填机构不填接口名」、URL 的两种诚实
写法、交付时的 `::zcode-file-citation`，都在那份 SKILL.md 里。只照路径调它的
`recalc.py` 不等于读过它——2026-08-24 那批里有一份工作簿正是这样，五项全漏。

A mapping is not a lookup table someone fills in once. It is a set of decisions about **what a balance means under a different chart**, and most of the value is in the rows where the answer is not one-to-one — those are where 口径 quietly changes and where a total quietly stops meaning what it meant.

The deliverable is a mapping workbook. **Its citation vehicle is cell comments** — every mapping decision names the policy, the prior mapping, or the person that authorised it.

## Before anything else

- **Both charts of accounts**, with 科目代码 / 科目名称 / 科目性质(资产·负债·权益·收入·成本费用) / 层级, and the balances to be mapped.
- **The direction and the purpose** — 多账套合并 / 系统迁移 / 新旧准则或新科目表切换 / 管理口径报表. Each implies different rules, and mapping built for one purpose does not transfer to another.
- **The prior mapping, if one exists.** Reusing it is right; reusing it silently is not (Step 5).
- **The accounting policy or group manual** that governs the target chart.

Settle: entity and scope, 报告期, close status, whether the target chart is 法定 or 管理口径, and the unit and currency.

## Workflow

### Step 1: Parse and read back both charts

Read back for each: the code column, the name column, the hierarchy level, the account nature, and the sign convention. Note the **level** at which balances exist — mapping a parent account while its children also carry balances double-counts, and the total will still look plausible.

**Cell comments and notes are source data, not decoration.** Before computing, read every non-empty comment or note and read it back with its sheet, cell, related account or item, and a short summary. Carry that evidence into the mapping and open-items list. Parsing only cell values is incomplete and must not be treated as a full read of the workbook.

Report accounts present in one chart and not the other, in both directions, before mapping anything.

### Step 2: Classify every relation — the four cases behave differently

| 关系 | 处理 | 是否需人工确认 |
|---|---|---|
| **1:1** | 直接映射 | 否,除非科目性质不同 |
| **1:N**(一个源科目拆到多个目标) | 需要拆分依据 | **是** |
| **N:1**(多个源科目并入一个目标) | 直接合并,但信息丢失 | **是** |
| **无对应** | 新增科目 / 废止科目 / 需新建 | **是** |

**1:N is the one that cannot be automated.** Splitting one balance across several target accounts requires a basis — a subledger, a cost driver, a contract, a historical ratio — and that basis is an input, not something to invent. **Where no basis exists in the file, the row stays unmapped and is reported as such.** Allocating it on a plausible-looking ratio produces a mapping that ties at the total and is wrong at every line.

**N:1 loses detail permanently.** It maps cleanly and the totals hold, so it passes every check — which is exactly why it needs stating: after the merge, no one can recover the split from the target chart alone.

A relation where **科目性质 differs** between source and target (an asset mapped into a contra-liability, an expense mapped into cost of sales) is never routine, whatever the codes suggest. Flag it with both natures shown.

Keep exception amounts distinct. `未映射余额` contains source balances left without a target because a 1:N split lacks a basis or no corresponding target exists. Report a rejected nature mismatch separately as `性质错配阻断金额`; do not fold it into `未映射余额`. If a combined excluded balance is useful, label it `不可执行余额` and retain both category subtotals.

### Step 3: Prove balance conservation — this is the check the whole skill turns on

```
Σ 源科目余额(末级) = Σ 目标科目余额(末级)
```

By account nature as well as in total: assets to assets, liabilities to liabilities, and so on, each closing to zero on the sheet.

**A mapping that changes the total is wrong, and one that preserves the total while moving a balance across natures is worse** — it ties, so nothing raises a flag, and the resulting statements no longer balance for a reason nobody can find later. Report both checks separately.

Where a 重分类 genuinely and intentionally moves a balance across a caption (a long-term liability's current portion, a contra account presented net), it is entered as an **explicit reclassification row with its own reason and reference**, never as a mapping. The distinction is the audit trail: a mapping says "this is that account under a different name"; a reclassification says "we deliberately moved this, and here is why".

### Step 4: 口径 changes — named, not absorbed

A mapping is where scope changes hide. Name every one of these on its own row:

- 总额 vs 净额 presentation
- 含税 vs 不含税
- Whether a caption includes items the source chart kept separate (运费 into 营业成本, 研发 capitalised versus expensed)
- Consolidation eliminations that the target chart expects and the source does not carry
- A period-definition difference between books

Each is `[推断]` unless a written policy states it, and each carries the impact amount where the file allows it to be computed.

### Step 5: Prior mapping — reuse it, and show every deviation

Where a prior mapping exists, start from it. Then produce a **deviation list**: rows added, rows removed, rows whose target changed, and for each, the reason. A mapping that silently differs from last period's makes this period's statements incomparable with last period's, and nothing downstream will detect it — the comparative column simply changes meaning.

### Step 6: The conflict and open-items list

| 待确认事项 | 类型 | 涉及金额 | 谁确认 | 未确认的影响 |

Every 1:N without a basis, every N:1, every nature mismatch, every 无对应, and every 口径 change lands here. **The workbook is not complete while this list is non-empty — it is delivered with the list attached, not with the list resolved by us.** While confirmation remains outstanding, call the result `暂拟映射` or `待确认映射`, never `可执行映射`.

### Step 7: Build the workbook

Through `xlsx-author`. Use these exact Chinese tab names and order: `源科目表` → `目标科目表` → `映射` → `重分类` → `映射余额` → `待确认事项` → `与上期偏差` → `检查` → `说明与局限`. Do not translate them into English, add English aliases, rename them, or create replacement tabs.

`映射` carries, per row: 源科目代码/名称/性质 · 目标科目代码/名称/性质 · 关系类型 · 拆分依据(1:N) · 依据来源 · 状态(已确认/待确认) · 备注.

Use `已确认` only when the source materials contain an explicit confirmation record, with the confirmer and date carried into the evidence. Review by the model does not upgrade a submitted or proposed row to confirmed. Otherwise use `待确认` or `复核未发现异常`; do not write `通过`, `已完成映射`, `可直接出表`, or `无风险`.

Hardcodes only on `源科目表` / `目标科目表` and the balances, each with:

```
Source: <System or Document>, <Date>, <Reference>, <URL if applicable>
```

A mapping decision resting on a policy names the policy and the clause; one resting on a person names the person and the date (`Source: 集团会计手册 v4, 2025-12-01, 第 3.2 节 科目对照表, 内部文件`).

Four font colours (blue `#0000FF` input · black formula · green `#008000` cross-sheet link · purple `#800080` same-sheet link), the four fills (`#1F4E79` header, `#BDD7EE` band, `#D9E1F2` input block, `#F2F2F2` neutral), meaningful borders, numbers right-aligned.

`检查`, all live formulas:

- 源末级余额合计 = 目标末级余额合计 (**closes to zero**)
- 分性质合计相等(资产/负债/权益/收入/成本费用),各自归零
- 每个源科目恰好被映射一次(无遗漏、无重复)
- 1:N 各拆分份额合计 = 源科目余额
- 重分类行借贷相等,且单独小计不与映射混算
- 未映射科目余额合计单独显示(仅含无拆分依据的1:N及无对应),不为零时在结论中显著提示
- 性质错配阻断金额单独显示,不得并入未映射余额
- 层级校验:未同时映射父科目与其子科目

### Step 8: Verify, then hand over

Run `../xlsx-author/scripts/recalc.py`, fix what it lists, then audit at **model** scope against the `audit-xls` skill. `recalc_unavailable` is not a pass.

The handover leads with the open items and the unmapped balance, then the conservation checks, then this block, which also sits at the top of `说明与局限`:

```
## 覆盖范围与局限
检索于: [timestamp] · 报告期: [期间] · 口径/委托用途: 内部科目映射与重分类
映射方向: [源账套/科目表] → [目标账套/科目表] · 用途: 合并 / 迁移 / 口径调整
目标口径: 法定 / 管理 · 结账状态: 未关账 / 初步 / 最终

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 余额守恒(总额) | 归零 / 差异 [金额] | 检查页 | [date] |
| 余额守恒(分性质) | 五类均归零 / [性质] 差异 [金额] | 检查页 | [date] |
| 映射覆盖 | [N] 个源科目全部映射 / [M] 个未映射,余额 [金额] | 映射页 | [date] |
| 1:1 | [N] 个 | 映射页 | [date] |
| 1:N | [N] 个,其中 [M] 个无拆分依据(未映射) | 待确认事项页 | [date] |
| N:1 | [N] 个,合并后明细不可还原 | 待确认事项页 | [date] |
| 科目性质不一致 | [N] 个(已列示) / 检索范围内未发现 | 待确认事项页 | [date] |
| 重分类 | [N] 笔,合计 [金额],依据已具名 | 重分类页 | [date] |
| 口径变化 | [N] 项(已具名) / 检索范围内未发现 | 说明与局限页 | [date] |
| 与上期映射比对 | 偏离 [N] 行(已列示) / 上期映射未提供 | 与上期偏差页 | [date] |

本次未能覆盖: [未提供的科目表、政策或拆分依据,以及它本应回答的问题]
待确认事项: [N] 项待人工确认(1:N [a] / N:1 [b] / 性质不符 [c] / 无对应 [d] / 口径 [e])
**本映射未经确认前不得用于出表**;未映射余额 [金额] 未作任何分配
公式评估: recalc 已评估 [N] 条公式,零错误 / recalc 不可用,仅做静态检查与独立复算
```

## Guardrails

- **Balance conservation is proved on the sheet, in total and by account nature.** A mapping that ties in total while moving balances across natures passes the obvious check and breaks the statements downstream.
- **1:N without a stated basis stays unmapped.** Never allocate on an invented ratio; the result ties at the total and is wrong at every line.
- **1:N, N:1, nature mismatches, and unmapped accounts go to the open-items list for a person to confirm.** This skill surfaces them; it does not resolve them.
- **Mapping and reclassification are different rows with different meanings.** A deliberate move across captions is a reclassification with a reason and a reference, never a quiet mapping.
- **Name every 口径 change** — 总额/净额, 含税/不含税, caption composition, elimination scope, period definition — with its amount where computable.
- **Show every deviation from the prior mapping.** A silent change makes the comparative period incomparable and nothing downstream will catch it.
- Do not invent a target account, a split ratio, an account nature, or a policy. What the file does not support is `n.d.（未提供）` with its consequence stated.
- **Nothing is posted and no account is created in any system.** The output is a proposed mapping for review.
- Confidential, pre-release material. It goes to the controller and the CFO before anyone else.
