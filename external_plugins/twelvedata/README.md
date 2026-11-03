# Twelve Data

[中文文档](./README_CN.md)

Market data from [Twelve Data](https://twelvedata.com) inside ZCode conversations. The plugin connects ZCode to the official Twelve Data MCP server, so agents can look up symbols, prices, indicators, and fundamentals without leaving the task.

## What it provides

One remote MCP server, `twelvedata`, with tools for:

| Area | Tools |
| --- | --- |
| Search and reference | `search_symbol`, `get_reference_data`, `get_market_state`, `get_earliest_timestamp` |
| Prices | `get_quote`, `get_price`, `get_time_series`, `get_market_movers` |
| Analysis | `get_technical_indicator`, `get_analyst_data` |
| Fundamentals | `get_company_info`, `get_financials`, `get_statistics`, `get_earnings`, `get_dividends`, `get_splits`, `get_market_cap`, `get_ipo_calendar`, `get_company_news` |
| Funds and regulatory | `get_etf_data`, `get_mutual_fund_data`, `get_regulatory_data` |

Coverage: stocks, ETFs, mutual funds, indices, forex, and crypto.

## Setup

1. Install the plugin from the Plugin Marketplace.
2. Open **Settings → MCP Servers**. The `twelvedata` server shows **Open authorization**.
3. Click **Open authorization**, sign in with your Twelve Data account, and click **Allow access**. Finish within 5 minutes, or ZCode cancels the attempt and you start again.
4. Start a new task and ask, for example: `Use Twelve Data to get the latest quote for AAPL, including price and volume.`

You need a Twelve Data account. A free plan is available at [twelvedata.com/pricing](https://twelvedata.com/pricing). After sign-in, ZCode keeps the session, so you do not sign in again after a restart.

## Network access and permissions

- **Network:** the plugin talks only to `https://mcp.twelvedata.com/mcp` over HTTPS.
- **Sign-in:** OAuth in your browser. ZCode receives an access token for your Twelve Data account. The plugin cannot change your account or read your API key. You can revoke access from your Twelve Data account at any time.
- **Data and limits:** responses follow your Twelve Data plan, including its symbol coverage and request limits. Tool calls count toward your plan's API usage.
- **Local side effects:** none. The plugin has no commands, hooks, skills, or local processes, and writes no files.

## Support

- Twelve Data support: [support.twelvedata.com](https://support.twelvedata.com)
- Data terms: [twelvedata.com/terms](https://twelvedata.com/terms)
