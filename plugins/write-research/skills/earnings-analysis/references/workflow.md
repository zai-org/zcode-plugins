# Detailed Workflow for Earnings Updates

This document provides detailed step-by-step instructions for each phase of the earnings update process.

## ⚠️⚠️⚠️ CRITICAL WARNING: ALWAYS USE THE LATEST EARNINGS DATA ⚠️⚠️⚠️

**STOP AND READ THIS FIRST:**

Training data is OUTDATED. Actively search for and retrieve the MOST RECENT earnings materials. Using outdated earnings data is the #1 mistake in earnings analysis.

**BEFORE STARTING:**
1. **CHECK TODAY'S DATE** - Write down the current date
2. **SEARCH FOR LATEST** - Use `finance-search.finance_search` first (`weight=4` for the filing itself, `weight=2` for coverage), then web search, to find the most recent earnings
3. **VERIFY THE DATE** - Confirm the earnings release is within the last 3 months
4. **IF OLDER THAN 3 MONTHS** - Wrong quarter obtained, search again

## Phase 1: Earnings Data Collection (30-60 minutes)

### Step 1: Identify the Latest Earnings Period

**CRITICAL**: ALWAYS SEARCH FOR THE LATEST EARNINGS - DO NOT RELY ON KNOWLEDGE CUTOFF.
**CRITICAL**: NEVER USE EARNINGS DATA FROM TRAINING - IT IS OUTDATED.

**Step 1a: Search for Latest Earnings Release**

**🚨 ACTIVELY SEARCH - training data is outdated. 🚨**

**MANDATORY STEP 1: CHECK TODAY'S DATE**
- **Write down today's date explicitly**: [Month] [Day], [Year]
- **Use this to verify** that any earnings found are within 3 months
- **Example**: "Today is October 29, 2024"

**MANDATORY STEP 2: GO TO THE DISCLOSURE RECORD FIRST**
- **A shares** — `wind-docs.get_company_announcements` with `time_start`/`time_end` (业绩预告 / 业绩快报 / 定期报告), then `hexin-stock.get_stock_financials` for the reported lines
- **HK/US** — `hexin-global-stock.global_stock_financial`; where the **form type or filing date** matters, `sec-search.sec_full_text_search` with `form_types` and a date window
- **Then `finance-search.finance_search`, and only then general web search**, for what the record does not carry (a transcript, a call replay, a management quote):
  - `[Company name] latest earnings results`
  - `[Company name] most recent quarterly earnings`
  - `[Ticker symbol] earnings latest quarter`
- **OR search company investor relations site**:
  - Go to `investor.[company].com` or `[company].com/investors`
  - Navigate to "Press Releases", "News", or "Earnings" section
  - **Sort by date to find MOST RECENT release**
  - Look for keywords: "earnings", "results", "financial results", "quarterly results"

**MANDATORY STEP 3: VERIFY THE RELEASE DATE**
- **Look at the date of the earnings release found**
- **Calculate**: Is this date within the last 3 months from today?
- **If YES** → Proceed to next step
- **If NO (older than 3 months)** → 🚨 WRONG QUARTER - Search again for more recent

**❌ COMMON MISTAKES TO AVOID:**
- ❌ Using earnings data from training without searching
- ❌ Assuming "Q3 2024" is latest based on expectations
- ❌ Grabbing the first earnings release found without checking the date
- ❌ Not comparing the release date to today's date
- ❌ Proceeding when the release is 4+ months old

**✅ CORRECT APPROACH:**
- ✅ Check today's date first
- ✅ Search explicitly for "latest" or "most recent"
- ✅ Read the actual release date on the materials
- ✅ Confirm release date is within 3 months of today
- ✅ If unsure, search again with different terms

**MANDATORY STEP 4: IDENTIFY THE QUARTER**
- **Read the title/headline** to identify the quarter (Q1, Q2, Q3, Q4 or fiscal quarter)
- **Read the release date** on the document itself
- **Verify both the quarter name AND the date are recent**

