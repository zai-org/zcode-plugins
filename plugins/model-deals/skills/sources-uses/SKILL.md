---
name: sources-uses
description: Build a sources and uses schedule with the pro-forma capital structure in Excel for a specific transaction — purchase-price build, the equity-value to enterprise-value bridge, refinanced debt, fees and expenses, funding from cash on hand, new debt, new equity and rollover, and pro-forma leverage and coverage. Use when a banker, corp-dev team, or CFO asks how a deal gets funded, what the total funding need is, or what the balance sheet looks like the day after close.
---

# Sources and Uses

**先载入 `xlsx-author` 技能，再动手建表。** 出处载体（Class A 的 `Source:` 批注 /
Class B 的 `来源` 表加 `来源编号` 列）、四色含义、「填机构不填接口名」、URL 的两种诚实
写法、交付时的 `::zcode-file-citation`，都在那份 SKILL.md 里。只照路径调它的
`recalc.py` 不等于读过它——2026-08-24 那批里有一份工作簿正是这样，五项全漏。

Where the money comes from and where it goes, for one named transaction, plus what the
capital structure looks like at close. The deliverable is an `.xlsx` workbook built
with the `xlsx-author` conventions, recalculated before delivery, and audited before
it is handed over.

## Citing in the delivery note

This skill's citation vehicle is **cell comments**, so the workbook does not owe a
`## 来源` section. But the moment the delivery note writes `[n]`, it has promised
entries — and a real run shipped eight markers with no Sources section behind
them. So: either cite in prose with `[n]` **and** add `## 来源` with one entry per
marker in the schema from the citation policy, or carry the citations only
in cell comments and use no `[n]` at all. Do not mix.

The as-of label is `检索于` and nothing else. The same run emitted a retired
variant of it; no paraphrase of it is acceptable.

This is a **funding plan for a specific deal**. It is not the Sources & Uses tab of an
LBO valuation — that lives inside `lbo-model` in the `write-research` plugin,
where it is an input to a returns calculation. Here it is the deliverable, and it
answers to the deal team and the financing desk.

## Language of the deliverable

Authoring prose here is English. The **workbook's labels, the delivery message, and
the coverage block follow the user's language**.
Provenance tags follow the deliverable — `[披露] [测算] [预期] [推断] [媒体]` in a
Chinese workbook, `[Reported] [Est.] [Consensus] [Inferred] [Media]` in an English
one. **One style per document, never mixed.**

## Non-negotiables

**Environment.** Build with Python/openpyxl following `xlsx-author`. Write formula
strings, never values computed in Python. Then run `python3
../xlsx-author/scripts/recalc.py "<the workbook you just wrote>" 30` (path relative to this skill's
directory) before delivery.

**Sources must equal uses exactly, and the identity is on the face of the sheet.**
Not in a cell comment, not in the delivery message, not "verified by the modeller" — a
visible check row, immediately under the two totals, that reads `=Sources total −
Uses total` and shows zero, or `=Sources total = Uses total` and shows TRUE. A
sources-and-uses schedule whose balance you have to take on trust is not one. If it
does not balance, the plug is wrong or a use is missing; find it rather than forcing
the difference into "other".

**Cell comments are this skill's citation vehicle (`cell_comments`).** Every
hardcoded input cell carries, written as the cell is created:

```
Source: <System or Document>, <Date>, <Reference>, <URL if applicable>
```

e.g. `Source: 同花顺 iFinD 上市公司财务数据, 检索于 2026-07-25, [证券代码]
2026Q1 有息负债` or `Source: 重大资产购买报告书(草案), 2026-06-18, 第五节「本次交易的
资金来源」, https://…`. A calculated cell carries a formula instead — a source comment
on a calculated cell means a hardcode is hiding in it.

**Fees are always `[测算]`/`[测算]` unless a document states them.** Advisory,
financing, legal, and other transaction expenses are almost never disclosed at signing.
Model them as explicit percentage-driven inputs in the assumptions block, tagged
`[测算]`/`[测算]`, with the basis stated. Never write a round-number fee with no
comment, and never fold fees into the purchase price to make the schedule tidy.

---

## Step 1 — Resolve the transaction and its perimeter

Confirm before retrieving anything:

- **Buyer, target, and what is actually being acquired** — the whole company, a
  controlling stake, an asset package, or a business line. The perimeter decides
  whether an equity-value or an asset-purchase build is correct.
