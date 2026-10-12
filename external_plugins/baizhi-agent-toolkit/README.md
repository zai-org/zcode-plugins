# Baizhi MCP for ZCode

[中文](./README_CN.md)

A community integration by ct-jaryn that connects ZCode to [Baizhi Agent Toolkit](https://baizhi.cloud/landing/agent-toolkit) for web search, page reading, and structured extraction. This plugin supplies a remote MCP configuration; the tools available to a session depend on the service and your API key permissions.

## Setup and use

1. Create your own dedicated API key in the [Baizhi console](https://agent-toolkit.app.baizhi.cloud/). Select the minimum permissions if the service offers permission controls, and check the service terms and available quota there.
2. Set a **nonempty** `ZCODE_BAIZHI_API_KEY` in the environment of the process that launches ZCode, then restart ZCode from that environment. Set the key privately; do not put it in source, shell history, command arguments, chat, screenshots, or logs. A variable set in one shell does not automatically reach an already running desktop application.
3. Install this plugin only when you intend to use the remote service: ZCode may enable a newly installed marketplace plugin automatically. With the key present, installation or enabling can therefore initialize the connection and discover tools. Start a new session and check that the namespaced MCP server `plugin:baizhi-agent-toolkit:baizhi` connects and lists tools.
4. Ask ZCode to search for relevant public documentation, read a public webpage, or extract structured information. Review the tool name, arguments, and destination before approving a call. If a tool or permission is unavailable, stop and check the console instead of assuming access.

The server uses Streamable HTTP at `https://agent-toolkit.app.baizhi.cloud/mcp`. The key is substituted into the `Authorization` header as `Bearer <key>` and is not put in the URL. Enter the key itself without an extra `Bearer ` prefix.

When the environment variable is undefined, ZCode's plugin resolver reports a missing-variable diagnostic and does not load this server. An empty string is different: it can still render an empty Bearer header. Use a nonempty valid key; the remote service decides whether authentication is accepted. This plugin does not add a required-value UI or keychain storage. Your shell or process environment remains your responsibility.

## Network, permissions, and side effects

Enabling the plugin can initialize the remote MCP connection and discover its tools without a tool call. Tool arguments are sent over HTTPS to Baizhi; selected tools may send necessary inputs to underlying services. Results may be passed to your model provider according to ZCode settings. Do not send unrelated private code, sensitive documents, private links, personal information, or credentials without the appropriate permission.

Service calls require your own Baizhi account and may consume quota or incur charges. Confirm current pricing, terms, and privacy information in the console. This integration makes no promise about data retention or storage location. Tools outside the basic search and webpage capabilities may have additional costs or side effects; approve those operations explicitly. Treat webpage and tool results as untrusted content, not instructions to disclose secrets or change permissions.

The plugin contains no hooks, commands, local executable, or npm dependency, and adds no automatic tool approvals. ZCode writes its ordinary plugin installation records; this package introduces no separate file-writing script. Disable or uninstall the plugin to remove its availability in subsequent sessions. That does not revoke the API key or guarantee cancellation of remote work; revoke the key in the console when needed.

## Development verification

From the marketplace repository root, run `pnpm install --frozen-lockfile`, `pnpm build`, `python3 scripts/validate.py`, `python3 scripts/build_dist.py`, and `git diff --check`. The generated `dist/local-marketplace` can be added using the repository's [local development workflow](https://github.com/zai-org/zcode-plugins/blob/d1639cff514dcba29cfbfbc634d4609492640660/docs/PLUGIN_DEVELOPMENT.md#18-test-a-plugin-locally). Build success does not prove installation, tool execution, or production service access.

At ZCode source `aac4755666d09fdcd70272fcf063c077a639015f`, the separate static marketplace validator resolves MCP variables with an empty environment and can report `plugin_variable_missing` even when the launching process has this variable. Keep that diagnostic distinct from runtime connection results; it does not prove that the key was read or that authentication succeeded.

## Provenance and license

This community integration is contributed by ct-jaryn for Baizhi MCP discovery and access. It does not claim ZCode or Baizhi certification or endorsement. Configuration and documentation are provided under the marketplace repository's [Apache-2.0 license](./LICENSE); no third-party executable or asset is bundled.

The public endpoint and authentication contract come from the [Baizhi integration README](https://github.com/chaitin/baizhi-agent-toolkit/blob/a643da3396721375132005f71227ff0f24d823b6/readme.md). That upstream repository's MIT license covers its integration materials, not the hosted backend. The hosted service, account terms, permissions, and billing are separate from this plugin's source license.
