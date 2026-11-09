---
name: excalidraw
description: 生成与编辑 Excalidraw 架构图、流程图、关系图，在 ZCode 侧栏与用户共同修改画布。
---

# Excalidraw 画板

用户要画图、使用 Excalidraw 或引用画板选区时使用本插件工具。生成的是可编辑元素，不是截图。

1. 新图调用 create_diagram(title, elements)。元素使用稳定的短 id；形状支持 rectangle/ellipse/diamond、x/y/width/height、backgroundColor、strokeColor。容器文字使用 label: {text}，会生成 `<id>-label` 的绑定文本。箭头用 type: arrow、points: [[0,0],[dx,dy]]，并提供匹配的 width/height。
2. 修改前 read_scene(id, elementIds?)，拿到当前 revision、元素 ID、绑定文字与箭头。面板打开、切换或改名时会提供 `kind: active-diagram` 的上下文，含 documentId、title、revision；“当前画板”以本轮最新上下文的 documentId 为准，不从名称或旧工具结果猜测。关闭最后一个标签后 documentId 为 null，表示没有当前画板；关闭标签不删除文档。用户的选区引用另含 elementIds；引用可能过期，仍然先读。一次编辑固定该文档 ID，不因后续切换标签改写另一张画板；没有明确目标时先确认。
3. apply_operations(id, expectedRevision, operationId, operations)：使用 add / update / delete，按元素 ID 局部修改。文字修改作用于 text 元素；不要用全量重建覆盖用户布局。位置调整保留未选中元素。
4. revision_conflict 时重新读取后重新规划；重试同一已发送操作时保留 operationId 和全部参数，避免重复提交。不要把已有文档 revision 当作元素 version。
5. 工具修改和手工修改使用画板内同一套撤销/重做。一次 apply_operations 应包含一个完整的编辑动作；不要为每个字段拆成独立提交。撤销产生新 revision，后续仍需重新读取。
6. export_diagram 输出工作区 .excalidraw 文件；PNG/SVG 在侧栏导出。已有文件需要明确 overwrite:true。open_diagram 可打开 document id 或导入工作区文件。

排版：先按含义分组，保持一致节点尺寸、留足箭头和中文文字空间，限制每张图的层级密度。颜色表达分组，不作为唯一信息载体。读代码画架构时只画已有证据支持的关系。

首版桌面本地可交互，其他端显示工具结果。图形数据保存在工作区隔离的插件数据目录，导入源不会自动被覆盖。不要要求用户通过浏览器打开外部 Excalidraw 网站才能继续编辑。
