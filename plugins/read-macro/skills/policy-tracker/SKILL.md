---
name: policy-tracker
description: Tracks policy and industrial plans — 十五五规划、产业体系、地区产业口号、重点概念 — maps a named plan onto the industry-chain nodes it touches, and gathers implementation signals, separating a published plan target from our read of what it implies. Triggers on "十五五规划", "产业政策", "地方产业体系", "N+N 产业格局", "政策落地情况", "policy tracker", "industrial plan".
---

# Policy Tracker

What a plan **says**, which parts of an industry chain it **touches**, and what evidence exists that it is **being implemented** — three different questions with three different evidentiary standards, kept apart on the page.

## The distinction this skill exists to hold

- **A published plan target** — a quantified goal, a named 重点产业, a listed 工程 in a 规划 document — is `[披露]`, and the citation is the document itself.
- **A regional slogan** — 「4+3+N 产业体系」, 「四主四优」 — is a statement of intent, not a commitment with a target or a timeline. Report it as what it is: the slogan, its issuer, and its date. Do not upgrade it into a policy commitment by paraphrase.
- **Our read of what a plan implies** for a chain node, a capex cycle, or a listed universe is `[推断]`, always, no matter how obvious the implication feels.
- **A news report of implementation** with no corresponding document is `[媒体]` until a record confirms it, at which point it becomes `[披露]` citing that record.

Getting this wrong is the characteristic failure of policy research: a slogan travels three hops and arrives in a note as a funded target.

> This skill works off **web search and the plan documents themselves**: find the
> 规划/体系 document on its issuing body's site (中国政府网、发改委、地方政府网、新华社),
> read it, and quote it. There is no structured chain-mapping source, so the
> plan→industry-chain correspondence is `[推断]` by default — yours, not the
> document's — unless the document names the nodes, in which case quote it and tag
> `[披露]`. A plan may name only part of its own structure (Shanghai's 「2+3+6+6」
> names the 「3」 and leaves both 「6」s as counts); cross-searching region spellings ×
> keywords that all return the same document is evidence of coverage, not grounds
> to infer the missing list.

## Workflow

### Step 1: Scope and anchor

Region (国家 / 省 / 市 / 区县), the plan or concept, the industry chain in question, and the window for implementation signals (default 近 6 个月, stated). Anchor today from the session context or the user (no clock tool) — a 规划 period and a "近期" window both depend on it.

### Step 2: Find the plans

**Search is the core source now, and it is graded.** 先走 `finance-search.finance_search`(金融垂搜,按档位召回并标注来源等级),它没有命中再落通用搜索。**媒体档默认带日期窗口**;官方档(weight>=3)反过来 —— 日期窗口会丢掉 publish_time 为空的记录(该档多数如此),取原始文件时不带窗口。 `weight=4` 找 规划/产业体系 原文(发布机构站点),`weight=2` 找落地信号与解读;两者都取不到再用通用搜索。 Query patterns that work:

- By region: search the place + 规划/产业体系/主导产业 (e.g. 「上海 十四五 产业体系」) → the document that states its 主导产业 / 支柱产业.
- By concept: search the slogan itself (`4+3+N`, `四主四优`, a 产业链 name) → the document that defines it.
- By both, to pin a concept to a place.

Prefer the issuing body's own site (中国政府网、发改委、省/市政府网、新华社) over media restatements. For every hit, record: the issuing body, the document name, the plan period, the exact wording of the target or the 体系, and the source URL. Obtain the **full document text** where possible — a search summary is not the document. A search that returns nothing is `检索范围内未发现` — the plan may exist and not be web-reachable, and the output must say that rather than "该地区无相关规划".

### Step 3: Map the plan onto the chain

There is no structured chain-mapping source. Map the plan onto 上中下游节点 from the document's own wording where it names them; otherwise the correspondence is yours — label the whole mapping `[推断]` and say so, rather than presenting an inferred mapping as if a source supplied it.

The mapping itself — "this plan's 重点方向 corresponds to these 中游 nodes" — is `[推断]` unless the plan document itself names the nodes, in which case quote it and tag `[披露]`.

### Step 4: Implementation signals

`wind-docs.get_financial_news` and web search over the stated window, by region and by keyword (the plan name, the 工程 name, the chain name). Pass the explicit window (`date_from`/`date_to` on `finance-search.finance_search`; `wind-docs` has no date parameter). What counts as a signal, in descending order of weight:

1. A follow-on official document (实施方案、专项资金、目录、试点名单) — `[披露]`, cite it.
2. A named project, investment, or 开工 reported with an issuing body behind it — `[披露]` if the body published it, `[媒体]` if only the article carries it.
3. Coverage restating the plan with no new action — this is not a signal. Say the window produced none rather than padding the section.

### Step 4.5: 会议通稿逐句对比 (wording diff, optional)

For recurring meetings (政治局会议、中央经济工作会议、两会) the signal is often in
the **change of wording** between consecutive meetings of the same type — a phrase
added ("适度宽松"), a phrase dropped ("房住不炒") is the news. Only compare
same-type meetings.

- Store the prior meeting's operative wording per the state-file convention
  (`calendar/<meeting-type>.json`, keyed by meeting date, holding the quoted
  passages — not a paraphrase).
