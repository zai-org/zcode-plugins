---
name: asset-allocation
description: Cross-asset view assembled from what the data actually supports — equity via index valuation percentiles, rates, credit, commodities and FX via 同花顺 EDB series, macro state via the macro dashboard — derived from one macro thesis through named transmission chains, with an explicit falsifying signpost per asset class and one for the thesis itself. Triggers on "大类资产配置", "股债性价比", "现在看多还是看空", "资产配置观点", "cross-asset view", "asset allocation".
---

# Asset Allocation

A view per asset class, each built only from series we retrieved, each with the observable that would make it wrong.

**What this skill does not do.** It does not set weights or a target allocation, does not issue a rating, does not give personalised investment advice, and does not produce a portfolio. It states views and the evidence behind them for a strategist or investment committee to act on. There is also no backtest engine and no factor library in this plugin — a view is never supported by an unstated historical simulation.

## Build the view from what exists

| 资产类 | 可用证据 | 工具 |
|---|---|---|
| 权益(A 股宽基/风格/行业指数) | 估值水平与日频序列、区间收益拆分 | `index-valuation` → `hexin-index.index_data` |
| 权益估值**分位** | 近1年/近5年分位,带排名与样本量 | `index-valuation` → `wind-index.get_index_fundamentals` |
| 利率债 | 国债到期收益率曲线、期限利差、政策利率、资金利率 | `wind-economic.query_economic_indicator_data`(一次调用可取多期限) |
| 信用债 | 信用利差、等级利差、社融与新增贷款 | same EDB path |
| 宏观状态(所有资产的共同输入) | 增长/通胀/流动性/信用/外部 五板块 | `macro-dashboard` |
| 商品 / 汇率 / 海外资产 | EDB 覆盖大宗商品与汇率序列，**先检索**；检索不到才是 `源不可用` | `wind-economic.query_economic_indicator_data`(读回解析到的指标名) |
| 跨资产合成指标(加权、汇总、复合) | 由检索到的分项推导 | `hexin-stock.get_stock_financials` 自算 |

The last two rows are where this skill is most often asked to overreach — in **both**
directions. `wind-economic` 的覆盖包含大宗商品与汇率（见 agent 的数据源说明），所以把 商品 默认写成
`源不可用` 是一个未经检索的结论，和凭印象给观点一样不成立：先搜序列，读回解析到的指标名，取到了就
按第五条链（通胀与实物资产）给观点。真正取不到的是**供给端**——库存、产能、减产、检修——以及期货
曲线，那才是要写进不确定性和覆盖块的局限。序列确实没有回来时，该资产类是 `源不可用`，并写一句它
本来需要什么；它不会从记忆或市场印象里得到一个观点。

## Workflow

### Step 1: Frame

Horizon (default 3–6 个月, stated), the asset classes in scope, the currency and market perspective, and the purpose (strategy note, committee input). Anchor today from the session context or the user (no clock tool). Ask once if the horizon is unstated — a valuation percentile argues for a different horizon than a liquidity print.

### Step 2: Macro state

Run `macro-dashboard` and carry in, at minimum: ① the five-block latest readings with their staleness; ② **the 货币-信用象限 verdict from its Step 3.5 — the axis criteria applied, the quadrant, and its confidence**; ③ the most-lagged print you are relying on. Cite the same `[n]` sources rather than re-fetching and re-wording. If the dashboard run was compressed or skipped, execute its Step 3.5 criteria here before stating any view — a cross-asset view with no stated quadrant is incomplete. A view resting on a two-month-old credit number says so.

### Step 2.5: 宏观主线与传导 — the step everything after it hangs on

Steps 3 and 4 retrieve each asset class's own evidence. Without this step in
between, those become five parallel readings that happen to sit in one document:
equity argued off a valuation percentile, rates off the curve, credit off a
spread — and the macro block reduced to a summary nobody's conclusion depends on.
That is not an allocation view. **An allocation view starts from one macro thesis
and derives each asset from it**; the asset's own valuation then sizes the call,
it does not set its direction.

