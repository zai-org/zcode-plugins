---
name: macro-dashboard
description: Five-block read of the macro state — 增长 / 通胀 / 货币与流动性 / 信用 / 外部 — built from 同花顺 EDB series (`wind-economic`), each with its 口径, release lag, and next release date. Triggers on "宏观怎么看", "经济现在什么状态", "流动性松不松", "社融怎么样", "宏观仪表盘", "macro dashboard", "macro state".
---

# Macro Dashboard

Five blocks, each carrying the two or three series that actually move the debate — not every series the database has. A dashboard's job is to say where the economy is **and how stale each reading is**; a print that has not been updated for two months is a different fact from a print released yesterday, and a dashboard that hides the difference invites acting on the wrong one.

## Sourcing rules specific to this skill

**Read the resolved indicator back.** `wind-economic.query_economic_indicator_data` takes the window goes in the `beginDate`/`endDate` parameters (or `observation` for the last N periods), not in the sentence, and it resolves your concept to its nearest indicator. So for every series: read the resolved name and `code` out of `meta` (「社会融资规模存量同比」), read back the **indicator name and EDB code** it returns, then fetch that exact series. Never type an EDB code or an indicator name from memory — a near-miss returns a real series with the wrong 口径 and nothing in the output will say so. `query_economic_indicator_data` covers the standard 国内外经济统计、货币政策、行业级经济指标 set and is the faster path where it carries the series.

**Never mix 口径 inside one series.** Every row states 同比 / 环比 / 季调环比折年 explicitly, and a series that switches basis mid-window is two series, presented as two rows.

**Every series states its staleness.** Three fields, and they are not interchangeable:

- `报告期` — the period the observation belongs to (2026-06, 2026Q2).
- `检索于` — when we pulled it.
- 发布滞后 / 下次发布 — how long after the period the issuing agency publishes, and the next scheduled release date.

Take the next release date from the issuing agency's release calendar. If it cannot be retrieved this run, say so — write `源不可用` for that field and give the **observed lag** instead (latest 报告期 vs 检索于), tagged `[测算]`. Do not guess a calendar date.

## Workflow

### Step 1: Scope and anchor

Economy (default 中国), window (default 24 个月 of history so a level can be read against its own recent range), and whether the reader wants the standing dashboard or a specific block. Anchor today from the session context or the user rather than assuming it (no clock tool).

### Step 2: Pull the five blocks

For each block, choose the two or three series that carry the argument. Re-verified against `wind-economic` on 2026-08-24, after the tool rename — two things changed and both bite: **prefix the country.** A bare concept resolves to whichever series ranks first, and 3 of 8 tested landed on a **foreign** country's series instead — 社会消费品零售总额, CPI and 核心CPI all resolved abroad when asked without a country. With `中国` in front, all resolved correctly, 核心CPI to the right 口径 (the 不包括食品和能源 measure). And **`信用利差` can come back `受限指标已剔除:无权限`** depending on the entitlements behind the call, the same as the 中债 curve family — so where it refuses, the 信用 block runs on 社融 and 新增贷款, and the spread is a declared coverage gap rather than a series to go looking for. the resolved names still have to be read back per call, because a concept can resolve to a **neighbouring** series — asking for 核心CPI has come back as the 非食品 measure, which is not the core measure at all:

| 板块 | 通常承载论点的序列 (以搜索到的实际指标为准) |
|---|---|
| 增长 | GDP 不变价同比, 规模以上工业增加值同比, 社会消费品零售总额同比, 固定资产投资累计同比, 制造业 PMI |
| 通胀 | CPI 当月同比, 核心 CPI, PPI 当月同比 (以及 PPI-CPI 剪刀差, 若需则为 `[测算]`) |
| 货币与流动性 | M1/M2 同比, 政策利率, 银行间质押式回购利率 (DR007), 中长期国债到期收益率 |
| 信用 | 社会融资规模存量同比与当月新增, 人民币贷款新增 (信用利差 若受限则写进覆盖块) |
| 外部 | 出口金额同比, 进口金额同比, 官方外汇储备, 人民币汇率, 主要经济体政策利率 |

Rules while pulling:

- Record the returned indicator name + EDB code for every series. Both go in `## 来源`.
- A series the search returns nothing for is `检索范围内未发现`; a call that fails or is unauthorised is `源不可用`. Neither is dropped silently, and neither is replaced by a remembered number.
- Where a block has no usable series this run, the block still appears, stating what is missing and what that leaves unreadable.

### Step 3: Read each block

Per block, three sentences at most: the latest reading with its 口径 and 报告期, the direction over the window, and what would change the read. Levels and directions from the series are `[披露]`. Anything you computed — a 剪刀差, a 3-month average, a real (inflation-adjusted) rate, a contribution share — is `[测算]` and states the arithmetic. A causal read ("信用扩张主要由政府债支撑") with no series decomposing it is `[推断]`.

### Step 3.5: 货币-信用象限 (reproducible criteria)

The 货币 and 信用 blocks combine into the quadrant Chinese strategists actually
read from. State the criteria so the call is reproducible rather than a feel —
another analyst with the same series must land on the same quadrant.

