---
name: close-recap
description: After-close (or after any session) recap of a watchlist — per-name moves, market/sector context, move attribution against disclosed events, and a decision-first summary. Triggers on "盘后复盘", "今天怎么样", "recap", "收盘总结", "为什么涨/跌", "move attribution", "daily wrap".
---

# After-Close Recap

Produce a recap a PM can read in under 3 minutes: what moved, why, and what needs a decision.

> **Reference prices: filter by volume first.** `hexin-stock.get_stock_performance`
> does not skip suspended-trading days — it fills the close with the previous close
> and only blanks the volume (a `\t` or empty string). Taking a "prior trading day
> close" therefore yields a carried-over price: the number is right, the base date is
> wrong, and nothing looks odd. A row with blank volume is not a trading day.

## Workflow

### Step 1: Load the universe and set the window

- Load the watchlist file (`watchlists/<name>.json`); if none exists, ask for names once.
- Confirm the session date via a live time/quote lookup — never assume "today" from memory. Default window is the latest completed session; support "本周" / "since <date>" windows via K-lines.

### Step 2: Pull moves — one call per name

For each position, pull close/pct-change (and volume/turnover for outlier detection) via `hexin-stock.get_stock_performance`(`codes` + `indicators=收盘价,涨跌幅,成交量,换手率` + 日期区间;按交易日历过滤) or `get_stock_performance` (window > 1 day). Query by 简称, not inline ticker. Missing or suspended names are reported as such, never filled in.

### Step 3: Market and sector context

Pull the relevant benchmark via `hexin-stock.get_stock_performance` 传指数代码(如 `000300.SH`)取窗口序列;单日截面的 PE/PB 用 `hexin-index.index_data`. Every per-name move is read against its benchmark: a -1% name on a -2% tape is relative strength.

For sector context prefer `hexin-index.sector_data` (成份区间涨跌幅, 市盈率(TTM,整体法), 总市值, 成份股个数) over a proxy index — it is the actual sector aggregate rather than an index that approximates it. **The subject must name the 板块 and its classification** — `食品饮料板块(申万行业)`; a bare 行业名 comes back as an empty table, which looks like absence rather than a lookup that missed (an unambiguous name like `白酒板块` happens to resolve without the classification). Read 板块名称 back to confirm what resolved, and if the 板块 will not resolve, say the sector aggregate was unavailable and fall back to the index — do not present the index as the sector.

### Step 4: Attribute the outliers

For each name moving beyond the greater of ±2% or 2× benchmark move:

**First establish whether the move is actually abnormal for this name.** Pull `hexin-stock.get_risk_indicators` (波动率(年化), 区间最大回撤, BETA) and read the window back from the response. A −4% day on a name that runs 60% annualised vol is inside its ordinary range; the same −4% on a 15%-vol name is the event. A move within the name's normal dispersion is reported as such and **not** given a narrative — inventing a cause for noise is the failure mode this step exists to prevent. The comparison is `[测算]`; the vol/回撤/BETA inputs are `[披露]` with their windows stated. BETA additionally tells you how much of the move the tape alone explains.

For moves that clear that bar:

1. Check disclosed events first: 万得 `wind-docs.get_company_announcements` for filings and `wind-docs.get_financial_news` for press — neither takes a date parameter, so put the window in the `query` and filter after. For third-party coverage the vertical index `finance-search.finance_search` does filter, via `date_from`/`date_to`.
2. Check corporate events：分红除权、股东增减持 via `wind-stock.get_stock_events`；**限售解禁** via `wind-docs.get_company_announcements`（无结构化解禁表，读公告正文）.
3. Only if nothing disclosed explains it, offer a labeled hypothesis: sector beta, peer read-across, flow/technical. Tag `[推断]` vs `[披露]`, with `[n]` source markers. The move-vs-benchmark spread is our arithmetic, so it is `[测算]`.

Do not attribute small moves — "在指数波动范围内" is a complete answer.

### Step 5: Assemble the recap

Short-form by default: Markdown in-session, per the house formatting policy. If the user asked for a document, the recap goes to PDF via the `report-render` skill — never hand-rolled with weasyprint, wkhtmltopdf, pandoc, or a bare reportlab script, because those do not emit `[n]` as PDF link annotations and the citations arrive unclickable. A multi-name move-and-attribution table goes to `.xlsx` via `xlsx-author`. Word is the answer only when the user asks for it or the reader will edit the file — `report-render`'s `DocxReport` builds it with the same calls; unspecified long-form stays PDF (the house formatting policy). **要出 Word 就先载入 `report-render` 技能，再动手建。** `DocxReport` 与 `Report` 同一套调用；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

```
**[日期] 收盘复盘 — [清单名]**（基准: [指数] [涨跌幅] · 检索于 [date] [时间] 收盘）

**需要关注**（最多 3 条 — 有事件、破位、或需要决策的）
- [标的]: [动作/事件一句话] + 我们的读法 [n]

**异动归因**
- [标的] [涨跌幅] vs 基准 [x%] `[测算]`: [披露事件 [披露] 或推断 [推断]] [n]

**其余持仓**: 一行带方向的汇总（如 "其余 12 只随指数波动 ±1% 以内"）

**明日日历**: 财报、解禁、股东大会、宏观数据（仅列清单相关的）

**覆盖范围与局限**: 检索于 [date] [时间] 收盘。覆盖清单内 [N] 只的行情、公告、公司事件与新闻;停牌/无行情 [标的] 已如实标注。本次未覆盖: [源不可用的项,如龙虎榜、融券余额]。"检索范围内未发现事件"指上述源在本窗口内无记录,不等同于无事发生。

## 来源
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

If the list has weights, lead with portfolio-level return and top contributors/detractors instead of raw moves (portfolio return is `[测算]` — state the weighting basis).

**The coverage label is `覆盖范围与局限`, verbatim.** A recap compresses the block to
prose rather than a table, but the label itself does not get renamed: `近期关注与局限`,
`数据说明`, `局限性` and a numbered section heading of your own all read as *no coverage
statement* to a reader looking for one and to every downstream check. Keep the label,
put whatever structure suits the length behind it.

### Step 6: Provenance

- Every price and move carries `检索于` with time and session (`检索于 [date] 15:00 收盘`), since an intraday quote's meaning depends on it.
- Every event: an `[n]` marker mapped to the `## 来源` section. `〔一手|二手〕` is mandatory — an exchange announcement is `一手`, a news outlet relaying one is `二手` and names what it relays. A quote pulled from a data API with no publication date carries `检索于 [date]` alone.
- The count of distinct `[n]` markers equals the number of entries; `数据来源见上` is not a citation.
- `[测算]` and `[推断]` are never dropped for brevity: the reader cannot otherwise tell our arithmetic and our reading from a disclosure.
