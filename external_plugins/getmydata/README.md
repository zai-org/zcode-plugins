# GetMyData

Ask your AI assistant for public web data as JSON. Free sampling first, then one fixed price. No signup, no subscription.

GetMyData collects records from public websites on request and delivers the original JSON records plus a `fields.json` schema (which requested fields were found, with path and type). CSV and Excel are added only when the records are already flat.

## What it does

1. You describe the data: public sources, the columns you want, filters, region, how many rows, deadline and why.
2. GetMyData returns a bounded free sample from those sources so you can see the fields and rows before paying.
3. If the sample is right, you get one fixed quote for the row count. You confirm and pay once, through a private link, when you decide to.
4. Collection runs asynchronously and the delivery is emailed to your verified address; the assistant can also fetch it into the workspace.

Good fits: one-off product and price comparisons, public company directories (business data, never personal contacts), event calendars, book catalogs, open-data projects.

Not a fit: recurring monitoring on a schedule, prepaid balances, or anything that needs private, logged-in or non-public data. Never give the service passwords, cookies or session tokens. Source availability and the exact fields are established by the free sample, not by the examples above.

## Components

| Component | Path | Purpose |
| --- | --- | --- |
| MCP server | `.mcp.json` → `https://getmydata.io/mcp` | Sixteen tools covering request, sample, quote, order and delivery |
| Skill | `skills/getmydata/SKILL.md` | Intake rules, authorization boundary, asynchronous steps, FAQ answers |

## How to trigger it

Install and enable the plugin, then ask in a normal conversation, for example:

- "Collect the public price list from these three tea shops as JSON, 500 rows, best effort."
- "Get me the public exhibitor directory for this trade fair with company name, country and booth."
- "I need the public book listings for this publisher: title, ISBN, edition, price."

The assistant collects the required fields, confirms your email, and asks for the one-time code that arrives there. After you paste the code, the sample is shown and emailed, then the quote, then your payment decision.

## Network, dependencies and side effects

- Network: HTTPS calls to `https://getmydata.io` only (`/mcp`, `/api/v1/...`, `/skills/getmydata/SKILL.md`).
- Dependencies: none. No local process, no npm package, no runtime binary; the MCP server is remote.
- Credentials: no API key, no signup. Sessions are issued by the service (`Mcp-Session-Id`) and expire after 7 days, refreshable up to 30 days.
- Files: none are written by the plugin itself. Deliveries fetched by the assistant land wherever your client saves them.
- Side effects: a submitted request starts sampling on the service immediately; collection and any payment start only after the person confirms the quote. Every result, including the sample, the quote link and the delivery, is emailed to the verified address.
- Money: the person pays once, at a fixed price for the agreed row count, through the private link. Submitting a request never charges anything.

## Third party

Service and content: GetMyData (<https://getmydata.io>), `support@getmydata.io`. Contract and states: <https://getmydata.io/api/v1/openapi.json>. Repository: <https://github.com/getmydata-io/getmydata-agent> (Apache-2.0).
