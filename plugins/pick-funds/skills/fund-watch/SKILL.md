---
name: fund-watch
description: Ongoing monitoring of held or shortlisted funds over a window — manager changes, size and flow shocks, 仓位 shifts, style drift, and performance/rank deviation — graded by what a holder must act on. Triggers on "基金跟踪", "持仓基金有没有问题", "基金预警", "盯一下这几只基金", "经理换人了吗", "fund watch", "规模异动".
---

# Fund Watch

Ongoing monitoring, not a fresh assessment. `fund-profile` answers "what is this fund";
this answers **"what changed since I last looked, and does it change my holding"**.

Findings are graded; the fund never is — this skill rates nothing and recommends nothing.

> The engine-field 口径 traps that matter here (年化 vs 累计 sharing one column name,
> 规模 merged across share classes) are in
> `../fund-screen/references/fund-return-traps.md`. Read §0 before quoting any 区间收益.

## Workflow

### Step 1: Scope the watch

- **Universe** — the funds held or shortlisted. If the user names a stored shortlist from
  `fund-screen`, use it; otherwise take the list they give. Resolve each to 代码 + 份额类
  (A/C differ in fees and therefore in net return — a watch that mixes classes reports
  moves that are partly just the fee difference).
- **Window** — the lookback for changes (default: since the last review, or trailing 90
  days if there was none). State it in the header; a watch over an unstated window cannot
  be re-run comparably next time.
- **Today** — from the session context or the user. There is **no clock tool**.
- **The baseline** — what "changed" is measured against: the prior review, the position's
  entry date, or the last disclosed 报告期. Name it. Without a baseline, every number is
  a level, not a change.

### Step 2: Manager continuity — `wind-docs.get_company_announcements` first, then the roster field

This is the finding that most often invalidates a holding thesis, and the one the
structured field cannot settle on its own.

1. **`wind-docs.get_company_announcements`** over the window, per fund: 基金经理变更公告. This is the
   authoritative record and the only source that says **why** — 离任 / 增聘 / 共同管理.
2. **`wind-fund.get_fund_info`** for the `历任基金经理姓名和任职时间` roster — one composite string, `\r\n`-separated, `姓名(起-止)` for a departed manager and `姓名(起至今)` for a serving one, so parse it. 同花顺 `get_fund_profile` no longer carries a 历任 indicator; it returns the current manager only.

- **增聘 is not a handover.** Verified on a large 偏股混合型 product: the incumbent
  manager (serving for several years) was still 现任 while two further managers were
  both added on one later date. Reading two new start dates as a
  departure would be wrong. **Never close one manager's interval with the next one's start
  date** — only the 公告 distinguishes the two.
- A 变更公告 inside the window is 🔴 when the departing manager was the thesis. Where the
  fund is now co-managed, say so and note that the track record ahead will not be
  attributable to one person.
- 公告 searched and none found → `检索范围内未发现` for the channel. Media-only report of a
  departure stays `[媒体]` until the 公告 appears.

### Step 3: Size and flows — `get_fund_ownership`

`hexin-fund.get_fund_ownership`: 份额, 申购/赎回, 份额变动, 持有人结构 (机构/个人占比,
单一持有人集中度).

- **Both directions are findings.** Rapid growth after a hot year is a capacity flag
  (strategy may not scale); heavy redemption forces selling and raises the remaining
  holders' concentration.
- A single institutional holder above ~40% is a redemption-risk flag on its own — one
  decision can move the whole fund.
- 规模 is merged across share classes (see the traps file). Never compare a merged 规模 to
  a single class's flows without saying so.
- All change figures are `[测算]` off retrieved 份额, with both dates stated.

### Step 4: 仓位 and style — `get_fund_portfolio`, then the drift read

`hexin-fund.get_fund_portfolio` returns 大类资产配置 (股/债/存款 占净值比), 行业配置, and
重仓股 in **one** call at the MRQ 报告期.

- **仓位 change is the loudest single line in a fund watch.** A manager cutting equity from
  90% to 60% has changed the product the holder owns, and the top-10 alone will not show
  it. Report the level and the change against the baseline 报告期.
- Style drift: run `holdings-style`'s two-track read (持仓法 + 净值回归 RBSA) rather than
  reproducing it here. A holdings-based read that diverges from the returns-based read is
  itself the drift signal.
- **Holdings lag.** 全持仓 is semi-annual, top-10 quarterly. 报告期 and 检索于 are separate
  fields and are never substituted. A drift conclusion drawn from a 报告期 months old says
  so explicitly.

### Step 5: Performance and rank deviation — `get_fund_market_performance`

区间收益, 同类排名 (name the peer group and its N), 波动率, 最大回撤, and the
risk-adjusted measures where returned.

- **Read `是否年化` off `indicators_params` every time.** The column 「近N年收益率」 carries
  **both** the annualised and the cumulative figure depending on the phrasing — verified on
  one fund where the two differed by more than 3× under one identical column name. A
  deviation computed against the wrong one is meaningless.
- Deviation is measured against the **benchmark and the peer group**, not against an
  absolute number. Pull the benchmark via `hexin-index.index_data` for the same window.
- Underperformance inside the strategy's normal dispersion is not a finding. Say what
  dispersion you judged it against.
- Attribution of performance to a cause is `[推断]` with its basis; where a manager change
  or a 仓位 shift coincides, say the two coincide — do not assert one caused the other.

