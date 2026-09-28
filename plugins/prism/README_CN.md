# Prism

> 一束白光进棱镜，折射出每个项目自己的颜色。

**Prism** 是面向 [ZCode](https://zcode.z.ai) 桌面端的个性化插件：给左侧边栏里的每个项目一套独立的视觉身份——颜色、图标、显示名，支持给单条对话换色，并可让侧边栏按最近活跃自动排序。

## 功能

- **项目颜色**：项目的所有会话行染上专属色（背景叠加 + 左侧色条），跨「项目 / 分组 / 时间线」视图一致；只染你手动指定的项目。
- **对话颜色**：右键任意对话行 →「调整颜色（此对话）」只给这一条换色、覆盖项目色；「取消颜色（此对话）」和取色盘里的「透明」是显式无色状态，优先于项目颜色。
- **项目图标**：30 个精选 Lucide 图标（从 ZCode 自带渲染资源抽取）替换项目头的 folder 图标；home/远程项目保留 house/cloud 语义图标。
- **项目重命名**：只改 ZCode 内的显示名（别名），不碰磁盘文件夹与工作区关联。
- **按最近活跃排序**：项目、分组、时间线三个视图都生效——对话按各自最后活跃时间排，项目/分组按其最新对话排。纯显示层重排（CSS `order`），不写入手动拖拽顺序，关掉开关立即恢复原样。
- **全局开关**：压暗对话标题、调亮思考扫光、未指定项目的自动配色（默认关）、按最近活跃排序。

## 环境要求

- macOS，且 ZCode 桌面端安装在 `/Applications/ZCode.app`（Prism 只处理这一默认布局，其他位置不会被改动）。

## 使用

| 操作 | 入口 |
| --- | --- |
| 项目颜色 / 图标 | 右键项目标题行，或项目头 `…` 菜单 →「调整颜色」 |
| 对话颜色 | 右键对话行 →「调整颜色（此对话）」 |
| 取消颜色 | 右键对话行 / 项目头 `…` 菜单 →「取消颜色」 |
| 重命名 | 项目头 `…` 菜单 →「重命名」（仅显示名） |
| 全局开关 | 取色盘底部「Prism」 |

所有选择即时生效，数据存于渲染进程 `localStorage`（`zcProjectTint.*` / `zcPrism.settings.v1`）。会话内运行 `/status` 可查看 shim 安装状态。

## 副作用、权限与安全

安装前请先读这一节——修改应用包是插件重整桌面端 UI 的唯一途径。

- **写入了什么**：SessionStart 钩子（`hooks/ensure-shim.js`）解包 `/Applications/ZCode.app/Contents/Resources/app.asar`，向 `out/renderer/index.html` 注入唯一一个 `<script>` 块（即本插件的 `renderer/prism.js`），重新打包后原位替换。首次打补丁前会把原始包备份为 `app.asar.pristine-backup`；运行状态记录在 `~/.zcode/prism-state.json`。
- **何时运行**：每次会话开始只做快速模式（按内容哈希比对已装 shim）；仅当 shim 缺失或过期（例如 ZCode 刚自动更新）才完整重打包。除此之外不修改任何文件——没有偏好设置、没有启动项。
- **网络**：无。Prism 不会建立任何网络连接，全部是本地文件与 DOM 操作。
- **遥测**：无。
- **回滚**：`mv /Applications/ZCode.app/Contents/Resources/app.asar{.pristine-backup,}` 恢复原始包（或重装 ZCode）。禁用/卸载插件后钩子停止；已打入的效果随回滚消失。
- **失败安全**：注入脚本全防御式编写——每个入口都有兜底，异常只打日志、不影响 App。若应用更新破坏 shim 契约，下次会话自动重装当前版本。

## 第三方素材与许可

- 本插件代码：MIT（见 `LICENSE`）。
- [Lucide](https://lucide.dev) 图标 path 数据（ISC），抽自 ZCode 自带渲染资源。
- `node_modules/` 内置 [`@electron/asar`](https://www.npmjs.com/package/@electron/asar)（MIT）及其传递依赖（`glob`、`minimatch` 等），因为市场安装不执行 `npm install`，钩子运行时需要就地可用。

## 开发

源码仓库：<https://github.com/saralaaga/prism>。手动重打 shim：`node hooks/ensure-shim.js --apply`。
