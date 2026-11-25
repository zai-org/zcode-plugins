# 产品 3D 展示

把 glTF/GLB 产品模型做成一整套统一风格的展示素材：多角度产品图、360° 旋转视频和网页 3D 展示。

## 功能

- **影棚场景**：three.js 渲染，中性室内环境光，加主光、补光、轮廓光。
  - 灯光预设：影棚、柔光、戏剧。
  - ACES 色调映射，曝光可调。
  - 模型自动居中、落地、取景，每个角度占画面的比例一致。
  - 可选柔和地面阴影，画在看不见的地面上，透明底也能用。
- **角度**：
  - 预设：正面、左右 45°、侧面、背面、俯视。也可以自定义。
  - 在实时预览里拖到想要的视角，点“＋ 加入这个角度”。
  - 每个角度有名字、水平角、俯仰角和缩放。
- **产品图**：每个角度一张方形 PNG，256–4096 px，白底、透明底或任意颜色。
- **360° 旋转视频**：
  - 逐帧渲染，用 WebCodecs（VP9/VP8）编码成 WebM。机器慢也不会掉帧，帧数精确。
  - 时长和尺寸可调，30 fps。
  - 装了 ffmpeg 会再出一份 H.264 MP4（yuv420p、faststart），方便传电商平台和社交媒体。
- **网页 3D 展示**：
  - 由 `viewer/index.html`、`viewer.js` 和 `model.js` 组成。
  - 直接双击就能打开（file://），不需要服务器和网络。
  - 可拖动旋转、缩放、自动旋转，灯光与产品图一致。
  - 也可以放到任何静态托管上。
- **模型**：`.glb`；也支持带外部 `.bin` 和贴图的 `.gltf`，会自动内联。

## 使用

在 ZCode Desktop 里对 Agent 说：

- “用 bottle.glb 做一套白底产品图：正面、左右 45°、侧面、背面”
- “再出一段 6 秒的 360° 旋转视频和网页 3D 展示，图片要透明底”
- “灯光柔和一点，再加一个低机位的主图角度”

## 工具

| 工具 | 作用 |
|---|---|
| `showcase_open` | 打开模型，可同时传设置。会报告模型里有什么：网格、材质、贴图、大小 |
| `showcase_save` | 保存设置：角度、灯光、背景、阴影、曝光、尺寸、视频和网页展示选项 |
| `showcase_export` | 在打开的面板里渲染并保存全部输出 |

输出在 `showcase/<模型名>/`：

- `<角度>.png`
- `turntable.webm`，以及 `.mp4`
- `viewer/`
- `showcase.json`：设置，下次打开时沿用

## 范围（v0.1）

- 只支持 glTF 2.0。OBJ/FBX/USDZ 请先转换，例如用 Blender：文件 → 导出 → glTF 2.0。
- 暂不支持 Draco/meshopt 压缩和 KTX2 贴图的模型。
- 渲染需要面板里的 WebGL。
- 视频背景不支持透明；透明底时视频用白底。
- 不含 AI 生图或背景场景生成。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的模型及其引用的文件；只写入工作区里的输出文件夹。
- ffmpeg（可选）以参数数组调用，不经过 shell。没有 hooks。

## 构建与测试（开发者）

- 源码：`ui-plugins/product-3d-showcase/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，再把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-product-3d-showcase test` 和 `test:e2e`。
- `E2E_MODELS` 指向含 `WaterBottle.glb` 与 `avocado/` 的文件夹。这两个模型来自 Khronos glTF-Sample-Assets，CC0 授权。

## 第三方组件与许可证

本插件以 MIT 许可证发布，作者 Penova。

- 打包进插件的组件：three.js（MIT）、MCP SDK 与 ext-apps（MIT）、zod（MIT）。完整清单见 `dist/THIRD_PARTY_NOTICES.txt`。
- 不打包 ffmpeg。
