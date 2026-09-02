---
name: opportunity-scan
description: Scan business-opportunity signals over an explicit window — financing rounds, expansion and capex, listing moves, tenders and awards, qualification wins, registration changes — for one company, a target list, or a region, graded by how actionable each signal is for a banker. Triggers on "商机扫描", "有什么线索", "最近有什么动静", "客户异动", "为什么现在打这个电话", "opportunity scan", "线索广场".
---

# Opportunity Scan

A signal is only useful if a banker can act on it this week. This skill pulls dated signals over an explicit window, corroborates them against the official record where one exists, and grades them by actionability.

There is **no single-call opportunity feed** in this plugin. A scan is **assembled**, not scanned: name the subjects, pull each one's recent announcements and news over the window, and aggregate. State this in the output — a reader who thinks you ran one cross-company query will over-trust the result.

## Workflow

### Step 1: Fix the clock and the window

There is **no clock tool**. Take today's date from the session context or ask the user before running anything — every query below takes a date range, and a wrong anchor silently shifts the whole scan.

Set `start_date` / `end_date` explicitly. Default to the trailing 3 months and say so; 近 1 个月 for a weekly coverage rhythm, 近 12 个月 for an annual plan. The window goes in the header, not just in the query.

### Step 2: Fix the scope — name the subjects

One of:

- **a named company** — proceed directly to Step 4.
- **a target list** — typically the output of `prospect-screen`; iterate per name.
- **a territory / segment** — first turn it into a named candidate list with 天眼查 `search_companies_by_industry_region` (query = 地区 + 行业), paginated; this is the candidate set you will scan per-company. Cap the candidate set and say so — scanning 500 names one-by-one is not feasible, so state the cap (e.g. top 50 by 注册资本) and that signals below the cap are missed by design.

A territory scan returns noise unless you narrow the candidate set; pair the region+行业 cut with a 注册资本 or 资质 filter where the mandate implies one.

### Step 3: Resolve the signal types the user cares about — no dictionary

Signal types are expressed in **natural language** and matched against what announcements and news actually carry — 融资/扩产/上市辅导/中标/资质/注册变更 etc. Record any signal type the user asked for that no announcement or news item corroborated in the window; Step 7 has to name it as unresolved.

### Step 4: Pull the signals — per subject, from the record and the press

For each subject, over the same `[start_date]`–`[end_date]` window:

- **万得 `wind-docs.get_company_announcements`** (no date parameters (only `query` / `top_k`) — put the window in the `query` text and filter after retrieval) — the issuer's own announcements and regulatory filings, for listed or bond-issuing names. This is the record that can make a signal `[披露]`.
- **万得 `wind-docs.get_financial_news`** — media and business-opportunity reporting over the same window.
- **天眼查 `tianyancha.search_bids`** — 招投标与资产处置记录, and the channel that fixes the gap below. Pass `bid_type="4"` for 中标结果, `start` / `end` (YYYY-MM-DD) for the window, and `role` for direction (`"2"` 采购人 exposes the capex it is tendering, `"3"` 供应商 exposes its order book — **read both**). Returns 类型 / 标题 / 发布时间 / 中标方 / **项目金额** / 采购人 / 省份 / 公告链接. This is a **record**, so a 中标 found here is `[披露]`, not `[媒体]`.
  - **Read it in both directions — they answer different questions.** Querying a name that appears as **采购人** surfaces the capex it is putting out to tender (on a manufacturing subject this came back as 桩基础工程 / 片区路网 / 土方工程 packages for new production bases) — that is a financing need, and each 中标方 on those projects is itself a new prospect. Querying a name as **中标方** surfaces its order book — evidence of 履约 and forward revenue.
  - **This is also the empirical route to 产业链批量获客.** The agent notes there is no upstream/downstream classification field to screen on; 招投标 gives something better — actual 采购人 ↔ 中标方 pairs, observed rather than classified. Say which direction produced a name.
  - 金额 comes back as the project amount, not the company's revenue — never present it as either revenue or a credit need without saying which project and which date it belongs to.
- For a **non-listed** subject with no 公告 feed, 公告 is unavailable — but `search_bids` still is, so news is **not** the only channel. Use it before concluding that only `[媒体]`-grade evidence exists; a non-listed name winning or letting a tender leaves a record. Where neither 招投标 nor news returns anything, that is `检索范围内未发现`, per channel.

Each kept signal keeps its **own date**. A scan retrieved today made mostly of signals from the start of the window is a decaying scan, and the output says so rather than presenting everything as "recent".

### Step 5: Corroborate, and let the corroboration decide the tag

The rule, applied per signal and not per company:

