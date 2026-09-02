---
name: bond-profile
description: Single-bond profile end to end — issuance terms and 兑付安排, live 估价/溢价, 久期/修正久期/凸性/利差, and the issuer's identity and background. Triggers on "这只债", "债券详情", "债券估值", "久期多少", "凸性", "利差多少", "票面利率", "bond profile", "看一下 XXX 债".
---

# Single Bond Profile

One bond, described completely enough that a reader can price it, size its rate risk, and know who owes the money. This skill covers the **instrument**; the issuer's credit quality is `issuer-credit`, and where the bond sits relative to peers is `curve-spread`.

> Field traps verified on a real bond — the 利差 field does not disclose its
> benchmark, and the 中债估值 field family can return null across the board —
> are in `references/bond-spread-traps.md`. Read it before quoting any valuation field.

## Workflow

### Step 1: Resolve the bond

Take the code or 简称 and resolve it with `hexin-bond.bond_basic_info`. Confirm exactly one instrument: full 债券全称, code and exchange, and 债券分类. If a 简称 matches several codes, or the user named an issuer rather than a bond, list the candidates with 起息日/到期日/发行规模 and stop for confirmation — profiling the wrong tranche of the same issuer is a silent error.

Resolve today's date from the session context or the user before computing 剩余期限 or any window; there is no clock tool.

### Step 2: Identity and terms — `bond_basic_info`

Everything here is `[披露]` with its `[n]`:

- 债券全称/简称, 代码, 交易场所, 债券分类 (企业债/公司债/中票/短融/PPN/金融债/ABS…), 是否城投属性 where the source states it.
- 发行数据: 发行日期/起息日, 发行规模, 发行价格, 票面利率, 期限, 计息与付息频率.
- 兑付安排: 到期日, 付息日程, and any 含权条款 the source exposes (回售/赎回/调整票面/提前偿还). A 含权 bond's 行权日 governs its effective maturity — state 到期日 and 行权日 separately and say which one the 剩余期限 is measured to.
- 剩余期限 is `[测算]` — state it as `到期日 − 检索日` (or `行权日 − 检索日`, labelled) and give the day count basis you used.

If a field the template calls for is not returned, write `n.d.（未披露）` and carry it into the coverage table. Never fill a term from memory.

### Step 3: Valuation and rate risk — `bond_market_data`

Retrieve, for the stated 检索于 date: 最新成交/报价, 估价净价, 估价全价, 估价收益率, 溢价, 久期, 修正久期, 凸性, 利差.

Three rules apply to this block and none of them is optional:

1. **Separate the three yields.** 票面利率 (from Step 2, contractual), 估值收益率 (同花顺 bond 估价), 到期收益率 (computed off a traded or quoted price) go in three labelled rows, never one. If only 估价收益率 is available, say so — do not present it as 到期收益率.
2. **State the 利差 basis explicitly.** Report it as `利差 = <本券收益率口径> − <基准曲线名称 + 期限点>，<日期>`. A spread with no named benchmark curve, no tenor point, and no date is not a number and does not go in the deliverable. If the source returns a 利差 whose benchmark it does not name, report the figure with `基准口径未披露` beside it rather than assuming 国开 or 国债.
3. **Duration needs its flavour.** 久期 (Macaulay) and 修正久期 are different quantities; label which the source returned. Where you use 修正久期 × Δy to size a price move, that estimate is `[测算]` and states the Δy assumed and that convexity is ignored (or the second-order term you included).

Any figure you derive here — 剩余期限, an estimated price move, a spread you differenced yourself, an annualised carry — is `[测算]` with its formula.

### Step 4: Who owes the money — `bond_basic_info`

发债主体全称, 注册地址, 行业分类, 股权结构 (controlling shareholder and 实际控制人 where exposed), 企业背景. This is identification, not assessment: one paragraph plus a small table. If the reader needs leverage, coverage, and the 担保圈, say so and point at `issuer-credit` rather than half-doing it here.

### Step 5: Rating and recent disclosure — `bond_special_data` then `wind-docs.get_company_announcements`

Pull the rating fields from `wind-bond.get_bond_issuer_info`: 债项评级, 主体评级(主评机构), 主体评级展望, 评级机构, 评级类型, 最新评级日期, 最新评级变动方向. Then query `wind-docs.get_company_announcements` over the trailing 12 months for 评级报告/评级调整公告, 兑付公告, 风险提示公告, 募集资金用途变更 — the announcement carries the *reasoning* the rating field cannot, and corroborates the change.

**Read back `主体评级类型` before you write the 主体评级 down.** On a guaranteed bond it can return `债券担保人信用评级` — the guarantor's rating, often from a different agency than the 债项评级. Presenting it as the issuer's rating makes a dependent credit look standalone. If the type is a guarantor rating: label it as the guarantor's, name the guarantor, and record the issuer's own rating as `检索范围内未发现`.

- Rating field or announcement found → `[披露]` + `[n]`, naming the agency and its 评级日期.
- Source queried, nothing found → `检索范围内未发现`. This is **not** "无评级" and **not** "评级稳定".
- Source could not be queried → `源不可用`.
- 评级变动方向 is reported as the agency's action (`上调`/`下调`/`维持`), never as our own view of the credit.

`wind-docs.get_financial_news` may add colour; anything appearing only there is `[媒体]` and stays `[媒体]` until an announcement corroborates it.

### Step 6: Output

