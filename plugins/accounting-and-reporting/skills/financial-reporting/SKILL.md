---
name: financial-reporting
description: Statutory-basis financial statements and note working papers built from a trial balance — accounts mapped to the caption format the stated basis prescribes, the three statements with every tie shown as a live formula, note schedules traceable to the accounts behind them, and every accounting judgement registered for the finance lead rather than decided. Delivered as a draft pending review, unaudited. Triggers on "编制财务报表", "出一版财务报表", "法定报表", "准则报表", "资产负债表利润表现金流量表", "合并报表编制", "年报报表", "报表底稿", "附注底稿", "financial statements", "statement preparation".
---

# Financial Statement Preparation

**先载入 `xlsx-author` 技能，再动手建表。** 出处载体（Class A 的 `Source:` 批注 /
Class B 的 `来源` 表加 `来源编号` 列）、四色含义、「填机构不填接口名」、URL 的两种诚实
写法、交付时的 `::zcode-file-citation`，都在那份 SKILL.md 里。只照路径调它的
`recalc.py` 不等于读过它——2026-08-24 那批里有一份工作簿正是这样，五项全漏。

Statements assembled from a trial balance are only worth what their trail is worth. The number on the face is the easy part; the deliverable is the **working paper that lets a reviewer get from that number back to the accounts, and from the accounts back to the ledger** — plus an honest list of the places where an accounting judgement was required and was not made here.

The deliverable is a statement workbook plus, where a full package is wanted, a rendered document. **Its citation vehicle is a Sources section on the document and cell comments in the workbook.**

## These are statutory-basis statements, delivered as a draft pending review

This skill prepares the **法定口径** statements — the captions, the format, and the note disclosures that the stated accounting basis prescribes. That is what distinguishes it from `run-fpa`'s `management-report`, which prepares the **管理口径** multi-dimensional report off the same ledger. **The two are not interchangeable and their figures are not to be mixed**: the same metric can legitimately differ between them (consolidation scope, allocation, what sits above the gross-profit line), and where both exist the difference is explained rather than averaged away.

Written on the face of every deliverable this skill produces, in the language of the deliverable:

> **按〔企业会计准则 / 小企业会计准则〕编制 · 待复核草稿,未经审计 · 合规声明与签署由财务负责人及(如适用)会计师承担 · 未经复核不得用于申报或披露。**

What that boundary means in practice, and none of it softens as a workflow gets long:

- **It does not represent compliance.** Stating that a set complies with a framework is a management representation. This skill prepares the statements and shows the ties; it does not assert conformity, in the deliverable or in conversation.
- **It does not sign and it does not file.** No signature block, no 法定代表人 or 总会计师 attestation, no submission to any system or regulator.
- **It issues no audit or review opinion**, and it is not an auditor's working paper.
- **It does not decide an accounting treatment** — every judgement goes to the register in Step 6 for the finance lead to confirm.
- **It is unaudited** until someone audits it, and the deliverable says so on its face.

A draft prepared this way is the ordinary output of a reporting accountant: the finance lead reviews it, takes responsibility for it, and only then does it become anything else. What this skill must never do is present its own output as already reviewed, already compliant, or ready to file.


## Before anything else

- **试算平衡表** — 期初 / 本期借方 / 本期贷方 / 期末, at 末级科目 level.
- **科目到报表项的映射.** If one does not exist, build it through `account-mapping` first and carry its open-items list into this deliverable — statements built on an unconfirmed mapping inherit every one of its open questions.
- **上期报表** for the comparative column, and the prior-period statements they came from.
- **现金流量表所需的补充资料** — 固定资产与无形资产的购建与处置、借款的取得与偿还、股利、非付现项目、以及 direct-method receipts and payments where the direct method is used.
- **会计政策** governing the captions in question.
- **合并抵销底稿**, where the requested set is 合并. **This skill does not derive eliminations** — intercompany balances, transactions, unrealised profit, and equity eliminations come from the user's own working paper. Where it was not provided, a 合并 set cannot be prepared: say so and offer the 单体 set instead.

Settle: entity and consolidation scope, 报告期 and comparative period, **close status**, **which accounting basis** (企业会计准则 / 小企业会计准则 — it determines the caption format and the note list), presentation currency and unit, and whether the requested set is 单体 or 合并.

## Workflow

