---
description: 查看 Prism（侧边栏项目个性化）的安装状态与用法
---

帮用户检查 Prism 插件在桌面的生效状态，只报告、不修改：

1. 检查开启状态：`ls ~/.zcode/prism-opt-in`（或 `$ZCODE_PLUGIN_DATA/opt-in`）。不存在则说明插件处于默认的**未开启**状态——钩子不打补丁、且会自动回滚历史补丁；告知用户开启方式：`mkdir -p ~/.zcode && touch ~/.zcode/prism-opt-in`，关闭方式：删除该文件（下次会话自动恢复原始应用包）。
2. 运行 `node <插件目录>/hooks/ensure-shim.js`（插件目录即本文件所在插件的根目录），然后 `cat ~/.zcode/prism-state.json` 查看状态（`optIn` 字段即标记检测结果）。
3. 检查 `/Applications/ZCode.app/Contents/Resources/` 下是否存在 `app.asar.pristine-backup`。
4. 汇总上次校验/安装结果（状态文件 lastResult）。
5. 用法提醒：右键项目头或点项目头"…"菜单里的「调整颜色」可给项目换颜色和图标（30 个 Lucide 图标，「分组」视图对话行标题前也跟随显示该图标），「重命名」改 ZCode 内显示名（不动磁盘文件夹）；右键对话行 →「调整颜色（此对话）」只给单条对话换色；右键「自动化」页的卡片 →「调整颜色（此自动化）」给单条自动化换色（默认跟随所在项目色）；Alt+右键会话行 = 给项目换色；色盘底部「Prism 全局」有四个开关——压暗对话标题、调亮思考动画、自动配色（默认关，未手动指定颜色的项目按路径哈希自动染色）、侧边栏按最近活跃排序（默认开，纯显示层重排，不改手动拖拽顺序）。排查排序：开发者工具控制台看 `[zc-prism] recency: …` 状态行（带 gw/li/div/hdr 结构计数）。四个全局开关也在 ZCode 插件设置页（userConfig），会话启动时生效，取色盘开关优先。
