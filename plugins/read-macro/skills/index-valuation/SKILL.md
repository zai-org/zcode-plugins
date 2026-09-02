---
name: index-valuation
description: Where an index's valuation sits inside its own history — PE/PB/PS with stated-window historical percentiles, weighted 成份股 earnings, and a 盈利 vs 估值 decomposition of a period's return. Triggers on "估值分位", "指数贵不贵", "沪深300 PE", "指数估值历史位置", "盈利与估值拆分", "index valuation", "valuation percentile".
---

# Index Valuation

Two questions, and the second is the one that gets skipped: **where is the multiple inside its own history**, and **how much of the period's move was earnings rather than the multiple**. Both answers are worthless without their window, so the window is stated everywhere the number appears.

## The two failure modes this skill exists to prevent

**A percentile with no window.** 「PE 处于历史 12% 分位」 over three years and over ten years are different claims, and they routinely disagree in direction. Every percentile in the output carries **its lookback window and its start date**, in the same cell or the same sentence. If `hexin-index.index_data` returns a percentile whose default window is ~1 year (its metadata shows `截止日前一交易日`), and asking for 「5 年」/「10 年」 in the query does NOT change it — a 5-year phrasing came back empty. So for any window beyond 1 year: fetch the raw PE/PB daily series and compute the percentile yourself, label `[测算]` with the window you chose. Presenting a percentile whose window you do not know is the failure — it looks like the most precise number on the page.

**A decomposition presented as a fact.** The 盈利/估值 split is arithmetic on two retrieved series, so it is `[测算]`, and it states the identity it used and the inputs it used.

## Workflow

### Step 1: Resolve the index

`wind-index.get_index_basicinfo` — full name, 发布机构, 基日, 基点, 计算方法, 成分数量, 分类。`hexin-index.index_data` 的指标字典只有价格与 PE/PB,没有这些编制信息。 Two indices with similar names (全收益 vs 价格指数, 全指 vs 成分指数) have different levels and different valuation histories; say which one every number belongs to. Confirm the window and the percentile lookback with the user if they did not state one; default to a stated 10 年 lookback and say that it is the default.

### Step 2: Valuation and its history

**Levels from 同花顺, percentiles from Wind.** `hexin-index.index_data` gives PE / PB levels and
index-level 每股收益; `wind-index.get_index_fundamentals` gives the percentile **with 排名 /
最大排名**, so the reader can recompute it, and it serves multi-year windows. Report the rank
and sample size beside every percentile.

- **Never take a percentile from 同花顺** — its windows are broken in two different ways, and
  a 分位数 of 100.0 is the tell. Traps §1 / §8.
- **Never mix the two vendors' percentiles in one table.** They disagree materially — 12 points apart
  on 沪深300 on the same day (traps §9). Name the vendor, the window and the 口径 on
  each one, and use a single vendor throughout any comparison.
- 隐含 ROE = PB / PE, `[测算]` — there is no 成份股加权 ROE field on either vendor (traps §2).

Record for each multiple:

- The 口径 — PE(TTM) / PE(静态) / PE(动态) are three different numbers, never compared.
- 报告期 of the earnings and `检索于` for the price. Different dates; both in the header.
- The percentile, its window, and the window's start date.

**板块-level valuation** — three routes, not interchangeable, say which you used:

| 需要 | 走哪条 |
|---|---|
| 板块当期估值水平 | `hexin-index.sector_data`(整体法,一次调用给 PE/总市值/成份股个数) |
| 板块估值分位 | 该板块对应的**指数** → `wind-index.get_index_fundamentals` |
| 非整体法加权,或无对应指数 | 枚举成份股 `hexin-stock.get_stock_financials` 自行加权 |

`sector_data` 的主体必须写成 `<板块名>板块(<分类体系>)`,例如 `食品饮料板块(申万行业)`;空表是
**解析失败而非无数据**(traps §7)。它**没有分位数指标**,问它会凭空作答(traps §6)。

### Step 3: Price series for the period

K 线序列走 **`hexin-stock.get_stock_performance`**（`codes` 收指数代码，
如 `000300.SH`；`indicators` 收 收盘价/成交量/涨跌幅/换手率；`start_date`+`end_date`
给窗口）。它按交易日历过滤，非交易日不会被填进序列。

**PE/PB 只有单日截面，没有日频序列。** `hexin-index.index_data` 一次一个日期，
可取 收盘价/开盘价/最高价/市盈率/市盈率中位数/市净率。它的「市盈率」口径上游未说明
（返回体会带 `口径提醒`），要明确 TTM 口径或要分位数时不要用它。

**分位数走 `wind-index.get_index_fundamentals`**，它返回 排名/最大排名/分位数
三者，所以那个百分位是可复现的（分位 = 排名 ÷ 最大排名，实测两者能对上）。
自己按日频 PE 序列算分位数这条路走不通——没有那个序列。

### Step 4: Decompose the period return — `[测算]`

For window t0 → t1, with P the index level, E the index earnings per unit, and M the multiple (P = M × E):

```
P1/P0 = (M1/M0) × (E1/E0)
盈利贡献 = E1/E0 − 1
估值贡献 = M1/M0 − 1
交叉项   = (E1/E0 − 1) × (M1/M0 − 1)
```