- **Whether the deal is announced.** Retrieve the terms if so via
  `wind-docs.get_company_announcements`; if not, every term is `[测算]`/`[测算]` and the header
  block says the workbook is a scenario.
- **Close date assumption**, because the debt and cash balances you fund against are
  as of a stated balance-sheet date and will move.
- **Whether existing debt is refinanced, assumed, or left in place.** This single
  choice changes the uses side more than anything else, and it is frequently left
  ambiguous in a draft term sheet. Ask.

## Step 2 — Retrieve the balance-sheet inputs

`get_stock_financials`, one call per entity, for the most recent period, taking:

| Item | Used for |
|---|---|
| 有息负债 (and its short/long split) | The debt to be refinanced or assumed; the base for pro-forma leverage |
| 总负债 | Only where a total-liability measure is wanted; never interchange it with 有息负债 |
| 货币资金 / 现金及现金等价物 | Cash available to fund, before any minimum operating cash |
| EBITDA components (营业利润, 折旧摊销) or a disclosed EBITDA | The leverage and coverage denominators |
| 利息费用 | Existing interest, and the coverage base |
| 少数股东权益 | An equity-to-enterprise-value bridge item |

`get_stock_shareholders` for the share counts (总股本 for an equity-value build) and
for the 实际控制人 position, which matters when part of the consideration is stock or
when a shareholder rolls over.

`get_stock_events` for any 并购指标 already published on the deal — 备考财务数据 and
借壳上市 status, where present — and for prior issuances that changed the capital
structure since the last balance sheet.

`get_stock_summary` or `get_stock_performance` for the reference share price where
the purchase price is struck off market value.

## Step 2.5 — 业绩承诺: contingent consideration on the uses side

Where the target is unlisted equity, retrieve the 业绩承诺与补偿安排 from
`wind-docs.get_company_announcements` (交易预案 / 重组草案 / 问询函回复). It belongs in this schedule
because it changes what the consideration *is*, not merely what it costs:

- A 承诺 with 股份补偿 means part of the equity consideration is **returnable** — the
  headline 对价 is an upper bound, not a settled amount. Show the disclosed 对价 as the
  funding requirement (that is what must actually be raised at close) and note the
  contingent return separately; do **not** net it out of the uses side, or the sources
  will not tie.
- A 现金补偿 obligation sits with the 承诺方, not the acquirer — it is not a source of
  funds at close. Never fund the deal with it.
- 减值测试补偿 is a separate, later obligation; keep it out of the close-date schedule
  and record it as a post-close contingency.
- Searched and none disclosed → `检索范围内未发现`. Listed target or no 承诺 mechanism →
  `不适用`, with the reason.

## Step 3 — Build the uses side

**Purchase price build, then the equity-to-enterprise-value bridge.** State which one
the deal is struck on; A-share deals are quoted both ways and conflating them is a
material error.

```
Offer price per share × target shares (总股本)     = Equity purchase price
(+) Debt assumed or refinanced (有息负债)
(−) Cash acquired (货币资金, less minimum operating cash)
(+) Minority interest (少数股东权益)
(+) Other bridge items (preferred, pensions, off-balance-sheet, earn-out at fair value)
= Enterprise value / total transaction value
```

The uses schedule then reads:

| Use | Notes |
|---|---|
| Equity purchase price | Or the asset-package price for an asset deal |
| Refinancing of existing target debt | Only what is actually being refinanced; assumed debt is **not** a use |
| Refinancing of existing acquirer debt | Where the financing is being done at the same time |
| Prepayment penalties / make-whole | `[测算]` unless the debt document states it |
| Advisory fees | `[测算]`, percentage-driven |
| Financing fees | `[测算]`, on the new debt quantum; usually capitalised and amortised |
| Legal, accounting, other transaction expenses | `[测算]` |
| Cash to balance sheet | Where the raise is deliberately oversized |
| Minimum cash / working-capital funding at close | State the convention |

**Assumed debt is not a use and not a source.** It stays on the pro-forma balance
sheet and appears in the capital-structure table, not in the funding schedule. Putting
it in both is the most common way a sources-and-uses schedule double-counts.

## Step 4 — Build the sources side