3. **Alternative methods if IR site is unclear** — structured sources before web:
   - `wind-docs.get_company_announcements` (A shares, and it also covers 港美股公告) over the window
   - `sec-search.sec_full_text_search` with `form_types=["10-Q","10-K","8-K"]` and a date window — this is the reliable way to establish *which* form was filed *when*
   - Then web search: `[Company name] latest earnings results` / `[Ticker symbol] earnings latest quarter`

**Example searches that find latest data:**
- "Nike latest earnings results" → Returns most recent quarter reported
- "AAPL most recent quarterly earnings" → Shows latest Apple earnings
- "Tesla Q3 2024 earnings" → Results confirm Q3 2024 exists

**Step 1b: Understand Company's Fiscal Calendar**

After identifying the latest quarter from search, understand the company's fiscal year to interpret it correctly:

**Common fiscal year patterns:**
- **Calendar year (CY)**: Q1=Jan-Mar, Q2=Apr-Jun, Q3=Jul-Sep, Q4=Oct-Dec
- **Nike fiscal**: Q1=Jun-Aug, Q2=Sep-Nov, Q3=Dec-Feb, Q4=Mar-May (May fiscal year-end)
- **Apple fiscal**: Q1=Oct-Dec, Q2=Jan-Mar, Q3=Apr-Jun, Q4=Jul-Sep (September fiscal year-end)
- **Walmart fiscal**: Q1=Feb-Apr, Q2=May-Jul, Q3=Aug-Oct, Q4=Nov-Jan (January fiscal year-end)

Many companies state their fiscal year in the earnings release header. Search `[company] fiscal year calendar` if needed.

**Step 1c: MANDATORY VERIFICATION - Verify Latest Data Obtained**

🛑 **STOP - DO NOT PROCEED until verifying ALL of these:**

- [ ] ✅ **Today's date written down**: [Month] [Day], [Year]
- [ ] ✅ **Actively searched** using "latest earnings" or "most recent earnings"
- [ ] ✅ **Earnings release date found**: [Month] [Day], [Year]
- [ ] ✅ **Verified release is within 3 months of today** (do the math!)
- [ ] ✅ **Did NOT assume** the quarter based on today's date alone
- [ ] ✅ **Can see the actual press release** confirming the quarter/period
- [ ] ✅ **Opened and read** the actual earnings materials (not just assumed they exist)

**🚨 RED FLAGS - If ANY of these are true, WRONG quarter obtained:**
- 🚨 Release date is more than 90 days old
- 🚨 Relying on expectations rather than what was FOUND by searching
- 🚨 Have not actually SEEN a press release or filing confirming this quarter exists
- 🚨 Used data from training without searching
- 🚨 Cannot state the exact release date
- 🚨 Release date found is from 2023 or earlier (when today is 2024+)

**IF ANY RED FLAGS PRESENT**: STOP and search again. Do not proceed with outdated data.

**Step 1c: Handle Naming Variations**

Companies use different terminology - recognize these patterns:

**Quarter terminology:**
- "Q1 2024", "Q1 FY24", "First Quarter 2024", "1Q24"
- "Third Quarter Fiscal 2024", "Q3 FY2024", "3Q FY24"

**Earnings release titles:**
- "[Company] Reports Q3 2024 Results"
- "[Company] Announces Third Quarter Fiscal 2024 Financial Results"
- "[Company] Q3 Revenue Grew 15% Year-over-Year"

**SEC filing searches:**
- Company name may differ from common name (e.g., "Meta Platforms, Inc." vs "Facebook")
- Search by ticker symbol to find filings reliably
- Look for most recent 10-Q (quarterly) or 10-K (annual if Q4)

### Step 2: Gather Earnings Materials

After SEARCHING FOR and confirming the latest quarter, collect the following:

**⚠️ IMPORTANT: SEARCH for and ACCESS actual documents - do not rely on training data.**

