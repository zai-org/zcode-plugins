# AGENT-HOOKS 多宿主适配层（批158，v1.107.0）

把 regress-guard 的提交门禁暴露为 [AGENT-HOOKS-0.1](https://github.com/responsibleai/agent-hooks)
interceptor——任何实现该契约的宿主（LangGraph / OpenAI Agents SDK / Microsoft
Agent Framework / Semantic Kernel / LlamaIndex / CrewAI / Claude Agent SDK /
裸参考宿主）都能安装。**旗舰场景：AI 谎报 done 直提 main——pre_tool_call
拦截点上的提交门禁。**

## 安装（宿主侧，Python SDK 形态）

```python
from agent_hooks import kind  # 宿主侧 SDK（拦截器本体零依赖）
import sys; sys.path.insert(0, "<regress-guard>/hooks/scripts/lib")
from agent_hooks_adapter import RegressGuardInterceptor

# 宿主注册（config 透传构造参）
INTERCEPTORS = [
    kind("dev.regress-guard.commit_gate",
         lambda config, ctx: RegressGuardInterceptor(**config)),
]
# 中间件安装按各宿主文档：middleware=[create_agent_hooks_middleware(INTERCEPTORS)]
```

构造参：`project_dir`（门禁治理的项目根，缺省=宿主进程 cwd）、
`guard_path`（缺省=适配器旁的门禁脚本）、`timeout`（秒，缺省 600）。

## 能力子集声明（spec §13.2 精神——如实声明，未做的不写）

**覆盖**：仅 `pre_tool_call` 拦截点上的提交门禁子集——检测 tool_call 是否
git 提交类命令（含复合 add+commit 形态），是则调用 regress-guard 完整门禁
（测试自跑+清单状态机+归因+计数对账），结果转译为 allow/deny verdict。

**不覆盖**：其余七个拦截点（agent_startup/input/pre_model_call/
post_model_call/post_tool_call/output/agent_shutdown——全部直接 allow）；
transform（我们不重写命令）；approval 接缝（deny 不带 approval 块=不可
升降，宿主侧 approval seam 未使用）；streaming 向量（AH-CTK-110+）。

**on_error 姿态**：拦截器自身 fail-closed——门禁子进程崩溃/超时/非零退出
一律 deny（reason 前缀 `regress_guard:`，绝不冒用宿主合成词 `host_error:`）。
宿主侧另有 §6.3 兜底（拦截器异常时宿主合成 deny）——双层对齐。

**identity provider**：不使用 approval 接缝，无 content-derived identity。

**规范钉版**：AGENT-HOOKS-**0.1** 语义（context core §4.1 / tool_call
§4.2 / Verdict §5 / 信封 §5.5）。上游升版改字段名时适配器会错位——
失效形态=fail-closed（宿主按非法 verdict 合成 deny），不会静默放行。

## 三档路径（顾问裁：反转白名单制——不确定一律放慢）

- **A 档**：工具名 ∈ 已知非 shell 白名单（Read/Grep/Glob 等读侧）且无命令
  键 → 零开销 allow。
- **B 档**：args 命中命令类键（command/cmd/bash/script/…）→ 进程内跑门禁
  同源提交检测，非提交类 → allow（零子进程）。
- **C 档**：未知形态（新框架新工具名/陌生键）→ 子进程慢路径**让门禁自判**
  ——宁可多付一次快退出的子进程开销，不冒漏拦提交的险。

**缺命令策略**：抽不到任何命令字符串 → 显式 allow（无命令即无提交）。

## 隐私律

evidence 只存元数据（runner/adapter 版本/门禁文件 sha256/路径档位/exit
code/耗时/stderr 摘要），**不存原始命令**（可能含密钥）；canonical JSON
主动截到 spec 上限 10240 字节内。

## ZCode 宿主注意（双门禁）

ZCode 已有原生钩子链跑同一门禁——在 ZCode 上再装本适配器会**双重门禁**
（同一次提交拦两次）。本适配器面向**其他七个框架**的宿主；ZCode 用户用
原生钩子链即可。

## 未做与后续观察位

- 官方 47 场景 CTK 全套运行（conformance/ 目录）——批 2 候选，先证明适配器
  有真实宿主使用者再投入。
- 真实宿主接线实测（任一框架）——「一次适配通吃」目前是契约理论上限，
  无宿主实测背书。
