# PriceWin

[简体中文](./README_CN.md)

Live hotel and flight prices compared across Booking.com, Agoda, Trip.com and
Traveloka, in USD, from inside ZCode. The plugin declares one remote HTTP MCP
server, `https://mcp.price.win/mcp`, and one Skill,
`pricewin-travel-search`, that tells the agent how to run a search and read the
results. No account, API key or login is needed.

## Use

1. Install and enable **PriceWin** in ZCode's plugin manager.
2. Confirm the PriceWin tools are loaded in the session (server namespace
   `plugin:pricewin:pricewin`), then ask, for example:

> Compare hotel prices in Da Nang for 2 adults from November 10 to 12.

> Find the cheapest flight from Ho Chi Minh City to Hanoi on November 20.

Results arrive in two steps: a search call starts the search and the agent
polls until prices come in, usually within a minute. The Skill covers this, and
what to ask when the dates, city or party size are missing.

## MCP tools

| Tool | What it does |
| --- | --- |
| `search_hotels_live`, `poll_search_results` | Search a city's hotels across the OTAs and OpenTravel partner hotels |
| `search_flights_live`, `poll_flight_results` | Search one-way or per-leg round-trip fares |
| `get_ota_hotel_detail` | Rooms, live prices, facilities and reviews for one named hotel (Booking.com) |
| `get_hotel_detail`, `get_hotel_info` | Rooms and prices, or facilities and policies, of an OpenTravel partner hotel |
| `get_cancellation_policy` | Refund terms for one rate |
| `request_booking`, `check_booking_status` | Send a booking request to a partner hotel and read its status |
| `request_cancel_token`, `cancel_booking` | Cancel such a booking, in two steps |

The `mcpServers` field in [`.mcp.json`](./.mcp.json) is authoritative.

## Network access and side effects

- The plugin runs no local program, installs nothing, runs no hooks and writes
  no files. Everything happens on the remote MCP server.
- **Sent to `mcp.price.win`**: each tool call's arguments, which are trip details
  (city, dates, party size, hotel name, price range, airports, cabin), a short
  excerpt of the request used only to pick the reply language, and, for a
  booking request, the guest's name, phone number and email.
- **Onward from PriceWin's server**: only to PriceWin's own backend and to
  OpenTravel's API (`api.travelopen.ai`), run by the same developer. A booking
  request's name, phone and email go to the partner hotel through OpenTravel,
  so the hotel can confirm it.
- **Booking takes no money.** `request_booking` holds no room and asks for no
  payment data; the guest pays at the property. Cancelling needs a single-use
  token emailed to the address on the booking.
- **Where prices come from**: PriceWin's backend reads Booking.com, Agoda,
  Traveloka, Trip.com and Google Flights from their public pages at search
  time. PriceWin has no partnership with those sites. Each result names its
  source and links to it for booking. Prices change; treat them as a snapshot.
- Usage analytics record trip parameters only, never a guest's name, email,
  phone, confirmation code or cancel token.

Privacy policy: <https://www.price.win/en/privacy-policy> · Terms:
<https://www.price.win/en/terms-of-service>

## Support and source

- Support: <https://mcp.price.win/support> · support@price.win
- Tool reference: <https://mcp.price.win/docs>
- Upstream package (same files for Claude Code, Codex CLI and Antigravity):
  <https://github.com/PriceDotWin/pricewin-agent-plugin>

## License

The manifest, Skill and documentation are MIT, see [`LICENSE`](./LICENSE). The
remote PriceWin service, the PriceWin name and icon are provided by PriceWin
and are not licensed by this plugin. Booking.com, Agoda, Trip.com and Traveloka
are trademarks of their owners.
