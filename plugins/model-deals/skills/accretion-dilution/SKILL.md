---
name: accretion-dilution
description: Build an accretion/dilution (merger consequences) model in Excel for a specific acquisition — standalone earnings for acquirer and target, consideration mix of cash/stock/debt, exchange ratio, financing cost, phased synergies, pro-forma EPS against standalone, and the breakeven synergy and breakeven exchange ratio. Use when a banker, corp-dev team, or board adviser asks whether a deal is accretive or dilutive, what exchange ratio the deal supports, or how much synergy it takes to break even.
---

# Accretion / Dilution Model

**先载入 `xlsx-author` 技能，再动手建表。** 出处载体（Class A 的 `Source:` 批注 /
Class B 的 `来源` 表加 `来源编号` 列）、四色含义、「填机构不填接口名」、URL 的两种诚实
写法、交付时的 `::zcode-file-citation`，都在那份 SKILL.md 里。只照路径调它的
`recalc.py` 不等于读过它——2026-08-24 那批里有一份工作簿正是这样，五项全漏。

The core banking calculation: what happens to the acquirer's earnings per share the
year after this deal closes, and why. The deliverable is an `.xlsx` workbook built
with the `xlsx-author` conventions, recalculated before delivery, and audited before
it is handed over.

This skill models **one named transaction**. It does not value the target as an LBO
candidate — that is `lbo-model` in the `write-research` plugin — and it does not
say whether the deal should be done.

## Language of the deliverable

Authoring prose here is English. The **workbook's labels, the delivery message, and
the coverage block follow the user's language**: a
Chinese request produces a Chinese workbook, an English request an English one.
Provenance tags follow the deliverable — the Chinese set `[披露] [测算] [预期] [推断]
[媒体]` in a Chinese workbook, the English aliases `[Reported] [Est.] [Consensus] [Inferred] [Media]`
in an English one. **One style per document, never mixed.**

> **Reference prices: filter by volume first.** `get_stock_performance` does not skip
> suspended-trading days — it fills all four OHLC values with the previous close
> and nulls only the volume. Taking a "prior trading day close" therefore yields
> a carried-over price: the number is right, the base date is wrong, and nothing
> looks odd. A row with null volume is not a trading day. See `../deal-comps/references/stock-price-traps.md`.

## Non-negotiables

