# Markdown 编辑器

[English](README.md)

ZCode 的 Markdown **UI 插件**。在对话旁的侧边面板直接编辑工作区文件，提供基于 Vditor 的即时渲染、自动保存、大纲和 Agent 协同编辑。

## 使用

从包含此插件的市场安装并启用 **Markdown 编辑器**。宿主 PATH 需要 Node.js 24+，ZCode 需要支持 MCP Apps、`ui.surfaces` 及 `ui://markdown/panel.html` 资源。不具备这些能力的客户端无法显示编辑器；仅安装 MCP 服务不会自动增加面板。

在会话的插件入口打开 **Markdown 编辑器**，或告诉 Agent：

> 在 Markdown 编辑器中打开 `docs/notes.md`。

面板操作：

- **打开文件**：搜索工作区文件和最近文档。可以新建文件，或导入 `.md` / `.markdown` 文件；导入会将内容复制到工作区的新文件中。
- 默认即时渲染，也可切换源码模式。**格式**展开或收起常驻工具栏；选中文本后，选区旁出现格式操作和**添加到对话**。
- 通过大纲跳转标题。布局适配窄侧栏，并跟随宿主明暗主题。中英文界面文案跟随宿主语言。
- 编辑自动保存。外部变更会刷新无未保存修改的编辑器；存在草稿时保留草稿，并让用户选择重新加载或覆盖文件。切换文件会等待未完成的保存。
- 公式、Mermaid 图表、代码高亮、图标和编辑器样式均使用随包资源。

## Agent 工具

路径应相对于当前工作区。仅支持 `.md` 和 `.markdown`。

| 工具 | 用途 |
| --- | --- |
| `open_document` | 打开现有文件，返回当前修订号与内容。 |
| `new_document` | 新建并打开文件；已有文件不会被静默替换。 |
| `list_documents` | 查找工作区 Markdown 文件，可按路径过滤。 |
| `read_document` | 读取内容，无需打开面板。 |
| `write_document` | 替换全文。传入 `open_document` 返回的 `expectedRevision` 可保护较新的修改；省略该值意味着明确覆盖当前版本。 |
| `patch_document` | 按字面文本查找替换，`all: true` 替换全部匹配。支持 `expectedRevision`；无匹配时不写入。 |

`commit_draft`、`resolve_conflict`、`get_status`、`close_document` 仅面向页面，用于保存、冲突处理、恢复和清理文件监听。

例如先调用 `open_document({"path":"docs/notes.md"})`，再调用 `patch_document`，传入同一路径、返回的修订号作为 `expectedRevision`，以及 `ops: [{"find":"草稿","replace":"完成"}]`。发生冲突后应重新读取，不应盲目重试过期覆盖操作。

## 权限、数据和限制

- 清单在项目目录启动一个本地 Node.js MCP 服务，使用 stdio 通信。不安装 hooks，不执行文档内的 shell 命令，不启动运行时 HTTP 服务。可选的开发预览会启动仅监听回环地址的 HTTP 测试服务。
- 打开、列出、读取文件会向 ZCode 提供请求的 Markdown 内容或路径；模型可见的工具调用也会将这些内容提供给当前对话和模型。**添加到对话**向宿主上下文提供选中文本（最多 12,288 个字符）及文档元数据，本身不发送聊天消息。
- 保存、Agent 写入和导入会修改工作区文件。新建文件可能创建父目录。写入使用临时文件及 rename/link；仅明确的写入或保存操作会替换已有文件。路径和符号链接目标会经过工作区范围检查，拒绝覆盖符号链接。
- 最近文档以相对路径和时间戳存入 `ZCODE_PLUGIN_DATA`，按工作区哈希隔离。未提供该变量时使用操作系统临时目录。打开的文件使用文件系统监听，并有轮询回退机制。
- 编辑器资源随包提供；插件没有分析埋点、云账号、API 密钥或模型依赖。安装依赖需要访问公共 npm registry。文档中的远程链接、图片受宿主网络与内容安全策略约束；此插件不构成网络隔离边界。
- 服务端读写上限为 8 MiB UTF-8 内容，面板导入上限为 5 MiB。文件发现最多遍历 4 层、返回 500 个结果，跳过隐藏、依赖和构建目录。不支持二进制文件及图片上传。
- 修订号检查和串行保存用于防止同一服务中的过期写入，并非与其他进程共享的操作系统事务：最终检查与 rename 之间仍可能遭遇外部修改竞态。大文件编辑性能取决于宿主和文档结构。

## 源码构建与检查

需要 Node.js 24+、pnpm 10.33.2、Python 3.10+。在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm typecheck
pnpm lint
pnpm --filter @zcode/plugin-markdown test:e2e
pnpm --filter @zcode/plugin-markdown test:perf
python3 -m unittest discover -s tests
python3 scripts/validate.py
python3 scripts/build_dist.py
git diff --check
```

浏览器测试需要 Google Chrome。性能探针还使用 `ps`，适用于 macOS/Linux。浏览器测试使用模拟宿主桥和真实 MCP 服务，不能替代安装后在 ZCode 中的验证。

`pnpm build` 将 `ui-plugins/markdown/` 编译到本插件生成的 `dist/`，并创建 `dist/local-marketplace/`。在**设置 → 插件管理 → 发现 → +**中添加该本地市场，再安装并启用 Markdown 编辑器。生成文件不提交到 Git。分发打包会拒绝缺少或版本不符的构建标记；**Python 分发打包前必须先执行 pnpm 构建**，发布自动化也需要遵循这一顺序。

手动检查：打开或新建 Markdown、输入并检查磁盘保存、展开收起工具栏、选区格式操作、添加选区到对话、切换文件、从外部修改文件，以及窄屏和明暗主题布局。截图请使用示例文本。

## 许可证与来源

插件源码遵循仓库 Apache-2.0 许可证。编辑器使用 [Vditor](https://github.com/Vanessa219/vditor) 3.11.1，与 Typora 无隶属关系。MCP 集成使用公开的 Model Context Protocol SDK 和 MCP Apps SDK。各组件许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。构建会在 `dist/licenses/` 保留依赖的完整许可证，包括 Vditor 随带渲染资源的声明。无需第三方服务账号。
