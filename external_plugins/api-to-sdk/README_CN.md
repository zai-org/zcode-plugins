# 接口转 SDK

把 **OpenAPI 3.0 / 3.1** 规范（YAML 或 JSON）生成**带完整类型的 TypeScript SDK 包**，并证明它能用：用 TypeScript 严格模式编译，再对照用规范搭建的模拟服务器，逐个调用每个接口。

## 功能

- **读取规范**：本地 `$ref`（数据结构、参数、请求体、响应）、路径级参数、`allOf` / `oneOf` / `anyOf`、`const`、枚举、3.0 的 `nullable` 和 3.1 的类型数组、`additionalProperties`、认证方案。会提示外部或失效的 `$ref`、未声明的路径参数、缺失或重复的 operationId，以及 OAuth 流程。
- **生成** `sdk/<api>/`：
  - `src/types.ts`：每个数据结构一个类型，说明文字转成 JSDoc。
  - `src/client.ts`：客户端类，每个接口一个方法（如 `api.getBike({ bikeId: 7 })`），参数和返回值都有类型。还支持：
    - 路径、查询（数组会重复参数）和请求头参数；JSON、multipart（`FormData`、`Blob`）、表单和原始请求体。
    - Bearer 令牌（字符串或函数）、API Key（请求头、查询参数或 Cookie）和 Basic 认证，按每个接口的 `security` 自动选择。
    - `timeoutMs`、`AbortSignal`、自定义 `fetch`、单次请求的请求头。
    - 失败时抛出 `ApiError`，带状态码和解析后的错误内容；错误内容的类型导出为 `<接口>ErrorBody`。
  - 没有运行时依赖，可用于 Node 20+、Deno、Bun 和浏览器。已预先构建好 `dist/`（JS + `.d.ts`），附 `package.json` 和 `tsconfig.json`。
  - `README.md`（含接口表）和 `examples/all-operations.ts`（用规范里的示例值调用每个接口；示例与数据结构不符时会提示）。
  - `mock/server.mjs`：没有依赖的模拟服务器。按规范里的示例（或根据数据结构生成的值）返回响应；对照规范检查请求，不符时返回 400 并说明原因；支持用 `Prefer: code=404` 返回文档里写的错误；允许跨域。
- **验证**：
  - TypeScript 严格模式编译。
  - 对模拟服务器逐个调用接口。检查方法、路径参数、查询参数、请求头、认证信息和 JSON 请求体是否和传入的一致，响应是否正确解析，文档里写的错误状态码是否抛出带解析内容的 `ApiError`。

## 使用

在 ZCode Desktop 里对助手说：

- “根据 openapi.yaml 生成 TypeScript SDK”
- “给这个接口文档生成客户端并测试”
- “规范改了，重新验证 SDK”

也可以用面板：选择规范文件，点 **读取接口**，按需填写输出目录、包名和类名，再点 **生成 SDK 并验证**。

## 工具

| 工具 | 作用 |
|---|---|
| `sdk_inspect` | 列出接口、数据结构、认证和规范问题（不写文件） |
| `sdk_generate` | 生成 SDK 包、编译，并对模拟服务器调用每个接口 |
| `sdk_test` | 重新编译并调用（例如手动改过生成的代码之后） |

## 范围（v0.1）

- 只生成 TypeScript；发布到 npm 由你自己完成（在目录里运行 `npm publish`）。
- OpenAPI 2（Swagger）需要先转换成 3。不跟随外部 `$ref` 文件。
- 不生成 OAuth2 / OpenID 登录流程，请用 `token` 传入访问令牌。不支持 Cookie 参数、`deepObject` 查询参数、XML 请求体和回调/Webhook。
- 模拟服务器用于开发和测试，不是完整的契约测试工具。它检查类型、必填、枚举、`const`、格式、范围和 `oneOf` / `anyOf` / `allOf`。

## 隐私、网络与文件

- 全部在本地运行，不联网，不需要 API Key。验证时只访问 127.0.0.1 上的模拟服务器，不会调用真实接口。
- 读取规范文件，写入 SDK 目录和 `.api-to-sdk/sdks.json`。

## 许可证

MIT。内置 [yaml](https://github.com/eemeli/yaml)（ISC）和用于编译的 [TypeScript](https://github.com/microsoft/TypeScript)（Apache-2.0）。
