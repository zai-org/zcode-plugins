# ZCode Plugin Development Tutorial

This is an executable tutorial for developers and Agents. It takes you from the example plugin through the manifest, components, local testing, marketplace registration, and release checks so the result is installable, verifiable, and publishable.

## 0. How to use this document

- **Creating a plugin**: follow Section 1 for the shortest path, then read only the relevant reference in Sections 2–4.
- **Changing an existing plugin**: inspect its manifest, README files, and component directories first; then load only the section for the component you are changing.
- **Looking up a field or protocol**: jump directly to Section 2 (fields), Section 3 (complete JSON), or Section 4 (Hooks).
- **Agent reading order**: read this section, Sections 1.1–1.4, and the definition of done first. Load later reference sections only when the task reaches them.

## 1. The shortest path: create and verify a plugin

### 1.1 Human quick path

1. Copy `plugins/example-plugin/` to `external_plugins/<your-plugin-name>/`.
2. Edit `.zcode-plugin/plugin.json` so `name`, `version`, and the description reflect the real capability.
3. Keep the components you need and delete unused samples. Leave at least one command, skill, hook, agent, or MCP server.
4. Write equivalent `README.md` and `README_CN.md` files covering purpose, dependencies, permissions, network access, and side effects.
5. Register the plugin in the root `marketplace.json`. Keep the registration's `name`, `version`, description, and category aligned with the manifest.
6. Run validation, build the distribution, and smoke-test the main capability.
7. Before requesting PR review, declare **UI Plugin** or **Standard plugin** and the affected plugin names in the PR template. Follow the [required classification rules](../CONTRIBUTING.md#declare-the-plugin-type-required).

### 1.2 Agent execution path

1. Read the target plugin's `.zcode-plugin/plugin.json`, both README files, the root `marketplace.json`, and the actual component directories. Treat those files as the repository's sources of truth.
2. Classify the task as creating a plugin, changing a component, or changing documentation. Load only the later sections required by that branch.
3. Change the manifest and component first, then synchronize README files, the marketplace entry, and the version. Every file that enters the installable package requires a version bump in both the manifest and `marketplace.json`.
4. Use the repository's validation commands instead of inferring success from static inspection. Preserve the complete error boundary and stop where a human decision is required.
5. Report changed files, plugin version, validation commands, and results. If local installation or a real run was not completed, say so explicitly.

### 1.3 Change contract

- `.zcode-plugin/plugin.json` is the primary plugin manifest. Component directories and `.mcp.json` are behavior sources.
- The root `marketplace.json` is the catalog source. The manifest and marketplace entry must have the same `name` and `version`.
- Root documentation-only changes do not require a plugin version bump. Any file included in the installable package does.
- Keep secrets, private endpoints, customer data, machine-specific paths, and unreproducible build output out of the plugin.

### 1.4 Definition of done

Plugin development is not complete until all of these are true:

- The plugin directory is unique, kebab-case, and accepted by the validator.
- At least one component is discoverable, and the README explains how a person or Agent can trigger it.
- The marketplace entry and manifest agree on name, version, description, and category.
- `python3 scripts/validate.py` and `python3 scripts/build_dist.py` both succeed.
- The main capability has been run in ZCode, or the missing real-run verification is recorded explicitly.

### 1.5 Directory structure

A plugin is a directory with one manifest at its root and any number of optional component directories:

```text
my-plugin/
├── .zcode-plugin/
│   └── plugin.json    manifest (required)
├── commands/          slash commands, one .md file each
├── skills/            skills, each with a SKILL.md
├── agents/            sub-agent .md files
├── hooks/hooks.json   Hooks configuration
└── .mcp.json          MCP server declarations
```

Use `.zcode-plugin/plugin.json` as the manifest entry point.

### 1.6 The plugin.json manifest

The smallest manifest only needs `name`; all other fields are optional:

```json
{
  "name": "hello-world",
  "version": "0.1.0",
  "description": "My first plugin",
  "skills": "skills",
  "userConfig": {
    "api_key": { "title": "API key", "type": "string", "required": true, "sensitive": true },
    "device": { "type": "string", "default": "iPhone 16" }
  }
}
```

`name` must start with a lowercase letter or number and may contain `.`, `_`, and `-`, with 1–128 characters. `commands`, `skills`, `hooks`, `mcpServers`, and `agents` may be directory names, path arrays, or inline objects. Sensitive configuration values can be referenced from MCP declarations as `${user_config.key}`.

### 1.7 Plugin components

| Component | Format and location |
|-|-|
| **Command** | `commands/*.md`, with YAML frontmatter and a body; use `$ARGUMENTS` for command arguments. |
| **Skill** | `skills/<name>/SKILL.md`; make `name` and `description` precise so the Agent can discover it. |
| **Sub-agent** | `agents/*.md`; frontmatter requires `name` and `description`, and the body is its system prompt. |
| **Hooks** | `hooks/hooks.json`; can run at seven built-in events and follow the plugin's enabled state. |
| **MCP server** | Root `.mcp.json` or manifest `mcpServers`; server keys are automatically namespaced. |
| **UI surface** | Optional `ui.surfaces` in the same manifest. Each surface names a declared MCP server and its `ui://` page resource. It uses the ordinary plugin lifecycle. |

### 1.8 Test a plugin locally

Ordinary plugins and UI plugins share this workflow. A UI surface adds a page to a plugin; it does not create another registration or installation mechanism.

1. Put the installable plugin in `plugins/<name>` and add it to the root `marketplace.json`. Keep marketplace, manifest, and source package versions aligned. For a compiled plugin, put sources in `ui-plugins/<name>` and declare `scripts.build` in its `package.json`. Optional `scripts.stage` copies extra runtime resources to `ZCODE_PLUGIN_INSTALL_DIR`. See the [build contract](MCP_APP_BUILD.md).
2. Run `pnpm install --frozen-lockfile` and `pnpm build`. The build discovers registered source packages and generates `dist/local-marketplace` from **all** root catalogue entries. Ordinary plugins need no source package or build script. Adding your own plugin requires no runner changes.
3. In ZCode, open **Plugin Marketplace → New**, add the absolute path to `dist/local-marketplace`, then install and enable only the plugins you want to test. The generated source is named `zcode-plugins-local` in this repository. The root marketplace uses a reserved official name, so add the generated copy instead.
4. After changes, rebuild, refresh that local source, and reinstall the selected plugin. Refreshing a source updates its catalogue; installed plugins are separate copies. Reinstall also copies local edits when the development version is unchanged. Restart ZCode and verify in a new session. Published versions must still be bumped.

Equivalent CLI steps, from this repository (replace `my-plugin` with your manifest name):

```sh
pnpm build
zcode plugins marketplace add "$PWD/dist/local-marketplace" --scope user
zcode plugins install my-plugin@zcode-plugins-local --scope user
zcode plugins enable my-plugin@zcode-plugins-local --scope user
zcode plugins list --json

# After editing: refresh the catalogue and reinstall only the chosen plugin.
pnpm build
zcode plugins marketplace update zcode-plugins-local
zcode plugins install my-plugin@zcode-plugins-local --scope user
```

Use the same application profile for the CLI and desktop. If using the main application's checkout, its built CLI is `node apps/zcode-cli/packages/cli/dist/zcode.cjs` in place of `zcode`; resolve paths from the appropriate repository. `pnpm dev:desktop` launches the host; it does not register, install, or enable plugins. Check marketplace registration, installed records, enabled state, and the actual session before claiming availability.

The local generator never edits installed plugins or user configuration. `pnpm marketplace:local` regenerates the catalogue copy without compiling. If you already registered another local name/path, retain it with `pnpm marketplace:local --name my-local-plugins --output dist/my-local-plugins` and use that name when refreshing or reinstalling. The `zcode-mcp-app-dev` skill is optional documentation, not a dependency or required installation.

### 1.9 Distribute a marketplace

Put partner/community plugins under `external_plugins/` and officially maintained plugins under `plugins/`, list them in the root `marketplace.json`, and publish the marketplace repository. A teammate can add the repository through **Plugin Marketplace → New** and receive the catalogue, then choose which plugins to install. Hooks run only when the plugin is installed from an official marketplace or a local directory.

The built-in plugins are useful examples: start with a small skill, then add commands, Hooks, and MCP only after the basic path works.

## 2. Field reference

The following tables describe the fields used by the public marketplace and plugin formats. A check mark means required.

### 2.1 marketplace.json

**Top-level fields:**

| Field | Required | Meaning |
|-|-|-|
| `name` | ✅ | Marketplace name; follows the plugin name rules. |
| `description` |  | Marketplace description. |
| `plugins` | ✅ | Array of plugin entries. |
| `pluginRoot` |  | Base directory for resolving relative `source` paths. |
| `allowCrossMarketplaceDependenciesOn` |  | Marketplace names allowed for cross-market dependencies. |

**Fields on `plugins[]` entries:**

| Field | Required | Meaning |
|-|-|-|
| `name` | ✅ | Plugin name. |
| `source` |  | Plugin location; a relative path or a source object. |
| `description` / `version` |  | Display description and immutable version. |
| `category` / `tags` |  | Category string and searchable tag array. |
| `dependencies` |  | Other plugins, written as `name@market` or a same-market name. |
| `strict` |  | Boolean; apply stricter validation to this entry. |

**Source forms:**

| Form | Meaning |
|-|-|
| `"./plugins/hello"` | Relative directory in the same marketplace repository. |
| `{ "source": "directory", "path": "/abs/path" }` | Local absolute directory. |
| `{ "source": "github", "repo": "owner/repo", "path": "subdir", "ref": "main" }` | A subdirectory from a Git repository. |
| `{ "source": "git", "url": "https://...git", "path": "subdir", "ref": "..." }` | A directory from any Git repository. |
| `{ "source": "file", "path": "..." }` | A local manifest file. |
| `{ "source": "url", "url": "https://.../marketplace.json" }` | A JSON manifest fetched over HTTP. |
| `{ "source": "npm", "package": "..." }` | An npm package. |

### 2.2 plugin.json

| Field | Required | Meaning |
|-|-|-|
| `name` | ✅ | Must match `^[a-z0-9][a-z0-9._-]{0,127}$`. |
| `version` |  | Immutable semantic version; defaults to `0.0.0`. |
| `description` |  | One-line description shown in the plugin manager. |
| `author` |  | String or `{ name, email, url }`. |
| `homepage` / `repository` |  | Project and source URLs. |
| `license` |  | License identifier such as `MIT`. |
| `keywords` |  | Search keyword array. |
| `commands` / `skills` / `hooks` / `mcpServers` / `agents` |  | Component declarations as paths, path arrays, or inline objects. |
| `ui.surfaces` |  | Optional page declarations: unique `id`, localized `title`, `server` naming an MCP server, `resourceUri` beginning with `ui://`, optional `icon` and `availability: "session"`. |
| `dependencies` |  | Other plugin dependencies. |
| `userConfig` |  | User-configurable values. |

The runtime records but does not execute `channels`, `lspServers`, `outputStyles`, and `settings`; unsupported fields produce diagnostics without preventing other components from loading.

**`userConfig` fields:**

| Field | Meaning |
|-|-|
| `type` | `string`, `number`, `boolean`, `directory`, or `file`. |
| `title` | Label shown in the UI. |
| `description` | Explanation of the setting. |
| `default` | Default value. |
| `required` | Whether the value is required. |
| `sensitive` | Masked value; sensitive values are not entered directly in the UI. |

### 2.3 Command frontmatter

| Field | Required | Meaning |
|-|-|-|
| `description` | ✅ | Description shown for the command, unless the body is non-empty. |
| `argument-hint` |  | Short hint shown while entering arguments. |
| `allowed-tools` |  | Tools available to the command when the client supports the field. |
| `model` |  | Optional model selector. |
| `disable-model-invocation` |  | Prevent automatic invocation when supported. |

### 2.4 Skill frontmatter

| Field | Required | Meaning |
|-|-|-|
| `name` | ✅ | Skill name; keep it specific and stable. |
| `description` | ✅ | Say what the skill does and when it should be used. Include concrete trigger terms. |

Keep the main instruction path short. Put long, branch-specific material in focused reference files and link them with relative paths.

## 3. Complete JSON examples

### 3.1 plugin.json

```json
{
  "name": "ios-simulator",
  "version": "1.2.0",
  "description": "An iOS simulator development loop: skills, commands, MCP, and Hooks",
  "author": { "name": "Your Name", "email": "you@example.com", "url": "https://example.com" },
  "homepage": "https://example.com/ios-simulator",
  "repository": "https://github.com/your-team/ios-simulator",
  "license": "MIT",
  "keywords": ["ios", "simulator", "mobile"],
  "commands": "commands",
  "skills": ["skills", "extra-skills"],
  "agents": "agents",
  "hooks": "hooks/hooks.json",
  "mcpServers": ".mcp.json",
  "dependencies": ["skill-creator@zcode-plugins-official"],
  "userConfig": {
    "api_key": {
      "title": "API key",
      "description": "Used to access a third-party service",
      "type": "string",
      "required": true,
      "sensitive": true
    },
    "default_device": { "title": "Default device", "type": "string", "default": "iPhone 16" },
    "max_retries": { "type": "number", "default": 3 },
    "verbose": { "type": "boolean", "default": false },
    "workspace_dir": { "type": "directory" },
    "config_file": { "type": "file" }
  }
}
```

`commands`, `skills`, `hooks`, `mcpServers`, and `agents` accept a directory string, a path array, or inline objects. The example demonstrates strings, arrays, and a file path.

### 3.2 marketplace.json

```json
{
  "name": "my-market",
  "description": "An internal team marketplace",
  "pluginRoot": "plugins",
  "allowCrossMarketplaceDependenciesOn": ["zcode-plugins-official"],
  "plugins": [
    {
      "name": "hello-world",
      "source": "./hello-world",
      "description": "A greeting plugin",
      "version": "0.1.0",
      "category": "template",
      "tags": ["starter", "template"],
      "strict": true
    },
    {
      "name": "from-github",
      "source": { "source": "github", "repo": "your-team/another", "path": "plugins/x", "ref": "main" },
      "dependencies": ["hello-world", "skill-creator@zcode-plugins-official"]
    },
    {
      "name": "from-git",
      "source": { "source": "git", "url": "https://git.example.com/x.git", "path": "sub", "ref": "v1.0" }
    },
    {
      "name": "from-dir",
      "source": { "source": "directory", "path": "/abs/path/to/plugin" }
    },
    {
      "name": "from-url",
      "source": { "source": "url", "url": "https://example.com/plugin-manifest.json", "headers": { "Authorization": "Bearer xxx" } }
    },
    {
      "name": "from-npm",
      "source": { "source": "npm", "package": "@scope/plugin" }
    }
  ]
}
```

With `pluginRoot` set, a relative source such as `"./hello-world"` resolves to `plugins/hello-world`.

### 3.3 hooks/hooks.json

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "\"${ZCODE_PLUGIN_ROOT}/hooks/run.sh\" start",
            "async": false,
            "shell": true,
            "timeout": 30,
            "statusMessage": "Initializing…"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "process",
            "command": "node",
            "args": ["${ZCODE_PLUGIN_ROOT}/hooks/check.js"],
            "timeoutMs": 5000,
            "statusMessage": "Checking command…"
          }
        ]
      }
    ],
    "PostToolUse": [
      { "hooks": [ { "type": "command", "command": "echo done" } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "\"${ZCODE_PLUGIN_ROOT}/hooks/cleanup.sh\"", "async": true } ] }
    ]
  }
}
```

Supported events are `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`, and `Stop`. Standard `hooks/hooks.json` is auto-discovered; do not point the manifest at the same file again. A Hook enters a new session only after the plugin is enabled.

### 3.4 .mcp.json

```json
{
  "mcpServers": {
    "ios-simulator": {
      "type": "stdio",
      "command": "node",
      "args": ["${ZCODE_PLUGIN_ROOT}/dist/mcp/server.js"],
      "cwd": "${ZCODE_PROJECT_DIR}",
      "env": {
        "IOS_SIM_ROOT": "${ZCODE_PLUGIN_ROOT}",
        "IOS_SIM_DEVICE": "${user_config.default_device}"
      },
      "enabled": true,
      "timeoutMs": 60000
    }
  }
}
```

`type` may be omitted: `command` defaults to `stdio`, and `url` defaults to `http`. Available variables include `${ZCODE_PLUGIN_ROOT}`, `${ZCODE_PLUGIN_DATA}`, `${ZCODE_PROJECT_DIR}`, and `${user_config.key}`. Server keys are namespaced as `plugin:<plugin-name>:<server-name>`.

A stdio server must speak newline-delimited JSON-RPC on stdin/stdout (one message per line) — not LSP-style `Content-Length` framing. A runnable reference implementation is `plugins/example-plugin/mcp/hello-server.mjs`.

## 4. Hooks guide

This section is for plugin developers who want to inspect, enrich, or enforce behavior during sessions, model requests, tool calls, and stopping. A Hook is a local subprocess protocol: ZCode writes one JSON line to stdin, and the process returns an exit code plus optional JSON on stdout.

### 4.1 Execution order

```text
New session → SessionStart
User submits → UserPromptSubmit → main model
Model requests a tool → PreToolUse → PermissionRequest when confirmation is required → tool execution
Tool succeeds → PostToolUse; tool fails → PostToolUseFailure
Model prepares to stop → Stop → finish, or continue the model with feedback
```

| Event | Matcher | Main use and effect |
|-|-|-|
| `SessionStart` | Matches `source`, commonly `startup|clear|compact` | Initialize the environment and inject project constraints before the first model request. |
| `UserPromptSubmit` | Always runs | Add context before a model call or block the request; do not rewrite the original prompt. |
| `PreToolUse` | Matches the tool name | Allow, ask, or deny a tool; may replace the complete tool input. |
| `PermissionRequest` | Matches the tool name | Runs when a permission result needs confirmation; may allow, deny, or update input/rules. |
| `PostToolUse` | Matches the tool name | Add model-visible context after success; cannot replace the tool output. |
| `PostToolUseFailure` | Matches the tool name | Add recovery advice, diagnostics, or retry constraints. |
| `Stop` | Always runs | Check the result; a block can continue the current model for up to three consecutive rounds. |

### 4.2 Choose a configuration source

| Source | Use it for | How it takes effect |
|-|-|-|
| `~/.zcode/cli/config.json` | All workspaces for the current user | Set `hooks.enabled: true`. |
| `<workspace>/.zcode/config.json` | Versioned team rules | Set `hooks.enabled: true`. |
| Plugin `hooks/hooks.json` | Rules distributed with a plugin | Auto-discovered and follows the plugin enabled state. |
| `.agents/settings.json` / legacy settings | Migration | Read-only display; import explicitly into `.zcode`. |

Hooks execute in this order: user, workspace, then enabled-plugin Hooks. Within a source they run in array order. User and workspace settings are concatenated, not overridden.

Each session captures a Hook configuration snapshot. After editing a file, saving settings, or enabling/disabling a plugin, start a new session before verifying the change.

```json
{
  "hooks": {
    "enabled": true,
    "timeoutMs": 60000,
    "maxOutputBytes": 32768,
    "events": {
      "PreToolUse": [
        {
          "matcher": "Write|Edit",
          "hooks": [
            {
              "type": "process",
              "command": "node",
              "args": ["scripts/check-write.mjs"],
              "enabled": true,
              "timeoutMs": 10000
            }
          ]
        }
      ]
    }
  }
}
```

### 4.3 Build the first plugin Hook in five minutes

The following plugin injects one team constraint when a new session starts. It requires `node` on `PATH`:

```text
context-guard/
├── .zcode-plugin/
│   └── plugin.json
└── hooks/
    ├── hooks.json
    └── context.mjs
