# JSONL Schema — literature.jsonl

`literature.jsonl` 每行是一个独立 JSON 对象，代表一篇文献的结构化笔记。JSON Lines 格式：每行一个 JSON，行间用 `\n` 分隔，整个文件**不是**一个 JSON 数组。

## 字段定义

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `item_key` | string | ✅ | Zotero 条目 key（8 位），**主键**，upsert 去重用 |
| `title` | string | ✅ | 论文标题（英文原题） |
| `authors` | string | ✅ | "姓 et al." 或前两位作者，便于显示 |
| `year` | integer | ✅ | 发表年份 |
| `venue` | string | ✅ | 期刊/会议名（Zotero 直接给，纯名字，不带分区等级） |
| `doi` | string | | DOI |
| `keywords` | string[] | ✅ | 关键词数组，3-10 个，用论文自己的术语 |
| `related_streams` | string[] | | 相关研究脉络（综述按脉络聚类用，2-4 条） |
| `positioning` | string | | 问题收敛/定位一句话（相关工作如何落到本文问题） |
| `method` | object | ✅ | 见下方 `method` 子结构 |
| `objective` | string | | 目标函数一句话（min/max 什么） |
| `decision_vars` | object[] | | 决策变量数组，见下方 `decision_vars` 子结构 |
| `constraints` | string[] | | 约束条件，每条一句话 |
| `resilience_quant` | enum | ✅ | 韧性量化方式，见下方枚举。无韧性内容填 `none` |
| `resilience_quant_detail` | string | | 量化细节（公式、变量、维度） |
| `case` | object | | 见下方 `case` 子结构 |
| `key_results` | string[] | | 核心数字结论，每条带语义（不要只抄数字） |
| `gap_or_limitation` | string | | 论文不足 / research gap，喂给综述 |
| `note_key` | string | | Zotero 笔记的 key（zotero_manage_note 返回值） |
| `note_path` | string | | 本地 md 笔记路径（如保存了的话） |
| `tags` | string[] | | Zotero 标签（建模方法、领域） |
| `updated_at` | string | | ISO-8601 时间戳，upsert 脚本自动补 |

### `method` 子结构

```json
"method": {
  "framework": "two-stage stochastic programming",
  "algorithm": "Lagrangian relaxation + valid inequalities",
  "is_mip": true,
  "solver": "CPLEX"
}
```

- `framework`（string）：建模框架。常见值：`MILP`、`two-stage stochastic programming`、`multi-stage stochastic`、`robust optimization`、`distributionally robust`、`fuzzy programming`、`game theory`、`simulation-optimization`
- `algorithm`（string）：求解算法。常见值：`Benders decomposition`、`Lagrangian relaxation`、`column generation`、`L-shaped method`、`branch-and-cut`、`ALNS`、`GA`、`CPLEX`/`Gurobi`
- `is_mip`（boolean）：是否含整数/二元变量
- `solver`（string，可选）：用的求解器

### `decision_vars` 子结构

```json
"decision_vars": [
  {"symbol": "X_{ijs}^{km}", "type": "continuous", "meaning": "场景s下订单k用方式m在链路(i,j)上的流量"},
  {"symbol": "\\beta_{ij}^{mp}", "type": "binary", "meaning": "是否对链路(i,j)方式m采取准备活动p"}
]
```

- `symbol`：LaTeX 符号（保留 `$...$` 内的内容，不含 `$`）
- `type`：`continuous` / `binary` / `integer` / `set`（集合/路线类）
- `meaning`：中文含义

论文若没明确列符号，`symbol` 填描述性名字（如 `"车辆数"`），`type` 留空或填 `unknown`，不要硬造符号。

### `resilience_quant` 枚举

| 值 | 含义 | 典型表现 |
|----|------|---------|
| `economic` | 经济量化 | 事前准备/事后恢复成本 + 缺货/延迟惩罚，权衡投入与后果 |
| `index` | 韧性指数 | 恢复曲线面积 ∫Φ(t)dt、−∫(1−Φ)dt、自定义归一化指数 |
| `graph-theoretic` | 图论指标 | 连通度、冗余路径、最短路、网络效率 |
| `capacity-based` | 能力维持 | 中断后满足需求的百分比、能力保留率 |
| `time-based` | 时间维度 | 恢复时间、停摆时长、响应速度 |
| `none` | 无韧性量化 | 纯方法/算法论文，不涉及韧性 |

如果论文同时用多种，取主导的那种填 `resilience_quant`，其余在 `resilience_quant_detail` 里说明。

### `case` 子结构

```json
"case": {
  "dataset": "UK transport system 公开数据",
  "scenario": "road/rail/water 多式联运，多场景随机中断",
  "region": "UK",
  "scale": "12 节点 / 28 链路 / 50 订单 / 100 场景"
}
```

`scale` 可选，描述问题规模（节点数、订单数、场景数），便于横向对比求解难度。

