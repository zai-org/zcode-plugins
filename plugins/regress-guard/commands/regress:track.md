---
description: 对比 git diff 发现 F3 并直接回写（AI 完成修改后自动执行，不需用户手动触发）
argument-hint: [manifest-id]
allowed-tools: Read, Write, Edit, Bash, Grep
---

# /regress:track — 发现 F3 并回写

**AI 完成代码修改后应自动执行此命令，不等用户手动触发。**

对比 `git diff` 与清单，找出 F3（计划外改动），**直接回写**，汇报结果。

## 执行（不等确认）

```bash
git diff --name-only HEAD 2>/dev/null
git ls-files --others --exclude-standard 2>/dev/null
```

1. 找最新 `status != done` 的清单
2. 对比 `planned_changes`，找出不在清单中的文件 = F3
3. **直接回写**到 `actual_changes`——**这也是开发边界的扩界出口**：被 boundary_guard
   拦下的文件，回写 actual_changes 后边界随之扩展（扩界必须经过这一步 = 留痕）
4. 为每个 F3 分析影响范围（`grep -rl` 找引用方）
5. 输出汇报

## 自主决策（不问用户）

- F3 只改注释/格式 → 忽略
- F3 改了逻辑 → 回写 + 提示补测试
- F3 是新文件 → 回写 + 提示补测试

## 过滤规则（自动忽略）

`.regress/`、`AGENTS.md`、锁文件、纯 `.md`、`*.test.*`

## 输出

```
🔍 改动审计完成
  ✅ F1, F2（计划内）
  ⚠️  F3: src/utils/validator.ts → 已回写

继续提交。
```

无 F3 时：`✅ 无计划外改动，可以提交。`