```

```json
{
  "name": "context-guard",
  "version": "0.1.0",
  "description": "Inject team development constraints at session start"
}
```

`hooks/hooks.json` is the standard location and is auto-loaded, so the manifest does not need a `hooks` field:

```json
{
  "description": "Context Guard hooks",
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|clear|compact",
        "hooks": [
          {
            "type": "process",
            "command": "node",
            "args": ["${ZCODE_PLUGIN_ROOT}/hooks/context.mjs"],
            "timeoutMs": 5000
          }
        ]
      }
    ]
  }
}
```

```javascript
let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;

const input = JSON.parse(raw);
process.stderr.write("[context-guard] " + input.hook_event_name + "\n");
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: input.hook_event_name,
    additionalContext: "Run type checks and affected tests before committing."
  }
}));
```

1. Add the local marketplace or plugin source in **Settings → Plugin management → Discover**, then install and enable it.
2. Open **Settings → Hooks** and confirm the plugin Hook appears read-only with the expected event, matcher, command, and source path.
3. Start a new session and send a request; the first model request should see the injected constraint.
4. Write diagnostics to stderr. Keep stdout limited to the protocol result so diagnostic text cannot corrupt JSON.

### 4.4 Executors, timeouts, and matchers

| Type | Semantics | Recommendation |
|-|-|-|
| `process` | Runs `command + args[]` directly by argv without a shell; synchronous only. | Prefer for Node, Python, and binary scripts because argument boundaries and portability are explicit. |
| `command` | Sends a complete string to the system shell; supports `shell`, `async`, and `timeout`. | Use when a shell string is required; account for quoting differences across operating systems. |

- `timeoutMs` is in milliseconds; the compatibility `timeout` field is in seconds. `timeoutMs` wins when both exist.
- The root default timeout is 60000 ms, and the default stdout limit is 32768 bytes.
- A Hook may set `enabled: false`; the runtime skips it rather than merely dimming it in the UI.
- `command` with `async: true` is fire-and-forget: the current event continues immediately, and background stdout cannot block, change input, or inject context. Its lifecycle is still recorded.
- `statusMessage` is stored and shown in settings, but is not yet a live runtime status indicator.

**Matcher rules:**

- Empty, omitted, or `*` matches everything.
- A value containing only letters, numbers, underscores, and `|` is an exact name list, such as `Write|Edit`.
- Other characters make it a JavaScript regular expression. An invalid expression is skipped with a diagnostic.
- Tool events match the actual tool name and accept the `Agent` / `Task` aliases.
- `SessionStart` matches `source`; `UserPromptSubmit` and `Stop` do not filter by matcher.

### 4.5 stdin contract

ZCode writes one JSON object followed by a newline to every Hook. The payload keeps ZCode camelCase fields and legacy snake_case aliases so older plugins can continue reading the latter.

```json
{
  "session_id": "session-123",
  "transcript_path": "/tmp/zcode-hook/transcript.jsonl",
  "cwd": "/workspace/demo",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "src/index.ts",
    "content": "..."
  },
  "tool_use_id": "tool-123"
}
```

| Event | Important fields |
|-|-|
| `SessionStart` | `source`, optionally `agent_type` and `model` |
| `UserPromptSubmit` | `prompt` |
| `PreToolUse` | `tool_name`, `tool_input`, `tool_use_id` |
| `PermissionRequest` | `tool_name`, `tool_input`, and `permission_suggestions` when real data exists |
| `PostToolUse` | Structured `tool_response`, tool name, input, and call ID |
| `PostToolUseFailure` | String `error`, `is_interrupt`, and tool fields |
| `Stop` | `stop_hook_active`, `last_assistant_message` |

`transcript_path` points to a temporary JSONL file readable by the current Hook. ZCode removes the temporary directory after the Hook completes; write durable plugin data to `ZCODE_PLUGIN_DATA` instead.

### 4.6 stdout, exit codes, and common responses

Empty stdout means success with no additional effect. Non-JSON stdout is diagnostic only and is not added to model context. The runtime parses only valid JSON whose first non-whitespace character is `{`. Unknown fields are ignored; invalid known fields or event names cause a recoverable Hook failure without stopping later Hooks.

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Only modify files relevant to the current task."
  }
}
```

Top-level `additionalContext` and `additional_context` are also accepted. Prefer `hookSpecificOutput` because the event is explicit.

#### PreToolUse: modify or deny a tool call

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "Redirected to an allowed directory",
    "updatedInput": {
      "file_path": "generated/index.ts",
      "content": "..."
    },
    "additionalContext": "The file was redirected to generated/."
  }
}
```

`updatedInput` is a complete replacement object, not a partial patch; ZCode revalidates it against the tool schema. To deny, return `permissionDecision: "deny"` and a `permissionDecisionReason`. When multiple Hooks aggregate results, deny wins over ask, and ask wins over allow.

#### PermissionRequest: answer a permission prompt

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "deny",
      "message": "Production directories may only be changed by the release flow"
    }
  }
}
```

