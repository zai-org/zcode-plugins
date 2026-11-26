# 表格数据校验

在导入系统、提交或发出表格之前先把错误数据揪出来：漏填、编号重复、手机号和邮箱写错、2025-13-01 这样不存在的日期、数字超出范围、不在可选值里、格式不对。规则用一行一句的大白话写，比如“工号: required, unique”——打开时会根据数据自动生成一份初始规则——然后直接在表格里改正标出的单元格，导出标注好的 Excel 和问题清单。在本地运行，无需 API 密钥。

## 功能

- **大白话规则**：required（必填）、unique（不重复）、email、phone（中国手机号或 +国际号码）、date（真实存在的日期）、integer、number 最小..最大、in(A|B|C)、length<=N、regex(…)、after/before 某日期。
- **自动建议规则**：编号类列建议不重复，邮箱/手机/日期/数字列建议相应检查，只有几个重复取值的列建议可选值列表。
- **原地改正**：在表格里改单元格，校验立即重跑；每行显示自己的问题。
- **输出清楚**：checked.xlsx 把不合格单元格标红并在批注里写原因，附问题工作表；errors.csv；合格行和不合格行分别导出 CSV。
- **规则写错也会提示**：未知规则、不存在的列都会报出来。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `sheet-validator/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “导入人事系统前帮我检查一下 员工花名册.csv”
- “工号不能重复，月薪要在 3000 到 100000 之间”
- “只导出合格的行”

## 工具

| 工具 | 作用 |
|---|---|
| `validate_open` | 读取表格、建议校验规则并列出所有不合格的单元格，并打开面板 |
| `validate_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `validate_status` | 查看当前数据、问题和汇总 |
| `validate_export` | 导出 checked.xlsx（问题单元格标红并加批注，附问题工作表）、errors.csv、valid-rows.csv 和 invalid-rows.csv |

导出文件写到工作区的 `sheet-validator/<项目>/` 文件夹。

## 范围（v0.1）

- 一次一张表；v0.1 不做跨表检查（例如编码必须在另一个文件里存在）。
- 每个单元格只显示第一条不通过的规则。
- 不会自动修正——批量规范化请用“表格数据清洗”插件。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `sheet-validator/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/sheet-validator/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-sheet-validator test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：ExcelJS (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
