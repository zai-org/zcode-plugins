---
name: curve-spread
description: Yield-curve and credit-spread picture across a set of bonds — levels and spreads segmented by 评级 / 期限 / 行业 / 属性(城投 vs 产业), benchmarked against the government curve and policy rates. Triggers on "信用利差", "收益率曲线", "利差走势", "城投利差", "期限利差", "等级利差", "曲线怎么走", "credit spread", "yield curve".
---

# Curve and Spread Analysis

The market, not one bond. A single bond's spread says nothing without the distribution it sits in; this skill builds that distribution and the risk-free curve underneath it.

> Before building a curve: the 中债 yield-curve series are often **discoverable but not
> retrievable** on 万得 `wind-economic` — `search_economic_indicator` returns indicator
> codes for 国债 / 企业债AAA / 中短期票据AAA, while `query_economic_indicator_data` can
> refuse those same codes with 「受限指标已剔除:无权限」.
> Whether it refuses depends on the entitlements behind the call, not on the series, so
> **test the benchmark you intend to use before depending on it** — and where it refuses,
> the benchmark is **self-built**, see Step 2. The
> 利差 field has no disclosed benchmark, and a universe of MoF/policy-bank
> paper yields a 品种利差 rather than a credit spread. See
> `../bond-profile/references/bond-spread-traps.md`.

## Workflow

### Step 1: Define the universe and the as-of date

State three things before any call, and repeat them in the output header:

- **The bond set** — which bonds, and how they were chosen. This skill has no screener: the universe is the list the user supplied, the outstanding bonds of a named issuer or group, or a list assembled in a prior step. If the user asked for "城投利差" with no list, say that the universe must be specified and offer to work from a list they provide — do not silently pick names.
- **The as-of date** — one date for every bond in a level comparison. Resolve today from the session context or the user; pass 同花顺 dates as `yyyyMMdd`.
- **The benchmark** — which curve the spreads are measured over (中债国债到期收益率曲线, 国开债曲线, or another), and how tenor points are matched to each bond's 剩余期限.

### Step 2: Risk-free curve and policy backdrop — `wind-economic`

1. **Test the 中债 curve family before depending on it — it is commonly not retrievable** (`query_economic_indicator_data` → 「受限指标已剔除:无权限」 on the 国债 / 企业债AAA / 中短期票据AAA curve codes, depending on the entitlements behind the call). Where it refuses, build the risk-free curve from **outstanding 记账式国债 individual bonds** instead: take their YTM on the as-of date via `hexin-bond.bond_market_data`, interpolate the tenor points you need, and label the whole benchmark `[测算]` with the bonds and the interpolation stated. Cross-check one point against a published curve where you can reach one, and report the difference in bp.
   Anything you *do* retrieve from `wind-economic`: **read `name` / `code` / `source` back from the response `meta`** and cite those, not the concept you typed — the tool resolves to its nearest match, which is not always the 口径 you meant.
2. Policy backdrop from the same tool: `中期借贷便利(MLF):操作利率:1年`, `逆回购:7日:回购利率`, `DR007` — all verified. Anything you cite must be retrieved; a rate quoted from memory is a fabrication.
3. Record each series' own publication frequency and lag. A monthly macro series compared against a daily valuation is a mismatch and is labelled as one.

### Step 3: Bond-level yields and spreads — `hexin-bond`

Per bond, and one code per call (fan out and merge):

- `bond_market_data` — 估价收益率, 利差, 久期/修正久期, 溢价, on the as-of date.
- `bond_basic_info` — 剩余期限 (or 行权期限, labelled), 债券分类;发行规模与票面利率走 `wind-bond.get_bond_basicinfo`. A 含权 bond is bucketed by the horizon the market prices it to; say which you used.
- `bond_basic_info` — 行业分类 and 属性 for the segmentation in Step 4.

Where the vendor 利差 does not name its benchmark, either restate it as `基准口径未披露` or compute your own as `估价收益率 − 基准曲线同期限点`, tagging it `[测算]` with the curve, the tenor point, the interpolation method, and the date. Do not silently mix vendor spreads and your own in one column.

Ratings come from `wind-bond.get_bond_issuer_info` (债项评级 / 主体评级 / 评级机构 / 评级类型 / 评级日期), corroborated by `wind-docs.get_company_announcements` where the reasoning matters. **Read back `主体评级类型` per bond** — a guaranteed bond can return the guarantor's rating in the 主体评级 column, and bucketing by it silently sorts a weak issuer into the guarantor's bucket. Bucket on the 债项评级 unless you have confirmed the 主体评级 is the issuer's own. A bond whose rating could not be established goes into an explicit `评级未取得` bucket and is **not** quietly dropped, because dropping it biases every bucket it would have joined.

### Step 4: Segment, and state the N

Cut the set by 评级 / 剩余期限 / 行业 / 属性(城投 vs 产业), one dimension at a time and then in the two-way cuts the question needs.

**Every bucket reports its N next to its statistic.** The rules:

- **N = 1 is an observation, not a level.** Report the bond and its spread by name; do not call it a 平均 or a 中位数 and do not plot it as a curve point.
- **N below the threshold you set** (state the threshold, commonly 3–5) reports the individual observations and range instead of a central tendency.
- Prefer the median plus the range or interquartile spread over a bare mean; a single distressed name drags a mean and the reader cannot see it happened.
- Every bucket statistic is `[测算]` with its formula, its N, and its as-of date.
- A bucket with zero members is shown as an empty row with N = 0, not omitted. An omitted row reads as "no such segment".

### Step 5: Read the picture

Separate what the data shows from what you think it means.

