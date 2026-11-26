---
name: business-card-maker
description: 一张员工表就能给全公司批量做名片。选上员工名单和公司 logo，填好公司名和网址，就能得到给印刷厂的 PDF（每面一页，带出血、裁切线和成品框）和办公室自己打印用的 A4 拼版。名片上可以印二维码，手机一扫就存进通讯录；每个人还会单独导出一份 .vcf 电子名片。三种正面版式，90×54、85×55 或美式尺寸，中英双语。在本地运行，不用设计服务，无需 API 密钥。 用户提到“做名片 / 批量名片 / 印名片 / 名片二维码 / 电子名片 / vcf”时使用。
---

# 名片批量制作

1. `card_open(inputs, settings?, project?)`：读取员工名单（和 logo）并预览名片。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 里放员工表，可再加一个 logo 图片：`inputs: ["team.xlsx", "logo.png"]`。
   - settings: {company, companyEn, website, address, size: "90x54", template: "left", qr: "back", bleed: 2}；size 可为 90x54/85x55/89x51，template 可为 left/center/band，qr 可为 back/front/none。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `card_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 每行是一个人：`set: [{row, values: {include, name, nameEn, title, titleEn, dept, mobile, phone, email, address}}]`；不做的人把 include 设为 false。
4. `card_export(project, formats?)`：导出 cards-print.pdf、cards-a4.pdf 和 vCard 文件。把文件路径告诉用户。
5. 不要编造手机号、邮箱或英文名；缺的留空并提示用户。
