# accounting-and-reporting — 核算与报告

[English](./README.md)

以企业自有账套为输入的核算与报告工作。一切从你提供的试算平衡表或总账导出开始 —— 本插件不读任何行情数据，也不调用任何外部服务。

## 快速开始

从 ZCode 插件管理器安装，然后直接跑命令，或者用自然语言描述任务 —— `accounting-and-reporting` agent 会判断
工作模式并加载对应 skill。

## 组件

**Agent** —— `agents/accounting-and-reporting.md` 选定工作模式、执行数据源优先级顺序，并落实下面的产出约束。

| 命令 | 作用 |
| --- | --- |
| `/accounting-and-reporting:close-review` | 关账前扫描试算平衡表与关账清单 —— 区分阻断项与警告项、异常余额 |
| `/accounting-and-reporting:map-accounts` | 科目表之间的映射，证明余额守恒，并暴露 1:N / N:1 与性质不匹配 |
| `/accounting-and-reporting:reconcile` | 把两个总体勾稽到能解释差异的具体交易，并逐笔归因 |
| `/accounting-and-reporting:statements` | 从试算平衡表编制法定口径财务报表与附注工作稿，每处勾稽都是活公式 |
| `/accounting-and-reporting:tie-out` | 复核他人编制的报表 —— 表内、跨表、上期比较与附注一致性 |

| Skill | 职责 |
| --- | --- |
| `month-end-close-review` | 关账前扫描：阻断项与警告项分开、按方向识别异常余额、遗漏计提 |
| `ledger-reconciliation` | 勾稽做到根因 —— 总账对明细账、账面对业务台账、报表对报表 |
| `account-mapping` | 两套科目表之间的映射，用于合并、系统迁移或列报变更，并证明余额守恒 |
| `financial-reporting` | 从试算平衡表编制法定口径报表与附注工作稿 |
| `statement-consistency-check` | 对他人编制的报表做三表勾稽复核 |
| `report-render` † | 分页 PDF 或可编辑 DOCX 交付物 —— 正确的中日韩字形渲染、按密度定尺的图表、可点击的 `[n]` 引注，以及强制的渲染后自检 |
| `xlsx-author` † | 专业 `.xlsx` 工作簿 —— 公式构造规范，交付前强制重算与错误值检查 |
| `audit-xls` † | 审查表格的公式正确性与常见错误，可限定区域、单表或整个模型 |

† 共享的产出类 skill，由上游单点生成后 vendored 进每个金融插件，见 [`UPSTREAM.md`](./UPSTREAM.md)。

## 数据源与认证

本插件**不声明任何 MCP 服务**。它完全基于你提供的账套、试算平衡表或报表工作，因此不需要任何
行情数据授权，也不需要付费套餐，故未标记 `requiresPaidPlan`。

## 它在你机器上做什么

| | |
| --- | --- |
| Hooks | 无 —— 本插件不装任何 hook，不拦截你的工具调用 |
| 网络访问 | 无 —— 没有 MCP 服务，也没有对外请求 |
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
