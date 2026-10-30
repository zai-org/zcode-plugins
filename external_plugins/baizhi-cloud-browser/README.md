# Baizhi Cloud Browser for ZCode

[中文](./README_CN.md)

Connect ZCode to Baizhi Cloud Browser's MCP endpoint to check credentials and manage browser resources. This is a community plugin for a separate service from Baizhi Agent Toolkit. It does not itself operate pages or change ZCode's built-in browser. Page interaction requires a separately compatible CDP client.

## Setup

1. Install and enable this plugin in ZCode. Open **Settings → Plugins → Baizhi Cloud Browser → Advanced information → Configuration**, then set `Capy API Key` to your own Baizhi Cloud Browser API Key without a `Bearer` prefix and save. The connector constructs the authorization header.
2. Restart the session if needed. Check that the server and `browser_auth_check` tool appear. Ask the agent to call that MCP tool to check the current account; approve the individual tool request when prompted. `browser_pricing` returns current pricing without starting a browser.
3. Only create a browser session when needed and after reviewing its cost. Use a stable, unique `idempotency_key` and a bounded `max_seconds`; if the result is uncertain, retry the same request with the same key. Once the session is `ready`, `browser_control` provides a short-lived, one-use CDP URL for a separate compatible client such as Playwright. Keep that URL private. The plugin does not attach ZCode’s built-in browser to it.
4. If you created a session, call `browser_stop_session` when the task ends, fails, or is cancelled, then check `browser_get_session` until it reports `released`. If release cannot be confirmed, report that state and retain the session reference for recovery. Check charges and settlement separately. Disconnecting the plugin does not stop a cloud session.

## Dependencies and side effects

- Requires a Baizhi Cloud Browser account, API key and network access to `https://capybrowser.app.baizhi.cloud/mcp`; the key is sent to that service as an Authorization header. ZCode handles plugin settings; consult its documentation for credential storage and access controls.
- Tools can create, modify and delete cloud resources. Session creation and runtime may incur charges. This plugin adds no commands, hooks, scripts, or local file writes of its own.
- This plugin does not include or install a CDP page client. Verify compatibility before using one; avoid placing a control URL in logs or public chat.

Documentation: [Baizhi Cloud Browser](https://capybrowser.app.baizhi.cloud/docs/installation.md). Plugin files are licensed under Apache-2.0; the hosted service has its own terms.

## Maintenance and support

[Baizhi Cloud Browser (CapyBrowser)](https://baizhibrowser.cloud/) · [Plugin source](https://github.com/ctcbyzx/zcode-plugins/tree/codex/baizhi-cloud-browser-mcp/external_plugins/baizhi-cloud-browser) · [Service console](https://capybrowser.app.baizhi.cloud/).

Maintained by [ctcbyzx](https://github.com/ctcbyzx), a contributor to [Chaitin's public integration guides](https://github.com/chaitin/baizhi-cloud-browser). See [other browser integrations](https://github.com/ctcbyzx/baizhi-cloud-browser).

For setup help, use the [integration issue tracker](https://github.com/ctcbyzx/baizhi-cloud-browser/issues) and include the client version and a redacted error. Use the service console for private account or billing questions.
