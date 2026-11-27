---
name: loan-calculator
description: 签合同之前，把几种房贷、贷款方案放在一起比一比。填好每个方案的金额、年利率、期限和还款方式（等额本息或等额本金），还可以加上提前还款（缩短期限或减少月供）和某月起的利率调整。立即看到首月和最高月供、总利息、还清时间，以及每个方案能省多少利息，并附剩余本金曲线图。导出包含每个方案逐月还款计划的 Excel 和可分享的图表网页。在本地运行，不用登录银行，无需 API 密钥。 用户提到“房贷计算 / 贷款计算 / 等额本息 / 等额本金 / 提前还款划算吗 / 月供”时使用。
---

# 贷款分期计算

1. `loan_open(inputs, settings?, project?)`：读取方案并对比。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 可以不选文件：`inputs: []` 会给两个默认方案。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `loan_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 每行是一个方案：`set: [{row, values: {include, name, principal, rate, years, method: "等额本息"|"等额本金", start: "2027-01", prepay, rateChanges}}]`；新增方案用 add。
4. `loan_export(project, formats?)`：导出 loan-schedule.xlsx 和 loan-report.html。把文件路径告诉用户。
5. 只报插件算出的数字；提醒用户以银行计算为准。
