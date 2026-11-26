---
name: test-data-generator
description: 为演示、测试和培训生成逼真的假数据——中英文姓名、手机号、邮箱、城市和地址、公司名、日期、金额、按你想要的比例分布的会员等级、编号、UUID 和 ORD-1234-AB 这样的代码。在小表格里描述各列（或载入字段定义表），选好行数，导出 CSV、Excel、JSON 或 SQL。所有数据都是编造的，相同的随机种子永远生成相同的数据。在本地运行，无需 API 密钥。 用户提到“生成测试数据 / 造假数据 / 模拟数据 / mock 数据 / 演示用的客户名单”时使用。
---

# 测试数据生成

1. `fakedata_open(inputs, settings?, project?)`：从模板或字段定义表开始，预览生成的数据。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 没有字段表时 inputs 传 []，会用客户模板；settings: {count: 500, locale: "zh", seed: 42}。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `fakedata_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 每行定义一列：`set: [{row, values: {name, type, arg, blank, unique}}]`；加列用 add。
4. `fakedata_export(project, formats?)`：导出 test-data.csv、test-data.xlsx、test-data.json 和 test-data.sql。把文件路径告诉用户。
5. 参数示例：date "2024-01-01..2026-12-31"、integer "0..5000"、choice "普通*6|银卡*3|金卡*1"、pattern "ORD-####-??"。
