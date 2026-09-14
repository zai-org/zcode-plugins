<img src="icon.svg" alt="UpKuaJing" width="64" height="64">

# UpKuaJing

Use a remote MCP server in ZCode to search B2B companies, professional contacts, customs trade records and map businesses, enrich contact details, analyze existing leads, and handle explicitly requested email/SMS delivery and task queries.

Plugin version: `1.0.5`. The package contains a remote MCP declaration and one `upkuajing` skill. Available tools and parameters are determined by the schemas discovered after connection.

## Installation and authorization

1. Locate UpKuaJing in the ZCode plugin marketplace once published. For local testing, add the marketplace directory containing `marketplace.json` and `plugins/upkuajing/`.
2. Install and enable UpKuaJing, then open a conversation.
3. Open ZCode's MCP management interface and complete UpKuaJing OAuth login. Ask the ZCode agent if you need help. An UpKuaJing account and appropriate permissions are required; paid capabilities also require available quota.
4. After authorization, ask “Check my UpKuaJing balance” and confirm that `auth_info` can be discovered and called.

The package declares a remote HTTP MCP endpoint. OAuth login, credential refresh and tool calls in ZCode still require runtime verification. If the client has no authorization entry or cannot complete login, the connection is unavailable. Retain the error for diagnosis; do not paste tokens, passwords or cookies into chat.

## Examples

- “Find US companies related to ice machines. Show the plan and maximum cost first.”
- “Find US buyers of ice machines using customs trade records.”
- “Enrich my selected companies with emails and phone numbers after confirming the cost.”
- “Check my UpKuaJing account balance and available quota.”
- “Check the status of my previous email task.”

The skill provides guidance for relevant requests. Paid actions require live pricing, a plan with a maximum cost, and explicit approval in the user's next turn. It does not automatically expand queries or retry paid requests. Email/SMS delivery also requires confirmation of recipients, content, channel and cost.

## Dependencies, network access and side effects

- Requires ZCode with plugin and remote HTTP MCP support, plus network access to `https://mcp.upkuajing.com/mcp`. OAuth also accesses the authorization endpoints actually advertised by the service.
- The package does not include MCP server source code and requires no local Python, Node.js or additional model API key. The ZCode session supplies the model; data capabilities depend on the online UpKuaJing service.
- Tool calls send query conditions, business IDs, enrichment inputs, and approved recipients and message content to UpKuaJing for processing. Only provide data you are authorized to share.
- Search, enrichment and verification tools may consume account quota. Current tool responses determine pricing. Email/SMS delivery reaches real third parties; reading task status does not send again.
- The plugin contains no local executable scripts, command components or hooks, and declares no automatic project-file writes. ZCode installs the package and manages its own configuration and authorization state. Separately requested exports or saves follow that request.
- MCP App graphical rendering compatibility is unverified. When display support is unknown or unavailable, the skill falls back to text or Markdown using existing results instead of issuing another paid query.

## Sources and licensing

UpKuaJing provides the MCP service. The skill is adapted from this project's WorkBuddy distribution. The bundled icon.svg is the UpKuaJing logo copied from the WorkBuddy package. No third-party executable code is bundled. The packaging format follows the [official ZCode plugin repository](https://github.com/zai-org/zcode-plugins).

The plugin configuration, documentation and skill are distributed under the [MIT License](LICENSE). The UpKuaJing logo is included for identifying this integration; the MIT license does not grant trademark rights or rights to hosted services and business datasets. Service access remains subject to applicable account terms and fees.

## Verification scope

Official validation and distribution build checks passed. Local installation, enablement, Chinese display name and logo display were confirmed in ZCode. End-to-end OAuth login/refresh, authenticated balance lookup and business-result rendering have not passed acceptance yet; authorization timed out during an attempted connection. No paid query or message delivery was performed as part of this verification.

Minimal manual check: install and authorize as above, then request the balance; `auth_info` should return the current account information. Next request a search plan; the agent should obtain guidance and pricing and stop for cost confirmation without executing a paid search. Paid queries and actual delivery require separate explicit approval.
