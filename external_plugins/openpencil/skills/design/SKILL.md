---
name: design
description: 用 OpenPencil 设计稿工具打开、修改、导出工作区里的 Figma .fig 设计稿，并根据设计稿写代码。当用户提到设计稿、Figma、.fig、.pen、画布、选中的元素、按稿写码时使用。
---

# 设计稿（OpenPencil）

设计稿是工作区里的 `.fig` 文件（Figma 桌面端 “Save local copy” 的格式），由侧栏“设计稿”面板里的 OpenPencil 编辑器打开。
**面板打开时，面板里的活文档是唯一权威：所有修改必须经设计工具执行，禁止用 Read/Write/Edit 直接碰 .fig（二进制，且会被面板覆盖）。**

## 工作流

1. **先定位文档**：`list_designs` 看工作区有哪些 `.fig` / `.pen`；`open_design { path }` 打开（面板会自动出现），新稿用 `new_design { path }`（放在 `designs/` 下）。`.pen` 只读，改之前先 `convert_pen_to_fig`。
2. **读结构再改**：`get_page_tree` / `find_nodes` / `get_node` / `node_tree` 拿到节点 id；用户说“这个 / 选中的”时先 `get_selection`。对话里若带有 “Design selection …” 的插件上下文，其中的 `selection[].id` 就是目标节点，直接用，不要重新猜。
3. **修改**：`update_node`（位置/尺寸/文本/圆角）、`set_fill` / `set_stroke` / `set_effects`、`set_layout`（自动布局）、`create_shape` / `create_vector` / `render`（JSX 一次建整棵树）、`reparent_node` / `group_nodes` / `clone_node` / `delete_node`、组件与变量类工具。改动会即时出现在面板并自动保存，不需要再调保存工具。
4. **视觉校验**：`export_design { format: "png", nodeIds? }` 把渲染图写进 `exports/`，再用读图工具看效果（颜色、对齐、间距）。
5. **按稿写码**：`list_variables` / `list_collections` 拿设计 token，`export_design { format: "jsx", path }` 得到 JSX + Tailwind 起点，再适配到项目自己的技术栈与组件库；结构复杂时逐个顶层 frame 导出。
6. **面板未打开**：只有 `open_design { path }` / `new_design { path }` 会自动打开面板。查询、修改、导出复用已打开面板，不会自行打开；面板就绪最多等待 30 s。若工具返回“面板未连接”，先显式打开目标文档或提示用户从侧栏“打开标签页 → 设计稿”进入，不要反复重试原工具。只想列出文件或“看懂稿子”可用 `list_designs` / `describe_design { path }`，无需面板。

## 约束

- 面板支持多个文档标签。所有工具默认作用于当前标签；对话上下文带 `document_id` 时传入该 id，目标必须是已打开的文档。用户切换标签不会改变显式目标。
- 修改前保留用户手工布局：只改被要求的属性，不重排其它节点。
- 大幅生成（整页）优先用 `render` 传 JSX 树，少量修改用具体工具；不要用 `eval`（默认未开启）。
- 用户的右键操作会以“来自插件”的消息或上下文块出现，内容包含 `document`、`page`、`selection`，以它为准。
