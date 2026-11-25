---
name: product-catalog-maker
description: 用商品表格（CSV/XLSX）和图片生成 A4 产品目录 PDF 与可编辑网页版，并在更新后列出变更。用户提到“产品目录 / 商品画册 / 价目表 PDF / 目录更新”时使用。
---

# 商品目录制作

全部在本机生成，不联网。

1. **打开**：`catalog_open(table, imageDir?, mapping?, style?)`，或 `catalog_open(project: "xxx.catalogmaker.json")`。返回识别到的列、分类、页数和问题，并打开面板预览。
   - 列没识别到时传 `mapping`：`{sku, name, spec, desc, price, originalPrice, image, category, unit}` → 表格列名。
   - 图片按“图片”列的文件名，或用编号当文件名，在 `imageDir`（默认表格所在文件夹，含子文件夹）中查找。
   - `style`：`title`、`subtitle`、`logo`（PNG/JPG）、`primary`（#hex）、`grid`（2x2 / 2x3 / 3x3 / 3x4）、`currency`、`footer`（联系方式）、`cover`、`showSku`、`categoryOrder`（table / name）。
2. **处理问题**：缺图、缺价格、价格不是数字、编号重复、图片太小。把问题告诉用户；不要擅自改用户的表格，除非用户要求。
3. **生成**：`catalog_build(project)` → `catalog/catalog.pdf`、`catalog.html`、`catalog.json`；输出目录里已有上一版 `catalog.json` 时，还会生成 `changes.md` / `changes.csv`。把页数和变更摘要（新增/下架/改价）告诉用户。
4. `project_save(path, project)` 保存设置，下次更新目录直接用 `catalog_open(project: ...)` + `catalog_build`。