### Step 1: Parse, read back, and tie to the trial balance before assembling anything

Parse with Python (openpyxl / pandas) through Bash. Read back sheet, header row, account column, period columns, hierarchy level, and sign convention.

**Cell comments and notes are source data, not decoration.** Before computing, read every non-empty comment or note and read it back with its sheet, cell, related account or item, and a short summary. Carry that evidence into mapping, cash classification, note preparation, and the judgement register. Parsing only cell values is incomplete and must not be treated as a full read of the workbook.

Then, before any caption is populated:

| 检查 | 关系 |
|---|---|
| 试算平衡 | 借方合计 = 贷方合计 |
| 层级 | 末级科目合计 = 上级余额 |
| 期初连续性 | 本期期初 = 上期期末 |

**A trial balance that does not foot does not become statements.** Report the gap and stop; `month-end-close-review` and `ledger-reconciliation` are where it gets resolved.

### Step 2: Map accounts to the caption format the basis prescribes, and leave the mapping visible

**The caption set is not ours to design.** Use the 报表格式 the stated basis prescribes — 财政部 issues it, and 企业会计准则 and 小企业会计准则 do not use the same one. Do not invent a caption, do not merge two prescribed captions because the ledger makes it convenient, and do not carry a management-report caption over from `run-fpa`. Where the trial balance holds something the prescribed format has no line for, that is a finding for the register in Step 6, not a new row.

Every caption is a formula summing named accounts — never a typed figure. The mapping lives on its own tab so a reviewer can see which accounts entered which line, and **every account in the trial balance appears in exactly one caption or in an explicit `未列示` row.** An account silently omitted is how a statement ties internally while missing a balance.

Balances are `[披露]`; every caption subtotal, ratio, and derived figure is `[测算]`.

### Step 3: Balance sheet and income statement

Present per the stated basis with the comparative column, and carry 归母 / 少数股东 separately where the scope is 合并 — labelled, never averaged.

**Build the complete prescribed face before inserting any numbers.** Keep every caption, subtotal, heading, and order required by the stated basis even when the trial balance has no corresponding account or the amount is zero. A missing ledger balance changes the displayed amount (`—` for a known zero; `n.d.（未提供）` when the amount cannot be determined); it does not remove the prescribed row. Do not shorten the balance sheet, income statement, cash flow statement, or equity statement into a list of only populated captions. Put explanatory detail in the note column or note schedules rather than rewriting or deleting the prescribed caption.

Ties, all as live formulas:

- 资产合计 = 负债合计 + 所有者权益合计
- 收入 − 成本 − 费用 ± 其他 = 净利润
- 净利润 结转至 未分配利润变动 (with dividends and appropriations shown separately)
- 期初数 = 上期报表期末数,逐行

### Step 4: Cash flow statement — the one that fails quietly

State the method (直接法 / 间接法) and be explicit that it is a **derived** statement: unlike the other two, it is not a direct read of balances, and every line rests on decomposing a movement.

Required ties:

- 现金及现金等价物期末余额 = 资产负债表货币资金 **±** an explicit reconciling row for restricted cash and for items in 货币资金 that are not cash equivalents. **This reconciling row is named and quantified, never suppressed to make the tie work.**
- 现金净增加额 = 期末 − 期初
- 经营 + 投资 + 筹资 + 汇率影响 = 现金净增加额
- Where 间接法 is used: 起点净利润 = 利润表净利润, and every adjustment line traced to the account it came from

Where the supplementary data needed to split a movement was not provided (capex versus disposals inside a net movement in fixed assets, for instance), **do not derive it from a plausible assumption.** Report the line as `n.d.（未提供）`, name what would resolve it, and say so on the face of the statement rather than presenting a computed guess as a cash flow.

### Step 5: Note working papers

**The note list comes from the basis, not from what the data makes easy.** Work through the disclosures the stated basis requires for the captions present, and produce two things: the notes prepared, and **an explicit list of required notes that could not be prepared** with the reason (`n.d.（未提供）` and what would resolve it). A set that silently omits a required disclosure looks complete, and the omission is only discovered by whoever reviews it against the basis — which is the reviewer's time spent on something the preparer already knew.

For each note prepared: the schedule, the accounts behind it, and its tie back to the face of the statements as a formula. A note whose total does not agree with the caption is a finding, not a rounding matter.

