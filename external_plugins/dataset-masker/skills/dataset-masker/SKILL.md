---
name: dataset-masker
description: 把含个人信息的表格交给外包、供应商或 AI 工具之前，先做一份安全的副本。自动识别姓名、手机号、邮箱、身份证号、银行卡号、地址和生日；每列可选：部分遮盖（138****1234）、哈希、替换成一致的化名（用户0001）、泛化（只留城市、只留年份）、清除备注里夹带的手机号和邮箱，或直接删除该列。如果还有个人信息残留会提醒你。在本地运行，无需 API 密钥。 用户提到“数据脱敏 / 隐藏手机号 / 个人信息打码 / 发给外包前处理 / 匿名化”时使用。
---

# 数据脱敏

1. `mask_open(inputs, settings?, project?)`：读取表格、识别个人信息列并预览脱敏结果。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 打开后先把每列的识别结果和处理方式给用户确认。哈希密钥 settings.salt 自动生成，不要在回复里展示它。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `mask_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - `set: [{row, values: {method: "hash"}}]`；method 可选 keep/partial/hash/pseudonym/generalize/scrub/drop。
4. `mask_export(project, formats?)`：导出 masked.csv、masked.xlsx 和 masking-report.md（只记录处理方式，不含原值）。把文件路径告诉用户。
5. 有 warn（残留个人信息）时要提醒用户再处理。