## 真实示例（Hasani Goodarzi et al., 2024）

下面这一整行就是 jsonl 里的一条记录（实际存储时是**单行**，这里展开是为了可读）：

```json
{
  "item_key": "6XL3KWIB",
  "title": "Evaluating the sustainability and resilience of an intermodal transport network leveraging consolidation strategies",
  "authors": "Hasani Goodarzi et al.",
  "year": 2024,
  "venue": "Transportation Research Part E",
  "doi": "10.1016/j.tre.2024.103616",
  "keywords": [
    "resilient intermodal network",
    "vulnerability of transportation networks to disruptions",
    "scenario-based two-stage stochastic model",
    "Lagrangian relaxation and valid inequalities"
  ],
  "related_streams": [
    "intermodal freight network design",
    "transport network vulnerability & resilience",
    "sustainable/green freight",
    "consolidation strategies"
  ],
  "positioning": "已有研究多单独看可持续性或韧性；本文在多式联运网络里把两者连同集并放进一个场景化两阶段随机规划联合优化，并量化集并对韧性的杠杆作用",
  "method": {
    "framework": "two-stage stochastic programming",
    "algorithm": "Lagrangian relaxation + valid inequalities",
    "is_mip": true
  },
  "objective": "min E[运输成本 + 韧性成本 + 环境可持续性成本]",
  "decision_vars": [
    {"symbol": "X_{ijs}^{km}", "type": "continuous", "meaning": "场景s下订单k用方式m在链路(i,j)上的流量"},
    {"symbol": "Z_{ijs}^{km}", "type": "binary", "meaning": "场景s下订单k是否用方式m经过链路(i,j)"},
    {"symbol": "U_{s}^{k}", "type": "continuous", "meaning": "场景s下订单k无法满足的货物量(lost sales)"},
    {"symbol": "\\beta_{ij}^{mp}", "type": "binary", "meaning": "是否对链路(i,j)方式m采取准备活动p"},
    {"symbol": "\\gamma_{ijs}^{mw}", "type": "binary", "meaning": "场景s下是否对链路(i,j)方式m实施恢复活动w"},
    {"symbol": "con_{ijs}^{m}", "type": "integer", "meaning": "场景s下链路(i,j)方式m的集并操作次数"},
    {"symbol": "Y_{ij}^{m}", "type": "integer", "meaning": "链路(i,j)方式m的车辆总数(车队规模)"},
    {"symbol": "DL_{ks}", "type": "continuous", "meaning": "场景s下订单k的运输延迟"}
  ],
  "constraints": [
    "流量守恒（需求满足 + lost sales）",
    "容量约束（受中断场景影响）",
    "各场景下集并后的车辆数",
    "集并前的各订单车辆数",
    "集并操作次数",
    "韧性预算约束：事前+事后+交互成本 ≤ A"
  ],
  "resilience_quant": "economic",
  "resilience_quant_detail": "四维经济量化：投资端(准备p/恢复w的成本与容量提升Δq)、风险端(容量下降g、时间增加δ)、惩罚端(缺货u_k·U、延迟u'_k·DL)、资源端(韧性预算A约束(12))。韧性表现 = min[(准备+恢复成本) + E(缺货+延迟惩罚)]",
  "case": {
    "dataset": "UK transport system 公开数据",
    "scenario": "road/rail/water 多式联运，多场景随机中断",
    "region": "UK"
  },
  "key_results": [
    "韧性投资杠杆效应：总成本的0.3%~0.4%投入准备+恢复 → 总预期成本降3%~4.7%",
    "预期延迟成本降24.6%",
    "说明有限韧性预算下事前+事后组合投资能以小博大"
  ],
  "gap_or_limitation": "未考虑需求端不确定性；集并策略对韧性的影响仅在经济维度验证",
  "note_key": "ND2BTHHS",
  "tags": ["两阶段随机规划", "供应链韧性", "多式联运"]
}
```

实际写入 jsonl 时压缩成一行（`json.dumps(..., ensure_ascii=False)`）。

## 分析用法速查

```bash
# 找所有用两阶段随机规划的论文
jq 'select(.method.framework | test("two-stage"; "i"))' literature.jsonl

# 列出每篇的韧性量化方式，做综述分类
jq -r '[.item_key, .resilience_quant] | @tsv' literature.jsonl

# 找所有用了 Benders 的论文标题
jq -r 'select(.method.algorithm | test("Benders"; "i")) | .title' literature.jsonl

# Python：跨论文对比决策变量
import pandas as pd
df = pd.read_json("literature.jsonl", lines=True)

# DuckDB：直接 SQL 查 JSONL
duckdb -c "SELECT title, year FROM 'literature.jsonl' WHERE resilience_quant = 'economic'"

# 直接问 AI：对比 literature.jsonl 里所有韧性量化方式，列成表
```