**Environment.** Build with Python/openpyxl following `xlsx-author`. Write formula
strings (`ws["D20"] = "=D12/D18"`), never values computed in Python. Then run
`python3 ../xlsx-author/scripts/recalc.py "<the workbook you just wrote>" 30` (path relative to
this skill's directory) before delivery.

**Formulas over hardcodes.** The only hardcoded numbers permitted are: retrieved
historicals and market data, the announced or assumed deal terms, and the assumption
drivers. Every EPS, every share count roll-forward, every synergy phase-in, every
bridge line, and every breakeven cell is a live formula. If you catch yourself
computing pro-forma EPS in Python and writing the result — stop. The model exists so
the deal team can move the exchange ratio and watch the answer move.

**Cell comments are this skill's citation vehicle (`cell_comments`).** Every
hardcoded input cell carries, written as the cell is created:

```
Source: <System or Document>, <Date>, <Reference>, <URL if applicable>
```

e.g. `Source: 同花顺 iFinD 上市公司财务数据, 检索于 2026-07-25, [证券代码]
FY2025 归母净利润` or `Source: 发行股份购买资产暨关联交易预案, 2026-06-18, 第三节
「交易对价及支付方式」, https://…`.

A calculated cell carries a **formula instead** of a source comment. A source comment
sitting on a calculated cell means a hardcode is hiding in it — find it and replace it
with the formula.

**Every synergy is `[测算]`/`[测算]`.** It goes in the assumptions block with its
basis and its phasing, it is shown as its own line in the bridge, and it is never an
unexplained hardcode buried in a consideration or cost line. A reader must be able to
zero the synergy block and see the deal without it.

**Deal terms carry their class.** A term from an announcement is `[披露]`/`[披露]`
and its cell comment names the announcement. A term from a news report is
`[媒体]`/`[媒体]`. A term we chose is `[测算]`/`[测算]` and lives in the assumptions
block. Put the tag in the row label or the cell comment; never leave three classes
sitting in one unlabelled column.

---

## Step 1 — Resolve both sides and the mandate

Confirm before retrieving anything:

- **Acquirer** and **target**, each resolved to a code via `get_stock_info`
  (group vs listed vehicle vs subsidiary is a real ambiguity in A-share deals).
- **Which side you are modelling for.** The same deal reads differently from the
  buyer's and the seller's chair.
- **Whether the deal is announced.** If it is, the terms are retrievable and the
  model documents a real structure. If it is not, every term is `[测算]` and
  the workbook is explicitly a scenario, labelled as one in the header block.
- **The fiscal year the pro-forma is struck for**, and whether it is a full-year or
  stub-period pro-forma.

## Step 2 — Retrieve standalone earnings

Call `get_stock_financials` for the acquirer and again for the target (one call per
name), and take, for the periods you will show:

| Item | Why it matters here |
|---|---|
| 营业收入 | Context and the synergy base |
| 归母净利润 **and** 全口径净利润 | Accretion is computed on one of them; they differ, sometimes by several points. Name the 口径 in the row label |
| 利息费用 / 有息负债 | The existing cost of debt, and the base the new financing sits on |
| 现金及现金等价物 | How much cash consideration the balance sheet can actually fund |
| 所得税费用 / 税前利润 | The effective tax rate applied to synergies and to incremental interest |

Do not average 归母 and 全口径, and do not carry them in one column. Where the source
publishes a ratio you could also compute, show both and explain the definitional gap.

## Step 3 — Retrieve share counts, and pick the right one

Call `get_stock_shareholders` for each side. It returns 总股本 and 流通股本 with
限售股, 流通A股 and 自由流通股 broken out, plus the top-ten holders and the
实际控制人.

**This is where accretion models go wrong.** 总股本, 流通股本 and 自由流通股 produce
three different EPS numbers off identical earnings, and a model that silently uses the
free-float count computes an EPS that no filing will ever agree with.

- **Use 总股本 for EPS** unless the user asks for something else. That is the count
  the reported EPS is struck on, and a pro-forma EPS that cannot be compared with a
  reported EPS is useless.
- **Say which count you used**, in the row label (`Shares outstanding — 总股本`), in
  the cell comment, and in the coverage block.
- **State 基本 vs 摊薄.** If the acquirer has convertibles, options, or unvested
  awards, either model them into the diluted count or state explicitly that the model
  is on a basic count and that dilutive instruments are not reflected.
- **Use the same convention on both sides.** Acquirer 总股本 against target 流通股本
  is not a model, it is a mistake with a spreadsheet around it.
- 限售解禁 timing does not change the count today, but it changes the float, and it
  belongs in the notes when the consideration is stock.

## Step 4 — Build the consideration and financing structure

Every term here is either retrieved from `wind-docs.get_company_announcements` (`[披露]`) or
assumed (`[测算]`, in the assumptions block):

- **Offer value** — per-share offer price × target shares, or a lump-sum equity value.
- **Consideration mix** — cash / stock / debt / rollover, in percentages that sum to
  100% (assert the sum on the sheet).
- **Exchange ratio** — the acquirer shares issued per target share. Model it both as
  a direct input and as a derived value (`offer price per target share / acquirer
  share price`), and show which one drives the model.
- **New shares issued** = target shares × exchange ratio, on the stated share count.
- **Financing cost** — the interest rate on new acquisition debt, and the **foregone
  interest** on cash used. Foregone interest on the acquirer's own cash is the single
  most commonly omitted line in an accretion model; include it explicitly, even when
  the yield is small.
- **Fees** — advisory, financing, and their tax treatment. Financing fees are usually
  amortised, advisory fees usually expensed; whichever convention you use, state it.

## Step 4.5 — 业绩承诺与补偿安排, where the target is unlisted equity

An A-share 重大资产重组 that buys unlisted equity almost always carries a 业绩承诺 with a
compensation mechanism. Skipping it does not make the model conservative — it makes the
dilution answer **wrong in a knowable direction**, because share compensation returns
shares to the acquirer and therefore *reduces* dilution.

Retrieve the terms from `wind-docs.get_company_announcements` (they live in the 交易预案 / 重组草案 /
问询函回复) and, where the deal is already on the record, `wind-stock.get_stock_events`
(并购指标, 备考财务数据). Record:

- **承诺期与承诺数** — which years, and the committed 净利润 (state 归母 vs 全口径) per year.
- **补偿形式** — 股份补偿 / 现金补偿 / 两者混合, and the **补偿触发与计算公式** as disclosed.
- **股份补偿的回购注销安排** — how many shares return, at what price, and when.
- **减值测试补偿** — a separate obligation from the annual shortfall compensation; do not merge them.
- **承诺方** — who owes the compensation, and whether it is joint and several.

**Model it as two columns, never one.**

| | 不含补偿 | 含股份补偿(按承诺未达成情形) |
|---|---|---|
| 新增股份 | target shares × exchange ratio | 同上 **减去** 补偿注销股份 |
| 摊薄后 EPS | ... | ... |
| 结论 | 增厚/摊薄 | 增厚/摊薄 |

- The compensation column is a **scenario**, `[测算]`, and its trigger assumption must be
  stated (「假设承诺期首年未达成，按公式补偿 X 股」). It is not a forecast that the
  commitment will be missed, and the deliverable says so.
- **A 业绩承诺 is contingent consideration in substance.** Say that plainly: the headline
  对价 overstates the economics if compensation is likely, and understates the acquirer's
  downside if the 承诺方 cannot pay.
- Where the announcements were searched and carry **no** 承诺, record
  `检索范围内未发现` — never assume a deal has no commitment because none was found, and
  never invent terms. Where the target is a listed company or the deal is an asset
  purchase with no 承诺 mechanism, mark it `不适用` and say why.

## Step 5 — Phase in the synergies

- Split **revenue synergies** from **cost synergies**, and both from **cost to
  achieve**. Never net them into one line.
- Phase over the years shown — a typical structure is a run-rate figure with a
  realisation percentage per year — and put the run-rate and the percentages in the
  assumptions block as separate inputs so the phasing can be flexed.
- Tax the synergies at the stated effective rate.
- Every one of these is `[测算]`/`[测算]` with its basis in the cell comment. "管理层
  指引" is a basis and gets cited; "行业惯例" without a document is not.

## Step 6 — Pro-forma earnings and the bridge

The bridge is the deliverable. Build it as an explicit vertical walk, each line a
formula, so a reader can see exactly which effect drives the answer:

```
Acquirer standalone net income (归母)
(+) Target standalone net income (归母)
(+) Synergies, after tax                        [测算]
(−) Cost to achieve, after tax                  [测算]
(−) Incremental interest on new debt, after tax
(−) Foregone interest on cash used, after tax
(+/−) Financing fee amortisation, after tax
(+/−) Other pro-forma adjustments (PPA D&A, etc.), after tax
= Pro-forma net income

Acquirer standalone shares (总股本)
(+) New shares issued as consideration
= Pro-forma shares

Standalone EPS      = acquirer net income / acquirer shares
Pro-forma EPS       = pro-forma net income / pro-forma shares
Accretion/(dilution), absolute = pro-forma EPS − standalone EPS
Accretion/(dilution), %        = pro-forma EPS / standalone EPS − 1
```

Purchase price allocation belongs here only if you have enough disclosure to do it:
if the announcement gives the identifiable-intangibles split, model the step-up
amortisation; if it does not, write the line as `n.d.` with an open item rather than
inventing an allocation. A guessed PPA silently moves the accretion answer.

## Step 7 — Breakeven synergy and breakeven exchange ratio

**These are what the client actually asks for.** Neither is optional.

- **Breakeven synergy** — the after-tax synergy at which pro-forma EPS exactly equals
  standalone EPS, holding the consideration structure fixed. Build it as a live
  formula off the bridge (solve the bridge for the synergy line), not as a value you
  found by nudging an input. Present it next to the modelled synergy so the reader
  sees the cushion: "the deal breaks even at X of after-tax synergy; the model assumes
  Y".
- **Breakeven exchange ratio** — the exchange ratio at which pro-forma EPS equals
  standalone EPS, holding synergies fixed. Present it against the modelled ratio, and
  state what it implies for the offer price per target share at the current acquirer
  price.

Both are `[测算]`/`[测算]`, both state the assumption set they hold fixed, and neither
is a recommendation about what to pay.

## Step 8 — Sensitivity

At minimum one grid, **odd dimensions** (5×5 or 7×7) so there is a true centre cell,
with the axes symmetric around the base case (`[base − 2Δ, base − Δ, base, base + Δ,
base + 2Δ]`):

- Exchange ratio (or offer price) × synergy run-rate → accretion/(dilution) %
- Optionally: cash/stock mix × financing rate → accretion/(dilution) %

The centre cell must equal the model's actual accretion figure — that is the proof the
grid is wired correctly. Highlight it (`#BDD7EE` fill, bold). Every cell is a formula;
no linear approximations, no placeholders, no "use Excel's Data Table feature".

---

## Workbook structure

Five sheets, in dependency order:

| Sheet | Contents |
|---|---|
| `Inputs` | Market data and retrieved financials for both sides; every cell blue with a `Source:` comment |
| `Assumptions` | Deal terms, synergy run-rate and phasing, financing rates, fees, tax rate — each row tagged `[披露]`/`[测算]`/`[媒体]` with its basis |
| `Standalone` | Acquirer and target standalone P&L extract and standalone EPS |
| `Pro Forma` | Consideration and financing build, the bridge, pro-forma EPS, accretion/(dilution), the two breakevens, and the sensitivity grid(s) at the bottom |
| `Checks` | Every identity as a visible TRUE/FALSE or zero-difference row |

The `Checks` sheet asserts, at minimum:

- Consideration mix percentages sum to 100%.
- Cash + stock + debt + rollover consideration = total offer value.
- Standalone net income + every bridge adjustment = pro-forma net income (difference = 0).
- Acquirer shares + new shares issued = pro-forma shares.
- Pro-forma EPS × pro-forma shares = pro-forma net income.
- Breakeven synergy, substituted back into the bridge, produces zero accretion.

## Formatting

Per the house formatting policy, which arbitrates:

- **Font colours — four, not three.** Blue `#0000FF` hardcoded input · black formula ·
  green `#008000` link to another sheet · purple `#800080` link on the same sheet with
  no calculation (`=B9`). The purple case is the one models drop, and audits check it.
- **Fills — 3 blues and a grey.** `#1F4E79` header with white bold text · `#BDD7EE`
  grouping band and key outputs · `#D9E1F2` input/assumption block · `#F2F2F2` neutral.
  No greens, yellows, or oranges as decoration.
- **Borders are mandatory and carry meaning**: 1.5pt above section headers, 1.0pt
  under subtotals, 0.5pt interior grid, double rule under grand totals, thin vertical
  rule between the last historical and first pro-forma column.
- **Numbers right-aligned, text left-aligned.** Currency `#,##0;(#,##0);"-"`,
  percentages `0.0%`, EPS `0.00`, multiples `0.0"x"`, exchange ratio `0.0000`.
- State the unit and currency in the column or row header, never only in prose, and
  never mix 万元 and 亿元 in one column.

---

## Common errors in this model specifically

| Error | What goes wrong | Fix |
|---|---|---|
| Wrong share count | EPS is struck on 流通股本 or 自由流通股 and no filing agrees with it | Use 总股本, label it, use it on both sides |
| Mixed 口径 | Acquirer 归母 against target 全口径 | One 口径 throughout, named in every row label |
| Foregone interest omitted | Cash deals look more accretive than they are | An explicit after-tax line in the bridge |
| Synergies untaxed | Accretion overstated by the tax rate | Tax every synergy and cost-to-achieve line |
| Synergies unphased | Year-1 accretion assumes run-rate on day one | Separate run-rate input × realisation % per year |
| Exchange ratio circularity | Ratio derived from a price that the deal itself moves | Fix the reference price, state its date, note the circularity |
| New shares on the wrong count | Shares issued computed off target 流通股本 | Consideration is for the whole equity: use 总股本 |
| Fees left out of the bridge | Pro-forma EPS too high | Advisory expensed, financing amortised, both stated |
| PPA invented | A guessed intangible step-up silently moves the answer | `n.d.` and an open item unless the split is disclosed |
| Breakeven found by nudging | The cell is a hardcode dressed as an output | Solve the bridge with a formula |
| Sensitivity cells identical | Mixed references wrong (`$A5`, `B$4`) | Check the anchoring; every cell must differ |

---

## Verification before delivery

1. **Recalc.** `python3 ../xlsx-author/scripts/recalc.py "<the workbook you just wrote>" 30`. Exit
   `0` clean · `2` errors found, fix every location and re-run · `3`
   **`recalc_unavailable` — LibreOffice is missing, no formula was evaluated, and this
   is NOT a pass**; run `xlsx-author`'s substitute protocol (reference check on every
   formula, independent recompute in Python, assert the identities above) and record
   the limitation in the coverage block · `1` hard failure.
