---
name: coupon-code-generator
description: 用一张简单的活动批次表，批量生成不重复的优惠码、礼品码、兑换码和可打印的兑换卡。设定码型（如 XXXX-XXXX）、每批的前缀和不含易混字符的字符集，还可以在末尾加校验位，输错能发现。兑换码由种子生成，同一个活动永远得到同样的码；已经发出的码清单也可以选上，绝不会重复。导出给店铺系统用的 CSV，以及印有面值、兑换码、有效期和二维码（可直达兑换页）的兑换卡 PDF。在本地运行，不用发券服务，无需 API 密钥。 用户提到“兑换码 / 优惠码 / 券码 / 礼品卡 / 激活码 / 批量生成码”时使用。
---

# 兑换码批量生成

1. `coupon_open(inputs, settings?, project?)`：读取活动批次表并生成兑换码。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 放批次表，可再加已发码清单（txt 或 csv）。settings: {seed, pattern: "XXXX-XXXX", charset: "safe", checksum: true, brand, qr: "code"}；charset 可为 safe/upper/digits/alnum。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `coupon_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 每行是一个批次：`set: [{row, values: {include, batch, prefix, count, value, expiry, note}}]`；改 seed 会换一整批新码。
4. `coupon_export(project, formats?)`：导出 codes.csv 和 coupon-cards.pdf。把文件路径告诉用户。
5. 提醒用户种子要保密；不要把种子贴到公开的地方。
