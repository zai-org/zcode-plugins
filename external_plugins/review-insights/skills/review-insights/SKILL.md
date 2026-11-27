---
name: review-insights
description: 看清顾客到底在夸什么、在抱怨什么。打开店铺导出的评价（CSV 或 Excel，有评价内容，最好也有星级），每条评价按短句拆开，归到质量、尺码、物流、包装、价格、外观、气味、使用体验、客服等主题（中英文都支持）。报告列出每个主题的主要差评和好评原因并附原话、差评占比、星级分布，还会标出疑似重复刷评和没有归类的评价。主题词库可以自己改，单条评价的倾向和主题也能手动修正，最后导出 HTML 报告和 Excel。在本地运行，不用登录，无需 API 密钥。 用户提到“评价分析 / 差评原因 / 买家评论 / 好评率 / review 分析”时使用。
---

# 商品评价分析

1. `reviews_open(inputs, settings?, project?)`：读取评价并按主题归类。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传导出的评价表；每行一条评价，评价内容、评分、商品列会自动识别。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `reviews_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改主题词库：`settings: {topics: "…完整词库…"}`（每行 `名称: 词1, 词2`，先用 status 看现有内容再追加）；改单条：`set: [{row, values: {tone: "差评", topics: "尺码,质量"}}]`；修评分：`values: {评分: "5"}`。
4. `reviews_export(project, formats?)`：导出 review-report.html 和 review-insights.xlsx。把文件路径告诉用户。
5. 回答时先说差评最多的 2-3 个主题和代表原话，再说好评点。
