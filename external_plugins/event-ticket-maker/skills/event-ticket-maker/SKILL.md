---
name: event-ticket-maker
description: 用一张表格给活动发二维码门票、做签到。选上嘉宾名单，填好活动名称、时间和地点，每位嘉宾都会拿到一个唯一、难以猜到的票号。可以 A4 一页打印 3 张带撕线存根的门票，也可以每人导出一份 PDF 电子票发出去，另附一份带签名栏的签到表。活动当天，把扫码枪导出的记录和名单一起选上，就能看到谁已经到场——不在名单上的、输错的、重复扫的都会标出来。重新打开名单时票号保持不变。在本地运行，不用票务服务，无需 API 密钥。 用户提到“做门票 / 电子票 / 二维码门票 / 签到表 / 扫码签到 / 入场券”时使用。
---

# 活动门票签到

1. `ticket_open(inputs, settings?, project?)`：读取嘉宾名单（和扫码记录）并分配票号。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - settings: {event, date, venue, prefix: "TKT", layout: "a4", note}；layout 可为 a4/single。
   - 签到时把扫码导出文件和名单一起放进 inputs：`inputs: ["guests.csv", "scans.csv"]`，项目名沿用之前的。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `ticket_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 每行是一张票：`set: [{row, values: {include, name, type, seat, phone, email, checkedIn, checkedAt}}]`；不要手改 code。
4. `ticket_export(project, formats?)`：导出 tickets.pdf、每人一份电子票和 checkin.xlsx。把文件路径告诉用户。
5. 票号由插件生成，不要自己编；告诉用户 ticket-codes.json 要保留。
