---
name: earnings-analysis
description: Create professional equity research earnings update reports (8-12 pages, 3,000-5,000 words) analyzing quarterly results for companies already under coverage. Fast-turnaround format focusing on beat/miss analysis, key metrics, updated estimates, and revised thesis. Includes 1-3 summary tables and 8-12 charts. Use when user requests "earnings update", "quarterly update", "earnings analysis", "Q1/Q2/Q3/Q4 results", or post-earnings report.
---

# Equity Research Earnings Update

Create professional **EARNINGS UPDATE REPORTS** analyzing quarterly results for companies already under coverage, following institutional standards (JPMorgan, Goldman Sachs, Morgan Stanley format).

**Key Characteristics:**
- **Length**: 8-12 pages
- **Word Count**: 3,000-5,000 words
- **Tables**: 1-3 summary tables (NOT comprehensive)
- **Figures**: 8-12 charts
- **Turnaround**: 1-2 days (within 24-48 hours of earnings)
- **Audience**: Clients already familiar with the company
- **Focus**: What's NEW - beat/miss, updated estimates, thesis impact
- **Font**: Times New Roman throughout (unless user specifies otherwise)

## When to Use

Use when the user requests:
- "Create an earnings update for [Company] Q3 2024"
- "Analyze [Company]'s quarterly results"
- "Post-earnings report for [Company]"
- "Q1/Q2/Q3/Q4 update for [Company]"

**Do NOT use if:**
- User requests "initiation report" → Use different skill
- User requests "flash note" or "quick take" → Different format
- Company is not already covered → Need initiation first

## Critical Requirements

### 0. Data Integrity — Never Fabricate

**This is the highest-priority requirement in this skill. It overrides the desire for a complete-looking report. A blank cell is always better than an invented number.**

Every number, date, and factual claim in the report carries exactly **one** provenance tag, rendered as a **visual chip** so the reader can see which class it belongs to:

- **`[披露]`** — a primary record: the company disclosed it (earnings release, 10-Q/6-K, transcript, investor deck) or an exchange/regulator recorded it. The default and most trusted class.
- **`[测算]`** — a value YOU computed or assumed (margin = EBITA/revenue, price target, forward estimates, like-for-like growth). Must be derivable from `[披露]` inputs, and the derivation must be stated or reproducible.
- **`[预期]`** — a third-party estimate, **with a named provider**, and the provider must be a **data vendor's aggregated consensus**. The wired route is 同花顺 一致预期 via `hexin-stock.get_stock_financials` (预测每股收益平均值, 目标价(综合值), 评级机构家数 — ask with the forecast year inline); LSEG / Visible Alpha only where 同花顺 does not cover it. An unattributed consensus number does not exist. Note that 目标价(综合值) is an **aggregate** and is citable; a named peer 券商's own target price is not — this is sell-side research, so engage with a competitor's reasoning and redo the arithmetic yourself as `[测算]`.
- **`[推断]`** — our analytical inference with no corresponding record: an attribution hypothesis ("the beat came mostly from pricing"), a read-across to peers, a likely cause.
- **`[媒体]`** — reported by media and NOT corroborated by a disclosed record. Stays `[媒体]` until a record confirms it, at which point it becomes `[披露]` and cites that record.

When two tags could apply, take the weaker one: a `[披露]` figure you then adjusted is `[测算]`.

**When the request asks "how much of it", build the bridge** — see the decomposition rule below. 「毛利率变化里多少来自原材料
价格、多少来自自身降本」 is arithmetic, not a characterisation: open → signed steps
→ close, with a named `其他/未拆分` residual, every step `[测算]` with its basis.
Where the split cannot close (segment volumes or unit costs not disclosed at the
granularity asked for), name the missing input, then give the qualitative read
tagged `[推断]` so the reader can see they got a view rather than the numbers.
Answering an unhedged 「价格联动与降本消化了大部分增量」 to a "how much" question
is the failure this rule exists to prevent.

**`[测算]`, `[推断]`, and `[媒体]` are never optional in any format** — nothing lets a reader tell our arithmetic from a disclosure, our judgement from a finding, or an unconfirmed report from a record. An earnings update puts all these classes side by side in every beat/miss table, so chip every number in tables, variance columns, valuation summaries, and KPI strips.

