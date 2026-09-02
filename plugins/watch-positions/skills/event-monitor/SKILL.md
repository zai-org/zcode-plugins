---
name: event-monitor
description: Scan watchlist/portfolio names for position-relevant events over a window — announcements, earnings pre-announcements, share pledges, lockup expiries, holder changes, litigation, regulatory actions — and rank them by severity. Triggers on "事件监控", "有什么公告", "解禁", "质押", "风险事件", "watch for events", "监控持仓风险".
---

# Position Event Monitor

Event-driven scan of a name list. Output is ranked by severity, not by name order.

## Workflow

### Step 1: Scope

Load the watchlist (or take names inline). Default window: since previous scan date if recorded in the list file's `notes`, else last 5 trading days. Confirm the window in the output header.

### Step 2: Scan per name — disclosed events first

Per name, in this order (merge and dedupe):

1. **公司事件** — `wind-stock.get_stock_events`（`question` = 简称 + 单一事件类型 + 窗口；**限售解禁不在此工具**，见下条）: 业绩预告/快报、解禁、增减持、分红、股权激励、再融资、股权质押公告。这是一张结构化事件表(带解禁日期、质押公告日、重组进度等列),优于在公告正文里语义检索——一次一种事件类型,多主题堆叠会漏匹配。
2. **风险面** — 万得 `wind-stock.get_stock_events` 已含股权质押公告;商誉与大股东质押变动可经 `get_stock_financials` 取质押比例、商誉金额;for suspected credit/legal issues on the issuer, hand off to `vet-companies` — its 天眼查 link owns 涉诉/失信/行政处罚 records.
3. **新闻/公告** — 万得 `wind-docs.get_financial_news` / `wind-docs.get_company_announcements`(无日期参数,窗口写进 `query` 后自筛);需要按档位召回第三方信息时才走金融垂搜 `finance-search.finance_search`(有 `date_from`/`date_to`)。

One name per query (use 简称, not inline ticker). A name with zero events is reported once in a "检索范围内未发现事件" line, not omitted silently.

### Step 3: Classify severity

- **🔴 高 — 需要立刻看**（决策前须澄清）: 立案调查/行政处罚、核心高管被查、违约、非标审计意见、大股东质押爆仓风险、业绩预告大幅低于/高于预期。
- **🟡 中 — 需要跟踪**（记录并观察）: 大股东减持计划、限售解禁临近(30天内)、再融资、重大合同、诉讼进展、评级变动、龙虎榜异常席位。
- **⚪ 低·信息 — 知悉即可**: 常规分红、例行公告、小额回购进展。

Across tiers, when several events compete for attention, order by how directly each forces a decision: 立案调查/处分 > 业绩预告变脸 > 大股东减持/质押平仓风险 > 限售解禁 > 龙虎榜异常席位 — the tier gives the grade, this ordering breaks ties in presentation. Severity is judged against position relevance — a routine item on a 10% weight beats a colorful headline on a 0.5% weight. Grade the event, never the holding, and surface at most three 🔴 up front; the rest go in the body.

### Step 4: Output

Short-form is Markdown in-session. If the user asks for a file, the monitor table goes to `.xlsx` via `xlsx-author` as a **Class B** workbook — the `来源` worksheet plus a `来源编号` column on the event rows, with the window and the three coverage states in the `口径与局限` block. A written event brief goes to PDF via `report-render`; never hand-roll it, because a hand-rolled PDF does not emit `[n]` as link annotations. 用户要 Word 时同样走 `report-render`（`DocxReport`，与 `Report` 同一套调用）——**要出 Word 就先载入 `report-render` 技能，再动手建**；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

```
**事件监控 — [清单名]**（窗口: [起]—[止], 检索于 [时间戳]）

🔴 高 [标的] — [事件一句话] · [日期] [n]
   影响: [一两句,含数字须有来源;自行推导的比例标 [测算],自行的判断标 [推断]]
🟡 中 ...
⚪ 低·信息 [标的A/B/C]: [归并的一行]

检索范围内未发现事件: [标的列表]

**覆盖范围与局限**: 检索于 [时间戳],窗口 [起]—[止]。覆盖清单内 [N] 只的公告、公司事件、风险面指标与新闻。本次未覆盖: [源不可用的标的/检查项与原因,以及它们本应覆盖的内容]。"检索范围内未发现事件"指上述源在该窗口内无记录,不等同于无事发生——公告与判决上网均有滞后。

## 来源
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

### Step 5: Guardrails

- Never infer an event that no source discloses; rumors from news are `[媒体]` until a disclosed record corroborates them, at which point they become `[披露]` and cite that record.
- State the exact window scanned (the `date_from`/`date_to` passed to `finance-search.finance_search`, or the date phrase in the announcement/news `query`).
- If the user wants this recurring (每天收盘后/每周一早), set it up with the host's scheduler and note the cadence — do not silently promise future scans.
- A source that errored, timed out, or does not cover an entity type is `源不可用` and named as such — never folded into 未发现, which would overstate coverage.
- `[n]` markers map one-to-one to `## 来源` entries. `〔一手|二手〕` is mandatory; a `二手` entry names what it relays. An announcement pulled from a terminal with no separate publication date carries `检索于 [date]`.