**Primary Materials (REQUIRED):**
- **Earnings press release** - Usually on company investor relations site under "Press Releases" or "News"
  - Navigate to IR site and find the actual press release
  - Search patterns: "[Company name] latest earnings", "[Company name] Q[X] [Year] earnings results"
  - Look for PDF or HTML version
  - **Verify the date matches what was found in Step 1** (should be within last 1-3 months)
  - **Read the actual document** to confirm the quarter and get reported numbers

- **10-Q or 10-K filing** - On SEC EDGAR (sec.gov/edgar/searchedgar/companysearch.html)
  - Search by ticker symbol
  - For quarters 1-3: Look for most recent 10-Q
  - For Q4: Look for 10-K (annual report)
  - Note: May be filed 1-5 days after earnings release
  - Direct link format: `https://www.sec.gov/cgi-bin/viewer?accession=[accession-number]`

- **Earnings call transcript** - 🚨 **VERIFY THE DATE ON THE TRANSCRIPT** 🚨
  - **Search for**: "[Company] latest earnings call transcript" or "[Company] Q[X] [Year] earnings call transcript"
  - **Sources**:
    - Company IR site (some post transcripts directly)
    - Seeking Alpha: Search "[Company] [latest quarter] earnings call transcript"
    - AlphaStreet, Motley Fool (alternative sources)
  - **CRITICAL DATE CHECK**:
    - ✅ **Before using ANY transcript, verify the date on the transcript itself**
    - ✅ **The transcript date MUST match the earnings release date from Step 1**
    - ✅ **If transcript says "Q2 2023" but release was "Q3 2024", WRONG transcript obtained**
    - 🚨 **Common mistake**: Grabbing an old transcript without checking the date
  - If transcript not yet available, listen to webcast replay or note to wait for transcript

**Supplemental Materials (if available):**
- **Investor presentation/slides** - Often posted on IR site alongside press release
  - Usually titled "Q[X] [Year] Earnings Presentation" or "Investor Presentation"
  - PDF format with slides management presented during earnings call

- **Supplemental data file** - Some companies provide Excel files with detailed metrics
  - Look for "Supplemental Financial Information" or "Investor Data Sheet"

**Reference Materials (for comparison):**
- **Prior quarter results** - For QoQ comparison
  - From prior quarter's earnings release (90 days ago)

- **Prior year same quarter** - For YoY comparison
  - From same quarter last year (4 quarters ago)

- **Prior estimates** - If this company was previously covered
  - From last earnings update or initiation report
  - Check what was estimated for this quarter's metrics

- **Consensus estimates** - From 同花顺 一致预期 (`hexin-stock.get_stock_financials`), SEC filings, or other institutional sources
  - CRITICAL: Use estimates from BEFORE earnings release
  - Look for "as of [date before earnings]" to ensure pre-announcement consensus
  - Needed for beat/miss analysis

**🛑 MANDATORY VERIFICATION before proceeding to Step 3:**

**DATES - Verify ALL dates match:**
- [ ] ✅ **Today's date written down**: _______________
- [ ] ✅ **Earnings release date**: _______________ (MUST be within 3 months of today)
- [ ] ✅ **Earnings call transcript date**: _______________ (MUST match release date ±1 day)
- [ ] ✅ **10-Q/10-K filing date**: _______________ (MUST be same quarter as release)
- [ ] ✅ **ALL materials show SAME quarter** (e.g., all say "Q3 2024", not mixed quarters)

**SEARCH & ACCESS - Verify active search completed:**
- [ ] ✅ **SEARCHED** for "latest earnings" (not assumed based on current date)
- [ ] ✅ **ACCESSED** actual earnings press release and read it
- [ ] ✅ **OPENED** actual earnings call transcript and verified date
- [ ] ✅ **CONFIRMED** this is the MOST RECENT quarter by checking dates
- [ ] ✅ Have full financial results (revenue, EPS, margins, etc.) from actual release
- [ ] ✅ Have pre-earnings consensus estimates with source date

