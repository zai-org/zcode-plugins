---
name: json-to-types
description: 不用复制粘贴就能生成类型：选一份示例 JSON——接口返回、配置文件、JSONL 日志——生成 TypeScript 接口、Zod 校验、JSON Schema、Python dataclass 和 Go 结构体。多个样本会合并推断，有时缺失的字段标为可选，出现 null 的标为可空；能识别日期、邮箱和网址；嵌套对象会起好名字。导出前可在表格里调整字段并写说明。在本地运行，无需 API 密钥。 用户提到“JSON 生成类型 / JSON 转 TypeScript / 生成 Zod / JSON Schema / Go 结构体 / Python 数据类”时使用。
---

# JSON 生成类型定义

1. `jsontypes_open(inputs, settings?, project?)`：从 JSON 样本推断类型并列出所有字段。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - 只要某一段：settings.path（如 "data.orders"）；根类型名：settings.rootName。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `jsontypes_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - `set: [{row, values: {optional: true, nullable: false, description: "…"}}]`；预览语言：settings.show（ts/zod/schema/python/go）。
4. `jsontypes_export(project, formats?)`：导出 types.ts、schema.zod.ts、schema.json、models.py 和 models.go。把文件路径告诉用户。
5. 提醒用户：样本里一直为 null 的字段类型未知，最好补一个有值的样本。
