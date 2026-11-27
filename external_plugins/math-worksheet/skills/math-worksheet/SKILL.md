---
name: math-worksheet
description: 几秒钟打印口算练习和答案。选年级题型（20 以内加减、100 以内进位/不进位加减、表内乘除、有余数的除法、三位数加减、两位数乘法等），或者自己设运算和数字范围。设题数、横式或竖式、挖空题（□ + 5 = 12）；换一个题组编号就是一套新题，编号不变就能重印同一套。可以改任何一道题，重新生成时保留。导出带姓名、用时、得分栏的练习卷，红色答案卷和 CSV。在本地运行，无需账号或 API 密钥。 用户提到“口算题 / 出练习题 / 加减法练习 / 乘法口诀练习 / 竖式计算”时使用。
---

# 口算练习生成

1. `math_open(inputs, settings?, project?)`：生成口算题。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 不需要文件：`inputs: []`；`settings.preset` 选年级题型（g1a、g1b、g2a、g2b、g2c、g3a、g3b、g4a 或 custom）。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `math_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 换一套：`settings: {seed: 2}`；改题：`set: [{row, values: {a, op, b, blank}}]`（自动锁定）。
4. `math_export(project, formats?)`：导出 worksheet.pdf、answers.pdf 和 problems.csv。把文件路径告诉用户。
5. 答案卷和练习卷版式一致，可以一起打印。
