# Atlassian Jira

Connect ZCode to **Jira** and **Confluence** on **Atlassian Cloud** through [Atlassian's official remote MCP server](https://developer.atlassian.com/change-log/blog/2025/07/01/mcp-server-beta/) (part of Rovo). No local server, no API token files: the plugin declares the hosted endpoint and ZCode handles OAuth 2.1 sign-in in the browser on first use.

## What it gives you

- **MCP server `atlassian`** — the hosted Atlassian endpoint, exposing tools to search issues with JQL, read, create, edit, and transition issues, add comments, and work with Confluence pages.
- **Skill `jira`** — guidance for the agent on Jira workflows: building explicit JQL, confirming project/issue type before creating, discovering valid transitions per workflow, and summarizing sprints.

## Structure

```
atlassian-jira/
├── .zcode-plugin/
│   └── plugin.json          # Plugin manifest
├── skills/
│   └── jira/
│       └── SKILL.md         # Jira workflow guidance
├── .mcp.json                # MCP server declaration (remote HTTP)
├── README.md
└── README_CN.md
```

## Requirements

- An **Atlassian Cloud** site with Jira. Self-managed **Jira Server / Data Center** is not reachable through the remote MCP server; use a Jira REST API tool for those deployments.
- The user must have a Jira license on the site being queried.

## MCP servers

| Name | Type | Endpoint | Auth |
| --- | --- | --- | --- |
| `atlassian` | `http` (remote) | `https://mcp.atlassian.com/v1/mcp` | OAuth 2.1 via browser on first use |

## Getting started

1. Install the plugin from the ZCode plugin marketplace.
2. Open a new session. On first use, ZCode opens the browser to sign in to Atlassian and authorize the site.
3. Try a prompt such as: *"Search my open Jira issues assigned to me and summarize them by status."*

## Privacy and security

- **Network access**: the only network dependency is Atlassian's hosted MCP endpoint (`mcp.atlassian.com`). Issue data flows between ZCode and Atlassian; the plugin itself runs no local code.
- **Credentials**: the plugin stores no credentials. OAuth tokens are handled by the ZCode client and Atlassian's authorization server.
- **Third-party service**: the Atlassian Remote MCP Server is operated by Atlassian and subject to [Atlassian's terms](https://www.atlassian.com/legal/customer-agreement). The plugin declares its public endpoint and adds no wrapper code.

## Troubleshooting

- **401 / not authenticated**: open ZCode → Settings → MCP and check the `atlassian` server status; restart the session to retry the OAuth flow.
- **Connection timeout**: Atlassian Cloud can be slow to answer; raise `timeoutMs` in `.mcp.json`.
- **Empty results or no sites**: verify the site is authorized for AI/MCP access in the Atlassian administration settings and that the user has a Jira license there.
- **Endpoint changes**: if Atlassian revises the route, update `url` in `.mcp.json`; the current endpoint is documented on Atlassian's Remote MCP Server page.

## License

This plugin is distributed under the [Apache-2.0 license](../../LICENSE) of this repository.
