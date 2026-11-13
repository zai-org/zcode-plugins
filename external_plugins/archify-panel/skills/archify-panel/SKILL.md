---
name: archify-panel
description: "用 Archify 生成架构图、流程图、时序图、数据流、状态机、ERD、类图、树、时间线与瀑布图，产物直接显示在 ZCode 侧栏面板，可在面板里导出 PNG、SVG 与分享卡片。当用户要画图、画架构、画流程、画时序、画状态机、画 ERD、画类图、看代码库结构、看请求时序、看故障时间线时使用。"
license: Apache-2.0
---

# Archify 侧栏画板

用 Archify 的 JSON IR 描述一张图，插件把它渲染成单文件 HTML 并显示在 ZCode 侧栏面板。

## 何时使用

用户要画图、看结构、看时序、做架构梳理时使用本技能。图是本技能唯一的交付物，文字只用来补充图里放不下的结论。

## 怎么生成

先调用 `get_authoring_assets` 拿到 schema 与用例的绝对路径，读完对应 schema 再调用 MCP 工具 `render_diagram`：

```text
render_diagram(type, spec, title, quality?)
```

- `type`：图的类型，见下面的类型路由表
- `spec`：完整的 Archify JSON IR（对象）
- `title`：图的标题，同时是导出文件名
- `quality`：`showcase`（默认，信息密度适合阅读）或 `standard`（密集大图）

工具返回后会做四道质量关卡（校验、交付、静态检查、浏览器测量）。关卡全过时用户看到的是一张成品图；浏览器关卡被跳过时图照样交付，工具结果里会写明"未做浏览器校验"，回复时如实转达。

工具失败时按返回的 `diagnostics` 修图再调一次，不要反复提交同一份。

## 类型路由

写图前先调用 `get_authoring_assets`，它返回 schema、用例与写作参考的绝对路径；读对应 schema 再写字段，用例只学形状不抄内容。

| 类型 | 用途 | Schema | 用例 |
|---|---|---|---|
| `architecture` | 组件、服务、云与安全边界、基础设施 | `architecture.schema.json` | `production-deployment.architecture.json` |
| `workflow` | 流程、审批关卡、工具调用、CI/CD | `workflow.schema.json` | `agent-tool-call.workflow.json` |
| `sequence` | 接口调用链、请求生命周期、异步追踪 | `sequence.schema.json` | `cache-miss-request.sequence.json` |
| `dataflow` | 管道、ETL/ELM、血缘、数据治理 | `dataflow.schema.json` | `product-analytics.dataflow.json` |
| `lifecycle` | 状态与状态迁移、重试、等待、终态 | `lifecycle.schema.json` | `deployment-release.lifecycle.json` |
| `erd` | 表与实体、字段、主外键、基数 | `erd.schema.json` | `orders.erd.json` |
| `class` | 类、接口、成员、依赖与继承关系 | `class.schema.json` | `payments.class.json` |
| `tree` | 单父级包含：仓库树、模块树、能力拆解 | `tree.schema.json` | `payment-platform.tree.json` |
| `timeline` | 何时发生：故障复盘、发布史、事件时钟 | `timeline.schema.json` | `payment-incident.timeline.json` |
| `waterfall` | 时间花在哪：一次请求或一次运行的耗时分布 | `waterfall.schema.json` | `checkout-request.waterfall.json` |

字段细节见 `authoring-contract.md`，整体画法约定见 `authoring-defaults.md`，画真实仓库时再读 `repository-authoring.md`。

## 写图的要点

- 所有图共用顶层：`schema_version`、`diagram_type`、`meta`、`cards`（可选）。`meta` 里放 `title`、`subtitle`、`locale`、`quality_profile`。
- 节点与关系用新写的 ID 与措辞，不要复制用例里的原句。
- 没有节点数目标：写全该写的，不为了凑数删关系，也不为了填满加关系。
- 优先让渲染器自动布线，只在分支、回路或实测拥挤处指定路径。
- `meta.quality_profile` 默认 `showcase`；只有确实很密的大图才用 `standard`。
- ERD 用表优先画法：字段写在 `entities[].attributes` 里并保留 SQL 类型，`key` 可以是数组（连接表写 `["pk","fk"]`），每个 `fk` 字段都要有 `references`；按业务域分组，每个域用 `tag` 标注并排成一块矩形。
- 需要品牌图标时用 `icon` 或 `brand` 字段。Jenkins、Rust、Vue 三个品牌标已从本插件中剔除（许可限制），用到它们会报 `brand/unknown`，换成中性图标或文字即可。

## 用户在面板里能做什么

- 面板只承载图形本体，常驻完整交互视图，没有额外的面板工具栏。
- 导出、主题、视图预设都在图形自带的工具栏里操作：「导出」菜单可以出 PNG、SVG、WebM 录屏与分享卡片，文件落在工作区 `.archify-panel/exports/` 并弹出另存为。
- 分享卡片需要先在图上选一条路径或一个节点。
- 想让面板切换显示哪张图，直接在对话里说，Agent 调 `open_diagram`。

面板里的图就是交付物，回复时一句话给出结论或提示即可，不要复述图上已有的内容。
