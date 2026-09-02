---
name: competitive-analysis
description: Framework for building competitive landscape decks — market positioning, competitor deep-dives, comparative analysis, strategic synthesis. Use when the user asks for a competitive landscape, competitor analysis, peer comparison, market positioning assessment, strategic review, or investment memo deck. Also triggers on "who are the competitors to X", "benchmark X against peers", "build a market map", or any request to systematically evaluate competitive dynamics across an industry.
---

# Competitive Landscape Mapping

Build a complete competitive analysis deck. This is a two-phase process: gather requirements and get outline approval first, then build.

## Output format

Deliverable is a `.pptx` file built per the `pptx-author` skill conventions (or built into a deck the user uploaded). If the user wants a memo/note instead of slides, keep the same analysis workflow and swap the output format. 用户要 Word 时同样走 `report-render`（`DocxReport`，与 `Report` 同一套调用）——**要出 Word 就先载入 `report-render` 技能，再动手建**；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

## Phase 1 — Scope the analysis

Competitive analysis means different things to different people. Before any research or slide-building, ask the user targeted questions to pin down what they actually want. Don't guess — a 20-slide peer benchmarking deck and a 5-slide market map are both "competitive analysis" and take completely different shapes.

Gather in one round if you can (keep it to ~4 questions):

- **Scope** — Single target company with competitors around it? Or multi-company side-by-side with no protagonist?
- **Competitor set** — Which companies are in scope? If the user names them, use exactly those. If they say "the usual suspects," propose a set and confirm.
- **Audience and depth** — Quick read for someone already in the space, or a full primer? This drives whether you need market sizing, industry economics, and history — or can skip to the comparison.
- **Investment context** — Do they need bull/base/bear scenarios and signposts? That's Step 9 below; skip it if this is a strategic review rather than an investment thesis.

If they've uploaded an Excel/CSV with competitor data, confirm which columns map to which metrics before you start pulling numbers. Source-file fidelity matters: use values exactly as given, don't recalculate or re-round.

## Phase 2 — Outline, approve, then build

**Do not create slides until the outline is approved.** Propose slide titles and one-line content notes, present them to the user, get a yes. A competitive deck is 10-20 slides of interlocking content — rebuilding because slide 4 was wrong is expensive. The outline is the cheap iteration point.

When proposing the outline, ask the user directly about the structural decisions: which positioning visualization (2×2 matrix / radar / tier diagram — Step 5 below), how to group competitors (by business model / segment / posture — Step 4). These are taste calls the user likely has an opinion on.

---

## Standards — apply throughout

### Prompt fidelity

When the user specifies something, that's a requirement, not a suggestion:
- **Slide titles and section names** — exact wording. If they say "Overview and Competitive Scope," don't swap in "FY2024 Competitive Landscape."
- **Chart vs. table** — not interchangeable. "Embedded chart" means a real chart object with data labels on the bars/slices, not a formatted table.
- **Complete data series** — if they list 7 competitors, include all 7. If they show 2015-2025, include every year.
- **Exact values and ratios** — "surpasses DoorDash 4:1, Lyft 8:1" means those ratios, not "7.6x Lyft."

### Source quality, when sources conflict

1. 10-Ks / annual reports (audited)
2. Earnings calls / investor presentations (management commentary)
3. Sell-side research (analyst estimates, useful for private company sizing)
4. Industry reports (McKinsey, Gartner — market sizing, trends)
5. News (recent developments only; verify against primary sources)

### Data comparability

