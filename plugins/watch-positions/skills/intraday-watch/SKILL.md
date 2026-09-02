---
name: intraday-watch
description: Intraday snapshot of a watchlist while the session is open — live quotes, move-vs-benchmark, and which names are moving beyond their own normal range. Triggers on "盘中", "现在怎么样", "实时", "盘中异动", "现在涨跌", "intraday", "live quotes", "盘中监控".
---

# Intraday Watch

The session is still open, so nothing here is a conclusion. This skill reports what is
moving right now, against the tape and against each name's own normal dispersion, and
hands the reader a shortlist to look at — it does not explain intraday moves and does
not tell anyone to trade.

> `close-recap` is the same list after the close, with attribution against disclosed
> events. **Attribution belongs there, not here**: intraday, the announcement record has
> usually not caught up with the price, so a cause offered now is a guess wearing a
> citation. If the user wants "why", say the disclosed record is checked after the close
> and offer `close-recap`.

## The two tools here take structured parameters, not a natural-language query

Every other 同花顺 tool in this plugin takes `{"query": "..."}`. These two do not:

```
hexin-stock.stock_highfreq_quotes
hexin-index.index_highfreq_quotes
  symbols     comma-separated, 简称 and/or code mixed: "<简称>,<代码>"
  indicators  comma-separated 中文 names: "最新价,涨跌幅,成交量,换手率"
  data_mode   "real_time" for the latest snapshot
  interval    1
```

The response is shaped differently too — no `indicators_params`. It carries:

- `tables` — a header row followed by one row per symbol
- `sympolMap` (the vendor's spelling) — how each symbol resolved: `<简称> → <证券代码>`
- `indicatorMap` — the 中文 indicator name mapped to its internal field

**Read `sympolMap` back.** It is the only confirmation that the code you passed
resolved to the name you meant and not something else.

**涨跌幅 is already a percentage.** Verified across two tools on the same day:
`stock_highfreq_quotes` returned values like `0.0512` and `0.018`, and
`get_stock_performance` — which declares
`涨跌幅（单位：%）` — returned the identical numbers at identical prices for those
same names. So a `0.0512` is **+0.05%**, not +5.12%. Do not
multiply by 100.

## Workflow

### Step 1: Establish whether you actually have a live quote — from the response, not a clock

**`data_mode: "real_time"` does not fail outside trading hours.** It returns the last
available snapshot, stamped with when that snapshot was taken. Verified 2026-08-07: a
call placed at 19:31 Beijing (well after the 15:00 close) returned rows stamped
`2026-08-07 16:01:07` — a successful response carrying end-of-day data.

So, before reporting anything:

1. Read the `time` column off the returned rows. **It is Beijing time.**
2. Resolve the current date and time from the session context or the user — there is
   **no clock tool**, and the environment clock may not be Beijing (a UTC container reads
   8 hours behind, which would make a stale 16:01 stamp look like the future).
3. Compare. If the stamp is not within the current session, **say so in the first line**
   and label every figure as of that stamp:

   > 盘中快照不可用 — 最新快照为 2026-08-07 16:01（北京时间），当前非交易时段。以下为该
   > 时点数据，非实时报价。

**Never present a stale snapshot as a live quote, and never infer "the market is closed"
from the environment clock alone.** A row whose stamp is minutes old during 09:30–11:30
or 13:00–15:00 Beijing is live; anything else is a snapshot with a timestamp.

Also settle the universe: a stored watchlist under `watchlists/`, or the names the user
gave. If several lists exist and none was named, ask once.

### Step 2: Pull the snapshot

One call for the whole list — `symbols` takes the full comma-separated set, so do **not**
fan out per name here (unlike the daily tools).

- Indicators worth asking for: `最新价,涨跌幅,成交量,换手率`. Ask for what the question
  needs; this tool **silently drops indicators it cannot serve**, so reconcile what you
  asked for against the header row of `tables` and say which ones did not come back.
- A name missing from `tables` is missing, not flat — report it as `源不可用` for this
  snapshot and name it. Suspended names behave the same way.
- **There is no history in this tool** (vendor: 仅支持交易日日内数据查询，不支持历史数据
  查询). So an intraday high/low, an opening gap, or a comparison to yesterday's close
  must come from `get_stock_performance` (daily) — do not claim an intraday range this
  tool did not return.

### Step 3: The tape, at the same moment

`hexin-index.index_highfreq_quotes` for the benchmarks the list keys off (沪深300,
上证指数, 恒生指数 as applicable), same `data_mode` and the same call.

- **Take both timestamps and compare them.** A quote stamped 10:42 read against an index
  stamped 16:01 is not a relative move. Where the stamps differ materially, say so and
  do not compute the spread.
- Move-vs-benchmark is `[测算]`: `名称涨跌幅 − 基准涨跌幅`, with both stamps stated.

### Step 4: Which moves are actually unusual

A raw ±2% list is noise on a volatile book and misses everything on a quiet one. Normalise
before flagging, exactly as `close-recap` does:

- `hexin-stock.get_risk_indicators` for 波动率(年化) per name, and read its window back
  from `indicators_params` (defaults to a trailing 1 年).
- Flag a name when the move is large **relative to its own normal dispersion**, not
  against a flat threshold. State the rule you used and the vol you used.
- A move inside the name's ordinary range is reported as such and **given no narrative**.
  Intraday, that restraint matters more than at the close: the record has not caught up,
  so there is nothing to attribute to.

### Step 5: Output

Short Markdown, in-session. This is a monitoring read, not a document — do not offer PDF,
and do not build a workbook unless the user asks for one. When the user *does* ask to export
it ("导出成 Excel", "给我个表"), build it through `xlsx-author` rather than by hand: a
snapshot is a table of retrieved quotes, so every hardcoded cell carries its
`Source: <system>, <数据时点>, <indicator>` comment and the workbook closes with the `来源`
worksheet described there. A snapshot exported without its 数据时点 and source per cell is
indistinguishable from a stale one two hours later.

```
**盘中快照 — [清单名]**
数据时点: [Beijing time from the `time` column] · 基准: [指数] [涨跌幅]% (同一时点)
[若非交易时段: 一行说明这是收盘后快照,非实时报价]

**超出自身常态波动的名称**
| 名称 | 最新价 | 涨跌幅% | 相对基准% | 年化波动率%(窗口) | 数据时点 |
|---|---|---|---|---|---|
|  |  |  | [测算] | [披露] |  |

**其余名称**（在常态波动范围内,不作解读）
| 名称 | 最新价 | 涨跌幅% | 数据时点 |
|---|---|---|---|

## 覆盖范围与局限
数据时点: [stamp] (北京时间) · 交易时段: [是/否]

| 检查项 | 结论 | 源 | 数据时点 |
|---|---|---|---|
| 个股实时快照 | 有记录 [n]/[N] 只 / 源不可用 [k] 只(列名) | 同花顺 hexin-stock.stock_highfreq_quotes | [stamp] |
| 基准指数同时点 | 有记录 / 时点不一致(未计算相对涨跌) | 同花顺 hexin-index.index_highfreq_quotes | [stamp] |
| 波动率(用于常态判定) | 有记录 / 源不可用 | 同花顺 hexin-stock.get_risk_indicators | [date] |

未取到的指标: [向工具请求但未返回的指标名]
本快照不含盘中最高/最低价与开盘跳空(该工具不返回),亦不含历史序列。
盘中价格随时变动;本节结论仅对上述数据时点成立。

## 来源
[n] 〔一手〕同花顺 iFinD · [工具名] · 数据时点 [stamp](北京时间);检索于 [timestamp]
```

## Guardrails

- **This skill issues no trading view.** No 买入/卖出/加仓/减仓/止损, no target price, no
  "值得关注" that functions as a recommendation. It reports what moved and how unusual
  the move is against the name's own history; the portfolio manager decides.
- **No intraday attribution.** Do not offer a cause for an intraday move — not from news,
  not from sector beta, not from a pattern. Point at `close-recap` for attribution once
  the disclosed record has caught up.
- **Every number carries its data timestamp**, and the timestamp is the vendor's, in
  Beijing time. `检索于` and 数据时点 are different fields and are never substituted.
- A stale snapshot presented as live is a fabrication even though the number is real.
  Label it.
- Absence is absence: a name the snapshot did not return is `源不可用` with the name
  stated, never omitted and never carried at its last known price.