| Source | Notes |
|---|---|
| Cash on hand | Buyer's cash less minimum operating cash — state the minimum as its own input, never net it silently |
| New debt, by tranche | Each tranche with quantum, rate, tenor, and amortisation; the rate feeds coverage |
| New equity issued to the public | Cross-links to `capital-raise` if the deal is funded by an issuance |
| Stock consideration to the seller | Shares issued × reference price; state the price and its date |
| Seller rollover | Rolled equity is a source and its holder appears in the pro-forma ownership table |
| Seller note / deferred consideration | Include the payment schedule in the notes |
| Earn-out | Only the portion recognised at close; state the basis |

**Name the plug.** One line balances the schedule — usually the revolver draw, the
sponsor/parent equity cheque, or new debt. Say which, make it a formula computed as the
difference, and never make two lines plugs at once.

## Step 5 — Pro-forma capital structure, leverage and coverage

A table that walks from the current structure to the pro-forma one, per tranche:

```
                          Current    Adjustments    Pro forma    x EBITDA    % of total cap
Cash                          …            …            …            …
Revolver (drawn)              …            …            …            …            …
Term debt / bank loans        …            …            …            …            …
Bonds                         …            …            …            …            …
Other 有息负债                 …            …            …            …            …
Total debt                    …            …            …            …            …
Net debt                      …            …            …            …            …
Equity (market or book — say which)                     …                         …
Total capitalisation                                    …                        100%
```

Then the credit metrics, each with its definition on the sheet:

- Total debt / EBITDA and net debt / EBITDA — state whether EBITDA is LTM, pro-forma
  for synergies, or pro-forma before synergies. **A leverage multiple whose EBITDA
  definition is unstated is not a number**, and synergy-adjusted leverage is
  `[测算]`/`[测算]` and must be shown alongside the unadjusted figure.
- EBITDA / interest and (EBITDA − capex) / interest.
- 资产负债率 on the pro-forma balance sheet, with its 口径 named.
- Any leverage covenant headroom **only** where a retrieved document states the
  covenant; otherwise the row is an open item, not a number recalled from memory.

## Step 6 — Ownership after close, where the consideration includes stock

Pull the pre-deal top-ten holders and the 实际控制人 from
`get_stock_shareholders`, add the shares issued as consideration and any rollover,
and show pre- and post-deal percentages side by side. Flag explicitly if the
计算结果 moves the 实际控制人 below a controlling position — flag it as an arithmetic
consequence requiring confirmation against the current rules and the company's own
disclosure, **not** as a legal conclusion, and never assert a specific control
threshold from memory.

---

## Workbook structure

| Sheet | Contents |
|---|---|
| `Inputs` | Retrieved balance-sheet items, share counts, market data; every cell blue with a `Source:` comment |
| `Assumptions` | Fee percentages, financing rates and tenors, minimum cash, refinance-vs-assume elections, EBITDA basis — each tagged with its class and basis |
| `Sources & Uses` | The purchase-price build, the EV bridge, the two schedules side by side, the plug, and the balance check row |
| `Pro Forma Cap` | Current → adjustments → pro-forma capital structure, leverage and coverage, pro-forma ownership |
| `Checks` | Every identity as a visible TRUE/FALSE or zero-difference row |

The `Checks` sheet asserts, at minimum:

- **Total sources − total uses = 0.** This one is also repeated on the face of the
  `Sources & Uses` sheet.
- Equity purchase price = offer price × shares, on the named share count.
- EV bridge: equity value + debt − cash + minority + other = enterprise value.
- Pro-forma debt = current debt + new debt − refinanced debt (assumed debt unchanged).
- Pro-forma cash = current cash − cash used + cash to balance sheet.
- Each leverage multiple = its numerator / its stated EBITDA line.
- Consideration mix percentages sum to 100%.

## Formatting

Per the house formatting policy:

- **Font colours — four.** Blue `#0000FF` input · black formula · green `#008000`
  cross-sheet link · purple `#800080` same-sheet link with no calculation.
- **Fills — 3 blues and a grey.** `#1F4E79` header (white bold) · `#BDD7EE` grouping
  band and key outputs · `#D9E1F2` input block · `#F2F2F2` neutral.
- **Borders mandatory and meaningful**: 1.5pt above section headers, 1.0pt under
  subtotals, 0.5pt interior grid, **double rule under the sources and uses grand
  totals** — that is exactly what the double rule is for.
- Numbers right-aligned, text left-aligned. Currency `#,##0;(#,##0);"-"`, multiples
  `0.0"x"`, percentages `0.0%`. Unit and currency in the header, never only in prose,
  and never 万元 and 亿元 in one column.