**`[n]` does not carry the class, and in an earnings update `[披露]` is not optional either.** A citation says which document a figure came from; it cannot say whether the figure was printed there or computed by us off it. The exemption for uniformly-sourced flowing prose (a sector primer, a market landscape) does **not** reach this deliverable: a 业绩点评 is wall-to-wall mixed classes, and the moment a `[n]` stands in for a chip the reader loses the one distinction the tags exist for. Measured on two 业绩点评 of near-identical length: 134 tags against 64, and the thinner one had swapped `[n]` for `[披露]` through its 摘要 and 分部 sections and left **all thirteen** of its 环比 figures — every one computed off the prior quarter — reading as disclosures.

**The coverage floor, which is where this actually goes wrong:**
- **Every 同比 / 环比 / 占比 / pct figure carries a class.** A move you computed off a prior period is `[测算]`; one the issuer printed in the release is `[披露]`. Untagged they are the same figure to the reader. `report-render`'s `verify.py` reports untagged derivations on the built file, and `build()` refuses a table whose 同比/环比 column has no chip in its header or any cell under it.
- **One chip per run, not per figure.** 「同比 +102.7%、环比 +76.6%[测算]」 is the correct shape for a run of one class; splitting at a class boundary — 「毛利率 23.15%[披露]，环比 −1.67pct[测算]」 — is the correct shape where it crosses. Chipping each figure separately is noise, and so is a note under the table explaining the 口径 in prose: the reader cannot map a sentence onto cells.
- **Route every chip through `rep.chip(标签)` / `rep.tagged(值, 标签)`.** Do not define
  your own helper, copy the hex values, or hand-write the `<font>` markup: colour,
  size and the legal tag set live in `theme.CHIP`, and a local copy is how one
  batch shipped three different renderings of the same five tags.

**Hard rules — violating any of these is a serious failure:**