**Write the 主线 as one falsifiable paragraph.** Not a list of readings — a claim
about which state we are in and what is driving it, in the language of the five
things that actually move asset prices (the four quadrant blocks plus 外部, which
chain 4 hangs on and which a 增长/通胀/货币/信用-only thesis silently drops):

```
宏观主线（[X] 个月）: 增长 [方向+读数] · 通胀 [方向+读数] · 货币 [方向+读数] ·
信用 [方向+读数] · 外部 [方向+读数] → 我们处在【货币-信用象限】的 [象限]，主要驱动是 [一句]。
置信度 [高/中/低]，最弱的一环是 [哪一块的读数最陈旧或最矛盾]。 [推断][n]
```

象限只由货币与信用两轴决定（`macro-dashboard` Step 3.5），增长、通胀、外部不进象限判定，但它们是
第 2、5、4 条链的驱动，缺了就有链条无源可依。

**Then write the transmission, five chains, each with its sign.** This is the
bridge the current flow is missing — say what the state does to each price
mechanism before saying anything about an asset:

| 链条 | 由宏观的哪一块驱动 | 对资产的含义 |
|---|---|---|
| 无风险利率 | 货币（政策利率、资金利率、通胀预期） | 利率债久期方向；权益的贴现率 |
| 企业盈利 | 增长 + 通胀（价格传导到毛利） | 权益的分子；信用的偿债能力 |
| 信用溢价 | 信用（社融、新增贷款、违约） | 信用债利差方向；权益的风险偏好 |
| 汇率与外部 | 外部（顺差、外储、中美利差） | 汇率方向；外资流向对权益的边际影响 |
| 通胀与实物资产 | 增长（需求）+ 通胀（PPI、上游价格） | 商品方向；资源股的分子；权益内部上下游分化 |

第五条链是商品和资源股唯一的落脚点，也是本流程此前缺的一格：商品的方向不由贴现率或信用溢价决定，
它由需求与价格本身决定。**它有一个结构性局限，每次都要写出来**：本插件取不到供给端（库存、产能、
减产、检修），所以这条链只覆盖需求与通胀一侧，商品观点的置信度上限比其他资产低，理由写在
不确定性那一行，而不是靠不给观点来回避。

Each chain gets one line: **状态 → 机制 → 方向**，例如「宽货币 → 政策利率与资金利率下行、
通胀预期未起 → 无风险利率下行，利率债久期有利」。机制那一段是可以被反驳的地方，所以必须写出来，
不能只写「宽货币利好债券」。

A chain whose driving block was `源不可用` is stated as such, and every asset view
that leans on it is weakened by name — not silently derived anyway.

**主线级证伪路标.** The per-asset signposts in Step 5 catch one view being wrong.
This one catches **all of them being wrong at once**, which is the larger risk in
allocation and the one nobody writes down: if the quadrant call is wrong, five
views fail together. So state, with an observable, a threshold and a release date:

```
推翻主线的条件: [可观测项] [阈值] [发布时点] → 若出现，[哪几条链反转]，
本期观点中 [哪几条] 同时失效
```

### Step 3: Equity

