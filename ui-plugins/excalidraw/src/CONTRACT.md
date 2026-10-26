# Excalidraw 文档与插件端口

DocumentStore 是唯一已提交文档 owner。create/read/list/commit/apply 使用 workspace 隔离的数据目录；commit 和 apply 原子提交 revision、内容、幂等记录。commit 的可选 title 与画布内容一起确认，未传时保留原名；重命名不重置画布历史。调用方仅持引用或未 ACK 草稿。SQLite 的同步 API 只在独立 worker 执行，主循环端口始终异步。

UI 与 Agent 都必须带 expectedRevision。冲突不覆盖；重复 operationId 不重复提交。UI 不直接读文件，文件操作只走同插件 MCP。导出不是第二个同步 owner。页面通过官方 MCP Apps App 接入宿主，桌面 continuous 与手机 replayable 不变。

手动编辑和工具修改进入当前编辑器同一 undo/redo 历史；撤销结果沿 commit_scene 正常保存。首次打开和切换文档初始化历史，同一文档的新版本保留历史及视角。历史不跨实例持久化；旧数据库启动时移除独立 AI 恢复字段，保留文档和版本。

指向文档的成功工具结果（包括导出）携带 document 引用，冷启动由 UI 沿 editor.open 读取最新已提交版本。旧导出历史通过匹配 path/revision 的输入恢复文档引用；失败或不匹配输入不能触发恢复。widgetState 只承载内存中的选择，不作为文档持久化 owner，不修改宿主协议或历史消息。

插件身份：目录和清单使用 `excalidraw`，对应 MCP 页面资源使用 `ui://excalidraw/` 命名空间；客户端、服务端与集成测试保持一致。

空场景（包括仅有已删除元素）初始化为 100%，不执行 fit-to-content。最近访问的八个 document ID 与当前选择保存在 widgetState，标签名称来自已提交文档。打开、切换、改名成功后按序发送 updateModelContext，携带 active-diagram 的 documentId/title/revision；不把 widgetState 视为模型可见状态。切换替换旧引用，手动引用可附加选区；已发送请求的目标不随 UI 切换变化。

关闭标签只移除 UI 的 document ID，不调用存储删除。关闭当前标签先 flush，失败则保留草稿和标签；成功后切到相邻标签，最后一个关闭时清空编辑器选择和画布。widgetState 的 documentId:null 表示显式关闭全部标签，与缺少 documentId 区分；恢复时忽略同一旧工具引用，新工具结果仍可打开文档。关闭最后一个标签还发送 active-diagram/documentId:null，避免模型继续使用旧目标。
