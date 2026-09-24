# AIFeed —— 面向 AI 智能体的签名内容许可

[AIFeed](https://aifeed.md) 是一个面向 AI 网络的签名内容许可开放标准（代码 MIT，规范 CC BY 4.0）。
站点在 `/.well-known/ai.json` 发布使用 Ed25519 签名的 manifest，公钥锚定在 DNS
`_aifeed` TXT 记录中，并支持撤销。智能体先验证这条链路，而不是去信任一个未签名、不可撤销的文本文件。

本插件把该流程带入 ZCode：

- **MCP 服务器**（`aifeed`，stdio，随包内置在 `engine/`），提供六个工具：
  - `verify_manifest` —— 签名 + DNS 锚点 + VERIFIED/UNVERIFIED
  - `fetch_aifeed` —— 按 token 预算获取 AIFeed Markdown/MAKO，附带许可信息与可选的页面签名校验
  - `list_assets` —— 列出签名页面声明的图片、视频与文档
  - `verify_asset` —— 下载声明的资源并校验大小/sha-256
  - `select_index` —— 在页面/token 预算内对签名增量索引条目排序
  - `decide_usage` —— 判断某项用途（检索、训练、引用等）是否被允许
- **技能**（`aifeed`）—— 先验证的工作流与发布流程，让智能体在抓取前检查许可，绝不默认放行。

## 网络、依赖与副作用

- 引擎**零依赖**（仅使用 Node 标准库），直接从插件目录运行；无需 npm 安装，也不会在运行时下载。
- 网络：向你询问的域名发起 HTTPS 请求（manifest、内容、资源、DNS TXT 查询）。无遥测，不会向插件作者发送任何数据。
- 写入：无。插件不会写入你的项目、主目录或 ZCode 数据。
- 仅当 `allow_private` 选项设为 `1` 时，才允许 `http://` 回环源（仅用于本地测试）。

## 要求

Node.js 20 或更高版本（`node` 在 `PATH` 中）。引擎默认只抓取 `https://` 源。

## 链接

- 官网与可直接验证的签名演示源站：https://aifeed.md
- 源码、规范、一致性向量：https://github.com/denyn1/aifeed-protocol
- npm 包：`aifeed`（CLI）、`@aifeed/verify`（SDK）、`aifeed-mcp-server`、`@aifeed/frameworks`

诚实的限制：规范仍为草案，尚无外部密码学审计；源站 + DNS 同时被攻陷时，首次接触无法识别。

MIT。
