# First-Time MCP Server Setup

Read this for first-time MCP configuration or optional proxy installation. Steps 1-3 configure the bundled direct HTTP connection.

The goal is three things:
1. Enable the `ModelContextProtocol` and `AllToolsets` plugins in the project.
2. Make the editor auto-start the MCP server on launch.
3. Enable the ZCode plugin and confirm its endpoint.

Identify the intended `.uproject` from the workspace or user request before editing it; ask only if the target is ambiguous. Explain any required project changes.

If the editor is not running or only shows the Project Browser, follow [startup.md](startup.md) to locate the project and launch the GUI editor from the host shell.

## 1. Enable the plugins in the `.uproject`

Two plugins are required. `ModelContextProtocol` is the server and transport; `AllToolsets` provides the tools. With only `ModelContextProtocol` enabled the server starts but exposes no tools.

Open the project's `.uproject` file. In the `Plugins` array, ensure both entries:

```json
{
  "Name": "ModelContextProtocol",
  "Enabled": true
},
{
  "Name": "AllToolsets",
  "Enabled": true
}
```

If the array doesn't exist, create it. If either entry exists with `"Enabled": false`, flip it to `true`.

`AllToolsets` is an editor-only aggregator with `EnabledByDefault` off, so it must be enabled explicitly. To expose only a subset of tools, enable the specific toolset plugins you want instead of `AllToolsets`.

## 2. Enable auto-start

The default is for the MCP server to stay stopped. To start it manually in a session, run `ModelContextProtocol.StartServer` from the editor console.

To start it automatically on every editor launch, add the snippet below to the per-user editor config file:

`<Project>/Saved/Config/<Platform>Editor/EditorPerProjectUserSettings.ini`

This is the file the editor writes when you toggle the setting in Editor Preferences. It is per-user and not source-controlled.

```ini
[/Script/ModelContextProtocolEngine.ModelContextProtocolSettings]
bAutoStartServer=True
```

Optional overrides if the defaults conflict with another local service:

```ini
ServerPortNumber=8000
ServerUrlPath=/mcp
```

A command-line alternative also works: pass `-ModelContextProtocolStartServer` (and optionally `-ModelContextProtocolPort=<port>`) to the editor. Prefer the `.ini` because it's persistent.

## 3. Connect from ZCode

Enable the Unreal Engine plugin in ZCode. It already declares an HTTP MCP connection;
do not generate a second project `.mcp.json` entry for the same editor.
The plugin's `endpoint` user setting defaults to `http://127.0.0.1:8000/mcp`.
When changing the editor port, update that setting and reconnect/reload the plugin.
Do not edit the installed plugin cache: updates replace it.

The address is resolved from the machine running the ZCode agent/MCP client.
For SSH, WSL, or Docker workspaces, loopback is that environment, not the desktop.
Do not expose UE's unauthenticated MCP server to a public interface. Establish an
explicit protected connection when the editor and agent run on different machines.
With multiple editors, inspect the configured port and query project identity with
a discovered read-only tool before mutating anything; never assume the active window
is the connected project. Do not stop an editor or server belonging to another task.

This plugin uses direct HTTP; it does not bundle Epic's optional native proxy or UE.
If the user explicitly chooses a separately configured official proxy, disable this
plugin's direct MCP connection before adding it, while retaining the skills.
The proxy must come from the user's UE installation and is not required here.

## Verifying

After the editor is running with the plugin enabled and auto-start on:

- The Output Log shows MCP server startup messages.
- `list_toolsets` (one of the three tool-search meta-tools) returns successfully.
- ZCode reports the plugin MCP connection as connected.

A connected proxy or visible cached tools do not prove that Unreal is reachable. Confirm with a successful read-only Unreal tool call.

If any of these fail, see `operations.md` for recovery commands.
