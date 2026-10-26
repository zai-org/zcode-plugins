---
name: unreal-mcp
description: "Use this skill to perform actions inside an Unreal Engine project via a live-editor MCP connection. Trigger when the user wants to change, query, or run something in their Unreal Engine project, not for conceptual or docs questions. Concrete triggers: spawn/move/duplicate/transform actors in a level, open a `.uproject`, add things around a PlayerStart, create or edit a Blueprint/Widget/Material/Niagara/Control Rig/Sequencer/Behavior Tree/GAS ability, read or write properties on actors (e.g. `bIsLocked` on `BP_DoorActor`), Live Coding recompile after editing C++ (`AActor`, `UMyComponent::Method`, `UPROPERTY`), or modify Static/Skeletal Mesh assets. Treat as Unreal context even without the word \"Unreal\": asset prefixes `BP_`, `WBP_`, `M_`, `MI_`, `NS_`, `CR_`, `SK_`, `SM_`, `ABP_`; UE C++ types/macros; `.uproject`; Content Browser; Outliner; PlayerStart; \"in my game\" plus UE signals. Skip for: pure conceptual/docs questions, Unity, Godot, or unrelated uses of \"blueprint\"/\"sequencer\"/\"widget\"."
---

# Unreal MCP

This ZCode plugin connects to a separately installed Unreal Editor through the `unreal-mcp` MCP server. A configured connection does not prove the editor is running: verify with a read-only call before acting. The server exposes hundreds of tools across 30+ toolsets (actors, blueprints, materials, Niagara, Sequencer, Control Rigs, GAS, automation tests, Live Coding, and more) registered through Unreal's `ToolsetRegistry`. Use it to inspect and mutate live editor state instead of telling the user to do it manually.

You don't need to memorize tool names. The flow below has you discover them on demand.

The connection can appear as `unreal-mcp-proxy` when the engine's optional proxy is installed. Use that connection for Unreal tools. The proxy keeps Unreal's native tool definitions; it does not introduce replacement discovery or dispatch tools. See `references/setup.md` for installation.

## Before tool discovery: prepare the editor connection

For opening a project, first use the host shell to locate and launch the editor; MCP runs inside Unreal and cannot bootstrap a stopped editor. If tools are missing, the endpoint is unavailable, or Unreal only shows the Project Browser, follow [references/startup.md](references/startup.md) before giving up. Do not ask the user to launch Unreal manually when the available local or remote shell can do it. Reuse the intended running project when possible.

Startup, project selection, enabling the required plugins, bounded readiness checks, and client reconnection are preparation steps. Follow the user's time and initialization limits; never silently turn a short smoke test into an engine installation or C++ build. A successful process launch or listening port alone is not a successful MCP connection.

## Once connected: discover the tool you need, then dispatch it via `call_tool`

Tool search is on by default, so the MCP server advertises only three meta-tools for the whole session: `list_toolsets`, `describe_toolset`, and `call_tool`. Tool names like `BlueprintTools.create` or `SequencerTools.create_level_sequence` are **not in `tools/list`**. They are dispatched server-side through `call_tool` and never registered as native MCP tools. This is deliberate. It keeps your context window small and the prompt cache warm.

When you start work:

1. Call `list_toolsets` to see what's registered, then `describe_toolset` on the candidate(s) to read their tool schemas. If you already know which toolset you need (the user said "make a Blueprint" → the Blueprint toolset), skip the listing and go straight to `describe_toolset` to confirm the available tools and their signatures.
2. Invoke the tool with `call_tool`: pass the discovered toolset identifier as `toolset_name`, the short tool name as `tool_name` (for example `get_current_level`, not a toolset-prefixed full name), and an `arguments` object matching the schema you just read. Preserve the exact identifiers returned by discovery. The result comes back on the same turn. No extra round-trip needed.
3. Top-level dispatch (omitting `toolset_name`) is reserved for tools registered directly on the MCP server and is rejected for `call_tool` itself.

Missing tools do not prove that the editor is stopped. Check the configured `unreal-mcp` or `unreal-mcp-proxy` connection and follow `references/operations.md`. A proxy can stay connected while Unreal is unavailable, and a client can keep a stale catalog after recovery. `unreal_mcp_status` reports the proxy's session state, not current reachability. Verify recovery with a read-only Unreal tool call. For first-time configuration, follow `references/setup.md`.

## Compatibility and quick smoke tests

