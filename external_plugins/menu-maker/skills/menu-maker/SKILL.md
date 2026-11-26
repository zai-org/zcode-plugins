---
name: menu-maker
description: 菜单放在表格里维护，就能生成好看的打印菜单和适合手机看的电子菜单。分类、带虚线引导的价格、招牌推荐、辣度、素食和过敏原标记、中英文菜名并排——经典单栏、双栏或紧凑版式，A4、A5 或 Letter 纸张。填上电子菜单的网址，打印菜单上会印出二维码给客人扫。改价格、标记售罄后重新导出即可。在本地运行，不用菜单服务，无需 API 密钥。 用户提到“做菜单 / 餐厅菜单 / 打印菜单 / 电子菜单 / 扫码菜单 / 价目表”时使用。
---

# 餐厅菜单制作

1. `menu_open(inputs, settings?, project?)`：读取菜品表并预览菜单。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - settings: {title, subtitle, layout: "classic", page: "A4", bilingual: true, currency: "¥", menuUrl}；layout 可为 classic/twocol/compact。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `menu_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 每行是一道菜：`set: [{row, values: {include, section, name, nameEn, price, desc, allergens, spicy, star, veg}}]`；售罄就把 include 设为 false。
4. `menu_export(project, formats?)`：导出 menu.pdf、menu.html 和 qr.png。把文件路径告诉用户。
5. 不要编造英文菜名或过敏原；没有就留空，提示用户补充。
