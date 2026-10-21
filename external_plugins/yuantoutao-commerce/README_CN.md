# 源头淘电商（yuantoutao-commerce）

[English](./README.md)

把你的 Agent 接入**源头淘电商 MCP**——一个远程 MCP 服务，让 AI 具备真实的电商能力：商品搜索、券后比价、带归因购买链接与订单履约，覆盖**淘宝/天猫、京东、拼多多**（200 万+ 精选商品）。

本插件只注册一个远程 HTTP MCP 服务，不包含命令、技能、Agent 或 Hook。

## 能做什么

- **对话购物** — 自然语言搜商品，支持预算与偏好（"500 元以内送女友的礼物"、"最便宜的正品"）
- **可解释排序** — 每个商品带评分与逐项理由（价格 vs 品类均价、店铺层级、销量、优惠券），可直接引用
- **券后比价** — 2–6 个商品并排对比矩阵，统一按券后价
- **带归因购买链接与履约** — 归因购买链接、幂等下单、物流跟踪（需免费开发者 key）
- **免注册即用** — 只读能力（搜索/比价/购买链接）无需任何 key

服务的命名空间为 `plugin:yuantoutao-commerce:yuantoutao`；工具动态发现（如 `cps_smart_search`、`cps_compare`、`cps_jd_goods_search`、`cps_pdd_goods_search`、`search_goods`、`create_order`、`get_logistics`）。请以会话内返回的工具 schema 为准，不要猜测工具名。

## 使用方式

1. 在 ZCode 插件管理器中安装并启用**源头淘电商 / Yuantoutao Commerce**。
2. 直接用自然语言提问，例如：

> 帮我在淘宝找 300 元以内的保温杯，按券后价比一比，给我买链接。

3. 可选：在[源头淘开发者控制台](https://yuantoutao.com/console/)免费领取开发者 key，解锁淘宝/京东/拼多多实时扇出、下单与成交额 3% 开发者分成。免费 key 永不过期。

完整工具文档：[llms.txt](https://yuantoutao.com/llms.txt) · 上游插件源码（MIT）：[MeshTok/dsh-plugin-yuantoutao](https://github.com/MeshTok/dsh-plugin-yuantoutao)

## 网络访问与副作用说明

- **网络**：插件连接远程 MCP 端点 `https://mcp.yuantoutao.com/mcp`（HTTP，Streamable HTTP 传输）。该服务在服务端查询淘宝/天猫、京东、拼多多开放平台接口。
- **写入**：只读工具免 key 可用。下单类工具需用户在服务侧配置开发者 key 后才可用；插件本身不做本地文件写入、命令执行，也没有 Hook。
- **凭据**：本插件不需要也不存储任何凭据。如用户选择使用开发者 key，请在源头淘控制台配置，不要提交到本仓库。
- **第三方内容**：商品数据、价格与券信息由源头淘服务提供（第三方服务，与 Z.ai 无关）。上游插件代码为 MIT 许可；商品数据遵循各平台相应条款。

## 许可证

上游插件源码为 [MIT](https://github.com/MeshTok/dsh-plugin-yuantoutao)。本市场封装按"现状"提供。
