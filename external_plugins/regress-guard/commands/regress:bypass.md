---
description: 紧急绕过回归卡点（限时 + 审计日志），用于 hotfix 等紧急场景
argument-hint: <minutes>
allowed-tools: Read, Write, Edit, Bash
---

# /regress:bypass — 紧急绕过

**仅用于紧急 hotfix 场景。** 限时开启 bypass 模式，期间 commit 不被 hook 阻断，但所有绕过行为记入审计日志。

## 使用场景

- 生产环境紧急 hotfix
- 测试环境快速验证（非正式提交）
- 演示/原型阶段

## 使用方式

参数 `$1` 是绕过时长（分钟），默认 10 分钟：

```
/regress:bypass 10    # 绕过 10 分钟
/regress:bypass 30    # 绕过 30 分钟
```

## 执行

在 `.regress/config.json` 中写入 `bypass_until` 字段：

```bash
# 计算到期时间
EXPIRES=$(python3 -c "
from datetime import datetime, timedelta
mins = ${1:-10}
print((datetime.now() + timedelta(minutes=mins)).isoformat())
")
```

更新 `.regress/config.json`：
```json
{ "strict": true, "bypass_until": "<EXPIRES>" }
```

## 审计

每次 bypass 期间的 commit，hook 会写入 `.regress/bypass.log`：
```
2026-08-11T16:30:00+08:00 | bypass commit by user | <commit message>
```

## 到期自动恢复

bypass 到期后，hook 自动清除 `bypass_until`，恢复严格模式。无需手动关闭。

## 安全提示

```
⚠️  bypass 已开启（<EXPIRES> 到期）

此期间的 commit 不会做回归校验，但会记入审计日志。
到期后自动恢复严格模式。

请确保事后补跑 /regress:verify 验证这些改动。
```