**🚨 RED FLAGS - STOP if ANY of these are true:**
- 🚨 Did NOT actually search for or access the earnings materials
- 🚨 Working from memory or training data instead of current documents
- 🚨 The earnings release date is more than 90 days old
- 🚨 Cannot state the EXACT DATE of the earnings release
- 🚨 The transcript date does NOT match the release date
- 🚨 Materials show different quarters (e.g., release says Q3 but transcript says Q2)
- 🚨 Grabbed the first result without verifying the date

### Step 3: Extract Key Metrics

Create a structured summary. **Tag every value by class** — `[D]` disclosed / `[E]` your estimate / `[C]` sourced consensus — and leave a cell BLANK rather than inventing a number you don't have (see SKILL.md Requirement 0). Most often you will have consensus for total revenue and EPS only; segment-level consensus is usually unavailable — leave those consensus cells blank.

```
REPORTED RESULTS vs. ESTIMATES:
─────────────────────────────────────────────────
                    Reported[D]  Our Est[E]  Consensus[C]  Beat/(Miss)
Revenue             $X,XXX       $X,XXX      $X,XXX        $XX (X%)
Gross Margin        XX.X%        XX.X%       XX.X%         XXbps
EBITDA              $XXX         $XXX        $XXX          $XX (X%)
Operating Profit    $XXX         $XXX        $XXX          $XX (X%)
EPS (Adjusted)      $X.XX        $X.XX       $X.XX         $X.XX
EPS (GAAP)          $X.XX        $X.XX       $X.XX         $X.XX

KEY BUSINESS METRICS (disclosed; consensus blank if not separately sourced):
─────────────────────────────────────────────────
[Segment 1 rev]     XXX[D]       —           (blank)       +X% YoY
[Segment 2 rev]     XXX[D]       —           (blank)       +X% YoY
```

**Before writing anything, reconcile**: prior-year × (1+YoY) should ≈ the current disclosed value; segment pieces should tie to the consolidated total. If they don't, you have the wrong number — go find the disclosed one, do not plug the gap.

### Step 4: Identify Key Themes from Call

Listen to or read earnings call transcript and note:
- Management's tone (confident, cautious, defensive?)
- Key topics emphasized (product launches, geographic trends, competition)
- Questions from analysts (what are investors concerned about?)
- Guidance provided (raised, lowered, maintained, introduced?)
- Any surprises or unexpected commentary

## Phase 2: Analysis (2-3 hours)

### Step 5: Beat/Miss Analysis

For EACH key metric that beat or missed, explain:

**If BEAT:**
- What drove the outperformance?
- Was it one-time or sustainable?
- Did management guide higher going forward?
- How does this impact our thesis?

**If MISS:**
- What went wrong?
- Was it company-specific or industry-wide?
- Is management taking corrective action?
- How does this impact our thesis?

**Example Format:**
```
■ **Revenue Beat by 3% Driven by Strong DTC Performance**

Revenue of $13.5B exceeded our estimate of $13.1B by $400M (3%) and consensus
of $13.2B by $300M (2%). The outperformance was driven primarily by Direct-to-
Consumer channels, which grew 18% YoY (vs. our 12% estimate), offsetting
weaker-than-expected wholesale (-5% vs. flat estimate). Management cited strong
digital demand and successful product launches (Pegasus 40 running shoe, new
Jordan colorways) as key drivers. DTC now represents 42% of total revenue vs.
38% a year ago, demonstrating successful channel shift strategy.
```

### Step 6: Segment/Geographic/Product Analysis

Analyze performance by:
- Business segment (if multi-segment company)
- Geography (North America, Europe, China, etc.)
- Product category
- Channel (retail, wholesale, e-commerce)

Identify:
- What outperformed expectations?
- What underperformed?
- Trends vs. prior quarters
- Management commentary on outlook for each area

### Step 7: Margin Analysis

