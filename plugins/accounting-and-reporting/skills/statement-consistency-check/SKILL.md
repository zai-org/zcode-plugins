---
name: statement-consistency-check
description: Review of a statement set someone else prepared — the balance sheet balances, the income statement carries to equity, the cash flow reconciles to the movement in cash, the equity statement ties, notes agree with the face, and opening figures agree with the prior period — each difference located to the caption and schedule it enters, without rebuilding the statements. Triggers on "三表勾稽", "报表复核", "合并报表检查", "报表对不上", "披露前检查", "报表勾稽差异", "财务报表复核", "statement consistency", "three-statement tie-out", "financial statement review".
---

# Statement Consistency Check

**先载入 `xlsx-author` 技能，再动手建表。** 出处载体（Class A 的 `Source:` 批注 /
Class B 的 `来源` 表加 `来源编号` 列）、四色含义、「填机构不填接口名」、URL 的两种诚实
写法、交付时的 `::zcode-file-citation`，都在那份 SKILL.md 里。只照路径调它的
`recalc.py` 不等于读过它——2026-08-24 那批里有一份工作簿正是这样，五项全漏。

This skill reviews **a set that already exists**. Someone prepared it; the question is whether it holds together and, where it does not, exactly where the break is.

The deliverable is a check workbook. **Its citation vehicle is cell comments.**

## Inputs and output

The minimum input is the statement set exactly as prepared: 资产负债表、利润表 and 现金流量表, with its entity/scope, period and comparative columns, accounting basis, currency/unit, close status, file version, preparer, and preparation date. Include 所有者权益变动表 and notes when they form part of the set. Add the prior-period statements for opening/comparative checks, the trial balance or close package for ledger agreement, and consolidation-elimination workpapers for a consolidated set. A missing optional source limits the corresponding check; it does not authorise reconstruction or an invented conclusion.

The output is one Chinese consistency-check workpaper containing the statements exactly as given, within-statement checks, cross-statement checks, prior-period checks, notes-to-face checks, ledger tie-outs where supported, findings, review status, and coverage limitations. It neither rebuilds nor corrects the statements and never substitutes a revised statement set for the preparer's output.

## The one rule that makes this skill work: do not rebuild the statements

The reviewer's job is to test the preparer's output against itself and against its sources. **Reconstructing the statements from the trial balance and comparing the two reconstructions is a different activity** — it tests our construction, and it systematically misses the errors that matter most here: a mapping decision the preparer made, a caption they composed differently, a note they populated from the wrong schedule. Those are exactly the errors a rebuild reproduces or masks.

Take the statements as given. Test them. Where a break is found, locate it and report it; do not correct it, and do not publish a corrected set — that is `financial-reporting`'s work, on a separate pass, by whoever prepares.

If the statements were prepared by `financial-reporting` in this same session, say so in the handover: 同一会话内编制并复核,不构成独立复核.

## Before anything else

- **The statement set** — 资产负债表, 利润表, 现金流量表, 所有者权益变动表, and the notes, as prepared.
- **上期报表**, for opening figures and comparatives.
- **The trial balance or close package**, where available — used to test the statements' agreement with the ledger, not to rebuild them.
- **合并抵销底稿**, where the set is 合并.

Settle: entity and consolidation scope, 报告期 and comparative period, close status, accounting basis, presentation currency and unit, and **who prepared it and when** — a review with no stated subject version cannot be re-run against the same thing.

## Workflow

### Step 1: Parse and read back — the statements as presented

Parse with Python (openpyxl / pandas) through Bash. Read back each statement's captions, the period columns, the sign convention, and the unit **per statement** — a set that mixes 元 and 万元 across statements will fail ties for a reason that has nothing to do with accounting, and finding that first saves the rest of the review.

**Cell comments and notes are source data, not decoration.** Before checking the statements, read every non-empty comment or note and read it back with its sheet, cell, related caption or item, and a short summary. Carry that evidence into the consistency checks and findings. Parsing only cell values is incomplete and must not be treated as a full read of the workbook.

Keep the evidence type exact: visible cell text is `单元格正文`; an attached Excel note/comment is `单元格批注`. Before citing a source address, read that exact source cell back and verify its sheet, address, caption, value, and comment text. The cited address belongs to the source statement workbook, not to the output row where the value was copied.

