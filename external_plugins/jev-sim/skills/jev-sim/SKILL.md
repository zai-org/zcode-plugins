---
name: jev-sim
description: 用会话内大模型模拟 Jev 决策模型：把分类、路由、布尔判断、评分变成类型化决策，输出带校准概率的 JSON，有 NONE 出口，不确定时弃答。当用户要"帮我分类/路由/评分/判断真假/风险筛查"，或输入 /jev、说"决策判断"时使用。开放式写作、精确查找、算术、能写成确定性规则的判断不要用它，直接做。
---

# jev-sim：会话内决策模型

把"判断题"从聊天变成机器可读的决策。模仿 Jev 的三个原语：

- **Choice**：从候选里选一个，返回每个选项的概率（分类、路由、分支）
- **Noul**：给一个命题，返回它为真的概率 0-1（布尔判断、风险筛查）
- **Score**：按等级量规（rubric）打分，返回各等级分布（排序、质量判断）

核心机制（没有 token 概率时的替代方案）：**字母作答 + 选项轮转消位置偏差 + 对称问句消框架偏差 + 多次采样频率估概率 + 温度缩放校准**。

## 总流程（四步）

1. **类型化**：把用户请求解析成 `{state, question, options}`（Choice）、`{state, proposition}`（Noul）或 `{state, question, rubric}`（Score）。state 是背景材料原文，不要自己概括后塞进问题——判官要读原文。
2. **采样**：按下面的原语协议，用 Agent 工具并行派出多个判官子代理（subagent_type 用 general-purpose），每个判官只回一行 JSON。
3. **聚合**：把选票写进 votes 文件，跑 `scripts/aggregate.py` 得到概率分布和决策。
4. **输出**：按"输出契约"给用户 JSON；`none`（无选项成立）或 `clarify`（置信不足）时建议补充背景重问或升级人工。

## Choice 协议

默认 **K=3 次轮转采样**（选项多或要求高时可加到 5）。

轮转方法（循环左移，照抄 AnyJev 的 cyclic shift）：n 个选项、第 i 轮（i=0..K-1）左移 `round(i*n/K)` 位。例：4 选项 3 轮 → 位移 0、1、3→即 [A,B,C,D]、[B,C,D,A]、[D,A,B,C]。**每次轮转后字母按新顺序重新编 A、B、C…**，聚合时按 order 数组映射回原选项。

选项上限：字母作答最多支持 26 个选项（A-Z）。更多时分组进行：每组 ≤26 个初筛，每组前 1-2 名进入决赛轮，在结果里注明"分组采样"。

判官提示词模板（每个采样一次，一字不差地填入 Agent 工具的 prompt，不要附加别的上下文）：

```
你是决策判官，只做判断，不聊天，不解释。
严格只输出一行 JSON：{"answer":"<一个字母>","confidence":<0-100整数>}

【背景】
{state}

【问题】
{question}

【选项】
A. {选项1}
B. {选项2}
C. {选项3}
...

从选项中选唯一最可能的。answer 只能是上面出现的字母；若所有选项都不成立，answer 输出 "NONE"。
```

把 K 个采样并行派出（一条消息里多个 Agent 调用）。收齐后写 votes 文件：

```json
{
  "primitive": "choice",
  "question": "…",
  "state": "…（可省）",
  "options": ["原选项1", "原选项2", "…"],
  "votes": [
    {"rotation": 0, "order": ["原选项按轮转0的顺序"], "letter": "B"},
    {"rotation": 1, "order": ["…"], "letter": "A"},
    {"rotation": 2, "order": ["…"], "letter": "B"}
  ]
}
```

`letter` 正常是 A-Z；判官答了 NONE 时写字符串 `"NONE"`。NONE 是显式出口：它和最高选项概率直接竞争，NONE 占多数时结果进入 `none` 状态，不再硬选。

## Noul 协议

布尔判断没有选项顺序可轮转，用**对称问句**造出三个不同视角的样本：