Analyze profitability:
- Gross margin: up or down? why?
- Operating margin: up or down? why?
- Key drivers (pricing, mix, costs, leverage)
- Outlook going forward

### Step 8: Guidance Analysis

If company provided guidance:
- Compare new guidance to prior guidance
- Compare to internal estimates and Street estimates
- Assess credibility (does company have track record of sandbagging? beating?)
- Identify key assumptions behind guidance

If company did NOT provide guidance:
- Note this explicitly
- Provide independent outlook based on results and commentary

### Step 9: Update Financial Model

Update estimates for:
- Current year (remaining quarters)
- Next year
- Potentially year after

**Show clearly:**
```
UPDATED ESTIMATES:
─────────────────────────────────────────────────
                        Old Est     New Est     Change      Reason
FY2024E Revenue         $XX.XB      $XX.XB      +X.X%      [Brief reason]
FY2024E EBITDA          $X.XB       $X.XB       +X.X%      [Brief reason]
FY2024E EPS             $X.XX       $X.XX       +X.X%      [Brief reason]

FY2025E Revenue         $XX.XB      $XX.XB      +X.X%      [Brief reason]
FY2025E EBITDA          $X.XB       $X.XB       +X.X%      [Brief reason]
FY2025E EPS             $X.XX       $X.XX       +X.X%      [Brief reason]
```

### Step 10: Update Valuation & Price Target

Based on updated estimates:
- Recalculate DCF (use updated cash flows)
- Update comparable company multiples (if peer group has reported)
- Determine new fair value
- Decide if price target changes

**Price Target Decision:**
- If estimates changed significantly (>5%) → Usually change price target
- If estimates changed marginally (<5%) → May maintain price target
- If thesis strengthened/weakened → May change even without estimate change

### Step 11: Assess Rating Impact

Decide whether to change rating:
- If results significantly better than expected + guidance raised → Consider upgrade
- If results significantly worse + guidance cut → Consider downgrade
- If inline or mixed → Usually maintain rating

**Consider:**
- Stock reaction (up/down/flat?)
- Valuation (expensive/cheap relative to new estimates?)
- Risk/reward (asymmetry shifted?)

## Phase 3: Chart Generation (1-2 hours)

### Step 12: Generate 8-12 Charts

Create charts focusing on QUARTERLY TRENDS and WHAT'S NEW.

**REQUIRED CHARTS (8-12 total):**

1. **Quarterly Revenue Progression** (Bar chart)
   - Last 8-12 quarters
   - Show beat/miss vs. estimates each quarter
   - Highlight current quarter

2. **Quarterly EPS Progression** (Bar chart)
   - Last 8-12 quarters
   - Show beat/miss vs. estimates
   - Adjusted and GAAP

3. **Quarterly Margin Trend** (Line chart)
   - Gross margin, EBIT margin, net margin
   - Last 8-12 quarters
   - Show trajectory

4. **Revenue by Segment/Geography** (Stacked bar OR table)
   - Current quarter vs. YoY
   - Growth rates by segment

5. **Key Operating Metrics** (Multi-line chart)
   - Customer count, ARPU, units sold, etc. (whatever is relevant)
   - Last 8-12 quarters

6. **Beat/Miss Summary** (Waterfall or table)
   - Show components of beat/miss
   - What drove variance from estimates

7. **Estimate Revision Chart** (Before/after comparison)
   - Old FY estimates vs. new FY estimates
   - Bar chart showing change

8. **Valuation Chart** (P/E or EV/EBITDA multiple)
   - Historical multiple range
   - Current multiple
   - Fair value multiple

**OPTIONAL CHARTS (if space allows):**
- Peer comparison (if peers have reported)
- Guidance vs. Street comparison
- Cash flow metrics
- Balance sheet highlights (if notable)

