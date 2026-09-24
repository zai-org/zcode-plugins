---
name: zotero-paper-note
description: 读取 Zotero 中的文献并生成结构化阅读笔记，把笔记添加回 Zotero 条目下，同时追加一行结构化 JSON 记录到 literature.jsonl 供后续批量分析。当用户提供论文标题/作者/DOI/Zotero 条目，要求"读这篇文献""给这篇文献做笔记""总结这篇 paper 并加到 Zotero""帮我做文献阅读笔记"时使用。适用于运筹学、供应链韧性、物流网络、选址优化、风险建模等领域。务必在用户提到 Zotero + 文献阅读/做笔记的组合，或要求把笔记写回 Zotero 时触发本技能。
license: MIT
---

# Zotero 文献阅读笔记技能

读取 Zotero 文库中的文献，生成一份结构化深度阅读笔记，回写到 Zotero 条目下，并把结构化字段追加到项目根目录的 `literature.jsonl`。面向运筹学（OR）/ 供应链韧性 / 物流网络 / 选址优化 / 风险建模等领域的论文优化。

## 为什么需要这个技能

做文献综述时，每篇论文都要回答同样一组问题：解决了什么问题？怎么建模的？韧性/风险这类概念在数学上到底怎么量化的？案例用的什么数据？本技能把"读 → 提炼 → 回写 Zotero → 累积结构化库"做成一条流水线。

**双存储**：
- **Zotero 笔记（HTML）**：给人看，挂在文献条目下，Zotero 语义搜索自动索引
- **literature.jsonl（结构化）**：给机器分析，每篇一行 JSON，按 `item_key` 去重。到写综述时可直接按方法筛选、跨论文对比决策变量、找 research gap

Markdown 适合人读和语义检索，但跨文献的结构化筛选/聚合（"所有用 Benders 的论文""韧性量化的不同分类"）需要 JSONL。两者并存。

## 工作流程

### Step 1: 定位文献

接受以下任一输入，优先级从上到下：

1. **Zotero item key**（8 位字符，如 `6XL3KWIB`）→ 直接用 `zotero_get_item_metadata` 取元数据
2. **DOI / arXiv 链接** → 先用 `zotero_search_items`（query 填 DOI）查本地是否已有
3. **标题 / 作者 / 关键词**（最常见）→ 用 `zotero_search_items` 检索，query 尽量短（"作者 年份"或论文核心词）
   - 如果返回多条，把候选列给用户确认，不要猜
4. **PDF 本地路径** → 用 Read 工具读取（fallback，不经过 Zotero）

定位到 journalArticle 类型的条目后，用 `zotero_get_item_metadata` 拿到标题、作者、年份、期刊、摘要、DOI、key。**记下 item_key**，后续回写笔记和去重 JSONL 都要用。

> 检索技巧（来自 Zotero MCP）：query 是子串匹配，每多一个词都会**收窄**结果。用"作者 姓 年份"或论文几个核心词最有效，别堆长句。

### Step 2: 阅读文献

按"由薄到厚"的顺序读，控制上下文开销：

1. **先读元数据 + 摘要**（`zotero_get_item_metadata`，已在上一步）→ 判断领域、方法类型，心里有底
2. **再读 PDF 大纲**（`zotero_get_pdf_outline`，传入 item_key 或附件 key）→ 定位关键章节：Introduction（动机）、Problem definition / Formulation（建模）、Solution approach（算法）、Computational experiments / Case study（案例与结果）
3. **读正文**：
   - 优先 `zotero_get_item_fulltext` 一次性读全文（适合需要完整理解的精读）
   - 若论文过长（书籍、长综述），改用 `zotero_read_pdf_pages` 按大纲定位的关键页区间读，避免一次性撑爆上下文
4. **读图表**：留意论文里的关键图（网络拓扑图、解的分布图、敏感性分析图），记录图号、标题、它说明了什么。可借助 `zotero_get_page_layout` 在含图的页面定位图区

精读时重点抓五类信息（对应笔记的五个主体章节）：
- **研究动机**：现有方法有什么不足 / gap？至少找 2-3 个
- **问题定义**：研究对象是什么系统（供应链？运输网络？）？有哪些实体、参数、扰动来源？
- **数学模型**：建模框架（MILP / 两阶段随机规划 / 鲁棒优化 /…）、决策变量（连符号带含义）、目标函数、约束、以及**核心概念（韧性、风险、可持续性）在模型里怎么量化的**
- **求解方法**：精确算法（Benders、Lagrangian relaxation、列生成）/ 启发式 / 商业求解器
- **案例与结果**：数据集来源、实验场景、核心数字结论（不要只抄数字，要说出数字意味着什么）

