---
name: credit-watch
description: Credit monitoring over a window for one issuer or a name list — 到期墙, negative announcements and adverse media, valuation deterioration (估值收益率跳升、利差走阔), and 担保圈 contagion — ranked by severity. Triggers on "信用风险排查", "到期压力", "到期墙", "估值异动", "利差走阔", "有没有负面", "持仓信用监控", "credit watch", "盯一下这几个主体".
---

# Credit Watch

Ongoing monitoring, not a one-off assessment. The question is what changed in a window and what a reader must act on. Findings are graded; the issuer never is — this skill issues no ratings.

> Valuation-field traps that affect spread-move decomposition are in
> `../bond-profile/references/bond-spread-traps.md`.

## Workflow

### Step 1: Scope the watch

- **Universe**: one issuer, a list of issuers, or a list of bonds. If bonds, resolve each to its issuer with `hexin-bond.bond_basic_info` so the announcement and relationship checks run at the obligor level.
- **Window**: the lookback for events (default: trailing 30 days if unspecified) and the forward horizon for maturities (default: next 12 months). Both are stated in the output header.
- **Today**: resolve from the session context or the user (no clock tool). 同花顺 dates are `yyyyMMdd`.

Confirm the universe and both windows in one line before running; a watch over an unstated window cannot be re-run comparably next time.

### Step 2: Maturity wall — `bond_basic_info`

For every outstanding bond of every name in scope: 到期日, 行权日 where 含权, 债券余额/发行规模, 票面利率, 兑付安排.

- Bucket the forward horizon (未来 1 个月 / 1–3 个月 / 3–6 个月 / 6–12 个月) and sum the amount per bucket per issuer. Those sums are `[测算]` — state that they sum retrieved 余额 fields and name any bond excluded for a missing field.
- A 回售日 inside the horizon is a maturity for this purpose. Show 到期 and 回售 amounts in separate columns and label the total's 口径; a wall that ignores 回售 understates the pressure.
- Concentration is the finding, not the total: a single month holding most of the year's redemptions is what matters. Where a comparison to liquidity is possible from `issuer-credit`'s 货币资金/短期债务, reference it; where it is not, say the wall is presented without a liquidity offset rather than implying one exists.

### Step 3: Negative disclosure and media

1. **公告** — `wind-docs.get_company_announcements` per issuer over the lookback: 评级调整, 兑付/付息公告 and any 延期/展期, 违约或交叉违约, 债务重组, 重大诉讼与被执行, 控股股东质押或变更, 审计意见, 募集资金用途变更, 主体或债项变更. All `[披露]` + `[n]`.
2. **新闻** — `wind-docs.get_financial_news` (issuer name plus 违约/展期/被查/纠纷/评级下调/非标 keywords) over the same window. Anything appearing only here is `[媒体]` and stays `[媒体]` until an announcement corroborates it, at which point it becomes `[披露]` and cites the announcement.
3. A name with no hits is reported once on a `检索范围内未发现` line, never silently omitted. A source that errored for some names says which names.

### Step 3.5: Rating migration and outlook — `bond_special_data`

Step 3 can only find a rating action if a keyword search happens to surface the 评级调整公告. This step reads it as a field instead, per bond: 最新评级变动方向 (上调/下调/维持), 主体评级展望, 债项评级, 主体评级, 评级机构, 评级类型, 最新评级日期.

- **A 变动方向 of `下调` is a 🔴 finding**, and its 评级日期 tells you whether it falls inside the window. A 展望 moved to 负面 is 🟡 — an agency signalling before it acts.
- Where a change is found, go back to `wind-docs.get_company_announcements` for the rating report: the field says *what* changed, the announcement says *why*, and the why is what the reader needs.
- **Read back `主体评级类型` per bond.** On a guaranteed bond the 主体评级 column can return the **guarantor's** rating. A downgrade landing on the guarantor is not the issuer being downgraded — but on a guaranteed structure it is still a finding, reported as the guarantor's and cross-referenced to Step 5's 担保圈 work.
- Rating field unavailable → `源不可用`; queried with no rating on record → `检索范围内未发现`. Neither is `评级稳定`.

Report the agency's action. Do not restate it as our own view of the credit.

### Step 4: Valuation deterioration — `bond_market_data`

One code per call; fan out and merge. For each bond, compare the window's start and end:

- 估值收益率 change (bp) and 利差 change (bp), each stated against the **same** benchmark on both dates. A spread move computed against two different benchmarks is not a move.
- 估价净价 change, and 成交是否活跃 — a yield that jumped with no trading is a valuation mark, not a market print, and is labelled as one.
- Decompose the yield move into the benchmark component and the spread component where the benchmark series is available from `wind-economic.query_economic_indicator_data`. A bond that widened because rates rose is a different finding from one whose spread blew out.
- All deltas are `[测算]` with both dates and the benchmark named. Set and state the thresholds you treat as material (e.g. 利差走阔 ≥ 50bp within the window) rather than calling a move "significant" on feel.
- **Most-leading trigger**: a 估值收益率 single-day jump (e.g. ≥ 50bp) is the earliest market signal that credit is repricing — it leads the announcement record. Flag it as a leading finding that warrants an immediate re-check of the name, even before any announcement appears.

### Step 5: Guarantee-circle contagion — 天眼查 (capability-list tools)

Distress travels along the relationship graph before it reaches the issuer's own statements.

- Pull 股权链 (股东/对外投资/兄弟公司) and 资金链 for each name in scope.
- Re-run Step 3's announcement and news checks on the material guarantors, the controlling shareholder, and any sibling already flagged. A hit on a guarantor is a finding **about the watched name**, recorded in its row with the relationship stated.
- Where two or more watched names share a controller or a guarantee ring, say so explicitly — their findings are correlated and must not be read as independent.
- The relationships are `[披露]`; the contagion argument is `[推断]` with its chain spelled out.

### Step 5.5: Portfolio-level concentration (name/bond lists)

For a list scope (not a single issuer), concentration is itself a monitored risk, not just a per-name view:

- **发行人集中度** — outstanding exposure by issuer across the list; a list dominated by one obligor carries that obligor's risk regardless of per-name grades.
- **区域集中度 (城投)** — for platform names, bucket by 省/地市. A list heavy in one region shares that region's refinancing environment; when one platform in a region is distressed, its peers are correlated, not independent.
- Both are `[测算]` over retrieved 余额; name any bond excluded for a missing field. State this is exposure concentration, not a default forecast.

### Step 6: Grade the findings

Per the severity policy. Grade **findings, never issuers** — this plugin issues no ratings, no outlooks, no default probabilities. Cap the front of the deliverable at **three 🔴**; everything else lives in the body. If more than roughly a third of findings are 🔴, the scale is being used for emphasis and needs re-ranking.

- `🔴 高`（决策前须澄清）: 违约/展期/交叉违约公告、评级下调公告、非标审计意见、控制人被查或失信被执行、窗口内利差走阔超阈值且无基准解释、未来 1 个月集中到期且无可证流动性对应、担保圈内主体已违约.
- `🟡 中`（记录并跟踪）: 未来 1–3 个月到期集中、利差温和走阔、大额新增担保、密集负面舆情未获公告佐证、重大诉讼进展、大股东质押比例上升.
- `⚪ 低·信息`: 常规兑付与付息公告、小额到期、历史已了结事项、无异动确认.

**Leading-lag lens (cross-cutting, does not change the severity glyph).** Alongside its grade, tag each signal by how early it moves, because a leading signal on a 🟡 finding can warrant action sooner than a lagging 🔴:
- **领先**: 估值收益率跳升 / 利差走阔, 负面舆情未获公告佐证 — the market and the rumour move first.
- **同步**: 评级调整 / 兑付·展期 / 诉讼·被执行 公告 — the official record.
- **滞后**: 已发生的违约事件、外部评级下调(常为确认信号) — confirmation, not warning.
State the tag next to material findings so a reader sees not just how bad but how early.

### Step 7: Output

Short-form Markdown in-session by default. A multi-name maturity-and-move matrix goes to .xlsx via `xlsx-author`; a written watch report goes to PDF via `report-render`. State the choice in one clause. Word is the answer only when the user asks for it or the reader will edit the file — `report-render`'s `DocxReport` builds it with the same calls; unspecified long-form stays PDF (the house formatting policy). **要出 Word 就先载入 `report-render` 技能，再动手建。** `DocxReport` 与 `Report` 同一套调用；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

