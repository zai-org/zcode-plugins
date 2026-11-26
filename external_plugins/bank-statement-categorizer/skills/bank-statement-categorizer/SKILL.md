---
name: bank-statement-categorizer
description: 把银行卡、信用卡、支付软件导出的流水（.csv/.xlsx，中英文都行）按可编辑的关键词规则自动分类，可逐笔手动改分类，标出未分类和可能重复计入的交易，按分类和月份汇总收支。导出分类后的 Excel、CSV 和 HTML 报告，规则可以下个月继续用。在本地运行，不需要登录银行，无需 API 密钥。 用户提到“账单分类 / 流水分类 / 记账 / 钱花在哪 / 支出统计 / 银行流水 / 支付宝账单”时使用。
---

# 账单自动分类

1. `statement_open(inputs, settings?, project?)`：读取账单导出文件并给每笔交易分类。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 信用卡账单里正数是消费时，settings 用 `sign: "positive"`。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `statement_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 手动分类：`set: [{row, values: {category: "餐饮 Dining"}}]`；加规则：把新行追加到 settings.rules 原文末尾（先用 status 看当前规则）。
4. `statement_export(project, formats?)`：导出 categorised.xlsx（交易明细、月份×分类汇总、规则）、categorised.csv、report.html 和 rules.txt。把文件路径告诉用户。
5. 给用户的总结先说支出最多的 3 个分类和未分类的笔数，再说可能重复计入的交易。
