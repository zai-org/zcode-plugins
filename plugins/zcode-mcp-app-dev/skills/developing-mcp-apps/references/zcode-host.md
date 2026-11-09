# ZCode host extensions

Standard initialization, tool notifications, resources, messages, size changes and model context use the official MCP Apps SDK. This reference covers only the extra ZCode conventions.

## Install manifest

Use `.zcode-plugin/plugin.json`. `mcpServers.<server>` declares the process; `${ZCODE_PLUGIN_ROOT}` locates installed files, `${ZCODE_PROJECT_DIR}` is the workspace, and `${ZCODE_PLUGIN_DATA}` is plugin-owned writable data. Declare editable values in `userConfig` and substitute `${user_config.<key>}` in server configuration. Sensitive values belong in environment/headers, not visible arguments.

```json
{
  "name": "my-mcp-app",
  "version": "0.1.0",
  "description": "An interactive workspace tool",
  "description_i18n": { "en": "An interactive workspace tool", "zh-CN": "交互式工作区工具" },
  "mcpServers": {
    "app": {
      "type": "stdio",
      "command": "node",
      "args": ["${ZCODE_PLUGIN_ROOT}/dist/server.mjs"],
      "cwd": "${ZCODE_PROJECT_DIR}"
    }
  },
  "ui": {
    "surfaces": [
      {
        "id": "editor",
        "title": { "en": "Editor", "zh-CN": "编辑器" },
        "server": "app",
        "resourceUri": "ui://my-mcp-app/editor.html",
        "availability": "session"
      }
    ]
  }
}
```

`ui.surfaces` is optional. Each id must be unique within the plugin; `server` names a declared server. A session panel can be opened manually. Tools can target it with `_meta.ui.surface`. Tools use `_meta.ui.resourceUri` and `visibility: ["model", "app"]` as appropriate; page-only tools use `["app"]`.

## Capabilities and state

| Host capability                           | Meaning                                                                                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `experimental["zcode/widgetState"]`       | `ui/set-widget-state` with `{ widgetState }`, empty result. Initial value is in `getHostContext()["zcode/widgetState"]`.                      |
| `experimental["zcode/resourceSubscribe"]` | Same-server `resources/subscribe` and `resources/unsubscribe`; register resource update/list-change notification handlers before subscribing. |
| `experimental["zcode/surface"]`           | Contains the current persistent panel id when applicable.                                                                                     |
| `experimental["zcode/csp"]`               | Indicates supported host-specific CSP behavior. Consult the returned flags before requesting it.                                              |

Widget state belongs to host memory and can survive a view remount within the session; it is not guaranteed after application restart and is not model context. Use `updateModelContext` to send context to the next conversation turn. Do not replace widget state with localStorage during a migration: browser storage has a different lifetime and isolation scope.

Use `getHostContext()` for theme, locale, display mode and standard style variables; react to `onhostcontextchanged`. If initial tool notifications arrive while UI code loads, retain them in the already-connected page client. Missing optional features can disable the corresponding UI action; required features should produce an explicit error.

## Resources and compatibility

Bundle UI code offline and serve it through the plugin's MCP resources. The current host limits an HTML resource to 4 MiB and a resource read to 8 MiB of decoded content; split large code or binary assets accordingly. Preserve third-party notices and required data/worker/WASM files.

Keep the official SDK version in the build lockfile. The supported protocol and advertised capabilities determine runtime compatibility; a plugin release number need not equal the application release number. Test both the minimum host you support and the current host before claiming that range. This repository does not currently enforce a minimum host-version manifest field.
