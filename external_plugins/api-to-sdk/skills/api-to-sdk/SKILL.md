---
name: api-to-sdk
description: 把 OpenAPI 3 规范（YAML/JSON）生成带类型的 TypeScript SDK 包（fetch 客户端、类型、错误处理、认证、README、示例、模拟服务器），并自动验证：严格模式编译 + 对模拟服务器调用每个接口。用户提到“OpenAPI / Swagger / 接口文档生成 SDK / 生成客户端 / API client”时使用。
---

# 接口转 SDK

1. 找到规范文件（openapi.yaml / openapi.json）。如果是 Swagger 2.0，先告诉用户需要转换成 OpenAPI 3（可以用 swagger2openapi）。
2. 先用 `sdk_inspect({spec})` 查看：接口数量、认证方式、警告（外部 $ref、缺少 operationId 等）。把重要的警告告诉用户。
3. 用 `sdk_generate({spec, out?, packageName?, className?})` 生成 SDK。它会自动编译，并对模拟服务器调用每个接口。
4. 报告结果：编译是否通过、通过了几个接口；有失败的，说明是哪个接口、什么问题（通常是规范自身前后矛盾，例如示例与数据结构不符）。
5. 告诉用户怎么用：`import { <Class> } from "<包名>"`（或 `npm install ./sdk/<api>`），`new <Class>({ token })`；开发时可以用 `node sdk/<api>/mock/server.mjs` 启动模拟服务器。
6. 规范或生成的代码改了以后，用 `sdk_test({out})` 重新验证。
