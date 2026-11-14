---
description: 生成交互式 ZCode 用量仪表盘，内嵌渲染在会话中（总览/趋势/5小时窗口/会话/明细/失败）。
argument-hint: "[内嵌条数，默认 3000；或改用 summary|recent|day|days|sessions|models|errors 文本查询]"
skills: usage-detail
---

用户要以图形界面查看 ZCode 本地用量。按 `usage-detail` 技能的「仪表盘界面（dashboard）」流程执行：

1. 运行插件脚本 `dashboard` 子命令，输出文件写入宿主提供的会话可视化目录；$ARGUMENTS 为纯数字时作为内嵌条数传入（默认 3000，范围 1-20000）。
2. 在最终回复中用 `::visualize` 引用生成的文件，内嵌渲染给用户。
3. 界面元信息显示"已加载 X / Y 条"且 Y 明显更大时，主动提示：可指定更大条数重新生成，或用 `/usage export json` 导出全量。

仅当 $ARGUMENTS 指定了具体文本子命令（summary/recent/day/days/sessions/models/errors）时，才改为文本表格输出。查询为只读本地 SQLite，无网络请求。