### Step 3: 生成笔记（三份表征，源自同一次阅读）

从同一次精读里同时产出三份内容，保持信息一致：

1. **Markdown 摘要** —— 对话展示用（Step 6）
2. **HTML 笔记** —— 回写 Zotero 用（Step 4）
3. **结构化 JSON 记录** —— 追加到 literature.jsonl 用（Step 5）

严格按本技能的**笔记模板**（见下方"笔记模板"小节，以及 `references/note-template.md`）生成。笔记主体用**中文**，**保留英文专有名词、模型名、变量符号**。

每节都要填实质内容，不可空着或只写"待补充"。如果某信息论文里确实没有（比如纯方法论文没有案例研究），写"本文未涉及案例研究"并说明原因，而不是留空或编造。

#### 笔记深度要求（这是质量的关键）

| 章节 | 要求 |
|------|------|
| 元信息 | 标题/作者/期刊/年份/DOI/Zotero key，全部来自 Zotero 元数据，顺手就有，不要漏 |
| 一句话总结 | 一段话，涵盖：问题 → 模型 → 方法 → 案例 → 核心结论。让读者 10 秒内知道这篇论文干了什么 |
| 关键词 | 3-10 个，用论文自己的术语（看 Keywords 节 + 标题 + 方法名） |
| 相关工作与问题定位 | 梳理 2-4 条研究脉络（每条：在做什么 + 本文与它的差异），再写"问题收敛"——作者如何从这些脉络落到本文具体问题。**用紧凑 bullet，别写成整段综述**。这一节是综述地图的核心 |
| 研究问题 | 问题要素要列出系统组成（研究对象、实体/参数、扰动来源）。注意：动机/gap 已放到上节的"问题收敛"，本节只做纯问题定义，不重复 |
| 数学模型 | 决策变量**必须用表格**（符号 \| 含义）；目标函数和约束逐条列；**"其他说明"专门讲韧性/风险等核心概念的量化方式**——这是本技能区别于普通摘要的核心价值 |
| 求解方法 | 写清算法名 + 一句话原理，别只写"用 CPLEX" |
| 案例研究 | 数据来源（哪个数据集、怎么收集的）+ 研究场景（网络规模、订单量等） |
| 实验结果 | 核心数字结论 + 这些数字说明什么。反直觉的发现要单独点出 |
| 关键图表 | 选 2-4 张最重要的图，每张写"图名：这张图展示了什么" |

#### "其他说明"小节怎么写（重要）

用户的研究方向是**供应链/网络韧性**，很多论文标题带"resilience/risk/robustness/sustainability"，但这些词在不同论文里量化方式天差地别。在这一节要讲清楚：论文是否用了传统韧性指数（如恢复曲线面积比 ∫Φ(t)dt）？还是用经济量化（事前准备成本 + 事后恢复成本 + 缺货/延迟惩罚）？还是用图论指标（连通性、冗余度）？把量化公式和对应变量符号写出来。参考笔记里的"韧性量化"四维度（投资端、风险端、惩罚端、资源端）就是一个很好的样板。

这个分类同时要落到 JSON 记录的 `resilience_quant` 字段（枚举：`economic` / `index` / `graph-theoretic` / `capacity-based` / `none`），方便综述时按韧性量化方式聚类。

### Step 4: 回写 Zotero 笔记

用 `zotero_manage_note` 把生成的 HTML 笔记添加到文献条目下：

```
zotero_manage_note(
  action='create',
  item_key='<Step 1 拿到的 item_key>',
  note_title='阅读笔记',
  note_text='<Step 3 生成的 HTML>',
  tags=['<建模方法标签，如 两阶段随机规划>', '<领域标签，如 供应链韧性>']
)
```

- `item_key` 必须是**文献条目**（journalArticle 等）的 key，不是附件 key
- `note_text` 用**简单 HTML**（详见下方"Zotero 笔记 HTML 格式规范"）
- `tags` 从笔记的"建模方法"和领域里取 1-3 个，方便后续按方法筛选
- 记下返回的 note key，填到 JSON 记录的 `note_key` 字段

如果条目下已有同名"阅读笔记"，先问用户是追加、覆盖还是新建，不要默默覆盖。

### Step 5: 追加 JSONL 结构化记录

把 Step 3 生成的 JSON 记录 upsert 到项目根目录的 `literature.jsonl`（每篇一行，按 `item_key` 去重——重读同一篇会**更新**该行而非重复添加）。

用本技能自带的脚本完成 upsert，避免手写追加/去重逻辑出错：

```bash
echo '<JSON 记录，单行，ensure_ascii=False>' | python <本技能目录>/scripts/upsert_note.py literature.jsonl
```

或从临时文件读：