- All competitor metrics from the same fiscal year; flag exceptions explicitly ("FY24" vs "H1 2024")
- Same metric definitions across competitors
- Convert to USD for international; note the exchange rate and date
- Missing data shows as `n.d.` — never silently blank, and never fabricated to fill a gap. A number that cannot be sourced is deleted, not published with a caveat.
- **Every number carries its provenance via a clickable source marker `[n]`** that jumps to `## 来源`: cite "[Company] [Document] ([Date])" or "[Firm], [Date]; [basis]".
- **Provenance tags — five**: `[披露]` `[测算]` `[预期]` `[推断]` `[媒体]`, or the English aliases `[Reported] [Est.] [Consensus] [Inferred] [Media]` in an English deck. On every comparison table, metrics table, and scenario table, chip each value — those put disclosed actuals, our derivations, and third-party forecasts side by side, and the reader cannot tell them apart otherwise. In flowing narrative the `[n]` citation carries `[披露]` and `[预期]` for you, so those chips are optional there. **`[测算]`, `[推断]`, and `[媒体]` are never optional, prose included** — a citation cannot say that a share figure is our own derivation, that a moat rating is our judgement, or that a deal is an unconfirmed press report. `[预期]` names its provider inline. One tag style per document: the Chinese forms in a Chinese deck, the English aliases in an English one, never mixed; if any chip appears, put a one-line legend on the first slide or page.
- **Market share & positioning claims need a source + date + basis** (e.g. "~15% share (Canalys, 2025; unit-shipment basis)[n]"), not an unsourced assertion.

### Before delivering — count the markers

A real run of this skill shipped **seventeen `[n]` markers with no Sources section
at all**, and no coverage block. Nothing in a hand-written deliverable enforces
marker/entry parity — `report-render`'s `refs.cite()` does, but only for PDFs
built through it. So count them:

- [ ] every distinct `[n]` in the body has exactly one Sources entry, and vice versa
- [ ] `## 来源` and `## 覆盖范围与局限` both present
- [ ] if you are not maintaining a Sources section, use no `[n]` at all

### 来源 and coverage — the two closing sections

Every deliverable ends with both, whatever the format. On slides they are the last two slides (continued across as many as they need); in a memo they are the last two sections. The headings are exact.

**Sources.** Heading is exactly `## 来源` — not a "References" variant, not a bilingual pairing, not "资料来源". One entry per distinct `[n]`, and the count of distinct markers must equal the count of entries; a marker with no entry, or an entry nothing points to, is a defect:

```
## 来源
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

`一手|二手` is mandatory, not implied. A 10-K, an investor presentation, an exchange announcement, or a database field sourced from those is `Primary`. Everything else is `Secondary`, and **a Secondary entry must name what it relays**: `Secondary · Caixin · relaying IDC "China AI Market Tracker" · 2026-05-12 (published); retrieved 2026-07-25 · https://…`. This bites hardest on the market-sizing and share slides: a figure that resolves only to a news article quoting a research report is a Secondary entry, and the deck must say the underlying report was not obtained. Do not launder a news URL into an authoritative-looking citation. A generic "Source: company filings, Gartner, sell-side research" blob is not a citation — it names no document, no date, and no mapping from claim to source.

**Coverage.** Heading is exactly `## 覆盖范围与局限`. Write it even when everything resolved — a silent absence reads as clearance, and in a competitive deck the reader will otherwise assume the peer set was fully covered:

```
## 覆盖范围与局限
Retrieved: [timestamp] · Competitor set: [the names actually in scope, and who chose them]

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| Financials for [names] | 有记录 | 10-K / investor deck | [date] |
| Financials for [private names] | 源不可用 — sized by our own 测算 from [disclosed inputs], method stated | — | [date] |
| Consensus (revenue, EBITDA, growth) | 有记录 for [n of N] names | [named provider] | [date] |
| Market share by [basis] | 有记录 / 检索范围内未发现 | [firm, date, basis] | [date] |

本次未能覆盖: [sources that failed, and what they would have shown]
Comparability: [fiscal-period mismatches, metric-definition differences, FX date]
```

Use the three states verbatim: `有记录` / `检索范围内未发现` / `源不可用`. "检索范围内未发现" is a statement about our search, never rendered as "the competitor does not disclose this" or "no such data exists".

### Design

- **Slide titles are insights, not labels.** "Scale leaders pulling away from niche players" — not "Competitive Analysis."
- **Signposts are quantified.** "Margin below 40%" — not "margins decline."
- **Ratings show the actual.** "●●● $160B" — not just "●●●."
- **Charts are real chart objects** — not text tables dressed up to look like charts.

**Typography** — set explicitly, don't rely on defaults:
- Slide titles: 28-32pt bold
- Section headers: 18-20pt bold
- Body text: 14-16pt (never below 14pt)
- Table text: 14pt
- Sources/footnotes: 14pt, gray
- Same element type = same size throughout the deck