1. **Never invent a consensus number.** If you only have consensus for total revenue and EPS (the usual case), then the beat/miss table shows consensus for ONLY those rows. **Leave segment-level consensus cells blank** — do NOT back-fill them with your own estimate dressed up as "consensus." Then say which line items consensus was retrievable for in the coverage block (Requirement 7); a blank cell without that statement reads as an oversight rather than a finding.
2. **Never present an `[测算]` value as `[披露]` or `[预期]`.** A forward estimate, a margin you divided out, a "prior estimate" you never actually published — all are `[测算]` and must be labeled so, or omitted.
3. **No fake "old vs new estimate" columns.** Only show an estimate-revision table if you genuinely have a prior estimate on record. Otherwise show disclosed historical actuals only, and say so.
4. **Reconcile before you write.** Cross-check that prior-year × (1+YoY) ≈ current value; if segment pieces don't tie to the total, find the real disclosed figure rather than plugging a gap.
5. **Two conflicting disclosed figures → show both with their basis.** (E.g. CMR "+1% reported / +8% ex-subsidy" — report both, don't cherry-pick the flattering one.)

When a reader cannot tell whether a number is fact, your estimate, the Street's, your inference, or an unconfirmed press report, the report has failed regardless of how polished it looks.

### 1. Speed & Timeliness
- Publish within 24-48 hours of earnings release
- Focus on NEW information only
- Don't rehash company background extensively

### 2. Beat/Miss Analysis
- Lead with whether company beat or missed estimates
- Quantify variances (e.g., "Revenue beat by $120M or 3%")
- Explain WHY results differed from expectations

### 3. Summary Format
- Keep tables to 1-3 (summary only, not comprehensive)
- No full P&L/Cash Flow/Balance Sheet (just key metrics)
- Assume reader has seen initiation report

### 4. Citations & Source Attribution — mandatory

**CRITICAL**: Properly cite all data with SPECIFIC sources and CLICKABLE HYPERLINKS.

Use **numbered inline citations** `[n]` in body text, figure captions, and table notes, mapped to a numbered `## 来源` section at the end. Where the output format supports links (PDF, HTML), make `[n]` a clickable internal link that jumps to the matching entry, and make each entry's title + URL a clickable external link. Pair citations with the provenance chips from Requirement 0 so each number shows BOTH its class and its source — a chip without an `[n]` asserts that a record exists without saying which one.

**Marker rules:**
- `[n]` ascends on first use and is reused for repeat citations of the same source.
- **The count of distinct `[n]` markers must equal the number of Sources entries.** A marker with no entry, or an entry no marker points to, is a defect.
- A generic attribution blob ("Source: company filings, Street estimates") is not a citation: it names no document, no date, and no mapping from claim to source.

**Include specific citations in every figure and table:**

```
Source: Q3 FY24 10-Q filed 2024-11-08 [1]; company earnings release [2].
```

**HOW CLICKABLE LINKS WORK (per format):**
- *PDF (reportlab)*: inline `[n]` → internal links (`<a href="#refN">[n]</a>`) jumping to the entries; entries → external links (`<a href="https://...">`), whole title line clickable for a larger hit area. **Verify by counting `/Link` annotations in the built file** (external `URI` + internal `GoTo`) and confirming the internal jumps resolve. `report-render` automates this count.
- *HTML/Markdown*: `<a href="#refN">` anchors and `<a href="...">` external links.
- In every case: plain-text URLs that are not real links do NOT count as done.

**REQUIRED SOURCES LIST:**

Cite in every earnings update:
- ✅ Earnings release (with date and URL)
- ✅ 10-Q / 10-K / 6-K filing (with filing date and EDGAR link)
- ✅ Earnings call transcript (with date)
- ✅ Investor presentation/supplemental materials (if available)
- ✅ Consensus estimates source (同花顺 一致预期 via `hexin-stock.get_stock_financials`, or LSEG etc. where it does not cover — with retrieval date) — only for metrics you actually have consensus on (see Requirement 0)
- ✅ Prior guidance (from previous quarter's materials)

**THE SOURCES SECTION:**

Heading is exactly `## 来源`. One entry per marker, one shape:

```
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

- **`〔一手|二手〕` is mandatory, not implied.** Primary is the issuing document itself: the earnings release, the periodic filing, the transcript, the investor deck, the regulator's decision, or a database field sourced from those. Everything else is Secondary.
- **A Secondary entry must name what it relays** — `〔Secondary〕 <outlet> · relaying <the report or filing it quotes> · …`. Writing "Secondary" without naming the relay chain hides the chain it was supposed to expose. If a figure resolves only to a news article quoting a report, that is Secondary, and say in the coverage block that the underlying report was not obtained.
- An estimates aggregator is **Primary for the consensus figure it publishes**, and Secondary if you took that consensus from an article quoting it.
- **Both dates when both exist.** Publication date establishes vintage, retrieval date establishes what we could see. For a live database query publication may be absent — then `retrieved <date>` alone. Where a figure depends on time of day (a pre-earnings consensus snapshot, the session's move), carry time and session.
- In a paginated report, `## 来源` **starts on its own page** and is the only hard page break besides the one after the cover.

Placeholder shape — substitute the real documents, never ship the placeholders:

```
## 来源

[1] 〔Primary〕 <Company> · Q<N> FY<YY> earnings release · <YYYY-MM-DD> (published; retrieved <YYYY-MM-DD>) · https://…
[2] 〔Primary〕 SEC EDGAR · <Company> Form 10-Q, Q<N> FY<YY> · <YYYY-MM-DD> (filed; retrieved <YYYY-MM-DD>) · https://www.sec.gov/…
[3] 〔Primary〕 <Company> · Q<N> FY<YY> earnings call transcript · <YYYY-MM-DD> (published; retrieved <YYYY-MM-DD>) · https://…
[4] 〔Primary〕 <consensus provider> · consensus for revenue and EPS, pre-earnings close · <YYYY-MM-DD HH:MM close> (retrieved) · https://…
```

**VERIFICATION CHECKLIST:**
- [ ] Every figure has source with specific document and date
- [ ] Every table has source with document reference
- [ ] Beat/miss analysis cites consensus source with its retrieval date
- [ ] Guidance changes cite current and prior guidance sources
- [ ] Key statistics have footnotes
- [ ] `## 来源` lists every material, each with `〔一手|二手〕`, dates, and URL
- [ ] Distinct `[n]` marker count equals the entry count
- [ ] ALL URLs are CLICKABLE HYPERLINKS (not plain text)
- [ ] All SEC filings hyperlinked to EDGAR viewer

### 5. Updated Estimates
- Update forward estimates based on results
- Show old vs. new estimates clearly — **but only if a genuine prior estimate exists** (see Requirement 0). If there is no prior estimate on record, do not manufacture an "old" column; instead present disclosed historical actuals and your new estimates, each tagged `[披露]` / `[测算]`.
- Explain what changed and why

### 6. Output Format & Format-Agnostic Quality Bar

**The deliverable format follows the user's request — if they asked for PDF, produce PDF.** If unspecified, the house formatting policy decides: an 8-12 page earnings update is long-form, so deliver a PDF, and **state that choice in one clause** when you make it. The `report-render` skill builds the PDF (reportlab + matplotlib) and automates the layout and `/Link` checks below. 用户要 Word 时同样走 `report-render`（`DocxReport`，与 `Report` 同一套调用）——**要出 Word 就先载入 `report-render` 技能，再动手建**；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

**Whatever the format, these quality conditions are NON-NEGOTIABLE.** They are format-agnostic — the technique differs per format, but the outcome must hold in all of them:

**A. Charts and their source notes must never overlap.** Each chart needs a "Figure X — title" caption above and a `Source:` line below, and the source line must sit clear of the plot, axis labels, and data labels.
- *In matplotlib/PDF*: render the source as a figure-level footnote (`fig.text()` in figure coordinates) with reserved bottom margin (`subplots_adjust(bottom=...)`), NOT `ax.text()` at hand-tuned data coordinates — the latter collides with x-axis labels when the data range shifts.
- *In HTML/PPTX*: put the caption and source as separate text elements above/below the image, not overlaid on it.
- State a figure's or table's source **exactly once, in its note line** — never also inside the figure canvas and never also as a row of the table. For a chart built through `report-render`, that means `rep.figure(..., note=...)` and **not** `charts.source()`.

**B. Chinese / CJK text must actually render — never blank, and must wrap correctly.** Embed a real TTF (Regular AND Bold; built-in CID fonts such as `STSong-Light` render blank in viewers without Adobe CJK packs), and set `wordWrap='CJK'` on every paragraph style that can hold Chinese, or lines wrap early and stop short of the right margin. These are silent failures — nothing raises. **The full catalogue (font-family mapping, variable fonts, matplotlib tofu, table cells that ignore `wordWrap`) is in `report-render`'s `references/pitfalls.md`; read it before hand-rolling a builder.**

**C. Links must be genuinely clickable (where the format supports links).** Inline `[n]` markers jump to the Sources entries; entries open the source. In PDF these are real `/Link` annotations — **count them in the built file** — in HTML real `<a>` tags. Never plain blue text.

**D. No overflow, orphan, or half-empty pages/slides.** After building, render every page/slide and check: no element overlapping another, no source/caption clipped, no page left mostly empty because one block got stranded.
- **Bind every figure/table to its caption** (reportlab: one `KeepTogether([caption, image, note])`), or the caption strands at a page bottom while the image flows to the next page.
- **Let content flow; do NOT force breaks.** A `PageBreak()` before every heading is the #1 cause of half-empty pages. The only legitimate hard breaks are after the cover and before `## 来源`.
- **If a figure "almost fits," shrink it so it fits** (e.g. 174mm → ~138mm) rather than stranding a half-empty page. Cap figure height at roughly one third of the text column.
- Fix remaining gaps by reordering, merging orphans, or resizing — then re-render and re-check. (A modest gap is fine on the cover and on the standalone Sources page; mid-document content pages should be full.)

**The self-check is mandatory regardless of format: build it, render/open it, look at every page.**

### 7. Coverage and Limitations

Every earnings update closes with a coverage block, headed exactly `## 覆盖范围与局限`. **It is not optional and not abbreviated when everything succeeded** — a reader cannot otherwise distinguish "we checked seven things and found nothing" from "we checked four and three never ran."

Each check reports exactly one of three states:

| State | Means |
|---|---|
| `有记录` | Obtained. Cite it with `[n]`. |
| `检索范围内未发现` | The source was queried successfully and returned nothing (e.g. no transcript published yet). |
| `源不可用` | The source could not be queried this run — down, unauthorised, timed out, out of quota, or not covered for this name. |

`检索范围内未发现` is a statement about our search, not about the world: never render it as "the company did not disclose it." `源不可用` is a finding, not a gap to paper over.

For an earnings update the block covers, at minimum:
- Which filings, transcripts, releases, and supplemental materials were obtained, and which were not yet available at the time of writing.
- Whether consensus was retrievable, **from which provider, and for which line items** — this is where the blank segment-consensus cells from Requirement 0 get their explanation ("consensus retrievable for total revenue and EPS only; no segment-level consensus available from <provider>").
- Whether a prior published estimate exists (if not, say so — it is why there is no old-vs-new column).
- The retrieval timestamp, and the as-of time of the consensus snapshot.

```
## 覆盖范围与局限
Retrieved: <YYYY-MM-DD HH:MM TZ>  ·  Scope: Q<N> FY<YY> results for <Company> (<ticker>)

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| Earnings release | 有记录 [1] | <publisher> | <date> |
| Form 10-Q | 检索范围内未发现 (not yet filed) | SEC EDGAR | <date> |
| Consensus, revenue + EPS | 有记录 [4] | <provider> | <date> |
| Consensus, segment level | 源不可用 | <provider> (not covered) | <date> |

本次未能覆盖: <sources that failed, and what they would have covered>
```

## High-Level Workflow

The earnings update process follows 5 phases:

### Phase 1: Data Collection (30-60 minutes)

**🚨🚨🚨 CRITICAL: TRAINING DATA IS OUTDATED 🚨🚨🚨**

**BEFORE STARTING - COMPLETE THESE 4 STEPS IN ORDER:**
1. **CHECK TODAY'S DATE** - Write down the current date
2. **GO TO THE STRUCTURED SOURCE FIRST, NOT WEB SEARCH** - the disclosure record, in this order:
   - A shares: `wind-docs.get_company_announcements` (业绩预告/快报/定期报告;无日期参数,窗口写进 query 后自筛) and `hexin-stock.get_stock_financials` for the reported lines
   - HK/US: `hexin-global-stock.global_stock_financial`; where the **form type or filing date** matters, `sec-search.sec_full_text_search` with `form_types` and a date window
   - `finance-search.finance_search` sits **between the MCP tools and general web search** — 先走 `finance-search.finance_search`(金融垂搜,按档位召回并标注来源等级),它没有命中再落通用搜索。**媒体档默认带日期窗口**;官方档(weight>=3)反过来 —— 日期窗口会丢掉 publish_time 为空的记录(该档多数如此),取原始文件时不带窗口。 General web search remains the **last fallback for what none of these carry** (a transcript, a call replay, a management quote) — not the entry point. Pulling an earnings number off the web when a tool answers is how an undated figure enters the note.
3. **VERIFY THE DATE** - Confirm the release is within the last 3 months, from the source's own date field
4. **CHECK TRANSCRIPT DATE** - Verify transcript date matches release date

**COMMON MISTAKE**: Using outdated earnings calls from training data instead of searching for the latest.

**REQUIREMENTS:**
- ✅ Search for latest earnings - do NOT rely on training data
- ✅ Write down today's date and the release date found
- ✅ Verify release date is within 3 months of today
- ✅ Verify transcript date matches release date
- ✅ If dates don't match or are old (>3 months), search again

**See [references/workflow.md](references/workflow.md)** for detailed search procedures and verification steps.

### Phase 2: Analysis (2-3 hours)
- Beat/miss analysis for each key metric
- Segment/geographic/product breakdown
- Margin and guidance analysis
- Update financial model and estimates

**See [references/workflow.md](references/workflow.md)** for detailed analysis framework.

### Phase 3: Chart Generation (1-2 hours)
Create 8-12 charts focusing on quarterly trends and what's new:
- Quarterly revenue progression
- Quarterly EPS progression
- Quarterly margin trends
- Revenue by segment/geography
- Key operating metrics
- Beat/miss summary
- Estimate revisions
- Valuation charts

**See [references/workflow.md](references/workflow.md)** for chart specifications.

### Phase 4: Report Creation (2-3 hours)
Create the 8-12 page report with the structure below.

**See [references/report-structure.md](references/report-structure.md)** for complete page-by-page templates and formatting requirements.

**High-level structure:**
- Page 1: Earnings summary with draft rating and price target (草稿,待分析师确认)
- Pages 2-3: Detailed results analysis
- Pages 4-5: Key metrics & guidance
- Pages 6-7: Updated investment thesis
- Pages 8-10: Valuation & estimates
- Pages 11-12: Appendix (optional)
- Closing: `## 覆盖范围与局限`, then `## 来源` on its own page

### Phase 5: Quality Check & Delivery (30 minutes)
Verify content, formatting, accuracy, and timeliness before delivery.

**See [references/best-practices.md](references/best-practices.md)** for quality checklist and common mistakes to avoid.

## Output Specification

**Primary Deliverable**: an 8-12 page earnings update in **the format the user requested**. If the user didn't specify, deliver PDF (long-form, per the house formatting policy) and say so in one clause; `report-render` builds it with reportlab + matplotlib.
**File Name**: `[Company]_Q[Quarter]_[Year]_Earnings_Update.[ext]`
**Example**: `Nike_Q2_FY24_Earnings_Update.pdf`
**Regardless of format**, satisfy the format-agnostic quality bar in Requirement 6 (charts/source not overlapping, CJK visible, links clickable, no orphan/overflow pages), the data-integrity rules in Requirement 0, and the coverage block in Requirement 7.

**Contents:**
- Page 1: Summary with draft rating, draft price target (草稿,待分析师确认; stance `[推断]`, target arithmetic `[测算]`) and key takeaways
- Pages 2-3: Detailed results analysis
- Pages 4-5: Key metrics and guidance
- Pages 6-7: Updated thesis assessment
- Pages 8-10: Valuation and estimates
- Pages 11-12: Appendix (optional)
- `## 覆盖范围与局限`
- `## 来源` — on its own page, every entry `〔一手|二手〕`, dated, and clickable
- 8-12 embedded charts
- 1-3 summary tables

**Optional Deliverable**: XLS model update (optional for earnings updates)

## Key Differences from Initiation Report

| Aspect | Earnings Update | Initiation Report |
|--------|----------------|-------------------|
| **Length** | 8-12 pages | 30-50 pages |
| **Words** | 3,000-5,000 | 10,000-15,000 |
| **Tables** | 1-3 summary | 12-20 comprehensive |
| **Figures** | 8-12 | 25-35 |
| **Turnaround** | 1-2 days | 3-6 weeks |
| **Scope** | Quarterly results | Complete company |
| **Focus** | What's NEW | Everything |
| **Company Background** | Brief mention | 6-10 pages |
| **XLS Model** | Optional | Required |

## Resources

### references/workflow.md
Detailed Phase 1-5 instructions with step-by-step procedures for data collection, analysis, chart generation, and report creation.

### references/report-structure.md
Complete page-by-page templates, table formats, and formatting requirements for the report.

### references/best-practices.md
Examples of good/bad headlines, tips for success, common mistakes to avoid, and comprehensive quality checklist.

## Dependencies

**Required:**
- Python: `matplotlib`/`pandas` for charts
- The `report-render` skill for PDF output — it builds the document and runs the render-and-inspect self-check, including the `/Link` annotation count. Its `references/pitfalls.md` is the canonical list of silent font, wrapping, figure, and pagination failures; read it before hand-rolling a builder.
- For Chinese output: a CJK font that actually renders — an embedded TTF (e.g. Noto Sans SC), Regular and Bold, with `fontTools` if static weights must be instantiated from a variable font

**Optional:**
- `pptx-author` — when the user wants slides
- XLS skill for model updates (not required for earnings updates)
