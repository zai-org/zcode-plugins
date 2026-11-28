# 图片幻灯片视频

用一个文件夹的照片和一首歌做幻灯片视频（音乐放在同一个文件夹里，或一起选择）。照片按拍摄时间（EXIF）排好，每张加上缓慢推拉或平移的镜头效果（Ken Burns），之间用转场衔接；手机照片会自动转正。可以设置每张停留几秒、转场样式、照片怎么放进画面（铺满裁切，或者完整显示叠在模糊背景上），加字幕，还能按音乐长度自动调整时长让视频和音乐一起结束。渲染前会提示分辨率太低、重复的照片、读不出来的文件，以及时长比转场还短的照片。导出 1080p MP4（横屏、方形或竖屏）和一张标出每张照片时间的故事板 PNG。在本地用 ffmpeg 运行，不用登录，无需 API 密钥。

## 功能

- **按拍摄时间排序**（EXIF）或按文件名；手机照片自动转正。
- **Ken Burns 镜头**：每张推近、拉远或平移，自动轮换。
- **转场**：淡入淡出、溶解、滑动、擦除、圆形展开或无，时长可调。
- **适配方式**：铺满裁切、完整显示加模糊背景，或纯色背景。
- **音乐**：短了循环，长了淡出，也可以按音乐长度拉伸照片时长。
- **检查**：分辨率太低、重复照片、读不出的文件、比转场还短的照片。
- **导出**：1080p MP4（横屏/方形/竖屏）和故事板 PNG。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `slideshow-video/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “用 茶园一日 文件夹里的照片和 茶园小调.mp3 做幻灯片视频”
- “去掉重复的照片，第一张加字幕“清晨的茶园”，按音乐长度对齐”
- “导出 MP4”

## 工具

| 工具 | 作用 |
|---|---|
| `slideshow_open` | 读取照片和音乐，排好幻灯片，并打开面板 |
| `slideshow_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `slideshow_status` | 查看当前数据、问题和汇总 |
| `slideshow_export` | 导出 <标题>.mp4 和 <标题>-storyboard.png |

导出文件写到工作区的 `slideshow-video/<项目>/` 文件夹。

## 范围（v0.1）

- 需要安装 ffmpeg（免费；macOS：brew install ffmpeg；Windows：winget install ffmpeg）。
- v0.1 不读取 HEIC 照片，请先导出为 JPEG。渲染每张照片大约一秒。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `slideshow-video/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/slideshow-video/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-slideshow-video test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