Set `behavior` to `allow` to allow a request. A decision may also contain `updatedInput` and `updatedPermissions`; the legacy `permissionUpdates` field is accepted. Explicit deny rules, Plan-mode write restrictions, and hard tool limits cannot be bypassed by an allow response.

#### UserPromptSubmit: block the current model request

```json
{
  "continue": false,
  "reason": "Provide a ticket number first",
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "The request was blocked by a team policy."
  }
}
```

#### Stop: continue the main model for one more round

```json
{
  "decision": "block",
  "reason": "The test command and result are still missing."
}
```

`decision: "block"` needs a `reason` or `additionalContext` to continue. For legacy configurations, `continue: true` with additional context is also accepted. After three consecutive continuation rounds, the runtime stops to prevent an infinite loop.

**Exit codes:**

- `0`: success; stdout is parsed.
- `2`: blocking shortcut; produces block/deny on blockable events or one more round on `Stop`.
- Any other non-zero code: recoverable Hook failure; later Hooks still run.

### 4.7 Plugin discovery, variables, and safety

- The manifest entry point is `.zcode-plugin/plugin.json`.
- Standard `hooks/hooks.json` is auto-discovered. The manifest may also reference a relative JSON path, inline object, or an array of both; do not point it at the same standard file twice.
- Plugin processes can read `ZCODE_PLUGIN_ROOT`, `ZCODE_PLUGIN_DATA`, `ZCODE_PLUGIN_ID`, and `ZCODE_PLUGIN_NAME`.
- Plugin path variables in commands and arguments are substituted before execution. Store durable data in `ZCODE_PLUGIN_DATA`, never in the install directory.
- Hooks are read-only in settings and follow the plugin enabled state.

