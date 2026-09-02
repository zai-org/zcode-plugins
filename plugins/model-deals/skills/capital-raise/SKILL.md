---
name: capital-raise
description: Model a primary issuance in Excel — 定增 (private placement), 配股 (rights issue), IPO, or 可转债 (convertible bond). Sizes the raise, sets out the pricing basis and discount against a stated reference price, allocates use of proceeds, and models pre- and post-money ownership, EPS dilution, and the effect on the 实际控制人's stake. Use when a CFO, banker, or board adviser asks how large a raise can be, what it prices at, or how much it dilutes existing holders.
---

# Capital Raise

**先载入 `xlsx-author` 技能，再动手建表。** 出处载体（Class A 的 `Source:` 批注 /
Class B 的 `来源` 表加 `来源编号` 列）、四色含义、「填机构不填接口名」、URL 的两种诚实
写法、交付时的 `::zcode-file-citation`，都在那份 SKILL.md 里。只照路径调它的
`recalc.py` 不等于读过它——2026-08-24 那批里有一份工作簿正是这样，五项全漏。

A primary issuance, modelled end to end: how much is raised, at what price against
what reference, what the money is for, and who owns what afterwards. The deliverable
is an `.xlsx` workbook built with the `xlsx-author` conventions, recalculated before
delivery, and audited before it is handed over.

This models an **issuance**, not a valuation. It does not say what the shares are
worth, does not recommend a price, and does not advise on whether the raise should be
done or whether it complies with anything.

## Language of the deliverable

Authoring prose here is English. The **workbook's labels, the delivery message, and
the coverage block follow the user's language**.
Provenance tags follow the deliverable — `[披露] [测算] [预期] [推断] [媒体]` in a
Chinese workbook, `[Reported] [Est.] [Consensus] [Inferred] [Media]` in an English
one. **One style per document, never mixed.**

> **Reference prices: filter by volume first.** `get_stock_performance` does not skip
> suspended-trading days — it fills all four OHLC values with the previous close
> and nulls only the volume. Taking a "prior trading day close" therefore yields
> a carried-over price: the number is right, the base date is wrong, and nothing
> looks odd. A row with null volume is not a trading day. See `../deal-comps/references/stock-price-traps.md`.

## Non-negotiables

**Environment.** Build with Python/openpyxl following `xlsx-author`. Write formula
strings, never values computed in Python. Then run `python3
../xlsx-author/scripts/recalc.py "<the workbook you just wrote>" 30` (path relative to this skill's
directory) before delivery.

**Cell comments are this skill's citation vehicle (`cell_comments`).** Every hardcoded
input cell carries, written as the cell is created:

```
Source: <System or Document>, <Date>, <Reference>, <URL if applicable>
```

e.g. `Source: 同花顺 iFinD 股本与股东结构, 检索于 2026-07-25, 000001.SZ
总股本与实际控制人持股` or `Source: 向特定对象发行A股股票预案, 2026-05-20, 第二节
「发行价格及定价原则」, https://…`. A calculated cell carries a formula instead — a
source comment on a calculated cell means a hardcode is hiding in it.

**Do not assert a regulatory threshold from memory.** This is the rule that matters
most in this skill, because issuance rules are numerous, 板块-specific, instrument-
specific, and revised often. Pricing floors relative to a reference price, 锁定期
lengths, issuance-size caps relative to 总股本, the interval between raises, investor
eligibility, and 摊薄后 EPS disclosure requirements all fall under this. A specific
threshold enters the workbook **only** when a retrieved announcement or rule text
states it, cited in the cell comment. Otherwise the row is an **open item flagged as
requiring confirmation against the current rules** — never a confident number, never a
recollection dressed as a constraint. Getting this wrong is worse than leaving it
blank: a modelled floor that no longer exists produces a raise size the company cannot
execute.

---

## Step 1 — Resolve the issuer and the instrument

- Resolve the issuer to a code with `get_stock_info`, and note the 上市板 — rules
  and market practice differ across boards, which is one more reason not to assume a
  threshold.
- Confirm the instrument: **定增** (向特定对象发行), **配股**, **IPO**, or **可转债**.
  They dilute differently and price differently, and mixing their mechanics is the
  fastest way to a wrong answer.
- Confirm whether the raise is **announced** (terms retrievable, `[披露]`/`[Reported]`)
  or **contemplated** (every term `[测算]`/`[Est.]`, and the header block says the
  workbook is a scenario).
