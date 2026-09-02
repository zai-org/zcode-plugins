# assess-credit — 固收研究

[English](./README.md)

面向境内债券的固收与信用研究：债券档案（含估值与风险指标）、发行主体信用评估、曲线与利差分析、信用风险跟踪清单。

## 快速开始

从 ZCode 插件管理器安装，然后直接跑命令，或者用自然语言描述任务 —— `assess-credit` agent 会判断
工作模式并加载对应 skill。

## 组件

**Agent** —— `agents/assess-credit.md` 选定工作模式、执行数据源优先级顺序，并落实下面的产出约束。

| 命令 | 作用 |
| --- | --- |
| `/assess-credit:bond` | 单只债券档案 —— 条款、兑付安排、估价/溢价、久期/凸性/利差、发行主体 |
| `/assess-credit:issuer` | 发行主体信用评估 —— 杠杆、覆盖倍数、流动性、担保圈与关联占款、信息披露 |
| `/assess-credit:curve` | 一组债券的曲线与信用利差全貌，按评级/期限/行业/属性分层 |
| `/assess-credit:credit-watch` | 区间内信用跟踪 —— 到期墙、负面披露、利差走阔、担保圈传染 |

| Skill | 职责 |
| --- | --- |
| `bond-profile` | 发行条款与兑付安排、实时估价/溢价、久期/修正久期/凸性/利差，以及主体背景 |
| `issuer-credit` | 评估主体而非债券 —— 杠杆、覆盖倍数、短期流动性、股权背景 |
| `curve-spread` | 按评级 / 期限 / 行业 / 属性（城投 vs 产业）分层的水平与利差，对照基准曲线 |
| `credit-watch` | 单主体或名单的区间监控 —— 到期墙、负面舆情、估值恶化 |
| `report-render` † | 分页 PDF 或可编辑 DOCX 交付物 —— 正确的中日韩字形渲染、按密度定尺的图表、可点击的 `[n]` 引注，以及强制的渲染后自检 |
| `xlsx-author` † | 专业 `.xlsx` 工作簿 —— 公式构造规范，交付前强制重算与错误值检查 |

† 共享的产出类 skill，由上游单点生成后 vendored 进每个金融插件，见 [`UPSTREAM.md`](./UPSTREAM.md)。

## 数据源与认证

| MCP 服务 | 数据 |
| --- | --- |
| `hexin-bond` | 同花顺 iFinD —— 债券与发行主体 |
| `wind-bond` | Wind —— 债券与估值 |
| `wind-economic` | Wind / EDB —— 宏观与经济指标序列 |
| `tianyancha` | 天眼查 —— 工商登记、股权、涉诉与风险记录 |
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