Short-form by default: Markdown in-session, per the house formatting policy. If the user asked for a document, long-form goes to PDF via the `report-render` skill; a multi-bond term-and-valuation table goes to .xlsx via `xlsx-author`. Word is the answer only when the user asks for it or the reader will edit the file — `report-render`'s `DocxReport` builds it with the same calls; unspecified long-form stays PDF (the house formatting policy). **要出 Word 就先载入 `report-render` 技能，再动手建。** `DocxReport` 与 `Report` 同一套调用；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

```
**[债券全称]（[代码]）— 债券概览**
检索于: [timestamp] · 报告期(财务字段): [period, if any] · 数据源: 同花顺

标签口径: [披露] 发行文件或系统披露 · [测算] 本文推导 · [预期] 第三方具名预期(数据商一致预期,非同业券商测算) · [推断] 分析师推论 · [媒体] 媒体报道未经记录佐证

**一、条款**
| 项目 | 数值 | 口径/说明 |
|---|---|---|
| 债券分类 |  | [披露] [n] |
| 发行规模 |  | 单位: [亿元] [披露] [n] |
| 票面利率 |  | 合约票息, 非收益率 [披露] [n] |
| 起息日 / 到期日 |  | [披露] [n] |
| 行权日(如含权) |  | [条款类型] [披露] [n] |
| 剩余期限 |  | [测算] = 到期日(或行权日) − 检索日, [日算基准] |
| 兑付安排 |  | [披露] [n] |

**二、估值与利率风险**（检索于 [date]）
| 指标 | 数值 | 口径/说明 |
|---|---|---|
| 估价净价 / 全价 |  | [披露] [n] |
| 估值收益率 |  | 同花顺 估价, 非成交到期收益率 [披露] [n] |
| 到期收益率 |  | 基于[成交价/报价], [date]; 无成交时填 n.d.（未披露） |
| 溢价 |  | [披露] [n] |
| 久期 / 修正久期 |  | 标明是麦考利久期还是修正久期 [披露] [n] |
| 凸性 |  | [披露] [n] |
| 利差 |  | = [本券收益率口径] − [基准曲线名 + 期限点], [date] [披露]/[测算] [n] |

利差口径说明: [一句话写清基准曲线、期限点匹配方式与日期。基准未披露时明确写"基准口径未披露"]

**三、发行主体**
[一段: 全称、注册地、行业、股权结构与实控人、企业背景, 每项 [披露] [n]]
主体信用资质(杠杆、覆盖、流动性、担保圈)不在本节结论范围, 见 `issuer-credit`。

**四、评级与近期披露**
| 项目 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 评级公告 | 有记录 [n] / 检索范围内未发现 / 源不可用 | 同花顺 公告 | [date] |
| 兑付/风险提示公告 |  | 同花顺 公告 | [date] |
| 媒体报道 | [媒体] [n] / 检索范围内未发现 / 源不可用 | 同花顺 新闻 | [date] |

## 覆盖范围与局限
检索于: [timestamp] · 口径/委托用途: [如 投资研究 / 授信参考]

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 发行条款 | 有记录 [n] / 检索范围内未发现 / 源不可用 | 同花顺 bond_basic_info | [date] |
| 估值与风险指标 |  | 同花顺 bond_market_data | [date] |
| 主体信息 |  | 同花顺 bond_basic_info | [date] |
| 评级/兑付公告 |  | 万得 wind-docs.get_company_announcements | [date] |

本次未能覆盖: [不可用的源, 以及它们本应覆盖的字段]
数据滞后性: [估值日频滞后、公告披露滞后、财务报表报告期滞后]
本插件不出具评级、评级展望或违约概率;"检索范围内未发现"仅指上述源在本次检索范围内无记录, 不构成无风险或安全的结论。

## 来源
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

**The coverage block is a section under its own `## 覆盖范围与局限` heading, and it is
never dropped.** Not when every check succeeded, not when the body already explains
what happened, and least of all when the instrument turns out to be **已到期 / 已摘牌 /
已全额兑付**: that case makes 估值收益率, 久期, 凸性 and 利差 unavailable rather than absent,
which is precisely what the block exists to record. Writing that fact into the
disclaimer instead of the block loses it — a reader scanning for "what did we check
and what came back" finds no such section, and every downstream check reads the
deliverable as having no coverage statement at all.

Where the bond no longer trades, the block still lists each check with `源不可用（本券已于
[date] 到期，该字段停止更新）` and names what would have to be queried instead (a live bond
from the same issuer), rather than collapsing to a sentence.

## Guardrails

- Dates passed to `hexin-bond` are `yyyyMMdd`; `bond_market_data` takes one code per call — fan out per bond and merge. Never invent a field or indicator name; read back what the tool returns.
- Do not invent example numbers. Every cell in the templates above is a placeholder and stays a placeholder until a retrieval fills it; an unfilled cell is `n.d.（未披露）`, never a plausible figure.
- A 含权 bond profiled to its 到期日 while the market prices it to 行权日 gives a duration and a spread that are both wrong. State which the figures are measured to.
- `[n]` markers map one-to-one onto `## 来源` entries; the distinct marker count equals the entry count. `〔一手|二手〕` is mandatory and a `二手` entry names what it relays. A terminal query with no publication date carries `检索于 [date]` alone, e.g. `[2] 一手 · 同花顺 iFinD · 债券估值(到期收益率/久期/凸性，[债券代码]) · 检索于 [date]`.
