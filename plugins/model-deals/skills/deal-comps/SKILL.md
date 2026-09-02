---
name: deal-comps
description: Assemble a precedent-transaction set by hand for a specific deal — identify candidate transactions from stock events and announcement search, extract the announced terms from the announcements themselves, and compute transaction multiples (EV/EBITDA, EV/Revenue, P/E) and 控制权溢价 against a stated pre-announcement reference date. Delivers either a Markdown snapshot or an Excel workbook. Use when a banker or corp-dev team asks what comparable deals paid, what the precedent multiples are, or what premium the market has accepted for control.
---

# Precedent Transaction Comps

**先载入 `xlsx-author` 技能，再动手建表。** 出处载体（Class A 的 `Source:` 批注 /
Class B 的 `来源` 表加 `来源编号` 列）、四色含义、「填机构不填接口名」、URL 的两种诚实
写法、交付时的 `::zcode-file-citation`，都在那份 SKILL.md 里。只照路径调它的
`recalc.py` 不等于读过它——2026-08-24 那批里有一份工作簿正是这样，五项全漏。

What comparable deals actually paid, assembled from the announcements that disclosed
them. Two artifacts are possible — a Markdown snapshot or an `.xlsx` workbook — and
they carry provenance differently. Choose once, up front, and say which you chose.

## Read this before you start: there is no precedent-transaction database

**This plugin has no deals database, no league-table feed, and no private-deal terms
source.** No tool here answers the question "give me comparable transactions". Anyone
who has used a banking terminal expects one to exist; it does not, and pretending
otherwise produces a table of invented rows.

A precedent set here is **assembled by hand**, deal by deal:

1. Candidates are surfaced through `get_stock_events` (并购指标, 借壳上市 status, 增发
   used as acquisition currency) and `search_stocks` for a same-industry universe, then
   narrowed by reading.
2. Each candidate's terms are extracted from the **announcement full text** via
   `wind-docs.get_company_announcements`.
3. Each row **cites the announcement it came from**. A row you could not tie to an
   announcement does not go in the table.

Say this to the user in the delivery message, in plain words: the set is hand-built,
here is how candidates were found, here is what the search covered, and here is what
it will therefore have missed — unlisted acquirers, deals where neither side is an
A-share issuer, and deals whose terms were never disclosed are structurally invisible
to this method.

**A precedent set you could not assemble is `源不可用`, not an empty table.** If the
event and announcement searches did not run, or ran and could not be read, say so.
`检索范围内未发现` is only honest when the searches actually executed and returned
nothing, and even then it means "our searches found none", never "no comparable
transactions exist".

> **Reference prices: filter by volume first.** `get_stock_performance` does not skip
> suspended-trading days — it fills all four OHLC values with the previous close
> and nulls only the volume. Taking a "prior trading day close" therefore yields
> a carried-over price: the number is right, the base date is wrong, and nothing
> looks odd. A row with null volume is not a trading day. See `references/stock-price-traps.md`.

## Language of the deliverable

Authoring prose here is English. The **deliverable follows the user's language**
(the language policy). Provenance tags follow the deliverable — `[披露] [测算]
[预期] [推断] [媒体]` in a Chinese one, `[Reported] [Est.] [Consensus] [Inferred]
[Media]` in an English one. **One style per document, never mixed.**

## Pick the artifact, and know which citation vehicle governs it

This skill carries **both** citation vehicles because it has two output forms
(citation vehicles: `sources_section`, `cell_comments`).

| Artifact | When | Citation vehicle | Table formatting |
|---|---|---|---|
| **Markdown snapshot** | "可比交易大概什么倍数", a quick read the user will answer and move on from | Inline `[n]` markers → a `## 来源` / `## Sources` section | **Document table**: no vertical rules, header fill `#1F3A5F` white bold, zebra white/`#F4F7FA`, thin `#E5E9EF` horizontal grid |
| **Workbook (.xlsx)** | The set feeds a valuation, a board pack, a fairness discussion, or a file the user will keep updating | A `Source:` comment on every hardcoded input cell | **Spreadsheet table**: borders mandatory and meaningful, header fill `#1F4E79` |

