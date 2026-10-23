---
description: 分析历史+检测框架规则，输出项目洞察，写入 AGENTS.md
allowed-tools: Read, Write, Edit, Bash
---

# /regress:learn — 学习项目规律

分析历史 + 框架 co-change 规则，输出洞察，**写入 AGENTS.md**。

## 执行

```bash
# 历史分析
python3 "<插件路径>/hooks/scripts/lib/history.py" .regress summary

# 框架 co-change 规则
python3 "<插件路径>/hooks/scripts/lib/cochange_rules.py" .

# 考古地层挖掘（公理三：跨会话重复失败 = 稳定经验）
python3 "<插件路径>/hooks/scripts/lib/journal.py" . digest
```

## 考古地层（.regress/journal/events.jsonl）

工具失败、风险动作、用户纠正三类化石自动埋入地层（随 git 入库，重启不丢）。
`journal.py digest` 输出**跨会话出现 ≥2 次**的重复失败签名（单会话高频是重试噪声，
跨会话重复才是稳定经验）。

digest 不为空时，对每条重复签名：
1. `journal.py . raw` 找到该签名的历次现场（时间/会话/上下文）
2. **三问归因（v1.46，GEPA 借思想）**——把"模型错了"翻译成"规则该改"：
   - **① 错误定位**：哪个推理步骤出的错（读哪份文件/哪个假设/哪次调用）？
   - **② 规则归因**：AGENTS 契约或命令文档的**哪一条**导致或未能阻止这个错误？
     （归因不到具体条款=这不是规则问题，是知识缺口——走 facts/machine-facts 而非改契约）
   - **③ 改进建议**：那一条该怎么改（定向改写，不是"更小心"式泛泛建议）？
3. 写入下方项目规律块，格式：`- 「<签名>」反复失败 ×N（N 个会话）：定位 <步骤>，归因条款 <契约第几条/命令某节>，改法 <定向建议>`
4. **同步记账（v1.24 代谢链）**：
   ```bash
   python3 "<插件路径>/hooks/scripts/lib/rules_ledger.py" . record --sig "<签名>" --occurrences <N>
   ```
   首次沉淀 hits=1；同签名再检出（下次 learn 又见到它）= 命中一次——
   命中是固化的证据，没记过账的规律块只会膨胀（实测：真实项目 3 周 18 节）。
   新沉淀若输出「⚠️ 近重复候选」（v1.57 源头去重）→ 是同一规律的改写就改用
   `supersede --old <旧> --new <新>` 链接版本，别让账本双胞胎膨胀
5. **匹配型证据只用于排序（GEPA 6.3 防线）**：规律"恰好命中"（任务顺利只是因为
   没踩到坑）只作排序参考，不单独构成沉淀/固化依据——否则"改得越少→匹配越多
   →分越高"会把规律带向保守；沉淀要的是失败现场的归因，不是顺利时的巧合

**产品否决同样可挖（v1.26）**：digest 之外查 `design_rejected` 类化石——
跨任务重复的产品否决（行业惯例/用户习惯/该简化）升格为产品规律，写入
`.regress/product-context.md` 的「设计否决记录」段，稳定后晋级「行业惯例」段。

## 纠正聚类（v1.94.0，122：纠正化石从只埋不挖到进 learn）

digest 自本版起纳入 `user_correction`（kind 字段区分，签名形如
`correction:<摘录前16字>`）。**同主题纠正跨会话 ≥2 次 = 用户反复纠正同一类
误解**——比工具失败更稀缺的信号（"自信地错"没有失败信号，纠正词是唯一探测器）：

1. 对 digest 里 kind=user_correction 的条目，`journal.py . raw` 回放历次纠正原文
2. 三问归因照走，但①错误定位优先问：**AI 当时自认为对的是什么？**（纠正击中的
   是假设而非步骤——写清被击碎的假设比写清步骤值钱）
3. `how=not_correction` 的 disposition 化石 = 已判 FP 的纠正，归因时剔除
4. 写入项目规律块的格式：`- 用户反复纠正「<主题>」×N：被击碎的假设 <was>，修正 <reality>`

另外顺手看 `pending_corrections`（`journal.py . raw` 尾部的
correction_disposition 高水位之后仍有的 user_correction）——长期挂起的
未处置纠正是纪律漏洞的直接证据，值得点名。

## 如果 total_commits == 0
告诉用户："暂无历史数据。用了几次后再来。"

## 如果 tech_debt > 0
```
💳 技术债务：{debt} 笔 bypass 未补回归
```

## 如果 outside_gate_commits > 0
```
📤 {n} 次提交未走门禁（IDE/终端直提或历史回填）——门禁采用率的诚实镜子
```

## 如果 avg_coverage_pct 非 null
```
📊 平均测试覆盖率 {n}%（jest 项目自动采集）
```

## 如果 top_f3_files 不为空 → 写入 AGENTS.md
```markdown
<!-- regress-guard learn start -->
## 项目规律（/regress:learn 自动发现）
- 改 src/auth/ 时，src/utils/validator.js 通常需要同步改（出现 5 次）
<!-- regress-guard learn end -->
```

## 报错自救合流（v1.15）

清单里预先写的 rescue（报错→自救命令）与地层学出的失败根因是同一回路的两端：

- digest 里的签名，若在活跃/历史清单的 `rescue:` 或「报错自救」表里已有对策 →
  把「报错关键词 → 自救命令」写进上面的项目规律块（跨任务的 FAQ）
- 只有失败没有对策 → 标注"待补自救"，下次踩同坑时先回填清单再修

## 规律健康（v1.24：记账的另一半是衰变）

```bash
python3 "<插件路径>/hooks/scripts/lib/rules_ledger.py" . health
```

- 🦴 **固化候选**（hits ≥3）：稳定规律建议固化为宿主 skill——输出卡片**等人批准**，
  批准后用 skill-creator 造（地层是脂肪，规律是肌肉，skill 是骨骼）
- 🍂 **降级候选**（>180 天零命中）：提示人工修剪——**本工具永不自动删 AGENTS.md**
  （人类文件红线）；只进不出的"知识库"是熵增库
- 空 digest + 空账本 → 告诉用户"暂无可沉淀规律"，不硬凑

## 自主决策
- 发现规律 → 直接写入项目 AGENTS.md（不问用户）
- 数据太少（<3 次提交）→ 告诉用户多用几次再来
