# maptec-maps

[中文文档](./README_CN.md)

Connect ZCode to **Maptec MCP** for place search, geocoding, routing, distance matrix, map matching, and IP geolocation. The plugin registers a remote HTTP MCP server and the `maptec-maps` skill so the agent discovers tools and follows Maptec usage guidance.

Upstream: [maptec-api/agent-plugins](https://github.com/maptec-api/agent-plugins).

## Security and side effects

Enabling this plugin grants network access to Maptec’s hosted MCP service and sends location, address, route, and IP data that you ask the agent to query.

- **Network**: HTTPS requests to `https://mcp.maptec.com/mcp` (Streamable HTTP MCP).
- **Credentials**: A Maptec application API key is required. Configure `maptec_api_key` in the plugin settings (ZCode treats this field as non-sensitive). Do not paste keys into chat or commit them to the repository.
- **Authorization header**: Send the **raw API key** as the `Authorization` value. Do not prepend `Bearer` unless Maptec documentation changes.
- **No local command execution**: The plugin does not ship shell hooks or local MCP stdio servers; only the declared remote MCP and skill files are included.
- **Billing / quotas**: Maptec API usage is subject to your Maptec account and product terms.

Create keys at the [Maptec console](https://lbs.maptec.com/console/).

## Install

1. In ZCode, open **Settings → Plugins** and install **maptec-maps** from the official marketplace (after this plugin is published).
2. Enable the plugin.
3. Open the plugin details → **Advanced → Configuration** and save **Maptec API Key**. Alternatively, configure a separate authenticated Maptec MCP connection and rely on the skill for tool selection guidance.

## Verify

1. Confirm **Settings → MCP** lists a **Plugin MCP server** for Maptec and that it connects successfully.
2. In a workspace, ask: “Search for cafes within 1000 m of 1.2868,103.8545 in Singapore.”
3. Confirm the agent calls Maptec search tools and returns results without asking you to paste an API key in chat.

## Components

| Component | Purpose |
| --- | --- |
| Skill `maptec-maps` | Tool selection, parameter hygiene, and response interpretation for Maptec MCP |
| MCP `maptec` | Remote Maptec MCP over HTTP with API key in `Authorization` |

## Documentation

- [Maptec MCP introduction](https://lbs.maptec.com/docs/en-US/mcp/introduction)
- [Maptec MCP connection overview](https://lbs.maptec.com/docs/en-US/mcp/overview)

## License

MIT — see [LICENSE](./LICENSE).
