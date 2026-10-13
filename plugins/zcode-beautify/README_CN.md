# zcode-beautify —— ZCode 壁纸与 Material Design 3 主题

[English](./README.md)

把图片或 Wallpaper Engine 场景/视频设为 ZCode 桌面背景，以 Material Design 3
（Monet）动态取色适配全局界面配色，并可在应用内实时面板中调节模糊、压暗、取景、
聊天区遮罩与壁纸轮播——全部通过 Chrome DevTools Protocol 在本机完成，不修改
ZCode 安装目录中的任何文件。

## 平台支持

在 **Windows** 上的 ZCode 桌面客户端开发并验证，要求 `node` 在 `PATH` 中
（ZCode 客户端会为自带的 MCP 服务提供 Node.js）。静态图片壁纸与 Monet 取色
链路仅依赖 Node.js 与 CDP，不限于 Windows。**动态壁纸**（Wallpaper Engine
场景与视频）额外要求 Windows、Wallpaper Engine 与 ffmpeg ≥ 5.0（在 `PATH`），
两者都会被自动检测，缺失时面板会给出安装引导。

## 功能

- `/beautify` 命令与 `beautify` 技能——由智能体完成壁纸设置、场景导入与微调。
- 一个 `zcode-beautify` stdio MCP 服务，提供六个工具：

  | 工具 | 用途 |
  |---|---|
  | `set_background` | 将图片、视频或 Wallpaper Engine 场景设为壁纸并适配配色 |
  | `import_scene_wallpaper` | 导入场景为无缝循环动态壁纸（渲染 → 录制 → 循环化 → 缓存） |
  | `apply_options` | 微调模糊 / 压暗 / 莫奈取色 / 壁纸显隐 / 取景，无需重新应用 |
  | `refresh_theme` | ZCode 重启后重新注入已存主题 |
  | `reset_appearance` | 移除壁纸与配色覆盖 |
  | `beautify_status` | 查看当前存储的配置 |

- ZCode 内**可拖动的实时设置面板**：模糊 / 压暗滑杆、莫奈取色与壁纸显隐开关、
  三种取景模式（`cover`、`contain`、`smart`）、图片库与场景库（重命名 / 两段式
  删除）、带进度的批量场景导入、录制分辨率选项、聊天界面分区遮罩（压暗 / 上下端
  渐变 / 白纱）、图片缓动、每库显示行数、轮播方案（顺序 / 随机 / 每日定点，支持
  每方案切换特效与生效时段）、最近使用记录、配置导出 / 导入。
- 场景与视频经 Wallpaper Engine 渲染、录制，处理成首尾帧严格相等的无缝循环后
  按内容寻址缓存，并通过本机 HTTP 流式播放到渲染进程。

## 安装

在 ZCode 中打开 **设置 → 插件管理**，搜索 **zcode-beautify**，从官方插件市场安装。
安装、启用或更新插件后请**新开一个任务**——ZCode 在任务启动时对插件的 MCP 配置
做快照。

## 首次使用

主题注入要求 ZCode 以远程调试端口（`9222`）运行。如果工具报 CDP / 端口错误，
在插件目录下执行一次：

```bash
node dist/cli.js launch
```

该命令会重启一次 ZCode 并带上 `--remote-debugging-port=9222`，同时把启动参数写入
ZCode 快捷方式，之后每次启动都会保持。ZCode 会话会保留，不影响其他程序中未保存
的工作。插件的 MCP 服务会随插件自动启动后台 `serve` 服务（以及设置面板），无需
手动管理。

## 快速验证

1. 运行 `/beautify <图片绝对路径>`：壁纸与莫奈配色生效，ZCode 窗口角落出现设置
   面板。
2. 拖动面板中的模糊 / 压暗滑杆：实时预览，且重启后仍然保留。
3. （可选，Windows）在面板的场景标签中导入一个 Wallpaper Engine 场景：完成
   渲染、录制、循环化并缓存，重复导入即时返回；随后把它加入轮播方案，确认按计划
   自动切换。

## 副作用与安全说明

- **本地进程**：MCP 服务会启动一个后台 Node 服务（`serve`）——仅监听本机
  `127.0.0.1:9223` 的 HTTP API，并带每次启动随机生成的访问令牌。场景 / 视频导入
  会额外拉起 Wallpaper Engine 与 ffmpeg；面板的文件选择器在 Windows 上会运行
  PowerShell 对话框。
- **写入位置**：所有运行数据（配置、导入的壁纸副本、封面 / 缩略图缓存、场景循环
  缓存——上限 10 GB）都存放在 ZCode 的插件数据目录。插件不会写回自身安装目录，
  也不修改 ZCode 的安装文件；`reset` 可恢复默认外观。
- **注入方式**：通过 `127.0.0.1:9222` 上的 CDP 向 ZCode 渲染进程注入 DOM / CSS
  覆盖层，属非官方机制；ZCode 升级后插件可能需要适配。
- **网络**：运行时无任何外部网络访问，全部为本机通信。
- **第三方代码**：`dist/` 打包产物内嵌以下 npm 依赖——`@modelcontextprotocol/sdk`
  （MIT）、`@material/material-color-utilities`（Apache-2.0）、`jimp`（MIT）。
  Wallpaper Engine 与 ffmpeg 是可选的外部程序，未随包分发。

## 许可证

MIT，见 [LICENSE](./LICENSE)。

基于 Logocceai 的原始项目 [zcode-beautify](https://github.com/Logocceai/zcode-beautify)；
本包为持续维护的 fork
（[Mc-GrowlR/zcode-beautify-for-wallpaper-engine](https://github.com/Mc-GrowlR/zcode-beautify-for-wallpaper-engine)），
版本 0.4.0，新增多方案轮播、Wallpaper Engine 壁纸库浏览器、加固的导入管线与三标签
重设计面板。
