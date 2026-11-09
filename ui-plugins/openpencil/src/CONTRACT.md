# OpenPencil 设计稿登记表与插件端口

DesignRegistry（插件 MCP server 进程内）是工作区 `.fig` / `.pen` 文档的唯一登记 owner：path ↔ id ↔ revision ↔ owner(file|live)。面板未连接时磁盘文件是权威（file），面板 `report_panel_state live:true` 后浏览器里的活文档是权威（live）；每次成功写盘或检测到外部修改 revision +1，外部修改只标记 `externalChange`，不覆盖。

面板保存必须带 expectedRevision，冲突不覆盖、草稿留在面板，只有 `resolve_conflict keep-mine / reload` 才改写。面板不直接读写文件，文件与导出只走同插件 MCP（`save_design` / `export_design`）；设计稿字节经 `design/{id}/meta|chunk-N` 资源分片读取，单片 ≤ DESIGN_CHUNK_BYTES 以满足宿主 8 MiB 上限。`.pen` 只读。控制面复用上游 WebSocket 桥（`BRIDGE_COMMANDS`），页面通过官方 MCP Apps App 接入宿主，桌面 continuous 与手机 replayable 不变。

工具展示与执行解耦：只有 open_design / new_design 声明 UI 资源与 fullscreen surface，其余查询、修改、导出、转换及 app-only 工具保留可见性并复用原桥。面板未打开时由打开文档工具或 launcher 显式打开；无头读取不打开面板。

面板冷启动先加载初始文档，再连接自动化桥；连接就绪不能先于初始文档就绪，避免首个编辑命令读到空 current。

完整 Web UI 复用上游 EditorView，每个文档标签持有独立 editor / controller。工具桥按请求开始时的 `document_id` 固定目标并串行执行。打开同一文件复用已有标签，切换活动标签通知登记表；关闭前保存成功才释放 owner。`new_design open:false` 只创建目标文件，供另存为绑定已有画布，不能推送空文档替换草稿。`write_export` 是 app-only 字节导出入口，受工作区路径和格式约束，禁止覆盖已有文件。

构建分发：本插件的 package.json 声明 build 与 stage。根脚本只调度和校验；stage 按 ZCODE_PLUGIN_INSTALL_DIR 复制本插件额外运行资源，并在完成标记写入前结束。安装目录布局与运行时接口保持不变。

插件身份：目录和清单使用 `openpencil`，对应 MCP 页面资源使用 `ui://openpencil/` 命名空间；客户端、服务端与集成测试保持一致。
