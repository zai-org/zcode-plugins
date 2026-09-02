# run-fpa — 经营分析

[English](./README.md)

基于企业自有已结账账套的公司财务与 FP&A：管理报表、滚动现金流与损益预测、预算差异归因、情景与盈亏平衡分析、投入决策测算、以及与上市同业的对标。

## 快速开始

从 ZCode 插件管理器安装，然后直接跑命令，或者用自然语言描述任务 —— `run-fpa` agent 会判断
工作模式并加载对应 skill。

## 组件

**Agent** —— `agents/run-fpa.md` 选定工作模式、执行数据源优先级顺序，并落实下面的产出约束。

| 命令 | 作用 |
| --- | --- |
| `/run-fpa:mgmt-report` | 已结账期间的管理口径报表，基于明示的指标字典 |
| `/run-fpa:cash-forecast` | 13 周滚动直接法现金流预测，含应收驱动的回款曲线与最低余额余量 |
| `/run-fpa:reforecast` | 滚动损益重预测 —— 已实现加驱动因子预测，对比预算，以区间形式给出 |
| `/run-fpa:variance` | 实际对预算，按价/量/结构/汇率与费率/用量归因 |
| `/run-fpa:scenario` | 基于具名基准情形的 what-if —— 基准/乐观/压力按参数取值定义，敏感性按影响排序 |
| `/run-fpa:profitability` | 分摊共同成本后的分部盈利能力 |
| `/run-fpa:bp-support` | 业务方案相对建模出的「不做」基准的增量利润与现金 |
| `/run-fpa:benchmark` | 把自身指标与上市同业对标，逐项说明口径调整 |

| Skill | 职责 |
| --- | --- |
| `management-report` | 按组织、业务、产品或区域的多维报表，基于明示的指标字典 |
| `cash-forecast` | 13 周内的期初现金、账龄驱动的回款、各项支出，以及最低余额余量 |
| `rolling-forecast` | 已实现加剩余期间的驱动因子预测，并与预算勾稽 |
| `budget-variance` | 收入端价/量/结构/汇率，成本端费率/用量，每项差异区分时间性或永久性 |
| `scenario-analysis` | 情景由参数取值而非形容词定义，含单变量敏感性与求解出的盈亏平衡 |
| `cost-profitability` | 分摊固定成本后，究竟哪条产品线、客户、渠道或区域真正赚钱 |
| `finance-bp-decision-support` | 同一基准下的方案比较、峰值资金需求，以及增量利润与现金 |
| `peer-benchmark` | 从上市数据构建并确认可比集，明示指标口径调整 |
| `report-render` † | 分页 PDF 或可编辑 DOCX 交付物 —— 正确的中日韩字形渲染、按密度定尺的图表、可点击的 `[n]` 引注，以及强制的渲染后自检 |
| `xlsx-author` † | 专业 `.xlsx` 工作簿 —— 公式构造规范，交付前强制重算与错误值检查 |

† 共享的产出类 skill，由上游单点生成后 vendored 进每个金融插件，见 [`UPSTREAM.md`](./UPSTREAM.md)。

## 数据源与认证

| MCP 服务 | 数据 |
| --- | --- |
| `hexin-stock` | 同花顺 iFinD —— A/H 股 |
| `wind-economic` | Wind / EDB —— 宏观与经济指标序列 |

它们都是**跑在 ZCode 自有网关上的远程 HTTP MCP 服务**（`${ZCODE_BASE_URL}`），声明在
[`.zcode-plugin/plugin.json`](./.zcode-plugin/plugin.json) 里。身份由宿主按调用注入
（`auth: {type: zcode_official, provider: jwt_token}`）。

**不需要你配置任何 API key、token 或数据商账号。** 插件不直连任何数据供应商，本身也不携带凭据。

本插件标记了 `requiresPaidPlan`：这些服务背后的数据是有许可的商业数据，不是免费额度。

## 它在你机器上做什么

| | |
| --- | --- |
| Hooks | 无 —— 本插件不装任何 hook，不拦截你的工具调用 |
| 网络访问 | 只出宿主网关 `${ZCODE_BASE_URL}`，不访问任何第三方端点 |
| 写文件 | 报告、工作簿与演示稿交付物（`.pdf` / `.docx` / `.xlsx` / `.pptx`）及构建中间产物，落盘位置由产出类 skill 按自己的规则选定 |
| 执行程序 | 产出类 skill 会跑 `python3`；**无头 LibreOffice（`soffice` / `libreoffice`）** 用于 xlsx 公式重算与 DOCX→PDF 校验；`fc-list` 用于字体检查 |
| Python 依赖 | `report-render` 需要 `reportlab`、`matplotlib`、`pypdf`、`pypdfium2`、`pillow`、`fonttools`（见 `skills/report-render/scripts/requirements.txt`）；`xlsx-author` 需要 `openpyxl` |
| 降级行为 | 没装 LibreOffice 时 `xlsx-author` 返回 `recalc_unavailable` 并只做静态检查 —— 它明确**不**把这种情况当作通过 |

## 适用范围与复核

产出是**待有资质的专业人士复核并签字的草稿**，不构成投资建议，不是以机构名义发出的评级或
目标价，也不是信贷或合规结论。实质性结论均带来源标注便于逐条核查；查不到来源的项会作为
缺口列出，而不是含糊带过。

## 来源

从上游 Z.ai 项目 vendored 而来，`agents/`、`commands/`、`skills/` 由上游生成，不要在此处修改。
ZCode 适配层（清单、本 README、市场条目）由本仓库拥有。尚未关闭的发布门禁记录在
[`UPSTREAM.md`](./UPSTREAM.md)。
