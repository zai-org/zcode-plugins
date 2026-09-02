# vet-companies — 企业尽调

[English](./README.md)

面向中国境内企业（上市或非上市）的交易对手与企业尽调：结构化尽调报告、关联方与供应链图谱、
风险记录快扫。服务对象是信贷、一级市场、供应商准入和合规团队。

## 快速开始

从 ZCode 插件管理器安装，然后直接跑命令，或者用自然语言描述任务 —— `vet-companies` agent
会判断工作模式并加载对应 skill。

```text
/vet-companies:dd-report 某某科技有限公司 供应商准入
/vet-companies:risk-scan 供应商名单.txt
```

## 组件

**Agent** —— `agents/vet-companies.md` 扮演信贷与交易尽调助理：选定工作模式、执行数据源优先级
顺序、并落实下面的产出约束。

| 命令 | 作用 |
| --- | --- |
| `/vet-companies:dd-report` | 完整企业尽调报告 —— 工商登记、股权、风险记录、舆情 |
| `/vet-companies:related-parties` | 关联方图谱 —— 股权链条、兄弟公司、供应链关系 |
| `/vet-companies:risk-scan` | 风险记录快扫（失信/涉诉/处罚/质押/担保/舆情），支持单家或批量 |

| Skill | 职责 |
| --- | --- |
| `dd-report` | 组装完整报告：主体识别、工商画像、股权与关联方、产业链位置、风险记录、负面舆情，发债主体另加财务预警信号 |
| `related-party-map` | 股东、对外投资、兄弟公司、上下游客户与供应商、资金链关系，输出结构化关系图谱 |
| `risk-scan` | 按严重度排序的风险筛查：失信被执行 / 终本案件 / 限制高消费 / 涉诉 / 行政处罚 / 股权质押与冻结 / 对外担保 / 破产重整 / 司法拍卖，以及负面舆情 |
| `report-render` † | 分页 PDF 或可编辑 DOCX 交付物，正确的中日韩字形渲染、按密度定尺的图表、可点击的 `[n]` 引注，以及强制的渲染后自检环节 |
| `xlsx-author` † | 专业 `.xlsx` 工作簿，含公式构造规范和交付前强制的重算 / 错误值检查 |

† 共享的产出类 skill，由上游单点生成后 vendored 进每个金融插件，见 [`UPSTREAM.md`](./UPSTREAM.md)。

## 数据源与认证

| MCP 服务 | 数据 |
| --- | --- |
| `tianyancha` | 天眼查 —— 工商登记、股权、涉诉与风险记录、上下游客户供应商关系 |
| `hexin-bond` | 同花顺 iFinD —— 债券与发行主体数据 |
| `wind-docs` | Wind —— 公告与研究文档 |

三个都是**跑在 ZCode 自有网关上的远程 HTTP MCP 服务**（`${ZCODE_BASE_URL}`），
声明在 [`.zcode-plugin/plugin.json`](./.zcode-plugin/plugin.json) 里。身份由宿主按调用注入
（`auth: {type: zcode_official, provider: jwt_token}`）。

**不需要你配置任何 API key、token 或数据商账号。** 插件不直连任何数据供应商，本身也不携带凭据。

本插件标记了 `requiresPaidPlan`：这些服务背后的工商、债券与公告数据是有许可的商业数据，不是免费额度。

## 它在你机器上做什么

| | |
| --- | --- |
| Hooks | 无 —— 本插件不装任何 hook，不拦截你的工具调用 |
| 网络访问 | 只出宿主网关 `${ZCODE_BASE_URL}`，不访问任何第三方端点 |
| 写文件 | 报告与工作簿交付物（`.pdf` / `.docx` / `.xlsx`）及其构建中间产物，落盘位置由两个产出 skill 按自己的规则选定 |
| 执行程序 | 两个产出 skill 会跑 `python3`；**无头 LibreOffice（`soffice` / `libreoffice`）** 用于 xlsx 公式重算和 DOCX→PDF 校验；`fc-list` 用于字体检查 |
| Python 依赖 | `report-render` 需要 `reportlab`、`matplotlib`、`pypdf`、`pypdfium2`、`pillow`、`fonttools`（见 `skills/report-render/scripts/requirements.txt`）；`xlsx-author` 需要 `openpyxl` |
| 降级行为 | 没装 LibreOffice 时 `xlsx-author` 返回 `recalc_unavailable` 并只做静态检查 —— 它明确**不**把这种情况当作通过 |

## 适用范围与复核

尽调产出是**待有资质的专业人士复核并签字的草稿**，不是信贷决策、不是合规结论、也不构成投资建议。
每一条实质性结论都带来源标注，便于复核者逐条核查；查不到来源的项会作为缺口列出，而不是含糊带过。

工商与涉诉记录反映的是上游数据商在查询时点已收录的内容 —— **查不到记录不等于不存在记录**。

## 来源

从上游 Z.ai 项目 vendored 而来，`agents/`、`commands/`、`skills/` 由上游生成，不要在此处修改。
ZCode 适配层（清单、本 README、市场条目）由本仓库拥有。尚未关闭的发布门禁 —— 上游许可未声明、
源 commit 带 `+dirty` —— 记录在 [`UPSTREAM.md`](./UPSTREAM.md)。
