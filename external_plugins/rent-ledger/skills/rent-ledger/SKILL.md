---
name: rent-ledger
description: 给几间出租房记房租账：租客、租约、收款各一张表，自动算出每位租客应收多少、哪笔逾期了几天，并打印收据。按租约的付款方式（月付、季付、半年付、年付）在各自交租日计租，最后不足一月按天计，收款先冲最早未付的房租，部分付款和预付都能处理。会发现收款记到了不存在的房号（如 3O2 会提示应为 302）、重复收款、读不懂的日期金额、租约到期后还有收款、迟交的房租和快到期的租约。导出台账 Excel（租客余额、应收计划、每笔收款冲抵了什么、欠款清单）、带金额大写的收据 PDF，以及可直接发给租客的礼貌催租提醒。不用登录，无需 API 密钥，本机运行。 用户提到“房租 / 租金台账 / 谁欠房租 / 收据 / 催租”时使用。
---

# 房租台账

1. `rent_open(inputs, settings?, project?)`：读取租客和收款记录，计算应收和欠款。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传含租客表和收款记录的文件夹；settings 可传 asOf、landlord。行先是 [tenant] 租客行，后是 [pay] 收款行。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `rent_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改房号：`set: [{row, values: {unit: "302"}}]`；去掉重复收款：`values: {include: false}`；登记收款：`add: [{kind: "pay", date: "2026-11-27", unit: "201", amount: 3200, method: "微信"}]`。
4. `rent_export(project, formats?)`：导出 ledger.xlsx、receipts.pdf 和 reminders.md。把文件路径告诉用户。
5. 重复收款先问清是否真的付了两次；没问清就去掉后一条。
