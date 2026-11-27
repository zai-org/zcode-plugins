# PDF 表单汇总

把一批填好的 PDF 表单汇总成一张表：文本框、复选框、单选、下拉框和签名字段都变成列，列名用表单上的提示文字。必填项没填、同意框没勾、邮箱或手机号格式不对、重复提交、不能填写的 PDF（扫描件或已压平）都会标出来。在表格里修正后，导出带颜色和批注的 Excel 或 CSV。在本地运行，不上传，无需 API 密钥。

## 功能

- **支持所有字段**：文本（含多行）、复选框、单选组、下拉框、列表框和签名字段（是否已签）。
- **列名好读**：用字段的提示文字作列名，按表单顺序排列；不同版本的表单会合并。
- **检查**：必填项（表单自带的必填标记加上你指定的字段）、必勾的复选框、邮箱、手机号、日期、下拉框选项之外的值。
- **重复提交**：两份表单邮箱相同（或你指定的字段相同）会提示，方便去掉旧的那份。
- **问题 PDF**：空白模板、扫描件或已压平的表单、损坏的文件会单独列出，不会悄悄跳过。
- **导出**：Excel 中缺失值标黄、格式错误标红并附批注，另有字段填写率工作表；CSV 列与之相同。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `pdf-form-collector/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “把收回来的表单汇总到 Excel”
- “哪些表单必填项没填？”
- “有没有人重复提交？”

## 工具

| 工具 | 作用 |
|---|---|
| `formcollect_open` | 读取每个 PDF 的表单字段，每份表单一行，并打开面板 |
| `formcollect_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `formcollect_status` | 查看当前数据、问题和汇总 |
| `formcollect_export` | 导出 responses.xlsx（问题单元格标色）和 responses.csv |

导出文件写到工作区的 `pdf-form-collector/<项目>/` 文件夹。

## 范围（v0.1）

- 读取可填写的（AcroForm）PDF；纸质扫描件需要先 OCR。
- 不支持纯 XFA 表单（部分政府模板）。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `pdf-form-collector/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/pdf-form-collector/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-pdf-form-collector test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：pdf-lib (MIT), ExcelJS (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
