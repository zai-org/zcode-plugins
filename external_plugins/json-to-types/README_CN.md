# JSON 生成类型定义

不用复制粘贴就能生成类型：选一份示例 JSON——接口返回、配置文件、JSONL 日志——生成 TypeScript 接口、Zod 校验、JSON Schema、Python dataclass 和 Go 结构体。多个样本会合并推断，有时缺失的字段标为可选，出现 null 的标为可空；能识别日期、邮箱和网址；嵌套对象会起好名字。导出前可在表格里调整字段并写说明。在本地运行，无需 API 密钥。

## 功能

- **五种输出**：TypeScript 接口、Zod 校验（按依赖顺序，附 z.infer 类型）、带 $defs 的 JSON Schema 2020-12、Python dataclass、带 json 标签的 Go 结构体。
- **从多个样本学习**：合并所有文件和数组里的每个元素——可选字段、可空字段、整数与小数、混合类型生成联合类型。
- **格式识别**：date-time、date、email、url、uuid 字符串（Zod 用 .datetime()/.email()，JSON Schema 写 format，Go 用 time.Time）。
- **命名合理**：嵌套对象生成命名类型（customer → Customer，items → Item）；特殊键名会加引号或转换（Python 的 id → id_ 并注释原名）。
- **可以手动调整**：把字段标为可选/可空并写说明，说明会变成文档注释和 schema 描述。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `json-to-types/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “根据 orders-api.json 里的 data.orders 生成 TypeScript 类型”
- “再给我 Zod 校验和 Go 结构体”
- “note 设为可选，说明写“发票备注””

## 工具

| 工具 | 作用 |
|---|---|
| `jsontypes_open` | 从 JSON 样本推断类型并列出所有字段，并打开面板 |
| `jsontypes_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `jsontypes_status` | 查看当前数据、问题和汇总 |
| `jsontypes_export` | 导出 types.ts、schema.zod.ts、schema.json、models.py 和 models.go |

导出文件写到工作区的 `json-to-types/<项目>/` 文件夹。

## 范围（v0.1）

- 类型取决于样本——样本里没有的字段生成不出来。
- v0.1 不生成枚举和字符串字面量联合；递归结构按层级分别生成类型。
- 最多 20 个样本文件。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `json-to-types/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/json-to-types/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-json-to-types test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