- **The diff needs the full communiqué text**, and `wind-docs.get_financial_news` often returns
  only summaries. Obtain the full text from the official release (新华社通稿 /
  中国政府网) via web read where available. When only excerpts are retrievable,
  diff the passages you actually hold, and state in the coverage block that the
  comparison is partial — never present an excerpt diff as a full-text diff.
- Diff the latest communiqué against the stored prior: list additions, deletions,
  and material re-phrasings, quoting both sides. The diff facts are `[披露]`
  (quoted wording); what a change **implies** for a sector is `[推断]`.
- Never infer intent from a wording change alone — an omission may be editorial.
  Present the diff; label the read as `[推断]`; persist the new wording for next time.

### Step 5: Assemble

Short-form is Markdown in-session. A policy primer or a 规划 deep-dive is long-form and goes to PDF via `report-render`; a plan-to-node mapping grid goes to `.xlsx` via `xlsx-author`. State the choice in one clause. 用户要 Word 时同样走 `report-render`（`DocxReport`，与 `Report` 同一套调用）——**要出 Word 就先载入 `report-render` 技能，再动手建**；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

```
# [地区/主题] 政策与产业规划跟踪
检索于: [date] · 规划期: [起—止] · 落地信号窗口: [起—止]

## 一句话
[已发布的承诺是什么;我们读出的含义是什么 — 两句分开]

## 一、已发布的规划与目标 [披露]
| 发布主体 | 文件/表述 | 类型(规划目标/产业体系/口号) | 规划期 | 关键表述 | 标签 |
|---|---|---|---|---|---|
| [主体] | [文件名] | 规划目标 | [起—止] | 「[原文表述]」 | [披露][n] |
| [主体] | [口号] | 产业口号(无量化目标、无时间表) | — | 「[原文]」 | [披露][n] |

## 二、对应的产业链节点
产业链: [链名]([chain_id,来自规划检索结果]) · 映射依据: 规划原文点名 / 我们的对应
| 环节 | 节点 | 与规划的对应关系 | 标签 |
|---|---|---|---|
| 上游 | [节点] | [规划中对应的表述,或我们的对应] | [披露] / [推断] |
| 中游 | ... | ... | ... |
| 下游 | ... | ... | ... |
[若无 chain_id: 本节为 源不可用,说明缺少的是什么]

## 三、落地信号(窗口 [起—止])
| 日期 | 信号 | 类型 | 发布/报道主体 | 标签 |
|---|---|---|---|---|
| [date] | [实施方案/专项资金/项目] | 后续官方文件 | [主体] | [披露][n] |
| [date] | [报道内容] | 媒体报道,未见对应文件 | [媒体名] | [媒体][n] |
[窗口内无信号则写:检索范围内未发现;不以复述规划的报道充数]

## 四、我们的解读 [推断]
[规划含义、可能受影响的环节、以及需要看到什么才能确认 — 每条都标 [推断]]

## 四之补(仅同类会议对比)、通稿措辞变化
（较上次 [会议类型]([上次日期]):新增「[原文]」/ 删除「[原文]」/ 改写「[旧]→[新]」;含义为 [推断]）

## 覆盖范围与局限
检索于: [date] · 口径/委托用途: 政策与产业规划跟踪

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 地区/概念规划检索 | 有记录(N 项) / 检索范围内未发现 | web/官方文件 | [date] |
| 规划原文(一手文件) | 有记录 / 检索范围内未发现(仅得检索摘要) | [发布主体] | [date] |
| 产业链节点映射 | 有记录(规划原文点名) / [推断](无结构化链路源) | 规划原文 / [推断] | [date] |
| 落地信号(窗口内) | 有记录(N 项) / 检索范围内未发现 | finance-search / web | [date] |

本次未能覆盖: [未取到的规划原文或链路,以及它本应回答的问题]
数据滞后性: 规划文件发布与检索库收录之间存在滞后;窗口内「未发现信号」不等于未发生。
口号与规划目标的区别已在第一节逐条标注;未量化的表述不作为承诺引用。

## 来源
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

`## 来源`: the 规划 document, the 实施方案, the ministry or local-government announcement, and a database field transcribing them are `一手` — name the issuing body and the document, with both the publication date and `检索于`. A news article about a plan is `二手` and names what it relays; where only the search summary was obtained and the underlying document was not, say so in the entry rather than citing the summary as if it were the document. Distinct `[n]` markers must equal the entry count.

## Guardrails

- **Never quantify an unquantified plan.** If the document states no number, the output states no number. No invented targets, no invented 投资规模, no invented timelines.
- **Quote the operative wording** for any target you report. A paraphrase of a policy target is already one step towards `[推断]`.
- **A slogan stays a slogan** through every layer of the deliverable, including the summary line. This is where the upgrade usually happens.
- **`检索范围内未发现` is about our search**, never rendered as 该地区无规划 or 政策未落地.
- **Draft, consultation, and effective documents are different.** State which one you have and its effective date; a 征求意见稿 is not in force.
- The read-across from a plan to an investable universe is `[推断]`, and this skill does not name buy candidates or issue a view; a view belongs in `asset-allocation`, with a falsifying signpost.