Run `index-valuation` on the indices in scope. One index per query, fanned out and merged — **levels and the daily series from `hexin-index.index_data`, the percentile from `wind-index.get_index_fundamentals`** (同花顺's percentile is 52 weeks and degrades when a longer window is asked for; see `index-valuation`). What the view needs from it: the percentile **with its window**, the direction of weighted earnings, and the 盈利 vs 估值 split of the recent period.

### Step 3.5: 股债性价比 (equity risk premium)

The equity and rates blocks meet here. Compute the equity risk premium and read
its history — this is the 股债性价比 the description promises and the single most
asked-for cross-asset number.

- **ERP = 股票盈利收益率 − 10 年期国债收益率**, where 盈利收益率 = 1 / PE(TTM) of
  the broad index (取自 `index-valuation`'s weighted PE; **default index: 中证全指**
  — the closest retrievable proxy for the 万得全A convention; 沪深300 skews
  large-cap and understates the market's earnings yield, use it only when asked)
  and the 10Y yield comes from EDB (Step 4's 10 年期国债到期收益率 — pull it here
  when running this step first). Show the subtraction; the ERP is `[测算]`.
- **Percentile over multiple windows.** Give the ERP's rolling percentile over
  both 5 年 and 10 年 (state each window). A full-history percentile is polluted
  by the early high-valuation regime and is not used alone. Computing this needs
  the **historical ERP series** (historical PE(TTM) and historical 10Y at matching
  dates). Build it from `hexin-index.index_data`'s daily PE series and the EDB 10Y
  series; where only the equity leg's percentile is available, take it from
  `wind-index.get_index_fundamentals` (it serves 近5年 with an auditable 排名/最大排名)
  rather than 同花顺, whose long-window percentile degenerates. If a matched-date
  history still cannot be assembled, the ERP percentile is `源不可用` — degrade
  honestly by presenting the PE percentile and the rate level separately, and say
  plainly that this is not an ERP percentile.
- **分位钝化警告 (mandatory).** A falling rate centre lifts ERP structurally, so a
  "high" percentile can stay high for years while equities still fall (2022–2024
  是活教材). State this caveat wherever the ERP percentile is presented; never read
  a high percentile as a mechanical buy signal. The ERP is a re-balancing input,
  not a timing trigger.
- **ERP 是权益与利率债之间的相对刻度，不是第六类资产。** 它由「无风险利率」和「企业盈利」两条
  链共同决定，用的是权益和利率债已经用过的同一批证据，所以它**不独立计一票**：在 `观点总览` 里
  它是一行相对读数（偏股 / 中性 / 偏债），标注「相对刻度，不独立成观点」，证伪路标写成阈值 +
  复核时点。把它当独立资产给方向，等于把权益那一票投两次；而它的方向来自分位数，属于估值型证据，
  独立成观点还会和 Step 5「方向由链条给出、估值只能压到中性」那一条直接冲突。

### Step 4: Rates, credit, commodities and FX

Pull each series with `wind-economic.query_economic_indicator_data` (the window goes in the `beginDate`/`endDate` parameters (or `observation` for the last N periods), not in the sentence): read back the resolved indicator name and `code` from `meta`, and EDB code, then fetch. Candidate concepts (resolve to real indicators by search, do not use as indicator names): 10 年期国债到期收益率, 1 年期国债到期收益率, 期限利差, 政策利率(7 天逆回购), DR007, 中债信用利差, 各评级信用利差, 社融存量同比, 以及第五条链需要的商品与汇率序列(商品价格或商品指数、人民币汇率). A spread you computed from two retrieved yields is `[测算]` and shows the subtraction.

**取数时就把窗口取够，图是 Step 6 才画但序列在这里取**——否则到作图时手上只有判据所需的几个点，
而一张只有当前点的图说明不了任何趋势。`macro-dashboard` 取的窗口是为了判方向（社融存量同比连续
≥2 个月），不是为了作图；**它那一次运行若已经取到 24 个月，直接复用并引用同一 `[n]`，不要重复
调用**，否则在这里补齐：

- `DR007` 与 `7 天逆回购利率` —— 近 24 个月（图 1 的货币轴，判据与 `macro-dashboard` Step 3.5 同源）
- `社融存量同比` —— 近 24 个月（图 1 的信用轴。Step 2 保证带进来的只有最新读数、陈旧度和方向判据）
- 国债收益率曲线 —— 当前 / 3 个月前 / 1 年前，各关键期限（图 4）
- 信用利差 —— 有序列就取近 24 个月
- 商品与汇率 —— 只要 Step 5 要对它们表述观点，就要有一段可作图的窗口

### Step 5: State the views

One block per asset class. Each block is four lines and no more:

- **观点** — 有利 / 中性 / 不利 for the stated horizon, and to whom the alternative is (relative to what).
- **依据** — **第一句必须是 Step 2.5 的哪一条传导链**，写成「[链条] → 本资产[方向]」；
  之后才是该资产自身的两三个检索事实，每个 `[n]` + 标签。方向由链条给出，**该资产自己的估值
  位置校准的是幅度和赔率**：估值 89% 分位不能把「宽货币 → 贴现率下行 → 权益有利」翻成「不利」，
  但它**可以把结论压到中性**——这是允许的、有界的覆盖，写法是「链条方向有利，估值 [分位] 把结论
  压到中性，贵在 [哪里]」。三条规矩：① 覆盖只能往中性压，不能反向；② 必须在这一段里写明是估值
  在压，不能悄悄换一个结论；③ 若你认为估值本身已经否证了宏观读数（市场把宽松预期打满了），
  那不是估值覆盖，是主线错了——回 Step 2.5 改主线，并接受五条观点一起重算，而不是只翻这一条。
  A view is `[推断]`; the facts under it are `[披露]` or `[测算]`.
- **证伪路标** — the specific observable, with a threshold and a date or release where it would show up, that would make **this** view wrong (the one that would make *all* views wrong is the 主线级路标 in Step 2.5). 「增长转弱」 is not a signpost; 「下一期社融存量同比低于上一期,7 月中旬发布」 is.
- **不确定性** — what we could not see. If an asset class's key series was `源不可用`, the view is either not stated or stated as explicitly weaker for that reason. If the **chain** it hangs on was `源不可用`, say that instead — a view resting on a broken chain is weaker than one resting on a missing valuation.

**Cross-asset consistency is an outcome here, not a reconciliation.** Because every
view was derived from the same 主线, they should already agree; if two do not, the
主线 is underspecified or one derivation skipped a chain — fix it upstream rather
than writing a paragraph that explains away the contradiction. What *is* worth
writing is a genuine tension **inside** the macro state itself (上游再通胀 with weak
下游需求 pushing commodities and equity opposite ways): name it, say which chain
each side runs through, and say which one you weighted.

### Step 5.5: Cross-period re-check and persistence

A view with a falsifying signpost is only disciplined if someone checks the
signpost later. Close that loop with a state file per the state-file convention.

- **Re-check first.** If a prior view file exists (`theses/<name>.json`), load it
  before stating new views and, for each prior view, check whether its signpost
  has been hit since — using freshly retrieved series, not memory. Report each as
  兑现 / 未兑现 / 尚未到复核时点, and say plainly where a prior view was wrong. This
  goes in the 上期观点回检 section.
- **Persist after.** Write the current views to `theses/<name>.json`: each entry
  stores the asset class, the 观点, its 证伪路标 (observable + threshold + release
  date), and today's `updated`. This is the input the next run re-checks.
- Recurrence (每季度 / 每月) is the host scheduler's job, per the state-files
  convention — do not silently promise a future re-check.

### Step 6: Assemble

Short-form is Markdown in-session. A committee-facing outlook is long-form and goes to PDF via `report-render`; a view-and-signpost grid goes to `.xlsx` via `xlsx-author`. State the choice in one clause. 用户要 Word 时同样走 `report-render`（`DocxReport`，与 `Report` 同一套调用）——**要出 Word 就先载入 `report-render` 技能，再动手建**；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

**A long-form outlook carries 4–7 charts — the four core ones, plus one for each further
asset class you actually took a view on.** An allocation note is read by someone
deciding in five minutes, and 「PE 处 90% 分位」 as a table cell does not show that
the level has been flat for two years while the percentile drifted up. Build them
through `report-render`, each with its source in the note line and never inside
the canvas. The ones that earn their place, because they are what the 主线 and the
views argue with — and every one of them uses a series **Step 4 retrieved**, which is
why the windows are specified there rather than discovered here:

- **货币-信用象限定位**：DR007 与 7 天逆回购利率之差（货币轴，与 `macro-dashboard`
  Step 3.5 的判据同源）× 社融存量同比（信用轴），近 24 个月**轨迹**加当前点。
  **信用轴读的是方向**——仪表盘的判据是社融存量同比的方向而不是水平值，所以象限结论看的是轨迹
  走向，不是当前点落在半区哪一侧。把最近两点的连线或方向箭头标出来，否则会出现文字写「紧信用」
  而点位落在「宽信用」那一半的自相矛盾，图反过来打了文字的脸。
- **权益估值带**：宽基 PE(TTM) 的历史区间与现价位置，**标注回看窗口起始日**
- **ERP 序列与分位**：盈利收益率 − 10Y 的历史序列，标注当前值、5Y/10Y 分位与
  钝化警告（Step 3.5 已经算出来了，图比一句「含钝化警告」更能说明它为什么钝化）
- **国债收益率曲线**：当前 vs 3 个月前 vs 1 年前，附期限利差
- 信用利差走势（若 EDB 有该序列）；商品与汇率在序列可得时作图——若 Step 5 给了商品观点，
  这张图就不是可选的，一个有观点无图的资产类等于让读者只能相信你

一条 `源不可用` 的资产类**不作图**，而不是画一张空轴——图的缺席和覆盖块里的
`源不可用` 说的是同一件事。

```
# 大类资产观点 — [日期]
检索于: [date] · 观点期限: [X 个月] · 依据的宏观状态: 见「宏观仪表盘」区块

## 上期观点回检
（若有 theses/[name].json;逐条:资产类 · 上期观点 · 证伪路标 · 兑现/未兑现/未到复核时点 · 若错在何处）

## 宏观主线
[Step 2.5 的一段:增长/通胀/货币/信用/外部 → 象限 + 主要驱动 + 置信度 + 最弱的一环] [推断][n]

**传导链**（状态 → 机制 → 方向，每条一行）
| 链条 | 状态 | 机制 | 方向 |
|---|---|---|---|
| 无风险利率 | [宽/紧货币] | [政策利率与资金利率、通胀预期] | [下行/上行] |
| 企业盈利 | [增长+通胀] | [价格能否传导到毛利] | [改善/承压] |
| 信用溢价 | [宽/紧信用] | [社融、新增贷款、违约] | [收窄/走阔] |
| 汇率与外部 | [顺差/利差] | [外资流向、汇率约束] | [偏强/偏弱] |
| 通胀与实物资产 | [需求强度+PPI/上游价格] | [涨价能否延续、需求是否接得住] | [商品偏强/偏弱] |

**推翻主线的条件**: [可观测项] [阈值] [发布时点] → 反转 [哪几条链]，同时失效 [哪几条观点]

## 观点总览
| 资产类 | 观点 | 所依传导链 | 核心依据（链条→方向，再加自身位置） | 资产级证伪路标 | 最陈旧输入 | 标签 |
|---|---|---|---|---|---|---|
| 权益-[指数] | 有利/中性/不利 | 无风险利率+企业盈利 | [链条→方向];估值 [分位] 校准幅度(或把结论压至中性) [n] | [可观测项 + 阈值 + 发布时点] | [报告期] | [推断] |
| 利率债 | ... | 无风险利率 | ... | ... | ... | [推断] |
| 信用债 | ... | 信用溢价 | ... | ... | ... | [推断] |
| 商品 | 有利/中性/不利，或 未表述(序列检索不到) | 通胀与实物资产 | [链条→方向];[商品价格或指数序列] [n];**供给端未覆盖** | ... | ... | [推断] |
| 汇率 | ... | 汇率与外部 | ... | ... | ... | [推断] |
| 股债性价比(ERP)｜相对刻度，不独立计票 | 偏股/中性/偏债 | 无风险利率+企业盈利（与权益、利率债同源） | ERP=[盈利收益率−10Y国债]=[值];5Y/10Y 分位 [值](含钝化警告) [测算][n] | [阈值 + 复核时点] | [报告期] | [测算] |

## 宏观状态明细
[来自 macro-dashboard 的五板块读数与陈旧度,引用同一 [n]。象限判据与置信度已在「宏观主线」给出,此处只补支撑读数,不重复结论]

## 权益
观点 / 依据 / 证伪路标 / 不确定性

## 利率债
## 信用债
## 其他资产类
[逐条说明哪些资产因无可用序列而未表述观点]

## 主线内部的张力
[不是各观点之间的事后对账——它们同出一条主线本应自洽。这里写宏观状态自身的矛盾
(如上游再通胀 vs 下游需求疲弱),各走哪条链,以及本期给了哪一侧更高权重]

## 覆盖范围与局限
检索于: [date] · 口径/委托用途: 大类资产观点(供人工复核,非配置建议)

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 宏观五板块 | 有记录 / 检索范围内未发现 / 源不可用 | wind-economic(万得) | [date] |
| 权益估值水平与日频序列([指数]) | ... | hexin-index | [date] |
| 权益估值**分位**([指数], 带窗口/排名) | ... | wind-index(唯一的 Wind 例外) | [date] |
| 股债性价比(ERP: 盈利收益率−10Y, 5Y/10Y 分位) | 有记录 [测算] / 源不可用 | 本文测算(index-valuation 的 PE 序列 + wind-economic 的 10Y) | [date] |
| 国债收益率曲线 | ... | wind-economic | [date] |
| 信用利差 | ... | wind-economic | [date] |
| 商品序列(已检索 EDB) | 有记录 / 检索范围内未发现 / 源不可用 | wind-economic(读回解析到的指标名) | [date] |
| 商品供给端(库存、产能、减产、期货曲线) | 检索范围内未获得序列 | 已查:万得 wind-economic(无期货曲线与供给端序列);商品观点仅建立在需求与通胀一侧 | [date] |
| 汇率序列 | 有记录 / 检索范围内未发现 / 源不可用 | wind-economic | [date] |

本次未能覆盖: [未能取到的序列,以及它本应支撑的哪一个资产类观点]
数据滞后性: 本页最陈旧输入为 [指标](报告期 [date]);观点随下次发布可能改变。
本文件为观点与证据的整理,不构成配置建议、评级或个性化投资意见。

## 来源
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

`## 来源`: a macro series is `一手` to the issuing statistical agency or central bank, and an EDB field (万得 `wind-economic`) sourced from those is `一手` — name the resolved indicator and its EDB code with `检索于`. Index fields are `一手` to the index provider; a valuation percentile from `wind-index` names Wind and its window. A strategist's published view or a media summary is `二手` and names what it relays. Distinct `[n]` markers must equal the entry count.

## Guardrails

- **Every view has a falsifier.** A view whose signpost is unobservable, or has no threshold, or has no date at which it could show up, is not finished.
- **No weights, no ratings, no advice.** 「超配」/「低配」 and any percentage allocation are out of scope; so is a rating scale. The vocabulary is 有利 / 中性 / 不利, and the deliverable says it is for human review.
- **No fabricated series and no implied backtest.** If a series is missing, the asset class is `源不可用`. Never say a relationship "historically holds" without a retrieved series demonstrating it in the window shown.
- **Percentiles keep their window** wherever they are carried in from `index-valuation`; a percentile that loses its window in transit is the same defect one level down.
- **Staleness travels with the view.** The most lagged input is named in the overview table, so a reader can see which release could invalidate the page.
- **Direction comes from a chain; valuation may only compress it to 中性.** A view whose 依据 does not open with one of the five chains is not derived, it is assembled. Following valuation *against* the chain means the 主线 is wrong — fix it upstream and recompute every view, rather than reversing one line quietly.
- **ERP does not vote twice.** It is the relative gauge between equity and rates, presented as a reading with the 钝化 caveat, not a sixth asset class with its own direction.
- **`源不可用` is a retrieval result, not a default.** 商品 and 汇率 are searched in EDB before any such claim; what the wired sources do not return is the commodity **supply side**, recorded as `检索范围内未获得序列` naming what was searched — not as a claim that no such data exists anywhere — and that is stated as the reason the commodity view's confidence is capped.