- **货币 (loose / tight)** — read from DR007 relative to **the policy rate, i.e. the 7 天期 OMO 逆回购利率** (a persistent DR007 *below* it is loose; since 2024-07 the 7-day reverse-repo rate is the stated main policy rate — do not substitute LPR or MLF), plus any 降准 or OMO 7 天逆回购利率调降 in the window (an MLF operation is a quantity signal, not the policy-rate axis). State the rule you applied. EDB search concepts for the policy rate: 「7天逆回购利率」「公开市场操作:7天逆回购:中标利率」 — search first, confirm the indicator name, then fetch. **If the policy-rate series is unavailable this run**, degrade the axis rather than skipping it: read DR007's absolute level against retrieved 央行公开市场操作/降准 announcements, state "货币轴判据降级" in the quadrant output, and lower its confidence accordingly — a missing series never cancels the quadrant.
- **信用 (loose / tight)** — read from the **direction** of 社融存量同比 (a turn
  up sustained ≥ 2 months is expanding credit; a turn down is contracting), with
  新增社融 / 新增人民币贷款 as corroboration.
- **Quadrant** — 宽货币宽信用 / 宽货币紧信用 / 紧货币宽信用 / 紧货币紧信用, each
  with a stated **置信度** and the one series that would flip it. The classic read
  (宽货币+宽信用 supports equities, 宽货币+紧信用 supports bonds) is context, not a
  recommendation — this skill does not set weights.

The two axis readings are `[披露]` (levels) plus `[测算]` (the loose/tight rule
you applied, arithmetic shown); the quadrant label and its confidence are
`[推断]`. Where a required series is `源不可用`, the axis is undetermined and the
quadrant says so rather than guessing.

### Step 4: Cross-block tension

One short section: where the blocks disagree. Strong credit against weak growth, falling PPI against a firm policy rate — the tension is the useful part of a dashboard, and it is `[推断]` unless a series settles it.

### Step 5: Assemble

Short-form (the standing dashboard) is Markdown in-session. A quarterly or client-facing macro outlook is long-form and goes to PDF via `report-render`; a series-level appendix goes to `.xlsx` via `xlsx-author`. State the choice in one clause. 用户要 Word 时同样走 `report-render`（`DocxReport`，与 `Report` 同一套调用）——**要出 Word 就先载入 `report-render` 技能，再动手建**；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

```
# 宏观仪表盘 — [经济体]
检索于: [date] · 观察窗口: [起—止] · 口径说明: 每行标注 同比/环比/季调环比折年

## 一句话状态
[增长/通胀/流动性/信用/外部 的合成读数,含最陈旧序列的滞后提示]

## 一、增长
| 指标(EDB 代码) | 口径 | 最新值 | 报告期 | 前值 | 发布滞后 | 下次发布 | 标签 |
|---|---|---|---|---|---|---|---|
| [指标名]([代码]) | 同比 | [值] | [YYYY-MM] | [值] | [X 天] | [date] 或 源不可用 | [披露][n] |
[两三句解读]

## 二、通胀
## 三、货币与流动性
## 四、信用
## 五、外部
[同一表结构]

## 货币-信用象限
货币: [宽/紧, 判据: DR007 vs OMO 7天逆回购利率 + 降准/OMO利率调降动作] [测算]
信用: [宽/紧, 判据: 社融存量同比方向(连续 N 月)] [测算]
象限: [宽货币宽信用 / …] · 置信度: [高/中/低] · 可翻转信号: [某序列] [推断]

## 板块间张力
[推断] [哪两个板块在讲不同的故事,以及什么序列能证伪]

## 覆盖范围与局限
检索于: [date] · 口径/委托用途: 宏观状态研判

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 增长(3 项序列) | 有记录 / 检索范围内未发现 / 源不可用 | wind-economic(万得) | [date] |
| 通胀(N 项序列) | ... | wind-economic(万得) | [date] |
| 货币与流动性(N 项) | ... | wind-economic(万得) | [date] |
| 信用(N 项) | ... | wind-economic(万得) | [date] |
| 外部(N 项) | ... | wind-economic(万得) | [date] |
| 发布日历(下次发布日) | ... | [发布机构] | [date] |

本次未能覆盖: [取不到的序列,以及它本应回答的问题]
数据滞后性: 本页最陈旧的读数为 [指标](报告期 [YYYY-MM],发布滞后 [X] 天);
月度序列在月中发布前反映的仍是上上月的经济状态。

## 来源
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

`## 来源` entries for a macro series: `一手` is the issuing statistical agency or central bank (国家统计局、中国人民银行、海关总署), and an EDB field (万得 `wind-economic`) sourced from those is `一手` — the entry names **the indicator and its EDB code** plus `检索于`, since a live query has no publication date of its own. A news article about a print is `二手` and names what it relays. Distinct `[n]` markers must equal the entry count.

## Guardrails

- No fabricated prints, no remembered levels, no invented release dates. A series that could not be fetched is `源不可用`, and the block says what that leaves unreadable.
- `检索范围内未发现` is a statement about the search, never rendered as 无数据 or 无变化.
- 同比 / 环比 / 季调环比折年 are labelled on every row and never averaged across bases.
- A revision matters: when the source revised a prior print, show the revision rather than the current vintage alone.
- Descriptive, not predictive. This skill states where the economy is; a forward call belongs in `asset-allocation`, with a falsifying signpost attached.
