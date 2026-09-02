---
name: holdings-style
description: Analyze what funds actually hold — holdings vs label, style drift over report dates, concentration, and cross-fund overlap for shortlists. Triggers on "持仓分析", "风格漂移", "重仓股", "两只基金重合度", "holdings overlap", "名不副实".
---

# Holdings & Style Analysis

What the fund actually holds vs. what its name and benchmark claim, and how that changed over time.

> Engine field 口径 traps that change conclusions — 「近N年年化」 is not
> geometric, 「规模」 is merged across share classes — are documented in
> `../fund-screen/references/fund-return-traps.md`. Recompute rather than
> quoting the field.

## Workflow

### Step 1: Pull holdings with report dates

`hexin-fund.get_fund_portfolio` per fund. Record per snapshot: report date, coverage (top-10 quarterly vs 全持仓 semi-annual), and weights. All conclusions inherit the coverage limit — top-10-based statements say so.

### Step 2a: Holdings-based analysis (持仓法)

- **Label check**: holdings sector/cap-size mix vs the fund's stated benchmark and name (a "消费" fund holding 40% semis is the headline).
- **Concentration**: top-10 weight, single-stock max, sector max.
- **Drift**: compare 2-4 consecutive report dates; list the entering/exiting names and sector-weight deltas. Drift is described with dates, not motives.
- Underlying-stock context via `hexin-stock` lookups when a position needs explaining (e.g. the top holding just moved 30%).
- **Coverage caveat**: A股 quarterly reports disclose only the top-10 (前十大), so holdings-based drift is blind between the semi-annual 全持仓 dates. When conclusions rest on top-10-only snapshots, say so and lower the stated confidence.

### Step 2b: Returns-based style analysis (净值回归 RBSA)

The holdings-based view is precise but low-frequency and lagged; returns-based style analysis (Sharpe 1992) is higher-frequency and fills the between-report blind window. Run it as a **parallel track**, not a replacement — never merge regression exposures into the disclosed-holdings weight table.

- **Inputs**: fund NAV series via `wind-fund.get_fund_kline`（场外基金净值不在 `hexin-fund` 的日频端点里） over the analysis window — use **复权/累计净值** so dividend ex-dates do not pollute the regression, and compute **weekly returns** (daily is acceptable for short tenures; state the frequency used); a basket of style-index return series via `hexin-index.index_data` at the same frequency (representative set: 大盘/中盘/小盘 × 成长/价值 — the 国证/巨潮风格指数六件套 is the standard A-share basket — plus a 中证全债-class index to absorb bond/cash exposure), one index per query by 简称. State the exact indices used.
- **Method**: rolling constrained regression of fund returns on the style-index returns — weights ≥ 0 and summing to 1 — over a rolling window (state it; e.g. 24–52 weekly observations). Read the exposure weights' migration across windows as style drift. **Report the regression R² alongside the weights**: a low R² means returns are mostly selection rather than style, and the style read is correspondingly weak — say so instead of presenting the weights at face value. The regression is computational; run it via a script (per the `xlsx-author` scripts pattern) rather than by hand.
- **Reading it**: RBSA style weights and their drift are entirely `[测算]`. Do not over-read — regression on a small basket carries collinearity noise; a single window's exposure is not a style verdict.
- **Two-track divergence is itself a signal**: when the holdings-based read (Step 2a) and the RBSA read (Step 2b) disagree on the fund's style, surface the divergence explicitly. That judgement is `[推断]`, and it is a stronger drift warning than either track alone.

### Step 3: Cross-fund overlap (shortlists)

For 2-6 funds: pairwise overlap = sum of min(weight_i) over common names, on the same report date where possible (state when dates differ). Output the overlap matrix plus the common-name table. High overlap (>50%) between candidate funds is the key finding for allocators — diversification on paper only.

### Step 4: Output

Short-form is Markdown in-session. The holdings, overlap matrix, and RBSA exposure tables go to `.xlsx` via `xlsx-author` when the allocator will work through them — that is its **Class B** case (many retrieved holding rows, few formulas), so the `来源` worksheet plus a `来源编号` column per row carries the provenance and the `口径与局限` block on that sheet carries every `报告期` and the RBSA window. The regression weights you fitted are yours, not retrieved: those cells are Class A and take a `Source:` comment naming the window, the style indices, and the R². A written style read goes to PDF via `report-render`; never hand-roll it, because a hand-rolled PDF does not emit `[n]` as link annotations. 用户要 Word 时同样走 `report-render`（`DocxReport`，与 `Report` 同一套调用）——**要出 Word 就先载入 `report-render` 技能，再动手建**；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

```
**持仓与风格分析**（报告期: [date], 覆盖: [前十/全持仓], 检索于: [date]）

[单基金] 名实核对 / 集中度 / 期间变化表（持仓法）
[单基金] 净值回归风格暴露迁移表（RBSA，窗口: [起—止], 风格指数: [列明]） — 单列,不与披露持仓权重混表
[双轨结论] 持仓法 vs RBSA 是否一致;分歧作为漂移预警（[推断]）
[多基金] 重合度矩阵 + 共同重仓表

## 覆盖范围与局限
检索于: [date] · 报告期: [每只基金各自的报告期,不一致时逐只列出]

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 全持仓(半年度) | 有记录 / 检索范围内未发现 / 源不可用 | [系统] | [date] |
| 前十大(季度) | ... | [系统] | [date] |
| 历史报告期([N] 期) | ... | [系统] | [date] |
| 标的股票口径数据 | ... | [系统] | [date] |
| 净值回归(RBSA: 窗口 / 风格指数暴露) | ... | [系统] | [date] |

本次未能覆盖: [取不到的报告期、缺权重而被排除的标的、失败的源及其本应覆盖的内容]
数据滞后性: 全持仓半年度披露、前十大季度披露,滞后 [X] 天;前十大覆盖 [Y]% 净值,其余持仓未知。仅前十大快照的结论已相应降低置信度。
报告期 [date] 不等于当前持仓 — 本文所有结论均为该报告期的状态,不表述为"当前持有"。

## 来源
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

### Guardrails

- Never present lagged holdings as current positioning; the report date is part of every
  claim. `报告期` (data-as-of) and `检索于` (when we looked) are separate fields and are
  never substituted for one another.
- Overlap math only on retrieved weights; missing weights exclude the name from the
  calculation (and say so).
- Style conclusions need at least two report dates; one snapshot describes a moment, not a
  style. RBSA can flag drift between report dates, but its exposures are model estimates, not
  disclosed holdings — never present an RBSA weight as something the fund is disclosed to hold.
- Provenance: disclosed holding rows, weights and report dates are `[披露]`; 集中度、
  赫芬达尔指数、重合度百分比、板块权重变动、RBSA 风格暴露与其迁移 are all ours and carry
  `[测算]`; a drift or 名不副实 read, the two-track (持仓法 vs RBSA) divergence judgement, and
  any motive attributed to a position change, is `[推断]`; an unconfirmed report about a
  position is `[媒体]`. `[测算]`, `[推断]` and `[媒体]` are never omitted, including inside the
  overlap matrix and the RBSA table.
- Sources entries: 基金定期报告(季报/半年报/年报) and 同花顺 holdings fields sourced
  from those are `一手` — name the system, the `报告期`, and `检索于`. RBSA is derived from the
  fund NAV series and style-index series — name those series and their windows, not a report
  date. A media article is `二手` and names what it relays. Distinct `[n]` markers must equal
  the entry count.
