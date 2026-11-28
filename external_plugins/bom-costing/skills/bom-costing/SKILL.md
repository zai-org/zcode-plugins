---
name: bom-costing
description: 把多层物料清单自动汇总成单位成本，并把生产计划变成采购清单。读取 Excel 或 CSV 里的物料表（编码、自制/外购、单价或加工费、库存、起订量、包装倍数、交期、供应商）和 BOM 表（父件、子件、用量、损耗率）。自下而上算出每个成品和半成品的成本（含损耗），按层级展开生产计划、先用现有的半成品和零件库存，采购数量按最小起订量和包装倍数向上取整。会发现物料表里没有的子件（如 P-OO5 会提示应为 P-005）、BOM 循环、缺单价、用量和损耗率错误、重复的 BOM 行、标为自制却没有 BOM 的物料、没用到的物料和交期长的物料。导出成本核算 Excel（每个产品的缩进 BOM、累计用量和成本、成本汇总、需求计算、按供应商的采购清单）、采购清单 CSV 和可打印的成本单。不用登录，无需 API 密钥，本机运行。 用户提到“BOM / 物料清单 / 成本核算 / 采购量 / 生产计划”时使用。
---

# 物料清单核算

1. `bom_open(inputs, settings?, project?)`：读取物料和 BOM 并汇总成本。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传 BOM 工作簿（含物料表和 BOM 表）或所在文件夹；行先是 [item] 物料行，后是 [bom] 行。settings.build 写生产计划，如 "LAMP-01=300, LAMP-02=150"。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `bom_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改子件编码：`set: [{row, values: {child: "P-005"}}]`；补单价：`values: {price: 21.5}`；去掉重复 BOM 行：`values: {include: false}`；生产计划：`settings: {build: "LAMP-01=300"}`。
4. `bom_export(project, formats?)`：导出 costed-bom.xlsx、purchase-list.csv 和 cost-sheets.pdf。把文件路径告诉用户。
5. 工作簿里有“生产计划”表时，打开后会提示，把它填进 build 设置。
