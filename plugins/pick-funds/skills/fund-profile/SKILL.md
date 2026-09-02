---
name: fund-profile
description: Deep-dive profile of a single fund — performance vs benchmark and peers, risk, drawdowns, size and flows, fees, holdings snapshot, manager tenure. Triggers on "基金画像", "分析这只基金", "XX基金怎么样", "fund profile", "<基金代码> 深度分析".
---

# Fund Profile

One fund, fully evidenced. Answer the four questions an allocator asks: what is it, how has it done and why, what does it hold, and what are the capacity/structural risks.

> Engine field 口径 traps that change conclusions — 「近N年年化」 is not
> geometric, 「规模」 is merged across share classes — are documented in
> `../fund-screen/references/fund-return-traps.md`. Recompute rather than
> quoting the field.

## Workflow

### Step 1: Identity

`hexin-fund.get_fund_profile`: full name, code + share classes, type, inception, benchmark, size, fund company, current manager name. (Only the **current** manager comes from this call — 同花顺 no longer supports a `基金经理(历任)` indicator. The full roster with ranges is `wind-fund.get_fund_info`'s `历任基金经理姓名和任职时间` — ask for it and parse it, see `manager-profile`.) State which share class all following numbers use.

费率三档分两处取:管理费率在 `hexin-fund.get_fund_profile`,托管费率与销售服务费率在 `wind-fund.get_fund_info`. Cost is a fact about the product, not a footnote. Quote all three with the share class they belong to — 销售服务费率 comes back blank on an A class and populated on a C class, which is exactly the difference a holder pays for, so a single "费率" number without its class and its components is not usable.

### Step 2: Performance & risk

- NAV series via `wind-fund.get_fund_kline` for the analysis window (default: manager tenure, capped at 5y; state the window).
- `wind-fund.get_fund_performance` for stated-window returns (近1/3年收益率, 同类排名), peer ranks (name the peer group + N), volatility, max drawdown, Sharpe where available.
- Benchmark comparison: pull the benchmark index via `hexin-index.index_data` for the same window; report excess return and the 2-3 largest drawdown episodes with dates.
- Attribute performance to tenure: if the current manager started mid-window, split the record at the handover date.

### Step 3: Size & holders

Size trend (规模变动 — fast growth after a hot year is a capacity flag), holder structure (`hexin-fund.get_fund_ownership`): 机构/个人占比, single-holder concentration (>40% institutional single holder = redemption risk flag).

### Step 4: Asset mix, then holdings

**Asset mix first — from the same `wind-fund.get_fund_holdings` call.** 股票 / 债券 / 银行存款 investment 市值 and each one's 占基金资产净值比, at the MRQ 报告期. One call returns both the asset mix and the top-10, so ask for them together. Top-10 holdings cannot tell you this: a fund at 60% equity and one at 90% are different risk products even with identical top-10 names, and the 占比 is what separates them. Report the equity 仓位 alongside its 报告期, and where a prior period is retrievable, the 仓位 change — a manager cutting equity from 90% to 60% is the single loudest thing a profile can say.

**Then holdings — same response:** top-10 with weights and report date (state the lag), sector tilts, concentration (top-10 weight), turnover if available. For claims like "重仓白酒", verify against the actual holdings rows.

Note the two can disagree on 报告期 — 仓位 is MRQ while top-10 may be a different disclosure. Never present them as one snapshot without saying so.

### Step 5: Assemble

Short-form by default: Markdown in-session, per the house formatting policy. If the user asked for a document, the profile goes to PDF via the `report-render` skill — never hand-rolled with weasyprint, wkhtmltopdf, pandoc, or a bare reportlab script, because those do not emit `[n]` as PDF link annotations and the citations arrive unclickable. A holdings or performance table meant to be filtered goes to `.xlsx` via `xlsx-author`. Word is the answer only when the user asks for it or the reader will edit the file — `report-render`'s `DocxReport` builds it with the same calls; unspecified long-form stays PDF (the house formatting policy). **要出 Word 就先载入 `report-render` 技能，再动手建。** `DocxReport` 与 `Report` 同一套调用；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

```
# [基金全称]([代码], [份额]类) 画像
检索于: [date] · 分析窗口: [起—止] · 现任经理: [名] (自 [date])

## 一句话定位
## 业绩与风险(vs [基准] / [同类组, N=])
## 规模与持有人
## 资产配置与费率(报告期: [date])
   股票仓位 [x]% · 债券 [y]% · 存款 [z]% · 管理费 [f]%/托管费 [g]%/销售服务费 [h]%([份额]类)
## 持仓与风格(报告期: [date])
## 关注点
   🔴/🟡 结构性风险: 规模激增、经理更替、持有人集中、风格漂移(如有证据)

## 覆盖范围与局限
检索于: [date] · 报告期: [持仓所属报告期]

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 净值与区间业绩 | 有记录 / 检索范围内未发现 / 源不可用 | [系统] | [date] |
| 同类排名(N=) | ... | [系统] | [date] |
| 基准指数同期 | ... | [系统] | [date] |
| 持有人结构 | ... | [系统] | [date] |
| 前十大持仓 | ... | [系统] | [date] |
| 资产配置(股/债/存款占净值比) | ... | wind-fund.get_fund_holdings | [date] |
| 费率(管理/托管/销售服务) | ... | 同花顺 hexin-fund.get_fund_profile | [date] |

本次未能覆盖: [失败或未授权的源,以及它本应覆盖的内容]
数据滞后性: 持仓披露滞后 [X] 天(报告期 [date] ≠ 检索于 [date]);持有人结构为半年度披露。

## 来源
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

### Guardrails

- Every return states window + share class + net/gross.
- Manager change mid-record is always surfaced, never averaged over.
- Holdings claims carry their report date; no "currently holds" from a stale report.
  `报告期` and `检索于` are separate fields and are never substituted for one another.
- Descriptive, not predictive — flag risks, don't forecast returns.
- Provenance: disclosed NAV/规模/费率/持仓/持有人 fields are `[披露]`; excess return,
  annualised figures, top-10 concentration and any drawdown we measured off the NAV series
  are `[测算]`; a capacity or style-drift read with no record behind it is `[推断]`; an
  uncorroborated manager-departure or redemption report is `[媒体]`. `[测算]`, `[推断]`
  and `[媒体]` are never omitted.
- Sources entries: 基金合同/定期报告/净值公告 and a 同花顺 field sourced from those
  are `一手` (name the system and `检索于`; publication date may be absent for a live
  query). A media article is `二手` and names what it relays. Distinct `[n]` markers must
  equal the entry count.
