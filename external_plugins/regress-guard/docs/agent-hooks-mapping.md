# AGENT-HOOKS-0.1 适配映射表（批146 预研——采纳信号落地即开工的弹药）

> 对照对象：Microsoft responsibleai/agent-hooks（MIT，2026-08-27 发布）——
> 开放治理契约：8 拦截点 / allow-deny-transform / fail-closed 类型属性 /
> 审批绑定内容 SHA-256 / 47 场景一致性套件跨 8 框架（含 Claude Agent SDK）/
> 五语言 SDK。本表=我们的七事件钩子链与它的逐点对照+适配评估。
> **行动触发器**：ZCode 或 Anthropic 任一侧出现采纳信号（原生支持该契约）
> 即按本表开工适配——一次适配，八框架入口。

## 一、拦截点映射（8 vs 7）

| AGENT-HOOKS 拦截点 | 本仓对应 | 语义差异/缺口 |
|---|---|---|
| prompt_submit（用户输入前） | UserPromptSubmit: prompt_intercept | 同形（治理上下文前置+纠正/约束埋点）；AGENT-HOOKS 是纯拦截点，我们的 additionalContext 注入是宿主扩展 |
| pre_tool_call（工具调用前） | PreToolUse: 边界/读门禁/执行阀/提交门禁 | 同形核心位——deny≈exit 2（见二） |
| post_tool_call | PostToolUse: risk_watch / rbe post / plan_bridge | 同形；我们另有 PostToolUseFailure（失败流观察）为超集 |
| session_start | SessionStart(startup): self_heal | 同形（自愈/卫生/降级提醒） |
| session_end | —（Stop 是轮末非会话末） | 轻缺口：会话末钩子我们无对应（Stop 每轮=更细粒度超集，语义可映射） |
| permission_request | —（宿主领土：ZCode 权限层） | 缺口属宿主非插件——适配层若提供则透传 |
| notification | —（我们的 notify 是外发通道非拦截点） | 语义不同，无需映射 |
| context_compact | SessionStart(compact): compact_notice | 同形（压缩降级警示） |

**结论**：核心治理位（pre_tool_call/post/prompt/session 四点）全部同形，
两缺口（session_end/permission_request）一属超集语义可映射、一属宿主领土。

## 二、语义对照（同形验证）

| AGENT-HOOKS 机制 | 本仓实况 | 对照结论 |
|---|---|---|
| deny = 阻断决策 | PreToolUse exit 2（宿主契约） | **同形已具备**——适配层只需把 exit 2 翻译成契约 deny |
| fail-closed 类型属性（崩溃/超时必须合成 deny） | 批135：拦截器一切未捕获异常→exit 2；畸形 JSON 统一拦；`python3 -E` 封 env 投毒 | **部分同形**——崩溃面已收口；超时击杀（SIGKILL）仍结构性 fail-open（探针兜可见性），适配时契约侧 timeout→deny 语义反而补我们这个洞 |
| allow / transform 决策 | exit 0（放行）；transform（改写工具参数）无对应 | 缺口：transform 是新能力（如命令改写拆弹）——适配时评估，非必需 |
| 审批绑定内容 SHA-256（防重放） | 内容钉 v1.72（同路径换内容分级防线）+plan_bridge 幂等键=session+plan_hash | **同思想不同位**——我们的钉在配置/计划层，契约钉在审批层；适配可互补 |
| 47 场景一致性套件（跨 8 宿主独立验） | held-out 18 场景冻结束（Goodhart 锁）+82 例基准集 | **互补位**：我们的束更深（Goodhart 锁/基线重冻），他们的跨宿主（我们正缺）——适配后我们的场景可贡献回其套件（上游回馈=可见度） |

## 三、适配工作量评估

- **可原样复用**（语义已同形，只差适配层翻译）：pre_tool_call 四守卫、
  post 观察、prompt 埋点、self_heal——约七成代码面零改动。
- **需适配层**（薄）：exit-code↔deny 翻译器、stdin 载荷格式转换（我们的
  {tool_name, tool_input} vs 契约 schema）、注册面（五语言 SDK 选 Python）。
- **需评估**：transform 决策（新能力，可先 deny/allow 两态起步）。
- **估计**：2-3 批（适配层+一致性套件跑通+场景回馈），单批 ≤10 文件。

## 四、时机与观察位

- 现状：ZCode/Anthropic 均无采纳信号（2026-10-24 复查）；生态在暖
  （第三方分析/治理配置生成器赛道）。
- 触发器：任一宿主原生支持 → 本表即开工令（分发最大杠杆：一次适配通吃
  八框架=Claude Code 生态入口）。
- 反向信号：若官方门禁框架（Anthropic blocking hooks）先落地，本表改为
  竞合分析输入。

## 本表不支持的宣称

- "八框架入口全部等价"——各框架对契约的实现完整度未知（其套件测的是
  契约语义非治理效果）；"七成零改动"是基于本表映射的估计未经实现验证。