```
**信用监控 — [名单名/主体名]**
范围: [N] 个主体 / [M] 只债券 · 事件窗口: [起]—[止] · 到期观察期: [起]—[止] · 检索于: [timestamp]
标签口径: [披露] 公告或系统披露 · [测算] 本文推导 · [预期] 第三方具名预期(数据商一致预期,非同业券商测算) · [推断] 分析师推论 · [媒体] 媒体报道未经记录佐证

**需要决策的发现**（至多 3 条; 分级给到单条发现, 不给到主体本身)
🔴 高 [主体/债券] — [一句话] · [日期] [n]
   影响: [一两句; 自行推导的数字标 [测算] 并写公式, 自行的判断标 [推断]]
🟡 中 ...
⚪ 低·信息 [主体A/B/C]: [归并的一行]

**一、到期与回售压力**（观察期 [起]—[止]; 单位 [亿元]）
| 主体 | ≤1 个月 | 1–3 个月 | 3–6 个月 | 6–12 个月 | 其中回售 | 合计 | 说明 |
|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  | [测算] 加总已取到的债券余额; 缺字段个券: [列明] |

**二、负面披露与舆情**（窗口 [起]—[止]）
| 主体 | 事项 | 日期 | 标签 | 分级 |
|---|---|---|---|---|
|  |  |  | [披露]/[媒体] [n] | 🔴/🟡/⚪ |
检索范围内未发现事项的主体: [列表]

**三、估值异动**（[起] vs [止]; 基准 [曲线名], 两日同一基准）
| 债券 | 估值收益率变动(bp) | 利差变动(bp) | 其中基准贡献(bp) | 是否有成交 | 分级 |
|---|---|---|---|---|---|
|  | [测算] | [测算] | [测算] | [披露] | 🔴/🟡/⚪ |
重大性阈值: [写明本次采用的 bp 阈值及理由]

**四、担保圈与关联传染**
| 被监控主体 | 关联主体 | 关系 | 关联主体的事项 | 传导判断 |
|---|---|---|---|---|
|  |  | 股东/兄弟/担保对手/资金往来 [披露] [n] | [披露]/[媒体] [n] | [推断] |
共担保圈或共控制人的被监控主体: [列明; 其发现相关, 不可视作相互独立]

**五、组合集中度**（仅名单/组合口径; 单主体略）
| 维度 | 前 N 集中 | 说明 |
|---|---|---|
| 发行人集中度 | [测算] | 按发行人加总余额; 缺字段个券: [列明] |
| 区域集中度(城投) | [测算] | 按 省/地市 加总; [列明区域] |
（为敞口集中度,非违约预测)

## 覆盖范围与局限
检索于: [timestamp] · 事件窗口: [起]—[止] · 到期观察期: [起]—[止] · 口径/委托用途: [如 持仓信用监控]

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 存续债与到期/回售安排 | 有记录 [n] / 检索范围内未发现 / 源不可用 | 同花顺 hexin-bond.bond_basic_info | [date] |
| 发行人公告 |  | 万得 wind-docs.get_company_announcements | [date] |
| 财经新闻 |  | 万得 wind-docs.get_financial_news | [date] |
| 负面舆情 |  | 万得 wind-docs.get_financial_news | [date] |
| 估值与利差变动 | 有记录 [x]/[M] 只 / 源不可用 [y] 只 | 同花顺 hexin-bond.bond_market_data | [date] |
| 评级变动方向与展望 | 有记录 [x]/[M] 只 / 检索范围内未发现 / 源不可用 | 万得 wind-bond.get_bond_issuer_info | [date] |
| 基准曲线(用于拆解) |  | 万得 wind-economic.query_economic_indicator_data (指标名与 code) | [date] |
| 股权链/担保圈/资金往来 |  | 天眼查 | [date] |
| 组合集中度(发行人/区域) | 有记录 [测算] / 不适用(单主体) | 本文测算(基于 hexin-bond.bond_basic_info) | [date] |

本次未能覆盖: [不可用的源与主体, 以及它们本应覆盖的检查项]
数据滞后性: [公告披露滞后、判决上网滞后、估值日频滞后、关联关系数据更新滞后]
本插件不出具自己的评级、评级展望或违约概率;上表评级字段为评级机构的评级,已注明机构与评级日期;"检索范围内未发现"仅指上述源在该窗口内无记录, 不构成无风险、无违约风险或通过的结论。

## 来源
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

## Guardrails

- Do not invent example numbers, thresholds, or events. Every value in the template is a placeholder; a bond whose 余额 could not be retrieved is named and excluded from the sum, not estimated into it.
- Never grade an issuer. Every glyph attaches to a dated, cited finding.
- A source that errored, timed out, or does not cover a name is `源不可用` and named as such — never folded into `未发现`, which would overstate coverage.
- Dates are `yyyyMMdd`; `bond_market_data` takes one code per call. Never invent an indicator or EDB name.
- If the user wants this recurring (每周一 / 每月初), set it up with the host's scheduler and state the cadence — do not silently promise future scans. Persist the watched name list per the the state-file convention convention (`triggers/<name>.json`) so the next run re-evaluates the same universe comparably.
- `[n]` markers map one-to-one onto `## 来源` entries; the distinct marker count equals the entry count. `〔一手|二手〕` is mandatory and a `二手` entry names what it relays.