- Traces to a filing, an announcement, or an official notice → `[披露]`, cite the record.
- Media only → `[媒体]`, and it **stays** `[媒体]`. Five outlets carrying the same story is one uncorroborated story.
- The product angle you read into a signal → `[推断]`.
- Any magnitude you derived (投资额占注册资本比例, 轮次间隔) → `[测算]`, with the arithmetic stated.

### Step 6: Grade by actionability for a banker

the severity policy, anchored to what the RM should do. Grade the **signal**, never the company — a 🔴 signal is a reason to call, not a rating, and it says nothing about creditworthiness.

- **🔴 高 — 本周联系**: a closed financing round; a new plant, production line, or committed capex; an IPO or 上市辅导 move or a bond issuance plan; a large winning tender or awarded contract; a new subsidiary, 迁址, or major registered-capital increase inside the coverage area.
- **🟡 中 — 纳入跟踪**: a qualification win (专精特新/高新/单项冠军); park or cluster entry; 对外投资 or shareholder change; a new supply-chain relationship with a core enterprise; visible hiring expansion.
- **⚪ 低·信息**: general industry exposure, a report with no amount or date, an event near the far edge of the window with no follow-through.

**Cap the front of the list at three 🔴.** The rest live in the body. If more than roughly a third of the signals came out 🔴, the scale was used for emphasis and needs re-grading.

### Step 7: Output

Markdown for a scan read in-session; `.xlsx` via `xlsx-author` when the scan covers a list and will be worked through row by row. Word is the answer only when the user asks for it or the reader will edit the file — `report-render`'s `DocxReport` builds it with the same calls; unspecified long-form stays PDF (the house formatting policy). **要出 Word 就先载入 `report-render` 技能，再动手建。** `DocxReport` 与 `Report` 同一套调用；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。 That workbook is `xlsx-author`'s **Class B** case — many retrieved rows, few formulas — so its provenance vehicle is the `来源` worksheet plus a `来源编号` column on every data sheet, not a comment per cell, and the `口径与局限` block on the `来源` sheet carries the coverage states. A roster delivered without those has no provenance at all.

```
**商机扫描 — [范围一句话]**（检索于 [date]）
窗口: [start_date] 至 [end_date]  ·  范围: [公司 / 名单 N 家 / 地区+行业 candidate set, 上限 [K]]  ·  信号类型: [natural language or 全部]
引擎: 组装 — 天眼查筛候选(若为片区) + 万得 wind-docs.get_company_announcements / wind-docs.get_financial_news 逐家取动态(无单次跨企业商机扫描)

**须优先处理(最多 3 条)**
| 级别 | 企业 | 信号 | 信号日期 | 依据 | 动作建议 | 源 [n] |
|---|---|---|---|---|---|---|
| 🔴 高 |  |  |  | [披露]/[媒体] |  |  |

**其余信号**
| 级别 | 企业 | 信号 | 信号日期 | 依据 | 动作建议 | 源 [n] |
|---|---|---|---|---|---|---|
| 🟡 中 |  |  |  |  |  |  |
| ⚪ 低·信息 |  |  |  |  |  |  |

信号时效: [窗口内信号的日期分布 — 有多少落在窗口早段,即时效正在衰减] [测算]

## 覆盖范围与局限
检索于 [date]  ·  窗口 [start_date] 至 [end_date]  ·  口径/委托用途: [新客拓展 / 存量维护 / 片区扫描]

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 候选集(片区扫描时) | 有记录([N] 家,上限 [K]) [n] / 检索范围内未发现 / 源不可用 / 不适用(单主体) | 天眼查 search_companies_by_industry_region | [date] |
| 官方公告 | 有记录([N] 条) [n] / 检索范围内未发现 / 源不可用 | 万得 wind-docs.get_company_announcements | [date] |
| 媒体报道 / 商机信号 |  | 万得 wind-docs.get_financial_news | [date] |

未能解析为信号的诉求: [用户提到但窗口内无公告/新闻佐证的信号类型,逐条列出]
本次未能覆盖: [本次失败或不适用的源(如非上市主体无公告可查),以及它们本应覆盖的信号]
数据滞后性: [公告披露与新闻收录的已知滞后;非上市主体仅有媒体一侧]
"检索范围内未发现"仅指上述源在该窗口内无记录,不等于该企业无商机或无动作。
本扫描为营销线索,不构成授信、准入或风险结论;涉及授信的名字请转 `vet-companies`。

## 来源
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

An announcement is `一手`. A news item is `二手` and names what it relays. `〔一手|二手〕` is mandatory on every entry, and the count of distinct `[n]` markers equals the number of entries.

### Step 8: Hand off

Offer: `client-portrait` on any name with a 🔴 signal before the call, `prospect-screen` if the scan suggests a whole segment is moving. A signal that turns into a credit conversation goes to `vet-companies` — this scan checked opportunity, not records.
