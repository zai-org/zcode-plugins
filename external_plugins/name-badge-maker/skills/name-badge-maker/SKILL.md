---
name: name-badge-maker
description: 直接用参会名单打印活动胸牌和桌签。选上名单（和 logo），填好活动名称和日期，就能得到排在 A4 上、带裁切角线的胸牌——名字自动调整到合适大小，下面是单位、职位，底部按身份（嘉宾、讲师、工作人员等）印不同颜色的色条。桌签对折后两面都能看到名字。五种胸牌尺寸，可选印每位参会者编号的二维码，中英文名都支持。在本地运行，不用设计服务，无需 API 密钥。 用户提到“做胸牌 / 胸卡 / 桌签 / 台卡 / 参会证 / 会议物料”时使用。
---

# 胸牌桌签制作

1. `badge_open(inputs, settings?, project?)`：读取参会名单并预览胸牌。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 里放参会名单，可再加一个 logo：`inputs: ["attendees.xlsx", "logo.png"]`。
   - settings: {event, eventSub, size: "100x70", qr: "none", sort: "sheet", roleColors}；size 可为 100x70/90x120/4x3in/86x54/A6；qr 可为 none/code；sort 可为 sheet/role/table。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `badge_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 每行是一位参会者：`set: [{row, values: {include, name, nameEn, org, title, role, table, code}}]`。
4. `badge_export(project, formats?)`：导出 badges.pdf 和 tent-cards.pdf。把文件路径告诉用户。
5. 不要编造英文名或单位；缺的留空。
