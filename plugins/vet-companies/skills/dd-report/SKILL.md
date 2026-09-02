---
name: dd-report
description: Assemble a full company due-diligence report — entity resolution, registry profile, ownership and related parties, business and industry-chain position, risk records, adverse media, and (for issuers) financial red flags. Triggers on "尽调", "尽职调查", "due diligence", "DD报告", "排查这家公司", "供应商准入", "交易对手调查".
---

# Company Due-Diligence Report

A structured, evidence-first DD report. Every section states what was checked, what was found, and what could not be covered.

## Workflow

### Step 1: Entity resolution

Resolve the exact legal entity via registry lookup (天眼查 `search_companies`). Confirm 统一社会信用代码/注册号, full legal name, and whether the target is the group, the listed vehicle, or a subsidiary. If multiple plausible entities exist, stop and confirm with the user. Carry the resolved **full legal name** forward — every later call takes it as `company`.

### Step 2: Registry profile (登记信息 section)

Registration status, capital (认缴 vs 实缴 — label which), establishment date, legal representative, registered address, business scope, and recent registry changes (法人变更、注册资本变动、经营范围变更 — frequent changes are themselves a flag). 天眼查 `tianyancha.get_company_basic_profile` returns the aggregated picture (registry, contacts, tags, scale, former names, 所在园区); use `tianyancha.get_company_registration_info` for the registry original and `tianyancha.get_change_records` for the itemised change history.

登记信息 is a section heading, not a provenance tag: every field here is `[披露]` with its `[n]`. Any ratio you derive from these fields (实缴/认缴 占比, 变更频次) is `[测算]`, and "frequent changes suggest instability" is `[推断]`.

### Step 3: Ownership and related parties

Run the `related-party-map` skill's core steps: shareholders (with percentages and dates), outbound investments, brother companies, and — via 天眼查 (`get_suppliers_and_customers`, `get_relation_graph`) — supply-chain and funding-chain relationships. Summarize the map here; attach the full map as an appendix or separate deliverable if large.

### Step 4: Business and industry position

- What the company actually sells, to whom; key customers/suppliers from 天眼查 supply-chain links (label data vintage).
- Industry-chain position inferred from the business description and supply-chain links (`[推断]` — no structured chain-mapping source), with concentration risk where the chain data exposes it.
- For listed or bond-issuing entities: recent announcements (万得 `wind-docs.get_company_announcements`) and issuer financial profile (`hexin-bond.bond_basic_info`, `bond_financial_data`) — leverage, profitability, contingent liabilities.
- **Agency credit rating, where the entity has issued bonds — `hexin-bond.bond_special_data`.** Returns 债项评级, 主体评级(主评机构), 主体评级展望, **主体最新评级变动方向** (上调/下调/维持), 评级机构, 评级类型, 最新评级日期. A rating **downgrade** or a 展望 moved to 负面 is first-order evidence for "can we do business with them" and outranks most media findings. Quote it attributed to the named agency with its 评级日期; this skill still issues no rating of its own.
  - **Read `主体评级类型` back every time.** On a guaranteed bond it can return `债券担保人信用评级` — the **guarantor's** rating, typically from a different agency than the 债项评级; on a non-guaranteed bond the same column returns `主体长期信用评级`, the entity's own. Carrying a guarantor's AAA as the counterparty's own rating makes a credit-dependent entity look standalone — the exact error a DD report exists to prevent. Where the type is a guarantor rating, label it as the guarantor's, name the guarantor, and record the entity's own rating as `检索范围内未发现`.
  - Non-issuers have no rating here; that is `不适用`, not `检索范围内未发现`.

### Step 5: Risk records (风险记录 section)

Run the `risk-scan` skill for the target AND its controlling shareholder / actual controller / key related entities identified in Step 3. Each of those is a separate subject: run the checks again per entity, because a `检索范围内未发现` on the target says nothing about its controller.

