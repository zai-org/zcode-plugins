---
name: rfauto-mcp-navigator
description: >-
  导航并驱动 RFAuto（rfauto）射频/微波 EDA 框架的 208 个 MCP 工具。用户要综合或仿真射频器件（滤波器、耦合器、功分器、天线、电感等）、创建或轮询仿真 run、读取 S 参数指标、调参优化，或核对仿真结果是否可信时使用。触发词：rfauto、射频、微波、功分器、滤波器、耦合器、天线、S 参数、仿真、调参、synthesis、simulate。物理数字只能来自 rfauto 确定性内核，不由模型生成。
---

# rfauto MCP 导航（按需展开）

## 铁律 7（先读）

频率、损耗、尺寸、S 参数这些物理数字，一律来自 rfauto 确定性内核或求解器的工具返回值。你负责编排工具调用、读懂返回信封、如实转述。想估算某个物理量时，不要自己算，改为调用对应的工具，例如 `synthesize`、`run_calculator`、`create_run_async`。

## 工具面约定

- 工具名形如 `mcp__plugin_rfauto_rfauto__<tool>`。服务器共注册 208 个工具，完整列表用 `tools/list` 获取。分组目录见 [references/toolsets.md](references/toolsets.md)。
- 工具返回统一信封：`{ok: bool, data: ...}`，失败时为 `{ok: false, error: ...}`。体检类工具的业务结论（例如 verdict=FAIL）写在 data 里。`ok=false` 只表示调用失败，或门判了 FAIL。读字段，别只看 ok。
- 会话开工第一步：调用 `doctor`（无参数，秒级返回），确认环境和可用通道。
- 资源：工具集目录是 `rfauto://toolsets/definition`。7 张器件卡以 `skill://<卡名>/SKILL.md` 暴露，卡内参考文件经 `skill://<卡名>/references/<path>` 读取。

## 常用工具（插件精选 18 个）

上游没有官方的高频清单。下表是本插件挑选的常用工具，不是上游定义。其余工具见 references/toolsets.md。

| 生命周期 | 工具 | 用途 |
|---|---|---|
| 体检 | `doctor` | 盘点 AEDT、ADS 等通道的环境，无许可的流程不受影响 |
| 体检 | `list_models` | 已注册的器件模型和模板族 |
| 体检 | `validate_recipe` | 校验配方 YAML：文件、结构、模板、键名、单位和目标。建 run 之前必须先调 |
| 求解 | `create_run_async` | 发起仿真作业（异步，长时间运行的首选） |
| 求解 | `poll_job` / `wait_job` | 轮询或等待作业。`wait_job` 默认等待 600 秒，长作业请显式传 `timeout_s` |
| 求解 | `get_metrics` | 读取 run 指标（s11、s21、iso 等，机器可读） |
| 求解 | `get_run_artifacts` | 列出 run 产物（Touchstone、manifest、报告） |
| 求解 | `compare_runs` | 跨 run 对比 |
| 综合 | `synthesize` | 器件综合，用闭式物理给出初始尺寸 |
| 综合 | `synthesize_bpf` | 带通滤波器综合 |
| 综合 | `run_calculator` | 确定性物理计算器（默认可见 340 个键）。任何闭式量先查这里 |
| 判读 | `runs_verify` | 产物新鲜度：fresh / stale / legacy / error。采信前必须调 |
| 判读 | `em_doctor_check` | 建模期端口语义体检。16 项中已实装 10 项，其余 6 项返回 SKIP |
| 判读 | `em_metrics_from_run` | 从 run 提取器件指标（L/Q/SRF/S21，另有 C/R） |
| 判读 | `em_diff_runs` | 两个 run 的对拍（params、manifest、sparams、freshness 四节） |
| 判读 | `explain_run` | 对失败给出确定性规则面的解释 |
| 判读 | `diagnose` | run 诊断 |

## 三个工作流模式

1. **综合 → 仿真 → 判读**：synthesize → validate_recipe → create_run_async → poll_job → get_metrics → runs_verify，不放心时再用 explain_run。配方模板从 `list_template_specs` 查起。
2. **判读既有结果**（不确定能不能信）：直接用 rf-verdict 技能（从 `runs_verify` 起手），或派发 `rf-judge` 子代理。
3. **调参闭环**：配方的 objectives 就绪后调用 `start_tune`，拿到作业号后 `poll_job`，再 `get_metrics`。调参结果的修正只用 rfauto 确定性工具，不要自己编数值。

## 引擎阶梯纪律（必须转述给用户）

- `fake` 通道是闭式解析近似，秒级返回，无需许可，只用来验证配方和管线。**不要用 fake 的数字下物理结论。**
- `openems`（开源 FDTD，需自行从源码编译）是扫描和校准的主力；`hfss`、`ads` 是商用通道，用来仲裁和终验。
- 每层只做它能证明的事。跨引擎仲裁看 `em_diff_runs`，以及锚注册表（`anchors_list` / `anchors_inspect`）。

## 全集发现（按需，别一次读完）

208 个工具中，124 个归入 14 个工具集（见 [references/toolsets.md](references/toolsets.md)），每个工具集附调用纪律和坑号出处。其余 84 个工具未归入任何工具集，用 `tools/list` 查看。遇到不熟的领域（EMC、PDN、UQ、数据平台、格式解析、KiCad、远程多机等），先读对应小节。

## 反模式（禁止）

- 不要用常识"补算"工具没有给出的物理数字。
- 不要跳过 `validate_recipe` 直接建 run，也不要采信未通过 `runs_verify` 的产物。
- 不要把 `ok=false` 的信封当成功转述。
- 工具找不到时，先调 `doctor` 看环境。只剩 `rf_env_doctor` 时，说明服务器未能启动（插件诊断模式），按它的报告修复。不要凭记忆编造工具名。
