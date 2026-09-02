---
name: morning-note
description: Draft concise morning meeting notes summarizing overnight developments, trade ideas, and key events for coverage stocks. Designed for the 7am morning meeting format — tight, opinionated, actionable. Triggers on "morning note", "morning meeting", "what happened overnight", "trade idea", "morning call prep", or "daily note".
---

# Morning Note

## Workflow

### Step 1: Overnight Developments

Scan for relevant events across coverage universe (confirm the universe with the user if it isn't already established). Use the structured MCP sources first — 同花顺 quotes and announcements (`hexin-stock` / `hexin-global-stock` for quotes, 万得 `wind-docs.get_company_announcements` for announcements; the vertical index `finance-search.finance_search` is the one that filters by date, via `date_from`/`date_to`) for A/H/US listed names, sec-search for overnight US filings (`form_types=["8-K"]` plus a date window — `finance-search` cannot filter by form and will return a different form for the same query) — then web search for anything they don't cover. Time-stamp what you pull; overnight data goes stale by the open.

**Lead with the overnight tape, and it has a source.** `hexin-index.index_data` covers overseas indices — verified 标普500 (`SPX.GI`) and 纳斯达克综指 (`IXIC.GI`) return 收盘价 and 涨跌幅. Pull the indices the coverage list actually keys off (US majors for ADR/US names, 恒生指数 for H shares, 沪深300 for the A-share open) rather than describing the tape from memory. Read the 证券代码 back — the same 简称 can resolve to different codes across calls.

**Earnings & Guidance**
- Any coverage companies reporting overnight or pre-market?
- Earnings surprises (beat/miss on revenue, EPS, key metrics)
- Guidance changes (raised, lowered, maintained)

**News & Events**
- M&A announcements or rumors
- Management changes
- Product launches or regulatory decisions
- Analyst upgrades/downgrades from competitors
- Macro data or policy changes affecting the sector

**Market Context**
- Overnight futures / pre-market moves
- Sector ETF performance
- Relevant commodity or currency moves
- Key economic data releases today

### Step 2: Morning Note Format

Keep it tight — a morning note should be readable in 2 minutes:

---

**[Date] Morning Note — [Analyst Name]**
**[Sector Coverage]**

**Top Call: [Headline — the one thing PMs need to hear]**
- 2-3 sentences on the key development and why it matters
- Stock impact: price target, rating reiteration/change

**Overnight/Pre-Market Developments**
- [Company A]: One-line summary of earnings/news + our take
- [Company B]: One-line summary + our take
- [Sector/Macro]: Relevant sector-wide development

**Key Events Today**
- [Time]: [Company] earnings call
- [Time]: Economic data release (expectations vs. our view)
- [Time]: Conference or investor day

**Trade Ideas** (if any)
- [Long/Short] [Company]: 1-2 sentence thesis + catalyst
- Risk: What would make this wrong

**Coverage and Limitations** — one line: retrieval time, what was queried, what was unavailable

**Sources** — numbered `[n]` entries for everything cited above

---

### Step 3: Quick Takes on Earnings

If a coverage company reported, provide a quick reaction:

| Metric | Consensus | Actual | Beat/Miss |
|--------|-----------|--------|-----------|
| Revenue | | | |
| EPS | | | |
| [Key metric] | | | |
| Guidance | | | |

**Our Take**: 2-3 sentences — is this good or bad for the stock? Does it change our thesis?

**Action**: Maintain / Upgrade / Downgrade rating? Adjust price target? — draft opinion pending analyst sign-off; tag the stance `[Inferred]` and any target arithmetic `[Est.]`, never present as an issued view.

### Step 4: Output

- Markdown text for email/Slack distribution — short-form, so this is the default when the user doesn't specify a format; say so in a clause
- PDF via `report-render` if formal distribution is needed. Never hand-roll the PDF with weasyprint, wkhtmltopdf, pandoc, or a bare reportlab script: those do not emit `[n]` as PDF link annotations, so the citations arrive unclickable. 用户要 Word 时同样走 `report-render`（`DocxReport`，与 `Report` 同一套调用）——**要出 Word 就先载入 `report-render` 技能，再动手建**；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。
  - **A morning note has no cover: do not call `rep.cover()`.** It opens on its first sentence — a title page on a one-page note is a third of the document — and the title still reaches the reader in the running header on every page. This is the exception `report-render` grants *this* skill by name; the plugin's other deliverables (研究报告, 业绩点评, 行业研究) all keep their covers, and "this one came out short" is not a reason to drop one. Do not substitute a hand-built title block either: there is no `rep.banner()`, and a run that reached for one shipped a note with neither.
- Keep to 1 page max — PMs and traders won't read more

### Step 5: Provenance, Sources, and Coverage

A morning note puts overnight actuals, the Street's numbers, and your read in the same three lines, so every figure carries exactly one chip. Both forms are given because the note's language decides which is written — **write the literal string, never a paraphrase of it**:

- `[披露]` / `[Reported]` — the printed result, the announced deal, the exchange quote, the filed 8-K.
- `[测算]` / `[Est.]` — anything you computed: the variance vs. consensus, an implied multiple, a revised price target.
- `[预期]` / `[Consensus]` — a third-party estimate **with the provider named** (LSEG, 同花顺 一致预期 — a data vendor's aggregated consensus, **not** a named peer 券商's own estimate or price target; this is sell-side research, so redo a competitor's arithmetic yourself as `[测算]`).
- `[推断]` / `[Inferred]` — "the move was mostly sector beta", "this reads across to <peer>". Your judgement, not a finding.
- `[媒体]` / `[Media]` — a rumour, an unconfirmed M&A report, an unsourced press story. Stays `[媒体]` until a filing or release confirms it, then becomes `[披露]` and cites the record. Overnight is where unverified reports do the most damage, so this chip earns its keep.

`[测算]`, `[推断]`, and `[媒体]` are never optional. **One tag style per document** — the Chinese forms in a Chinese note, the English aliases in an English one, never mixed. A Chinese note carrying `[Inferred]` or `[Est.]` is the mixed case this rule exists to prevent, and `[已披露]` / `[一致预期]` are not tags at all but paraphrases that read as untagged.

Inline `[n]` markers map to a `## 来源` section at the bottom. Heading exactly `## 来源` (`## Sources` in an English note); one entry per marker:

```
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

`〔一手|二手〕` is mandatory, and a `〔二手〕` entry must name what it relays — for an overnight rumour that is the whole point of the entry. The count of distinct `[n]` markers equals the number of entries. Quotes carry the session: `检索于 2026-07-24 16:00 收盘`.

Close with the coverage block — it is written even on a quiet night. A one-page note compresses it to prose under the same heading, but it still names what was queried, what was not, and when:

```
## 覆盖范围与局限
检索于 2026-07-25 06:40 CST。覆盖: 覆盖池 <N> 只的行情、公告与公司事件; 隔夜美股申报经 sec-search。
本次未能覆盖: <本次源不可用的项,及其本应覆盖的内容>。"隔夜无事"指上述源在该窗口内无记录,
不等同于没有发生。
```

The three states are `有记录` / `检索范围内未发现` / `源不可用` (`On record` / `Not found within the search scope` / `Source unavailable` in an English note). "No news" is a valid morning note, but write it as the second form, never as "there was no news."

## Important Notes

- Be opinionated — morning notes that just summarize news without a view are useless
- Lead with the most important thing — don't bury the headline
- "No news" is a valid morning note — say "the sources above returned no records overnight, maintaining positioning"
- Distinguish between actionable events (earnings, M&A) and noise (minor analyst notes, non-events)
- Time-stamp your takes — if you're writing at 6am, note that pre-market may change by open
- If you're wrong, own it in the next morning note — credibility matters more than being right every time
