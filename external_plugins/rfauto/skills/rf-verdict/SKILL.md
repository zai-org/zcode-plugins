---
name: rf-verdict
description: >-
  用 rfauto 质量门工具链判读任意来源（人工、脚本、其他 agent）的仿真结果是否可信，给出 TRUSTED / SUSPECT / STALE / UNVERIFIABLE 四态判定和逐门证据。用户问"这个仿真结果可信吗"、采信数字前要核验 run 或 Touchstone、对比两个 run，或仿真完成后需要质检时使用。触发词：判读、可信、验证、质检、verdict、verify、run 目录、touchstone。数值一律来自 rfauto 工具返回。
---

# rf-verdict：仿真结果判读工作流

本技能是验证层：不管结果是谁产出的（人、脚本或其他 agent），流程都一样。全程只读，不改动任何产物。数值只来自工具返回，你的输出是判定结论和证据引用。

四态判定（TRUSTED、SUSPECT、STALE、UNVERIFIABLE）是本插件的判定约定，上游 rfauto 没有同名定义。输入来自上游的字段：`runs_verify` 返回的 fresh、stale、legacy、error，以及 `em_*` 工具的结果。上游另有 `solve_health` 的 healthy / suspect / unhealthy 词表，与本判定无关。

## 四态判定（输出口径，固定）

| 判定 | 语义 | 触发条件 |
|---|---|---|
| **TRUSTED 可信** | 可采信 | freshness=fresh，且本轮所有能跑的门都 PASS |
| **SUSPECT 存疑** | 有数值假象的嫌疑，需人工复查 | freshness=fresh，但有任一门 FAIL 或 WARN（假结果往往看起来很合理）；或 freshness=legacy（无 manifest，最高只能到 SUSPECT） |
| **STALE 失效** | 不可采信 | freshness=stale（产物被顶替、丢失或手改，manifest 指纹对不上） |
| **UNVERIFIABLE 无法验证** | 判不了，如实说明 | 工具不可用；run 目录不存在（freshness=error）；输入既不是 run 也不是可解析的文件 |

门判 FAIL 就如实报 FAIL，写清是哪道门、差多少，证据引用工具原文。

## 判读流程（按序执行，括号内是提前终止或跳过的条件）

1. **定位输入**：`run_id`、run 目录或 Touchstone 文件路径。找不到目录就判 UNVERIFIABLE，并列出你试过的路径。
2. **新鲜度**：`runs_verify`。status 为 stale 时判 STALE，逐条列出 issues（盘上 sha 与登记 sha 的对比），流程到此结束。status 为 legacy 时记一条 note 继续，但最终结论不得高于 SUSPECT。status 为 error 时判 UNVERIFIABLE。
3. **建模期体检**（有模型清单 .yaml/.json 时）：`em_doctor_check`。16 项表中只有 10 项已实装（例如 aperture 覆盖金属、薄层厚度、S 参数合理性），其余 6 项返回 SKIP。已实装项任一 FAIL，就从 SUSPECT 起步。没有清单时记为 skip，这只代表有清单数据的那部分，不要硬凑。
4. **指标提取与物理合理性**：`em_metrics_from_run`。把读出的指标和配方目标（如有）对照。深谷器件要留意判据用的统计量（s11_db_min 还是 max，见工具文档）。
5. **双 run 对比**（用户给了两个 run）：`em_diff_runs`，看 params、manifest、sparams、freshness 四节。
6. **失败归因**（有 FAIL 时）：`explain_run` → `diagnose`，引用确定性规则的输出，不用领域直觉替代规则。
7. **输出判定报告**，格式见下。

## 输出格式（固定）

```markdown
## 判定：<TRUSTED|SUSPECT|STALE|UNVERIFIABLE>
对象：<run_id 或路径>|通道：<adapter>|引擎：<引擎名>
| 门 | 结论 | 证据（工具原文摘录） |
|---|---|---|
| freshness（runs_verify） | fresh | … |
| em doctor（已实装 10 项） | PASS/FAIL/skip | … |
| 指标合理性 | … | 数字全部来自 em_metrics_from_run |
数字出处：每个物理数字后注明来源工具调用。
下一动作：按判定给出 1–3 条（SUSPECT → 建议用 em_diff_runs 对照或换引擎仲裁；STALE → 去找回收的 manifest；UNVERIFIABLE → 说明需要什么输入才能判）。
```

## 原始 Touchstone（.sNp，无 run 目录）

能判的只是其中一部分：`touchstone_info` 可以看端口数、频率轴和数据完整性。`em_doctor_check` 需要清单，裸 sNp 无法判断建模语义。裸文件最高只能给到 SUSPECT，因为没有新鲜度锚点，也没有建模体检，除非配有清单和 manifest。宁可少判，也不要猜。

## 边界

- 只读。任何判读路径都不写文件、不发起新仿真。需要复跑时，建议用户走 navigator 的流程；判读只针对已有产物。
- legacy（老档案，无 manifest）既不是错误，也不是 PASS：如实标注证据等级下降。
- 服务器未能启动、只剩 `rf_env_doctor` 时，先调它报告环境，判 UNVERIFIABLE，不凭记忆判。
