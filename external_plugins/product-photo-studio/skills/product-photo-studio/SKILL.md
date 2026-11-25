---
name: product-photo-studio
description: 批量处理电商商品照：去纯色背景、统一商品大小与位置、加阴影，导出白底主图、透明 PNG 和淘宝/拼多多/Amazon/Shopify/社媒尺寸。用户提到“白底图 / 主图 / 商品图批量处理 / 抠图统一尺寸”时使用。
---

# 电商商品图助手

处理工作区里的 JPG / PNG 商品照，全部在本机完成。

1. **打开**：`photos_open(folder | paths, presets?)`，或 `photos_open(project: "xxx.photostudio.json")` 复用上次的设置。返回每张图的检查结果并打开侧栏面板。
   - 内置尺寸 id：`white-800`（淘宝/天猫/京东主图）、`white-1000`（拼多多/抖店）、`amazon-2000`、`shopify-2048`、`square-1080`、`portrait-1080x1440`（小红书）、`transparent-png`（1600×1600 透明）。其他尺寸放进 `customPresets`。
2. **看警告**：
   - `background_not_uniform`：背景不是纯色（桌面、场景图），自动去背可能不准；
   - `little_background_removed`：几乎没去掉背景，建议调高该图的 tolerance；
   - `subject_touches_edge`：商品贴到照片边缘，原图可能被裁掉；
   - `empty_subject`：容差太高把商品也去掉了，调低 tolerance。
   把这些图告诉用户，建议在面板里单独调整；本插件只能去掉与边缘相连的纯色/浅色背景，复杂背景请用户先用 PhotoCraft 等工具抠好透明 PNG（已有透明通道的 PNG 会直接使用）。
3. **调整**：全局设置在 `project.settings`；单张差异写进 `images[i].overrides`（只写不同的字段）。字段：`removeBackground`（auto/off）、`tolerance` 1–100（默认 20）、`fill` 主体占比 0.2–0.99（默认 0.85）、`offsetY` −0.4–0.4、`align` center/bottom、`shadow` none/ground/drop、`shadowOpacity` 0–1、`background` 颜色。用 `project_save(path, project)` 保存为 `.photostudio.json`，下次同一批风格直接复用。
4. **导出**：`photos_export(project, indices?)` 写到 `<outputDir>/<尺寸 id>/<原文件名>.jpg|png`；只重做某几张时传 `indices`（从 0 开始）。导出后告诉用户输出位置和仍需检查的图。

用户在面板里拖滑块即可看到预览；面板操作和你的工具调用共用同一个项目格式。不要覆盖原图。