Both are right about their own medium (the house formatting policy arbitrates). Do
not carry a workbook's borders into a document, and do not strip a workbook of them
because a document does without. In **both** media, numbers are right-aligned and text
is left-aligned, and every deal states its own source exactly once.

Everything below about candidate identification, term extraction, 口径 discipline,
premium reference dates, and coverage honesty applies to both artifacts. Only the
artifact changes.

---

## Step 1 — Define the screen, and write it down

Before searching, agree and record:

- **The subject deal or subject company** the set is for.
- **Industry perimeter** — the 行业分类 from `get_stock_info`, plus the business
  description, because an industry code and a business comparability judgement are
  not the same thing.
- **Window** — announcement dates from and to. State it; a 2019 multiple and a 2026
  multiple are not members of one population.
- **Deal-size floor and ceiling**, if any.
- **Deal type** — control acquisition, minority stake, asset purchase, 借壳上市,
  merger of equals. **Never mix control and minority deals in one median**: a minority
  stake carries no control premium and its multiple is not comparable.
- **What counts as included** — announced only, or completed only, or both with a
  status column. Say which.

The screen definition goes in the deliverable. A precedent set whose selection rule is
undocumented cannot be reviewed, and its median means nothing.

## Step 2 — Surface candidates

- `search_stocks` for the same-industry A-share universe, giving a code list to work
  through.
- `get_stock_events` per code (one call per name), reading 并购指标 for 备考财务数据
  and 借壳上市 status, and 增发 where shares were issued as acquisition currency.
- `wind-docs.get_company_announcements` per candidate, searching the disclosure record for
  交易预案, 重组草案, 重大资产购买报告书, 收购报告书, 权益变动报告书 within the window.
- `wind-docs.get_financial_news` may surface a deal you would otherwise miss — but a deal found
  only there is `[媒体]`/`[Media]` and cannot enter the multiples table until an
  announcement confirms its terms. It may be listed separately as a known deal with
  undisclosed terms.

Record how many candidates each step produced and how many survived. That count is
part of the coverage block.

## Step 3 — Extract the terms, from the announcement

For each surviving deal, read the announcement and take:

| Field | Notes |
|---|---|
| Acquirer, target, announcement date | The announcement date is the anchor for everything else |
| Status | 预案 / 草案 / 过会 / 完成 / 终止. A terminated deal's terms are still a data point, labelled as terminated |
| Stake acquired (%) | Decides whether it belongs in a control set |
| Consideration and mix | Cash / stock / assets; the exchange ratio where stock |
| Equity value of the transaction | The disclosed figure where one exists |
| Debt and cash of the target at the reference date | Needed for the EV bridge |
| Target revenue, EBITDA, net profit | **State the 报告期 and the 口径 (归母 vs 全口径)**, and whether the figure is the audited historical or the 备考 figure |
| Valuation basis disclosed | 评估方法 and 评估值 where the 草案 discloses them |
| Payment schedule, earn-out, lock-up | Notes column |

Every one of these is `[披露]`/`[Reported]` **and cites the announcement**. A figure you
computed from them is `[测算]`/`[Est.]`. A figure only a news article carries is
`[媒体]`/`[Media]`, and it is not silently promoted.

## Step 4 — Compute the transaction multiples

```
Transaction EV = equity value of the transaction
                 (grossed to 100% where a partial stake was acquired — say so)
               + target debt (有息负债)
               − target cash
               + minority interest
               + other bridge items

EV / Revenue   = transaction EV / target revenue    (报告期 stated)
EV / EBITDA    = transaction EV / target EBITDA     (报告期 and construction stated)
P / E          = equity value / target net profit   (归母 or 全口径 — stated)
```

Discipline that decides whether the set is usable:

- **Gross up partial stakes.** A 51% stake bought for X implies an equity value of
  X/0.51 only if there is no control premium embedded — say which convention you used
  and flag it as `[测算]`/`[Est.]`.
- **One 口径 per column.** 归母 in a P/E column throughout, or 全口径 throughout, never
  a mix, never an average of the two.
- **One period convention per column.** LTM throughout or last-full-year throughout.
  Where a deal only discloses a 备考 figure, put it in its own column or flag the row.
- **Negative or near-zero denominators produce no multiple.** Write `n.m.` and exclude
  the row from the median; do not print a 300x that drags the mean.
- **State N for every statistic.** A median of three deals is three observations, not a
  level. Show min / 25th / median / 75th / max only where N supports it, and show the
  observations themselves where it does not.

## Step 5 — The control premium, and its reference date

**A premium without its base date is not a number.** This is the most abused figure in
deal work.

For each deal, pull the target's price history with `get_stock_performance` (一次一个标的
per call, dates `yyyyMMdd`) around the announcement date and compute:

| Premium | Base |
|---|---|
| 1-day premium | Offer price / closing price on the **last trading day before the announcement** |
| 30-day premium | Offer price / the average close over the 30 trading days before the announcement |
| 60-day or 90-day premium | Where the deal was leaked early or the stock was suspended, and you say why you used it |

Every premium column states, on the face of the table:

- **which reference it uses** (1-day, 30-day, or other),
- **the reference date**,
- **the reference price**, and
- whether the stock was **suspended (停牌)** before the announcement — an A-share
  target is frequently suspended ahead of a 重组, which makes the last close stale and
  the 1-day premium misleading. Where the stock was suspended, say so in the row and
  prefer a pre-suspension reference, stating the change.

Premia are `[测算]`/`[Est.]` — we computed them — even though both inputs are
`[披露]`/`[Reported]`.

## Step 6 — Present it

**Markdown snapshot.** One table of deals with the key terms, one table of multiples
and premia with a statistics block, the screen definition, then `## 来源` (or
`## Sources`) and the coverage block. Every deal row carries an inline `[n]` marker
pointing at its announcement. The count of distinct `[n]` markers must equal the number
of entries. Entry schema:

```
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
[n] 〔Primary|Secondary〕 Publisher · Document or system · Date (published; retrieved) · URL
```

An exchange announcement retrieved through `wind-docs.get_company_announcements` is `一手` /
`Primary`. A term relayed by a news article is `二手` / `Secondary` and **must name
what it relays**. A generic attribution blob — "资料来源：公司公告、同花顺" — is not a
citation: it names no document, no date, and no mapping from claim to source.

**Workbook.** Four sheets:

| Sheet | Contents |
|---|---|
| `Screen` | The screen definition, the candidate counts at each stage, and the exclusion reasons |
| `Deals` | One row per deal: parties, date, status, stake, consideration, terms; every retrieved cell blue with a `Source:` comment naming the announcement |
| `Multiples` | The EV bridge, the multiples, the premia with their reference dates and prices, and the statistics block — all formulas |
| `Checks` | Identities as visible TRUE/FALSE rows |

Cell comments in the workbook take the standard form, written as each cell is created:

```
Source: <System or Document>, <Date>, <Reference>, <URL if applicable>
```

e.g. `Source: XX股份发行股份购买资产暨关联交易预案, 2025-11-04, 第四节「标的资产评估
情况」, https://…`. A calculated cell carries a formula instead — a source comment on a
calculated cell means a hardcode is hiding in it.

`Checks` asserts: EV bridge ties for every row; every multiple equals its numerator
over its stated denominator; every premium equals offer over its stated reference
price; the statistics block covers exactly the rows not marked `n.m.` or excluded; and
the N shown equals the number of rows in the statistic.

---

## Common errors in a precedent set

