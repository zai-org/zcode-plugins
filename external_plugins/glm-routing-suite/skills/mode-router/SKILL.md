---
name: mode-router
description: 四阶段渐进工作流协议（了解/对齐→拟合方案→开发→验证）+ 交付证据门禁 + 任务分类辅助。开始多步任务前、任务接近完成时、或用户说"路由/选模式/delivery check"时使用；单步快问答、用户已明确指定工作方式时不用。
---

# mode-router：四阶段工作流 + 交付门禁

移植自 [yjh051108/dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite)（MIT）router-standard v1.20 的**实测主线设计**：persona 固定，价值在**阶段纪律**和**交付门禁**——模型最大的失败模式不是"不够聪明"而是"没对齐就动手、没验证就宣告完成"。

## 四阶段协议（完成信号驱动，不跳级）

| 阶段 | 做什么 | 完成信号（触发晋级） |
|---|---|---|
| **0 了解/对齐** | 理解任务维度，处理歧义 | 关键歧义已澄清（问了且得到回答），或已记录假设 |
| **1 拟合方案** | 设计到"决策完备"，定义完成标准 | 计划已记录（todo/方案文本） |
| **2 开发** | 把产物做出来并**自检通过** | 自检通过，跑 delivery_check |
| **3 验证/交付** | 验证真产物，收集证据 | delivery_check 全 PASS |

**纪律**：工具使用本身绝不跳级；完成信号是唯一的晋级方式。某阶段缺工具=工具分配问题，不是给出口。

## 各阶段要点（上游 STAGE_GUIDES 打磨版语义）

**阶段 0（深想，别只取第一个读法）**：把请求拆维度（用户要什么/功能该怎么表现/"好"长什么样），浮出真歧义。**按影响决定问不问**：只有一种合理解读 → 一句话声明假设继续；两种以上解读会实质改变产物（重排 vs 归类；持久化与否）→ 每个歧义问一个聚焦问题带具体选项。不问到底也不审问琐碎。

**阶段 1（注意力回收）**：任务目标+当前决策+活证据留在注意力窗口；已定的探索细节沉下去（记录），过期线索真放手——"什么都可能有用于心"是注意力泄漏不是勤勉。独立子问题吃主线预算时推给子代理。**设计到决策完备**（做什么/怎么拼/成功长什么样），不是列步骤。

**阶段 2（防局部最优）**：迭代时保持整个产物可用。同一细节缠斗数轮不收敛 → 退一步：(1) 它阻塞交付还是只是打磨？(2) 保一个可用版本，细节并行迭代；(3) 抗拒的细节先跳过，其余做完再回头。改前重读文件；write/edit 结果只取路径和操作，用 grep/read 看变化行。

**阶段 3（假设审计 + 门禁）**：验证失败先做一行假设审计——(a) 我在重查哪个假设，(b) 刚获得的新证据是什么。代码确实没错就说没错继续，**不要为重做制造 bug**。验证真产物不是它的摘要。

## 交付门禁（核心工具）

宣告完成前**必须**跑（纯本地校验，只读文件）：

```bash
python "<插件根>/scripts/delivery_check.py" --file <交付物路径> [--url <页面地址>] --evidence evidence.json
```

evidence.json 至少一项证据，8 种 kind：`file / page / image / run / test / text / external / numeric`。规则：
- 视觉类（page/image）必须 `reviewed: true`（真看过截图，不是"应该没问题"）
- 页面交付物（--url）要求至少一项 reviewed 的视觉证据
- run/text 必须带 result 文本；file/page/image/test 必须带 target 路径
- 有可测不变量（守恒量/计数/编译通过）就加 numeric 证据——把"我认为对"变成"我验证过"
- **FAIL 就修了重跑，不许绕过**；PASS 才向用户报告完成

## 任务分类（辅助信息，不换 persona）

`scripts/route.py --text "<任务>"` 做正则分类（build/fix/weak）——用于报告任务性质和选择阶段侧重（build 类阶段 2 是重心，fix 类阶段 0 排查是重心）。上游实测：按 band 换 persona 的老设计已被 v1.20 放弃，persona 固定，行为靠阶段纪律约束。

## 常驻习惯

