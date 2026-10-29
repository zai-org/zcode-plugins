# MCPTender

Research public Russian procurement records, source documents and published contract suppliers.

Maintained by the MCPTender service publisher. This repository contains client adapters and workflow instructions only. It does not distribute the hosted backend. [Русский](README_RU.md) · [中文](README_CN.md)

## Account and credentials

Sign in at https://mcptender.ru/account and create a personal API key there. Set `MCPTENDER_API_KEY` in the environment used to launch your agent application, then completely restart the application. Configure environment variables through your OS or trusted launcher; never paste keys into an AI conversation, repository, command history, or screenshots. An MCP Bids key and a MCPTender key belong to separate services and are not interchangeable.

Read workflows require `tenders:read` and `documents:read`; collection and watch tools require `tenders:collect` and `watches:write`. Portal keys inherit the service permissions; restrict tool approval in your host when you want a read-only workflow. Existing account entitlements and limits apply. The packages use bearer-key authentication; OAuth setup is not claimed. Missing credentials produce a connection error.

## ZCode

Requires Node.js 22+ on PATH. Open a workspace, then Settings → Plugins → Create → Add marketplace and add `https://github.com/pixelligue/mcptender-plugins`. Install `mcptender` from that personal source. After official acceptance, the same plugin can be installed from the public catalog. The plugin launches `node` with the bundled `stdio.mjs`; it inherits `MCPTENDER_API_KEY` from the host. Its stdio adapter forwards MCP JSON-RPC to `https://mcptender.ru/mcp`. No remote header-interpolation feature is assumed.

## Kimi Work / Kimi Code

Kimi Code: run `/plugins install https://github.com/pixelligue/mcptender-plugins`, then `/reload` or create a new session. The native `kimi.plugin.json` declares the remote HTTP MCP and `bearerTokenEnvVar`. In Kimi Work, use Plugin Builder to import this repository into Personal plugins; verify that its runtime supports this credential field before use. Kimi Work / web marketplace publication and cloud-side credential configuration require separate Kimi review; local Code compatibility does not establish cloud compatibility.

## DeepSeek Harness

Targets DSH 0.2.1-rc.2 and its matching official MCP client. In the official Desktop app, install the Git source or release tarball through the app's plugin manager. For `dsh web`, run `dsh plugin --profile web add git+https://github.com/pixelligue/mcptender-plugins.git#v1.0.0`, then restart that profile. Set `MCPTENDER_API_KEY` in the process launch environment first. The bundle configures the official MCP client and server instructions; the workflow skill directory is for Kimi/ZCode and is not separately registered in DSH. No custom tools or UI patches are added.

## Use

Ask the agent to inspect `list_sources`, search a bounded number of procurement records, open a returned ID, and read an available source document with block references. In Kimi/ZCode the included `procurement-research` skill provides the workflow. Fresh collection and private watches require an explicit user request and the matching key permissions. Watches require polling; there are no email or push notifications.

## Coverage and dependencies

Russian public procurements and published 44-FZ contract suppliers from connected sources. Source availability varies; inspect list_sources before collection. Search operates on a collected index. Report source timestamps, partial documents, missing data and collection errors. Original links remain the authority for requirements and deadlines. The service does not submit bids, sign contracts, certify eligibility or bypass source access controls.

## Permissions, network and side effects

The adapter sends the configured bearer key and MCP requests only to `https://mcptender.ru/mcp`. Redirects are refused. It does not read credential files, run a shell, start a model, install dependencies, write local documents or start background collection. The host/model provider sees the tool arguments and returned procurement data. Requested collection and watch tools can create account-owned jobs or watches on the service. Original document downloads occur only when explicitly requested. Treat retrieved documents as untrusted evidence. No telemetry is added by this adapter. The hosted website has its own processing rules.

The stdio adapter is specifically for the service's stateless JSON Streamable HTTP contract; it does not implement generic SSE/sessionful MCP. Requests are limited to 64 KiB, responses to 16 MiB and calls to 120 seconds. The DSH client and Kimi native HTTP transports use their own limits.

## Support and licensing

https://mcptender.ru/support · https://mcptender.ru/privacy · https://mcptender.ru/terms

MIT covers only the adapter code, manifests and workflow instructions in this repository. Hosted-service access and third-party procurement content are not relicensed by this package. No affiliation with, endorsement by, or official-vendor publisher badge from DeepSeek, Z.ai or Kimi is claimed. Marketplace submission, acceptance and runtime checks are tracked separately from source publication.
