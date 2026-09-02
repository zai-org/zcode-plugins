---
name: fund-screen
description: Multi-criteria fund screening across mutual funds, ETFs, and LOFs — by type, performance, risk, size, fees, holdings, manager. Triggers on "筛选基金", "找基金", "fund screen", "哪些基金满足", "近一年收益前10%的股票基金", "重仓XX的基金".
---

# Fund Screening

Turn a natural-language mandate into an executed, reproducible screen with an honest note on what the tools could and couldn't filter.

## Workflow

### Step 1: Pin the mandate

Confirm (ask once only if genuinely ambiguous): universe (公募/ETF/LOF, 场内/场外), fund type (股票/混合/债券/QDII/FOF/指数), the metric windows (近1年/3年/成立以来), and hard vs soft criteria.

### Step 2: Execute on two engines when available

1. **`wind-fund.search_funds`** — 筛选引擎。把口径（窗口、阈值、基金类型）写进检索条件里。
   `hexin-fund` 的工具是**按代码取数**，给不了「符合条件的基金集合」，不能用来筛。
   筛选条件、阈值与要显示的字段都写在同一个检索请求里。

2. **不要用 `hexin-stock.search_stocks(domain="fund")` 做筛选。** 它是问财的
   自然语言检索，复合条件叠加「显示某字段」会直接返回无数据（实测「偏股混合型
   基金，近三年收益率大于25%，基金规模大于30亿元，显示最大回撤率…」连续三次
   都取不到）。基金筛选只走 `wind-fund.search_funds`。

**筛选跑在 `wind-fund.search_funds` 上。Web 源只补它没有的字段，不替代它。** A commercial aggregator page (天天基金 / 蛋卷 / a broker's fund
channel) is legitimate for a field the MCP tool does not carry — a share-class
roster, a fee schedule, a holder-structure table — and it is **`二手`**: it
republishes what the fund company disclosed, so the Sources entry names the
underlying (`转引 基金公司定期报告/净值公告`) rather than claiming 一手. Only the
issuer's own disclosure and the exchange/regulator record are 一手 here.

Where you end up screening off web data because the tool did not answer, that is a
finding: say which criterion `hexin-fund` could not filter and that the ranking was
built off an aggregator, in the coverage block. Observed 2026-08-18: a 30-fund
screen shipped with **two** MCP calls, sourced its entire ranking from two
aggregator APIs, and labelled both `一手` — the screen may well be right, and the
reader has no way to see that it never touched the vendor the plugin is wired to.

If the engines disagree materially, show both result sets and the likely definitional cause (share-class handling, window endpoints, peer-group definitions). Do not silently pick one.

### Step 2b: Re-check the engine's own fields before trusting them

Read `references/fund-return-traps.md` first — two fund return fields can silently mean something other than their
name, and both change which funds make the list:

- **「近N年年化」is not geometric annualised** (measured 1.94–2.13× the geometric
  figure, ratio not constant). Recompute it as `(1+R)^(1/n) − 1` from cumulative
  return, tag `[测算]`, re-check the threshold against your value, and list any
  fund the engine wrongly admitted or excluded. Rank on your value, not the
  engine's — the threshold verdict may survive while the ordering does not.
- **「规模」is merged size** across A/C share classes. Ask which basis the user
  means; if you cannot, present both and flag funds that clear the bar only on
  the merged basis.

### Step 3: Enrich the shortlist

For the top results (cap at ~15), pull per fund via `hexin-fund.get_fund_profile` (size, inception, manager name, 管理费率), `wind-fund.get_fund_info` (托管费率/销售服务费率/业绩比较基准), `wind-fund.get_fund_performance` (window returns, 同类排名, 最大回撤, 夏普), and `wind-fund.get_fund_holdings` (股票/债券/存款 占基金资产净值比 at MRQ — same call also carries 行业配置 and top-10 if the shortlist needs them). **Carry the equity 仓位 into the table.** Two funds with the same 类型 label and similar returns can be running very different equity exposure, and a shortlist that does not show it invites a comparison between products that are not comparable. Manager **tenure dates** 走 `wind-fund.get_fund_info`（历任基金经理含任职期限）。

### Step 4: Output

Short-form is Markdown in-session. A screen the user will filter or hand on goes to `.xlsx` via `xlsx-author` — a screen result is that skill's **Class B** workbook, so it carries the `来源` worksheet and a `来源编号` column rather than per-cell comments, and the `口径与局限` block on the `来源` sheet states the criteria the engine actually executed versus what was asked. A written screen read goes to PDF via `report-render`; never hand-roll the PDF, because a hand-rolled one does not emit `[n]` as link annotations. 用户要 Word 时同样走 `report-render`（`DocxReport`，与 `Report` 同一套调用）——**要出 Word 就先载入 `report-render` 技能，再动手建**；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

```
**基金筛选 — [执行口径的一句话]**（检索于 [date]）

| 代码 | 名称(份额) | 类型 | 规模 | 经理(任职起) | [窗口]回报 | 最大回撤 | 股票仓位(报告期) | 费率 | 备注 |

## 覆盖范围与局限
检索于 [date] · 引擎: [同花顺 get_fund_profile]

引擎实际执行的条件: [引擎真正执行的条件 — 与用户原话不同处显式标出]
未能由数据源执行的条件: [用户提的哪些条件未能执行,如何近似的 — 逐条列出,不合并]
源不可用: [本次不可用的引擎/字段,及它本应覆盖的条件]
筛选结果为快照,每日变动;"检索范围内未发现符合条件的基金"仅指上述引擎在该口径下无返回。

## 来源
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

- Deduplicate share classes: keep one line per portfolio, note the class shown.
- Rankings/percentiles name the peer group and its N.
- Provenance: engine/disclosure fields (规模、费率、任职起、引擎给出的区间回报与排名) are
  `[披露]`; anything we derived ourselves from the NAV series (年化、区间超额、分位换算)
  is `[测算]`. `[测算]` is never dropped, even inside a compact screen table.
- Sources entries: a 同花顺 field sourced from fund disclosure is `一手` — name the
  system and `检索于`, publication date may be absent. A media article about a fund is
  `二手` and must name what it relays. Distinct `[n]` markers must equal the entry count.
- The coverage block is not optional when the screen executed cleanly: an empty
  "未能执行" line still has to be written out as such.

### Step 5: Hand off

Offer (don't auto-run) the natural next steps: `fund-profile` on finalists or `holdings-style` overlap check across them.