State, every time: which multiple (PE(TTM) unless said otherwise), which earnings series it implies, the two endpoint dates, and that the three components multiply rather than add — reporting them as an additive split without the 交叉项 is the common error. A log decomposition (`ln(P1/P0) = ln(M1/M0) + ln(E1/E0)`, additive by construction) is an acceptable alternative when it is named as the method used. Dividends are outside a price-index decomposition; say so rather than letting the residual absorb them.

Do not run the decomposition when either endpoint's earnings series is missing — report `源不可用` for the split and keep the price return, which is still a fact.

### Step 5: Read it

- Where the multiple sits versus its own history, with the window.
- What the weighted earnings series has been doing — a low percentile on collapsing earnings is not the same signal as a low percentile on flat earnings, and the decomposition is what tells them apart.
- Composition drift: if 成分数量 or 计算方法 changed inside the lookback, the early part of the percentile window is a different index. Flag it; this is `[推断]` unless the index provider documented the change, in which case cite it.

### Step 6: Assemble

Short-form is Markdown in-session. A valuation section inside a strategy report goes to PDF via `report-render`; a multi-index percentile table goes to `.xlsx` via `xlsx-author`. State the choice in one clause. That workbook is `xlsx-author`'s **Class B** case — many retrieved rows, few formulas — so its provenance vehicle is the `来源` worksheet plus a `来源编号` column on every data sheet, not a comment per cell, and the `口径与局限` block on the `来源` sheet carries the coverage states. A roster delivered without those has no provenance at all. 用户要 Word 时同样走 `report-render`（`DocxReport`，与 `Report` 同一套调用）——**要出 Word 就先载入 `report-render` 技能，再动手建**；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

```
# [指数全称]([代码]) 估值位置
检索于: [date] · 盈利报告期: [date] · 估值分位回溯窗口: [X 年](起始 [date])

## 结论一句话
[当前倍数 + 分位 + 窗口 + 盈利方向]

## 估值与历史分位
| 指标 | 口径 | 当前值 | 分位 | 回溯窗口(起始日) | 报告期 | 标签 |
|---|---|---|---|---|---|---|
| PE | TTM | [值] | [X%] | [X 年]([date]) | [date] | [披露][n] |
| PB | — | [值] | [X%] | [X 年]([date]) | [date] | [披露][n] |
| PS | TTM | [值] | [X%] | [X 年]([date]) | [date] | [披露][n] |

## 成份股加权盈利
| 项目 | 最新 | 同比 | 报告期 | 标签 |
|---|---|---|---|---|
| 加权净利润 | [值] | [%] | [date] | [披露][n] |
| 加权 ROE | [值] | [pp] | [date] | [披露][n] |

## 区间收益拆分 [测算]
窗口: [t0] → [t1] · 方法: P = M × E,乘法拆分(含交叉项) · 倍数口径: PE(TTM)
| 分项 | 贡献 | 说明 |
|---|---|---|
| 区间价格收益 | [%] | 来自 hexin-index.index_data [n] |
| 盈利贡献 | [%] | E1/E0 − 1 |
| 估值贡献 | [%] | M1/M0 − 1 |
| 交叉项 | [%] | 两者乘积 |
不含股息;价格指数口径。

## 读数
[分位的含义、盈利方向、成分或算法变更提示(如有,标 [推断] 或引用指数公司公告)]

## 覆盖范围与局限
检索于: [date] · 口径/委托用途: 指数估值研判

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 指数基础信息(基日/算法/成分数) | 有记录 / 检索范围内未发现 / 源不可用 | hexin-index | [date] |
| PE/PB 当期水平 | ... | 同花顺 hexin-index.index_data | [date] |
| 历史分位(含排名/最大排名) | ... | Wind wind-index.get_index_fundamentals | [date] |
| 分位回溯窗口口径 | 有记录 / 源不可用(自算,窗口见表头) | hexin-index | [date] |
| 隐含ROE(自算 PB/PE) | ... | hexin-index [测算] | [date] |
| 区间 K 线 | ... | hexin-index | [date] |

本次未能覆盖: [取不到的序列,以及它本应回答的问题]
数据滞后性: 盈利端报告期 [date],价格端 检索于 [date];季报披露前分位包含的是上一期盈利。

## 来源
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

`## 来源`: the index provider's own publication (中证指数、上交所、深交所、Wind 指数说明) is `一手`; a Wind index field sourced from the provider is `一手` and names the field and the index code, with `检索于`. A broker note quoting a percentile is `二手` and names what it relays — and is not a substitute for pulling the number. Distinct `[n]` markers must equal the entry count.

## Guardrails

- No invented percentiles, no remembered multiples, no example numbers left in the template. Placeholders stay placeholders until the tool returns a value.
- Never compare PE(TTM) against PE(静态), a 全收益 index against a 价格 index, or a percentile computed over one window against one computed over another. Where the user's question forces such a comparison, restate it on one basis and say what you changed.
- A negative or near-zero earnings base makes PE meaningless rather than high; say so instead of reporting a large multiple.
- 分位 is a description of history, not a forecast. This skill does not conclude 买入/卖出 and does not set a target level.