**Chart Style Guidelines:**
- Focus on TRENDS (quarterly progression)
- Highlight CHANGES (beat/miss, estimate revisions)
- Keep simple and clear (this is a fast-turnaround report)
- **Only plot disclosed values.** If you only have the current and prior-year point, plot those two — do not fabricate intermediate quarters to make a line look fuller. If a series mixes disclosed and estimated points, distinguish them (different marker/color) and say so in the note.
- **Source note placement (critical):** put each chart's `Source:` line as a figure-level footnote (`fig.text()` in figure coordinates) with reserved bottom margin via `subplots_adjust(bottom=...)`. Do NOT use `ax.text()` at negative/hand-tuned data coordinates — it overlaps the x-axis tick labels. (This was a recurring real-world defect.)
- Charts for Chinese reports: keep axis/label text in English or numerals unless a CJK-capable font is set on matplotlib too; the report body carries the Chinese narrative.

## Phase 4: Report Creation (2-3 hours)

### Step 13: Create the Report (in the requested format)

Build an 8-12 page report in **the format the user asked for**. If unspecified, the house formatting policy decides: an earnings update circulates as it stands, so it is PDF — say so in one clause. Word only on request or where the reader will edit the file. **Either way it is built by `report-render`** (`Report` for PDF, `DocxReport` for DOCX): a hand-rolled PDF drops every `[n]` link annotation, and a hand-assembled DOCX fails on element ordering or on citations that are text rather than links. A deck is `pptx-author`'s. **要出 Word 就先载入 `report-render` 技能，再动手建。** `DocxReport` 与 `Report` 同一套调用；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

See [report-structure.md](report-structure.md) for complete page-by-page templates and formatting requirements.

**Key Steps:**
1. Create Page 1 with earnings summary and quick takeaways
2. Add detailed results analysis (Pages 2-3)
3. Include key metrics and guidance (Pages 4-5)
4. Update investment thesis (Pages 6-7)
5. Provide valuation and estimates (Pages 8-10)
6. Add appendix if needed (Pages 11-12)
7. Embed all 8-12 charts throughout
8. Add 1-3 summary tables
9. Include complete sources section with clickable links

**For Chinese output, ensure the CJK text actually renders AND wraps correctly.** `report-render` does all of this and its `references/pitfalls.md` records why each piece is there: in a PDF, a real embedded TTF (built-in CID fonts render blank in many viewers) and `wordWrap='CJK'` with justification on every Chinese style; in a DOCX, `w:eastAsia` on every Chinese run — set only the Latin attributes and Word silently substitutes its theme font for the whole document. Line breaking in a DOCX is Word's, so nothing here manages it. Charts need a CJK-capable matplotlib font either way.

**Bind each figure/table to its caption, and let content flow.** Wrap a chart's caption + image (+ source note) in one `KeepTogether` so the title never splits from its figure across a page. Then let text flow — a `PageBreak()` before each heading, or scattered `CondPageBreak()` before figures, is the top cause of half-empty pages (an "almost-fits" block gets pushed wholesale to the next page). The only legitimate hard breaks are after the cover and before the References/Sources section (which starts on its own page). If a full-width chart spills over and strands a half-empty page, **shrink its width (e.g. 174mm → ~138mm) so the caption+image unit fits the current page** rather than leaving a gap.

**Render/open self-check (do NOT skip, any format):** after building, render every page/slide (e.g. `pypdfium2` for PDF) or open the file and inspect:
- Chinese text is visible (not blank/tofu) and lines run to the right margin (not breaking mid-sentence).
- No chart source note overlaps its plot; no caption/source clipped.
- No half-empty / orphan or overflowing pages — fix by removing forced breaks, reordering, merging an orphan bullet, or resizing a chart, then re-render. (Cover and final references page may have a modest gap; mid-document pages should be full.)
- Clickable links present where the format supports them (for PDF, count `/Link` annotations — external + internal).

### Step 14: Optional - Update XLS Model

If a full financial model exists for this company (from initiation), update it with:
- Actual Q[X] results
- Revised estimates for future quarters
- Updated valuation

**Note**: For earnings updates, a full XLS file is OPTIONAL (not required like in initiation reports). The written report is the primary deliverable.