- Some UE versions may require explicit values even for parameters described as optional or defaulted. Follow the discovered schema and concrete validation error; supply a documented default or a task-appropriate value and retry once. Do not blindly fill structure parameters with `{}`. After a timeout or ambiguous mutation result, read back state before retrying to avoid duplicate changes.
- Blueprint node type IDs can depend on editor language. Discover actual IDs instead of hardcoding English names. For localized editors, prefer node-level creation and pin-connection APIs. If graph DSL writing fails or reading returns empty for a known nonempty graph, fall back to node APIs, compile, and verify the graph. Report the observed version/language-specific limitation rather than declaring all non-English editors unsupported.
- For a short smoke test, describe only the toolsets needed for the requested checks. Use an independent test project or map, verify project identity separately from the map path, and honor the time budget. `/Engine/Maps/Templates/Template_Default` alone does not mean no project is open. Creating then deleting an Actor may leave the map dirty; verify save/dirty state before claiming it is restored.
- Finish by stopping only PIE started by this task and saving the requested test assets. Leave the editor open for inspection unless closing it was requested. If it becomes unresponsive, report that observation; CPU activity or a Crash Reporter process alone does not establish the cause. Revalidate process identity before any separately authorized termination, rather than reusing an old PID.
- Distinguish direct HTTP probe success from ZCode plugin integration success. Only a successful call through ZCode's actual MCP tools verifies that client path; label unexecuted checks as untested.

## Safety rules

Follow these rules to protect live editor state.

- **Save first, then save again.** Tell the user to save the project (or call `AssetTools` save APIs) before any bulk change, and again after. MCP edits are not always undoable, especially across compilation boundaries. Treat anything that touches multiple assets as a destructive operation that needs a recovery point.
- **Wait for compilation.** If C++ or shader compilation is in flight, your tool calls will hang or fail in confusing ways. To rebuild C++ from the running editor, drive `LiveCodingToolset.CompileLiveCoding` and wait on its result instead of asking the user to switch to the IDE. That tool blocks until the compile actually finishes and surfaces MSVC diagnostics.
- **Control concurrent calls.** MCP accepts concurrent requests and handles dispatch synchronization. Asynchronous tools can overlap, and request order does not guarantee execution or completion order. Serialize dependent calls and mutations that can affect the same asset or editor state. Use parallel calls only for independent work when the tools support safe overlap. Multiple agents can use one editor, but their conflicting changes can cause adverse effects.
- **Always check the result.** Blueprint compilation, widget creation, material edits: many tools return a status that flips between success and failure with no exception thrown on the wire. Read the response before moving on. Treat anything that isn't an explicit success as a stop.
- **Mind PIE.** Editor-only tools (asset creation in particular) behave differently while Play-in-Editor is active. If a result looks wrong, check whether PIE is running. Stop it if this task started it; otherwise coordinate before interrupting the user's running session.

## Project skills

A project or plugin can register **Agent Skills**: named bundles of instructions that capture workflow knowledge the agent wouldn't otherwise have (a project's naming conventions, folder layout, required setup steps, or the canonical sequence for a multi-step task). These are separate from the toolsets themselves and are reached through the agent skill toolset (`AgentSkillToolset`), not through `list_toolsets`.

Check for them the same way you discover tools, and do it whenever you start unfamiliar work in a project rather than just once:

1. Call `AgentSkillToolset.ListSkills` (through `call_tool`) to see what skills the project registers. Each entry carries a short description of what it covers and when it applies.
2. If a skill's description looks relevant to what the user asked, call `AgentSkillToolset.GetSkills` on it to load the full instructions, then follow them.
3. If nothing matches, fall back to the tool-discovery flow above.

A relevant project skill's instructions take precedence over your generic defaults: it exists precisely because the project's way of doing something differs from the obvious one. (Authoring or editing these skills is a separate task covered by the `unreal-skill` companion skill below.)

## Reference files

- `references/setup.md`: first-time MCP server setup, client configuration, and optional proxy installation.
- `references/operations.md`: console commands, settings, proxy recovery, and troubleshooting for missing tools or failed calls.

## Companion skills

- **`create-toolset`**: use when authoring a new toolset or adding tools to an existing one. Covers design principles, C++ and Python conventions, registration, error handling, and testing.
- **`unreal-skill`**: use when creating, updating, or reviewing an Agent Skill. Covers what makes a good skill and how to structure one.
