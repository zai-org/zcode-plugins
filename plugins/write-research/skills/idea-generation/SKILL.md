---
name: idea-generation
description: Systematic stock screening and investment idea sourcing. Combines quantitative screens, thematic research, and pattern recognition to surface new long and short ideas. Use when looking for new ideas, running screens, or conducting thematic sweeps. Triggers on "idea generation", "stock screen", "find ideas", "what looks interesting", "screen for", "new ideas", or "pitch me something".
---

# Idea Generation

## Workflow

### Step 1: Define Search Criteria

Ask the user for parameters:
- **Direction**: Long ideas, short ideas, or both
- **Market cap**: Large, mid, small, micro
- **Sector**: Specific sector or cross-sector
- **Style**: Value, growth, quality, special situation, event-driven
- **Geography**: US, international, global
- **Theme**: Any specific thematic angle (AI, reshoring, aging demographics, etc.)

### Step 2: Quantitative Screens

Run screens with the structured MCP sources first — 同花顺 fundamental/market data (`hexin-stock.search_stocks` for A shares, `hexin-global-stock` for HK/US screening), sec-search + web data for US names. Web search is the fallback, not the default; every screen value must carry its source.

Run screens based on the style:

**Value Screen**
- P/E below sector median
- EV/EBITDA below historical average
- Free cash flow yield >5%
- Price/book below 1.5x
- Insider buying in last 90 days
- Dividend yield above market average

**Growth Screen**
- Revenue growth >15% YoY
- Earnings growth >20% YoY
- Revenue acceleration (growth rate increasing)
- Expanding margins
- High return on invested capital (>15%)
- Strong net retention (>110% for SaaS)

**Quality Screen**
- Consistent revenue growth (5+ years)
- Stable or expanding margins
- ROE >15%
- Low debt/equity
- High free cash flow conversion
- Insider ownership >5%

**Short Screen**
- Declining revenue or decelerating growth
- Margin compression
- Rising receivables / inventory vs. sales
- Insider selling
- Valuation premium to peers without justification
- High short interest with deteriorating fundamentals
- Accounting red flags (auditor changes, restatements)

**Special Situation Screen**
- Recent IPOs / SPACs with lockup expirations
- Spin-offs in last 12 months
- Companies emerging from restructuring
- Activist involvement
- Management changes at underperforming companies

### Step 3: Thematic Sweep

For thematic ideas, research the theme and identify beneficiaries:

1. Define the thesis (e.g., "AI infrastructure spending accelerates through 2026")
2. Map the value chain — who benefits directly vs. indirectly?
3. Identify pure-play vs. diversified exposure
4. Assess which names are already "priced in" vs. under-appreciated
5. Look for second-order beneficiaries that the market hasn't connected to the theme

### Step 4: Idea Presentation

For each idea that passes the screen, present:

**[Company Name] — [Long/Short] — [One-Line Thesis]**

| Metric | Value | vs. Peers |
|--------|-------|-----------|
| Market cap | | |
| EV/EBITDA (NTM) | | |
| P/E (NTM) | | |
| Revenue growth | | |
| EBITDA margin | | |
| FCF yield | | |

This table mixes classes at close range, so every cell carries a chip: `[披露]` for a filed or exchange figure, `[测算]` for anything we computed (an implied multiple, a peer-relative spread), `[预期]` with the provider named for NTM numbers. A metric that could not be sourced is `n.d.` — never a plugged value. Numbers right-aligned, text left-aligned.

**Thesis (3-5 bullets):**
- Why this is mispriced
- What the market is missing
- Catalyst to realize value

**Key Risks:**
- What would make this wrong

**Suggested Next Steps:**
- Build full model? Deep-dive diligence? Expert call?

### Step 5: Output

- Shortlist of 5-10 ideas with one-page summaries
- Screening criteria and methodology documented
- Comparison table across all ideas
- Prioritized list: which ideas to research first
- A `## 来源` section and a `## 覆盖范围与局限` block

Short-form is Markdown in-session; say so in a clause. If the user asks for a document, `report-render` builds the PDF — never hand-roll it with weasyprint, wkhtmltopdf, pandoc, or a bare reportlab script, because those do not emit `[n]` as PDF link annotations and the citations arrive unclickable. The idea comparison table on its own goes to `.xlsx` via `xlsx-author` as a **Class B** workbook (`来源` worksheet plus a `来源编号` column). 用户要 Word 时同样走 `report-render`（`DocxReport`，与 `Report` 同一套调用）——**要出 Word 就先载入 `report-render` 技能，再动手建**；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

**`## 来源` — that exact heading.** One entry per distinct `[n]`; the count of distinct markers must equal the count of entries:

```
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

A screening engine's own output or a filing line item is `Primary` (name the system and the retrieval date; publication date may be absent). Anything relayed is `Secondary` and **must name what it relays** — `Secondary · Caixin · relaying IDC "China AI Market Tracker" · 2026-05-12 (published); retrieved 2026-07-25`. A thematic sizing number that resolves only to a news article quoting a report is Secondary, and the write-up says the underlying report was not obtained.

**`## 覆盖范围与局限` — written even when the screen ran cleanly.** It is what keeps a screen from reading as a verdict on the universe:

```
## 覆盖范围与局限
Retrieved: [timestamp] · Universe: [market, cap band, sector as actually screened]

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| Screen criteria as executed | 有记录 — [the criteria the engine actually applied] | 同花顺 search_stocks | [date] |
| Criteria the engine could not filter on | [named, one per line, with how they were approximated] | — | [date] |
| Financials for shortlisted names | 有记录 for [n of N]; [names] not retrievable | 同花顺 / sec-search | [date] |
| Consensus (NTM revenue, EBITDA, EPS) | 有记录 for [n of N] names / 源不可用 | [named provider] | [date] |
| Ownership, short interest, coverage counts | 有记录 / 源不可用 | [system] | [date] |

本次未能覆盖: [sources that failed, and the criteria they would have carried]
```

"检索范围内未发现" means the engine returned nothing under this mandate — it is not a finding that no such name exists.

## Important Notes

- Screens surface candidates, not conclusions — every screen output needs fundamental work
- **Every supporting number in a thesis hook must be traceable** — the screen value, the multiple, the growth stat all carry a clickable source marker `[n]` (MCP/filing/named firm + date) jumping to `## 来源`. No unsourced "fact" props up an idea; if it can't be sourced, **delete it** (`n.d.` if a table cell needs the slot) — do not publish it with a caveat.
- **Provenance tags, five of them**: `[披露]` `[测算]` `[预期]` `[推断]` `[媒体]`, or the English aliases `[Reported] [Est.] [Consensus] [Inferred] [Media]` in an English write-up — one style per document, never mixed. In the comparison tables chip everything, because disclosed actuals, our derivations, and forward estimates sit side by side. In the flowing thesis and risk bullets the `[n]` citation carries `[披露]` and `[预期]` for you — but `[测算]`, `[推断]`, and `[媒体]` are chipped there too, always: a citation cannot tell the reader that a figure is our own derivation, that "the market is missing X" is our inference rather than a finding, or that an unconfirmed press report is not a record. A `[预期]` figure names its provider inline.
- The best ideas often come from intersections (e.g., quality company at value price due to temporary headwind)
- Avoid crowded trades — check ownership data, short interest, and how many analysts cover the name
- Contrarian ideas need a catalyst — being early without a catalyst is the same as being wrong
- Track idea hit rates over time — which screens and approaches produce the best ideas?
- Short ideas need higher conviction — timing is harder and risk is asymmetric
