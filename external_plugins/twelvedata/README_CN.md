# Twelve Data

[English](./README.md)

在 ZCode 对话中使用 [Twelve Data](https://twelvedata.com) 的市场数据。本插件将 ZCode 连接到官方 Twelve Data MCP 服务，Agent 无需离开当前任务即可查询证券代码、行情、技术指标和基本面数据。

## 提供的能力

一个远程 MCP 服务 `twelvedata`，包含以下工具：

| 类别 | 工具 |
| --- | --- |
| 搜索与参考数据 | `search_symbol`、`get_reference_data`、`get_market_state`、`get_earliest_timestamp` |
| 行情 | `get_quote`、`get_price`、`get_time_series`、`get_market_movers` |
| 分析 | `get_technical_indicator`、`get_analyst_data` |
| 基本面 | `get_company_info`、`get_financials`、`get_statistics`、`get_earnings`、`get_dividends`、`get_splits`、`get_market_cap`、`get_ipo_calendar`、`get_company_news` |
| 基金与监管 | `get_etf_data`、`get_mutual_fund_data`、`get_regulatory_data` |

覆盖范围：股票、ETF、共同基金、指数、外汇和加密货币。

## 安装与配置

1. 在插件市场中安装本插件。
2. 打开 **Settings → MCP Servers**，`twelvedata` 服务会显示 **Open authorization**。
3. 点击 **Open authorization**，使用你的 Twelve Data 账号登录，然后点击 **Allow access**。请在 5 分钟内完成，否则 ZCode 会取消本次授权，需要重新开始。
4. 新建任务并提问，例如：`Use Twelve Data to get the latest quote for AAPL, including price and volume.`

需要一个 Twelve Data 账号，可在 [twelvedata.com/pricing](https://twelvedata.com/pricing) 选择免费套餐。登录后 ZCode 会保存会话，重启后无需再次登录。

## 网络访问与权限

- **网络：** 插件仅通过 HTTPS 访问 `https://mcp.twelvedata.com/mcp`。
- **登录：** 在浏览器中完成 OAuth 授权，ZCode 获得你的 Twelve Data 账号的访问令牌。插件无法修改你的账号，也无法读取你的 API Key。你可以随时在 Twelve Data 账号中撤销授权。
- **数据与限额：** 返回的数据取决于你的 Twelve Data 套餐，包括可用的证券范围和请求限额。工具调用会计入你套餐的 API 用量。
- **本地影响：** 无。插件不包含命令、hooks、skills 或本地进程，也不会写入任何文件。

## 支持

- Twelve Data 支持：[support.twelvedata.com](https://support.twelvedata.com)
- 数据条款：[twelvedata.com/terms](https://twelvedata.com/terms)
