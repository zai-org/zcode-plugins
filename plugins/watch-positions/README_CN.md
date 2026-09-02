# watch-positions — 持仓跟踪

[English](./README.md)

面向 A/H/美股的自选与持仓跟踪：持久化自选清单、带异动归因的盘后复盘、持仓相关事件提醒，以及盘中实时视图。

## 快速开始

从 ZCode 插件管理器安装，然后直接跑命令，或者用自然语言描述任务 —— `watch-positions` agent 会判断
工作模式并加载对应 skill。

## 组件

**Agent** —— `agents/watch-positions.md` 选定工作模式、执行数据源优先级顺序，并落实下面的产出约束。

| 命令 | 作用 |
| --- | --- |
| `/watch-positions:watchlist` | 管理持久化自选清单（新建、添加、移除、查看） |
| `/watch-positions:recap` | 自选清单的盘后复盘，含异动归因 |
| `/watch-positions:events` | 扫描自选清单的公告、质押、解禁与风险事件 |
| `/watch-positions:intraday` | 自选清单的盘中快照，含相对基准涨跌 |

| Skill | 职责 |
| --- | --- |
| `watchlist` | 创建、更新、查看与校验以 JSON 文件保存的持久化自选清单 |
| `close-recap` | 逐只标的涨跌、市场与行业背景，并对照已披露事件做异动归因 |
| `event-monitor` | 区间内的公告、业绩预告、股权质押、解禁 |
| `intraday-watch` | 实时报价、相对基准涨跌，以及哪些标的波动超出常态区间 |
| `report-render` † | 分页 PDF 或可编辑 DOCX 交付物 —— 正确的中日韩字形渲染、按密度定尺的图表、可点击的 `[n]` 引注，以及强制的渲染后自检 |
| `xlsx-author` † | 专业 `.xlsx` 工作簿 —— 公式构造规范，交付前强制重算与错误值检查 |

† 共享的产出类 skill，由上游单点生成后 vendored 进每个金融插件，见 [`UPSTREAM.md`](./UPSTREAM.md)。

## 数据源与认证

| MCP 服务 | 数据 |
| --- | --- |
| `hexin-stock` | 同花顺 iFinD —— A/H 股 |
| `hexin-index` | 同花顺 iFinD —— 指数与成份股 |
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
