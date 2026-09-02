---
name: comps-analysis
description: |
  Build institutional-grade comparable company analyses with operating metrics, valuation multiples, and statistical benchmarking in Excel/spreadsheet format.

  **Perfect for:**
  - Public company valuation (M&A, investment analysis)
  - Benchmarking performance vs. industry peers
  - Pricing IPOs or funding rounds
  - Identifying valuation outliers (over/under-valued)
  - Supporting investment committee presentations
  - Creating sector overview reports

  **Not ideal for:**
  - Private companies without comparable public peers
  - Highly diversified conglomerates
  - Distressed/bankrupt companies
  - Pre-revenue startups
  - Companies with unique business models
---

# Comparable Company Analysis

**先载入 `xlsx-author` 技能，再动手建表。** 出处载体（Class A 的 `Source:` 批注 /
Class B 的 `来源` 表加 `来源编号` 列）、四色含义、「填机构不填接口名」、URL 的两种诚实
写法、交付时的 `::zcode-file-citation`，都在那份 SKILL.md 里。只照路径调它的
`recalc.py` 不等于读过它——2026-08-24 那批里有一份工作簿正是这样，五项全漏。

## ⚠️ CRITICAL: Data Source Priority (READ FIRST)

**ALWAYS follow this data source hierarchy:**

1. **FIRST: Check for MCP data sources** - If the 同花顺 MCP servers (`hexin-stock` for A shares, `hexin-global-stock` for HK/US) or the SEC filings MCP (sec-search) are available, use them exclusively for financial and trading information. Consensus is in `hexin-stock.get_stock_financials`; Wind (`wind-stock`) stays as a cross-check on headline financials only
2. **DO NOT use web search** if the above MCP data sources are available
3. **ONLY if MCPs are unavailable:** Then use SEC EDGAR filings or other institutional sources
4. **NEVER use web search as a primary data source** - it lacks the accuracy, audit trails, and reliability required for institutional-grade analysis

**Why this matters:** MCP sources provide verified, institutional-grade data with proper citations. Web search results can be outdated, inaccurate, or unreliable for financial analysis.

---

## Overview
This skill teaches Claude to build institutional-grade comparable company analyses that combine operating metrics, valuation multiples, and statistical benchmarking. The output is a structured Excel/spreadsheet that enables informed investment decisions through peer comparison.

### Pick the output format before you build

Not every comps request wants a workbook. Choose once, up front, and say which you picked:

- **Quick snapshot (in-conversation table)** — for "估值快照", "对比一下这几家", "这个板块现在什么估值", or any question the reader will answer and move on from. Deliver a Markdown table: the peer set, 5-10 metrics, a median row, outlier flags, a `## 来源` section and a `## 覆盖范围与局限` block. Skip the workbook, the openpyxl build, the cell formatting, and the recalc step. Everything in this skill about **data sourcing, 口径 discipline, outlier treatment, and provenance still applies** — only the artifact changes.
- **Full workbook (.xlsx)** — for model-backed work: anything feeding a valuation, a report exhibit, an investment committee, or a file the user will keep updating. Follow the whole skill, including formulas-over-hardcodes, cell comments, statistics blocks, and the mandatory verification in `xlsx-author`.

**The two artifacts follow two different formatting conventions, and both are right.** the house formatting policy arbitrates: the Markdown snapshot is a **document table** — no vertical rules, header fill `#1F3A5F` with white bold text, zebra white/`#F4F7FA`, thin `#E5E9EF` horizontal grid. The workbook is a **spreadsheet table** — borders are mandatory and carry meaning, header fill `#1F4E79`. Section 1's visual conventions below describe the workbook; do not carry its borders into a document, and do not strip a workbook of them because a document does without. In **both** media, numbers are right-aligned and text is left-aligned.

Default to the workbook when the request names a deliverable ("建个模型", "出个表格文件", "做成 Excel"), when the comps feed a DCF/LBO, or when the user will maintain it. Default to the snapshot when the request reads as a question rather than an order. Ask only if genuinely ambiguous — and if you guess, state the choice and offer the other ("需要我导成 Excel 吗?").

A snapshot that later needs to become a workbook is cheap to upgrade; a workbook nobody asked for wastes the user's time and yours.

### Provenance and citation — which vehicle goes with which artifact

Both artifacts carry provenance; they carry it differently.

**Tags.** Five, the Chinese forms in a Chinese deliverable and the English aliases `[Reported] [Est.] [Consensus] [Inferred] [Media]` in an English one, never mixed: `[披露]` disclosed or on record · `[测算]` computed or assumed here · `[预期]` a named third party's estimate · `[推断]` our analytical read · `[媒体]` an uncorroborated media report. **A comps table is always in the chips-required category** — it puts filed actuals, our recomputed ratios, and forward estimates in adjacent columns, which is exactly the case a chip exists for. Chip every value in the snapshot table, and in the workbook let the font-colour convention (blue = hardcoded input, black = formula) carry the same distinction, with `[预期]` / `[测算]` named in the column header or the cell comment where a column mixes them. A `[预期]` figure always names its provider. In the prose around the table, `[测算]`, `[推断]`, and `[媒体]` stay chipped even though `[披露]` and `[预期]` can ride on the citation.

**A figure that cannot be sourced is deleted, not flagged.** Where the table structurally needs the cell, write `n.d.` — never a plug, never a peer-median fill presented as the company's own number.