```bash
python <本技能目录>/scripts/upsert_note.py literature.jsonl --file /tmp/record.json
```

脚本做的事：读现有 jsonl → 剔除同 `item_key` 的旧行 → 追加新行 → 自动补 `updated_at` 时间戳 → 写回。默认写到项目根目录的 `literature.jsonl`，路径可改。

JSON 记录的字段见下方"JSONL schema"小节和 `references/jsonl-schema.md`。关键字段：`method.framework`（按建模方法筛）、`resilience_quant`（韧性量化分类轴）、`decision_vars[]`（跨论文对比建模习惯）、`gap_or_limitation`（找 research gap）。

### Step 6: 在对话里展示摘要

回写 + JSONL 都完成后，在对话里贴一份**精简版结构化摘要**（Markdown 渲染），让用户不用切到 Zotero 也能即时看到成果。这份摘要和回写的 HTML 笔记内容一致。

末尾附带一句确认："已回写到 Zotero 条目 `<item_key>`，并更新 `literature.jsonl`（现共 N 篇）。"

## 笔记模板

笔记固定包含以下章节，顺序不可调换：

```
# 元信息
| 字段 | 内容 |
|---|---|
| 标题 | [英文原题] |
| 作者 | [作者团队] |
| 期刊 | [venue], [年份] |
| DOI | [...] |
| Zotero key | [item_key] |

# 一句话总结
[问题]建模为[模型]，采用[方法]求解。案例研究采用[数据/网络]。结果表明[核心结论，带关键数字]。

# 关键词
- keyword1
- keyword2
- ...

# 相关工作与问题定位
## 涉及的研究脉络
- 脉络1（如：网络设计中的中断风险）：这条线在做什么 + 本文与它的差异
- 脉络2（如：多式联运的可持续性）：…
## 问题收敛
作者综合/区别这几条脉络，如何落到本文的具体问题：…

# 研究问题
## 问题要素
- 研究对象：[什么系统/网络]
- 实体/参数：[节点、流、订单、容量等]
- 扰动来源：[中断/风险从哪来]

# 数学模型
建模方法：[MILP / 两阶段随机规划 / 鲁棒优化 / ...]
## 目标函数
[写清 min/max 什么，包含哪些成本项]
## 决策变量
| 符号 | 含义 |
|---|---|
| $X_{ij}^{km}$ | 在场景 s 下，订单 k 使用方式 m 在链路 (i,j) 上的流量 |
| ... | ... |
## 约束条件
- 约束 1：...
- 约束 2：...
## 其他说明
[韧性/风险/可持续性等核心概念在本模型中如何量化，分点写，带公式和变量符号]

# 求解方法
- [算法名]：[一句话原理]

# 案例研究
- 数据集：...（来源、如何收集）
- 研究场景：...（网络规模、订单量、场景数等）

# 实验结果
[核心数字结论 + 数字意味着什么；反直觉发现单独点出]

# 关键图表
- Fig. X [图名]：[这张图展示了什么]
- Fig. Y [图名]：[这张图展示了什么]
```

完整的 HTML 版（回写 Zotero 用）和一份真实示例见 `references/note-template.md`。

## JSONL schema

每篇文献在 `literature.jsonl` 里是一行 JSON 对象（JSONL：JSON Lines，每行一个独立 JSON）。完整字段定义、枚举值和真实示例见 `references/jsonl-schema.md`，核心字段速查：

| 字段 | 类型 | 说明 |
|------|------|------|
| `item_key` | string | Zotero 条目 key，**主键**，upsert 去重用 |
| `title` / `authors` / `year` / `doi` | 各类型 | 文献元数据 |
| `venue` | string | 期刊/会议名（必填，Zotero 直接给） |
| `keywords` | string[] | 关键词数组 |
| `related_streams` | string[] | 相关研究脉络（综述按脉络聚类用） |
| `positioning` | string | 问题收敛/定位一句话 |
| `method.framework` | string | 建模框架（two-stage stochastic / MILP / robust…），最常筛 |
| `method.algorithm` | string | 求解算法 |
| `decision_vars` | object[] | `{symbol, type, meaning}`，保留嵌套结构 |
| `objective` | string | 目标函数一句话 |
| `resilience_quant` | enum | `economic` / `index` / `graph-theoretic` / `capacity-based` / `none` |
| `resilience_quant_detail` | string | 量化细节 |
| `case` | object | `{dataset, scenario, region}` |
| `key_results` | string[] | 核心数字结论 |
| `gap_or_limitation` | string | 论文不足/gap，喂给综述找 gap |
| `note_key` / `note_path` | string | 回指 Zotero 笔记和本地 md |

## Zotero 笔记 HTML 格式规范

