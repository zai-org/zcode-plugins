---
name: month-end-close-review
description: A pre-close sweep over the trial balance and the close checklist — blockers separated from warnings, abnormal balances by direction and by ageing, accruals that should exist and do not, cut-off exposure around the period end, and draft entries for what is missing. Triggers on "月结", "关账检查", "这个月能不能关账", "关账前还差什么", "月末结账", "结账清单", "有没有漏提", "month-end close", "close review", "pre-close check".
---

# Month-End Close Review

**先载入 `xlsx-author` 技能，再动手建表。** 出处载体（Class A 的 `Source:` 批注 /
Class B 的 `来源` 表加 `来源编号` 列）、四色含义、「填机构不填接口名」、URL 的两种诚实
写法、交付时的 `::zcode-file-citation`，都在那份 SKILL.md 里。只照路径调它的
`recalc.py` 不等于读过它——2026-08-24 那批里有一份工作簿正是这样，五项全漏。

The question this answers is narrow and it is not 「这个月业绩怎么样」: **can this period be closed, and if not, what exactly is stopping it.** The output is a list a controller works through, ordered so the things that stop the close come first and the things that merely deserve a look do not crowd them out.

The deliverable is a close package workbook. **Its citation vehicle is cell comments** — every balance and every proposed entry names the file, the tab, and where in the ledger it came from.

## Before anything else

Ask for what is missing by name rather than working around it:

- **试算平衡表** with 期初 / 本期借方 / 本期贷方 / 期末 — the minimum, and nothing here runs without it.
- **关账清单** (the company's own checklist, if one exists) — the review is against *their* process, not a generic one.
- **上期试算平衡表**, for the comparisons in Step 4 and Step 5.
- **总账或明细账** for any account the sweep flags — asked for when needed, not up front.
- **会计政策或集团手册**, where one exists.

Settle: entity and consolidation scope, 报告期, **close status** (未关账 / 初步 / 最终), accounting basis, unit and currency.

## Workflow

### Step 1: Parse and read back

Parse with Python (openpyxl / pandas) through Bash. Read back before computing: sheet name, header row, the account-code column, which columns are 期初 / 借方 / 贷方 / 期末, and **the sign convention**.

**Cell comments and notes are source data, not decoration.** Before computing, read every non-empty comment or note and read it back with its sheet, cell, related account or item, and a short summary. Carry that evidence into the close checks, findings, and draft-entry register. Parsing only cell values is incomplete and must not be treated as a full read of the workbook.

Two parsing traps that produce a confident wrong answer:

- **Account hierarchy.** A trial balance often carries 一级 / 二级 / 末级 rows in one column. Summing all of them double-counts. Identify the level and total **末级科目 only**, then prove it by tying to the reported total.
- **Sign convention.** Whether costs and contra accounts arrive positive or negative differs by system and sometimes by tab. Read it back explicitly; every finding below inverts if this is wrong.

List any account you could not classify. Unclassified accounts are named, never dropped.

### Step 2: The arithmetic checks — these run first because everything else assumes them

| 检查 | 关系 |
|---|---|
| 试算平衡 | 借方合计 = 贷方合计 |
| 发生额勾稽 | 期初余额 + 本期借方 − 本期贷方 = 期末余额(逐科目) |
| 层级勾稽 | 末级科目合计 = 上级科目余额 |
| 期初连续性 | 本期期初 = 上期期末(逐科目) |

Any of these failing is a 🔴 blocker by definition and is reported with both figures and the difference. **Do not proceed to interpret balances that do not foot** — every subsequent finding would be built on them.

**And do not investigate them here either.** This step establishes *that* something does not tie; finding *why* is `ledger-reconciliation`'s work, which matches transactions, classifies the difference, and traces it to a voucher. Report the gap, name that skill, and stop — running the decomposition inline would put a second implementation of the same matching logic in the same plugin, and the two would drift with nothing in the build to detect it. Where the failure is 期初不连续 and the prior-period trial balance was provided, say which side moved; that is still a location, not an investigation.

An account that could not be mapped to a caption at all, or a chart that changed between periods, goes to `account-mapping` rather than being resolved by judgement here.

### Step 3: Abnormal balances — direction, then ageing

**方向异常** — a balance sitting on the side it should not: 资产类科目贷方余额, 负债类科目借方余额, 收入类借方余额, 备抵科目方向反转. Each one is either a real misposting or a presentation item that needs reclassification, and either way it is named with its amount.

**挂账异常** — 其他应收款 / 其他应付款 / 预付账款 / 暂估应付 carrying balances that have not moved in several periods, and 往来科目 with the same counterparty on both sides. State the ageing where the file supports it and say so where it does not.

**突变** — an account whose balance moved by an amount that is large against its own history. Rank by absolute size against a stated threshold, and **state the threshold**. An unstated materiality threshold makes the list unreproducible.

Balances are `[披露]`; every difference, ratio, and ageing bucket you computed is `[测算]`; a view on what caused it is `[推断]`.

### Step 4: Accruals that should exist and do not

This is where a close most often goes wrong, because a missing entry leaves no trace — nothing on the trial balance says it is absent.

Work three angles and say which ones the file supported:

- **上期有、本期无.** Any account carrying a recurring accrual last period and nothing this period. This finds most of them.
- **周期性项目.** 折旧与摊销(期数是否连续、本期是否入账), 工资与社保公积金, 利息, 计提的税金及附加, 水电与租金, 年终奖与带薪缺勤. Recompute what the schedule implies and compare with what is booked.
- **合同或台账支持但账上无凭证.** Only where the user provided the underlying schedule; otherwise this angle is `检索范围内未发现` and is reported as not run.

For each gap: the account, the expected amount and how it was computed (`[测算]`, arithmetic shown), the basis, and whether the amount is estimable from the file at all. **A gap you cannot size is still reported** — as a named gap with `n.d.（未提供）` and what would size it.

### Step 5: Cut-off exposure

Cut-off is a judgement, and this skill surfaces exposure rather than deciding it. Where the file supports it: large vouchers within a stated window either side of the period end, 发票日期 against 入账期间, 收入与其对应成本是否落在同一期间, 在途物资与暂估入库.

Report each as an exposure with amounts and both possible periods, labelled `[推断]`, and hand the judgement to the controller. **Do not conclude that revenue was recognised in the wrong period.** Where the voucher-level detail was not provided, say the test could not run.

### Step 6: Grade — blockers, then warnings

Two grades, and the difference is operational:

- **🔴 阻断项** — the period cannot close: the trial balance does not foot, an account does not roll forward, a required accrual is missing and material, a subledger does not agree with the general ledger, a bank reconciliation is unresolved.
- **🟡 告警项** — should be looked at, does not stop the close: an ageing long-outstanding balance, an abnormal direction that is presentational, a movement worth explaining.
- **⚪ 低·信息** — context.

At most five 🔴 items up front. Severity attaches to a finding, never to a person or a department.

### Step 7: Draft entries — a register, not a posting

Every proposed entry goes in a draft register with 借方科目 / 贷方科目 / 金额 / 摘要 / 所属期间 / 依据 / 状态=待复核, and its own cell comment stating the basis.

**Nothing here is posted, and no wording in the deliverable may suggest otherwise** — not 已入账, not 已调整, not 已处理. Where the entry rests on a judgement (an estimate, a cut-off call, a provision), that is `[推断]` and it is marked as requiring the controller's confirmation before anyone books it.

### Step 8: Build the close package, then hand over

Through `xlsx-author`. Use these exact Chinese tab names and order: `试算平衡表` → `算术检查` → `异常余额` → `计提缺口` → `截止性检查` → `分录草稿` → `复核发现` → `说明与局限`. Do not translate them into English, add English aliases, rename them, or create replacement tabs.

Use Chinese for all user-facing workbook text, including titles, section headings, column names, statuses, check conclusions, notes, and the handover summary. Preserve source-system identifiers such as account codes, formulas, filenames, document numbers, and unavoidable proper names as supplied.

Hardcodes appear only on `试算平衡表`, each carrying:

```
Source: <System or Document>, <Date>, <Reference>, <URL if applicable>
```

Name the file, the tab, and the account — `Source: 试算平衡表 TB_202607_预结账.xlsx, 2026-08-03, 二级科目 2202「应付账款」, 内部文件`. Every check and every difference is a live formula, not a typed result.

Visually inspect the rendered workbook for clipping, awkward column widths, and unreadable pagination before delivery.

`算术检查`, all live formulas: 借贷合计相等 · 逐科目发生额勾稽 · 末级合计与上级一致 · 期初与上期期末一致 · 草稿分录借贷各自合计相等且不影响 `试算平衡表`.

Run `../xlsx-author/scripts/recalc.py`, fix what it lists, then audit at **model** scope against the `audit-xls` skill. `recalc_unavailable` is not a pass.

The handover leads with the blockers, then the warnings, then this block, which also sits at the top of `说明与局限`:

```
## 覆盖范围与局限
检索于: [timestamp] · 报告期: [期间] · 口径/委托用途: 内部关账复核
结账状态: 未关账 / 初步 / 最终 · 会计基础: [准则] · 重要性阈值: [金额,及其设定依据]

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 试算平衡 | 借贷相等 / 差异 [金额] | [文件名·标签页] | [date] |
| 逐科目发生额勾稽 | [N] 个科目全部勾稽 / [M] 个不符(已列示) | 算术检查页 | [date] |
| 期初与上期期末 | 一致 / 差异 [金额] / 上期表未提供 | [文件名] | [date] |
| 方向异常扫描 | [N] 项(已列示) / 检索范围内未发现 | 异常余额页 | [date] |
| 缺失计提(上期有本期无) | [N] 项 / 检索范围内未发现 | 计提缺口页 | [date] |
| 缺失计提(周期性项目) | [N] 项 / 部分未能测试([项目]) | 计提缺口页 | [date] |
| 缺失计提(合同台账) | 已测试 / 源不可用(未提供台账) | — | [date] |
| 截止性测试 | 已测试([窗口]) / 源不可用(未提供凭证明细) | 截止性检查页 | [date] |
| 关账清单比对 | 已比对 / 源不可用(未提供清单) | [文件名] | [date] |

本次未能覆盖: [未提供的账表,以及它本应回答的问题]
分录草稿: [N] 笔,合计 [金额],**全部为草稿,状态待复核,均未入账**
会计判断事项: [N] 项已标记待财务负责人确认(截止性 [x] / 计提充分性 [y] / 其他 [z])
公式评估: recalc 已评估 [N] 条公式,零错误 / recalc 不可用,仅做静态检查与独立复算
```

## Guardrails

- **Nothing is posted.** Draft entries live in a register with 状态=待复核 and never touch the `试算平衡表` tab. No deliverable text describes an entry as booked, adjusted, or processed.
- **Arithmetic first.** A trial balance that does not foot invalidates every interpretation built on it; report it and stop rather than analysing balances that do not tie. **Establishing that something does not tie is this skill's job; finding why is `ledger-reconciliation`'s** — name it and hand the gap over rather than matching transactions here.
- **This skill does not close the period and does not decide any of it.** It produces a blocker list, a warning list, and draft entries; the controller decides what is booked and whether the period closes.
- **A test that could not run is `源不可用`**, named as such — never folded into 检索范围内未发现, and never into 无异常. A close review that silently skipped cut-off because no voucher detail was provided reads exactly like one that tested it and found nothing.
- **State the materiality threshold** used for ranking and for the accrual sweep. An unstated threshold makes the finding list unreproducible and invites the reader to assume it was zero.
- **Never plug and never net.** An unexplained difference stays open at its own amount; two unrelated differences are never offset into a smaller one.
- **The accounting judgement is flagged, not made** — cut-off, adequacy of a provision, capitalisation. Name the accounts, the amounts, and the alternatives, then stop.
- Do not invent a balance, an accrual amount, a contract term, or an ageing. What the file cannot support is `n.d.（未提供）` with its consequence stated.
- **State the close status on the face of the deliverable.** A review of a moving trial balance presented as final is worse than no review.
- Confidential, pre-release material. It goes to the controller and the CFO before anyone else.