Record the file name and version. Every finding below cites it.

### Step 2: Within-statement checks

| 报表 | 检查 |
|---|---|
| 资产负债表 | 资产合计 = 负债合计 + 所有者权益合计;各分类小计 = 明细行合计;流动/非流动划分完整 |
| 利润表 | 逐级结转到净利润;归母 + 少数股东 = 净利润 |
| 现金流量表 | 经营 + 投资 + 筹资 + 汇率影响 = 现金净增加额;各类小计 = 明细行合计 |
| 所有者权益变动表 | 期初 + 本期增减 = 期末,逐列;合计列 = 各列之和 |

### Step 3: Cross-statement checks — where sets actually break

| 关系 | 两端 |
|---|---|
| 净利润结转 | 利润表净利润 = 权益变动表本期综合收益中的净利润 = 现金流量表间接法起点 |
| 未分配利润 | 期初 + 净利润 − 分配 = 期末,且与资产负债表未分配利润一致 |
| 现金 | 现金流量表期末余额 = 资产负债表货币资金 ± 受限资金等调节项 |
| 现金变动 | 现金净增加额 = 资产负债表货币资金期末 − 期初 ± 同一调节项 |
| 权益 | 权益变动表期末合计 = 资产负债表所有者权益合计 |
| 少数股东 | 权益变动表少数股东权益期末 = 资产负债表少数股东权益 |

**Report the cash tie and the explanation status separately.** Where 货币资金 contains restricted balances or items that are not cash equivalents, only an explicit reconciling line in the statement set or an existing reconciliation schedule prepared as part of that set can make the face tie pass. A note may identify why the amounts differ, but it does not insert the missing line into the cash flow statement. Never subtract the note amount, construct an adjusted cash figure, or otherwise complete the preparer's reconciliation. If the difference is supported by a note but no explicit reconciling line exists, report `差额已定位但表内未调节` and grade it 🔴 as a presentation/disclosure defect; do not report `一致` or `处理正确`. An unsupported difference remains `未解释差异`.

### Step 4: Period-over-period checks

- 本期期初数 = 上期期末数, **line by line**, not in total. A total that agrees while lines have moved means the comparative was restated, and a restatement that is not disclosed is a 🔴 finding.
- Caption composition consistent with the prior period. A caption that changed content without a note makes the comparative meaningless.
- Where a restatement **is** disclosed, check that the note explains it and that the restated figures tie.

Run every comparison the supplied evidence supports; do not disable this entire step because a complete prior-period statement set is missing. That absence makes only the comparison to the issued prior-period set `源不可用`. Still compare every supplied representation of the same comparative period — including face statements, note schedules, opening columns, comparative columns, and earlier versions — caption by caption. Equal-and-opposite movements between captions with an unchanged total are a reclassification/restatement candidate, not evidence of consistency. If no disclosure explains the movement, report `比较数调整未披露` as 🔴; do not merely say that the aggregate agrees, and do not decide which caption is correct.

Also scan movements within every statement that supplies both current and comparative amounts. Calculate `本期数−上期数` for every caption, then pair positive and negative movements that are equal or within the stated tolerance, especially between captions that could plausibly be reclassified. Such a pair is a `疑似重分类候选` even when the statement total is unchanged and even when the issued prior-period statement was not provided. Check the notes and other supplied schedules for a disclosure; if none explains the transfer, report `疑似未披露重分类` as 🔴 and name both captions, both period amounts, and both offsetting movements. Do not infer which caption is correct merely from equal amounts.

### Step 5: Notes against the face

Every note carrying a total: does it agree with the caption it supports? Every caption that requires a note under the stated basis: is one present? Cross-references inside the notes: do they point at schedules that exist and agree?

Report each mismatch with both figures and the difference. A note that disagrees with the face is a finding whichever side is wrong — locating which is the preparer's job, and the report says so. Grade it against the stated materiality threshold and its effect on the set: make it 🔴 when material, when it causes another critical tie to fail, or when it creates a material disclosure contradiction; otherwise make a small isolated note-to-face mismatch 🟡. If no materiality threshold was provided, do not automatically make every note mismatch 🔴 merely because it exists; state that materiality was not supplied and use 🟡 for a small isolated mismatch whose amount does not itself make a critical tie fail.