---

## Common errors in this schedule specifically

| Error | What goes wrong | Fix |
|---|---|---|
| Assumed debt counted as both source and use | Schedule balances at an inflated size | Assumed debt appears only in the pro-forma capital structure |
| Balance asserted in prose | Reader cannot see it, and it is often untrue | A visible check row on the sheet |
| Two plugs | The schedule always balances and hides errors | Exactly one plug, computed as a difference |
| Fees omitted or netted into price | Understates the funding need | Explicit fee lines, percentage-driven, tagged `[测算]` |
| All cash on the balance sheet treated as available | Leaves the business with no operating cash | A stated minimum-cash input |
| 有息负债 and 总负债 interchanged | Leverage overstated, sometimes hugely | Name the 口径 on every debt line |
| EBITDA basis unstated | Leverage cannot be compared with anything | Say LTM / pro-forma / synergy-adjusted, and show unadjusted alongside |
| Refinancing penalty forgotten | Funding need too small | An explicit line, `[测算]` unless documented |
| Equity value and enterprise value conflated | The whole schedule is the wrong size | An explicit bridge, with every item |
| Covenant headroom from memory | An invented threshold in a financing document | Only from a retrieved document; otherwise an open item |

---

## Verification before delivery

1. **Recalc.** `python3 ../xlsx-author/scripts/recalc.py "<the workbook you just wrote>" 30`. Exit
   `0` clean · `2` fix and re-run · `3` **`recalc_unavailable` is NOT a pass** — no
   formula was evaluated; run `xlsx-author`'s substitute protocol (reference check,
   independent recompute in Python, assert the identities above) and record it in the
   coverage block · `1` hard failure.
2. **Audit.** Apply the model-scope audit conventions from the `audit-xls` skill (it
   ships with the `write-research` plugin; work its checklist by hand if it is
   not loaded). Its `sources = uses, exactly` identity and its merger-specific bug
   list — transaction fees not in sources and uses, fees not deducted from day-one
   equity — are this schedule's failure modes.
3. **Colour and comment sweep.** Every blue cell has a `Source:` comment; no
   calculated cell has one.
4. **Identity sweep.** Every row on `Checks` passes, and the on-sheet balance row
   reads zero.
5. **Sanity.** Pro-forma leverage plausible for the sector, no negative pro-forma
   cash, no error values anywhere.

## Delivery — the coverage block

Close the delivery message with this block, verbatim heading — `## 覆盖范围与局限` for
a Chinese deliverable, `## 覆盖范围与局限` for an English one — even when
everything passed.

```
## 覆盖范围与局限
检索于 / Retrieved: <timestamp>

- Balance-sheet inputs retrieved: <which items, which 报告期, which entity, from which
  tool — e.g. target 有息负债 and 货币资金 as of 2026-03-31 via hexin-stock
  get_stock_financials>
- Deal terms — announced: <purchase price, consideration mix, financing arrangements
  taken from an announcement, each with document and date> [披露]/[披露]
- Deal terms — assumed: <fees, financing rates and tenors, minimum cash, refinance
  elections, close date, EBITDA basis — each also [测算]/[测算] in its cell comment
  and in the assumptions block> [测算]/[测算]
- Deal terms — media only, uncorroborated: <or 检索范围内未发现> [媒体]/[媒体]
- Balance check: sources − uses = 0, asserted on the face of the Sources & Uses sheet
  and on Checks
- Formula evaluation: <one of> recalc.py evaluated all N formulas via LibreOffice,
  zero errors (exit 0) / recalc.py could NOT evaluate the formulas (exit 3,
  LibreOffice unavailable) — only a static lint plus the openpyxl
  reference/recompute/identity checks ran; the model is NOT verified and the user
  should confirm the numbers on open
- 本次未能覆盖 / Not covered: <e.g. covenant terms — the financing documents were not
  retrieved, so no covenant headroom is shown; 源不可用 for any tool that failed>
- 数据滞后性 / Known lag: <the balance sheet is as of 报告期 X and will have moved by
  close>
```

`检索范围内未发现` means the source was queried and returned nothing; `源不可用` means
it could not be queried. Neither is rendered as an absence of the thing itself.
`recalc_unavailable` is not a pass, and this workbook is never described as verified
without formula evaluation.

This schedule stages a funding plan for the deal team. It does not opine on whether
the deal should be done, does not commit financing, and does not set a price.