For natural persons (实控人、法定代表人、董监高), 天眼查 `tianyancha.get_company_people` lists them and `tianyancha.get_person_risk_profile` returns that person's 风险总览、失信、被执行、限制消费、终本案件、司法协助、限制出境 —— **both take `person` plus `company`** (the employing company's full name), because 天眼查 locates a person by name *and* company; a name alone merges same-named individuals. Company-oriented checks miss these entirely. Related-party risk transmits: a clean target with a defaulted controller is not clean, and the report says so rather than leaving the reader to join two sections.

**Join the two directions on the name.** `risk-scan`'s 限制高消费 check returns an `xname` per record — the natural person the court restricted, typically the 法定代表人 or an 实际控制人. Match that name against the Step 3 roster and against Step 2's 法定代表人: a 限高 naming the *current* legal representative is a live finding about the company's own management, while one naming a predecessor is dated and says so. Where the name matches nobody in either list, say that rather than dropping the record.

风险记录 is likewise a section heading, not a tag — a recorded 失信/涉诉/处罚/质押 item is `[披露]`. Each check carries one of `有记录` / `检索范围内未发现` / `源不可用` into Step 7's coverage table.

### Step 6: Adverse media (舆情 section)

万得 `wind-docs.get_financial_news` over the trailing 24 months: 违约、被查、爆雷、纠纷、监管 keywords plus the company name. Media findings are `[媒体]` and stay `[媒体]` until a disclosed record corroborates them, at which point they become `[披露]` and cite that record.

### Step 7: Assemble

Short-form by default: Markdown in-session, per the house formatting policy. A full DD report goes to PDF via the `report-render` skill — never hand-rolled with weasyprint, wkhtmltopdf, pandoc, or a bare reportlab script, because those do not emit `[n]` as PDF link annotations and the citations arrive unclickable. A batch of subjects screened side by side goes to `.xlsx` via `xlsx-author`. Word is the answer only when the user asks for it or the reader will edit the file — `report-render`'s `DocxReport` builds it with the same calls; unspecified long-form stays PDF (the house formatting policy). **要出 Word 就先载入 `report-render` 技能，再动手建。** `DocxReport` 与 `Report` 同一套调用；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

```
# [公司全称] 尽职调查报告
主体: [全称] / 统一社会信用代码 [码] · 检索于: [timestamp] · 委托口径: [用途,如供应商准入/授信/投资]
标签口径: [披露] 登记在册或主体披露 · [测算] 本文推导 · [预期] 第三方具名预期 · [推断] 分析师推论 · [媒体] 媒体报道未经记录佐证

## 结论摘要
- 总体印象一段(不下"通过/不通过"结论,列出决定性事实)
- 分级列表,前置至多 3 条 🔴: 🔴 高(决策前须澄清) / 🟡 中(记录并跟踪) / ⚪ 低·信息
  分级给到单条发现,不给到主体本身——本技能不出评级

## 一、主体信息(登记信息)
## 二、股权与关联方
## 三、业务与产业链地位
## 四、风险记录
## 五、舆情
## 六、(如适用)财务概览

## 覆盖范围与局限
检索于: [timestamp] · 口径/委托用途: [用途]

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| [逐项一行] | 有记录(N 项) [n] / 检索范围内未发现 / 源不可用 | [系统名] | [date] |

本次未能覆盖: [失败或未授权的源,以及它们本应覆盖的检查项]
数据滞后性: [所用各源的已知滞后,如登记变更公示、判决上网、处罚传输]

## 来源
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

Sources entries follow the citation policy: `〔一手|二手〕` is mandatory, a `二手` entry names what it relays (`二手 · 财新 · 转引 [原始报告] · [date](发布); 检索于 [date]`), and a live database query with no publication date carries `检索于 [date]` only. The count of distinct `[n]` markers equals the number of entries; `资料来源：工商数据、新闻检索` is not a citation.

### Guardrails

- "检索范围内未发现" ≠ "无风险"/"无此事"/"通过" — always the former phrasing. A source that could not be queried is `源不可用`, never folded into 未发现.
- Percentages, amounts, dates: only from retrieved records, each with `[n]`. Anything you computed from them is `[测算]`.
- Deliver as Markdown by default; PDF/Word on request (embed CJK fonts for PDF).
