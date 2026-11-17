---
name: cc-browser-setup
description: Open or resume the Browser Bridge setup guide; 排障或主动重开 Chrome 连接引导。
---

# Browser Bridge setup / 连接引导

Use this command when the user asks to set up Chrome or reopen the guide. Normal MCP activation and SessionStart prepare the bridge automatically. The guide opens automatically only when it has never been shown and the extension is not connected. Explicit reopening remains available after a successful opening or completion.

Run the installed entry, resolving the actual plugin directory from the host's `ZCODE_PLUGIN_ROOT` variable or this command's installation location:

```sh
node "${ZCODE_PLUGIN_ROOT}/server/onboard.js" --launch
```

The command opens a local guide and outputs its session URL. Do not send that URL/token to third parties or include it in public logs. If browser opening fails, let the user open the local URL privately. Missing Node must be reported; do not install software or modify client configuration without the user's instruction.

Guide the user through Chrome's `chrome://extensions` → Developer mode → Load unpacked → the extension directory displayed by the guide. Loading requires the user's Chrome UI action. After connection, ask the user to try “List the tabs in my Chrome browser” / “列出我当前 Chrome 中的标签页” in ZCode. Do not claim client success from the guide's connected indicator alone. Do not read unrelated tabs while only troubleshooting setup.

For disconnection, check the extension popup's connection and pause state, and ensure its bridge address matches `BRIDGE_PORT`/`BRIDGE_URL`. Never resume a pause automatically. Logs and state normally live under `~/.browser-bridge/`. Do not print page contents, browsing URLs, or session tokens into a public issue.

浏览器引导成功展示过后不会随新会话重复打开。主动运行本命令始终可以重开。缺少 Node 时明确提示；加载 Chrome 扩展由用户完成。引导显示已连接后，仍需在 ZCode 真实调用一次工具才算客户端链路通过。
