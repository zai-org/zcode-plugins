# openpencil

Git 市场安装包包含已编译的 MCP 服务与 UI 资源，无需用户手动构建。运行需要 Node.js 24+ 和支持 Plugin UI 的 ZCode Desktop。下方构建步骤供源码开发使用。

通过官方插件市场安装并启用本插件；安装包自带必要运行时依赖，无需安装 npm 包。
在对话侧栏用 [OpenPencil](https://github.com/open-pencil/open-pencil)（MIT）编辑工作区里的 Figma `.fig` 设计稿；Agent 通过 OpenPencil 的 100+ 设计工具直接改面板里的活文档，用户右键把选区交给对话，按稿生成代码。

## 构建与加载

直接构建 [OpenPencil v0.14.0 的完整 Web 编辑器](https://github.com/open-pencil/open-pencil/tree/c29654cd07ac46b53e76c16b18505919f16571be)，保留上游页面 / 图层 / Assets、钢笔和形状工具、属性、自动布局、组件、变量、Code、快捷键及移动布局。构建脚本验证源码归档 SHA-256，并用上游 `bun.lock` 冻结安装。源码构建需要 Node.js 24、pnpm 和 Bun；首次构建需要联网，后续使用忽略目录中的缓存。安装好的插件只需要 Node.js，不需要 Bun 或开发服务器。

面板通过资源级 `zcode/csp` 声明 Yoga / CanvasKit 所需的 WebAssembly 和 `.fig` schema 所需的动态编译权限。模块启动失败时显示错误原因；该声明不启用 Agent 的可选 eval 工具。

```bash
pnpm build   # dist/server.mjs + dist/ui/*
pnpm --filter @zcode/plugin-openpencil test    # 单测
node ui-plugins/openpencil/scripts/smoke.mjs   # 真实拉起 stdio server 冒烟
node scripts/test-mcp-app-pages.mjs openpencil # 完整 UI、MCP 往返、保存重载、多标签隔离、主题和窄屏
```

源码开发时先在仓库根目录构建，再在插件商店添加 `dist/local-marketplace` 的绝对路径，安装并启用 `openpencil`。不要添加仓库根目录，其官方来源名称属于保留名称。源码更新后重新构建、刷新来源、重新安装插件，并在新会话测试。安装产物包含打包的 JS，以及 `dist/node_modules` 中所需的 css-tree、CanvasKit 和数据依赖，离开源码仓库也能启动。

启用后可发送：“新建设计稿 designs/landing.fig，放一个 hero 区块”。面板自动打开；手改后自动保存，Agent 修改后排队保存。上游 File 菜单打开工作区设计稿，Save / Save as 写入工作区 `.fig`；导出也选择工作区路径，不覆盖已有文件。新标签首次保存时选择路径，关闭有修改的标签前先保存，取消或保存失败时保留草稿。

AI 页直接把选区和请求交给 ZCode 当前对话，使用该对话的模型与 MCP 工具。右键可添加上下文、请求修改或生成代码；右上角 `＋` 也可添加选区。上游独立云存储、模型凭据、协作服务、自动更新和 PWA 由宿主集成替代。

## 结构

以下源码路径相对 `ui-plugins/openpencil/`；skill 位于 `external_plugins/openpencil/`。

- `src/adapters/server.ts`：自有工具（open/new/save/status/export/describe/convert）+ 上游 `registerTools` 透传；只有 open/new 声明面板 UI，其余工具复用已连接的编辑器；另提供 `panel` / `assets` / `design` 资源
- `src/adapters/upstream.ts`：进程内 `@open-pencil/mcp` `startServer()`（随机回环端口、token），工具经 `/rpc` 代理进面板
- `src/adapters/registry.ts`：文档登记表（path ↔ id ↔ revision ↔ owner），`fs.watch` 外部修改检测
- `scripts/upstream.mjs` / `scripts/build-web.mjs`：固定来源并构建上游 EditorView；安装资源记录 commit
- `ui/web/`：文件、标签页、主题 / 语言、AI 与选区操作的宿主适配；完整编辑组件直接来自上游
- `ui/bridge.ts`：工具调用与 UI 共用目标标签的 editor；命令串行执行，异步执行期间保持目标文档身份
- `skills/design/SKILL.md`：Agent 使用说明

## 已知边界

- 字体：内置 Inter / Noto Naskh Arabic；系统字体与在线字体未接入（CJK 会走上游替代逻辑）。
- 一个面板支持多个文档标签；每个文件只有一个活 editor。`.pen` 导入后另存为 `.fig`。
- 剪贴板读取、桌面拖拽是否可用受宿主沙箱权限限制；文件与导出通过 MCP 写入当前工作区。

## 独立仓库构建

在 zcode-plugins 根目录执行 `pnpm install --frozen-lockfile`、`pnpm build`、`pnpm typecheck`、`pnpm test` 和 `pnpm test:artifacts`。源码位于 `ui-plugins/openpencil`，可安装产物位于 `external_plugins/openpencil`；不要直接安装源码目录。`python3 scripts/build_dist.py` 生成 marketplace zip。运行需要 Node.js 24；不需要主应用源码或私有插件 SDK。
