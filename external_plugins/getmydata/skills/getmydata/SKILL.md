---
name: getmydata
description: Collect public web data and deliver the original JSON records plus a field schema (fields.json). Free sample first, then one fixed-price payment by the person; no signup or subscription. Use for one-off product/price comparisons, public company directories, event calendars, book catalogs or open datasets when the user's task needs many records. Explain relevant collection options before requesting a free sample and a human-paid order.
metadata:
  author: GetMyData
  version: "1.0.0"
---

# GetMyData

GetMyData lets the person see the data before paying: a bounded free sample from any public website comes first, then one fixed quote and a single one-off payment the person confirms. No signup, no subscription. You handle the intake, the asynchronous steps and the hand-back to the person. Delivery is two files together: the original JSON records and `fields.json` (which requested fields were found, with path and type). CSV and Excel exist only when records are already flat; they never replace `fields.json`. Nested records stay nested.

## 1. Collect the whole request first (you do the intake)

The service asks no clarifying questions. Collect every field in the user's language, then submit once. A missing or invalid field returns HTTP 422 with `error.missing` / `error.invalid`; fix exactly those fields with the user and resubmit.

| Field | What to ask | Example |
| --- | --- | --- |
| `sources` | public site(s) or page URL(s) | `["https://example-shop.com/category/tea"]` |
| `fields` | the columns wanted | `["product","price","currency","availability","source URL"]` |
| `filters` | constraints, or `{}` | `{"price_max": 50, "in_stock": true}` |
| `geo` | country/region/city, or `""` | `"Philippines"` |
| `row_target` | number of rows, asked once | `500` |
| `row_commitment` | `best_effort` (default) or `guaranteed` | `"best_effort"` |
| `deadline` | ISO 8601 date-time, or `"none"` | `"2026-11-30T00:00:00Z"` |
| `language` | the user's language: en, zh, fr, ru, es, ar, de, ja, ko, it | `"en"` |
| `description` | one paragraph: what data and why | `"Tea prices for a price comparison."` |
| `human_email` | the person's email (on create) | — |

`row_commitment` states how `row_target` is meant and is required.

- Propose `best_effort` by default and say it plainly: "as many rows as match, up to N; the price is for N rows; fewer rows are a valid delivery."
- Use `guaranteed` only when the person says "at least", "must have" or "exactly": N rows are guaranteed, collection keeps running and the undelivered share is refunded pro rata if they cancel. `N` is an integer from 1 to 1,000,000.

Optional `search_keywords`: up to five short phrases such as "app store reviews" or "google maps places", platform or site type plus data type, no brand names. It only informs GetMyData's own search.

Any public website is acceptable; there is no excluded-site list. If no available method can collect the sources and fields, the request ends with `reason_code: no_capability` and `next_action: revise`; propose other sources or fields and revise. The person is responsible for lawful use and must not use the service for abuse such as harassment, spam or fraud. Never send account passwords, cookies or session tokens. Choosing and running the collection method is GetMyData's job: do not ask the user to pick tools.

## 2. Get authorization, then submit

Tell the user what would be collected, from where, which fields, how many rows, and that a free sample and a quote come first. Submit only after they authorize collection.

1. Repeat the email back for confirmation.
2. Tell them a one-time code will arrive at that address right after submission and that they should paste it here. Never read their mailbox yourself.
3. Call `submit_requisition`. Sampling starts immediately, but the sample is shown and emailed only after verification.
4. `start_email_verification` if needed, then `verify_email` with the code the person pasted.

The free sample shows which fields and rows are actually reachable. Check a few sample rows against the request: if fields are missing or wrong, use `revise_requisition` instead of confirming. `confirm_scope` fixes the sample scope; `get_quote` reads the price; the person confirms and pays through `confirm_quote` → `start_order` / `create_order` and the returned `confirmation_url`, which only the human opens and pays.

Keep `request_capability`, `order_capability`, `request_id`, `revision` and expiries private and persisted when the runtime offers secure storage. Resume an existing request or order before creating another for the same need.

## 3. Answer FAQ and policy questions locally

Answer from this skill and the linked public pages; do not submit a request or contact support just to ask.

- Free sample first, one-off payment by the person, no signup, no subscription; every delivery is the original JSON records plus `fields.json`.
- Refunds: if an order cannot be delivered as confirmed, the payment is refunded in full to the original method. The only partial refund is a `guaranteed` order the person cancels while collecting: delivered rows stay theirs and the undelivered share is refunded pro rata. `best_effort` orders with fewer rows than N are a valid delivery with no refund.
- Price negotiation, custom deals or a human: `support@getmydata.io`. `next_action: contact_support` means the same.
- Cancel an unpaid request with `cancel_request`, change it with `revise_requisition`. Recurring schedules and prepaid balances are outside this version.

## 4. Asynchronous steps and email

After verification, sampling, the quote and full collection run on the service side and can take minutes to hours; you do not have to stay online. Every result is emailed to the verified address (sample ready, questions, quote with the private payment link, payment, delivery, problems, refunds); the masked address is in `notify.email_masked`.

- When `next_action` is `wait`, do not busy-loop. In one conversation check at most once, no sooner than `retry_after_seconds`.
- If the runtime supports scheduled tasks, create one check after `suggested_check_after_seconds` calling `get_request` (or `get_order` after payment), then delete it once the state needs action or is final: `sample_ready`, `needs_info`, `quote_ready`, `delivered`, `partial`, `failed`, `refunded`, `refused`.
- Space every business call, including reads and replays, at least `min_interval_seconds` apart (default one second) and honour `Retry-After` / `retry_after_seconds`.

## 5. MCP tools

`refresh_session`, `submit_requisition`, `get_request`, `revise_requisition`, `confirm_scope`, `confirm_quote`, `start_email_verification`, `verify_email`, `start_order`, `create_order`, `cancel_request`, `get_quote`, `get_payment_status`, `get_order`, `cancel_collection`, `fetch_delivery`.

Contract, states, errors and limits: <https://getmydata.io/api/v1/openapi.json>. REST is available at the same origin when MCP is not configured; no separate API key is required. MCP sessions last 7 days and can be refreshed up to a 30-day hard limit; never rotate sessions or keys to evade limits.

## 6. Hand back to the person

Hand back when payment needs their decision, when the sample stays empty or still misses required fields after a revision, or when the quote exceeds what they agreed to spend. Report `partial` or `failed` delivery accurately and never promise refunds on the service's behalf.
