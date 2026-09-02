# write-research — 权益研究

[English](./README.md)

端到端的投资研究产出：业绩前瞻与点评、行业与主题研究、竞争格局、可比公司、估值模型（DCF / LBO / 三表）、模型更新、晨报，以及整合式深度研报。

## 快速开始

从 ZCode 插件管理器安装，然后直接跑命令，或者用自然语言描述任务 —— `write-research` agent 会判断
工作模式并加载对应 skill。

## 组件

**Agent** —— `agents/write-research.md` 选定工作模式、执行数据源优先级顺序，并落实下面的产出约束。

| 命令 | 作用 |
| --- | --- |
| `/write-research:earnings` | 分析季度业绩并产出财报点评报告 |
| `/write-research:earnings-preview` | 编制含情景假设的业绩前瞻 |
| `/write-research:sector` | 撰写行业概览报告 |
| `/write-research:competitive-analysis` | 撰写竞争格局分析 |
| `/write-research:comps` | 构建含交易倍数的可比公司分析 |
| `/write-research:dcf` | 构建 DCF 估值模型，终值倍数参照可比公司 |
| `/write-research:lbo` | 为 PE 收购构建 LBO 模型 |
| `/write-research:3-statement-model` | 填充三表财务模型模板 |
| `/write-research:model-update` | 用新数据更新财务模型 |
| `/write-research:debug-model` | 排查与审计财务模型中的错误 |
| `/write-research:screen` | 执行选股筛选或生成投资想法 |
| `/write-research:morning-note` | 起草晨会纪要 |
| `/write-research:research-report` | 撰写整合式投资研究报告 |

| Skill | 职责 |
| --- | --- |
| `earnings-analysis` | 面向季度业绩的专业权益研究财报点评报告 |
| `earnings-flash` | A 股短平快点评，覆盖业绩预告 → 业绩快报 → 正式报告的三阶段 |
| `earnings-preview` | 预测模型、情景框架，以及决定当季的关键指标 |
| `sector-overview` | 行业全景 —— 市场动态、竞争定位、主要参与者、展望 |
| `competitive-analysis` | 市场定位、竞争对手深挖、对比分析、战略综合 |
| `comps-analysis` | 交易倍数可比公司集 |
| `dcf-model` | 基于公告与卖方数据构建的 DCF 权益估值 |
| `lbo-model` | 面向 PE 交易与投委会材料的 Excel LBO 模型 |
| `3-statement-model` | 三表联动的收入表、资产负债表与现金流量表 |
| `model-update` | 把新披露、指引、宏观变化或修订假设带入既有模型 |
| `research-report` | 公司初次覆盖或深度研究 —— 行业背景、财务、可比与估值合为一份交付物 |
| `idea-generation` | 量化筛选、主题研究与模式识别，用于想法挖掘 |
| `morning-note` | 关于隔夜变化、交易想法与关键事件的简明晨报 |
| `report-render` † | 分页 PDF 或可编辑 DOCX 交付物 —— 正确的中日韩字形渲染、按密度定尺的图表、可点击的 `[n]` 引注，以及强制的渲染后自检 |
| `xlsx-author` † | 专业 `.xlsx` 工作簿 —— 公式构造规范，交付前强制重算与错误值检查 |
| `audit-xls` † | 审查表格的公式正确性与常见错误，可限定区域、单表或整个模型 |
| `pptx-author` † | 基于 python-pptx 的专业 `.pptx` 演示稿 —— 版式约定、模板处理与交付契约 |

† 共享的产出类 skill，由上游单点生成后 vendored 进每个金融插件，见 [`UPSTREAM.md`](./UPSTREAM.md)。

## 数据源与认证

| MCP 服务 | 数据 |
| --- | --- |
| `sec-search` | SEC EDGAR 全文检索 |
| `hexin-stock` | 同花顺 iFinD —— A/H 股 |
| `hexin-global-stock` | 同花顺 iFinD —— 海外股票 |
| `hexin-index` | 同花顺 iFinD —— 指数与成份股 |
| `wind-stock` | Wind —— A/H 股 |
| `finance-search` | 财经网页与新闻检索 |
| `wind-economic` | Wind / EDB —— 宏观与经济指标序列 |
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
| Python 依赖 | `report-render` 需要 `reportlab`、`matplotlib`、`pypdf`、`pypdfium2`、`pillow`、`fonttools`（见 `skills/report-render/scripts/requirements.txt`）；`xlsx-author` 需要 `openpyxl`；`pptx-author` 需要 `python-pptx` |
| 降级行为 | 没装 LibreOffice 时 `xlsx-author` 返回 `recalc_unavailable` 并只做静态检查 —— 它明确**不**把这种情况当作通过 |

## 适用范围与复核

产出是**待有资质的专业人士复核并签字的草稿**，不构成投资建议，不是以机构名义发出的评级或
目标价，也不是信贷或合规结论。实质性结论均带来源标注便于逐条核查；查不到来源的项会作为
缺口列出，而不是含糊带过。

## 来源

从上游 Z.ai 项目 vendored 而来，`agents/`、`commands/`、`skills/` 由上游生成，不要在此处修改。
ZCode 适配层（清单、本 README、市场条目）由本仓库拥有。尚未关闭的发布门禁记录在
[`UPSTREAM.md`](./UPSTREAM.md)。
