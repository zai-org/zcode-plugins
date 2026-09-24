---
description: 查看交付链：需求→会话→事件→提交 的可追溯视图（文本版 Inspector）
argument-hint: [manifest-id]
allowed-tools: Read, Bash
---

# /regress:trace — 交付链追溯

把 `.regress/history.jsonl` 按 **意图→过程→产出** 组织成可读的交付链（借鉴 Harness Inspector 的证据链模型，文本版实现）。

## 执行

```bash
python3 "<插件路径>/hooks/scripts/lib/history.py" .regress trace
```

## 输出示例

```
📌 REGRESS-001  (2026-08-12T17:20)
   └─ 会话 sess_3744109b
       🚫 17:20 commit_blocked untracked_files → src/utils/validator.js
       🔍 17:21 f3_discovered
       ✅ 17:22 commit_passed (jest) @a3f8c2d1
   📦 产出: 1 次放行提交

📌 REGRESS-002  (2026-08-13T11:32)
   └─ 会话 sess_7f9299c9
       ⚠️ 11:32 error
       ✅ 11:32 commit_passed (none) @b7e1f0a9
   📦 产出: 1 次放行提交
```

## 怎么读

| 元素 | 含义 |
|------|------|
| 📌 manifest | 意图锚点——哪个需求 |
| └─ 会话 | 过程锚点——哪次 ZCode 会话 |
| ✅/🚫/⚡/❌ | 事件：放行/阻断/bypass/测试失败 |
| @sha | 产出锚点——基于哪个提交 |

## 用途

- **检查交付**：一个需求经历了什么（多少阻断、是否 bypass、最后有没有产出）
- **发现异常**：一个需求挂了很多会话但 0 产出 → 卡住了
- **审计 bypass**：⚡ 事件有到期时间，可对照是否补了回归

## 哨兵视图（v1.34 多会话）

trace 看历史，哨兵看**现在**——多会话并行时任何单个会话都看不见别人的
活跃清单（冲突只在集成点现形）。先跑：

```bash
python3 "<插件路径>/hooks/scripts/lib/sentinel.py" .
```

一屏看清：活跃清单 × 会话归属（本会话/他会话/共享无戳）× 悬停时长
（in-progress >1 天 ⚠️、blocked 🛑 在等人类），以及**多会话声明了同一
文件**的重叠清单——提交前先对焦，比提交后回滚便宜。门禁的跨会话拦截
消息会指路到这里。