**Snapshot → `## 来源`.** That exact heading. One entry per distinct `[n]`; the count of distinct markers must equal the count of entries:

```
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

`一手|二手` is mandatory. A filing, an exchange announcement, or a 同花顺/Wind/sec-search field sourced from those is Primary — name the system and `Retrieved`, publication date may be absent. Anything relayed is Secondary and **must name what it relays**: `Secondary · Caixin · relaying IDC "China AI Market Tracker" · 2026-05-12 (published); retrieved 2026-07-25 · https://…`. A sector multiple that resolves only to a news article quoting a research report is Secondary, and the note says the underlying report was not obtained.

**Workbook → cell comments.** Every hardcoded input carries one, in this exact form:

```
Source: <System or Document>, <Date>, <Reference>, <URL>
```

e.g. `Source: 同花顺 iFinD 行情数据, retrieved 2026-07-25, [证券代码] 最新成交价` or `Source: FY2025 Annual Report, 2026-03-28, consolidated income statement "Revenue", https://…`. **A calculated cell carries no source comment — it carries a formula, which is its own provenance.** A calculated cell with a source comment is a hardcode in disguise, and the audit treats it as one. Assumption cells are the one extension: they use the same `Source:` line for the basis, plus the reasoning (see Section 6).

**Reference Material & Contextualization:**

When the user provides an example comps file or template, use it intelligently:

**DO use examples for:**
- Understanding structural hierarchy (how sections flow)
- Grasping the level of rigor expected (statistical depth, documentation standards)
- Learning principles (clear headers, transparent formulas, audit trails)

**DO NOT use examples for:**
- Exact reproduction of format or metrics
- Copying layout without considering context
- Applying the same visual style regardless of audience

**ALWAYS ask yourself first:**
1. **"Do you have a preferred format or should I adapt the template style?"**
2. **"Who is the audience?"** (Investment committee, board presentation, quick reference, detailed memo)
3. **"What's the key question?"** (Valuation, growth analysis, competitive positioning, efficiency)
4. **"What's the context?"** (M&A evaluation, investment decision, sector benchmarking, performance review)

**Adapt based on specifics:**
- **Industry context**: Big tech mega-caps need different metrics than emerging SaaS startups
- **Sector-specific needs**: Add relevant metrics early (e.g., cloud ARR, enterprise customers, developer ecosystem for tech)
- **Company familiarity**: Well-known companies may need less background, more focus on delta analysis
- **Decision type**: M&A requires different emphasis than ongoing portfolio monitoring

**Core principle:** Use template principles (clear structure, statistical rigor, transparent formulas) but vary execution based on context. The goal is institutional-quality analysis, not institutional-looking templates.

User-provided examples and explicit preferences always take precedence over defaults.

## Core Philosophy
**"Build the right structure first, then let the data tell the story."**

Start with headers that force strategic thinking about what matters, input clean data, build transparent formulas, and let statistics emerge automatically. A good comp should be immediately readable by someone who didn't build it.

---

## ⚠️ CRITICAL: Formulas Over Hardcodes + Step-by-Step Verification

**Applies to workbook mode.** In quick-snapshot mode there is no file to build, so skip the openpyxl and recalc mechanics below — but keep the sourcing, 口径, and outlier rules, and still show your numbers before drawing conclusions from them.

