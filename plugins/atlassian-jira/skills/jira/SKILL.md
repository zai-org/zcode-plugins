---
name: jira
description: Work with Jira and Confluence on Atlassian Cloud through Atlassian's official remote MCP server (Rovo). Search issues with JQL, create, edit, and transition issues, add comments, summarize sprints and backlogs, and read Confluence pages. Use when the user mentions Jira, issue, ticket, sprint, backlog, Confluence, or Atlassian.
---

# Atlassian Jira (official Atlassian remote MCP server)

This plugin brings the MCP tools of Atlassian's official remote server (`https://mcp.atlassian.com/v1/mcp`), exposed by Atlassian as part of Rovo. Tools are registered under the `mcp__atlassian__` prefix and cover Jira and Confluence: search, read, create, edit, transition, and comment. Check the exact tool names available in the current session before calling them; do not assume specific tool names.

Respond in the user's language.

## Requirements

- An **Atlassian Cloud** account. The remote MCP server does not reach self-managed Jira Server / Data Center instances; for those, use the Jira REST API with an API token instead.
- The first connection triggers an **OAuth 2.1** flow: the client opens the browser to sign in to Atlassian and authorize access to the site. Without that authorization, tools fail with 401.

## Typical workflows

- **Search issues**: build an explicit JQL and pass it to the search tool. Examples: `assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC`, `project = ABC AND sprint in openSprints()`. Report key, summary, status, and assignee; never invent issues the search did not return.
- **Create an issue**: confirm project, issue type, summary, and description before creating. If the user did not give a project or type, ask, or look them up with the metadata tools instead of guessing IDs.
- **Transition**: list the transitions available on the issue and pick the one matching the user's request; do not hard-code transition IDs, they vary per workflow.
- **Comment and edit**: before updating fields, read the issue to learn current values and the format each field expects.
- **Sprint / status summaries**: combine JQL searches (sprint issues grouped by status, assignee, priority) with reads of individual issues when the user asks for detail.

## Troubleshooting

- **401 / not authenticated**: open ZCode → Settings → MCP and check the status of the `plugin:atlassian-jira:atlassian` server; restart the session to retry the OAuth flow.
- **Timeout**: Atlassian Cloud can be slow to answer; raise `timeoutMs` in `.mcp.json`.
- **Empty results or no sites**: verify the Atlassian site is authorized for the MCP server (Rovo/AI permissions in the site administration) and that the user has a Jira license on that site.
- **Endpoint 404**: if Atlassian changes the route, the current one is documented on their Remote MCP Server page; update `url` in `.mcp.json`.
