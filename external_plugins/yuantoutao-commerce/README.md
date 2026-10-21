# Yuantoutao Commerce (yuantoutao-commerce)

[简体中文](./README_CN.md)

A ZCode plugin that connects your agent to the **Yuantoutao Commerce MCP** — one remote MCP server that gives the agent real e-commerce ability: product search, coupon-aware price comparison, affiliate buy links and order fulfillment across **Taobao/Tmall, JD and Pinduoduo** (2M+ curated SKUs).

This plugin only registers a remote HTTP MCP server. It contains no commands, skills, agents, or hooks.

## What the agent can do

- **Conversational shopping** — natural-language product search with budget and preference ("gift under ¥500", "cheapest, must be genuine")
- **Explainable ranking** — every item ships a score plus per-factor reasons (price vs category average, shop tier, sales, coupon) that can be quoted directly
- **Coupon-aware comparison** — side-by-side matrix for 2–6 items with final-after-coupon prices
- **Affiliate buy links & fulfillment** — attributed buy links, idempotent orders, waybill tracking (requires a free developer key)
- Keyless read-only tier works out of the box: search/compare/buy-links need no signup

The server namespace is `plugin:yuantoutao-commerce:yuantoutao`; tools are discovered dynamically (e.g. `cps_smart_search`, `cps_compare`, `cps_jd_goods_search`, `cps_pdd_goods_search`, `search_goods`, `create_order`, `get_logistics`). Agents should follow the tool schemas returned in-session instead of guessing names.

## Usage

1. Install and enable **源头淘电商 / Yuantoutao Commerce** in the ZCode plugin manager.
2. Ask a natural-language shopping question, for example:

> 帮我在淘宝找 300 元以内的保温杯，按券后价比一比，给我买链接。

3. Optional: create a free developer key at [yuantoutao.com/console](https://yuantoutao.com/console/) to unlock live fan-out to Taobao/JD/Pinduoduo, orders and a 3% commission share on attributed purchases. Free keys never expire.

Full tool documentation: [llms.txt](https://yuantoutao.com/llms.txt) · upstream plugin source (MIT): [MeshTok/dsh-plugin-yuantoutao](https://github.com/MeshTok/dsh-plugin-yuantoutao)

## Network access and side effects

- **Network**: the plugin talks to the remote MCP endpoint `https://mcp.yuantoutao.com/mcp` (HTTP, Streamable HTTP transport). The service, in turn, queries Taobao/Tmall, JD and Pinduoduo open-platform APIs server-side.
- **Writes**: read-only tools work keylessly. Order-creation tools only work after a developer key is configured by the user on the service side; the plugin itself performs no local file writes, command execution, or hooks.
- **Credentials**: none are required or stored by this plugin. If the user chooses to use a developer key, it is configured in the Yuantoutao console, not in this repository.
- **Third-party content**: product data, prices and coupon info are provided by the Yuantoutao service (third-party, not affiliated with Z.ai). The upstream plugin code is MIT-licensed; product data remains subject to the respective platforms' terms.

## License

The upstream plugin source is [MIT](https://github.com/MeshTok/dsh-plugin-yuantoutao). This marketplace wrapper is provided as-is.