`zotero_manage_note` 的 `note_text` 接受简单 HTML。回写时遵循以下约定（和参考笔记一致）：

- **章节标题**：`<h1>一句话总结</h1>`、`<h1>数学模型</h1>`，子标题用 `<h2>`、`<h3>`
- **段落**：`<p>...</p>`
- **列表**：`<ul><li>...</li></ul>`
- **数学公式**（行内）：用 `<span class="math">$X_{ij}^{km}$</span>`。Zotero 会渲染这些 `$...$`。**不要**用裸 `$...$`，也不要用 Markdown 的 `$$...$$`（Zotero 笔记里不会被渲染）
- **决策变量表**：用 `<table><tbody><tr><th>符号</th><th>含义</th></tr>...</tbody></table>`，符号格子里同样用 `<span class="math">$...$</span>`
- **强调**：`<strong>` 加粗关键数字或结论
- **不要**带 `<html>`/`<body>` 包裹，不要带 XML 注释，不要用 `<div data-schema-version>`（Zotero 会自己加）

构造 `note_text` 时，最稳妥的方式是先按上面的 Markdown 模板写好正文，再手工转成上述 HTML 片段。

## 领域知识

本技能针对以下领域优化，读到相关术语要识别并正确归类：

### 运筹学 / 数学规划
- **建模框架**：混合整数规划（MILP/MIP）、两阶段/多阶段随机规划（stochastic programming）、鲁棒优化（robust optimization）、分布式鲁棒（DR）、模糊规划、博弈论
- **求解算法**：Benders 分解、Lagrangian relaxation、列生成（column generation）、L-shaped 方法、branch-and-cut、启发式/元启发式（GA、ALNS、禁忌搜索）、商业求解器（CPLEX/Gurobi）
- **应用**：设施选址（LIRP）、网络设计、车辆路径（VRP）、库存、排班

### 供应链 / 物流韧性
- **韧性（resilience）量化方式**（在"其他说明"里要讲清，并落到 `resilience_quant` 字段）：经济量化（事前准备/事后恢复成本 + 缺货/延迟惩罚 → `economic`）、韧性指数（恢复曲线面积 ∫Φ(t)dt / −∫(1−Φ)dt → `index`）、图论指标（连通度、冗余路径 → `graph-theoretic`）、能力维持百分比（→ `capacity-based`）
- **韧性策略**：事前加固（pre-disaster retrofitting / preparedness）、冗余（redundancy）、柔性（flexibility）、事后恢复（recovery）、多源采购（multi-sourcing）、库存预置（prepositioning）
- **风险/扰动**：GPR index（地缘政治风险）、GDELT、自然灾害、供应中断、需求突变；场景生成、蒙特卡洛

### 多式联运网络
- 运输方式（road/rail/water）、intermodal terminal、转运（transshipment）、集并（consolidation）、O-D 订单流

读到论文提到这些概念时，主动在"其他说明"或"研究问题"里把它们和模型里的具体变量/参数对应起来。

## 注意事项

1. **准确性优先**：变量符号、公式、数字必须来自论文原文，不确定的标"待确认"，**绝不编造**。决策变量表如果论文没明确列符号，就按"决策内容"分类列出（如"各方式车辆数""各链路流量"），不要硬造符号
2. **数学公式保留 LaTeX**：Zotero 笔记里用 `<span class="math">$...$</span>`，对话展示时用 `$...$`
3. **数字要带语义**：不要只写"降低 24.6%"，要写"将预期延迟成本削减 24.6%，说明韧性投资杠杆效应显著"
4. **尊重论文自己的术语**：论文说"consolidation"就别写成"合并"，说"preparedness actions"就别改成"预处理"。避免引入论文没用的学术黑话
5. **检索不到文献时**：把搜索词和结果告诉用户，让用户给 item_key 或换词，不要在找不到时硬编笔记
6. **附件而非条目**：如果定位到的是 attachment/note 类型，提示用户并找到它的父条目
7. **JSONL 去重**：upsert 脚本按 `item_key` 去重，重读同一篇会更新而非重复。不要用 `>>` 手动追加（会重复）

## 触发示例

```
用户：帮我读一下 Zotero 里那篇 Hasani 2024 关于 intermodal consolidation 的论文，做个笔记
→ [zotero_search_items → 拿到 6XL3KWIB → 读全文 → 生成笔记(MD+HTML+JSON) → zotero_manage_note 回写 → upsert_note.py 追加 jsonl → 对话展示摘要]

用户：给这篇 DOI 10.1016/j.tre.2024.103616 做个阅读笔记
→ [zotero_search_items(query=DOI) → …]

用户：读 6XL3KWIB 这篇
→ [直接 zotero_get_item_metadata(6XL3KWIB) → …]
```
