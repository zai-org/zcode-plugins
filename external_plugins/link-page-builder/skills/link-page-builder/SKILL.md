---
name: link-page-builder
description: 几分钟做好自己的“个人链接主页”：名字、一句简介、圆形头像和一列链接按钮，有六种主题可选。所有内容都在一个 index.html 里——没有脚本、没有追踪、不引用外部文件——可以上传到任何空间或放在自己的域名下，还会生成指向主页的二维码。在表格里编辑链接，重要的可以突出显示，旧的可以隐藏。在本地运行，不用注册链接主页服务，无需 API 密钥。 用户提到“个人链接主页 / link in bio / 简介链接页 / 做一个放链接的主页 / 主页二维码”时使用。
---

# 个人链接主页

1. `linkpage_open(inputs, settings?, project?)`：读取链接清单并预览主页。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 是 links.yaml/.json（name、bio、avatar、theme、links:[{title,url,icon,subtitle,highlight,hidden}]）或有 title,url 列的 CSV；settings: {theme: "forest", shape: "rounded", pageUrl, showQr: false}；theme 可为 light/dark/sunset/forest/ocean/mono。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `linkpage_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 每行是一个按钮：`set: [{row, values: {include, icon, title, url, subtitle, highlight}}]`；新增用 `add: [{title, url}]`。
4. `linkpage_export(project, formats?)`：导出 index.html、qr.png 和 qr.svg。把文件路径告诉用户。
5. 不要替用户编造社交账号链接；pageUrl 不知道时就不生成二维码。
