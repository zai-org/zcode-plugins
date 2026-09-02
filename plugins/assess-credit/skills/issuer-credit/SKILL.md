---
name: issuer-credit
description: Credit assessment of a bond issuer rather than a bond — leverage, profitability, interest coverage, short-term liquidity, ownership and background, the 担保圈 and 关联占款, plus covenant and default disclosures. Triggers on "主体资质", "发行人怎么样", "偿债能力", "有息负债", "担保圈", "关联占款", "信用分析", "issuer credit", "这家发债主体".
---

# Issuer Credit Assessment

The obligor, not the paper. A bond repays only if its issuer can pay, and onshore credit rarely fails through the income statement alone — it fails through refinancing, through the 担保圈, and through 关联占款. This skill covers all three.

This skill produces **evidence and findings, not a rating.** No implied rating of our own, no outlook of our own, no default probability. An agency rating is quoted, attributed, and dated — never formed here.

> 主体评级/展望/评级变动方向 come from `wind-bond.get_bond_issuer_info`, but the
> 主体评级 column can return the **guarantor's** rating — always read back
> `主体评级类型`. See `../bond-profile/references/bond-spread-traps.md` §5.

## Workflow

### Step 1: Resolve the issuer

Identify the exact obligor. From a bond code, use `hexin-bond.bond_basic_info` to get 发债主体全称. From a company name, confirm whether the user means the group, the listed vehicle, or the financing subsidiary — the three have different balance sheets and only one of them issued the paper. Where the entity is still ambiguous, cross-check with 天眼查 `search_companies` on the name, and stop for confirmation.

Record the current date from the session context or the user; every window and every 剩余期限 is measured from it.

### Step 2: Ownership and background — `bond_basic_info`

注册地址, 行业分类, 股权结构, 实际控制人, 企业背景. Two attributes drive most of the analysis downstream and must be stated explicitly, each `[披露]` with its `[n]`:

- **属性**: 城投 / 产业 / 金融, and 国企(央/省/市/区县) vs 民企 vs 外资, as the source states it.
- **控股链**: immediate controlling shareholder and 实际控制人, with percentages and their dates.

Any expectation of government or group support that is not written into a retrieved document is `[推断]`, labelled as our inference with its basis stated. It is never `[披露]`.

### Step 2.5: Score-card routing — 城投 vs 产业

The 属性 from Step 2 selects the score-card. A 城投 platform and an industrial issuer fail for different reasons and must not be assessed on one shared checklist.

