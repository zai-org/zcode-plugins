---
name: related-party-map
description: Map a company's related parties — shareholders, outbound investments, brother companies, supply-chain counterparties (suppliers/customers), and funding-chain links — into a structured relationship map. Triggers on "关联方", "股权穿透", "关联企业", "supply chain map", "上下游客户供应商", "实控人", "股权结构".
---

# Related-Party & Relationship Map

Build the relationship graph around a target company, one hop at a time, with every edge sourced.

## Workflow

### Step 1: Resolve the anchor entity

Exact legal entity first (see entity-resolution discipline in `dd-report`). All queries use the resolved full legal name / ID.

### Step 2: Pull the relationship layers

Primary tool: 天眼查 —— `tools/list` 即权威工具清单,逐维度单独调、单独标注。

主体传 `company`(**全称**),列表型传 `page` / `size`(上限 20)。名称可能歧义时先用
`tianyancha.search_companies` 锚定,取候选表里的 `name`。

**每个维度的判定读返回体的 `_coverage.status`**(`有记录` / `检索范围内未发现` /
`源不可用`),不要自己从空列表推断:参数写错会报错而不是返回空。一个维度返回
`检索范围内未发现` 就照实记该维度无记录,**不要写 `源不可用`** —— 后者只留给调用真的
失败。返回体带 `total` 与 `fetched`,`total > fetched` 时 `_notes` 写明差多少条;
关系图谱这类动辄上百条的维度,把截断上限写进输出。

**每个新主体都要重新调一遍。** 一个控股股东、一个集团成员、一个董监高各是独立主体,
锚定主体的 `检索范围内未发现` 说明不了它们任何事。人员维度另有一条硬要求:
`tianyancha.get_person_profile` / `tianyancha.get_person_risk_profile` **必须同时传 `person` 与
`company`**(所在公司全称),天眼查靠「姓名 + 所在公司」定位,只给姓名会把同名人混在一起。

1. **股权链 — 向上**: shareholders with percentages (cross-check 天眼查 `tianyancha.get_shareholder_info`); iterate up to the actual controller (实控人 — `tianyancha.get_actual_controller` returns the resolved terminal, `tianyancha.get_equity_ratio` the control path, `tianyancha.get_beneficial_owners` the UBO under 央行 rules) or a natural person/SOE terminal. Note pledge status on major holdings (`tianyancha.get_equity_pledge_info` / `tianyancha.get_stock_pledge_info`).
2. **股权链 — 向下**: outbound investments (对外投资, cross-check 天眼查 `tianyancha.get_external_investments`; `tianyancha.get_equity_tree` for the layered structure, `tianyancha.get_controlled_companies` for the down-pierced list) with percentages; flag 100% shells and recently created vehicles.
3. **兄弟公司**: same-controller entities — the usual channel for related-party transactions. 天眼查 `tianyancha.get_group_info` identifies the group and its `groupUUID`; `tianyancha.get_company_group_profile` then returns members, group-level outbound investments and investors. `tianyancha.get_relation_graph` / `tianyancha.get_relation_path` expose the edges between two named subjects.
4. **供应链**: suppliers and customers with data vintage; flag concentration (any counterparty appearing as both supplier and customer is a `🔴 高` finding — resolve before deciding).
5. **资金链**: funding/transaction relationships where the data source exposes them.

For listed targets, cross-check controller and major-holder data against announcements (万得 `wind-docs.get_company_announcements`: 权益变动、质押公告).

### Step 3: Structure the map

Short-form is Markdown in-session, per the house formatting policy. If the user asked for a document, the map goes to PDF via the `report-render` skill — never hand-rolled with weasyprint, wkhtmltopdf, pandoc, or a bare reportlab script, because those do not emit `[n]` as PDF link annotations and the citations arrive unclickable. A wide relationship roster goes to `.xlsx` via `xlsx-author`. Word is the answer only when the user asks for it or the reader will edit the file — `report-render`'s `DocxReport` builds it with the same calls; unspecified long-form stays PDF (the house formatting policy). **要出 Word 就先载入 `report-render` 技能，再动手建。** `DocxReport` 与 `Report` 同一套调用；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

Output as a table per layer plus a compact tree for ownership:

```
实控人: [名称] [披露] [n]
  └─ [中间层] xx%
       └─ 目标公司
            ├─ 子公司A xx%
            └─ 子公司B xx%

关联维度表:
| 关系 | 对手方 | 强度/份额 | 报告期/数据时点 | 检索于 | 源 [n] |
```

Every retrieved edge is `[披露]`. A share you summed or netted across layers (穿透持股比例) is `[测算]` and states the arithmetic. Percentages that cannot be retrieved stay blank with a note — never estimated.

### Step 4: Flag patterns

Call out (as hypotheses, labeled `[推断]`, each with the concrete evidence that triggered it):

- 环形/交叉持股, 高比例质押的控制链, 频繁变更的股东结构
- 供应商=客户 重叠, 单一客户依赖 (>30% where shares are known)
- 新设壳公司集中出现, 注册地址/电话/人员重合(如数据可见)

### Step 5: Provenance and limits

Every edge carries an `[n]` marker naming the source system and the query date. The map closes with the coverage block — the dimensions are the check items, and the hop depth actually traversed is part of the scope:

```
## 覆盖范围与局限
检索于: [timestamp] · 口径/委托用途: [用途] · 股权向上穿透至第 [N] 层

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 股权链—向上(至实控人) | 有记录(N 层) [n] / 检索范围内未发现 / 源不可用 | [系统名] | [date] |
| 股权链—向下(对外投资) |  |  |  |
| 兄弟公司 |  |  |  |
| 供应链(供应商/客户) |  |  |  |
| 资金链 |  |  |  |
| 股权质押 |  |  |  |

本次未能覆盖: [源未覆盖或未返回的维度,以及它们本应揭示的关系]
数据滞后性: [登记变更公示滞后;供应链数据时点与更新频率]

## 来源
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

A dimension the source does not cover for this entity type is `源不可用`, not `检索范围内未发现` — and neither means "no such relationships exist". `〔一手|二手〕` is mandatory on every entry; a `二手` entry names what it relays. The count of distinct `[n]` markers equals the number of entries.
