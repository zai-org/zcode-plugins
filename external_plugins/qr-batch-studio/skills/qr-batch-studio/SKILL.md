---
name: qr-batch-studio
description: 用一张表批量生成二维码：网址、文字、WiFi 连接、电子名片（vCard）、邮箱、电话和短信，可设置颜色、中间 Logo 和名称标签。自动标出内容为空、网址缺少 https://、码太密、颜色对比不够等问题；在面板里修改清单、预览二维码，导出 PNG（含 zip）、SVG 矢量和 A4 打印页 PDF。在本地运行，无需 API 密钥。 用户提到“二维码 / 批量二维码 / WiFi 二维码 / 名片二维码 / QR code”时使用。
---

# 二维码批量生成

1. `qr_open(inputs, settings?, project?)`：读取二维码清单（和可选的 Logo）并逐个检查。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 没有表格时，可以先帮用户写一个 CSV（名称,类型,内容），再打开。加 Logo 时 settings 设 `ecc: "H"`。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `qr_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改内容：`set: [{row, values: {content: "..."}}]`；删掉空行：`remove: [行号]`。
4. `qr_export(project, formats?)`：导出 png/*.png 和 qr-png.zip、svg/*.svg 和 qr-list.csv，以及 qr-sheet.pdf。把文件路径告诉用户。
