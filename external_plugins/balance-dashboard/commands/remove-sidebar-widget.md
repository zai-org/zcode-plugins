---
description: 移除余额面板注入到 ZCode 左侧边栏的组件（保留其他插件注入）
---

从 ZCode 的 `app.asar` 中移除余额面板的左侧边栏注入行，并保留 token 用量悬浮条等其他插件的注入。

执行：

```bash
node "${ZCODE_PLUGIN_ROOT}/scripts/unpatch.mjs"
```

如果提示 `app.asar` 被占用，请让用户完全退出 ZCode 后重新执行。替换成功后需要重开 ZCode 才会消失。

完成后告诉用户：

- 已移除左侧余额组件；
- 其他插件（例如 token 用量悬浮条）的注入未被修改；
- 如需重新启用，重启 ZCode 时 SessionStart 钩子会重新注入。