If creating XLS, include:
- Quarterly model tab
- Updated annual projections
- Revised DCF
- Updated comps analysis

## Phase 5: Quality Check & Delivery (30 minutes)

### Step 15: Quality Checklist

Before publishing, verify:

**Data Integrity (check FIRST):**
- [ ] Every number tagged `[披露]/[测算]/[预期]` (disclosed / estimate / consensus)
- [ ] Nothing fabricated — no invented consensus, no fake prior estimate, no plugged gaps
- [ ] Segment-level consensus left blank where not separately sourced (with a note)
- [ ] Numbers reconcile (prior-year × (1+YoY) ≈ current; segments tie to total)

**Content:**
- [ ] Beat/miss clearly stated and quantified
- [ ] Key drivers explained (not just "strong performance")
- [ ] Updated estimates provided (old vs. new shown)
- [ ] Price target updated or explicitly maintained
- [ ] Rating confirmed or changed with rationale
- [ ] Guidance analyzed (if provided)
- [ ] Thesis impact assessed

**Formatting:**
- [ ] Page 1 has summary box and key bullets
- [ ] All tables have source lines
- [ ] All figures numbered and captioned
- [ ] Estimates table shows old vs. new
- [ ] 8-12 charts embedded throughout
- [ ] Report is 8-12 pages (not too long, not too short)

**Accuracy:**
- [ ] Numbers match company's reported results exactly
- [ ] Math checks out (estimates, valuation)
- [ ] No typos in ticker, company name, numbers
- [ ] Charts match text descriptions
- [ ] Date is current

**Citations:** ⭐ MANDATORY
- [ ] Every figure has specific source with document and date
- [ ] Every table has specific source with document reference
- [ ] Beat/miss analysis cites consensus source with date
- [ ] Guidance changes cite current and prior guidance sources
- [ ] Key statistics have footnotes with specific page/slide references
- [ ] Sources section lists all materials with URLs
- [ ] ALL URLs are CLICKABLE HYPERLINKS (not plain text)
- [ ] Hyperlinks are real PDF link annotations; inline `[n]` markers jump to references
- [ ] All SEC filings hyperlinked to EDGAR viewer
- [ ] All earnings materials hyperlinked (release, transcript, presentation)
- [ ] Prior guidance hyperlinked to prior quarter's materials
- [ ] No raw URLs displayed - all formatted as clickable links
- [ ] Earnings call quotes cite specific speaker and approximate timestamp

**Rendering, Fonts & Layout (format-agnostic — render/open before delivery):**
- [ ] Chinese output: CJK text renders, not blank (for reportlab PDFs an embedded TTF, not STSong-Light/CID)
- [ ] Chinese lines run to the right margin, not breaking mid-sentence (reportlab: `wordWrap='CJK'`)
- [ ] Bold weight available so `<b>`/bold renders
- [ ] Chart source notes sit clear of the plot and axis labels (not overlapping)
- [ ] Each figure/table caption bound to its image (title never splits from figure across a page)
- [ ] Content flows — no forced one-section-per-page breaks; "almost-fits" figures shrunk to fit, not left stranding whitespace
- [ ] No half-empty / orphan / overflowing pages or slides
- [ ] Clickable links verified in the built file (e.g. count `/Link` annotations in a PDF)

**Timeliness:**
- [ ] Report published within 24-48 hours of earnings release
- [ ] All data is from LATEST quarter
- [ ] Consensus estimates are pre-earnings (not post-earnings)

### Step 16: Deliver Report

Provide user with:

1. **The report**: `[Company]_Q[X]_[Year]_Earnings_Update.pdf` — `.docx` if that is what was asked for. The filename follows the document's language, so a Chinese request gets a Chinese filename.
2. **Chart files**: All PNG/JPG charts (for reference)
3. **Optional XLS**: Updated financial model if maintained

**Brief summary for user:**
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

Deliverable: 8-12 page earnings update report with updated estimates and valuation.
```