- **产业 (industrial)** → 行业景气 (position on the cost curve, sector cyclicality) + the self-credit core (Step 3 财务 + Step 4 担保圈/关联占款) + 舆情 (Step 4.4 + Step 5). Proceed straight to Step 3.
- **城投 (local-government financing platform)** → a four-layer card. Layers ③ and ④ are the existing self-credit and 舆情 steps; layers ① and ② are the two城投-specific layers below and must be built **before** the financial profile, because a platform's numbers only read correctly against its region and its status.

  ① **区域财力 (regional fiscal strength)** — the platform's real backstop. Retrieve for the platform's 行政区 via `wind-economic.query_economic_indicator_data` (one call, 行政区名 in the query; verified it resolves 省/市/区县 three levels, returning a name shaped `<省>:<地市>:<区县>:一般公共预算收入`, and `财政自给率` can return a whole province's 地市 at once). Read the resolved indicator name and `code` back from `meta` and cite those: 地方一般公共预算收入, 财政自给率, 政府性基金收入 (土地出让依赖度), 地方债务率 / 综合财力. State the 行政级别 (省/地市/区县) and the 报告期 of each series; a fiscal figure quoted from memory is a fabrication. Where EDB has no series for the region/level, write `源不可用` and say what it would have covered — never substitute a national number for a local one. **Also check the 化债 backdrop**: whether the region is a key debt-resolution province and whether 特殊再融资债/置换 support has been announced — from retrieved announcements and news, cited; this is the first question of post-2023 城投 analysis, and its absence from the record is reported as `检索范围内未发现`, not assumed either way.

  ② **平台地位 (platform status)** — 平台层级 (省级/地市级/区县级), 是否主要或唯一平台 for its region, 业务公益性 (public-welfare vs commercial mix), 资产注入与整合地位. Built from Step 2 控股链 + retrieved announcements; a "唯一平台" or "政府支持" claim not written into a document is `[推断]`, not `[披露]`.

### Step 3: Financial profile — `bond_financial_data`

Pull the issuer's statement items — 营业收入, 利润, 资产, 负债 — plus the entity-level performance metrics the tool exposes. Take at least three 报告期 so a trend is visible, and label each column with its 报告期 and whether it is 年报 or 中期/季度 (an annualisation is `[测算]`, not a reported figure). If the most recent fiscal year's 年报 is past its statutory disclosure window but absent from the returned periods, name that missing period explicitly in the coverage block (with the likely cause: source lag vs 非标延迟披露) — a trend read ending one year early is a materially different read, and the reader must see that at a glance.

State the 口径 on every line. Two 口径 choices change conclusions here and both must be shown:

- **归母 vs 全口径.** 净利润(全口径) includes minority interest; 归母净利润 does not. For a platform with heavy minority stakes these differ by a lot. Show both columns, label each, and never average them.
- **有息负债 vs 总负债.** 资产负债率 built on 总负债 includes 应付账款 and 预收; a debt-service view needs 有息负债 (短期借款 + 应付票据 + 一年内到期非流动负债 + 长期借款 + 应付债券, as available). Say which components you could actually retrieve — if 有息负债 cannot be assembled from the returned items, say so and do not present a 总负债-based ratio as a debt ratio.

Compute, each `[测算]` with its formula and the 报告期 of every input:

| 维度 | 指标 | 公式 |
|---|---|---|
| 杠杆 | 资产负债率 | 总负债 / 总资产 |
| 杠杆 | 有息负债率 | 有息负债 / 总资产, 或 有息负债 / (有息负债 + 所有者权益) |
| 盈利 | 销售净利率(全口径 / 归母) | 净利润 / 营业收入; 归母净利润 / 营业收入 |
| 盈利 | 总资产回报 | 净利润 / 平均总资产 |
| 覆盖 | 利息保障倍数 | (利润总额 + 利息费用) / 利息费用, 或 EBITDA / 利息支出 |
| 覆盖 | 有息负债 / EBITDA | 有息负债 / EBITDA |
| 短期流动性 | 货币资金 / 短期债务 | 货币资金 / (短期借款 + 一年内到期非流动负债 + 应付票据) |
| 短期流动性 | 流动比率 / 速动比率 | 流动资产 / 流动负债; (流动资产 − 存货) / 流动负债 |

Where an input is missing, the ratio is not computed — write `n.d.（未披露）` and say which input was absent. A ratio built on a substituted proxy is a different ratio and is labelled as one.

### Step 4: The guarantee circle and related-party exposure — 天眼查 (capability-list tools)

This step is where onshore credit actually breaks, and skipping it produces an assessment that looks complete and is not.

1. **股权链** — 股东, 对外投资, 兄弟公司. Build the immediate ring around the issuer: who controls it, what it controls, and which siblings share the controller.
2. **担保圈** — walk the ring for guarantee relationships and mutual guarantees. Report each counterparty, the direction (issuer as guarantor vs guaranteed), the amount and its date where exposed. 担保/净资产 is `[测算]` with the 净资产 报告期 named. Mutual or circular guarantees are called out by name — a chain of three mutually-guaranteeing platforms transmits one default to all three.

   **`tianyancha.get_guarantee_info` returns the historical record, not the live book.** Every row carries `grnt_sd` / `grnt_ed`(起止日) and `is_fulfillment`(是否履行完毕); read both before the amount enters any ratio. Observed on a distressed issuer: rows carried a 到期日 several years in the past with `is_fulfillment=否`, i.e. already expired at retrieval — summing them produces a 担保/净资产 that overstates live exposure by whatever has already run off. Total only what is still live, say how many rows you excluded as expired, and where 担保方 equals 被担保方 exclude the row from 对外担保 entirely: that is the issuer guaranteeing its own paper, not exposure to a third party.
3. **资金链 / 关联占款** — funding-transaction links between the issuer and related parties. Large 其他应收款 toward the controller or siblings is the classic form; where the statement items in Step 3 expose it, tie the two together. Where they do not, say the exposure could not be quantified rather than implying it is zero.
4. **关联方负面** — `wind-docs.get_financial_news` on the controller and the material guarantors, not only on the issuer. A clean issuer with a distressed guarantor is not clean, and the report states that in the summary rather than leaving the reader to join two sections.

Each relationship is `[披露]` + `[n]`; the contagion argument built on top of them is `[推断]`.

### Step 4.5: Agency rating on the obligor — `bond_special_data`

Pull 主体评级(主评机构), 主体评级展望, 主体最新评级变动方向, 主体评级类型, 评级机构, 主体最新评级日期 for the issuer's outstanding paper.

- **`主体评级类型` first.** If it reads `债券担保人信用评级`, that rating belongs to the guarantor, not this obligor — and on a guaranteed structure that is precisely the distinction this skill exists to draw. Report it as the guarantor's, name the guarantor, tie it to Step 4's 担保圈 findings, and record the obligor's own rating as `检索范围内未发现`.
- Where the agency rating and your own computed leverage/coverage picture point in different directions, **say so plainly and show both.** Do not reconcile them by softening the evidence; an AAA on numbers that will not support it is itself the finding.
- All rating fields are `[披露]` attributed to the named agency with its 评级日期. 变动方向 is the agency's action, quoted.

### Step 5: Disclosure record — `wind-docs.get_company_announcements`

Over the trailing 12–24 months, look for: 评级报告与评级调整, 兑付/付息公告 and any 延期/展期, 违约或触发交叉违约的公告, 债务重组, 重大诉讼与被执行, 募集资金用途变更, 控股股东股权质押或变更, 审计意见类型 in the 定期报告. Also retrieve **银行授信** where disclosed — 评级报告 and 募集说明书 state 授信总额与未使用额度; Step 6's liquidity finding (货币资金/短期债务 low "且无可动用授信证据") depends on having looked for this, so its absence is `检索范围内未发现`, never silently skipped.

- Found → `[披露]` + `[n]`, with the announcement date.
- Queried, nothing found → `检索范围内未发现`.
- Could not query → `源不可用`.

`wind-docs.get_financial_news` adds media colour; anything appearing only there is `[媒体]` until an announcement or a record corroborates it.

### Step 6: Grade the findings

Per the severity policy, grading **findings**, never the issuer, and capping the front of the deliverable at three 🔴.

- `🔴 高`（决策前须澄清）: 已发生违约或展期、交叉违约触发、非标审计意见、控制人被查或失信被执行、货币资金/短期债务显著低于 1 且无可动用授信证据、担保圈内已有主体违约.
- `🟡 中`（记录并跟踪）: 有息负债快速上升、利息保障倍数下行、大额对外担保、关联占款规模显著、近期评级下调公告、集中到期临近.
- `⚪ 低·信息`: 结构性但已披露且规模有限的事项、历史已了结记录.

For a 城投 issuer, also weigh these city-specific findings at the same grades: 区域债务率过高或隐性债务负担重、非标融资占比高、区域再融资环境恶化(区域内其他平台已出险)、平台被列入退出/退平台名单或政府支持定位弱化. Each carries `[披露]` where a document states it and `[推断]` where it is our read of the region/status layers.

### Step 7: Output

Long-form assessment goes to PDF via the `report-render` skill; a ratio table across several issuers goes to .xlsx via `xlsx-author`; a single-issuer summary stays Markdown in-session. State the choice in one clause. Word is the answer only when the user asks for it or the reader will edit the file — `report-render`'s `DocxReport` builds it with the same calls; unspecified long-form stays PDF (the house formatting policy). **要出 Word 就先载入 `report-render` 技能，再动手建。** `DocxReport` 与 `Report` 同一套调用；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

```
# [发行主体全称] 主体信用分析
主体: [全称] · 属性: [城投/产业/金融; 国企(层级)/民企] · 检索于: [timestamp] · 报告期: [各表所属期]
标签口径: [披露] 主体披露或系统登记 · [测算] 本文推导 · [预期] 第三方具名预期(数据商一致预期,非同业券商测算) · [推断] 分析师推论 · [媒体] 媒体报道未经记录佐证

## 摘要
[一段事实性概述, 不下"资质良好/建议回避"一类结论]
分级发现（前置至多 3 条 🔴, 分级给到单条发现而非主体本身; 本技能不出评级）:
- 🔴 高 [一句话] [n]
- 🟡 中 [一句话] [n]
- ⚪ 低·信息 [一句话] [n]

## 一、主体与股权背景
## 一之补(仅城投)、区域财力与平台地位
区域: [省/地市/区县] · 行政级别: [级别]
| 维度 | 指标 | 值 | 报告期 | 标签 |
|---|---|---|---|---|
| 区域财力 | 一般公共预算收入 |  |  | [披露] [n] |
| 区域财力 | 财政自给率 |  |  | [测算]/[披露] [n] |
| 区域财力 | 政府性基金收入(土地依赖) |  |  | [披露] [n] |
| 区域财力 | 地方债务率/综合财力 |  |  | [测算]/[披露] [n] |
| 平台地位 | 层级/是否主要平台/公益性 | [文字] |  | [披露]/[推断] [n] |
（产业主体略去本节;区域数据取自万得 wind-economic.query_economic_indicator_data,取不到写 源不可用,不以全国数替代地方数）

## 二、财务概览（报告期 [P1]/[P2]/[P3]）
| 指标 | [P1] | [P2] | [P3] | 口径与公式 |
|---|---|---|---|---|
| 营业收入 |  |  |  | 单位 [亿元] [披露] [n] |
| 净利润(全口径) |  |  |  | [披露] [n] |
| 归母净利润 |  |  |  | [披露] [n] |
| 总负债 / 有息负债 |  |  |  | 有息负债构成: [列明可取到的科目] [披露]/[测算] |
| 资产负债率 |  |  |  | [测算] = 总负债/总资产 |
| 有息负债率 |  |  |  | [测算] = [写明分母口径] |
| 利息保障倍数 |  |  |  | [测算] = [写明公式] |
| 货币资金/短期债务 |  |  |  | [测算] = [写明短期债务构成] |

## 三、担保圈与关联方敞口
| 关联主体 | 关系 | 方向/金额 | 日期 | 标签 |
|---|---|---|---|---|
|  | 股东/子公司/兄弟/担保对手/资金往来 |  |  | [披露] [n] |
担保/净资产: [测算], 净资产取自 [报告期]。互保或环状担保: [点名, 或 检索范围内未发现]。
关联占款: [可量化时给数并注明科目; 不可量化时写明未能量化, 不写为零]。

## 四、披露与事件记录
## 五、结论性观察（事实与推断分列, [推断] 逐条标注）

## 覆盖范围与局限
检索于: [timestamp] · 口径/委托用途: [如 债券投资研究 / 授信参考]

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 主体基本信息 | 有记录 [n] / 检索范围内未发现 / 源不可用 | 同花顺 hexin-bond.bond_basic_info (含发债主体身份) | [date] |
| 区域财政指标(仅城投) | 有记录 [n] / 检索范围内未发现 / 源不可用 | 万得 wind-economic.query_economic_indicator_data (指标名/code/行政级别) | [date] |
| 财务报表项目 |  | 万得 wind-bond.get_bond_financial_data | [date] |
| 股权链/兄弟公司 |  | 天眼查 | [date] |
| 担保关系 |  | 天眼查 | [date] |
| 资金往来/关联占款 |  | 天眼查 | [date] |
| 评级/兑付/违约公告 |  | 万得 wind-docs.get_company_announcements | [date] |
| 负面舆情 |  | 万得 wind-docs.get_financial_news | [date] |

本次未能覆盖: [不可用的源, 以及它们本应覆盖的检查项]
数据滞后性: [定期报告披露滞后、担保与质押登记公示滞后、判决上网滞后]
本插件不出具评级、评级展望或违约概率;"检索范围内未发现"仅指上述源在本次检索范围内无记录, 不构成无风险、无违约风险或通过的结论。

## 来源
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

## Guardrails

- Do not invent example numbers. Every figure above is a placeholder; an input you could not retrieve is `n.d.（未披露）` and the ratio depending on it is not computed.
- Never mix 归母 and 全口径 in one column, never mix 有息负债 and 总负债 in one ratio series, and never mix 万元 with 亿元 in one column.
- Dates passed to `hexin-bond` are `yyyyMMdd`. `bond_financial_data` and `bond_basic_info` are keyed off a single subject per call — fan out and merge. Never invent a field or indicator name; read back what the tool returns.
- A guarantee amount with no date is not usable; report it with its disclosure date or not at all.
- `[n]` markers map one-to-one onto `## 来源` entries; the distinct marker count equals the entry count. `〔一手|二手〕` is mandatory and a `二手` entry names what it relays, e.g. `[7] 二手 · [媒体名] · 转引 [原始文件] · [date](发布); 检索于 [date]`.
