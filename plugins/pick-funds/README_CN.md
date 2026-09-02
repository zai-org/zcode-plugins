# pick-funds — 基金研究

[English](./README.md)

覆盖公募基金、ETF 与 LOF 的基金与基金经理研究：多条件筛选、基金与经理画像、持仓与风格分析、以及对候选池的持续跟踪。

## 快速开始

从 ZCode 插件管理器安装，然后直接跑命令，或者用自然语言描述任务 —— `pick-funds` agent 会判断
工作模式并加载对应 skill。

## 组件

**Agent** —— `agents/pick-funds.md` 选定工作模式、执行数据源优先级顺序，并落实下面的产出约束。

| 命令 | 作用 |
| --- | --- |
| `/pick-funds:fund-screen` | 按业绩、风险、规模、持仓或基金经理条件筛选基金 |
| `/pick-funds:fund-profile` | 单只基金的深度画像（业绩、风险、持仓、经理） |
| `/pick-funds:manager-profile` | 跨全部在管产品的基金经理画像，按真实任期对齐 |
| `/pick-funds:holdings` | 持仓分析 —— 名实校验、风格漂移、跨基金重合度 |
| `/pick-funds:fund-watch` | 对已持有或候选基金的持续跟踪 —— 经理、申赎、仓位、漂移、排名 |

| Skill | 职责 |
| --- | --- |
| `fund-screen` | 按类型、业绩、风险、规模、费率、持仓、经理的多条件筛选 |
| `fund-profile` | 相对基准与同类的业绩、风险与回撤、规模与申赎、费率、持仓快照 |
| `manager-profile` | 按任期的业绩记录、风格、容量，以及全职业生涯的在管产品变动 |
| `holdings-style` | 持仓与名义对比、跨报告期的风格漂移、集中度、跨基金重合 |
| `fund-watch` | 区间内的经理变更、规模与申赎冲击、仓位变化、风格漂移 |
| `report-render` † | 分页 PDF 或可编辑 DOCX 交付物 —— 正确的中日韩字形渲染、按密度定尺的图表、可点击的 `[n]` 引注，以及强制的渲染后自检 |
| `xlsx-author` † | 专业 `.xlsx` 工作簿 —— 公式构造规范，交付前强制重算与错误值检查 |

† 共享的产出类 skill，由上游单点生成后 vendored 进每个金融插件，见 [`UPSTREAM.md`](./UPSTREAM.md)。

## 数据源与认证

| MCP 服务 | 数据 |
| --- | --- |
| `hexin-fund` | 同花顺 iFinD —— 基金 / ETF / LOF |
| `hexin-index` | 同花顺 iFinD —— 指数与成份股 |
| `hexin-stock` | 同花顺 iFinD —— A/H 股 |
| `finance-search` | 财经网页与新闻检索 |
| `wind-fund` | Wind —— 基金 |
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
