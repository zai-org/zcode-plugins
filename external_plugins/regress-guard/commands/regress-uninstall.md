---
description: 卸载 regress-guard（清理用户级配置 + hook + 命令）
allowed-tools: Bash
---

# /regress-uninstall — 卸载

清理 regress-guard 的所有用户级配置。项目的 `.regress/` 目录保留（历史数据不删）。

## 执行

找到卸载脚本并运行（**批191 起卸载器是 Python，Windows 10+ 原生可用**）：

```bash
# 尝试找到 uninstall.py
for candidate in \
    "${HOME}/.zcode/workspace/default/regress-guard" \
    "${CLAUDE_PROJECT_DIR:-$(pwd)}/regress-guard"; do
    if [ -f "${candidate}/uninstall.py" ]; then
        python3 "${candidate}/uninstall.py"
        exit 0
    fi
done
echo "找不到 uninstall.py"
```

## 清理内容

- 删除 `~/.zcode/commands/` 下的 16 个命令
- 删除 `~/.zcode/regress-guard-hooks/` 目录
- 从 `config.json` 移除全部 regress-guard hook（统一过滤，零死钩子残留）
- 从 `AGENTS.md` 移除回归契约块

**安全**：不会删除用户的其他 skill/命令/配置。项目的 `.regress/` 保留。