- **任务回显**：每轮记住自己在为哪件事工作（第一条用户任务的浓缩）
- **主动性协议**：每轮等用户前扫描下一个可行动项——未完成的工作、未验证的声明、可逆的改进。选一个做掉并报告；只有属于用户的选择（偏好/预算/不可逆/外部审批）才问。两步以上依赖就一步步想，但可逆的事不停下来要许可
- **we-form 自我陈述**（"我们先对齐"而非"让我……"）——上游实测 you-form 是 let-me 吸引子

## 与 hook 的关系（默认零注入）

上游铁律"未触发=官方原样"：**装上插件后默认零注入、零拦截**——UserPromptSubmit 钩子静默。要开启每消息一行的纪律提醒：

```bash
python "<插件根>/scripts/suite_mode.py on     # 开启 discipline 提醒
python "<插件根>/scripts/suite_mode.py off    # 回到零注入
```

## 分级任务协议（graded，重任务可选）

多步复杂任务才用（轻任务别上流程税）。**显式 opt-in**：模型调 `graded.py commit_star` 即激活。七步链：

```
commit_star 定稿（北极星目的宣言，≥12字，"为谁/处境/价值/结果"句式）
→ edit_plan --level 1（大类：title/spec/accept[]，全必填）
→ lock_stage --level 1（先复检后锁定）
→ edit_plan --level 2（小类：title/spec/accept[]/do/verify，全必填；已锁大类不可增改名）
→ lock_stage --level 2（锁定回执=完整规格单，status --verbose 看）
→ review --decision approve|reject（拒绝回 l2-edit 修订重锁；通过进开发）
→ mark_task 逐项打卡 →（verify=redteam 项须先 redteam_verdict 裁决通过）→ 全完 final → delivery_check
```

命令都是 `python "<插件根>/scripts/graded.py" <子命令>`，回执默认摘要（状态+下一步），`status --verbose` 按需拉全量规格单（控制上下文膨胀）。**拒绝=状态不变**：校验失败不落盘。`graded.py off` 随时退出回官方原样。

配套开关：`suite_mode.py on --mode graded` 让钩子注入 graded 徽章行（阶段+任务+红队灯）。

## 变体预设（对应上游 router-standard / router-spec / router-react 三预设）

钩子提醒的风格档，`suite_mode.py preset <档>` 切换（不动开/关状态）：

| 档 | 对应上游 | 注入的纪律侧重 | 适合 |
|---|---|---|---|
| `standard`（默认） | router-standard | 按任务分类自动选侧重（build→动手 / fix→先查），四阶段完成信号晋级 | 日常混合任务 |
| `spec` | router-spec（深思优先） | 先读全上下文、穷尽歧义、长思维链推演后再动手；改前重读 | 架构设计/复杂重构/易错域 |
| `react` | router-react（动手优先） | 直接写/改，产出→验证→修复紧环，不搭没要的脚手架 | 明确小任务/原型/演示 |

单次决策的显式覆盖仍走 `route.py --mode spec|react|weak|数字`——preset 影响每消息常驻提醒的口径，--mode 是一次性的。

**脑暴与红队的概率性判断**（选项怎么出、红队裁决信心）：若 jev-sim 插件可用，用其 Choice/Noul 协议做决策点；未装则按确定性规则自行判断——不硬依赖。

## 阶段门禁（PreToolUse 软门禁）

graded 会话处于规格阶段（brainstorm/l1-edit/l2-edit/review）时，插件通过 PreToolUse 钩子**扣住 write/edit/multiedit**——把"规格未审核不开发"从自觉变成硬约束。特性：

- **解锁即写**：`graded.py review --decision approve` 通过后立即放行；`graded.py off` 退出分级模式也放行
- **防卡死**：连续拦 3 次（10 分钟窗口）自动降级为警告放行，绝不把会话锁死
- **状态自保护**：`~/.glm-routing-suite/` 下状态文件仅 CLI 可写——Write/Edit 指向它们一律拒（防篡改门禁）
- **fail-open**：钩子任何异常静默放行（纪律工具不是安全边界，宁可放过不可卡死）
- 这是**软门禁**：bash 写文件等路径不在拦截面内，靠协议纪律补

装机后可手动验证：`printf '%s' '{"tool_name":"Write","tool_input":{"file_path":"C:/x.txt"}}' | python "<插件根>/hooks/gate_hook.py"`（无 graded 会话时应无输出退出 0）。
