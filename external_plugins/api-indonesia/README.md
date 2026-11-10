# API Indonesia

Indonesian public data from official sources through one MCP server: administrative regions down to villages and postal codes, region boundaries, public holidays, prayer times, Hijri dates, schools, universities, hospitals, earthquakes, weather, air quality, exchange rates, minimum wage, QRIS parsing, rupiah formatting and more.

| | |
|-|-|
| MCP endpoint | `https://mcp.apiindonesia.id/mcp` (Streamable HTTP, 84 tools) |
| Authentication | OAuth 2.1 sign-in when prompted, or an `aip_live_...` API key |
| REST API | `https://use.apiindonesia.id` with the `x-api-key` header, OpenAPI at https://apiindonesia.id/openapi.json |
| Pricing | 3,000 free credits on sign-up, no card; 2 credits per successful request |
| Docs | https://docs.apiindonesia.id |
| Example queries | "Which villages are in Kecamatan Pontianak Kota?", "Is 17 August 2027 a public holiday in Indonesia?", "Show the latest BMKG earthquake above magnitude 5" |

## Install

Install the plugin from the ZCode marketplace, then complete the OAuth sign-in when ZCode asks for it. To use a key instead, set the API key field in the plugin configuration (leave it empty to keep OAuth).

## What goes to the network

Every tool call is sent over HTTPS to `https://mcp.apiindonesia.id/mcp`. No credentials are stored in the plugin package; the API key you enter stays in the local ZCode configuration.

## Licence and provenance

Plugin wrapper by Khaisa Studio, MIT licensed. The hosted service is operated by Khaisa Studio: https://apiindonesia.id. Source and examples: https://github.com/khmuhtadin/api-indonesia-examples.