- Confirm the purpose: sizing exercise, dilution check for an announced deal, or
  funding leg of an acquisition (in which case it cross-links to `sources-uses`).

## Step 2 — Retrieve the capital structure and the register

`get_stock_shareholders` — the core call for this skill. Take:

- **总股本**, and the split into 限售股, 流通A股, 自由流通股. Use 总股本 as the
  denominator for ownership percentages and for EPS; name it in every row label. The
  three counts give three different answers and picking the wrong one is the classic
  error.
- **前十大股东 and 前十大流通股东**, with shareholdings.
- **实际控制人与大股东详情** — the identity and the stake that the dilution analysis is
  ultimately about.
- **限售解禁时间表与本期解禁数量**, which changes the float even without an issuance
  and belongs in the notes.

`get_stock_events` — 增发 progress, pricing, amount raised and 保荐机构 for a placement;
配股 timetable and 承销方式 for a rights issue; IPO details including 战略配售 and
上市日期. If the company has raised before, the prior event is the best available
evidence of how this one will be structured, and it is retrievable rather than
assumed.

`get_stock_financials` — 归母净利润 (for EPS, 口径 named), 有息负债 and cash (to show
what the raise does to leverage), and the return metrics the use of proceeds will be
judged against.

`get_stock_performance` — the price history the pricing reference is computed from. One
一次一个标的。

`wind-docs.get_company_announcements` — the 预案, 发行情况报告书, 股东大会决议, and any 问询函
回复. Every disclosed term comes from here and cites it.

## Step 3 — Sizing

Model the raise size as a driven output, not a typed number, so the user can flex it:

```
Gross proceeds       = shares issued × issue price
                       (or: target proceeds → shares issued = proceeds / price)
Issuance costs       = underwriting + sponsor + legal + audit        [测算]
Net proceeds         = gross proceeds − issuance costs
```

Show the raise **as a percentage of pre-deal 总股本 and of pre-deal market
capitalisation**, because that is how both the board and the market will size it. Where
a rule caps either, that cap is an open item requiring confirmation unless a retrieved
document states it.

For a **配股**, the mechanics are different and must be modelled as such: the 配股比例
(e.g. shares offered per 10 held), the subscription price, the take-up assumption
(state it — full take-up is an assumption, not a fact), and the theoretical ex-rights
price:

```
TERP = (pre-rights price × pre-rights shares + subscription price × new shares)
       / (pre-rights shares + new shares)
```

The **value of the right** and the discount to TERP are what a rights issue is actually
judged on, and a rights issue's headline "discount" to the pre-announcement price is
not comparable with a placement's discount. Say so on the sheet.

For a **可转债**, model both states: the bond outstanding (coupon, tenor, put/call
schedule as disclosed) and the if-converted state (conversion price, conversion ratio,
shares on full conversion, conversion premium against the reference price). Dilution is
reported both ways — no conversion and full conversion — and the workbook never shows
only one.

## Step 4 — Pricing basis and discount

**A discount without its reference is not a number.** Every pricing line states:

- **The reference price and how it is constructed** — a closing price on a stated date,
  or an average over a stated window of trading days before a stated 定价基准日. Compute
  it from `get_stock_performance` and show the window on the sheet.
- **The 定价基准日** itself, and what event fixes it (board resolution, shareholder
  resolution, first day of the issue period) — as disclosed, not as assumed.
- **The issue price**, and the discount as `issue price / reference price − 1`.
- **Whether a floor binds.** If a retrieved rule or announcement states a floor as a
  percentage of the reference price, model it as an input with its citation and show
  the headroom. If no such document was retrieved, the floor row is an **open item**,
  labelled as requiring confirmation against the current rules, and the model shows the
  unconstrained price with that caveat stated on the face of the sheet.

Also flag, as open items requiring confirmation rather than modelled facts: the
**锁定期** applying to the subscribers and to the 控股股东/实际控制人 if participating,
and any **摊薄后 EPS disclosure** the issuer will need to make. Each of these is a real
constraint on a real deal; none of them gets a number from memory.

## Step 5 — Use of proceeds

A table of projects, each with its allocated amount, its share of net proceeds, and its
source. Where the 预案 discloses the 募投项目, every line is `[披露]`/`[Reported]` and
cites it. Where the raise is contemplated, every line is `[测算]`/`[Est.]` and sits in
the assumptions block. Include:

