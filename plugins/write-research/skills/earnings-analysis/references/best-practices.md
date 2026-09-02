# Best Practices, Examples, and Quality Guidelines

This document provides examples, tips for success, common mistakes to avoid, and comprehensive quality checklists.

## Example Headlines

### Good Earnings Update Headlines:
- "Nike Q2 FY24: DTC Strength Offsets Wholesale Weakness - Maintaining OW, PT $95"
- "Tesla Q3'24: Cybertruck Ramp Ahead of Plan - Raising Estimates, PT to $285"
- "LVMH Q4'24: Fashion & Leather Resilient, Wines Weak - In-Line, Reiterating Buy"
- "Apple Q1 FY24: Services Beat, iPhone Miss - Mixed Quarter, Lowering PT to $185"

### Bad Headlines (Avoid):
- "Nike Quarterly Update" (too generic, no takeaway)
- "Company Reports Earnings" (states obvious, no analysis)
- "Q3 Results Analysis" (no company name, no view)

## Tips for Success

1. **Speed matters**: Published 24-48hrs post-earnings, not days later

2. **Lead with conclusion**: Beat or miss? Up or down estimates?

3. **Quantify everything**: "Strong" means nothing, "$150M beat on $1.2B revenue" is clear

4. **Focus on drivers**: Don't just say "revenue beat", explain WHY

5. **Show the work**: Old estimates → New estimates with reasons

6. **Update price target if material**: If estimates change >5%, usually PT changes too

7. **Acknowledge the call**: Reference management commentary, don't just analyze the press release

8. **Compare to peers**: If similar companies reported, note relative performance

9. **Be concise**: This is NOT a comprehensive report, stay focused on quarterly results

10. **Chart the trends**: Quarterly progression charts are most valuable

## Common Mistakes to Avoid

❌ **Fabricating numbers**: NEVER invent a consensus figure, a "prior estimate," or a segment value to fill a gap. A blank cell with a coverage statement beats a made-up number. (See SKILL.md Requirement 0.)

❌ **Mislabeling data class**: Presenting your own calculation as if it were company-disclosed or Street consensus, or an inference as a finding. Chip every number `[Reported]` / `[Est.]` / `[Consensus]` / `[Inferred]` / `[Media]`.

❌ **Inconsistent tag style**: Mixing `(Est.)` and `[Est.]`, mixing English and Chinese tag forms in one document, or rendering tags as plain text in some places and colored chips in others. Define one chip helper, fixed colors, and a page-1 legend; use it everywhere.

❌ **Silent rendering failures, DOCX edition**: provenance tags painted as a background fill (white text on a pale green ships unreadable), `[n]` bookmarks emitted before `w:pPr` or with reused ids so no citation is clickable, no `w:titlePg` so there is no cover page, and Chinese runs with no `w:eastAsia` so Word substitutes the whole document's font. None of these raise, and none are visible to the process that wrote the file. **要出 Word 就先载入 `report-render` 技能，再动手建**——`DocxReport` 与 `Report` 同一套调用，机制记录在那个技能里。

❌ **Silent rendering failures**: A blank Chinese PDF (built-in CID font instead of an embedded TTF), Chinese wrapping early because `wordWrap='CJK'` is missing, `<b>` falling back to regular. None of these raise — build, render, and look. `report-render`'s `references/pitfalls.md` catalogues the rest.

❌ **Source notes overlapping charts**: Placing the chart `Source:` line with `ax.text()` at data coordinates so it collides with axis labels. Use a figure-level footnote with reserved margin.

❌ **Caption split from its figure**: A "Figure X" title left at a page bottom while the chart flows to the next page. Bind caption + image (+ source note) into one `KeepTogether` unit.

❌ **One-section-per-page forced breaks**: A `PageBreak()` before every heading — or scattered `CondPageBreak()` before figures — leaves pages half-empty by pushing "almost-fits" blocks wholesale to the next page. Let content flow; shrink a figure that almost fits rather than stranding whitespace. The only hard breaks are after the cover and before `## Sources`.

❌ **Orphan / whitespace pages**: Shipping a PDF with a half-empty page because a `KeepTogether` or `PageBreak` stranded one element. Render every page and fix before delivery.

