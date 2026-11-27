---
name: whitebackground
description: 生成纯白 #FFFFFF 的 PNG 画布，或打开 WhiteBackground 免费本机编辑器做白底图、透明抠图、透明 PNG 铺白底、不裁切正方形、Shopify 尺寸、本地放大。照片由用户在官方编辑器里选择；本插件不上传、不消耗积分、无需账号或 API 密钥。用户提到“白底图 / 纯白 PNG / 商品图抠图 / 透明背景 / Shopify 主图 / WhiteBackground”时使用。不要把它当成只能去纯色棚拍背景的「电商商品图助手」。
---

# 白底图（WhiteBackground）

使用官方公开能力：空白画布走 `https://whitebackground.app/api/mcp/canvas`，照片编辑走官方本机编辑器页面。不要发明 API 密钥，不要调用 Cloud / OAuth，不要代用户购买套餐或消耗积分。

1. **空白画布**：`canvas_create({ width, height, output? })`。每边 1–8192、总像素不超过 3200 万。默认写到 `whitebackground/white-{宽}x{高}.png`，已有文件会自动加后缀，不覆盖。把保存路径和官方下载链接告诉用户，并打开面板。
2. **照片流程**：`editor_open({ workflow })`，workflow 只能是 `white`、`transparent`、`png_to_white`、`square`、`shopify`、`enhance`。把返回的官方网址交给用户，说明必须在编辑器里自己选图、检查 Original / Result，再用编辑器下载。嵌入预览可能被缩放，完整分辨率需在编辑器里保存，或先在浏览器打开再下载。在用户实际下载之前，不要声称照片已经处理完成。
3. **不要做的事**：不要把聊天附件、工作区路径、base64 或私有 URL 发给这些工具（免费路径没有照片入参）。不要把本插件与 `product-photo-studio` 混用——后者只去纯色/浅色棚拍背景。
4. **限制**：免费背景编辑导出最长边 2200 px，不放大主体；增强器 2× 最多 2200 px、4× 最多 4096 px，并提醒用户检查文字与 logo。
5. **付费**：若用户问批量、4K 或高质量云端处理，只给出定价页 https://whitebackground.app/pricing，不要下单、不要扣积分。
6. 只需打开面板时用 `panel_open()`。