**Charts:**
- Legend inside the chart boundary, not floating over the plot area
- Right-side legend for pies (≤6 slices), bottom legend for line/bar (≤4 series)
- More than 6 series → split into multiple charts or use a table
- Pie charts show percentages on slices, not just in the legend
- Each chart carries a source line (firm + date + basis) **in the note beneath it, exactly once** — not drawn inside the chart canvas, so it can never overlap axis labels or data and can carry a clickable `[n]`. Tables the same: the note beneath, never a row inside.
- `report-render`'s `references/pitfalls.md` documents the silent chart failures — tofu from a missing CJK font, duplicated titles and sources, density sizing. Read it rather than rediscovering them; if a CJK font cannot be registered, keep chart labels English/numeric and carry the Chinese in the body.

**Tables** (slides and memos are document media, so document-table conventions apply — the house formatting policy):
- No vertical rules. Header row filled `#1F3A5F` with white bold text, zebra white/`#F4F7FA`, thin `#E5E9EF` horizontal grid
- Right-align numbers, left-align text; a header aligns with its column's content
- Enough cell padding that text doesn't touch borders
- A table's source note appears exactly once, as a final row or the line immediately below it

**Color:** 2-3 colors max. Muted — navy, gray, one accent. Same color meanings throughout.

### What's strict vs. flexible

| Always | Case-by-case |
|---|---|
| Exact titles/sections when user specifies | Creative titles when they don't |
| Chart when user says chart; table when they say table | Visualization type when unspecified |
| Every competitor/data point they list | Number of competitors when unspecified |
| Exact values when specified | Rounding when precision unspecified |
| Titles fit without overflow | Number of competitor categories |
| No overlapping elements | Which dimensions to compare |

---

## Analysis workflow

### Step 0 — Industry-defining metrics

Before anything else: what 3-5 metrics does this industry actually run on? Use these consistently across every competitor.

| Industry | Key metrics |
|---|---|
| SaaS | ARR, NRR, CAC payback, LTV/CAC, Rule of 40 |
| Payments | GPV, take rate, attach rate, transaction margin |
| Marketplaces | GMV, take rate, buyer/seller ratio, repeat rate |
| Retail | Same-store sales, inventory turns, sales per sq ft |
| Logistics | Volume, cost per unit, on-time delivery %, capacity utilization |

Industry not listed — pick the metrics investors and operators benchmark on.

### Step 1 — Market context

Size, growth, drivers, headwinds. With sources.

Correct: "Embedded payments is $80-100B in 2024, growing 20-25% CAGR (McKinsey 2024)"
Wrong: "The market is large and growing rapidly"

### Step 2 — Industry economics

Map how value flows. Approach depends on industry structure:
- **Vertically structured** — value chain layers, typical margin at each
- **Platform/network** — ecosystem participants, value flows between them
- **Fragmented** — consolidation dynamics, margin differences by scale

### Step 3 — Target company profile

```
| Metric | Value |
|---|---|
| Revenue | $4.96B |
| Growth | +26% YoY |
| Gross Margin | 45% |
| Profitability | $373M Adj. EBITDA |
| Customers | 134K |
| Retention | 92% |
| Market Share | ~15% |
```

Multi-segment companies add a breakdown:

```
| Segment | Revenue | Rev YoY | Rev % | EBITDA | EBITDA YoY | Margin |
|---|---|---|---|---|---|---|
| Seg A | $25.1B | +26% | 57% | $6.5B | +31% | 26% |
| Seg B | $13.8B | +31% | 31% | $2.5B | +64% | 18% |
| Seg C | $5.1B | -2% | 12% | -$74M | -16% | -1% |
| Total | $44.0B | +18% | 100% | $6.5B* | - | 15% |
```
*Note corporate costs if applicable

### Step 4 — Competitor mapping

