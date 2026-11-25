---
name: product-3d-showcase
description: 把 glTF/GLB 产品模型做成多角度产品图（白底/透明底）、360° 旋转视频（WebM/MP4）和可离线打开的网页 3D 展示。用户提到“产品 3D 展示 / 产品图 / 白底图 / 360 度视频 / 3D 模型展示 / glb”时使用。
---

# 产品 3D 展示

1. 打开：`showcase_open(model: "xx.glb" 或 "xx.gltf", settings?)`。
   - 结果会说明模型的网格、材质、贴图数量和大小。
   - OBJ/FBX/USDZ 不支持：请用户先用 Blender 导出 glTF 2.0。
2. 按用户的要求设置，然后调用 `showcase_save(settings)`。settings 必须带 `model`。
   - 角度 `angles`：
     - 预设名：front、three-quarter-left、three-quarter-right、side、back、top。
     - 也可以写 `{name, yaw, pitch, zoom}`。yaw 0 是正面，正数向右转；pitch 是俯视角度，低机位用 0–5。
   - 背景 `background`：`"#ffffff"`、`"transparent"` 或其他颜色。
   - 其他选项：
     - `lighting`："studio"、"soft" 或 "dramatic"。
     - `shadow`、`exposure`。
     - `size`：图片像素。
     - `video: {enabled, seconds, size}`、`viewer`、`output`。
   - 告诉用户也可以在面板里拖动预览选角度。
3. 导出：`showcase_export(settings)`。
   - 渲染在面板里完成，面板要保持打开。
   - 完成后面板会把文件清单发回上下文。
   - 告诉用户输出文件夹里有什么：PNG、`turntable.webm`（装了 ffmpeg 还有 `.mp4`）和 `viewer/index.html`。网页展示可以直接双击打开，或放到任何静态托管上。