### Step 6: Against the ledger, where the trial balance was provided

Test agreement rather than rebuilding: 报表主要科目合计 against the corresponding 末级科目合计, 收入与成本合计, 资产与负债主要类别. Report differences at caption level with the accounts involved.

Where the trial balance was not provided, this step is `源不可用` and the coverage block says so — the review then tests internal consistency only, which is a materially weaker statement and must not be presented as a clean review.

### Step 7: Grade and locate

Every difference carries: 涉及报表与行次 · 两端金额 · 差额 · 可能进入点(`[推断]`) · 严重程度.

- **🔴** — a set cannot be issued in this state: the balance sheet does not balance, cash does not tie, an undisclosed restatement, a note contradicting the face on a material caption.
- **🟡** — should be resolved: a small unexplained difference, a missing note, an inconsistent caption composition.
- **⚪ 低·信息** — presentation observations.

For a statement set intended for reporting or disclosure, a blank reviewer field, no evidence of review, or no separation between preparer and reviewer is at least a 🟡 control deficiency. Report the missing reviewer evidence and do not downgrade it to an informational observation merely because the numerical statements can still be checked.

**A set with an unresolved 🔴 is never marked 复核通过.** The status is `存在红色事项（待整改）`, and that status stands until someone resolves it — not until the review ends.

Count and report all 🔴 findings, not only unexplained arithmetic differences. Separate at least: `未解释数值差异`, `差额已定位但表内未调节`, `未披露重述/重分类`, and `其他重大披露缺陷`. An explained amount is not resolved when the prepared statements still omit the required reconciliation or disclosure. Do not add overlapping finding amounts into a misleading grand total; where findings overlap, report counts and amounts by category and say so.

### Step 8: Build the check workbook, then hand over

Through `xlsx-author`. Use these exact Chinese tab names and order: `报表原样` → `表内检查` → `跨表检查` → `期初与上期` → `附注与主表` → `与试算平衡表` → `复核发现` → `说明与局限`. Do not translate them into English, add English aliases, rename them, or create replacement tabs. If a statement or supporting source was not provided, retain the relevant check tab and state `n.d.（未提供）`, what is missing, and which conclusion therefore cannot be reached.

Use Chinese for all user-facing workbook and handover text, including titles, section headings, column names, statuses, check conclusions, notes, and summaries. Preserve source-system identifiers such as account codes, formulas, filenames, document numbers, and unavoidable proper names as supplied.

Name the file `三表勾稽检查_[主体]_[报告期]_待复核草稿.xlsx`.

`报表原样` holds the set exactly as received — **not adjusted, not re-mapped, not corrected**. Every check is a live formula referencing it, so re-running against a revised set is a matter of replacing that tab.

Hardcodes only on `报表原样`, each with:

```
Source: <System or Document>, <Date>, <Reference>, <URL if applicable>
```

Name the file, its version, the statement, and the line (`Source: 2026年6月财务报表(报送版v3).xlsx, 2026-07-28, 资产负债表 行次 31「货币资金」, 内部文件`).

Follow the input statement workbook's established font, colour, number-format, and table style where coherent; otherwise use a simple, consistent professional style. Do not impose a fixed font or colour palette. Keep units explicit, numbers right-aligned, failed checks visually distinct, and explanatory text readable.

Run `../xlsx-author/scripts/recalc.py`, fix what it lists, then audit at **model** scope against the `audit-xls` skill — which is also the right tool for interrogating the preparer's own workbook where they supplied it rather than a flat statement export.

Render and visually inspect every workbook tab before delivery. Fix clipping, awkward column widths, unreadable wrapping, hidden findings, and broken pagination. Internal process labels such as `未经视觉验收`, `尚未人工检查`, `程序校验通过`, or tool/runtime status never appear in the workbook; if visual review has not happened, the package is not ready to deliver.

The handover leads with the 🔴 findings and the review status, then this block, which also sits at the top of `说明与局限`:

```
## 覆盖范围与局限
检索于: [timestamp] · 报告期: [期间] · 比较期: [期间] · 口径/委托用途: 内部报表复核
复核对象: [文件名·版本] · 编制方: [部门/人] · 编制日期: [date] · 单体 / 合并
结账状态: 未关账 / 初步 / 最终 · 会计基础: [准则] · 单位与币种: [x]

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 资产=负债+权益 | 归零 / 差异 [金额] | 表内检查页 | [date] |
| 利润表逐级结转 | 归零 / 差异 [金额] | 表内检查页 | [date] |
| 现金流三类合计 | 归零 / 差异 [金额] | 表内检查页 | [date] |
| 权益变动表滚存 | 逐列归零 / 差异 [金额] | 表内检查页 | [date] |
| 净利润三表一致 | 一致 / 差异 [金额] | 跨表检查页 | [date] |
| 期末现金与货币资金 | 一致 / 原表已列调节项 [金额,已具名] / 差额已定位但表内未调节 [金额,🔴] / 未解释差异 [金额,🔴] | 跨表检查页 | [date] |
| 未分配利润滚存 | 一致 / 差异 [金额] | 跨表检查页 | [date] |
| 期初数与上期期末(逐行) | 逐行一致 / [N] 行不符 / 上期报表未提供 | 期初与上期页 | [date] |
| 重述披露 | 无重述 / 已披露并勾稽 / **存在未披露重述** | 说明与局限页 | [date] |
| 附注与表面 | [N] 个附注一致 / [M] 个不符 | 附注与主表页 | [date] |
| 与试算平衡表核对 | 已核对 / 源不可用(未提供试算表) | 与试算平衡表页 | [date] |

本次未能覆盖: [未提供的报表、附注或底稿,以及它本应回答的问题]
**复核结论: 未发现红色事项 / 存在红色事项 [N] 项 — 未解释数值差异 [N] 项[金额]；差额已定位但表内未调节 [N] 项[金额]；未披露重述/重分类 [N] 项[金额]；其他重大披露缺陷 [N] 项。存在任一红色事项时不得标记为复核通过；重叠金额不重复汇总。**
独立性: 由本会话外部提供并复核 / **同一会话内编制并复核,不构成独立复核**
本复核未对报表作任何修改;未重建报表
```

## Guardrails

- **Do not rebuild the statements.** Test what was prepared; a reconstruction tests our own construction and masks the preparer errors this review exists to find.
- **Do not modify the set.** `报表原样` is held exactly as received. Corrections are the preparer's, on a separate pass.
- **An unresolved 🔴 means the status is `存在红色事项（待整改）`**, never 复核通过 and never 无异常. The status describes the set, not the effort spent on it.
- **A note explanation is not a face reconciliation.** Only a reconciling line already present in the prepared set can make the cash tie pass; a note-supported difference with no line is `差额已定位但表内未调节`, not `一致`.
- **Opening figures are checked line by line**, not in total — an agreeing total over moved lines is an undisclosed restatement, which is a 🔴.
- **Missing prior-period statements narrow the unavailable check; they do not erase supplied comparative evidence.** Run every supported line-by-line comparison and flag undisclosed equal-and-opposite caption movements even when the aggregate is unchanged.
- **Scan current-versus-comparative movements for offsetting pairs.** Equal-and-opposite caption movements are reclassification candidates and require disclosure testing; an unchanged total is not a pass.
- **Grade note mismatches by materiality and consequence.** A small isolated mismatch is 🟡 absent a supplied threshold; a material contradiction or one that drives a critical failed tie is 🔴.
- **A blank review field is at least 🟡** for a reporting or disclosure set, because it is a control deficiency rather than a cosmetic observation.
- **A check that could not run is `源不可用`**, named as such. Where the trial balance was not provided, the review is internal-consistency only and says so; that is not a clean review.
- **Locate, do not attribute.** A difference is reported with both figures and where it appears to enter. This skill does not decide which side is wrong, does not conclude that anything improper occurred, and does not name a responsible individual.
- Do not invent a caption, a note figure, a reconciling item, or a comparative. Missing inputs are `n.d.（未提供）` with their consequence stated.
- Confidential, pre-release material — statements before issue are unpublished financial information. It goes to the controller and the CFO before anyone else.
