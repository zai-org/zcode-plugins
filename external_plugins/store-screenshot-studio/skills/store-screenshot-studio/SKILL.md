---
name: store-screenshot-studio
description: 把 App 截图做成 App Store / Google Play 宣传截图（标题、设备边框、背景、多语言、各商店尺寸）。用户提到“应用商店截图 / App Store 截图 / Google Play 截图 / 上架截图 / ASO 截图”时使用。
---

# 应用商店截图制作

全部在本机生成，不联网。

1. **准备文案**：先看每张截图（可以读取图片）判断它展示的功能，为每种语言写一个**短**标题（中文 ≤ 12 字，英文 2–6 个词）和可选副标题。标题讲用户得到的好处，不写功能名堆砌。把文案给用户确认。
2. **打开**：`shots_open(paths | folder, locales, texts, presets?, theme?)`，`texts[i]` 是第 i 张的 `{"zh-Hans": {title, subtitle}, "en-US": {...}}`；或 `shots_open(project: "xxx.storeshots.json")`。截图顺序就是商店展示顺序，第一张最重要。最多 10 张（Google Play 只用前 8 张）。
   - 尺寸 id：`ios-6.9`（1320×2868，App Store 必需）、`ios-6.5`、`ios-5.5`、`ipad-13`（有 iPad 版时必需）、`play-phone`、`play-tablet`。
   - `theme`：`background`、`background2`（渐变，空字符串关闭）、`textColor`（auto 或颜色）、`frame`（auto/iphone/android/none）、`frameColor`、`textPosition`（top/bottom）、`deviceScale` 0.5–0.95、`bleed`、`titleScale`。
3. **看检查结果**：标题过长 → 缩短；缺少翻译 → 补上该语言的 `text`；分辨率不足 → 请用户提供更清晰的截图；平板尺寸用的是手机截图 → 请用户提供 iPad 截图并写到 `slides[i].tabletImage`。
4. **修改**：单张背景用 `slides[i].background`；改文案直接改 `slides[i].text[locale]`。`project_save(path, project)` 保存为 `.storeshots.json`。
5. **导出**：`shots_export(project, locales?, presets?, indices?)` → `store-screenshots/<语言>/<尺寸>/<序号>-<名称>.png`。告诉用户上传时按序号顺序。本插件不上传到商店。
