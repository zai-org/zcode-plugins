# Browser Bridge

[中文](README_CN.md)

Browser Bridge connects ZCode to the Chrome session you already use. Its 15 MCP tools can list tabs, read page text, take screenshots, navigate, click, scroll, type, and run page JavaScript while keeping your existing sign-in state. Version **0.6.0-rc.2** is a community release candidate.

## Requirements and installation

- Node.js 18 or newer must be available as `node` on the client's PATH.
- Google Chrome 116 or newer. The extension uses Manifest V3.
- No separate model account, API key, paid service, or Chrome remote-debugging flag is required by the plugin. ZCode uses the model/provider configured by its user.

1. Install and enable **Browser Bridge** in ZCode's plugin marketplace, then start a new session. If the submission is still under review, use a locally built marketplace from this repository instead of assuming it is publicly available.
2. On activation, the plugin prepares a loopback bridge and a stable extension folder. When the extension has not connected and the guide has never been shown, a setup page opens once. You can open it explicitly with `/cc-browser-setup`.
3. In Chrome, open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**. Select the extension directory shown by the guide, normally `~/.browser-bridge/extension`. On Windows this is `%USERPROFILE%\.browser-bridge\extension`. On macOS, use Cmd+Shift+G in the file picker to paste the path; on Windows, use the address bar or Ctrl+L.
4. Wait for the extension's connected indicator. In ZCode, ask: **List the tabs in my Chrome browser.** A real tool response confirms the client-to-browser path. A connected setup page alone does not confirm the client call.

The extension is supplied as source and is **not installed automatically** or listed by this submission in the Chrome Web Store. A successful guide opening is remembered separately from user completion. New sessions, elapsed time, and version changes do not reopen an already shown guide. An already connected extension also suppresses automatic opening. Failed opening attempts use bounded retry backoff. `/cc-browser-setup` always permits an explicit retry.

## Examples and controls

- “Read the current page and summarize it.”
- “Take a screenshot of the current tab.”
- “Fill this form, then wait for me to approve submission.”

The extension popup shows connection status and lets you edit the bridge address or pause browser control. Pausing is never automatically reversed. Browser actions use your signed-in session and can change real websites; ask the agent to wait for your confirmation before submitting forms, sending messages, buying, or deleting. The plugin does not add an independent confirmation dialog to every action.

The bridge follows the active browser tab; changing active tabs while a sequence is running can change its target. Keep the intended tab selected. Only one connected Chrome extension is supported per bridge instance.

## Permissions, data flow, and side effects

- **Chrome permissions:** `debugger`, `tabs`, `scripting`, `storage`, and `<all_urls>`. These enable page screenshots, tab inspection, DOM interaction, and script execution. Chrome may display its debugger banner. Browser-internal and otherwise restricted pages remain limited by Chrome.
- **Local processes:** MCP activation starts `server/mcp-stdio.js`. An auto-discovered `SessionStart` hook runs `hooks/session-start.js` to prewarm the same launcher. It reuses a healthy bridge and may start a detached Node bridge that remains alive after the client exits. On macOS/Windows, the first guide can open the system browser; explicit setup actions can open Chrome's extension manager or reveal the extension directory. No shell command or path is supplied by arbitrary web-page input.
- **Local writes:** by default, managed extension files, locks, completion/display state, and logs are written under `~/.browser-bridge/`. Standalone manual setup may also use a temporary guide-session file and `.onboard-state.json` inside the plugin directory. Chrome extension settings are stored with `chrome.storage`. Unmanaged files are preserved during extension synchronization; an unrecognized existing extension folder is rejected rather than overwritten.
- **Network:** default bridge traffic is loopback HTTP/WebSocket on `127.0.0.1:8765`; the guide binds loopback ports starting at `8791`. Chrome navigates to sites requested by the agent. There is no analytics endpoint, plugin cloud, runtime package download, or plugin-specific model/API request. The package includes the `ws` source dependency. ZCode may send tool results, including page text, tab metadata, screenshots, and evaluated JavaScript results, to the model/provider configured in the client. Explicitly setting `BRIDGE_URL` to another endpoint sends tool traffic to that endpoint; automatic local setup is disabled for remote/HTTPS endpoints.
- **Trust:** localhost access is not per-user authentication. Other trusted local processes may call the bridge. Host/Origin checks reject web-page callers and protect against DNS rebinding; they do not isolate untrusted local programs. Use this on a trusted workstation. Guide API calls additionally require a short-lived session token.
- **Credentials:** no website passwords or cookies are exported by a dedicated credential endpoint, but requested page content or JavaScript results can contain sensitive information. Choose the pages and actions you allow accordingly.

To stop a bridge, identify the process using the PID and logs under `~/.browser-bridge/state/` and `logs/` and stop only that verified process. Disabling the plugin prevents future client activation; it does not terminate an already detached bridge automatically.

## Configuration and troubleshooting

`BROWSER_BRIDGE_HOME` changes the managed directory. `BRIDGE_PORT` or `BRIDGE_URL` selects a bridge endpoint; conflicting or invalid values fail explicitly. If using another local port, update the extension popup's WebSocket address to match. A port owned by another application is reported and the owner is not killed.

If setup is interrupted, run `/cc-browser-setup`. If Node is missing, install Node.js and restart the client so it sees `node` on PATH. The plugin does not install a runtime. For browser control failures, check Chrome is running, the extension is enabled/connected, the intended tab is active, and control is not paused.

## Validation scope

Run `node --test tests/*.test.js` from this plugin directory. Package smoke checks use isolated homes/ports. Browser-opening regressions use a fake `open` command on macOS and are skipped on other platforms.

Earlier macOS/ZCode/Chrome builds exercised the native guide and real browser tools. The current source includes the repeated-guide-opening fix and regression tests. Windows startup, packaging, and guide behavior have separate prior background checks. This release candidate's final native ZCode install/update/restart acceptance remains outstanding; it does not claim universal client or no-system-Node compatibility. Review the PR for exact current validation results.

## License and provenance

Browser Bridge source, documentation, and original icons: Apache-2.0, copyright 2026 lihytaihe-lang; see [LICENSE](LICENSE). The unmodified `ws` 8.22.0 source in `server/vendor/ws/` is MIT licensed, with its original license retained. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Google Chrome and ZCode are separate products governed by their own terms; this community plugin is not an official Google or Z.ai product.