| Error | What goes wrong | Fix |
|---|---|---|
| Implying a comps database | Rows appear that no announcement supports | Assemble by hand; cite every row |
| Empty table read as "no comparables" | A false clearance | `源不可用` if the search did not run; otherwise say what was searched |
| Premium with no base date | The number is uninterpretable and often wrong | State reference, date, and price on the face of the table |
| Suspension ignored | 停牌 before a 重组 makes the last close stale | Flag it; use a pre-suspension reference and say so |
| Control and minority deals in one median | The premium is meaningless | Segment by stake acquired |
| Mixed 口径 in the P/E column | Multiples differ by several turns | One 口径, named in the header |
| Mixed periods | LTM against last-full-year | One period convention, named |
| Median of three | A bucket of one or two presented as a level | State N; show observations where N is small |
| Stale multiples | A 2019 deal in a 2026 set with no window stated | State the window; segment by period if wide |
| Terminated deals unlabelled | Terms that never happened treated as market evidence | A status column, always |

---

## Verification before delivery

**Workbook.** Run `python3 ../xlsx-author/scripts/recalc.py "<the workbook you just wrote>" 30`
(path relative to this skill's directory). Exit `0` clean · `2` fix and re-run · `3`
**`recalc_unavailable` is NOT a pass** — no formula was evaluated; run `xlsx-author`'s
substitute protocol (reference check, independent recompute in Python, assert the
identities on `Checks`) and record it in the coverage block · `1` hard failure. Then
apply the model-scope audit conventions from the `audit-xls` skill (it ships with the
`write-research` plugin; work its checklist by hand if it is not loaded), and
sweep the four font colours and the cell comments.

**Snapshot.** Distinct `[n]` markers equal Sources entries; every entry declares
`一手`/`二手` (`Primary`/`Secondary`) and every secondary names its relay chain; every
premium carries its reference date; every statistic carries its N.

## Delivery — the coverage block

Close with this block, verbatim heading — `## 覆盖范围与局限` for a Chinese
deliverable, `## Coverage and Limitations` for an English one — even when everything
passed. It goes before or after `## 来源` / `## Sources`.

```
## 覆盖范围与局限
检索于: <timestamp>  ·  口径/委托用途: <e.g. 交易定价参考 / 董事会材料>

筛选口径: <industry perimeter, window, size range, deal type, included statuses>

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 同行业候选交易识别 | 有记录(N 家筛出, M 笔入选) | 同花顺 hexin-stock get_stock_events | 2026-07-25 |
| 交易条款提取 | 有记录(M 笔全部取自公告) | 万得 wind-docs.get_company_announcements | 2026-07-25 |
| 停牌前参考价 | 有记录(M 笔) / 部分源不可用 | 同花顺 hexin-stock get_stock_performance | 2026-07-25 |
| 未披露条款交易 | 有记录(K 笔仅见媒体,未入表) | 万得 wind-docs.get_financial_news | 2026-07-25 |

本次未能覆盖: 本插件没有可比交易数据库,交易集为逐笔人工搜集。非上市收购方、
双方均非 A 股主体的交易、以及未披露对价的交易在本方法下不可见。<plus any tool
that failed, named as 源不可用 and what it would have covered>
数据滞后性: 公告披露与事件收录存在滞后;终止交易的条款为公告当时口径。
溢价基准: <1-day / 30-day, and the reference dates used>
公式核验: <recalc.py evaluated all N formulas, zero errors (exit 0) / recalc.py
could NOT evaluate the formulas (exit 3) — static lint plus openpyxl
reference/recompute/identity checks only; the workbook is NOT verified>
```

For the Markdown snapshot the same block compresses to prose, but must still name what
was searched, what was not, how many deals survived, the premium reference, and the
retrieval time.

`检索范围内未发现` means the source was queried and returned nothing — never rendered
as "there are no comparable transactions". `源不可用` means it could not be queried,
and is a finding in its own right. Placeholders stay placeholders: never invent an
example premium or a representative multiple to make a table look complete.

This set stages market evidence for the deal team. It is not a fairness opinion, it
does not set a price, and a median is not a recommendation.