- Levels and differences are `[测算]` off `[披露]` inputs: 等级利差 (AA vs AAA at the same tenor), 期限利差 (5Y vs 1Y within a rating), 品种利差 (城投 vs 产业 at matched rating and tenor), each stated with both buckets' N.
- Time-series moves need the same benchmark on both dates. A spread that widened because the benchmark curve fell is a different story from one that widened because the bond's yield rose — decompose it and say which.
- Causal readings — 供给冲击, 资金面收紧, 板块风险偏好变化, 政策预期 — are `[推断]` with the basis named. Where a policy or macro series is the basis, cite it.
- Do not extend a conclusion beyond the universe you actually queried. "本样本内" belongs in the sentence.

### Step 6: Output

A bucket table across many bonds is the natural .xlsx deliverable — build it with `xlsx-author`. That workbook is `xlsx-author`'s **Class B** case — many retrieved rows, few formulas — so its provenance vehicle is the `来源` worksheet plus a `来源编号` column on every data sheet, not a comment per cell, and the `口径与局限` block on the `来源` sheet carries the coverage states. A roster delivered without those has no provenance at all. A written curve note is PDF via `report-render` if long-form, Markdown in-session if short. State the choice in one clause. Word is the answer only when the user asks for it or the reader will edit the file — `report-render`'s `DocxReport` builds it with the same calls; unspecified long-form stays PDF (the house formatting policy). **要出 Word 就先载入 `report-render` 技能，再动手建。** `DocxReport` 与 `Report` 同一套调用；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

```
**信用利差与曲线 — [样本描述]**
样本: [N] 只, 取自 [样本来源与筛选口径] · 检索于: [timestamp] · 基准曲线: [曲线名] · 期限匹配: [匹配/插值方法]

标签口径: [披露] 系统披露 · [测算] 本文推导 · [预期] 第三方具名预期(数据商一致预期,非同业券商测算) · [推断] 分析师推论 · [媒体] 媒体报道未经记录佐证

**一、基准与资金面**（检索于 [date]）
| 指标 | 数值 | 频率 | 报告期/观测日 | 源 |
|---|---|---|---|---|
| [国债/国开 1Y/3Y/5Y/10Y 各一行] |  | 日 | [date] | 万得 wind-economic (指标名/code) [披露] [n] |
| [政策利率] |  | [频率] | [date] | 万得 wind-economic (指标名/code) [披露] [n] |
| [资金面指标] |  | 日 | [date] | 万得 wind-economic (指标名/code) [披露] [n] |

**二、分组利差**（单位 bp; 每格标注 N; 检索于 [date]）
| 分组 | N | 中位利差 | 区间(min–max) | 中位剩余期限 | 说明 |
|---|---|---|---|---|---|
| [评级 × 期限桶 / 行业 / 城投·产业, 逐行] | [n 数] | [测算] | [测算] | [测算] | N≤[阈值] 时改列个券, 不给中位数 |
| 评级未取得 | [n 数] |  |  |  | 评级字段与公告均未取得, 未从样本剔除 |

分组口径: 利差 = [本券收益率口径] − [基准曲线名 + 期限点], [date]; 计算方式 [厂商给定 / 本文测算, 二者不混列]。

**三、观察**
- [事实性差异, 逐条带 N 与 [n]]
- [成因判断逐条标 [推断], 并写明依据]
- 结论仅适用于本样本([N] 只, [口径]), 不外推至未纳入样本的债券。

## 覆盖范围与局限
检索于: [timestamp] · 口径/委托用途: [如 组合定价参考 / 投资研究]

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 基准曲线各期限点 | 有记录 [n] / 检索范围内未发现 / 源不可用 | 万得 wind-economic.query_economic_indicator_data (指标名与 code) | [date] |
| 政策利率与资金面 |  | 万得 wind-economic.query_economic_indicator_data | [date] |
| 个券估值与利差 | 有记录 [x]/[N] 只 / 源不可用 [y] 只 | 同花顺 hexin-bond.bond_market_data | [date] |
| 个券条款与剩余期限 |  | 同花顺 hexin-bond.bond_basic_info | [date] |
| 行业与属性分类 |  | 同花顺 hexin-bond.bond_basic_info | [date] |
| 评级(债项/主体, 含评级机构与评级日期) |  | 万得 wind-bond.get_bond_issuer_info (+ wind-docs.get_company_announcements 佐证) | [date] |

本次未能覆盖: [取不到估值或分类的个券及原因, 以及它们本应进入的分组]
数据滞后性: [估值日频滞后、宏观序列发布频率与滞后、公告披露滞后]
本插件不出具自己的评级;上表评级为评级机构评级,已注明机构与评级日期,评级变动方向系引述机构行为而非本文判断;"检索范围内未发现"仅指上述源在本次检索范围内无记录, 不构成该分组不存在风险的结论。

## 来源
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

## Guardrails

- Do not invent example numbers, bucket sizes, or spread levels. Every value above is a placeholder.
- Do not invent an EDB indicator name — `wind-economic` resolves your concept to its nearest match. Search first, read the resolved name and `code` back from `meta`, then pull that exact series.
- One as-of date across a level comparison. Mixing a stale valuation into a same-day cross-section is a defect, and a bond whose valuation is stale is reported as such rather than carried at its last print.
- Never present a bucket of one as a level, and never drop a bond because its rating or classification could not be established — put it in an explicit residual bucket with its N.
- All bp figures state whether a change is bp or percent; a level and a change never share a column.
- `[n]` markers map one-to-one onto `## 来源` entries; the distinct marker count equals the entry count. `〔一手|二手〕` is mandatory; a live EDB pull with no publication date carries `检索于 [date]` alone.
