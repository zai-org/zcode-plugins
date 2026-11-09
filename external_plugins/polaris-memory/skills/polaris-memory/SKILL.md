---
name: polaris-memory
description: POLARIS 永久记忆：跨会话记住用户偏好、项目结论与踩坑经验。当需要回忆之前说过/做过的事、存储值得长期保留的信息、或查看剩余搜索额度时使用。
---

# POLARIS 永久记忆

给你的编程助手装上长期记忆。安装本插件后，会话中出现以下 MCP 工具：

| 工具 | 用途 |
|---|---|
| `polaris_write` | 把值得长期记住的内容写入记忆（容量上限内 FIFO） |
| `polaris_recall` | 语义搜索记忆（消耗每月搜索额度） |
| `polaris_auto_remember` | 自动记忆：足够新颖才写入，避免重复 |
| `polaris_novelty` | 查询某内容的"新颖度" |
| `polaris_forget` | 定向删除记忆（GDPR 风格） |
| `polaris_stats` / `polaris_health` | 存储统计 / 运行健康与剩余额度 |
| `polaris_consolidate` | 文本轨迹的曲率锚点压缩 |

## 免费额度

- 个人用户免费使用，**每月 1000 次搜索额度**（`polaris_recall` 每次消耗 1 次），自然月 1 日自动重置。
- 写入、遗忘、统计、健康检查等**不消耗额度**。
- 查询剩余额度：调用 `polaris_health`，其 `quota` 字段返回 `{limit, used, remaining, month}`。
- 额度用尽时返回错误码 `-32001`，提示次月重置或升级。

## 数据存储

记忆默认保存在插件目录 `data/memory.pt`（另有 `.texts` 纯文本副本与 `.quota.json` 额度文件）。想换位置，可在 ZCode 设置 → MCP → polaris-memory 中修改 `--storage` 参数。

## 提示

- 值得写进记忆的：用户偏好、项目决策、踩坑经验、长期事实；一次性闲聊不必写入。
- 需要精确回忆时用 `polaris_recall` 做语义搜索；写之前可用 `polaris_auto_remember` 去重。
- 默认使用无模型哈希向量器（秒级启动）；如本机有 BGE-small-zh，可在 MCP 参数中追加 `--embedding-model <模型目录>` 获得更强召回质量。
