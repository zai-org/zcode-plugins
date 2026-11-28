---
name: asset-register
description: 用一张表管小公司的固定资产台账，生成二维码资产标签、折旧表和盘点表。按月计提折旧（当月购入次月起提），支持年限平均法、双倍余额递减法（最后两年改直线）和年数总和法，各类别可设默认年限，残值可写比例或金额；随时看到截至某天的累计折旧和净值。会发现重复或缺失的资产编号、重复录入的序列号、读不懂的日期和金额、残值不低于原值、没有使用年限、借出没写使用人或已逾期、没有存放地点，以及已提足折旧仍在使用的资产。导出 A4 二维码标签（50×30 或 70×40 mm）、折旧 Excel（台账、年度折旧、按类别和地点汇总、借出清单）和按地点分组带勾选框的盘点表。不用登录，无需 API 密钥，本机运行。 用户提到“固定资产 / 资产台账 / 折旧 / 资产标签 / 盘点表”时使用。
---

# 固定资产台账

1. `asset_open(inputs, settings?, project?)`：读取资产台账并计算折旧。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传资产台账 .xlsx/.csv（或所在文件夹）；settings 可传 asOf（截至日期）、company；每行一个资产：id、name、category、bought、cost、residual、life、method、location、holder、status、due、serial。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `asset_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改编号：`set: [{row, values: {id: "ZC-008"}}]`；补年限：`values: {life: 5}`；改残值：`values: {residual: "5%"}`；登记借出：`values: {status: "借出", holder: "李娜", due: "2026-12-20"}`；截至日期：`settings: {asOf: "2026-11-30"}`。
4. `asset_export(project, formats?)`：导出 asset-tags.pdf、depreciation.xlsx 和 stocktake.pdf。把文件路径告诉用户。
5. 编号重复时给后面那条用下一个空着的编号；残值大于原值多半是把比例写成了金额。
