# websearch

Multi-engine web search for ZCode as a single zero-dependency MCP server: AnySearch / Exa / Parallel / Bing / SearXNG chained with automatic fallback, plus a static page reader. **Every engine works without a key** (free tiers); when a quota runs out, fill in that engine's own key and it switches to your quota.

> [中文文档](./README_CN.md)

## Tools

### `web_search`

```json
{ "query": "required, ≤2000 chars", "limit": "1-10, optional, uses the configured default", "engines": ["bing", "exa"] }
```

Success returns `{ ok:true, engine, results:[{title,url,snippet,publishedAt}], attempts, skipped, elapsedMs }`; failure returns `{ ok:false, errorCode, message, attempts, skipped, configPath }` with a `message` you can relay to the user.

`attempts` records every engine that was tried (`ok` / `count` / `ms`), and failed quota-shaped errors (401/402/429, rate limit, quota) carry a `hint` telling the user to fill in that engine's key.

### `fetch_page`

```json
{ "url": "required, absolute http(s) URL", "maxChars": "optional, default 8000, range 500-30000" }
```

Strips `script` / `style` / `svg` / comments, converts block tags to newlines, decodes HTML entities, squeezes whitespace, truncates to `maxChars`. `application/json` responses are returned verbatim. No page scripts are executed and no login state is used.

## Engines

| id | endpoint | method | key |
|---|---|---|---|
| `anysearch` | `api.anysearch.com/v1/search` | JSON API | optional (Bearer) |
| `exa` | `mcp.exa.ai/mcp` | hosted MCP, tool `web_search_exa` | optional (Bearer) |
| `parallel` | `mcp.parallel.ai/mcp` | hosted MCP, tool `web_search` | optional (`x-api-key`) |
| `bing` | `www.bing.com/search` | result-page scrape | none, and not applicable |
| `searxng` | your instance | `/search?format=json` | needs a self-hosted instance (public ones usually disable the JSON API) |

Chain rules: `fallback` (default — start from the first engine every call) or `rotate` (shift the start by one per call to spread free tiers). One deadline covers the whole call (20s default) and each engine gets the remaining budget; engines left unrun are reported in `skipped`. Results are deduplicated by URL and snippets are capped at 300 characters — nothing is rewritten.

## Configuration

This ZCode build has **no configuration form on the plugin detail page**. Configuration lives in a `websearch.json` file inside the plugin data folder:

```text
<plugin-data-folder>/websearch.json
```

The file is **created automatically on first use**, and its absolute path is baked into both tool descriptions — so the quickest way to find it is to ask the model *"where is the websearch config file?"*. It is also `<ZCODE_PLUGIN_DATA>/websearch.json`, i.e. for a typical install:

```text
C:\Users\<you>\.zcode\cli\plugins\data\websearch@zcode-plugin\websearch.json
```

```json
{
  "anysearchKey": "",
  "exaKey": "",
  "parallelKey": "",
  "order": "anysearch,exa,parallel,bing,searxng",
  "disabled": "",
  "mode": "fallback",
  "defaultLimit": 10,
  "timeoutMs": 20000,
  "bingMarket": "auto",
  "searxngInstances": ""
}
```

The same fields are also declared as plugin `userConfig` options, so newer ZCode builds that grow a configuration form pick them up without any change on this side. Precedence: `websearch.json` > plugin configuration > environment variables > built-in defaults.

Environment fallbacks: `ANYSEARCH_API_KEY` / `EXA_API_KEY` / `PARALLEL_API_KEY` apply **only while the corresponding field is empty** — the file (or plugin configuration) always wins.

## Security boundary

- An MCP server is an ordinary local process; the host does **not** gate its network traffic. The boundary therefore lives in this plugin: only `http`/`https`, URLs with credentials refused, loopback / private / link-local (including the `169.254.169.254` metadata endpoint) / CGNAT / unique-local / multicast addresses refused for both address families, at most 5 redirects with **every hop re-checked**, 2 MB response ceiling, request timeouts.
- `fetch_page` URLs are model-controlled, so that guard always applies. SearXNG instances come from the user's own configuration, so a local instance is allowed there.
- Search results and page text are **untrusted data**; both tool descriptions say not to follow instructions found in them.

## Known limits

- **Bing is an HTML scrape**: a result-page markup change returns 0 results (the chain skips it and says so — it never pretends "no results").
- **Anonymous tiers get rate-limited**: Exa has had long 429 periods, AnySearch moved to a paid tier at some point; the chain falls through and `attempts[].hint` suggests filling in a key.
- **`fetch_page` does not render JavaScript** — script-rendered pages only yield their static part.
- **No caching**: every call really hits the engines.
- The built-in `WebSearch` (when the model provider supports server-side native search) takes precedence for the model; an MCP plugin cannot disable it.

## Development

```text
external_plugins/websearch/
├── .mcp.json                # MCP server declaration (stdio, node, user_config env)
├── .zcode-plugin/plugin.json
├── bin/server.mjs           # the whole implementation, zero dependencies, Node 18+
├── commands/websearch.md    # /websearch manual entry and single-engine diagnosis
├── tests/test-server.py     # offline handshake/error paths; --live hits the real engines
├── LICENSE                  # MIT
└── README.md / README_CN.md
```

```bash
node --check bin/server.mjs
node bin/server.mjs --self-test          # offline parser/config/SSRF assertions
python tests/test-server.py              # offline MCP handshake and error paths
python tests/test-server.py --live       # also hits the real engines
```

## License

MIT — see [LICENSE](./LICENSE). The search engines themselves are third-party services (AnySearch, Exa, Parallel, Bing, SearXNG) used over their public endpoints.
