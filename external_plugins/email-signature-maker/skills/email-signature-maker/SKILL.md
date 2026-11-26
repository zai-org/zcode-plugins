---
name: email-signature-maker
description: 让全公司用上统一、好看的邮件签名。选上员工名单，填好公司名、网址和 logo 地址，挑一个模板和主题色，就会给每个人生成一份签名文件，能干净地粘贴到 Gmail、Outlook 或 Apple Mail——用表格和内联样式写成，符合邮件的要求。每人还有一份纯文本版本，另有一个汇总页列出所有签名和设置步骤。在本地运行，不用签名服务，无需 API 密钥。 用户提到“邮件签名 / 批量签名 / 统一签名 / Outlook 签名 / Gmail 签名”时使用。
---

# 邮件签名批量

1. `sig_open(inputs, settings?, project?)`：读取员工名单并预览签名。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - settings: {company, companyEn, website, address, logoUrl, template: "classic", accent, socials, disclaimer}；template 可为 classic/side/compact；socials 写成“名称 网址”，逗号分隔。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `sig_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 每行是一个人：`set: [{row, values: {include, name, nameEn, title, titleEn, dept, mobile, phone, email, wechat, extra}}]`。
4. `sig_export(project, formats?)`：导出 signatures/<名字>.html、.txt 和 index.html。把文件路径告诉用户。
5. 不要编造联系方式或 logo 地址；没有就留空。
