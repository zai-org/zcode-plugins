---
name: seo-meta-audit
description: 检查网站每个页面里搜索引擎最看重的基础项——标题、描述、H1 标题、图片 alt 文字、语言和移动端标签，并直接在表格里修改标题和描述。长度按搜索结果的显示宽度计算（中文字符算两个），页面之间重复的标题和描述也会被找出来，还能预览页面在搜索结果里的样子。可以保存修改后的副本，也可以直接改原网页（自动备份，一键撤销）。在本地处理文件，不用 SEO 服务，无需 API 密钥。 用户提到“SEO 检查 / 网页标题描述 / meta description / 图片 alt / Open Graph / 网站优化”时使用。
---

# 网页 SEO 检查

1. `seo_open(inputs, settings?, project?)`：读取每个页面的标签并检查。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 是网站文件夹；settings: {og: false, lang: "zh-CN"}。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `seo_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 每行是一个页面：`set: [{row, values: {title, description}}]`。默认导出只写副本；要直接改原网页用 `formats: ["apply"]`，撤销用 `formats: ["undo"]`，都要先征得用户同意。
4. `seo_export(project, formats?)`：导出修改后的页面副本和 audit.csv（可按需直接改原网页或撤销）。把文件路径告诉用户。
5. 写标题和描述时保持页面原意，不要编造页面里没有的信息。
