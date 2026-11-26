---
name: license-report
description: 弄清楚你的产品里带了哪些许可证：扫描 Node.js 项目已安装的依赖（直接和间接依赖，npm、yarn、pnpm 都支持），把每个包的许可证规范成 SPDX 名称，并分成宽松、弱 copyleft、强 copyleft、专有和未知几类。GPL/AGPL 和没写许可证的包会被标出，直到你审核过为止；可以手动修正许可证并写备注。导出给法务看的 Excel 报告，以及随产品发布的 THIRD_PARTY_NOTICES.txt。在本地读取 node_modules，不联网查询，无需 API 密钥。 用户提到“依赖许可证 / 开源协议清单 / 第三方声明 / THIRD_PARTY_NOTICES / GPL 检查 / 许可证合规”时使用。
---

# 依赖许可证清单

1. `licenses_open(inputs, settings?, project?)`：扫描已安装的依赖并给许可证分类。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 是项目文件夹（或其中的 package.json）；settings: {dev: false, weak: true, fullText: true}。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `licenses_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 每行是一个包：`set: [{row, values: {license, reviewed, note}}]`；改 license 后来源会变成 edited。
4. `licenses_export(project, formats?)`：导出 license-report.xlsx 和 THIRD_PARTY_NOTICES.txt。把文件路径告诉用户。
5. 不要替用户下结论说某个 GPL 包“没问题”，只说明风险并建议请专业人士确认。
