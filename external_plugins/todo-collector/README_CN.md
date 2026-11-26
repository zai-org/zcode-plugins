# 代码待办汇总

把代码里所有的 TODO、FIXME、HACK、BUG 注释汇总成一张清单：从 TODO(名字) 读出负责人，从 !!! 或“紧急”判断优先级；在 git 仓库里还能看到每条是谁、什么时候写的，放了很久被遗忘的一眼就能看出来。在表格里设好优先级和负责人，再导出可以导入任务系统的 CSV，或者按优先级、负责人、文件分组的 TODO.md 清单。在本地运行，不需要任务系统账号或 API 密钥。

## 功能

- **只看注释**：支持 50 多种语言的 //、#、/* */、--、<!-- --> 和 ; 注释；字符串里的标记和 Markdown 任务列表会被忽略，多行注释会合并。
- **负责人与紧急程度**：TODO(名字) 或 @名字 作为负责人；FIXME/BUG 以及 !!!、urgent、紧急 为高优先级，HACK/XXX 为低。
- **从 git 看时长**：装有 git 时，用 git blame 读出每行的作者和日期，超过设定天数的会被标出。
- **自定义标记**：可以收集任何标记，比如 NOTE、OPTIMIZE、待办，不区分大小写。
- **拿来就能用**：适合表格软件和任务系统导入的 UTF-8 CSV，以及带 文件:行号 链接、按优先级/负责人/文件分组的 TODO.md 清单。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `todo-collector/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “汇总 shop-app 里的 TODO”
- “按负责人分组，购物车相关的分给 chen”
- “把 NOTE 注释也收进来”

## 工具

| 工具 | 作用 |
|---|---|
| `todos_open` | 扫描文件夹里源代码的 TODO 类注释，并打开面板 |
| `todos_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `todos_status` | 查看当前数据、问题和汇总 |
| `todos_export` | 导出 todos.csv 和 TODO.md |

导出文件写到工作区的 `todo-collector/<项目>/` 文件夹。

## 范围（v0.1）

- 只读：不会修改代码里的注释。
- 作者和日期需要 git 和 git 仓库，否则这两列为空。
- 不会直接在 GitHub/Jira 建任务——请把 CSV 导入进去。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `todo-collector/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/todo-collector/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-todo-collector test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