Enabling a plugin grants code-execution trust. Review its source, Hook configuration, and scripts before enabling it.

### 4.8 Create and maintain Hooks in settings

1. Open **Settings → Hooks**.
2. Choose user or workspace scope, then add the event, executor, matcher, command/arguments, timeout, async mode, and status text.
3. Existing `.zcode` Hooks can be viewed, edited, deleted, and toggled individually. Scope cannot be changed in place; delete and recreate the Hook at the target scope.

## 5. Writing for people and Agents

When maintaining plugin documentation, prioritize information that changes execution:

- **Path before background**: state the goal, reading order, and shortest path first; keep field tables, full JSON, and Hook protocol details in reference sections.
- **One action per step**: give each step one verifiable action and its completion condition, command, or expected result.
- **Explicit branches**: document the next action and stop condition for missing dependencies, permission requests, sensitive configuration, and failed validation.
- **One source of truth**: treat repository files and validators as authoritative for paths, commands, and fields; use documentation for conventions, rationale, and traps that the files cannot express.
- **Copyable examples**: examples should be safe to rename, run, or compare against. Keep versions, paths, and categories aligned with the repository.

This organization follows progressive disclosure from the Agent Skills specification and instruction-writing guidance for Agents: load the short path first, then load detailed references only when the task reaches them; make actions, edge cases, and completion criteria checkable.

Official references:

- [Agent Skills Specification](https://github.com/agentskills/agentskills/blob/main/docs/specification.mdx): directory structure, reference files, and progressive disclosure.
- [A practical guide to building agents](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/): clear actions, smaller steps, edge cases, and guardrails.
