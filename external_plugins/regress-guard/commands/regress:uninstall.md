---
description: 卸载 regress-guard（清理用户级配置 + hook + skill + 命令）
allowed-tools: Bash
---

# /regress:uninstall — 卸载

清理 regress-guard 的所有用户级配置。项目的 `.regress/` 目录保留（历史数据不删）。

## 执行

找到卸载脚本并运行：

```bash
# 尝试找到 uninstall.sh
for candidate in \
    "${HOME}/.zcode/workspace/default/regress-guard" \
    "${CLAUDE_PROJECT_DIR:-$(pwd)}/regress-guard"; do
    if [ -f "${candidate}/uninstall.sh" ]; then
        bash "${candidate}/uninstall.sh"
        exit 0
    fi
done
echo "找不到 uninstall.sh"
```

## 清理内容

- 删除 `~/.zcode/skills/` 下的 3 个 skill
- 删除 `~/.zcode/commands/` 下的 8 个命令
- 删除 `~/.zcode/regress-guard-hooks/` 目录
- 从 `config.json` 移除 PreToolUse + SessionStart hook
- 从 `AGENTS.md` 移除回归契约块

**安全**：不会删除用户的其他 skill/命令/配置。项目的 `.regress/` 保留。