### Step 6: Fees — the one change nobody notices

`hexin-fund.get_fund_profile` carries 管理费率 / 托管费率 / 销售服务费率. A fee change is
disclosed and permanent, and it compounds. Compare against the baseline and report any
change; where fees are unchanged, one line saying so is enough.

### Step 7: Grade the findings

Per the severity policy. Grade **findings, never funds** — this skill issues no
rating, no ranking of its own, and no buy/sell/hold.

- `🔴 高`（决策前须澄清）: 基金经理变更公告(离任,且该经理是持有理由)、股票仓位大幅变动、
  单一机构持有人占比超阈值且窗口内大额赎回、风格与合同或标签明显不符且两轨一致、费率上调。
- `🟡 中`（记录并跟踪）: 增聘或共同管理、规模快速增长触及容量关注、温和赎回、行业配置
  显著位移、同类排名持续下滑但仍在常态区间、持仓集中度上升。
- `⚪ 低·信息`: 常规份额波动、报告期例行更新、无异动确认。

Cap the front of the deliverable at **three 🔴**. If more than roughly a third of findings
are 🔴, the scale is being used for emphasis and needs re-ranking.

### Step 8: Output

Short-form Markdown in-session by default. A multi-fund change matrix goes to `.xlsx` via
`xlsx-author`; a written watch report goes to PDF via `report-render`. State the choice in
one clause. Word is the answer only when the user asks for it or the reader will
edit the file — `report-render`'s `DocxReport` builds it with the same calls; **要出 Word 就先载入 `report-render` 技能，再动手建。** `DocxReport` 与 `Report` 同一套调用；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。
unspecified long-form stays PDF (the house formatting policy).

```
**基金跟踪 — [清单名/持仓名]**
检索于: [date] · 观察窗口: [起]—[止] · 比较基线: [上次复核日 / 建仓日 / 报告期]
标签口径: [披露] 系统或公告披露 · [测算] 本文推导 · [推断] 分析师推论 · [媒体] 媒体未获记录佐证

**需要决策的发现**（至多 3 条; 分级给到单条发现, 不给到基金本身）
| 级别 | 基金(份额类) | 发现 | 发生/披露日 | 依据 | 源 [n] |
|---|---|---|---|---|---|
| 🔴 |  |  |  | [披露]/[测算] |  |

**一、基金经理**（窗口 [起]—[止]）
| 基金 | 现任(任职起) | 窗口内变更 | 性质(离任/增聘/共管) | 源 [n] |
|---|---|---|---|---|

**二、规模与申赎**（基线 [date] → [date]）
| 基金 | 份额变动% | 申购/赎回 | 机构占比 | 单一持有人集中度 | 源 [n] |
|---|---|---|---|---|---|

**三、仓位与风格**（报告期 [date]; 披露滞后 [X] 天）
| 基金 | 股票仓位% (基线→当期) | 行业位移 | 两轨一致性 | 源 [n] |
|---|---|---|---|---|

**四、业绩与排名**（窗口 [起]—[止]; 口径 [年化/累计, 见 indicators_params]）
| 基金 | 区间收益% | 同类排名(N=) | 相对基准% | 最大回撤% | 源 [n] |
|---|---|---|---|---|---|

**五、费率**
[无变化 / 变化明细]

## 覆盖范围与局限
检索于: [date] · 窗口: [起]—[止] · 口径/委托用途: [如 持仓基金季度复核]

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 基金经理变更公告 | 有记录 [n] / 检索范围内未发现 / 源不可用 | 万得 wind-docs.get_company_announcements | [date] |
| 历任经理与任职区间 | 有记录(复合串,需解析) | 同花顺 hexin-fund.get_fund_profile | [date] |
| 份额/申赎/持有人结构 |  | 同花顺 hexin-fund.get_fund_ownership | [date] |
| 大类资产配置与持仓 |  | wind-fund.get_fund_holdings | [报告期] |
| 区间收益与同类排名 | 口径 [年化/累计] | 同花顺 hexin-fund.get_fund_market_performance | [date] |
| 基准指数同期 |  | 同花顺 hexin-index.index_data | [date] |
| 费率 |  | 同花顺 hexin-fund.get_fund_profile | [date] |

本次未能覆盖: [不可用的源与基金, 以及它们本应覆盖的检查项]
数据滞后性: 持仓披露滞后(报告期 [date] ≠ 检索于 [date]);持有人结构为半年度披露;
公告披露滞后;离任日期在万得 `历任基金经理姓名和任职时间` 组合串内(实测 2026-08-24),无逐经理结构化字段,变更原因仍只来自公告。
本插件不出具评级、排名或买卖建议;"检索范围内未发现"仅指上述源在该窗口内无记录,
不构成该基金无问题的结论。

## 来源
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

## Guardrails

- **No buy / sell / hold, no 加仓/减仓/赎回建议, no rating, no ranking of our own.** The
  allocator or investment committee decides; this skill stages what changed.
- **A change is not a verdict.** A manager change, a 仓位 shift, or a rank slide is
  reported as a change with its evidence — whether it invalidates the holding is the
  reader's call, and the deliverable says so.
- Every number carries its window and, for disclosed holdings, its 报告期. `报告期` and
  `检索于` are never substituted for one another.
- Absence is absence: a fund a source did not return is `源不可用` with the fund named,
  never omitted and never carried at its last known value.
- Do not invent example figures — every value in the template above is a placeholder.
