---
name: research-report
description: Company-level initiation or deep-dive research report — the integrated deliverable that combines industry context, company and financial analysis, comps and DCF into one narrative with a single target price and a draft rating. Use when the user asks for 深度报告, 深度研究报告, 初次覆盖, 首次覆盖, 公司深度, 投资价值分析, a full research report on one company, or a report that must combine market work, company work and model outputs. Delivers 6-10 charts plus the comps/DCF/bridge tables, one target price with its method, and a draft rating derived from a stated band. Not for a quarterly update on a covered name (earnings-analysis) and not for an industry-level primer (sector-overview).
---

# Integrated Research Report

This skill **orchestrates**; it does not re-derive. Every analytical step below
already lives in another skill, and this file deliberately does not restate any
of them — read the sub-skill for how, and read this file for what an integrated
report adds on top: one narrative, one target price, one rating, and sections
that agree with each other.

## Scope — what this is, and what it is not

| Request | Skill |
|---|---|
| 深度报告 / 初次覆盖 / 公司深度, one company, with valuation and a view | **this skill** |
| Quarterly result on a name already covered | `earnings-analysis` |
| 业绩预告 / 业绩快报 short-form reaction | `earnings-flash` |
| Pre-print preview | `earnings-preview` |
| Industry primer, sector landscape, sector initiation | `sector-overview` |
| Competitor map / peer positioning as the deliverable | `competitive-analysis` |
| A model as the deliverable | `dcf-model` / `lbo-model` / `3-statement-model` / `comps-analysis` |

The distinguishing feature is not length. It is that **the report carries a
target price and a rating that must be defensible against two valuation methods
at once**. A deliverable with no target price is not this deliverable.

## Workflow

### Step 1: Fix the mandate before retrieving

Company, 报告期 basis, whether this is 初次覆盖 or a deep-dive update on a covered
name, the peer set, and the audience. If the user named a sector rather than a
company, this is `sector-overview` — say so instead of half-building both.

### Step 2: Run the sub-skills, each on its own terms

Run these and keep each one's output intact; do not summarise a sub-skill's work
into a paragraph and discard its numbers, because Step 4 has to reconcile them.

| Section | Sub-skill | Scope inside this report |
|---|---|---|
| 行业格局与需求驱动 | `sector-overview` | The demand driver the company's thesis turns on — not a full sector primer |
| 竞争位置与客户结构 | `competitive-analysis` | The peer set of Step 1, positioned; 客户集中度 where disclosed |
| 财务历史与盈利质量 | `earnings-analysis` | Historical read only. Its rating/target machinery is superseded by Step 4 here |
| 可比估值 | `comps-analysis` | The same peer set as the competitive section — never a different one |
| DCF | `dcf-model` | Base / 悲观 / 乐观, with the sensitivity grid. **The workbook is the same deliverable it is standalone** — all seven sheets including the Step 4.5 三表 and Checks, not a DCF tab cut down because the report is the visible product. Step 3 audits it and Step 4 quotes it, so a thinner workbook means the target price rests on something no one checked |
| 最新一期业绩 | `earnings-flash` or `model-update` | Only if a print landed inside the drafting window |

Two rules that exist because a composition can break them and a single skill cannot:

- **One peer set, one 报告期, one currency, one unit scale across every section.**
  A comps table on a different peer set than the competitive section is a defect,
  not a variation.
- **The forecast path is written once and reused.** The revenue growth in the
  industry section, the model's projection row, and any growth figure in the
  summary are the same numbers. Where they differ the reader cannot tell which is
  the house view.

### Step 3: Verify the model before it enters the narrative

Run `audit-xls` on any workbook whose outputs the report quotes. A target price
computed off an unaudited model is a number with no basis.

### Step 4: The valuation bridge — this is the step that only exists here

Both methods run, both reported, and the target reconciled against both. This is
the failure this skill exists to prevent: on identical inputs, two drafts of the
same report produced 「谨慎增持」 with **no target price at all** and 「买入」 with a
200 元 target, and a comps PE median of 72.0x in one and 30.8x in the other.

```
## 估值与目标价
| 方法 | 结果 | 口径 | 权重 |
|---|---|---|---|
| DCF 基准 | [x] 元 | WACC [x]%, 永续 g [x]% | [x]% |
| DCF 悲观/乐观 | [x] / [x] 元 | 情景假设见模型 | — |
| 可比估值 | [x] 元 | [n] 家可比, [PE/EV-EBITDA] 中位 [x]x × [FY] [EPS/EBITDA] | [x]% |
| **目标价** | **[x] 元** | **[方法或加权说明]** | |
对应 [FY] PE [x]x · 较现价 [x]% · 现价 [x] 元([date] 收盘)
```

