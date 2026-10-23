---
description: 检查并更新 regress-guard 到最新版（手动触发；SessionStart 也会自动检测）
allowed-tools: Bash
---

# /regress:update — 更新

手动检查源目录是否有新版本，有则升级。

**通常不需要手动跑**——每次 ZCode 启动时 self_heal 会自动检测版本差异，源目录更新了会静默升级。本命令用于立即触发更新（不等下次启动）。

## 执行

```bash
python3 "<安装路径>/regress-guard-hooks/lib/self_heal.py"
```

如果有更新：
```
✅ 自动升级 v0.5.0 → v0.6.0（15 个文件已更新）
```

如果已是最新：
```
✅ 已是最新版 v0.6.0
```

## 如何更新源目录

如果你是开发者，修改了 `~/.zcode/workspace/default/regress-guard/` 下的代码：
1. 改完后 bump `plugin.json` 的 version（如 0.5.0 → 0.6.0）
2. 所有已安装的 ZCode 下次启动时自动升级（self_heal 检测到版本差异）
3. 或在其他项目里跑 `/regress:update` 立即生效

## 升级机制原理

```
源目录 plugin.json:  version=0.6.0
安装目录 .source:    source_version=0.5.0
                         ↓ self_heal 检测到
                    0.6.0 > 0.5.0
                         ↓ 自动全量覆盖
                    skills/commands/hooks/lib 全部更新
                    .source 的 source_version 更新为 0.6.0
```