**Environment:**
- Build the workbook with Python/openpyxl following the `xlsx-author` skill conventions. Write `cell.value = "=E7/C7"` (formula string), then run the recalc script (`../xlsx-author/scripts/recalc.py`, relative to this skill's directory) before delivery. If it reports `recalc_unavailable`, follow the mandatory substitute verification in `xlsx-author` — a static lint is not a pass.

**Formulas, not hardcodes:**
- Every derived value (margin, multiple, statistic) MUST be an Excel formula referencing input cells — never a pre-computed number pasted in
- When using Python/openpyxl to build the sheet: write `cell.value = "=E7/C7"` (formula string), NOT `cell.value = 0.687` (computed result)
- The only hardcoded values should be raw input data (revenue, EBITDA, share price, etc.) — and every one of those gets a cell comment with its source
- Why: the model must update automatically when an input changes. A hardcoded margin is a silent bug waiting to happen.

**Show your work as you go — do not stop to ask permission:**

Build end to end and deliver the workbook. Surface each stage in the running
message as you complete it, so a reviewer can follow how the numbers were
reached and challenge them on the finished model:

- After setting up the structure → the header layout
- After entering raw inputs → the input block, with each source and 报告期 named
- After building operating metrics → the calculated margins, sanity-checked
- After building valuation multiples → the multiples, before the statistics rows

- **Do not wait for a reply between stages.** The review gate is at the end,
  between the finished workbook and its use — not between the request and the
  build (the human-review guardrail). Judged inputs go into the
  assumptions block flagged `待确认` with the alternative considered, so the
  reviewer overturns them in one cell.
- The early-error worry is already handled by the formulas-over-hardcodes rule
  above: a model that flexes makes a wrong assumption a one-cell edit rather
  than a downstream rebuild. Structure solves it; asking does not.
- **Ask only when the subject itself is missing** — the template structure is
  genuinely unreadable, an entity resolves to several, a required statement is
  absent from the file. A value you could reasonably pick is never a reason to
  stop; a missing input blocks its own line, not the deliverable.

---

## Section 1: Document Structure & Setup

### Header Block (Rows 1-3)
```
Row 1: [ANALYSIS TITLE] - COMPARABLE COMPANY ANALYSIS
Row 2: [List of Companies with Tickers] • [Company 1 (TICK1)] • [Company 2 (TICK2)] • [Company 3 (TICK3)]
Row 3: Period [Period] | Retrieved [date] | All figures in [USD Millions/Billions] except per-share amounts and ratios
```

`Period` and `Retrieved` are two different facts and both belong on Row 3: `Period` names the period the data describes, `Retrieved` names when we pulled it. Collapsing them into one date is a real error, not a shorthand — a Q4 2024 comp pulled today is not "as of Q4 2024". Where a figure depends on the time of day (a live quote, a session's move), `Retrieved` carries time and session.

**Why this matters:** Establishes context immediately. Anyone opening this file knows what they're looking at, when it was created, and how to interpret the numbers.

### Visual Convention Standards (OPTIONAL - User preferences and uploaded templates always override)

**IMPORTANT: These are suggested defaults only. Always prioritize:**
1. User's explicit formatting preferences
2. Formatting from any uploaded template files
3. Company/team style guides
4. These defaults (only if no other guidance provided)

**Suggested Font & Typography:**
- **Font family**: Times New Roman (professional, readable, industry standard)
- **Font size**: 11pt for data cells, 12pt for headers
- **Bold text**: Section headers, company names, statistic labels

**Default Color & Shading — Professional Blue/Grey Palette (minimal is better):**
- **Keep it restrained** — only blues and greys. Do NOT introduce greens, oranges, reds, or multiple accent colors. A clean comps sheet uses 3-4 colors total.
- **Section headers** (e.g., "OPERATING STATISTICS & FINANCIAL METRICS"):
  - Dark blue background (`#1F4E79`)
  - White bold text
  - Full row shading across all columns
- **Column headers** (e.g., "Company", "Revenue", "Margin"):
  - Light blue background (`#D9E1F2`)
  - Black bold text
- **Data rows**:
  - White background for company data
  - Font colour carries the cell's nature, and audits check all four: blue `#0000FF` hardcoded input · black formula · green `#008000` link to another sheet · purple `#800080` same-sheet link with no calculation (`=B9`)
- **Statistics rows** (Maximum, 75th Percentile, etc.):
  - Light grey background (`#F2F2F2`)
  - Black text, left-aligned labels
- **That's the whole palette**: dark blue + light blue + light grey + white. Nothing else unless the user's template says otherwise.

**Suggested Formatting Conventions:**
- **Decimal precision**:
  - Percentages: 1 decimal (12.3%)
  - Multiples: 1 decimal (13.5x)
  - Dollar amounts: No decimals, thousands separator (69,632)
  - Margins shown as percentages: 1 decimal (68.7%)
- **Borders (workbook only)**: borders are mandatory in a spreadsheet and carry meaning — 1.5pt above section headers, 1.0pt under subtotals, 0.5pt interior grid, double rule under grand totals, and a thin vertical rule between the last historical and the first projected column. A comps sheet without them is not client-ready. The Markdown snapshot is the opposite medium and takes **no vertical rules** at all.
- **Alignment**: numbers right-aligned, text left-aligned, headers aligned with their column's content — in both media. Centring numeric columns is retired: it defeats digit alignment, which is the whole reason numbers are right-aligned in the first place.
- **Cell dimensions**: All column widths should be uniform/even, all row heights should be consistent (creates clean, professional grid)

**Note:** If the user provides a template file or specifies different formatting, use that instead.

---

## Section 2: Operating Statistics & Financial Metrics

### Core Columns (Start with these)
1. **Company** - Names with consistent formatting
2. **Revenue** - Size metric (can be LTM, quarterly, or annual depending on context)
3. **Revenue Growth** - Year-over-year percentage change
4. **Gross Profit** - Revenue minus cost of goods sold
5. **Gross Margin** - GP/Revenue (fundamental profitability)
6. **EBITDA** - Earnings before interest, tax, depreciation, amortization
7. **EBITDA Margin** - EBITDA/Revenue (operating efficiency)

### Optional Additions (Choose based on industry/purpose)
- **Quarterly vs LTM** - Include both if seasonality matters
- **Free Cash Flow** - For capital-intensive or SaaS businesses
- **FCF Margin** - FCF/Revenue (cash generation efficiency)
- **Net Income** - For mature, profitable companies
- **Operating Income** - For businesses with varying D&A
- **CapEx metrics** - For asset-heavy industries
- **Rule of 40** - Specifically for SaaS (Growth % + Margin %)
- **FCF Conversion** - For quality of earnings analysis (advanced)

### Formula Examples (Using Row 7 as example)
```excel
// Core ratios - these are always calculated
Gross Margin (F7): =E7/C7
EBITDA Margin (H7): =G7/C7

// Optional ratios - include if relevant
FCF Margin: =[FCF]/[Revenue]
Net Margin: =[Net Income]/[Revenue]
Rule of 40: =[Growth %]+[FCF Margin %]
```

**Golden Rule:** Every ratio should be [Something] / [Revenue] or [Something] / [Something from this sheet]. Keep it simple.

### When the data source already publishes the ratio

同花顺 and similar providers return 毛利率 / 销售净利率 / ROE / P/E directly. "Formulas over hardcodes" does not mean recomputing everything — it means no *silently* pasted derived numbers. Decide per ratio:

- **Recompute as a formula** when both the numerator and denominator are already inputs on the sheet. The formula documents the definition and updates when an input changes.
- **Take the published value as a sourced input** (blue font + cell comment) when its definition depends on data you did not pull — EBITDA-based multiples, ROE needing average equity, TTM figures spanning periods your inputs don't cover. Recomputing from partial data produces a number that looks authoritative and is wrong.

**When both exist and they disagree, that is a definitional difference, not an error — surface it.** The most common in A-share data: 销售净利率 uses total net profit (including minority interest) while a 归母净利润 / 营业收入 formula gives the parent-company margin; the two differ by the minority stake (e.g. 50.5% vs 48.8%). Show both columns side by side, label each with its 口径, and explain the gap in the notes. Do not pick whichever is more convenient, and never present one as if it were the other.

Apply the same rule across the peer set: if one company's ratio is published and another's is recomputed, the column is not comparable.

### Statistics Block (After company data)

**CRITICAL: Add statistics formulas for all comparable metrics (ratios, margins, growth rates, multiples).**

```
[Leave one blank row for visual separation]
- Maximum: =MAX(B7:B9)
- 75th Percentile: =QUARTILE(B7:B9,3)
- Median: =MEDIAN(B7:B9)
- 25th Percentile: =QUARTILE(B7:B9,1)
- Minimum: =MIN(B7:B9)
```

**Columns that NEED statistics (comparable metrics):**
- Revenue Growth %, Gross Margin %, EBITDA Margin %, EPS
- EV/Revenue, EV/EBITDA, P/E, Dividend Yield %, Beta

**Columns that DON'T need statistics (size metrics):**
- Revenue, EBITDA, Net Income (absolute size varies by company scale)
- Market Cap, Enterprise Value (not comparable across different-sized companies)

**Note:** Add one blank row between company data and statistics rows for visual separation. Do NOT add a "SECTOR STATISTICS" or "VALUATION STATISTICS" header row.

**Why quartiles matter:** They show distribution, not just average. A 75th percentile multiple tells you what "premium" companies trade at.

### Outliers in the statistics block

A single distressed or hyper-growth name distorts every percentile. When a value is an outlier — beyond ~2x the peer median, or driven by a collapsed/negative denominator (a P/E of 58x because earnings fell 67%, not because the market pays a premium) — do all three:

1. **Keep the company in the table.** Excluding it silently is worse than showing it.
2. **Report both stat sets** — the full-sample rows, plus a clearly labelled "剔除 [公司] 后" / "ex-[company]" row for the affected metrics. The reader needs to know how much of the median depends on one name.
3. **Say why in the notes** — name the metric, the driver (denominator effect, one-time item, different fiscal period), and which of the two stat sets you would rely on.

Never quietly drop a company from a range formula: a `MEDIAN(B7:B10)` that skips B9 with no explanation is indistinguishable from an off-by-one bug during audit.

---

## Section 3: Valuation Multiples & Investment Metrics

### Core Valuation Columns (Start with these)
1. **Company** - Same order as operating section
2. **Market Cap** - Current market valuation
3. **Enterprise Value** - Market Cap ± Net Debt/Cash
4. **EV/Revenue** - How much market pays per dollar of sales
5. **EV/EBITDA** - How much market pays per dollar of earnings
6. **P/E Ratio** - Price relative to net earnings

### Optional Valuation Metrics (Choose based on context)
- **FCF Yield** - FCF/Market Cap (for cash-focused analysis)
- **PEG Ratio** - P/E/Growth Rate (for growth companies)
- **Price/Book** - Market value vs. book value (for asset-heavy businesses)
- **ROE/ROA** - Return metrics (for profitability comparison)
- **Revenue/EBITDA CAGR** - Historical growth rates (for trend analysis)
- **Asset Turnover** - Revenue/Assets (for operational efficiency)
- **Debt/Equity** - Leverage (for capital structure analysis)

**Key Principle:** Include 3-5 core multiples that matter for your industry. Don't include every possible metric just because you can.

### Formula Examples
```excel
// Core multiples - always include these
EV/Revenue: =[Enterprise Value]/[LTM Revenue]
EV/EBITDA: =[Enterprise Value]/[LTM EBITDA]
P/E Ratio: =[Market Cap]/[Net Income]

// Optional multiples - include if data available
FCF Yield: =[LTM FCF]/[Market Cap]
PEG Ratio: =[P/E]/[Growth Rate %]
```

### Cross-Reference Rule
**CRITICAL:** Valuation multiples MUST reference the operating metrics section. Never input the same raw data twice. If revenue is in C7, then EV/Revenue formula should reference C7.

### Statistics Block
Same structure as operating section: Max, 75th, Median, 25th, Min for every metric. Add one blank row for visual separation between company data and statistics. Do NOT add a "VALUATION STATISTICS" header row.

---

## Section 4: Notes & Methodology Documentation

### Required Components

**Data Sources & Quality:**
- Where did the data come from? (同花顺 MCP, Wind cross-check, SEC filings MCP, SEC EDGAR)
- What period does it cover? (Q4 2024, audited figures)
- How was it verified? (Cross-checked against 10-K/10-Q)
- Note: Prioritize MCP data sources (同花顺 primary, Wind cross-check on headline financials, SEC filings) for better accuracy and traceability

**Key Definitions:**
- EBITDA calculation method (Gross Profit + D&A, or Operating Income + D&A)
- Free Cash Flow formula (Operating CF - CapEx)
- Special metrics explained (Rule of 40, FCF Conversion)
- Time period definitions (LTM, CAGR calculation periods)

**Valuation Methodology:**
- How was Enterprise Value calculated? (Market Cap + Net Debt)
- What growth rates were used? (Historical CAGR, forward estimates)
- Any adjustments made? (One-time items excluded, normalized margins)

**Analysis Framework:**
- What's the investment thesis? (Cloud/SaaS efficiency)
- What metrics matter most? (Cash generation, capital efficiency)
- How should readers interpret the statistics? (Quartiles provide context)

### The coverage block — `## 覆盖范围与局限`

Both artifacts close with one (in the workbook it is the top of the Notes sheet), under that exact heading, and it is written even when every name resolved cleanly. In a comps table a silent gap is the most dangerous kind: a median computed over the six names whose data we happened to get reads exactly like a median over the peer set.

Every line takes one of three states, verbatim: `有记录` / `检索范围内未发现` / `源不可用`.

```
## 覆盖范围与局限
Retrieved: [timestamp] · Peer set: [names, and the basis on which they were selected]

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| Financials for [names] | 有记录 | 同花顺 (Wind cross-checked) / sec-search / 10-K | [date] |
| Financials for [name] | 源不可用 — excluded from the statistics rows | [system, why] | [date] |
| Consensus (NTM revenue, EBITDA, EPS) | 有记录 for [n of N] names / 检索范围内未发现 | [named provider] | [date] |
| [Metric] for [name] | 检索范围内未发现 — shown as n.d. | — | [date] |

本次未能覆盖: [sources that failed, and which metrics they would have filled]
口径 (basis) as applied: [see below]
```

**口径 discipline is a coverage concern, so state it here rather than burying it in a footnote.** Spell out, for this comp:

- **归母 vs 全口径** — whether each margin and ratio is on the parent-company (归母净利润) basis or the total-net-profit basis including minority interest, and which columns are which. Where both a published and a recomputed value exist and they disagree, both are shown side by side, each labelled with its 口径, with the gap explained. Never average across the two, and never present one as if it were the other.
- **TTM vs 年报 vs quarterly** — which period each column covers, and any name whose fiscal year end differs from the rest.
- **Published vs computed ratios** — which ratios came from the provider as sourced inputs and which we recomputed as formulas. A column that mixes the two across the peer set is not comparable, and that has to be said, not just avoided.
- **What the statistics rows were computed over** — the full sample, and any clearly labelled ex-[company] set, with the count for each. A name dropped for unavailable data changes the N and must be named.

"检索范围内未发现" is a statement about our retrieval, never rendered as "the company does not disclose this".

---

## Section 5: Choosing the Right Metrics (Decision Framework)

### Start with "What question am I answering?"

**"Which company is undervalued?"**
→ Focus on: EV/Revenue, EV/EBITDA, P/E, Market Cap
→ Skip: Operational details, growth metrics

**"Which company is most efficient?"**
→ Focus on: Gross Margin, EBITDA Margin, FCF Margin, Asset Turnover
→ Skip: Size metrics, absolute dollar amounts

**"Which company is growing fastest?"**
→ Focus on: Revenue Growth %, EBITDA CAGR, User/Customer Growth
→ Skip: Margin metrics, leverage ratios

**"Which is the best cash generator?"**
→ Focus on: FCF, FCF Margin, FCF Conversion, CapEx intensity
→ Skip: EBITDA, P/E ratios

### Industry-Specific Metric Selection

**Software/SaaS:**
Must have: Revenue Growth, Gross Margin, Rule of 40
Optional: ARR, Net Dollar Retention, CAC Payback
Skip: Asset Turnover, Inventory metrics

**Manufacturing/Industrials:**
Must have: EBITDA Margin, Asset Turnover, CapEx/Revenue
Optional: ROA, Inventory Turns, Backlog
Skip: Rule of 40, SaaS metrics

**Financial Services:**
Must have: ROE, ROA, Efficiency Ratio, P/E
Optional: Net Interest Margin, Loan Loss Reserves
Skip: Gross Margin, EBITDA (not meaningful for banks)

**Retail/E-commerce:**
Must have: Revenue Growth, Gross Margin, Inventory Turnover
Optional: Same-Store Sales, Customer Acquisition Cost
Skip: Heavy R&D or CapEx metrics

### The "5-10 Rule"

**5 operating metrics** - Revenue, Growth, 2-3 margins/efficiency metrics
**5 valuation metrics** - Market Cap, EV, 3 multiples
**= 10 total columns** - Enough to tell the story, not so many you lose the thread

If you have more than 15 metrics, you're probably including noise. Edit ruthlessly.

---

## Section 6: Best Practices & Quality Checks

### Before You Start
1. **Define the peer group** - Companies must be truly comparable (similar business model, scale, geography)
2. **Choose the right period** - LTM smooths seasonality; quarterly shows trends
3. **Standardize units upfront** - Millions vs. billions decision affects everything
4. **Map data sources** - Know where each number comes from

### As You Build
1. **Input all raw data first** - Complete the blue text before writing formulas
2. **Add cell comments to ALL hard-coded inputs** - Right-click cell → Insert Comment → Document source OR assumption

   **For sourced data, use the schema — `Source: <System or Document>, <Date>, <Reference>, <URL>`:**
   - Example: "Source: 同花顺 iFinD 海外股票行情, retrieved 2024-10-02, MSFT 最新成交价"
   - Example: "Source: Q4 2024 10-K filing, 2024-07-30, page 42, line item 'Total Revenue', https://…"
   - Example: "Source: 同花顺 iFinD 一致预期, retrieved 2024-10-02, MSFT FY25E EPS (n analysts) — [预期]"
   - **Include hyperlinks when possible**: Right-click cell → Link → paste URL to SEC filing, data source, or report

   **For assumptions, explain the reasoning** (an assumption is an `[测算]` whose input is a judgement, and it also belongs in the notes):
   - Example: "Assumed 15% EBITDA margin based on peer median, company does not disclose"
   - Example: "Estimated Enterprise Value as Market Cap + $50M net debt (from Q3 balance sheet, Q4 not yet available)"
   - Example: "Forward P/E based on street consensus EPS of $3.45 (average of 12 analyst estimates)"

   **Calculated cells get no source comment** — the formula is the provenance. A calculated cell carrying a `Source:` line is a hardcode in disguise.

   **Why this matters**: Enables audit trails, data verification, assumption transparency, and future updates
3. **Build formulas row by row** - Test each calculation before moving on
4. **Use absolute references for headers** - $C$6 locks the header row
5. **Format consistently** - Percentages as percentages, not decimals
6. **Add conditional formatting** - Highlight outliers automatically

### Sanity Checks
- **Margin test**: Gross margin > EBITDA margin > Net margin (always true by definition)
- **Multiple reasonableness**: 
  - EV/Revenue: typically 0.5-20x (varies widely by industry)
  - EV/EBITDA: typically 8-25x (fairly consistent across industries)
  - P/E: typically 10-50x (depends on growth rate)
- **Growth-multiple correlation**: Higher growth usually means higher multiples
- **Size-efficiency trade-off**: Larger companies often have better margins (scale benefits)

### Common Mistakes to Avoid
❌ Mixing market cap and enterprise value in formulas
❌ Using different time periods for numerator and denominator (LTM vs quarterly)
❌ Hardcoding numbers into formulas instead of cell references
❌ **Hard-coded inputs without cell comments citing the source OR explaining the assumption**
❌ Missing hyperlinks to SEC filings or data sources when available
❌ Including too many metrics without clear purpose
❌ Including non-comparable companies (different business models)
❌ Using outdated data without disclosure
❌ Calculating averages of percentages incorrectly (should be median)

---

## Section 6: Advanced Features

### Dynamic Headers
For columns showing calculations, use clear unit labels:
```
Revenue Growth (YoY) % | EBITDA Margin | FCF Margin | Rule of 40
```

### Quartile Analysis Benefits
Instead of just mean/median, quartiles show:
- **75th percentile** = "Premium" companies trade here
- **Median** = Typical market valuation
- **25th percentile** = "Discount" territory

This helps answer: "Is our target company trading rich or cheap vs. peers?"

### Industry-Specific Modifications

**Software/SaaS:**
- Add: ARR, Net Dollar Retention, CAC Payback Period
- Emphasize: Rule of 40, FCF margins, gross margins >70%

**Healthcare:**
- Add: R&D/Revenue, Pipeline value, Regulatory status
- Emphasize: EBITDA margins, growth rates, reimbursement risk

**Industrials:**
- Add: Backlog, Order book trends, Geographic mix
- Emphasize: ROIC, asset turnover, cyclical adjustments

**Consumer:**
- Add: Same-store sales, Customer acquisition cost, Brand value
- Emphasize: Revenue growth, gross margins, inventory turns

---

## Section 7: Workflow & Practical Tips

### Step-by-Step Process
1. **Set up structure** (30 minutes)
   - Create all headers
   - Format cells (blue for inputs, black for formulas)
   - Lock in units and date references

2. **Gather data** (60-90 minutes)
   - Pull from primary sources: 同花顺 (`hexin-stock.get_stock_financials` A shares / `hexin-global-stock.global_stock_financial` HK-US) first, `sec-search.sec_full_text_search` for US filings, Wind only as a cross-check on the headline lines; otherwise SEC EDGAR
   - Input all raw numbers in blue
   - Document sources in notes section

3. **Build formulas** (30 minutes)
   - Start with simple ratios (margins)
   - Progress to multiples (EV/Revenue)
   - Add cross-checks (do margins make sense?)

4. **Add statistics** (15 minutes)
   - Copy formula structure for all columns
   - Verify ranges are correct (B7:B9, not B7:B10)
   - Check quartile logic

5. **Quality control** (30 minutes)
   - Run sanity checks
   - Verify formula references
   - Check for #DIV/0! or #REF! errors
   - Compare against known benchmarks

6. **Documentation** (15 minutes)
   - Complete notes section
   - Add data sources
   - Define methodologies
   - Date-stamp the analysis

### Pro Tips
- **Save templates**: Build once, reuse forever
- **Color-code outliers**: Conditional formatting for values >2 standard deviations
- **Link to source files**: Hyperlink to SEC filings or MCP data sources
- **Version control**: Save as "Comps_v1_2024-12-15" with clear dating
- **Collaborative reviews**: Have someone else check your formulas

### Excel Formatting Checklist (Optional - adapt to user preferences)
- [ ] Font set to user's preferred style (default: Times New Roman, 11pt data, 12pt headers)
- [ ] Section headers formatted per user's template (default: dark blue #1F4E79 with white bold text)
- [ ] Column headers formatted per user's template (default: light blue #D9E1F2 with black bold text)
- [ ] Statistics rows formatted per user's template (default: light gray #F2F2F2)
- [ ] **Borders applied and meaningful** (1.5pt above section headers, 1.0pt under subtotals, 0.5pt interior grid, double rule under grand totals) — this is the workbook convention; a Markdown snapshot takes no vertical rules instead
- [ ] **Column widths set to uniform/even width** (creates clean, professional appearance)
- [ ] **Row heights set to consistent height** (typically 20-25pt for data rows)
- [ ] Numbers formatted with proper decimal precision and thousands separators
- [ ] **Numbers right-aligned, text left-aligned**, headers aligned with their column's content
- [ ] **One blank row for separation between company data and statistics rows**
- [ ] **No separate "SECTOR STATISTICS" or "VALUATION STATISTICS" header rows**
- [ ] **Every hard-coded input cell has a `Source: <System or Document>, <Date>, <Reference>, <URL>` comment, or an assumption explanation; no calculated cell has one**
- [ ] **Hyperlinks added to cells where applicable** (SEC filings, data provider pages, reports)

---

## Section 8: Example Template Layout

**Simple Version (Start here):**
```
┌─────────────────────────────────────────────────────────────┐
│ TECHNOLOGY - COMPARABLE COMPANY ANALYSIS                    │
│ Microsoft • Alphabet • Amazon                               │
│ Period Q4 2024 | Retrieved [date] | USD Millions            │
├─────────────────────────────────────────────────────────────┤
│ OPERATING METRICS                                           │
├──────────┬─────────┬─────────┬──────────┬──────────────────┤
│ Company  │ Revenue │ Growth  │ Gross    │ EBITDA  │ EBITDA │
│          │ (LTM)   │ (YoY)   │ Margin   │ (LTM)   │ Margin │
├──────────┼─────────┼─────────┼──────────┼─────────┼────────┤
│ MSFT     │ 261,400 │ 12.3%   │ 68.7%    │ 205,100 │ 78.4%  │
│ GOOGL    │ 349,800 │ 11.8%   │ 57.9%    │ 239,300 │ 68.4%  │
│ AMZN     │ 638,100 │ 10.5%   │ 47.3%    │ 152,600 │ 23.9%  │
│          │         │         │          │         │        │ [blank row]
│ Median   │ =MEDIAN │ =MEDIAN │ =MEDIAN  │ =MEDIAN │=MEDIAN │
│ 75th %   │ =QUART  │ =QUART  │ =QUART   │ =QUART  │=QUART  │
│ 25th %   │ =QUART  │ =QUART  │ =QUART   │ =QUART  │=QUART  │
├─────────────────────────────────────────────────────────────┤
│ VALUATION MULTIPLES                                         │
├──────────┬──────────┬──────────┬──────────┬────────────────┤
│ Company  │ Mkt Cap  │ EV       │ EV/Rev   │ EV/EBITDA │ P/E│
├──────────┼──────────┼──────────┼──────────┼───────────┼────┤
│ MSFT     │3,550,000 │3,530,000 │ 13.5x    │ 17.2x     │36.0│
│ GOOGL    │2,030,000 │1,960,000 │  5.6x    │  8.2x     │24.5│
│ AMZN     │2,226,000 │2,320,000 │  3.6x    │ 15.2x     │58.3│
│          │          │          │          │           │    │ [blank row]
│ Median   │ =MEDIAN  │ =MEDIAN  │ =MEDIAN  │ =MEDIAN   │=MED│
│ 75th %   │ =QUART   │ =QUART   │ =QUART   │ =QUART    │=QRT│
│ 25th %   │ =QUART   │ =QUART   │ =QUART   │ =QUART    │=QRT│
└──────────┴──────────┴──────────┴──────────┴───────────┴────┘
```

**Add complexity only when needed:**
- Include quarterly AND LTM if seasonality matters
- Add FCF metrics if cash generation is key story
- Include industry-specific metrics (Rule of 40 for SaaS, etc.)
- Add more statistics rows if you have >5 companies

---

## Section 9: Industry-Specific Additions (Optional)

Only add these if they're critical to your analysis. Most comps work fine with just core metrics.

**Software/SaaS:**
Add if relevant: ARR, Net Dollar Retention, Rule of 40

**Financial Services:**
Add if relevant: ROE, Net Interest Margin, Efficiency Ratio

**E-commerce:**
Add if relevant: GMV, Take Rate, Active Buyers

**Healthcare:**
Add if relevant: R&D/Revenue, Pipeline Value, Patent Timeline

**Manufacturing:**
Add if relevant: Asset Turnover, Inventory Turns, Backlog

---

## Section 10: Red Flags & Warning Signs

Rank these on the single severity scale, defined by what the reader has to do: **🔴 High** — resolve before the comp is used for a decision · **🟡 Medium** — note in the methodology and monitor · **⚪ Low / FYI** — awareness only. Severity attaches to a finding, not to a company, and if everything is 🔴 nothing is.

### Data Quality Issues
🔴 High — Inconsistent time periods (mixing quarterly and annual): the multiples are not comparable until this is fixed
🔴 High — Missing data filled rather than shown as `n.d.`, or dropped from a range formula with no explanation
🟡 Medium — Missing data, disclosed as `n.d.` and carried into the coverage block
🟡 Medium — Significant differences between data sources (>10% variance): show both and name the definitional cause

### Valuation Red Flags
🔴 High — Negative EBITDA companies being valued on EBITDA multiples (use revenue multiples instead)
🟡 Medium — P/E ratios >100x without hypergrowth story: usually a collapsed denominator, so treat it as an outlier per the statistics rules
🟡 Medium — Margins that don't make sense for the industry: check the 口径 before concluding anything

### Comparability Issues
🟡 Medium — Different fiscal year ends (causes timing problems); label the exception in the coverage block
🟡 Medium — Mixing pure-play and conglomerates
🔴 High — Materially different business models labeled as "comps"

**When in doubt, exclude the company.** Better to have 3 perfect comps than 6 questionable ones.

---

## Section 11: Formulas Reference Guide

### Essential Excel Formulas
```excel
// Statistical Functions
=AVERAGE(range)          // Simple mean
=MEDIAN(range)           // Middle value
=QUARTILE(range, 1)      // 25th percentile
=QUARTILE(range, 3)      // 75th percentile
=MAX(range)              // Maximum value
=MIN(range)              // Minimum value
=STDEV.P(range)          // Standard deviation

// Financial Calculations
=B7/C7                   // Simple ratio (Margin)
=SUM(B7:B9)/3            // Average of multiple companies
=IF(B7>0, C7/B7, "N/A")  // Conditional calculation
=IFERROR(C7/D7, 0)       // Handle divide by zero

// Cross-Sheet References
='Sheet1'!B7             // Reference another sheet
=VLOOKUP(A7, Table1, 2)  // Lookup from data table
=INDEX(MATCH())          // Advanced lookup

// Formatting
=TEXT(B7, "0.0%")        // Format as percentage
=TEXT(C7, "#,##0")       // Thousands separator
```

### Common Ratio Formulas
```excel
Gross Margin = Gross Profit / Revenue
EBITDA Margin = EBITDA / Revenue
FCF Margin = Free Cash Flow / Revenue
FCF Conversion = FCF / Operating Cash Flow
ROE = Net Income / Shareholders' Equity
ROA = Net Income / Total Assets
Asset Turnover = Revenue / Total Assets
Debt/Equity = Total Debt / Shareholders' Equity
```

---

## Key Principles Summary

1. **Structure drives insight** - Right headers force right thinking
2. **Less is more** - 5-10 metrics that matter beat 20 that don't
3. **Choose metrics for your question** - Valuation analysis ≠ efficiency analysis
4. **Statistics show patterns** - Median/quartiles reveal more than average
5. **Transparency beats complexity** - Simple formulas everyone understands
6. **Comparability is king** - Better to exclude than force a bad comp
7. **Document your choices** - Explain which metrics and why in notes section

---

## Output Checklist

**These two are checked mechanically by `evals/checks/text.py` and a real run
failed both, so they lead the list rather than sitting mid-document:**

- [ ] **Every value in the comps table carries a provenance chip.** A comps table
      is the canonical chips-required case — filed actuals, our recomputed ratios
      and forward estimates sit in adjacent columns. A table with zero chips fails,
      and 口径 in the column header (`PE(归母)` vs `PE(全口径)`) is necessary but
      does not substitute for the chip.
- [ ] **The delivery note states whether the formulas were evaluated.** If
      `recalc.py` returned `recalc_unavailable`, say so in those words, say that it
      is not a pass, and list the substitute checks you ran. Silence about it reads
      as "verified" to whoever opens the file.

Before delivering a comp analysis, verify:
- [ ] All companies are truly comparable
- [ ] Data is from consistent time periods
- [ ] Units are clearly labeled (millions/billions)
- [ ] Formulas reference cells, not hardcoded values
- [ ] **Every hard-coded input cell has a `Source: <System or Document>, <Date>, <Reference>, <URL>` comment, or a clear assumption explanation — and no calculated cell has one**
- [ ] **Hyperlinks added where relevant** (SEC EDGAR filings, MCP data sources, research reports)
- [ ] **Snapshot mode: `## 来源` with `〔一手|二手〕` on every entry, each Secondary naming what it relays, distinct `[n]` markers equal to the entry count**
- [ ] **`## 覆盖范围与局限` present, with the 口径 statement and the three states used verbatim**
- [ ] **Nothing unsourceable published — an unavailable figure is `n.d.`, never a plug**
- [ ] Statistics include at least 5 metrics (Max, 75th, Med, 25th, Min)
- [ ] Notes section documents sources and methodology
- [ ] Visual formatting follows conventions (blue = input, black = formula, green = cross-sheet link, purple = same-sheet link)
- [ ] Sanity checks pass (margins logical, multiples reasonable)
- [ ] `Period` and `Retrieved` both stamped, and distinct
- [ ] Formula auditing shows no errors (#DIV/0!, #REF!, #N/A)

---

## Continuous Improvement

After completing a comp analysis, ask:
1. Did the statistics reveal unexpected insights?
2. Were there any data gaps that limited analysis?
3. Did stakeholders ask for metrics you didn't include?
4. How long did it take vs. how long should it take?
5. What would make this more useful next time?

The best comp analyses evolve with each iteration. Save templates, learn from feedback, and refine the structure based on what decision-makers actually use.