- 补充流动资金 and 偿还有息负债 as explicit lines where applicable, and show the pro-forma
  effect on 有息负债 and on leverage.
- Any acquisition funded by the raise, cross-referenced to the `sources-uses` schedule
  so the two artifacts agree on one number.
- The allocation percentages summing to 100%, asserted on the sheet.

## Step 6 — Dilution

This is the deliverable. Three tables, all formulas.

**Ownership, pre- and post-money.** One row per material holder, plus the
实际控制人 and 控股股东 as their own rows, plus the new investors:

```
                        Pre-deal shares   Pre %   Shares subscribed   Post shares   Post %   Δ pp
实际控制人 (及一致行动人)          …          …             …               …          …       …
第二大股东                        …          …             …               …          …       …
…
新投资者 / 配售对象                —          —             …               …          …       …
合计                              …       100%             …               …       100%       …
```

Compute percentages on the **named** share count, consistently. Show the change in
percentage points (pp), not percent — an owner going from 40% to 32% fell 8pp, not 8%,
and the distinction is not pedantry here.

For a **配股**, model both a full-take-up case and a case where the 实际控制人 does not
subscribe — the second is the whole reason a board asks for this analysis.

**The 实际控制人's position.** Its own block: stake before, stake after, and the
arithmetic consequence. Where the post-deal stake crosses a level that would matter for
control, say so as an **arithmetic observation requiring confirmation against the
current rules and the company's own disclosure** — never as a legal conclusion, and
never citing a specific threshold from memory.

**EPS dilution.**

```
Pre-deal EPS   = 归母净利润 / pre-deal 总股本                  (口径 named)
Post-deal EPS  = (归母净利润 + after-tax effect of proceeds) / post-deal 总股本
```

The "after-tax effect of proceeds" is `[测算]`/`[Est.]` and must be modelled explicitly
and conservatively — interest saved on debt repaid, or a stated return on the funded
projects, each as its own input with its basis. **The default and most honest
presentation is the static case: no earnings contribution from the proceeds**, which is
maximal dilution, shown alongside any contribution case. A model that silently credits
the raise with project earnings makes every issuance look accretive.

For a **可转债**, show basic EPS, EPS assuming full conversion, and the after-tax coupon
drag in between.

---

## Workbook structure

| Sheet | Contents |
|---|---|
| `Inputs` | 总股本 and its splits, the register, financials, price history extract; every cell blue with a `Source:` comment |
| `Assumptions` | Issue size, price or discount, take-up, issuance-cost percentages, proceeds-deployment return — each tagged with its class and basis |
| `Pricing` | Reference-price construction with its window and 定价基准日, the issue price, the discount, and the floor as an input-or-open-item |
| `Raise` | Sizing, use of proceeds, pro-forma cash and leverage |
| `Dilution` | Pre/post ownership, the 实际控制人 block, EPS dilution, and (配股) the TERP build |
| `Open Items` | Every regulatory constraint that could not be sourced, what it would bind, and what document would settle it |
| `Checks` | Identities as visible TRUE/FALSE rows |

`Checks` asserts, at minimum: post-deal shares = pre-deal shares + shares issued; every
ownership column sums to 100%; every holder's post-deal shares = pre-deal + subscribed;
gross proceeds = shares issued × issue price; net proceeds = gross − costs; use-of-
proceeds allocations sum to net proceeds; discount = issue price / reference price − 1;
and (配股) TERP × post-rights shares = pre-rights market value + subscription proceeds.

The `Open Items` sheet is not optional. A raise model with no open items is claiming
every applicable rule was retrieved and cited, which is a strong claim.

## Formatting

Per the house formatting policy:

- **Font colours — four.** Blue `#0000FF` input · black formula · green `#008000`
  cross-sheet link · purple `#800080` same-sheet link with no calculation.
- **Fills — 3 blues and a grey.** `#1F4E79` header (white bold) · `#BDD7EE` grouping
  band and key outputs · `#D9E1F2` input block · `#F2F2F2` neutral.
- **Borders mandatory and meaningful**: 1.5pt above section headers, 1.0pt under
  subtotals, 0.5pt interior grid, double rule under grand totals.
- Numbers right-aligned, text left-aligned. Share counts `#,##0`, prices `0.00`,
  percentages `0.00%` (ownership needs the second decimal), pp changes labelled as pp.
  Unit and currency in the header, never only in prose.

---

## Common errors in a raise model

