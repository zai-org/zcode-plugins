# Zotero for ZCode

简体中文 | [English](README.md)

在对话旁使用你的 Zotero 文库。Agent 搜索你的论文，逐页阅读 PDF 与你自己的高亮，在 PDF 中高亮标出依据，生成引用与 `.bib` 文件，还可以导入论文、写笔记、整理分类。你在侧栏浏览同一个文库、阅读 PDF，并把论文或段落发给 Agent。

本插件基于 Zotero 本地 API 独立实现，并非 Zotero 项目出品。

Git 市场中的安装包已包含编译好的 MCP server 与面板，无需构建。需要：

- Node.js 24+，以及支持插件 UI 的 ZCode 桌面版和本地工作区（Web、手机与远程工作区只显示普通工具记录，不显示面板）；
- 同一台电脑上运行的 Zotero 桌面版，并在“设置 → 高级”中勾选“允许此计算机上的其他应用程序与 Zotero 通信”；
- 读取需要 Zotero 7 或更高版本；**修改文库需要 Zotero 8 或更高版本**（Zotero 7 的本地 API 只读，插件会自动识别并关闭写入）。

## 使用

安装并启用 `zotero`，然后可以这样说：

- “我的 *Reachability Types* 分类里的论文怎么讨论循环引用？给我看出处。”
- “上个月我关于 effect system 都高亮了什么？”
- “为我的草稿写相关工作一段，并让 `paper/refs.bib` 与 *Alias Control* 分类保持同步。”
- “把 arXiv 2503.07328 加到 *PL* 分类，并打上 to-read 标签。”

也可以从侧栏“+”菜单打开面板。

### 面板

- **安装引导**：Zotero 未就绪时，面板列出三项要求：Zotero 程序、是否已打开、本地 API 是否开启。未安装或版本过旧时，**发给 Agent** 发出一条准备好的消息（你的系统、查找过的位置、可用的包管理器），由 Agent 安装；*自己安装*给出适合你系统的命令。已安装但未打开时，**打开 Zotero** 一键启动。本地 API 未开启时，面板指出要在 Zotero 设置中勾选哪一项。Zotero 一应答，面板自动连接。
- **文库**：选择我的文库、群组文库、分类或已保存的搜索；按标题、作者、年份搜索，或同时搜索全文与笔记；排序；加载更多。每行显示类型、作者、年份与出处，**PDF** 标签直接打开阅读器。
- **选择条目**：勾选条目（Shift 点击选择一段），**加入对话**把它们放进 Agent 的上下文，供你下一条消息使用；**提问**把你的问题连同条目一起发送。
- **条目详情**：作者、出处、摘要、你的注释与 Agent 的高亮、笔记、字段、分类、标签与附件；**在 Zotero 中显示**跳到 Zotero 里的该条目。
- **阅读器**：显示 PDF 以及你的 Zotero 注释（高亮、下划线、便签、图片框）和 Agent 的高亮（紫色，带 ✦）。点击高亮查看评论；可以把 Agent 的高亮保存到 Zotero 或移除。选中文字后可以**引用到对话**（连同页码与条目加入 Agent 的上下文）或就此**提问**。提供页码框、缩放、适应宽度、注释侧栏；**在 Zotero 中显示**用 Zotero 自己的阅读器打开该 PDF。
- Agent 展示的条目列表（`show_items`）显示在“来自 Agent”标题下；**返回**回到之前的位置。
- 你在 Zotero 里做的修改几秒内会出现在面板中。面板跟随 ZCode 的主题（浅色 / 深色）与语言（英文 / 简体中文）。

### 工具

| 工具 | 用途 |
| --- | --- |
| `list_collections` | 连接状态、文库、分类树、已保存的搜索 |
| `search_library` | 按文本（可含全文与笔记）、分类、标签或已保存的搜索查找条目 |
| `get_item` | 完整元数据、摘要、笔记与用户的注释 |
| `search_annotations` | 在整个文库中查找用户的高亮与评论 |
| `read_fulltext`、`find_in_pdf` | 按页读取 PDF 文本；查找短语并给出页码 |
| `cite` | BibTeX / BibLaTeX / CSL-JSON / RIS，或按 CSL 样式格式化的引用 |
| `open_item`、`show_items` | 在面板中显示 PDF（定位到页或引文）、条目或条目列表 |
| `highlight`、`clear_highlights` | 在阅读器中添加带评论的 Agent 高亮（本会话内） |
| `save_highlights` | 把 Agent 高亮保存为 Zotero 注释 |
| `add_item`、`attach_pdf` | 按 DOI 或 arXiv 编号导入，或按元数据创建；从链接或工作区文件附加 PDF |
| `update_item`、`add_note`、`create_collection` | 修改字段、标签与分类；Markdown 笔记；新建分类 |
| `export_bib` | 从分类或条目生成工作区里的 `.bib` 文件 |
| `authorize_writes` | 提前请求写入权限 |

### 权限、隐私与网络

- 插件只与本机的 Zotero 通信（`127.0.0.1:23119`；可在插件设置“Zotero 地址”中改端口，只接受本机地址）。读取不需要授权。
- **写入**经由 Zotero 自己的授权对话框：第一次修改时 Zotero 会显示“允许 / 始终允许 / 拒绝”。选择“始终允许”时，Zotero 发放的 key 保存在插件的私有数据目录（文件权限 0600）中并重复使用；选择“允许”时每次修改都会再次询问。你可以在 Zotero 中撤销 key。ZCode 也会按你的设置在工具调用前请求批准。
- 插件不能删除条目，只做工具所描述的修改。Agent 的高亮在保存前只存在于当前会话。
- 只读取 Zotero 为附件报告的 PDF 路径，不读取磁盘上的其他文件。`.bib` 导出与工作区 PDF 限定在工作区内，导出内容不包含本机文件路径。
- 只有导入时会访问网络：`add_item` 从 `doi.org` 或 `export.arxiv.org` 获取元数据、下载 arXiv PDF，以及下载 Agent 提供的 PDF 链接。下载内容必须是 100 MB 以内的真实 PDF。

## 从源码构建

源码位于 `ui-plugins/zotero`。在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm build
```

在插件商店中把 `dist/local-marketplace` 的绝对路径添加为本地市场，然后安装并启用 `zotero`。修改源码后，重新构建、刷新来源、重新安装插件，并在新会话中测试。

测试（在 `ui-plugins/zotero` 中运行）：

```sh
pnpm test        # 针对模拟 Zotero 本地 API 的单元与集成测试
pnpm test:e2e    # 打包后的 server 与面板，经官方 AppBridge 宿主在 Chrome 中运行
pnpm test:setup  # 在 Chrome 中测试安装引导：缺少 Zotero、交给 Agent、打开 Zotero、本地 API 未开启
pnpm live        # 针对本机正在运行的 Zotero 的只读检查
pnpm live --write  # 另外创建再删除一个测试分类与条目（Zotero 会请求授权）
```
