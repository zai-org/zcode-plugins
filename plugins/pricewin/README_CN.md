# PriceWin

[English](./README.md)

在 ZCode 中实时比较 Booking.com、Agoda、Trip.com 和 Traveloka 上的酒店与机票价格，
统一以美元计价。本插件声明一个远程 HTTP MCP 服务 `https://mcp.price.win/mcp`，
以及一个 Skill `pricewin-travel-search`，用于指导智能体发起搜索并解读结果。
无需账号、API 密钥或登录。

## 使用

1. 在 ZCode 插件管理器中安装并启用 **PriceWin**。
2. 确认会话中已加载 PriceWin 工具（服务命名空间为 `plugin:pricewin:pricewin`），
   然后直接提问，例如：

> 帮我比较 11 月 10 日至 12 日岘港 2 位成人的酒店价格。

> 查找 11 月 20 日从胡志明市飞往河内最便宜的航班。

结果分两步返回：搜索调用先启动搜索，智能体随后轮询，价格通常在一分钟内返回。
Skill 中说明了这一流程，以及缺少日期、城市或人数时应向用户询问的内容。

## MCP 工具

| 工具 | 作用 |
| --- | --- |
| `search_hotels_live`、`poll_search_results` | 在各 OTA 及 OpenTravel 合作酒店中搜索某城市的酒店 |
| `search_flights_live`、`poll_flight_results` | 搜索单程或往返（逐段）机票价格 |
| `get_ota_hotel_detail` | 指定酒店的房型、实时价格、设施和评价（Booking.com） |
| `get_hotel_detail`、`get_hotel_info` | OpenTravel 合作酒店的房型与价格，或设施与政策 |
| `get_cancellation_policy` | 某一价格的退改条款 |
| `request_booking`、`check_booking_status` | 向合作酒店发送预订请求并查询状态 |
| `request_cancel_token`、`cancel_booking` | 分两步取消此类预订 |

以 [`.mcp.json`](./.mcp.json) 中的 `mcpServers` 字段为准。

## 网络访问与副作用

- 本插件不运行任何本地程序，不安装依赖，不包含 Hook，也不写入文件。所有操作都在远程 MCP 服务上完成。
- **发送到 `mcp.price.win` 的内容**：每次工具调用的参数，即行程信息（城市、日期、
  人数、酒店名称、价格区间、机场、舱位）；一小段请求原文，仅用于确定回复语言；
  以及预订请求中的住客姓名、电话和邮箱。
- **PriceWin 服务器的后续去向**：仅发送到 PriceWin 自己的后端，以及同一开发者运营的
  OpenTravel API（`api.travelopen.ai`）。预订请求中的姓名、电话和邮箱会经由
  OpenTravel 发送给合作酒店，以便酒店确认。
- **预订不收取任何费用。** `request_booking` 不锁定房间，也不索取支付信息；住客到店付款。
  取消预订需要一个发送到预订邮箱的一次性令牌。
- **价格来源**：PriceWin 后端在搜索时读取 Booking.com、Agoda、Traveloka、Trip.com
  和 Google Flights 的公开页面。PriceWin 与这些网站没有合作关系。每条结果都标明来源，
  并附有前往该网站预订的链接。价格会变动，请视为某一时刻的快照。
- 使用统计只记录行程参数，从不记录住客姓名、邮箱、电话、确认码或取消令牌。

隐私政策：<https://www.price.win/en/privacy-policy> · 服务条款：
<https://www.price.win/en/terms-of-service>

## 支持与源码

- 支持：<https://mcp.price.win/support> · support@price.win
- 工具文档：<https://mcp.price.win/docs>
- 上游软件包（同一套文件也用于 Claude Code、Codex CLI 和 Antigravity）：
  <https://github.com/PriceDotWin/pricewin-agent-plugin>

## 许可

清单文件、Skill 和文档采用 MIT 许可，见 [`LICENSE`](./LICENSE)。远程 PriceWin 服务、
PriceWin 名称和图标由 PriceWin 提供，不在本插件的许可范围内。Booking.com、Agoda、
Trip.com 和 Traveloka 是其各自所有者的商标。
