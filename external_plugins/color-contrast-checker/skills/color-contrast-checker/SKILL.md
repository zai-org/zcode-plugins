---
name: color-contrast-checker
description: 按 WCAG 对比度标准检查配色变量，修正看不清的组合。打开 CSS、SCSS 或 JSON 设计令牌，会根据 CSS 规则和变量名（包括深色主题覆盖和 var() 引用）找出文字和背景的组合，也可以自己列。每组显示对比度和 AA/AAA 结果，并给出最接近的达标颜色（色相不变，只调深浅）。接受修正或填自己的颜色，所有组合会重新检查，最后导出修正后的令牌文件和报告。在本地运行，不上传，无需 API 密钥。 用户提到“对比度检查 / 无障碍配色 / WCAG / 文字看不清 / 设计令牌颜色”时使用。
---

# 配色无障碍检查

1. `contrast_open(inputs, settings?, project?)`：读取令牌文件，找出颜色组合并逐一检查。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - settings.pairs 每行“文字色 on 背景色 [large|ui]”，变量名按文件里的写法（--x、$x、color.page）。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `contrast_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改用途：`values: {usage: "large"}`；改修哪一边：`values: {fix: "bg"}`；自己指定颜色：`values: {custom: "#1D4ED8"}`。
4. `contrast_export(project, formats?)`：导出修正后的令牌文件和报告。把文件路径告诉用户。
5. 导出到 fixed/ 下，原文件不变；修正写到真正定义颜色的变量上（var() 引用保持不变）。