2. **Audit.** Run the model-scope audit conventions from the `audit-xls` skill (it
   ships with the `write-research` plugin; if it is not loaded in this session,
   work its checklist by hand). The merger-specific bugs it lists are exactly this
   model's failure modes: accretion/dilution using the wrong share count (pre- vs
   post-deal), synergies not phased in, purchase price allocation that does not
   balance, foregone interest on cash omitted, and transaction fees missing from
   sources and uses.
3. **Colour and comment sweep.** Every blue cell has a `Source:` comment; no
   calculated cell has one; same-sheet pass-throughs are purple; cross-sheet links are
   green.
4. **Identity sweep.** Every row on `Checks` passes.
5. **Sanity.** Signs correct, magnitudes plausible, no `#REF!` / `#DIV/0!` /
   `#VALUE!` / `#NAME?` anywhere.

## Delivery — the coverage block

Close the delivery message with this block, verbatim heading, even when everything
passed. Use `## 覆盖范围与局限` for a Chinese deliverable and `## Coverage and
Limitations` for an English one.

```
## 覆盖范围与局限
检索于 / Retrieved: <timestamp>

- Financials retrieved: <which items, which periods, for which entity, from which
  tool — e.g. acquirer and target FY2025 归母净利润, 有息负债, cash via hexin-stock
  get_stock_financials; share counts (总股本) via get_stock_shareholders>
- Share count basis: <总股本 / 流通股本 / 自由流通股; 基本 or 摊薄; whether dilutive
  instruments are modelled>
- Deal terms — announced: <terms taken from an announcement, each with its document
  and date> [披露]/[披露]
- Deal terms — assumed: <exchange ratio, mix, financing rate, fees, synergy run-rate
  and phasing, tax rate — each also [测算]/[测算] in its cell comment and in the
  assumptions block> [测算]/[测算]
- Deal terms — media only, uncorroborated: <or 检索范围内未发现> [媒体]/[媒体]
- Formula evaluation: <one of> recalc.py evaluated all N formulas via LibreOffice,
  zero errors (exit 0) / recalc.py could NOT evaluate the formulas (exit 3,
  LibreOffice unavailable) — only a static lint plus the openpyxl
  reference/recompute/identity checks ran; the model is NOT verified and the user
  should confirm the numbers on open
- 本次未能覆盖 / Not covered: <sources that failed or were out of scope, and what they
  would have covered — e.g. PPA detail not disclosed, so no step-up amortisation is
  modelled>
- 数据滞后性 / Known lag: <disclosure lag on the financials and the share register>
```

Where a check could not run, say `源不可用` and name the tool that failed.
`检索范围内未发现` means the source was queried and returned nothing — it is never
rendered as "there is no such term". `recalc_unavailable` is not a pass, and a
workbook delivered without formula evaluation is never described as verified.

This model stages arithmetic for the deal team. It does not say whether the deal
should be done, does not opine on fairness, and does not set a price.
