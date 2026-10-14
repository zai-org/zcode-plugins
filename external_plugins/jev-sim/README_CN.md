# jev-sim：会话内决策模型

用当前 ZCode 会话里的大模型（GLM）模拟 [Jev](https://typesafe.ai) 式决策模型。把"判断题"变成带概率的类型化决策——不调外部决策模型 API、不需要 API key、数据不出本机。

## 三个原语

| 原语 | 输入 | 输出 | 典型用途 |
|---|---|---|---|
| Choice | 背景 + 问题 + 选项 | 每个选项的概率 + NONE 出口 | 分类、路由、分支 |
| Noul | 背景 + 命题 | 命题为真的概率 0-1 | 布尔判断、风险筛查 |
| Score | 背景 + 量规 | 等级分布 + 期望分值 | 排序、质量评估 |

## 工作原理

Jev 的底层是把决策变成句子填空，用 token 概率给每个候选打分。会话模型拿不到 token 概率（GLM API 不开放 logprobs），所以用替代机制，全部来自开源决策模型社区的已验证做法：

1. **字母作答**（letter readout）——判官子代理只回一行 JSON（选项编成 A-Z）
2. **选项轮转**（cyclic shift，AnyJev 的 L0 层）——同一问题换选项顺序问 K=3 遍，消除位置偏差，选票分歧本身就是信息
3. **对称问句**（Noul 专用）——正问、反问、证据式三视角，消除框架偏差
4. **频率即概率**——K 张选票平滑归一化成原始概率分布
5. **温度缩放校准**——拿带标准答案的题拟合温度 T，`p_cal ∝ p_raw^(1/T)`；指示模型普遍过自信，这步把"投票一致性"翻译成"历史上这种把握实际对多少"

## 输出契约

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
  "none_probability": 0.02,
  "confidence": 0.72,
  "threshold": 0.6,
  "abstained": false,
  "calibrated": true
}
```

`status` 三态：**answer**（正常决策）、**none**（NONE 票占多数——没有选项成立，不硬选）、**clarify**（最高概率低于阈值，建议补背景重问或人工处理）。采样/脚本层面的错误按错误原样上报，不伪装成决策。

## 使用

安装后新建任务，在 composer 里选中 jev-sim 技能，直接给判断题：

> 背景：发件人李某，正文：你们平台 2 号下单的椅子到货就是断腿的，联系客服三天没人理，今天不退款就投诉……
> 问题：这封邮件路由给哪个团队？选项：市场 / 客服-退款 / 法务 / 销售

**适用**：分类、路由、布尔判断、按量规评分、风险筛查。
**不适用**：开放式写作、精确符号/字符串查找、算术、能写成确定性规则的判断——这些直接做，不过决策协议。

校准（建议首次使用前跑一次）：`python scripts/calibrate.py --results eval/your-results.jsonl`，生成 `scripts/calibration.json` 后所有决策自动套用。自带 `eval/choice-eval.jsonl` 是 12 题种子评测集，方法见 SKILL.md"校准流程"。

## 副作用与依赖声明

- **网络访问：无。** 全部采样发生在当前 ZCode 会话内，不请求任何外部 API，不发送任何数据。
- **模型依赖：** 使用会话内置大模型（通过 Agent 工具派出判官子代理）；无需额外账号或密钥。
- **命令执行：** 运行 `python scripts/aggregate.py`、`scripts/calibrate.py`（仅 Python 标准库）做本地聚合与校准。
- **文件写入：** 常规使用只把结果输出到对话。仅当主动运行校准时会在插件 `scripts/` 下写 `calibration.json`；聚合脚本只读指定的 votes 文件。
- **无 hooks、无 MCP server、无后台进程，不收集凭据或用户数据。**

## 第三方来源与许可

- Choice/Noul/Score 原语分类参考 Jev（System One，TypeSafe AI）的公开概念；本插件与其无关联。
- 选项轮转去偏差思路参考 AnyJev 论文（Nokia Applied Research，Apache-2.0）的 cyclic shift，未复制其代码。
- 本插件全部代码原创，MIT License。

## 测试结果（2026-10-14，GLM-5.3 判官）

**单元测试**（合成数据，验证脚本数学）：Choice 字母→选项映射、平滑、灰区弃答全部正确；校准器在合成误差数据上把 ECE 从 0.125 降到 0.042（T=1.45，正确软化方向）；期间发现并修复了黄金分割搜索的边界更新 bug。0.2.0 新增的 NONE 出口与 status 三态通过九条路径冒烟测试（多数 NONE 正确触发 none、平票触发 clarify、选项概率重归一正确）。

**真模型评测**（12 道易题 + 8 道陷阱题，各 3 轮转，共 60 张选票）：60/60 全对，零选票分裂，判官自报置信度 72-100（均值约 97）。位置偏差检验：三个轮转下判官始终按选项内容作答，未观察到位置偏差。后果：20 题全对使温度拟合退化（"全对数据证明不了什么"），**本插件不预置 calibration.json**，输出如实标注 `calibrated: false`，直到用自己的标注题跑过校准。

**三原语功能演示**：Choice（邮件路由，4 选项 3 轮转）3/3 一致 → 0.928；Noul（合同条款，三视角）0.95/0.98/0.96 → p_true 0.963；Score（5 级量规）3/3 一致 → 4=满意，期望分值 3.88。

**诚实结论**：GLM-5.3 当判官在明确题上高度一致，频率概率经常是 1.0（平滑后约 0.93）；弃答与 NONE 机制只在判官分裂（真分歧/真难题）时触发。要刻画真实失败率，需要用你自己业务里"会错"的题重新跑校准。

## 已知边界

- 每次决策要派 K 个判官子代理，比直接调专用决策模型 API 慢、费会话 token（省的是 API 费和隐私）
- 概率来自采样频率而非 token logit，分辨率受轮次 K 限制（K=3 时非 NONE 票只有 0/⅓/⅔/1 四档）
- 字母作答支持 ≤26 个选项，更多需分组初筛（见 SKILL.md）
- 校准没跑过之前，输出标 `calibrated: false`，概率偏自信

## 目录

```
.zcode-plugin/plugin.json   插件清单
skills/jev-sim/SKILL.md     决策协议（核心）
scripts/aggregate.py        选票聚合 + 温度缩放 + NONE/status
scripts/calibrate.py        ECE 计算 + 温度拟合
eval/choice-eval.jsonl      12 题种子评测集
```

## 版本

- 0.2.0 —— NONE 显式出口与 `status` 三态输出；选项上限与分组采样说明；阈值声明（默认 0.6 仅为起点）；审计字段（protocol/threshold/n_samples/none_probability）；中英 README
- 0.1.0 —— Choice/Noul/Score 三原语、轮转采样、温度缩放校准、20 题评测（60/60 票正确）
