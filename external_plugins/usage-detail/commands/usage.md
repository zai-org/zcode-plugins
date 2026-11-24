---
description: 查询 ZCode 本地用量明细（每次模型请求的 token、耗时、会话统计）。
argument-hint: "[summary|recent|day|days|sessions|models|errors] [参数]"
skills: usage-detail
---

用户要查看 ZCode 本地用量明细。请求参数：$ARGUMENTS

按 `usage-detail` 技能的方法运行插件自带的查询脚本（只读本地 SQLite，不发起网络请求），把输出整理成简洁的中文表格汇报。$ARGUMENTS 为空时默认执行 `summary`；无法识别的参数先向用户确认意图再选子命令。

注意：结果只覆盖本机记录；如用户问的是套餐配额余量（5 小时/周额度），提示其查看 ZCode 的 Usage Stats → Coding Plan。若用户想要图形界面/仪表盘，请改用本插件的 `usage-ui` 命令。
