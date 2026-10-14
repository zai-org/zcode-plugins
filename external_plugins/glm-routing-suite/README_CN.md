# glm-routing-suite：四阶段工作流 + 交付门禁（ZCode 移植版）

复刻自 [yjh051108/dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite)（MIT，7k★）router-standard v1.20 的**实测主线设计**。读完上游 1293 行 bootstrap 源码后修正过方向：v1.20 的价值不在"按任务换 persona"（老设计已弃用，persona 固定为一句 RL 句），而在两件事——

1. **四阶段渐进工作流**：了解/对齐 → 拟合方案 → 开发 → 验证。完成信号驱动晋级（澄清/计划/自检/交付检查），**工具使用本身绝不跳级**。上游用工具 restrict 强制执行；ZCode 做不到硬限制，以协议+提醒形式生效。
2. **delivery_check 交付证据门禁**：宣告完成前必须过的本地校验——文件存在/非空/UTF-8 三查 + 证据清单（8 种 kind，视觉类必须 `reviewed:true`，页面交付物必须有已复核的视觉证据，数值不变量把"我认为对"变成"我验证过"）。**这部分是完整移植，纯本地文件校验。**

## 组件

| 组件 | 作用 |
|---|---|
| `skills/mode-router` | 四阶段协议：各阶段行为要点（歧义按影响决定问不问、注意力回收、防局部最优、假设审计）+ 交付门禁用法 |
| `scripts/delivery_check.py` | 交付门禁 CLI：`--file <交付物> [--url <页面>] --evidence evidence.json`，FAIL 退出码 1 |
| `scripts/router_core.py` / `route.py` | 任务正则分类（build/fix/weak）——辅助信息，用于报告任务性质和阶段侧重 |
| `hooks/on_prompt.py` | UserPromptSubmit 钩子：任务回显 + 一行阶段纪律提醒，fail-open |

## 快速上手

```bash
# 分类一个任务
python scripts/route.py --text "帮我修一下登录报错"     # → fix（阶段0排查是重心）

# 交付前过门禁（模型在宣告完成前必须跑）
python scripts/delivery_check.py --file dist/app.py --evidence evidence.json
```

evidence.json 示例：

```json
{"items": [
  {"label": "主脚本", "kind": "file", "target": "dist/app.py"},
  {"label": "冒烟运行", "kind": "run", "result": "python dist/app.py --selftest → 3/3 passed"},
  {"label": "语法计数", "kind": "numeric", "result": "42"}
]}
```

## 实测声明（分级标注）

- **上游数字**（三行为带、完成信号晋级、锚点效果、0%→100% 完成率等）：来自 dsh-routing-suite 在 **DSH + DeepSeek 模型**上的 P1-P23 实验（多为 n=2），**未在本移植复现**，仅作设计依据引用
- **本插件自测**（2026-10-14，GLM-5.3）：状态机 34 项穷举单测 + 门禁 13 项单测全过；另做了 n=20 的歧义任务首动作开/关对照（10 任务 × 2 条件 × 2 重复，test/alignment-ab-results.json）——**未观察到聚合效应**（两条件先问率均为 50%；GLM-5.3 裸基线已较高，存在天花板效应）。协议对 GLM 的对齐收益目前是**未证实状态**，不作为卖点宣称

## 与原版的差异（诚实声明）

- 上游用 DSH 运行时注入器做**硬**工具限制（每阶段只见本阶段工具）和 system prompt 常驻阶段声明；ZCode 插件无此能力，本移植以**协议纪律 + 钩子提醒**形式生效，依赖模型遵循
- 上游 `phase_begin`/`phase_advance`/`tools_catalog`（二级披露）/goal 工具/stages.json 持久化均为 DSH 工具系统专属，未移植
- `delivery_check` 语义完整移植（v1.23-v1.28：门禁验证据不自跑浏览器、reviewed 视觉、numeric 非阻断提示），仅交互从"工具调用"变为"CLI 调用"
- 实测数字（完成信号晋级、注意力回收等行为效应）引自上游在 DeepSeek 模型上的实验，未在 ZCode/GLM 复测
- 阶段状态不持久化，按会话上下文维持

## 副作用与依赖声明

- **网络访问：无。** 全部本地。
- **命令执行：** `python scripts/route.py`、`python scripts/delivery_check.py`（仅标准库）。
- **文件写入：无。** 所有脚本只读文件、只写 stdout（delivery_check 退出码 0/1 表达 PASS/FAIL）。
- **钩子：** UserPromptSubmit 一个，fail-open，可在 设置 → 插件 禁用。
- **无 MCP server、无凭据、无数据收集。**

## 安装

本地测试市场：插件市场 → 添加 → 粘贴 `C:\Users\w\Documents\z_fa\plugins` → 个人 → dev-z-fa-e3f2b3e7 → glm-routing-suite → 安装。

## 许可

MIT。移植关系与上游致谢见 [NOTICE](./NOTICE)。