Where a note requires an accounting judgement (aged provisioning rates, impairment, related-party scope, segment definition), **prepare the schedule and flag the judgement — do not set the rate and do not conclude the impairment.**

Where a standard's text was retrieved to establish what a note must contain, cite it in `## 来源` with its issuing body, document number, and effective date. Retrieving it does not authorise applying it.

### Step 6: The accounting-judgement register — mandatory, and it ships with the statements

| 事项 | 涉及科目与金额 | 可选处理 | 本版所采用 | 依据 | 待确认人 |

Cut-off, capitalisation versus expense, provision adequacy, impairment indicators, lease classification, revenue recognition, related-party elimination, financial instrument classification.

Where the trial balance already reflects a treatment, this version follows it and **says that it followed it rather than that it verified it** — 「本版沿用账面处理,未做独立判断」. Where a treatment had to be chosen to produce a statement at all, that choice is `[推断]`, flagged, and named as requiring confirmation before the statements are used for anything.

An empty register is possible but rare, and an empty register on a period with any estimate in it means the register was not filled in.

### Step 7: Build, then verify — and note that review is a separate pass

Workbook through `xlsx-author`. Use these exact Chinese tab names and order: `试算平衡表` → `科目映射` → `资产负债表` → `利润表` → `现金流量表` → `所有者权益变动表` → `附注底稿` → `会计判断` → `勾稽检查` → `说明与局限`. Do not translate them into English, add English aliases, rename them, or create replacement tabs.

Use Chinese for all user-facing workbook text, including titles, section headings, column names, statuses, check conclusions, notes, and the handover summary. Preserve source-system identifiers such as account codes, formulas, filenames, document numbers, and unavoidable proper names as supplied.

Hardcodes only on `试算平衡表` and the supplementary-data inputs, each with:

```
Source: <System or Document>, <Date>, <Reference>, <URL if applicable>
```

Four font colours (blue `#0000FF` input · black formula · green `#008000` cross-sheet link · purple `#800080` same-sheet link), the four fills (`#1F4E79` header, `#BDD7EE` band, `#D9E1F2` input block, `#F2F2F2` neutral), meaningful borders, numbers right-aligned.

`勾稽检查`, all live formulas: 试算平衡 · 资产=负债+权益 · 利润表结转 · 现金流三类合计=现金净增加额 · 期末现金=货币资金±受限说明行 · 间接法起点=净利润 · 每个附注合计=表面对应行 · 期初数=上期期末 · 每个科目恰好进入一个报表项 · 未列示行余额(不为零时显著提示).

Run `../xlsx-author/scripts/recalc.py`, fix what it lists, then audit at **model** scope against the `audit-xls` skill. `recalc_unavailable` is not a pass.

**An independent consistency review is a separate pass, and it is not this skill.** `statement-consistency-check` exists to review a set someone else prepared; running it against statements this skill just built is a self-check on the same construction and cannot detect a preparer's error in the mapping or the judgement. Say that in the handover: 本版为编制方自检,独立复核未执行.

A full package with notes ships as a **DOCX** through `report-render`'s `DocxReport`; a bare set of statements ships as the workbook plus a Markdown summary. **DOCX rather than PDF because of what this deliverable is**: a 待复核草稿 whose next reader is the preparer's reviewer, who edits the note text, fills in what the mapping left open, and merges it into the statutory package. A PDF for that reader is a document they have to retype. The house formatting policy names this skill among the DOCX defaults; a set that has been signed off and is going out unchanged is the PDF case. **要出 Word 就先载入 `report-render` 技能，再动手建。** `DocxReport` 与 `Report` 同一套调用；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

