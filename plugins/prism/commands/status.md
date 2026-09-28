---
description: 查看 Prism（侧边栏项目个性化）的安装状态与用法
---

帮用户检查 Prism 插件在桌面的生效状态，只报告、不修改：

1. 运行 `node <插件目录>/hooks/ensure-shim.js`（插件目录即本文件所在插件的根目录），然后 `cat ~/.zcode/prism-state.json` 查看状态。
2. 检查 `/Applications/ZCode.app/Contents/Resources/` 下是否存在 `app.asar.pristine-backup`。
3. 汇总上次校验/安装结果（状态文件 lastResult）。
4. 用法提醒：右键项目头或点项目头"…"菜单里的「调整颜色」可给项目换颜色和图标（30 个 Lucide 图标），「重命名」改 ZCode 内显示名（不动磁盘文件夹）；右键对话行 →「调整颜色（此对话）」只给单条对话换色；Alt+右键会话行 = 给项目换色；色盘底部「Prism 全局」有四个开关——压暗对话标题、调亮思考动画、自动配色（默认关，未手动指定颜色的项目按路径哈希自动染色）、侧边栏按最近活跃排序（默认开，纯显示层重排，不改手动拖拽顺序）。排查排序：开发者工具控制台看 `[zc-prism] recency: …` 状态行（带 gw/li/div/hdr 结构计数）。四个全局开关也在 ZCode 插件设置页（userConfig），会话启动时生效，取色盘开关优先。