| Error | What goes wrong | Fix |
|---|---|---|
| A rule threshold from memory | A floor or cap that no longer applies drives the whole model | Retrieve it or make it an open item |
| Wrong share count | Ownership computed on 流通股本, EPS on another count | 总股本 throughout, named in every label |
| Discount with no reference | The headline discount is uninterpretable | State the reference construction, window, and 定价基准日 |
| 配股 discount compared with a placement's | Two different things in one column | Model TERP; label the comparison |
| Proceeds credited with earnings by default | Every raise looks accretive | Static case first; contribution case separate and tagged `[测算]` |
| Convertible shown one way only | Dilution understated or overstated | Always both: no conversion and full conversion |
| pp and % confused | An 8pp fall reported as 8% | Label the unit on every change column |
| Take-up assumed silently | A rights issue that is not fully taken up dilutes differently | An explicit take-up input; model the non-participation case |
| Issuance costs omitted | Net proceeds overstated | Explicit cost lines, `[测算]`, percentage-driven |
| Control conclusion asserted | A legal opinion this plugin cannot give | State the arithmetic; flag for confirmation |

---

## Verification before delivery

1. **Recalc.** `python3 ../xlsx-author/scripts/recalc.py "<the workbook you just wrote>" 30`. Exit
   `0` clean · `2` fix every location and re-run · `3` **`recalc_unavailable` is NOT a
   pass** — no formula was evaluated; run `xlsx-author`'s substitute protocol
   (reference check on every formula, independent recompute in Python, assert the
   identities on `Checks`) and record it in the coverage block · `1` hard failure.
2. **Audit.** Apply the model-scope audit conventions from the `audit-xls` skill (it
   ships with the `write-research` plugin; work its checklist by hand if it is not
   loaded), including its share-count check — "share count ties to the dilution
   schedule (options, converts, buybacks)" is precisely this model's core identity.
3. **Colour and comment sweep.** Every blue cell has a `Source:` comment; no calculated
   cell has one.
4. **Identity sweep.** Every row on `Checks` passes; every ownership column sums to
   100%.
5. **Open-items sweep.** Every unretrieved regulatory constraint appears on
   `Open Items`, and none of them appears anywhere else as a number.

## Delivery — the coverage block

Close the delivery message with this block, verbatim heading — `## 覆盖范围与局限` for
a Chinese deliverable, `## Coverage and Limitations` for an English one — even when
everything passed.

```
## 覆盖范围与局限
检索于: <timestamp>

- 已检索数据: <total shares and register via hexin-stock get_stock_shareholders (报告期
  X); 归母净利润 and 有息负债 via get_stock_financials; price history via
  get_stock_performance for the reference window; prior 增发/配股 events via
  get_stock_events>
- 股本口径: 总股本 (基本/摊薄 stated); 流通股本与自由流通股仅用于流通性说明,未用于
  每股指标
- 已披露条款: <issue size, price, 定价基准日, 募投项目, 锁定期 — each with its
  announcement and date> [披露]
- 假设条款: <issue price or discount, take-up, issuance costs, proceeds deployment —
  each also [测算] in its cell comment and in the assumptions block> [测算]
- 仅见媒体、未经公告证实: <or 检索范围内未发现> [媒体]
- 待核实的监管口径 (未从检索文件中取得,不得据以决策): <pricing floor relative to the
  reference price, 锁定期, issuance-size cap, 摊薄后 EPS disclosure — listed on the
  Open Items sheet, each with the document that would settle it>
- 公式核验: <recalc.py evaluated all N formulas via LibreOffice, zero errors (exit 0) /
  recalc.py could NOT evaluate the formulas (exit 3, LibreOffice unavailable) — static
  lint plus the openpyxl reference/recompute/identity checks only; the model is NOT
  verified and the user should confirm the numbers on open>
- 本次未能覆盖: <sources that failed, named as 源不可用, and what they would have
  covered>
- 数据滞后性: <register as of 报告期 X; 限售解禁 between now and issuance will move the
  float>
```

`检索范围内未发现` means the source was queried and returned nothing; `源不可用` means
it could not be queried. Neither is rendered as an absence of the thing itself, and
neither is rendered as compliance.

This model stages an issuance structure for the deal team and the board. It does not
opine on whether the raise should be done, does not set a price, does not confirm that
any structure complies with the applicable rules, and never asserts a regulatory
threshold that was not retrieved and cited.