```
## 覆盖范围与局限
检索于: [timestamp] · 报告期: [期间] · 比较期: [期间] · 口径/委托用途: **法定口径财务报表编制(待复核草稿,未经审计)**
主体与范围: [主体] · 单体 / 合并 · 结账状态: 未关账 / 初步 / 最终 · 会计基础: [企业会计准则 / 小企业会计准则] · 报表格式: [所依据的格式] · 单位与币种: [x]

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 试算平衡 | 借贷相等 / 差异 [金额] | [文件名·标签页] | [date] |
| 科目映射覆盖 | 全部科目已列示 / 未列示 [金额] | 科目映射页 | [date] |
| 映射待确认事项 | 无 / [N] 项(承自 account-mapping) | 科目映射页 | [date] |
| 资产=负债+权益 | 归零 | 勾稽检查页 | [date] |
| 利润表结转 | 归零 | 勾稽检查页 | [date] |
| 期末现金与货币资金 | 一致 / 受限说明行 [金额] | 勾稽检查页 | [date] |
| 现金流三类合计 | 归零 | 勾稽检查页 | [date] |
| 现金流补充资料 | 有记录 / 部分未提供([项目]) / 源不可用 | [文件名] | [date] |
| 期初数与上期报表 | 逐行一致 / 差异 [金额] / 上期报表未提供 | [文件名] | [date] |
| 附注与表面勾稽 | [N] 个附注全部一致 / [M] 个不符 | 附注底稿页 | [date] |
| 准则要求的附注覆盖 | [N] 项已编制 / [M] 项无法编制(已列示原因) | 附注底稿页 | [date] |
| 合并抵销底稿 | 有记录(用户提供) / 源不可用,故仅出单体 | [文件名] | [date] |

本次未能覆盖: [未提供的资料,以及它本应回答的问题]
会计判断: [N] 项已登记待确认;其中沿用账面处理 [a] 项(未独立判断),本版选定 [b] 项(已标 [推断])
复核状态: **编制方自检已完成,独立复核未执行**
合规与签署: **本版未声明符合任何框架,未签署,未申报,未经审计**
公式评估: recalc 已评估 [N] 条公式,零错误 / recalc 不可用,仅做静态检查与独立复算

## 来源
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

`## 来源` entries follow the house citation schema. **For an internal source, `一手` is the ledger or the close package itself — name the file, the tab, and the period instead of a URL**: `[1] 一手 · 财务部 · 试算平衡表 示例_试算平衡_YYYYMM.xlsx / 末级科目 · 报告期 2026-06(过账 2026-07-05; 检索于 2026-07-25) · 内部文件,无 URL`. A standard quoted in a note is a normal entry with its issuing body, document number, effective date, and URL. Distinct `[n]` markers must equal the entry count.

## Guardrails

- **Statutory basis, delivered as a draft pending review.** Every deliverable carries 「按〔准则〕编制 · 待复核草稿,未经审计 · 合规声明与签署由财务负责人及(如适用)会计师承担」 on its face. This skill asserts no compliance, signs nothing, files nothing, and issues no audit or review opinion.
- **The caption format and the note list come from the basis, not from the data.** No invented caption, no merged prescribed captions, and no management-report caption carried over from `run-fpa`. Required notes that could not be prepared are listed with their reason.
- **A zero or missing balance never deletes a prescribed statement row.** Keep the complete statutory face and distinguish `—` (known zero) from `n.d.（未提供）` (not determinable).
- **Formal statement faces are presentation-ready.** Use A4 one-page-wide print settings; never send a workbook whose comparative column, title, or total prints on an isolated page.
- **管理口径 and 法定口径 are not mixed.** Where the same metric exists in `run-fpa`'s `management-report`, the difference is explained, never averaged and never quietly reconciled by adjusting this set.
- **Eliminations are not derived here.** A 合并 set requires the user's own 抵销底稿; without it, offer the 单体 set and say why.
- **A trial balance that does not foot does not become statements.** Report the gap and hand it back.
- **Every caption is a formula over named accounts**, and every account lands in exactly one caption or an explicit `未列示` row.
- **The cash flow statement's reconciling items are named and quantified**, never suppressed to make a tie close. A movement that cannot be split from the data provided is `n.d.（未提供）`, not a derived guess.
- **The accounting-judgement register ships with the statements.** Where the trial balance already reflects a treatment, say the version followed it rather than that it verified it.
- **Accounting judgements are flagged, never made.** Name the accounts, the amounts, the alternatives, and the standard if retrieved — then stop.
- **Preparation and review are separate passes.** This skill self-checks its own arithmetic; it does not certify its own output, and the handover says the independent review was not run.
- **State the close status on the face.** Preliminary-close statements presented as final is the most damaging failure available here.
- Do not invent a balance, a supplementary figure, a provision rate, or a comparative. Missing inputs are `n.d.（未提供）` with their consequence stated.
- Confidential, pre-release material. It goes to the controller and the CFO before anyone else, and to no external party from here.