❌ **Too comprehensive**: Don't write an initiation-length report for quarterly results

❌ **Missing beat/miss**: Lead with whether results beat or missed expectations

❌ **Not updating estimates**: Must provide updated forward estimates

❌ **Vague language**: "Strong performance" without quantification

❌ **Ignoring guidance**: If company guides, analyze it thoroughly

❌ **Too slow**: Publishing 5+ days after earnings loses relevance

❌ **Rehashing basics**: Don't spend 3 pages explaining what the company does

❌ **Missing price target update**: If estimates changed materially, PT should too

❌ **No investment impact**: Must connect results to thesis and rating

❌ **Missing citations**: Every number needs a source with clickable links

❌ **Silent absence**: A blank consensus cell, an unobtained transcript, or a source that timed out, left unmentioned. A reader cannot tell "we checked and found nothing" from "it never ran" — state both in `## Coverage and Limitations`.

❌ **Plain text URLs**: All URLs must be real clickable link annotations in the PDF, not plain text

## Comprehensive Quality Control Checklist

Before delivering earnings update, verify all items below.

### Data Integrity Checklist (check FIRST)

- [ ] Every number carries exactly one provenance chip: `[Reported]` / `[Est.]` / `[Consensus]` / `[Inferred]` / `[Media]`
- [ ] Tags rendered with ONE consistent style via a single helper — square brackets, fixed colors (Reported green `#1E8449` / Est. gold `#C9912A` / Consensus blue `#1155CC` / Inferred orange `#E67E22` / Media grey `#6B7280`), no mix of `(Est.)` and `[Est.]`, no mix of English and Chinese tag forms
- [ ] A legend on page 1 explains the chips that actually appear, and the clickable `[n]` source markers
- [ ] `[Est.]`, `[Inferred]`, and `[Media]` appear wherever they apply — these three are never optional
- [ ] NO fabricated values anywhere — no invented consensus, no fake "prior estimate," no plugged segment gaps
- [ ] Consensus shown ONLY for metrics actually sourced (usually total revenue + EPS); segment-level consensus cells left blank and accounted for in the coverage block
- [ ] Every `[Consensus]` value names its provider (同花顺 一致预期 via `hexin-stock.get_stock_financials` / LSEG / Visible Alpha) and its retrieval date
- [ ] Estimate-revision "old vs new" table shown ONLY if a real prior estimate exists; otherwise disclosed actuals only
- [ ] Conflicting disclosed figures (e.g. reported vs ex-item growth) both shown, not cherry-picked
- [ ] Numbers reconcile: prior-year × (1+YoY) ≈ current; segment pieces tie to total

### Content & Analysis Checklist

**Beat/Miss Analysis:**
- [ ] Beat/miss analysis leads the report
- [ ] Specific variances quantified (e.g., "beat by $120M or 3%")
- [ ] Explanation of WHY results differed from expectations
- [ ] Analysis of each key metric (revenue, EPS, margins, etc.)

**Metrics & Performance:**
- [ ] All key metrics discussed with YoY comparisons
- [ ] QoQ comparisons included where relevant
- [ ] Segment/geographic/product breakdowns provided
- [ ] Operating metrics analyzed (customers, ARPU, units, etc.)

**Guidance & Estimates:**
- [ ] Guidance changes analyzed and quantified (if provided)
- [ ] If no guidance, this is explicitly noted
- [ ] Updated estimates provided for current year
- [ ] Updated estimates provided for next year
- [ ] Old vs. new estimates clearly shown
- [ ] Explanation of what changed and why

**Valuation & Rating:**
- [ ] Price target updated (if warranted by results)
- [ ] If PT unchanged, explicitly maintained
- [ ] Valuation methodology explained
- [ ] Rating confirmed or changed with clear rationale
- [ ] Investment thesis assessed and updated if needed

### Format & Length Checklist

**Overall Structure:**
- [ ] Report is 8-12 pages (not shorter, not longer)
- [ ] Page 1 has earnings summary format
- [ ] Page 1 has "EARNINGS UPDATE" in title (NOT "Initiating Coverage")
- [ ] Event-driven title (e.g., "Strong Q3 Results...")

