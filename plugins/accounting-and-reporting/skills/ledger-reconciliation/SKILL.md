---
name: ledger-reconciliation
description: Reconciliation carried to root cause — general ledger against subledger, book against operational log, or one report against another, with the totals difference decomposed by matching transactions rather than described, each difference classified by cause, and an evidence trail from the summary figure down to the voucher. Triggers on "总账和明细账对不上", "账账不符", "账实不符", "这个差额是哪来的", "勾稽", "账务差异分析", "科目余额差异", "对账", "往来核对", "reconciliation", "GL to subledger", "tie-out".
---

# Ledger Reconciliation

**先载入 `xlsx-author` 技能，再动手建表。** 出处载体（Class A 的 `Source:` 批注 /
Class B 的 `来源` 表加 `来源编号` 列）、四色含义、「填机构不填接口名」、URL 的两种诚实
写法、交付时的 `::zcode-file-citation`，都在那份 SKILL.md 里。只照路径调它的
`recalc.py` 不等于读过它——2026-08-24 那批里有一份工作簿正是这样，五项全漏。

A reconciliation that reports 「总账比明细账多 128,400 元」 has done arithmetic, not work. The deliverable is the **set of transactions that explains that number**, each with a cause and a trail back to a voucher. A difference nobody has decomposed is a difference nobody can clear, and it survives to the next period.

The deliverable is a reconciliation workbook. **Its citation vehicle is cell comments.**

## Inputs and output

Minimum inputs are the two complete populations being reconciled for the same period and scope, together with their control totals or opening/closing balances where applicable. Each side should carry the identifiers available to reproduce a match — such as 凭证号、单据号、合同号、发票号、交易日期、对方单位、科目、币种 and 金额 — plus the stated cut-off, entity scope, tax basis, currency/rate, and accounting basis. Obtain the matching tolerance, date window, and materiality threshold from the user or source where stated; never invent them. Ask for vouchers, invoices, bank records, or operational evidence only for the unmatched or material items that need root-cause support, not as a blanket prerequisite.

The output is one Chinese reconciliation workpaper: both source populations as received, reproducible matching rules, matched and unmatched lists, cause classification, a difference bridge, transaction-level evidence for material items, draft treatments or journal entries, live checks, and coverage limitations. It does not post an entry, clear an account, modify either source population, or decide that an open item is accepted.

## Before anything else — name the pair and align the basis

State exactly which two populations are being reconciled: 总账科目 vs 子账 / 账面 vs 银行对账单 / 会计账 vs 业务台账 / 本期报表 vs 上期报表 / 母公司账 vs 合并底稿.

Then align the basis, because a difference caused by a mismatch is not a difference:

- **时点** — 期末余额 or 期间发生额, and the same cut-off date on both sides.
- **范围** — the same entity, the same account set, the same subsidiary ledger. An account the subledger covers and the GL splits across two codes is a mapping question, not a difference (`account-mapping` owns it).
- **含税与否** — an operational log is frequently 含税 where the ledger is not. This single mismatch explains more "differences" than any genuine error.
- **币种与汇率** — the rate used on each side, and the translation date.
- **口径** — 权责发生制 vs 收付实现制, 已开票 vs 已确认收入, 已发货 vs 已验收.

Say which alignments you could verify and which you took on the user's word.

## Workflow

### Step 1: Parse and read back — both sides, separately

Parse with Python (openpyxl / pandas) through Bash. Read back each file on its own: sheet, header row, key columns, date column, amount column, **sign convention**, and whether amounts are 含税. The two sides frequently disagree on sign and on tax, and reading one convention and assuming it holds for both is the most common way this analysis fails silently.

**Cell comments and notes are source data, not decoration.** Before computing, read every non-empty comment or note and read it back with its sheet, cell, related account or item, and a short summary. Carry that evidence into matching, classification, and the open-items list. Parsing only cell values is incomplete and must not be treated as a full read of the workbook.

