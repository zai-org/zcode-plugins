---
description: 健康报表：门禁拦截/债务/规律命中/僵尸清单/钩子活性一屏读（观测期仪表盘，只读不改）
allowed-tools: Read, Bash
---

# /regress:stats — 健康报表

一屏读完治理实况。**只读**——本命令不改任何状态，全部数据来自既有产物。
观测期仪表盘（病例：v1.26.1 审计时手工统计部署差异，本命令是那次需求现场的工具化）。

## 执行（六个既有 CLI，零新采集）

```bash
# 1. 提交观测：通过/绕门禁/覆盖率/技术债
python3 "<插件路径>/hooks/scripts/lib/history.py" .regress summary

# 2. 考古地层：跨会话重复失败（稳定经验候选）
python3 "<插件路径>/hooks/scripts/lib/journal.py" . digest

# 3. 规律账本：固化候选 🦴 / 降级候选 🍂
python3 "<插件路径>/hooks/scripts/lib/rules_ledger.py" . health

# 4. 钩子活性（链外看门狗；P1#14 双路径：用户级装机在 regress-guard-docs，插件模式在插件根）
{ python3 ~/.zcode/regress-guard-docs/check_docs.py 2>/dev/null || python3 "<插件路径>/scripts/check_docs.py"; } 2>&1 | grep -E "config.file.invalid|空 matcher" || echo "钩子链健康"

# 5. 机器事实卡：条数/最老/陈旧（机制存活判据：长期零新增=死重可退场）
python3 "<插件路径>/hooks/scripts/lib/facts.py" health

# 6. 僵尸清单：planning/verifying 搁置 >30 天（哨兵口径）
grep -l "status: planning\|status: verifying" .regress/manifests/*.md 2>/dev/null | while read f; do
  age=$(( ( $(date +%s) - $(stat -c %Y "$f") ) / 86400 ))
  [ $age -gt 30 ] && echo "⏰ $(basename $f) 已搁置 ${age} 天"
done; true

# 7. 推送闭环（v1.34）：送达率/待决未决/误报率——告警从广播到可度量可校准
python3 "<插件路径>/hooks/scripts/lib/notify.py" stats

# 8. 待决裁决：人类说「有用/误报/忽略」后由 agent 记账（对号，见推送正文〔待决#N〕）
python3 "<插件路径>/hooks/scripts/lib/pending.py" list --pending

# 9. 块消息有效性（v1.47 影子采集，GEPA 评分环）：拦截消息即提示词——
# 同清单同原因反复被拦=消息没教会 agent；🚨 无效候选（≥3 且跨会话/跨 7 天，
# 分母恒带）值得改写消息文案；⚠️ repeat 是告警级观察
python3 "<插件路径>/hooks/scripts/lib/history.py" .regress nudge

# 10. 顾问采纳率（v1.49，给裁判装评分器）：adopted+partial 计入采纳；
# 低采纳率=顾问意见不合用，校准咨询姿势（finish 代谢位落 advisor_adoption 事件）
python3 "<插件路径>/hooks/scripts/lib/journal.py" . adoption

# 11. 召回有效性（v1.58，事件序代理·弱证据只排序）：rule_recall 后同清单
# 直接放行=干净解决；间有拦截=带干预解决（单列不加总）；未决。扩召回接线看这里
python3 "<插件路径>/hooks/scripts/lib/history.py" .regress recall

# 12. 拦截热力图（v1.62）：commit_blocked 按 reason 聚合频次——高频原因
# 就是下一个该接召回的拦截点（v1.54 只挂3点，扩点看这里的数据）
python3 "<插件路径>/hooks/scripts/lib/history.py" .regress heatmap
```

## 输出格式

```
📊 regress-guard 健康报表 · <项目名>
  门禁：<n_pass> 过 / <n_outside> 绕行（IDE 直提）/ 债 <debt> 笔
  地层：<n_events> 事件 / 跨会话重复失败 <n_sig> 个签名
  规律：<n_rules> 条（🦴 固化候选 <a> / 🍂 降级候选 <b>）
  事实卡：<n_facts> 条机器事实 / 最老 <age> 天 / 🍂 <n_stale> 条未刷新
  钩子：健康 | ⚠️ <看门狗告警>
  僵尸：<无 | ⏰ 清单×n>
```

## 解读要点

- **绕行率持续高** → 门禁采用率问题（IDE/终端直提），不是测试问题——先解决提交习惯
- **债不还** → 赦免权闭环失效的前兆（PHILOSOPHY §11）
- **规律只涨不落** → 该跑 learn 并修剪降级候选（熵增警戒）
- **事实卡长期零新增** → 机制死重，摘掉 finish 的机器级分支即退场（机制也要代谢）
- 全部为零 → 项目刚开始或钩子长期静默——用第 4 项确认链活性
