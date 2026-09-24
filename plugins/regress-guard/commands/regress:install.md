---
description: 一键安装 regress-guard 到用户级（零配置，装一次全局生效）
allowed-tools: Bash, Read, Write
---

# /regress:install — 一键安装

用户说"安装 regress-guard"或"/regress:install"时触发。自动把框架安装到用户级（`~/.zcode/`），装一次全局生效，所有项目都能用。

## 执行

找到插件源目录（通常在当前工作区或已知路径），运行安装脚本：

```bash
# 尝试找到 install.sh
PLUGIN_DIR=""

# 常见位置
for candidate in \
    "${CLAUDE_PROJECT_DIR:-$(pwd)}/regress-guard" \
    "${HOME}/.zcode/workspace/default/regress-guard" \
    "$(pwd)/regress-guard"; do
    if [ -f "${candidate}/install.sh" ]; then
        PLUGIN_DIR="${candidate}"
        break
    fi
done

if [ -z "${PLUGIN_DIR}" ]; then
    echo "找不到 regress-guard 安装脚本。请指定插件目录。"
    exit 1
fi

bash "${PLUGIN_DIR}/install.sh"
```

## 安装后

安装脚本会输出成功信息。然后告诉用户：

```
✅ regress-guard 已安装！

现在可以在任意项目里用了。对 AI 说：
  /regress:init    ← 在项目中初始化回归工作流

或者直接开始用——AI 会自动在需要时加载相关 skill。
```

## 如果已安装

install.sh 是幂等的——重复运行只会更新，不会重复添加。所以直接跑就行。

## 卸载

用户想卸载时，运行：
```bash
bash "${PLUGIN_DIR}/uninstall.sh"
```
或对 AI 说 `/regress:uninstall`。
