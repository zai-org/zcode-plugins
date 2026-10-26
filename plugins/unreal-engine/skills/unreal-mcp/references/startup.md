# Prepare and launch Unreal Editor

This is ZCode startup guidance supplementing Epic's official MCP skill. Use the host shell for preparation, then the official MCP tools for live editor operations. Do not invent an `unreal` CLI or assume the optional MCP proxy launches the editor.

## 1. Identify the machine, project, and engine

- Run discovery on the machine where Unreal is installed. A Mac shell cannot launch the Windows editor without a working remote execution channel. The MCP endpoint must also be reachable from the agent's execution environment; see [setup.md](setup.md).
- Inspect running editor processes and their command lines, the configured endpoint, and any project path in the task/workspace. A Project Browser window is not a loaded project. Do not close another editor or replace its project to make a port available.
- Prefer an explicitly selected `.uproject`, then the current workspace or a clearly identified existing test project. Search likely project directories narrowly; do not infer that no projects exist from one shallow search. Ask only when candidates are ambiguous and cannot be resolved from context.
- Read `EngineAssociation` from the project. On Windows inspect `HKCU:\Software\Epic Games\Unreal Engine\Builds` for custom build registrations and installed engine locations/launcher records. On macOS inspect installed engines (commonly `/Users/Shared/Epic Games/`) and any explicit source checkout. Verify the actual executable and `Engine/Build/Build.version`; do not hardcode a version or silently convert a project to a different engine.
- Windows GUI executable: `<EngineRoot>/Engine/Binaries/Win64/UnrealEditor.exe`. macOS: `<EngineRoot>/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor`. Linux: `<EngineRoot>/Engine/Binaries/Linux/UnrealEditor`. These are engine-provided executables, not a separately installed agent CLI.
- If the engine is missing, report that prerequisite and use Epic's official installation path only when installation is in scope. Do not install/update engines, download assets, or build C++ as an incidental connection repair.

## 2. Resolve a missing project

If the task permits creating a test project, create an isolated Blueprint-only Blank project using the installed editor's Project Browser and available desktop controls. Use a writable, task-specific directory and disable Starter Content. Another option is a verified installed content-only template: inspect its instructions and contents first; do not blindly copy C++ templates or invent project-creation CLI flags.

If no suitable project exists and the user forbids initialization, stop with that specific blocker. If creation is allowed but no supported automation route is available, request the missing project or minimal user action. Do not call this a limitation on opening existing projects from the command line.

For smoke tests, operate only in a dedicated test project or test map. Never save the current business map under a test name as a shortcut. Honor a total time limit; separate setup timing from test timing only if the user permits it.

## 3. Enable MCP and launch the project

Read [setup.md](setup.md) to enable `ModelContextProtocol` and `AllToolsets` in the intended `.uproject`. Verify that this engine installation actually contains both plugins. Preserve unrelated JSON fields/plugin entries and back up files before editing. Enabling plugins may require restarting that project. Do not terminate an editor with unsaved work; use a supported save/close flow or get the user's help if its state cannot be established.

For this session, pass `-ModelContextProtocolStartServer`. For persistent startup, use the per-user configuration documented in setup.md. Respect the configured port; check its owner before starting another server. Do not claim that an open port belongs to the intended project.

Windows PowerShell example (replace both paths with discovered, verified paths):

```powershell
$editorExe = 'D:\ActualEngine\Engine\Binaries\Win64\UnrealEditor.exe'
$projectFile = 'D:\ActualProject\TestProject.uproject'
if (!(Test-Path -LiteralPath $editorExe) -or !(Test-Path -LiteralPath $projectFile)) {
    throw 'Verified editor and project paths are required'
}
$editorProcess = Start-Process -FilePath $editorExe -ArgumentList ('"{0}" -ModelContextProtocolStartServer' -f $projectFile) -PassThru
$editorProcess.Id
```

macOS shell example, using the discovered app bundle:

```sh
open -n "$editor_app" --args "$project_file" -ModelContextProtocolStartServer
```

Use a new instance only when the intended project is not already open. For Linux, launch the verified editor binary with the quoted project path and the same flag, detaching it from the short-lived shell as appropriate. If a nondefault port is needed, use the documented `-ModelContextProtocolPort=<port>` and match the client's endpoint.

Launching the GUI executable in the user's interactive desktop session displays an editor window. A service/SSH session on Windows may not share that desktop; do not promise a visible window unless using the interactive session. Do not substitute `UnrealEditor-Cmd.exe`, `-NullRHI`, or a headless job when the user expects a visible editor.

If the project is already open with the plugins enabled but its server is stopped, use the available editor console to run `ModelContextProtocol.StartServer` instead of launching a duplicate instance. If no console/control route is available, explain the specific access limitation.

## 4. Wait, reconnect, and verify

- Observe the launched PID, recent `<Project>/Saved/Logs/` output, and the configured listener with bounded polling (for example every 3 seconds for up to 90 seconds, shortened to the user's remaining budget). Stop immediately on process exit or an explicit startup error. Shader compilation may take longer; report the actual pending state without killing unrelated processes or pretending the connection succeeded.
- An HTTP GET error or a missing native tool is not conclusive: an MCP endpoint may reject plain GET, and the client may have a stale tool catalog. Use the client MCP status and a real MCP initialization/tool call when available.
- Once the server is ready, reconnect/reload the existing Unreal plugin connection using the host's supported control. Do not invent a reconnection command, register a duplicate server, or edit client credentials. If the host exposes no reconnect action, ask the user to reconnect the plugin or start a fresh task, explaining that the server is ready but the session still lacks tools.
- Discover `list_toolsets` / `describe_toolset` and perform a schema-backed read-only call that returns the actual project, engine version and current world where available. Record fields that cannot be obtained as unknown; do not infer them from a window title. Only then begin mutations in the verified test target.
- Retry a failed step at most once during a quick smoke test. If preparation cannot establish the connection within the budget, stop dependent tests and report the concrete blocker: engine missing, project missing, startup error, plugins missing, server unavailable, or client tools unavailable. Include relevant log/error evidence.

Keep prepared test assets for inspection. Stop Play mode only if this task started it; leave the editor available for the user. Do not claim scene, save, or Play tests passed merely because startup succeeded.
