---
name: watchlist
description: Create, update, inspect, and validate persistent watchlists stored as JSON files. Triggers on "自选股", "watchlist", "监控清单", "add to my list", "把XX加入监控", "建一个组合清单".
---

# Watchlist Management

Watchlists live in `watchlists/<list-name>.json` in the working directory. One list per file.

## Workflow

### Step 1: Resolve the operation

Create / add names / remove names / show / rename. If the user names a list that doesn't exist and the operation is "add", create it and say so.

### Step 2: Resolve every name to a windcode

- Accept tickers in the vendor's suffixed form — 沪深 `.SH` / `.SZ`, 港股 `.HK`, 美股 `.O` / `.N` — or company names/aliases.
- For names or aliases, resolve via 同花顺 `hexin-stock.search_stocks` (query = 简称/名称); if a name is ambiguous (multiple listings, A/H dual listing), ask which one before writing.
- Never guess a code from memory — always confirm the resolved code and label against a live lookup.

### Step 3: Write the file

Schema:

```json
{
  "name": "<list-name>",
  "updated": "<YYYY-MM-DD, today>",
  "positions": [
    {"windcode": "[证券代码]", "label": "[证券简称]", "weight": null, "cost": null, "notes": ""}
  ]
}
```

- Preserve existing `weight` / `cost` / `notes` on names you are not touching.
- `weight` is a decimal fraction (0.05 = 5%); `cost` is per-share in listing currency. Only set them when the user supplies them.
- Validate JSON after writing.

### Step 4: Confirm back — and hand over the file

Show the resulting list as a short table (windcode, label, weight if any) and cite the JSON deliverable exactly once with `::zcode-file-citation{path="..." purpose="output"}` inline in prose. Do not add a separate raw path, Markdown link, or trailing citation list. If the list exceeds ~30 names, warn that recap and event scans will be slower and suggest splitting.

**The written JSON is the deliverable, so deliver it.** This skill's product is a
saved file, not a message about one: put `watchlists/<list-name>.json` where the
user collects output, the same as any other artifact, rather than leaving it only
in the working directory. A run that resolved every code correctly and handed back
nothing looks identical to a run that did no work — and the list is what the user
will point `close-recap`, `intraday-watch`, and `event-monitor` at next.

Read the file back after writing and show the parsed contents, so the codes the
user confirms are the ones actually on disk rather than the ones you intended to
write.
