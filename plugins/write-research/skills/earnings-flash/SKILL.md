---
name: earnings-flash
description: Short-form earnings reactions for A-shares — the 业绩预告 → 业绩快报 → 正式报告 three-stage sequence, and the "first take" quick note in the first hour or two after any result. Distinct from the full 8–12 page earnings-analysis update. Triggers on "业绩预告", "业绩快报", "预亏", "预增", "扭亏", "快评", "点评一下这个业绩", "first take", "flash note", "quick take".
---

# Earnings Flash

The short-form reactions that sit *before* and *around* a full earnings update, which `earnings-analysis` explicitly hands off. Two forms, one skill:

1. **A股三段式** — mainland results arrive in up to three official disclosures, and each is a separate, citable event: **业绩预告 → 业绩快报 → 正式报告**. Each can carry its own note; the three are not the same number and must not be presented as if they were.
2. **First take** — a tight note in the first hour or two after any print (A/H/US): the headline read, actual vs. expectation, and the one-line thesis impact — staged for the analyst, not the 8–12 page update.

This skill stages a draft for review. It does not publish, rate, or set a target.

## Data sources

Retrieval goes through 同花顺 iFinD (this plugin's primary structured-data layer):

- `wind-docs.get_company_announcements` — the 业绩预告 / 业绩快报 / 正式报告 announcements themselves (预亏/预增/扭亏/续亏 wording, 区间, 快报 unaudited figures). It has real date filtering, so pass the disclosure window explicitly. 若按「业绩预告/快报」关键词检索返回空,换一组措辞(如「业绩预告」/「业绩快报」/「预计净利润」)再确认一次;两路都空才记「检索范围内未发现」,并在覆盖块写明走了哪两路。
- `hexin-stock.get_stock_financials` — the structured figures behind a print, and prior-period actuals for the 变动幅度. Read the unit back from the response every call (同花顺 column units change across calls).
- Batch preannouncement screening (1 月 / 7 月 预告季) via `hexin-stock.search_stocks` (universe) plus `wind-docs.get_company_announcements` per name for 超预期/暴雷 shortlists.
- For HK/US names: `wind-stock.get_stock_events` / `hexin-global-stock.global_stock_financial`; a US filing whose *form type or date* matters goes through `sec-search.sec_full_text_search`.

Verify today's date and each announcement's disclosure date from the record; never work from memory.

## Workflow

### Step 1: Classify the stage

Establish which disclosure you are looking at, because its evidentiary weight differs:

- **业绩预告 (preannouncement)** — mandatory for the **annual report only**, due within one month of the fiscal year end (1月31日前), on these triggers per the exchanges' listing rules (2024 revision): 净利润为负 (预亏), 扭亏为盈, **盈利且**净利润同比升降 50% 以上, 期末净资产为负, or触及财务类退市风险情形 (主板 营收低于 3 亿元、创业板/科创板 低于 1 亿元 的利润孰低口径). The obligation covers 主板、创业板、科创板 alike; **半年度预告不是强制义务**(自愿披露为主), so a July note treats any interim preannouncement as voluntary disclosure, not a missed obligation. Confirm the operative rule from the exchange's listing rules when a compliance statement matters. A preannouncement is typically a **range or a qualitative direction**, not a final number — a note on it says "预告", quotes the range and the trigger, and never presents the midpoint as the result.
- **业绩快报 (flash report)** — earlier than the full report but carrying **unaudited** headline figures. Label figures 未审; they can be revised in the 正式报告.
- **正式报告 (periodic report)** — the audited/full disclosure. This is where `earnings-analysis` takes over for a covered name; `earnings-flash` here only produces the quick reaction.

### Step 2: First-take content (any market)

Within the first hour or two of a print, five lines, no more: headline read (beat/miss vs. what), the one or two drivers, guidance direction if given, thesis impact in a sentence, and what to watch in the full report/transcript. Numbers not yet in a filing are `[Est.]`; a whisper is `[Media]`. A first take is explicitly interim and says so.

### Step 3: Stage sequencing (A-shares)

When more than one of the three disclosures exists, tie them together rather than restating:

- Preannouncement range vs. flash actual vs. audited result — a table across the stages, each column labelled with its disclosure and date, and any revision between stages called out (a flash that lands below the preannouncement floor is the story).
- Do not merge stages into one "result"; the comparability caveat (range → unaudited → audited) is the point.

### Step 4: Output

Short-form Markdown in-session by default. If a paginated note is asked for, hand to `report-render`. State the choice in one clause. 用户要 Word 时同样走 `report-render`（`DocxReport`，与 `Report` 同一套调用）——**要出 Word 就先载入 `report-render` 技能，再动手建**；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

```
**业绩快评 — [公司]([代码]) · [阶段: 预告/快报/正式] · [报告期]**
检索于: [date] · 阶段披露日: [date]
标签口径: [披露]/[Reported] 已披露 · [测算]/[Est.] 本文推算 · [预期]/[Consensus] 第三方具名 · [推断]/[Inferred] 本文推论 · [媒体]/[Media] 未获记录佐证

**头条读数**: [beat/miss vs 什么;预告为区间则给区间不给中点] [n]
**驱动**: [一两条]
**指引/展望**: [若有,方向] [n]
**Thesis 影响**: [一句]
**正式报告需看**: [1–2 项]

## 三段对比（存在多期披露时）
| 阶段 | 披露日 | 口径 | 营收/净利 | 标签 |
|---|---|---|---|---|
| 业绩预告 | [date] | 区间/定性 | 「[原文表述]」 | [披露][n] |
| 业绩快报 | [date] | 未审 | [值] | [披露][n] |
| 正式报告 | [date] | 已审 | [值] | [披露][n] |
[阶段间修正: 逐条列明,如"快报低于预告下限"]

## 覆盖范围与局限
检索于: [date] · 口径/委托用途: 业绩快评(供人工复核,非投资建议)

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 阶段公告(预告/快报/正式) | 有记录 [n] / 检索范围内未发现 / 源不可用 | 万得 wind-docs.get_company_announcements | [date] |
| 财务数据(本期/上期) | ... | 同花顺 hexin-stock.get_stock_financials | [date] |
| 第三方一致预期 | 有记录(具名) / 检索范围内未发现 | [提供方] | [date] |

本次未能覆盖: [取不到的阶段或源,以及它本应回答的问题]
数据滞后性: 预告为区间/定性、快报为未审数,均可能在正式报告修正;本快评为阶段性读数。
"检索范围内未发现"仅指上述源在本次检索无记录,不构成无风险或通过的结论。

## 来源
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

## Guardrails

- **预告是区间,不是结果**: never render a preannouncement midpoint as the reported number; quote the range and the trigger.
- **快报是未审数**: label 未审 and flag that the 正式报告 may revise it.
- **No fabricated numbers**: a figure not in a retrieved disclosure is `[Est.]` (ours) or does not appear. Consensus is named or it does not exist.
- **First take is interim** and says so; it does not carry the authority of the full `earnings-analysis` update, and a covered-name full report routes there.
- One tag style per document (Chinese forms in a Chinese note). `[测算]`/`[推断]`/`[媒体]` are never omitted. Distinct `[n]` markers equal the `## 来源` entry count; `〔一手|二手〕` mandatory.
- Stage outputs only — no publish, no rating, no target price.
