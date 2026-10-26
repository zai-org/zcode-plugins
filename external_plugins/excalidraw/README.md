# Excalidraw for ZCode

Git 市场安装包包含已编译的 MCP 服务与 UI 资源，无需用户手动构建。运行需要 Node.js 24+ 和支持 Plugin UI 的 ZCode Desktop。下方构建步骤供源码开发使用。

本插件通过本地 marketplace 安装；下方流程用于源码目录或独立插件包。

Agent 生成可编辑图形，用户在会话侧栏继续绘图、引用选区让 Agent 局部修改，并导出 `.excalidraw`、PNG 或 SVG。

## 构建与加载

需要 Node.js 24+ 和支持 Plugin UI 的 ZCode Desktop。本仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm build
```

在 ZCode 插件商店添加 `dist/local-marketplace` 的绝对路径作为本地 marketplace 来源，安装并启用 `excalidraw`。不要添加仓库根目录，其官方来源名称属于保留名称。源码更新后重新构建、刷新来源、重新安装插件，并在新会话测试。发布时使用 `dist/plugins/excalidraw/<version>/plugin.zip`。MCP 与编辑器已打包，运行时无需安装 npm 依赖。当前交互面板支持桌面本地工作区；其他平台使用宿主普通 MCP 记录回退。

启用后可发送：“用 Excalidraw 画一个 API、缓存和数据库的架构图”。生成结果会打开侧栏。手工修改自动保存；选中元素后右键“引用选区到对话”，再发送指令，Agent 可以按稳定元素 ID 修改。未选中元素时可引用整图，文档菜单中也提供引用入口。

顶部左侧的三横线图标是「菜单」，可新建、导入、重命名或切换文档；旁边「+」可直接新建，右侧向下箭头图标可导出。这三个按钮使用统一的圆角方形样式，悬停可查看名称。画板名称统一显示在标签页中，只有 1 张画板时也显示；最近打开的最多 8 张画板在顶部同一行显示，位于「+」与保存状态之间。空间不足时，鼠标停在标签区域滚动滚轮即可左右移动，触控板横向滚动也可使用；点击标签切换画板。双击当前标签名称可重命名，也可从菜单选择重命名或在当前标签按 F2。名称在保存确认后同步更新，保留画板 ID、内容和当前撤销历史。空画板以 100% 缩放打开。

标签右侧「×」只关闭标签，不删除画板，可随时从菜单重新打开。关闭当前标签时先等待保存，再切到相邻标签；关闭最后一个标签后显示空画布。保存失败时保留标签和草稿。关闭状态随标签列表在会话内恢复，旧工具结果不会自动重新打开已关闭的标签。

打开、切换或重命名画板后，插件通过 `updateModelContext` 将当前画板 ID、名称、版本加入当前会话的对话输入框，替换本面板之前的引用；手动“引用选区”再补充元素 ID。关闭最后一个标签时发送 `documentId: null`，表示没有当前画板。下一次发送时模型能读到目标画板，修改前仍需重新读取最新版本。切换标签不会改变已经发出的模型请求。用户移除输入框上下文后，可再次引用当前画板。最近标签和当前选择由宿主 `widgetState` 在会话内恢复，不保证应用重启后恢复标签列表。

“导出”打开格式与文件路径对话框，支持 `.excalidraw`、PNG、SVG。导出路径相对于当前工作区，覆盖已有文件需勾选“覆盖同名文件”。画布下方保留 Excalidraw 自身的缩放、撤销/重做控件。

## 保存与恢复

文档存放在宿主分配的插件数据目录 `ZCODE_PLUGIN_DATA`（ZCode 下为 `~/.zcode/cli/plugins/data/<plugin-id>`，卸载插件时默认一并删除）的 `<workspace-key-hash>/documents.sqlite`；脱离宿主单独运行时退到 `~/.zcode/plugin-data/excalidraw`。`ZCODE_WORKSPACE_ROOT` 指定工作区文件路径；可信启动方可提供 `ZCODE_WORKSPACE_IDENTITY` 隔离同路径的工作区身份。

右上角圆点表示保存状态：绿色为已保存（后端已确认），黄色为保存中，红色为保存失败，灰色为未打开画板；悬停可查看文字，读屏也会播报状态。强制关闭时仅保证已确认内容恢复。多窗口同时改图时，版本冲突会保留本页草稿，可以另存副本或放弃草稿后重载。

手工修改与工具修改共用当前画板的撤销/重做，撤销后的内容照常保存为新版本。同一文档的新内容更新保留已有历史和视角；切换文档、关闭重开或放弃草稿重载后重新开始历史。撤销栈不跨窗口或重启持久化。升级时移除旧的独立 AI 恢复字段和工具，保留既有画板内容、版本与幂等记录。

编辑器和字体随包分块加载，无 CDN 依赖。每份文档最多 5000 个元素、6 MiB；图片保存在原生文档中。当前不提供多人实时协作、系统剪贴板权限或云分享。

## 验证

```sh
pnpm --filter @zcode/plugin-excalidraw test
pnpm --filter @zcode/plugin-excalidraw typecheck
pnpm --filter @zcode/plugin-excalidraw smoke
pnpm --filter @zcode/plugin-excalidraw test:e2e
```

浏览器测试需先 build，并安装 Chrome（或用 `CHROME_PATH` 指定 Chromium 可执行文件）。测试使用真实 stdio MCP 和临时 SQLite，宿主桥使用测试适配，不覆盖桌面沙箱桥。截图默认保存到系统临时目录 `excalidraw-e2e`，可用 `EXCALIDRAW_E2E_ARTIFACTS` 指定目录。

包内 `licenses/` 保留 [Excalidraw](https://github.com/excalidraw/excalidraw/tree/v0.18.1) 及字体许可证，`dist/THIRD_PARTY_NOTICES.txt` 从实际打包依赖生成。

## 独立仓库构建

在 zcode-plugins 根目录执行 `pnpm install --frozen-lockfile`、`pnpm build`、`pnpm typecheck`、`pnpm test` 和 `pnpm test:artifacts`。源码位于 `ui-plugins/excalidraw`，可安装产物位于 `external_plugins/excalidraw`；不要直接安装源码目录。`python3 scripts/build_dist.py` 生成 marketplace zip。运行需要 Node.js 24；不需要主应用源码或私有插件 SDK。