1. **正向**："命题 P 为真吗？" → TRUE/FALSE
2. **反向**："命题『非 P』为真吗？" → TRUE/FALSE（结果反转回来）
3. **证据式**：先在心里各找一条最强的支持和反对证据，再判 P → TRUE/FALSE

三个模板都要求只回一行 `{"answer":"TRUE|FALSE","confidence":<0-100>}`。反向样本的 p_true 取 `1 - 输出概率`。三个估计取平均得 p_raw。

## Score 协议

把量规等级当 Choice 的选项跑（等级=选项，"1=完全不符 … 5=完全符合"），得到各等级分布后报**众数等级 + 期望分值**（Σ 等级×概率）。用户给了评分标准就用用户的，没给就先拟一份量规给用户过目再打分。

## 聚合与校准

votes 文件写好后执行（脚本在本插件 `scripts/` 下，路径相对本 SKILL.md 是 `../../scripts/`）：

```bash
python "<插件根>/scripts/aggregate.py" --input votes.json [--threshold 0.6]
```

脚本做的事：letter 按 order 映射回原选项（NONE 票单独计）→ 计票 → 频率归一化成 p_raw → 若存在 `scripts/calibration.json` 则做温度缩放 `p_cal ∝ p_raw^(1/T)` → 按阈值判 status（answer/none/clarify）。Noul 输入格式见脚本头部注释。没有 Python 环境时手工聚合：计票/K 即 p_raw，报告保留这个事实。

## 输出契约（给用户看的东西）

```json
{
  "primitive": "choice",
  "protocol": "jev-sim/0.2",
  "status": "answer",
  "question": "这封邮件路由给谁？",
  "decision": { "type": "choice", "choice": "客服-退款", "probability": 0.72 },
  "probabilities": [
    { "option": "客服-退款", "probability": 0.72 },
    { "option": "法务", "probability": 0.14 },
    { "option": "销售", "probability": 0.14 }
  ],
  "confidence": 0.72,
  "threshold": 0.6,
  "abstained": false,
  "samples": [ { "rotation": 0, "vote": "客服-退款" } ],
  "calibrated": true
}
```

规则：
- `status` 三态：`answer`（正常决策）、`none`（NONE 票占多数，无选项成立）、`clarify`（最高概率低于阈值，置信不足）。采样失败、脚本报错等环境错误按错误原样上报，**不要伪装成决策**。
- `none` 状态：`decision.choice` 为 null，`probabilities` 仅作参考（意思是"如果硬选会是它"）；要明确告诉用户"没有选项成立，考虑改问题或补选项"。
- **缺失即未知**：背景材料不足以判断时判官会给 NONE 或低置信，输出侧如实转成 none/clarify，绝不替判官脑补。
- `confidence` = 最高档概率（校准后）。**它不是模型心情，是投票频率经校准后的数**。
- 阈值默认 0.60 只是起点值。在自己的评测集上跑过校准后，按"想拦下多少错误 vs 忍受多少弃答"的权衡设定，不存在通用正确值。
- 附一句人话解读 + 哪个选项跟它竞争。不要长篇解释。

## 校准流程（一次性/定期）

概率可信的前提是拟合过温度。拿 20-50 道带标准答案的历史题，按 Choice 协议采样后整理成 results.jsonl（每行 `{"id","correct","probs":{选项:原始概率}}`），然后：

```bash
python "<插件根>/scripts/calibrate.py" --results results.jsonl
```

脚本算准确率、ECE（校准误差），拟合温度 T 写进 `scripts/calibration.json`，之后 aggregate.py 自动使用。**没有跑过校准时，输出里标 `"calibrated": false` 并提醒用户概率偏自信。**

## 成本控制

- 默认 K=3；重要决策再加轮次，不值得的加采样是烧 token。
- 批量同类判断（如一批邮件各自路由）时，可以把多个条目拼进同一个判官调用（每条一行 JSON 输出），但同批各条目要用不同轮转相位，并在结果里注明"批量采样"。
- 判官提示词保持极简——判官不需要知道任务背景之外的事。
