---
name: recipe-scaler
description: 把一文件夹的菜谱按人数缩放、换算单位，得到合并好的购物清单和可打印的菜谱卡片。读取中英文 Markdown 菜谱（五花肉 500 g、生抽 2 汤匙、鸡蛋 3 个、盐 适量、1 1/2 cups flour），每道菜可各自设人数或统一人数，可换成公制（克、毫升）或美制（oz、cup），取整合理：鸡蛋番茄取整个、勺按 1/4、克取整到 5。购物清单把几道菜里的同一样食材加在一起（鸡蛋 / eggs、番茄 / 西红柿），按货架分组，家里已有的不列入。会发现没写份量的菜谱、读不懂的数量（如 两三）、不认识的单位、重复的食材、步骤里没用到的食材、没有步骤的菜谱，以及放大太多需要尝味的调味。导出 A5 菜谱卡片（换算后用量、步骤、总时长）、带勾选框的购物清单 PDF、CSV 和换算后的 Markdown 菜谱。不用登录，无需 API 密钥，本机运行。 用户提到“菜谱换算 / 按人数 / 购物清单 / 单位换算 / 菜谱卡片”时使用。
---

# 菜谱换算

1. `recipe_open(inputs, settings?, project?)`：读取菜谱并按人数换算。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传菜谱文件夹或 .md 文件；每道菜先一行 [recipe]（base 原份数，servings 目标人数），后面是它的食材行（item、qty、unit）。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `recipe_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 改人数：`set: [{row: <菜谱行>, values: {servings: 6}}]`；补原份数：`values: {base: 2}`；改单位：`values: {unit: "tsp"}`；去掉重复食材：`values: {include: false}`；统一公制：`settings: {system: "metric"}`；家里已有：`settings: {pantry: "盐、食用油"}`。
4. `recipe_export(project, formats?)`：导出 recipe-cards.pdf、shopping-list.pdf、shopping-list.csv 和 recipes-scaled.md。把文件路径告诉用户。
5. 菜谱行和食材行的行号先用 recipe_status 看准再改。
