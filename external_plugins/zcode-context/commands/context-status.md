---
description: 查看上下文洞察的注入状态（已注入 / 等待重启 / 需管理员 / 出错）与下一步建议
---

运行以下命令查看 zcode-context 的当前注入状态，把输出原样汇报给用户（它已包含下一步建议）：

```bash
node "${ZCODE_PLUGIN_ROOT}/scripts/status.mjs"
```

如果输出显示 `pending-restart`，提醒用户：完全退出 ZCode（含托盘进程）再重开即可；重开后仍无入口就再重启一次。
