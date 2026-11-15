---
description: 移除上下文洞察的侧边栏注入（只剥离本插件自己的注入行，保留其他插件）
---

运行以下命令移除 zcode-context 的 app.asar 注入（完成后需要完全退出并重开 ZCode 生效）：

```bash
node "${ZCODE_PLUGIN_ROOT}/scripts/unpatch.mjs"
```