Keep the evidence type exact: visible cell text is `单元格正文`; an attached Excel note/comment is `单元格批注`. Before citing a source address, read that exact source cell back and verify its sheet, address, label, value, and comment text. The cited address belongs to the source workbook, not to the output row where the value was copied.

### Step 2: The totals difference — stated before it is explained

| | 金额 | 源 |
|---|---|---|
| A 方合计 | | [文件·标签页] |
| B 方合计 | | [文件·标签页] |
| **差异** | | [测算] |

Both sides `[披露]`, the difference `[测算]`. This figure is the target: everything below must add back to it exactly, and the workbook proves it with a formula.

### Step 3: Match transactions — exact, then tolerance, then unmatched

Matching is done in stated passes, and **each pass's rule is written down** so the result can be reproduced:

1. **精确匹配** — on a key that genuinely identifies a transaction (凭证号, 合同号, 发票号, 单据号). Amount alone is not a key; two payments of the same amount will cross-match and produce two false clears.
2. **容差匹配** — same counterparty and date within a stated window, amount within a stated tolerance. **State the window and the tolerance**, and report how many items matched only under tolerance — a reconciliation that clears half its population on a loose tolerance has hidden its differences rather than found them.
3. **未匹配** — everything left, on each side separately. This is the population that explains the difference.

Report the counts and amounts at each pass. A matching rate stated without its rules is not evidence.

### Step 4: Classify every unmatched item by cause

| 类别 | 含义 | 必须写明 |
|---|---|---|
| 时间性 | 双方都会记,只是期间不同 — 在途、未达账项、跨期确认 | **预计在哪一期消除** |
| 口径 | 双方口径不同 — 含税与否、总额净额、权责与收付 | **口径差异本身,及是否应长期存在** |
| 错账 | 一方记错 — 金额、方向、科目、重复入账 | **哪一方、错在哪、涉及凭证** |
| 遗漏 | 一方未记 | **哪一方、为何未记** |
| 未查明 | 尚未定位 | **金额,以及已排除的可能** |

`未查明` is a legitimate row and it is never zero by construction. What it must never be is a plug: it holds only what you actually could not locate, and its size is stated in the commentary and in the coverage block.

A classification is `[推断]` unless a document in the file states it. 「这笔是在途」 is a judgement until the shipping record is in hand.

Apply this evidence gate in order; never infer the cause from the proposed treatment or from wording such as `待调整`:

1. Classify as `口径` when the two sides demonstrably use different tax bases, gross/net presentation, accounting bases, or other stated definitions and the difference is reproducibly explained by that basis. A possible future adjustment does not turn a basis difference into `错账`.
2. Classify as `时间性` only with evidence of an in-transit or unrecorded-at-cut-off item, a later posting or reversal, or named operational evidence that supports an expected clearing period. Proximity to month-end, by itself, is not timing evidence.
3. Where the same unique document is recorded on both sides for the same period but at different amounts, and no evidenced basis difference explains it, classify it as `错账候选/待独立复核`; identify the potentially incorrect side and the invoice, voucher, contract, or other evidence needed to decide. If the evidence does not establish which side is correct, do not present a confirmed error or a deterministic journal entry.
4. Use `未查明` only after the basis, timing, same-document error, and omission tests above have been performed and none is supported. State which tests were completed and what evidence is missing.

### Step 5: Root cause at transaction level, with the trail

For every material item — against a **stated** threshold — carry it down: 凭证号 / 日期 / 摘要 / 对方科目 / 金额 / 经办或系统来源, and the file and tab each element came from. That chain is what lets a controller act without redoing the work.

Where the detail needed to reach transaction level was not provided, say so at that item: 「已定位至科目与期间，凭证明细未提供」 is honest and useful; presenting a summary-level guess as a root cause is not.

### Step 6: Proposed treatment — drafts only