**Tables:**
- [ ] 1-3 summary tables included (NOT comprehensive tables)
- [ ] All tables have clear column headers
- [ ] All tables have header row shading
- [ ] All tables have source lines at bottom
- [ ] Estimates table shows old vs. new with change column

**Charts:**
- [ ] 8-12 charts embedded throughout document
- [ ] All charts have "Figure X - [Title]" caption above
- [ ] All charts have "Source: [Source]" line below
- [ ] Charts focus on quarterly trends
- [ ] Charts highlight changes (beat/miss, revisions)
- [ ] Charts use professional styling

### Citations & Sources Checklist (mandatory)

**Figure & Table Citations:**
- [ ] Every figure has specific source with document name and date
- [ ] Every table has specific source with document reference
- [ ] Source citations include page numbers or slide numbers where applicable
- [ ] Each figure and table states its source exactly once — in the figure or as a note, never both

**Beat/Miss Citations:**
- [ ] Beat/miss analysis cites consensus provider (同花顺 一致预期, LSEG, etc.)
- [ ] Consensus entry carries its retrieval time and session (pre-earnings close)
- [ ] Company reported results cited to earnings release or 10-Q

**Guidance Citations:**
- [ ] Current guidance cited to earnings call transcript or release
- [ ] Prior guidance cited to previous quarter's materials
- [ ] Both current and prior guidance sources hyperlinked

**Statistics & Metrics:**
- [ ] Key statistics have footnotes with sources
- [ ] Footnotes reference specific documents and page/slide numbers
- [ ] Management quotes cite speaker name and source document

**Clickable Links (any format that supports them) — critical:**
- [ ] ALL URLs are real CLICKABLE links (not plain blue text) — `/Link` annotations in PDF, `<a>` in HTML
- [ ] Inline `[n]` citation markers are clickable and jump to `## Sources`
- [ ] Sources entries link out to the source (whole title line clickable, not just the URL)
- [ ] Verified by inspecting the built file — count the `/Link` annotations in the PDF
- [ ] All SEC filings hyperlinked to EDGAR viewer
- [ ] All earnings materials hyperlinked (release, transcript, presentation)
- [ ] Prior quarter materials hyperlinked for comparison
- [ ] No raw, non-clickable URLs displayed anywhere

**Rendering, Fonts & Layout (format-agnostic — render/open and look):**
- [ ] For Chinese output: CJK text actually renders (not blank/tofu) — a real TTF is EMBEDDED, not a built-in CID font
- [ ] Chinese line-breaking correct — lines run to the right margin (`wordWrap='CJK'` on every Chinese paragraph style)
- [ ] Bold weight available so `<b>`/bold text renders (not silently falling back)
- [ ] Built file opened/rendered and every page/slide visually inspected
- [ ] Chart `Source:` notes sit clear of the plot and axis labels (not overlapping)
- [ ] Each figure/table caption is bound to its image as one unit — title never splits from its figure across a page
- [ ] Content flows naturally — NO forced one-section-per-page breaks; figures that "almost fit" are shrunk to fit rather than left stranding a half-empty page
- [ ] No half-empty / orphan pages — bottom whitespace checked on every content page
- [ ] Anything unfamiliar cross-checked against `report-render`'s `references/pitfalls.md`

**Sources Section:**
- [ ] Heading is exactly `## Sources` — nothing else
- [ ] Every entry follows `[n] 〔Primary|Secondary〕 Publisher · Document or system · Date (published; retrieved) · URL`
- [ ] Every entry declares `〔Primary〕` or `〔Secondary〕`; each `〔Secondary〕` entry names what it relays
- [ ] The count of distinct `[n]` markers in the body equals the number of entries — no orphan markers, no unreferenced entries
- [ ] Section starts on its own page (the only hard break besides the one after the cover)
- [ ] Consensus data sources listed (even if no link for subscription data)
- [ ] Prior period references included

### Coverage Checklist

