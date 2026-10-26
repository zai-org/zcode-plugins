# Zotero owner 与端口

插件 MCP server（Node）是 Zotero 本地 API（`http://127.0.0.1:23119/api/`）的唯一客户端：读取文库、解析 PDF 文本、持有面板视图与 Agent 高亮、经用户授权写入。页面和模型都只经它读写；页面不直连 Zotero，不接触写入 key。

## 分层

- `zotero/client.ts`：`ZoteroClient` 是连接与授权的唯一 owner。探测状态（未运行 / 本地 API 未开启 / 就绪）；用不带 Server-ID 的空 `POST []` 判断是否支持写入（Zotero 8+ 回 428，Zotero 7 回“不支持该方法”，无副作用）。写入带 `Zotero-Server-ID` 与本地 API key；没有 key 时 `POST /api/local/authorize`（同样要带 Server-ID）弹出 Zotero 的“允许 / 始终允许 / 拒绝”。“始终允许”的 key 按 Server-ID 存在插件数据目录（0600）；一次性 key 首次校验即作废；401 时重新授权一次；并发写入共享同一个对话框。
- `zotero/library.ts`：只读访问，整理成 contract 结构。集合与全库注释按库版本缓存。单个对象的 `Last-Modified-Version` 是对象版本，不记作库版本。导出时去掉 BibTeX `file` 字段与 RIS `L1` 行（本机路径）。
- `zotero/writes.ts`：批量创建（≤ 50）、按版本 PATCH（412 时以新版本重试一次）、删除（仅测试用，未暴露为工具）、附件三步上传（授权 → 传字节 → 登记），上传失败时删除刚建的附件条目。
- `pdf/extract.ts`：pdf.js（legacy 构建，worker 在主线程）提取逐页文本项；`PdfStore` 按路径 + 修改时间 + 大小做 LRU 缓存。只读取 Zotero 为附件报告的 `file://` 路径。
- `domain/`：纯函数。`text.ts` 拼页面文本并保留到文本项的映射；引文匹配做 NFKC、引号 / 连字符统一、行尾断词合并、空白折叠，失败再忽略全部空白，支持“开头 … 结尾”与跨页；矩形按 Helvetica 字宽比例在文本项内插值，竖直范围取基线下 0.25、上 0.75 字号（与 Zotero 自己的高亮一致）；排序键 `页序|偏移|距页顶`。`items.ts` 是条目摘要与模型文本。
- `zotero/install.ts`：Zotero 桌面程序是否装在本机（macOS 的 `/Applications`、`~/Applications`；Windows 的 Program Files 与 LocalAppData；Linux 的常见解压位置、Flatpak 与 PATH）、版本（Info.plist 或 application.ini），以及启动它（macOS `open -a`，Flatpak `flatpak run`，其余直接运行，不等待）。
- `host/facts.ts`：本机事实：系统、架构、包管理器与版本，供设置页与交给 Agent 的消息使用。只读探测。
- `metadata/metadata.ts`：DOI（doi.org 内容协商 CSL-JSON）与 arXiv（Atom API）到 Zotero 条目；PDF 下载限 http(s)、100 MB、校验 `%PDF-`。
- `app/session.ts`：`ZoteroSession` 组合以上部分，持有设置页信息（本机事实、安装情况、`handoff`；Zotero 未运行时 `ready()` 区分“未安装”并报 `zotero_not_installed`）、面板视图（`viewSeq`）、Agent 高亮（只在会话内，保存后记 `savedAs`）、库版本轮询与变化事件、工作区路径检查（realpath，拒绝跳出工作区）。
- `adapters/`：MCP 工具、资源与订阅。

## 一致性

- 库 id：`user` 或 `g<groupId>`；条目 key 必须匹配 Zotero 的 8 位字符集（不含 0、1、O）。
- 面板订阅任一资源期间，每 2.5 秒用 `If-Modified-Since-Version` 检查各库版本（未变时 304）；变化时通知该库下所有已订阅资源（PDF 分块除外）与 `state.json`。Zotero 启动 / 退出也由此反映到状态。
- Agent 请面板显示的内容（`open_item` / `show_items` / `highlight`）写入 `state.view` 并递增 `viewSeq`；页面以 widget state 记住已处理的 `viewSeq` 与导航栈，重建后不重复跳转。
- 已保存到 Zotero 的 Agent 高亮由对应的 Zotero 注释显示，页面不重复绘制。

## 工具