Group by whichever lens fits (ask the user if they haven't specified):
- By business model — platform / vertical / horizontal
- By segment — enterprise / SMB / consumer
- By posture — direct / adjacent / emerging
- By origin — incumbent / disruptor / new entrant

### Step 5 — Positioning visualization

| Type | When |
|---|---|
| 2×2 matrix | Two dominant competitive factors |
| Radar/spider | Multi-factor comparison |
| Tier diagram | Natural clustering into strategic groups |
| Value chain map | Vertical industries |
| Ecosystem map | Platform markets |

See `references/frameworks.md` for 2×2 axis pairs by industry.

### Step 6 — Competitor deep-dives

Two tables per competitor.

**Metrics:**
```
| Metric | Value |
|---|---|
| Revenue | $X.XB |
| Growth | +XX% YoY |
| Gross Margin | XX% |
| Market Cap | $X.XB |
| Profitability | $XXXM EBITDA |
| Customers | XXK |
| Retention | XX% |
| Market Share | ~XX% |
```

**Qualitative:**
```
| Category | Assessment |
|---|---|
| Business | What they do (1 sentence) |
| Strengths | 2-3 bullets |
| Weaknesses | 2-3 bullets |
| Strategy | Current priorities |
```

### Step 7 — Comparative analysis

```
| Dimension | Company A | Company B | Company C |
|---|---|---|---|
| Scale | ●●● $160B | ●●○ $45B | ●○○ $8B |
| Growth | ●●○ +26% | ●●● +35% | ●●○ +22% |
| Margins | ●●○ 7.5% | ●○○ 3.2% | ●●● 15% |
```

### Step 8 — Strategic context

M&A transactions (multiples, rationale), partnership trends, capital raising patterns, regulatory developments. See `references/schemas.md` for the M&A transaction table format.

### Step 9 — Synthesis

**Moat assessment** — rate each competitor Strong / Moderate / Weak on:

| Moat | What to assess |
|---|---|
| Network effects | User/supplier flywheel strength; cross-side vs same-side |
| Switching costs | Technical integration depth, contractual lock-in, behavioral habits |
| Scale economies | Unit cost advantages at volume; minimum efficient scale |
| Intangible assets | Brand, proprietary data, regulatory licenses, patents |

**Required synthesis elements:**
- Durable advantages (hard to replicate) — map to moat categories
- Structural vulnerabilities (hard to fix)
- Current state vs. trajectory

**For investment contexts** (skip if the Phase 1 scoping said no):

```
| Scenario | Probability | Key driver |
|---|---|---|
| Bull | 30% | Market share gains, margin expansion |
| Base | 50% | Current trajectory continues |
| Bear | 20% | Competitive pressure, margin compression |
```

Synthesis is where the deck stops reporting and starts arguing, so the chips matter most here: a moat rating, a "structural vulnerability", and a scenario probability are all ours — `[推断]` for the judgement, `[测算]` for a number we assigned — while the quantified signpost under each scenario still cites its `[n]`.

---

## Quality checklist

Before finishing:

**Prompt fidelity**
- Slide titles match what the user specified, verbatim
- Charts where they said chart; tables where they said table
- Every competitor/year/data point they listed is present
- Exact values and formats as specified

**Data consistency**
- Source-file values extracted directly, not recalculated
- Same metric shows the same value on every slide it appears
- Same decimal precision as the source

**Data provenance**
- Every market-size / share / growth figure cites firm + date + basis via a clickable `[n]` source marker; nothing unsourced or fabricated, and nothing unsourceable published with a caveat
- `[测算]`, `[推断]`, and `[媒体]` chipped wherever they occur, prose included; table cells fully chipped; `[预期]` names its provider
- `## 来源` present with `〔一手|二手〕` on every entry, every Secondary naming what it relays, and distinct `[n]` markers equal to the entry count
- `## 覆盖范围与局限` present, using the three states verbatim, even where everything resolved
- Conflicting third-party estimates shown with their spread, not cherry-picked
- Each chart's source stated once (not duplicated in both the chart and a caption note); chart source notes sit clear of the plot; CJK labels render (not blank)
- Charts sized to their information density (sparse → small, dense → larger) with a height cap — not one fixed width, not oversized/full-bleed

**Layout**
- Titles fit without overflow
- No overlapping elements
- All text within containers, no clipping

**Content**
- Every number has a citation
- All metrics from the same fiscal period (or flagged)
- Slide titles state insights, not topics
- Charts are real chart objects

Render every slide to an image and look at each one — this catches overlaps, overflow, and low-contrast text that don't show up when you're reading back the XML. `report-render`'s `references/pitfalls.md` lists what to look for; the same discipline applies to slides as to pages.