- [ ] `## Coverage and Limitations` present — included even though everything was obtained
- [ ] Each item reports one of `On record` / `Not found within the search scope` / `Source unavailable`
- [ ] "Not found within the search scope" never written as "the company did not disclose"
- [ ] Sources that failed or were out of quota named, with what they would have covered
- [ ] States which line items consensus was retrievable for, and from which provider
- [ ] States whether a prior published estimate exists
- [ ] Retrieval timestamp stamped, plus the as-of time of the consensus snapshot

### Accuracy Checklist

**Numerical Accuracy:**
- [ ] Numbers match company's reported results exactly
- [ ] Math checks out in all calculations
- [ ] Estimate changes calculated correctly
- [ ] Valuation math is accurate
- [ ] Charts match text descriptions

**Factual Accuracy:**
- [ ] No typos in ticker symbol
- [ ] No typos in company name
- [ ] Dates are current and accurate
- [ ] Quarter/year references are correct
- [ ] Year notation correct (A for actual, E for estimate)

### Timeliness Checklist

**Publication Timing:**
- [ ] Report published within 24-48 hours of earnings release
- [ ] If later than 48 hours, acknowledged as "delayed reaction"
- [ ] ✅ **VERIFIED all data is from LATEST quarter by searching for recent earnings**
- [ ] ✅ **Did NOT rely on knowledge cutoff - actively searched for current data**
- [ ] Consensus estimates are pre-earnings (not post-earnings)
- [ ] No outdated information included
- [ ] Earnings release date is within last 1-3 months (not 6+ months old)

### Writing Style Checklist

**Clarity & Directness:**
- [ ] Lead with numbers ("Revenue grew 15% to $1.2B" not "Strong revenue")
- [ ] Use "vs." not "versus"
- [ ] Be direct and concise throughout
- [ ] Focus on what's NEW (not rehashing company basics)
- [ ] Avoid vague language ("strong performance" without quantification)

**Professional Standards:**
- [ ] Institutional tone maintained
- [ ] Consistent terminology throughout
- [ ] No informal language
- [ ] Proper financial notation

## Pre-Delivery Final Check

Run through this quick final check before sending report to user:

### 5-Minute Final Review:
1. **Page 1**: Rating clear? Price target updated? Key takeaways compelling? Chip legend present?
2. **Numbers**: Do reported results match company's press release exactly? Every number chipped, nothing fabricated?
3. **Citations**: Spot check 3-4 figures/tables - all have sources with clickable links? Marker count equals entry count?
4. **Estimates**: Old vs. new clearly shown (only if a real prior estimate exists)? Changes explained?
5. **Charts**: All 8-12 embedded? All numbered and captioned? Source notes not overlapping the plot?
6. **Length**: Is it 8-12 pages (not 6, not 15)? Any half-empty/orphan pages?
7. **Links & fonts**: Rendered the PDF — Chinese visible (not blank)? `[n]` markers jump, source URLs open?
8. **Coverage**: `## Coverage and Limitations` present, with the retrieval timestamp and every unavailable source named?
9. **Timeliness**: Is this being published within 48 hours of earnings?

If all items check out, the report is ready for delivery.

## Summary Delivery Format

When delivering the completed report to the user, provide this summary:

```
[Company] Q[X] [Year] Earnings Update Complete

Results: [BEAT / INLINE / MISS]
- Revenue: $X.XB ([beat/missed] by $XXM or X%)
- EPS: $X.XX ([beat/missed] by $X.XX)

Key Takeaways:
■ [Takeaway 1]
■ [Takeaway 2]
■ [Takeaway 3]

Updated Estimates:
- FY[Year]E Revenue: $XX.XB (prior: $XX.XB, [+/-]X%)
- FY[Year]E EPS: $X.XX (prior: $X.XX, [+/-]X%)

Rating: [MAINTAINED / RAISED / LOWERED] [RATING]
Price Target: $XXX (prior: $XXX) - [+/-]XX% upside

Coverage: [materials obtained] · not obtained: [what, and why]

Deliverables:
✓ 8-12 page earnings update report (format stated: [requested / PDF by default])
✓ 8-12 embedded charts
✓ Updated estimates with old/new comparison
✓ Coverage and Limitations block
✓ Sources section with clickable links
✓ [Optional: Updated XLS financial model]

File: [Company]_Q[X]_[Year]_Earnings_Update.[ext]
```