| 工具 | 调用方 | 说明 |
| --- | --- | --- |
| `list_collections`、`search_library`、`get_item`、`search_annotations` | model, app | 只读 |
| `read_fulltext`、`find_in_pdf`、`cite` | model, app | 只读；页码为物理页（标签不同时一并给出） |
| `open_item`、`show_items` | model, app | 写入 `state.view`，打开侧栏 |
| `highlight`、`clear_highlights` | model, app | 会话内高亮；`highlight` 可 `save` |
| `save_highlights`、`add_item`、`attach_pdf`、`update_item`、`add_note`、`create_collection`、`authorize_writes` | model, app | 写入 Zotero（需要授权） |
| `export_bib` | model, app | 只写工作区 `.bib` |
| `panel_refresh` | app | 面板“重新检查”按钮 |
| `panel_launch_zotero` | app | 设置页与对话卡片的“打开 Zotero”（会运行程序，所以是工具调用） |

所有工具带 `_meta.ui = { resourceUri: PANEL_URI, surface: "zotero" }`。页面读取一律走资源（不触发审批），只在用户操作时调用 `save_highlights`、`clear_highlights` 与 `panel_refresh`。

## 资源

- `ui://zotero/panel.html`：单文件页面，声明 `zcode/csp.wasmUnsafeEval`（pdf.js 的 wasm 解码器）。
- `ui://zotero/state.json`：`SessionState`，可订阅。
- `ui://zotero/setup/{op}/{nonce}`：设置页操作，返回 `SessionState`。`check` 立即探测一次；`handoff` 记下已交给 Agent。
- `ui://zotero/lib/{library}/collections.json`、`items/{query}.json`（`query` 为 base64url JSON，URI 模板不匹配查询串）、`item/{key}.json`、`annotations/{key}.json`：可订阅。
- `ui://zotero/lib/{library}/pdf/{key}/info.json` 与 `pdf/{key}/{part}`：PDF 按 2 MiB 分块（宿主单次读取上限 8 MiB）。
- `ui://zotero/pdfjs/{kind}/{file}`：pdf.js 的 CMap、标准字体与 wasm。页面用自定义 `BinaryDataFactory` 读取，并关闭 `useSystemFonts`（否则 pdf.js 会按 URL 加载字体，被 CSP 拦截）。

## 设置页

缺少本机程序时，面板显示同一套设置页（三个插件共用 `ui/setup-kit.tsx` 与 `ui/setup-kit.css`，颜色经 `--su-*` 映射到各自的 token）：

- **要求清单**：每一项要求一行，状态为满足 / 缺少 / 等待上一步 / 正在检查 / 失败；未满足的行右侧总有一个词（不只靠颜色）。缺少时说明查找过的位置，页脚列出本机系统、架构与包管理器（`host/facts.ts`，只读探测）。
- **交给 Agent**：按检测到的事实生成一条消息（开头、灰色的事实、步骤、结尾），发送前完整可见；**发给 Agent** 用 `sendMessage` 以用户名义发到对话，**复制**同样的纯文本可交给任意 Agent。宿主不支持发消息时，复制是主要操作。
- **已交给 Agent**：发送后读取 `setup/handoff/{nonce}`，server 记下时间（`setup.handoffAt`）；所有页面（含对话卡片）据此显示“正在设置”，第一个未满足的要求显示为正在检查。要求满足或 30 分钟后清除。
- **自动前进**：面板订阅 `state.json` 期间 server 定时重新检查，满足后状态通知页面；“重新检查”读取 `setup/check/{nonce}` 立即检查。两者都是资源读取：宿主对页面发起的工具调用要求审批，读取资源不需要。

Zotero 的要求依次是：程序已安装且不低于 `MIN_ZOTERO`、已打开（本地 API 端口应答）、本地 API 已开启。未安装或版本过旧时交给 Agent；已安装但未打开时只给“打开 Zotero”；本地 API 未开启时给出 Zotero 设置中的确切位置（只有用户能勾选，所以不交给 Agent）。原有的 2.5 秒轮询同时检查安装情况。

## 页面

- 只用官方 MCP Apps SDK，一个 App、一次连接，处理器先于连接注册。数据全部来自资源，可随时重建。
- 文字层在注释层之上（便于选择文字），注释的点击按坐标命中；注释按钮仍可用键盘操作。
- 选择进入对话两种方式：`updateModelContext`（加入上下文，不发消息）与 `sendMessage`（连同用户的问题发送）。

## 安全

- 只连接本机地址；写入 key 不出现在工具结果、资源、日志或页面中。
- 工具不能删除条目。导入只访问 doi.org、export.arxiv.org 与给定的 PDF 链接。
- 笔记 HTML 在页面经 DOMPurify 清洗后显示。
