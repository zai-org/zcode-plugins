---
name: expense-splitter
description: 多人旅行、聚餐、合租的花费一起算：谁付了多少（可以多人一起付），每笔由谁分摊——全部人、除某人以外、按份数（如“A*2”）、某人正好承担多少、或在平分之外多承担一些。立即看到每人已付、应摊和差额，以及最少几笔转账就能结清。导出结算 Excel 和一张可以直接发到群里的结算图片。在本地运行，不用登录，无需 API 密钥。 用户提到“AA / 分账 / 谁该给谁转账 / 旅行费用分摊 / 聚餐怎么分”时使用。
---

# AA 分账

1. `split_open(inputs, settings?, project?)`：读取花费并算出谁该转给谁。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 可以不选文件：`inputs: []` 从空表开始，再用 add 添加花费。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `split_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 每行一笔花费：`set: [{row, values: {date, item, payer, amount, participants, note}}]`；payer 可写“小李:900; 阿珍:500”；participants 可写“全部”“全部, -Tom”“小王*2, 小李”“Tom:80, 小王”（Tom 正好 80）“Tom+80, 全部”（Tom 多出 80）。新增花费用 add。成员名单在设置 people 里。
4. `split_export(project, formats?)`：导出 settlement.xlsx 和 settlement.png。把文件路径告诉用户。
5. 只报插件算出的转账结果，不要自己心算。