Each explained difference gets a proposed treatment: 调账(draft entry) / 下期自动消除 / 口径说明,无需调账 / 待业务确认. Draft entries carry 借/贷/科目/金额/摘要/期间/依据/状态=待复核. Generate a draft entry only for an evidenced error or omission whose correct side, account, direction, amount, and period are supported. A basis difference normally receives a basis explanation; an evidenced timing difference receives an expected clearing period; an unresolved item or `错账候选` receives a request for evidence, not a journal entry.

**Nothing is posted here.** A difference is marked 已解释, never 已调整.

**And 已解释 is our proposal, not a clearance.** Every 错账, every 遗漏, every draft entry, and every item above the materiality threshold carries 状态=待独立复核 — reviewed by someone other than whoever prepared the reconciliation, which in this workflow means a person, because we prepared it. The reason is structural rather than procedural: the cause we assigned and the treatment we proposed rest on the same reading of the same two files, so a mistake in that reading propagates into both and no internal check can see it. Name what a reviewer should re-perform: the matching on the items that cleared under tolerance, and the trail on each material item.

A reconciliation is **closed** only when the bridge closes to zero **and** every 未查明 item is either resolved or explicitly accepted as an open item by the controller. This skill can report the first condition; only a person can supply the second.

### Step 7: Build the workbook

Through `xlsx-author`. Use these exact Chinese tab names and order: `A方明细` → `B方明细` → `匹配规则` → `已匹配` → `A方未匹配` → `B方未匹配` → `差异分类` → `差异桥` → `分录草稿` → `检查` → `说明与局限`. Do not translate them into English, add English aliases, rename them, or create replacement tabs. If a required source was not provided, retain the relevant tab and state `n.d.（未提供）`, what is missing, and what it would have supported.

Use Chinese for all user-facing workbook and handover text, including titles, section headings, column names, statuses, check conclusions, notes, and summaries. Preserve source-system identifiers such as account codes, formulas, filenames, document numbers, and unavoidable proper names as supplied.

Name the file `账务勾稽与差异分析_[A方]与[B方]_[报告期]_待复核草稿.xlsx`.

Hardcodes only on `A方明细` / `B方明细`, each carrying:

```
Source: <System or Document>, <Date>, <Reference>, <URL if applicable>
```

Name the source file, tab, period, and transaction or balance reference — `Source: 应收账款总账与子账_202607.xlsx, 2026-08-03, 子账明细!A152:H152 发票 INV-1048, 内部文件`. A copied source value without that trail is incomplete evidence.

Follow the input workbooks' established font, colour, number-format, and table style where coherent; otherwise use a simple, consistent professional style. Do not impose a fixed font or colour palette. Keep units explicit, numbers right-aligned, totals and open items visually distinct, and explanatory text readable.

`检查`, all live formulas — **the first one is the whole point**:

- 时间性 + 口径 + 错账 + 遗漏 + 未查明 = 总额差异 (**closes to zero**)
- 已匹配金额 + 未匹配金额 = 各方合计, on both sides
- 无一笔交易被匹配两次
- 容差匹配笔数与金额单独显示,不与精确匹配合并
- 草稿分录借贷各自合计相等
- 时间性项目按预计消除期间小计

**A bridge that does not close is not published.** Where it cannot be made to close, the residual goes to `未查明` explicitly and is reported at its own size — never absorbed into another category to make the table look finished.

### Step 8: Verify, then hand over

Run `../xlsx-author/scripts/recalc.py`, fix what it lists, then audit at **model** scope against the `audit-xls` skill. `recalc_unavailable` is not a pass.

Render and visually inspect every workbook tab before delivery. Fix clipping, awkward column widths, unreadable wrapping, hidden material fields, and broken pagination. Internal process labels such as `未经视觉验收`, `尚未人工检查`, `程序校验通过`, or tool/runtime status never appear in the workbook; if visual review has not happened, the package is not ready to deliver.

The handover leads with the difference and its decomposition, then the items needing a decision, then this block, which also sits at the top of `说明与局限`:

```
## 覆盖范围与局限
检索于: [timestamp] · 报告期: [期间] · 口径/委托用途: 内部账务勾稽
勾稽对象: [A 方] vs [B 方] · 结账状态: 未关账 / 初步 / 最终 · 重要性阈值: [金额]
口径对齐: 时点 [已核对/以用户说明为准] · 含税 [一致/已还原] · 币种 [一致/汇率 x]

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 双方合计 | A [金额] / B [金额] / 差异 [金额] | [文件名·标签页] | [date] |
| 精确匹配 | [N] 笔,[金额] | 已匹配页 | [date] |
| 容差匹配 | [N] 笔,[金额](窗口 [x] 天,容差 [y]) | 已匹配页 | [date] |
| 差异桥 | 归零 | 检查页 | [date] |
| 时间性 | [N] 笔,[金额],预计 [期间] 消除 | 差异分类页 | [date] |
| 口径 | [N] 笔,[金额] | 差异分类页 | [date] |
| 错账 | [N] 笔,[金额],涉及 [哪一方] | 差异分类页 | [date] |
| 遗漏 | [N] 笔,[金额] | 差异分类页 | [date] |
| **未查明** | [N] 笔,[金额],已排除 [可能性] | 差异分类页 | [date] |
| 交易级凭证明细 | 有记录 / 部分未提供([范围]) / 源不可用 | [文件名] | [date] |

本次未能覆盖: [未提供的明细,以及它本应回答的问题]
未结清事项: 未查明 [金额] 仍为开口项,**未做轧差,未做调整**
分录草稿: [N] 笔,状态待复核,均未入账
独立复核: **[N] 项(错账/遗漏/超阈值项)状态为待独立复核,由编制人以外的人复核;
本次结论为编制方提案,不构成清账** · 建议复核方重做: 容差匹配项的匹配、各重要项的凭证追溯
勾稽结论: 差异桥归零 / 未归零([金额]) · 未查明项是否经财务负责人确认为开口项: 是 / 否(未确认)
```

## Guardrails

- **The bridge closes to zero as a formula on the sheet**, or the reconciliation is not published. `未查明` is a named row holding only what was genuinely not located, never a plug sized to make the total work.
- **Never net unrelated differences.** Offsetting a receivable error against a payable error produces one small number concealing two real ones, and it is the single most destructive shortcut available here.
- **A difference is not closed until it is explained.** 已解释 requires a cause and, above the threshold, a transaction-level trail. An item that could not be traced stays open and says how far it was traced.
- **Matching rules, tolerance, and window are stated**, and tolerance matches are reported separately. Amount alone is never a matching key.
- **Align the basis before comparing** — timing, scope, tax-inclusiveness, currency, accrual versus cash. Say which alignments you verified and which you accepted on the user's word.
- **Nothing is posted.** Treatments are drafts with 状态=待复核; a difference is marked 已解释, never 已调整.
- **已解释 is a proposal, not a clearance.** Every 错账, 遗漏, draft entry, and above-threshold item is 待独立复核 by someone other than the preparer, and the handover names what to re-perform. The cause we assigned and the treatment we proposed rest on the same reading of the same two files; a misreading propagates into both and no internal check can see it.
- **This skill does not decide the treatment and does not clear the account.** It locates and explains; the controller decides what is booked and what stays open.
- A test that could not run is `源不可用`, never `无差异` and never `通过`.
- Do not invent a voucher number, a counterparty, a date, or an amount. Missing detail is `n.d.（未提供）` with its consequence stated.
- Where the difference points to a possible control failure or an irregularity rather than a bookkeeping error, **report the facts and the amounts and stop.** This skill does not characterise intent, does not name a responsible individual, and does not conclude that anything improper occurred — that goes to the controller and, where the company's policy requires it, beyond.
- Confidential, pre-release material. It goes to the controller and the CFO before anyone else.
