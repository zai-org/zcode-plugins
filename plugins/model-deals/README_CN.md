# model-deals — 交易测算

[English](./README.md)

面向并购、IPO、定增与配股的交易结构与测算：增厚/摊薄分析、资金来源与用途及形式资本结构、可比交易、募投与摊薄测算。

## 快速开始

从 ZCode 插件管理器安装，然后直接跑命令，或者用自然语言描述任务 —— `model-deals` agent 会判断
工作模式并加载对应 skill。

## 组件

**Agent** —— `agents/model-deals.md` 选定工作模式、执行数据源优先级顺序，并落实下面的产出约束。

| 命令 | 作用 |
| --- | --- |
| `/model-deals:accretion` | 为某次收购搭建增厚/摊薄模型（形式 EPS、盈亏平衡协同与换股比例） |
| `/model-deals:sources-uses` | 为某笔交易编制资金来源与用途表及形式资本结构 |
| `/model-deals:deal-comps` | 手工搭建可比交易集 —— 公告条款、交易倍数、控制权溢价 |
| `/model-deals:capital-raise` | 测算一次一级发行（定增/配股/IPO/可转债）—— 规模、定价、募投用途、摊薄 |

| Skill | 职责 |
| --- | --- |
| `accretion-dilution` | Excel 里的并购后果模型 —— 双方独立盈利、对价结构、协同、盈亏平衡 |
| `sources-uses` | 收购价构成、资金来源、费用，以及由此形成的形式资本结构 |
| `deal-comps` | 从股票事件与公告中识别候选交易，再构建倍数集 |
| `capital-raise` | 确定发行规模、定价、募投用途安排，并计算摊薄 |
| `report-render` † | 分页 PDF 或可编辑 DOCX 交付物 —— 正确的中日韩字形渲染、按密度定尺的图表、可点击的 `[n]` 引注，以及强制的渲染后自检 |
| `xlsx-author` † | 专业 `.xlsx` 工作簿 —— 公式构造规范，交付前强制重算与错误值检查 |

† 共享的产出类 skill，由上游单点生成后 vendored 进每个金融插件，见 [`UPSTREAM.md`](./UPSTREAM.md)。

## 数据源与认证

| MCP 服务 | 数据 |
| --- | --- |
| `hexin-stock` | 同花顺 iFinD —— A/H 股 |
| `finance-search` | 财经网页与新闻检索 |
| `wind-stock` | Wind —— A/H 股 |
| `wind-docs` | Wind —— 公告与研究文档 |

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
