# 插件构建约定

普通插件和带 UI 的插件共用根目录 `marketplace.json`、安装目录、版本规则及宿主的注册、安装、启用、更新入口。开发流程以[现有插件教程](PLUGIN_DEVELOPMENT_CN.md#18-在客户端本地测试)为准；UI 仅增加 MCP 页面资源和 `ui.surfaces`，没有独立注册机制。

`plugins/<name>/dist/` / `external_plugins/<name>/dist/`、OpenPencil 的 `dist/node_modules/`，以及根目录 `dist/` 的发布 ZIP，都是构建输出，不提交到 Git，由 `.gitignore` 排除，并由 `tests/test_generated_outputs.py` 阻止重新入库。CI 与本地开发使用同一入口 `pnpm build` 从 `ui-plugins/<name>/` 生成它们；CI 中的产物测试、打包和发布预演都在构建之后执行。因此需要编译的插件不能从未构建的 Git checkout 直接安装：本地测试先构建，再使用 `dist/local-marketplace`；正式用户通过已发布的市场安装。

Craft 插件的网页编译快照 `ui-plugins/<name>/web/` 同样是构建输出，不提交。构建时依次使用工作区已有的快照、快照缓存（`CRAFT_BUILD_CACHE`，默认 `.craft-cache/`）、从 `upstream.json` 固定的上游提交现场编译；编译需要 `ui-plugins/craft-runtime/toolchain.json` 固定的 Rust / Trunk、Chrome，以及访问上游仓库、crates.io 和 GitHub Release 的网络。细节见[适配层说明](../ui-plugins/craft-runtime/README.md#build)。

## 清单与构建所有权

- 根目录 `marketplace.json` 是唯一插件清单。每个条目的 `source` 指向 `./plugins/<name>` 或 `./external_plugins/<name>`，与 `.zcode-plugin/plugin.json` 的名称、版本一致。新增插件、删除条目或升级版本不需要修改根构建脚本。
- 无需编译的插件直接使用安装目录。需要编译的插件在 `ui-plugins/<name>/package.json` 声明 `scripts.build`；名称来自 marketplace 条目，不要求固定前缀。
- `pnpm build` 逐项发现已登记的源码包并运行其 `build` 脚本，把 `dist/` 复制到安装目录。可选的 `scripts.stage` 负责额外资源，目标目录由 `ZCODE_PLUGIN_INSTALL_DIR` 传入。根脚本不识别具体插件名称或第三方依赖。
- 资源和外部运行依赖归插件自己的构建 / stage 脚本负责；只复制运行所需文件，不能把开发工作区的 node_modules 链接带进安装包。stage 只能清理自己生成的资源，不能删除安装清单、skill、说明或许可。
- 构建前清除旧完成标记，全部资源到位且清单声明的本地服务入口存在后，最后写入 `dist/build-info.json`。完成标记与源码、插件清单、marketplace 版本一致，不能发布部分产物。全量与增量 zip 发布使用同一检查。

## 插件命名

这批 UI 插件使用简短名称 `excalidraw`、`openpencil`。源码目录 `ui-plugins/<name>`、安装目录 `plugins/<name>` 或 `external_plugins/<name>`、marketplace 条目、安装清单 `name`、MCP 服务身份和 `ui://<name>/...` 资源地址保持一致；没有产品前缀要求。构建清单仍为唯一目录来源。

用户可见名称由根 marketplace 条目的 `displayName` / `displayName_i18n` 持有，不依赖文件夹名称或从 ID 推导大小写。这两个条目分别显示为 Excalidraw、OpenPencil，页面标题也不带产品前缀。本地来源与正式分发目录保留这些展示字段；宿主按完整插件 ID 关联 listing。

改名同步更新客户端、服务端、资源读取、文档、测试和锁文件的工作区路径；安装产物内容变化按版本规则升级。开发安装以插件 ID 区分，新名称须按普通流程重新安装；不自动删除旧安装或迁移旧插件数据。新旧安装中的页面与服务分别使用各自一致的资源地址。刷新来源只更新目录，旧 ID 的已安装副本不会因此改名；更新开发安装时应安装新 ID，并停用旧 ID，保留旧数据。

验收：新路径可冻结安装并构建；市场和已启用插件的引用列表在中英文下均显示简短名称；页面能从新资源地址读取资源并调用工具；复制出仓库的安装产物仍可独立运行。需要区分源码清单、本地来源缓存与已安装副本，不能只检查文件夹名称就宣称改名完成。

## 通用本地来源

`pnpm build` 构建后生成 `dist/local-marketplace`；`pnpm marketplace:local` 只根据已有安装产物重新生成该来源。它包含 marketplace 中的所有条目，包括普通 skill / Hook / MCP 插件和 UI 插件，不额外添加开发指引或固定示例。

默认来源名称从根 marketplace 名称派生：去掉末尾 `-official` 后追加 `-local`，本仓库为 `zcode-plugins-local`。这是官方保留名称校验要求的本地副本，适用于所有插件。条目的版本、描述、依赖及扩展元数据沿用根清单；显式引用当前市场的依赖随副本名称一同调整。

```text
marketplace.json → 有源码包的条目执行 build / stage → 校验安装产物
                                                        ↓
所有清单条目 → 本地来源副本 → 用户选定插件 → 宿主安装 / 启用 / 更新
```

生成器只写构建输出，不写用户配置、不安装、不启用、不触发线上市场更新。已有快照在校验或复制失败时保留。源码变化后，重新构建、刷新来源并重新安装选中的插件；已有安装是副本，不会热更新。

已登记过其他本地来源名称或目录时，可保留该身份，避免出现第二套安装记录：

```sh
pnpm marketplace:local --name my-local-plugins --output dist/my-local-plugins
```

`--output` 只允许 `dist/` 的直接子目录，防止覆盖源码或用户配置。`python3 scripts/build_dist.py` 清空 `dist/` 并生成正式分发制品；之后再执行 `pnpm marketplace:local` 即可重建本地来源，不必重新编译。

`zcode-mcp-app-dev` 是普通可选的开发 skill 插件，不是运行依赖。它仅在根清单保留该条目时出现在目录中，由开发者自行决定是否安装。

## 验收

### OpenPencil 完整 Web 编辑器

插件直接构建 OpenPencil v0.14.0 的 Web 编辑器源码，固定 commit 与归档 SHA-256，并使用上游冻结锁文件安装构建依赖。源码包声明固定版本的 Bun 构建依赖，CI 的 `pnpm install` 一并安装，不依赖 runner 全局工具。版本与插件现有 core / MCP 一致。安装包包含全部运行资源，不依赖外部网页或开发服务器。第三方源码、依赖缓存不提交；构建来源及许可证随产物保留。

保留上游 EditorView、页面 / 图层 / Assets、完整绘图工具、属性与自动布局、组件、变量、Code、快捷键、撤销重做和移动布局。替换宿主边界：工作区文件打开与保存使用 MCP；AI 页使用 ZCode 对话；协作入口显示 ZCode 文档状态。上游独立应用的云存储、独立 AI provider、更新与 PWA 不作为插件的第二套服务。

每个标签页持有一个上游 editor 和一个文档控制器，UI 与 MCP 共用这个 editor。MCP 请求按顺序执行，并在请求开始时固定目标标签页，不能因用户切换标签而修改其他文档。已打开文件按 document ID 复用标签；新标签首次保存时选择工作区路径。后台标签仍由对应控制器保存。关闭后解除 live owner，未保存的新文件不得静默丢失。

```text
ZCode Agent → MCP server → 工具桥 → 目标标签的 editor ← 上游完整 UI
                                      ↓
                              文档控制器（revision）
                                      ↓
                              工作区 .fig 文件
```

宿主 theme / locale 更新传入上游界面。资源继续使用 MCP 分片读取，WASM、worker、字体均在严格 CSP 下运行。保存失败与冲突有可见状态；选区能添加到对话上下文、请求 ZCode 修改或生成代码。窄屏分享入口也交给 ZCode 上下文，不创建独立协作房间；缩放居中使用实际画布视口。

验收使用真实安装产物：检查完整页面 / Assets / 属性 / 工具栏；用鼠标绘制并在属性面板修改；通过 MCP 读取 UI 修改并创建节点，确认画布和图层同步；保存并重载 `.fig`；切换两份文件验证身份隔离；验证中英文、深浅主题与窄屏。最后在当前仓库启动的 ZCode 中更新本地安装并实测。

### OpenPencil 编辑器启动

OpenPencil 的面板资源在 `_meta["zcode/csp"]` 声明 `wasmUnsafeEval` 与 `unsafeEval`：Yoga / CanvasKit 需要 WebAssembly，`.fig` 的 kiwi schema 编译需要动态函数。声明只属于该面板资源；WebSocket 仍只允许 `_meta.ui.csp.connectDomains` 中的运行时回环地址，不改变其他插件的权限或 Agent 的 `enableEval` 工具开关。

加载器必须捕获模块解析、求值和顶层 await 的失败，显示中英文错误及原因，不能一直保留 Loading。模块执行完成后撤销启动错误监听，不把后续编辑错误误报为加载失败。

```text
读取资源 → 按资源声明施加 CSP → 模块执行 → 载入初始设计稿 → 连接工具桥
                                  └─ 失败 → 显示加载错误
```

浏览器回归使用真实安装产物与 MCP 服务，按资源声明生成严格 CSP，验证 `.fig` 载入、CanvasKit、工具桥、编辑与保存；注入模块语法错误及顶层 await 拒绝，验证加载失败提示。这不替代真实 ZCode 桌面沙箱验证。

### 通用安装产物

- 新增任意名称的普通插件和 UI 源码包后，无需修改脚本就能生成目录并构建；未登记的目录不会被自动执行。
- 修改、删除根清单条目和更新版本会反映到新副本；不改写正式清单或用户安装状态。
- 缺失构建产物、版本不一致、服务入口缺失或 stage 失败时拒绝生成新副本；失败构建不留下完成标记。
- 复制出去的 UI 安装包可以独立启动服务并读取页面资源，不依赖主应用源码或私有 SDK。

## 验证命令

使用 Node.js 24.14.0 和 pnpm 10.33.2。依次运行 `pnpm install --frozen-lockfile`、`pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm test:artifacts`、`python3 scripts/validate.py`、`python3 scripts/build_dist.py`。注册成功与真实桌面交互通过分别报告。

已有插件的专属行为回归仍保留各自测试。浏览器协议测试使用 `pnpm test:pages`，需要 Chrome 或 `CHROME_PATH`；这些测试不替代真实桌面安全隔离验证。