- **The target price names its method.** One method, or a stated weighting of two
  — never an unexplained number between them. `[测算]`, and the arithmetic must be
  reproducible from the table.
- **A target outside the DCF range needs a reason in the same paragraph.** 200 元
  against a 168 元 base case is a claim about the base case being conservative;
  say that, or move the target.
- **Reconcile the two methods explicitly.** Where DCF and comps disagree by more
  than ~20%, say which one the target follows and why the other is discounted
  (cycle position, peer-set quality, a growth path the multiple cannot carry).
  Silence here reads as arithmetic when it is a judgement.
- **Read the comps median back against the peer set.** A PE median of 72x and one
  of 31x cannot both describe the same peers on the same date; if the number moved,
  the 口径 moved (报告期, TTM vs forward, whether loss-makers were dropped) and the
  口径 is what the reader needs.

### Step 5: Derive the rating from the target, and state the band

The rating is a function of the target against the current price, not an
independent opinion. State the band being applied so the reader can check the
arithmetic:

```
评级口径: 买入 >15% · 增持 5-15% · 中性 -5-5% · 减持 <-5%（较现价的目标空间）
投资评级: [x]（草稿,待分析师确认）  目标空间 [x]%
```

Two drafts landing on 「谨慎增持」 and 「买入」 from the same inputs means no band was
applied. Rating and target are both `草稿,待分析师确认` per the plugin's
no-recommendation rule — this skill stages a view, it does not issue one.

### Step 6: Assemble and deliver

Long-form, so PDF via `report-render` — never hand-rolled with weasyprint,
wkhtmltopdf, pandoc or a bare reportlab script, because those do not emit `[n]`
as PDF link annotations and the citations arrive unclickable. The workbooks behind
the valuation go out alongside via `xlsx-author` as **Class A** model books. Word is the answer
only when the user asks for it — `report-render`'s `DocxReport` builds it with **要出 Word 就先载入 `report-render` 技能，再动手建。** `DocxReport` 与 `Report` 同一套调用；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。
the same calls, and an initiation report going to clients is not that case.

Section order:

```
# [公司全称]([代码]) [初次覆盖 | 深度报告]
检索于: [timestamp] · 现价: [x] 元([date] 收盘) · 报告期基准: [x]
标签口径: [披露] 已披露 · [测算] 本文推算 · [预期] 第三方具名预期(数据商一致预期,非同业券商测算) · [推断] 本文推论 · [媒体] 未获记录佐证

## 投资摘要         评级、目标价、目标空间、三到五条核心逻辑,每条带 [n]
## 一、公司与商业模式
## 二、行业格局与需求驱动
## 三、竞争位置与客户结构
## 四、财务历史与盈利质量
## 五、估值与目标价     Step 4 的桥接表
## 六、情景与信号       三档情景,每档一个可观测的推翻信号
## 七、风险与缓释
## 覆盖范围与局限
## 来源              另起一页
```

`## 情景与信号` carries the discipline the sub-skills do not: each scenario names
**one observable that would falsify it** and by when. A scenario with no signpost
is a mood, and it is the section a reviewer will use in three months.

**Charts, not only tables.** An initiation report carries **6–10 charts** built through
`report-render`, each with its source in the note line
and never inside the canvas. Seventeen tables and no figure is a data appendix, not a
research report — the reader who has to form a view in five minutes reads the exhibits.
The ones that earn their place here, because they are what the sections argue with:

- 营收与利润的历史与预测路径（柱+线，显性预测期用竖分隔线标出）
- 毛利率 / 净利率 趋势，对齐同一时间轴
- 行业规模与增速，标明预测来自谁（`[预期]` + `[n]`）
- 市占率或竞争格局（份额堆叠或散点：份额 vs 增速）
- 估值带（历史 PE/PB 区间 + 现价位置），标注回看窗口起始日
- DCF 敏感性热力图（WACC × 永续 g），基准格高亮
- 情景对比（三档每股价值 vs 现价）

Tables stay for the things a chart cannot carry: the comps set with each multiple,
the DCF parameter table, the 估值桥接 table in Step 4, and the coverage block.

The rating, the target, and every scenario probability are `[测算]` or `[推断]`,
never `[披露]`. The coverage block follows the coverage policy and must
state, per section, which sub-skill's retrieval answered it and what did not
resolve — an integrated report is where a silent gap hides best, because six
sections that worked make the seventh look complete.

**Deliver the report; do not stop to have the assumptions blessed.** Judged
inputs — WACC, 永续 g, the multiple, the weighting — go into the assumptions block
flagged `待确认` with the alternative considered, so the reviewer overturns them in
one cell (the human-review guardrail). A message asking which beta to
use, with no report attached, has produced nothing to review.
