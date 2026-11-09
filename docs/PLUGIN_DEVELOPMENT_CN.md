# ZCode 插件开发教程

这是一份面向开发者和 Agent 的可执行教程：从示例插件开始，完成清单、组件、本地测试和市场登记，最终得到一个可安装、可验证、可发布的插件。

## 0. 使用方式

- **新建插件**：按第 1 节完成最短路径，再按需阅读第 2–4 节的字段、JSON 和 Hooks 参考。
- **修改已有插件**：先读第 1.2 节确认组件入口，再读与本次改动直接相关的参考章节。
- **只查字段或协议**：直接跳到第 2 节（字段）、第 3 节（完整 JSON）或第 4 节（Hooks）。
- **Agent 读取顺序**：Agent 直接读仓库根目录 `AGENTS.md`（执行路径 + 契约速记 + 本教程参考章节索引），不从头通读本教程。

## 1. 最短路径：创建并验证插件

### 1.1 给人：快速路径

1. 复制 `plugins/example-plugin/` 到 `external_plugins/<你的插件名>/`。
2. 修改 `.zcode-plugin/plugin.json`，让 `name`、`version` 和描述反映真实能力。
3. 保留需要的组件，删除不需要的样例；至少留下一个 command、skill、hook、agent 或 MCP server。
4. 编写语义一致的 `README.md` 和 `README_CN.md`，说明用途、依赖、权限、网络访问和副作用。
5. 在根目录 `marketplace.json` 注册插件，并保持注册项与插件清单的 `name`、`version`、描述和分类一致。
6. 运行校验、构建和主要能力的冒烟测试。
7. 发起 PR 评审前，必须在 PR 模板中声明 **UI Plugin** 或 **普通插件**，并填写涉及的插件名称，遵循[插件类型必填规则](../CONTRIBUTING_CN.md#声明插件类型必填)。

### 1.2 给 Agent：执行路径

Agent 的执行路径、契约速记和完成标准已拆分到仓库根目录 [`AGENTS.md`](../AGENTS.md)，Agent 从该文件进入，按需返回本教程的参考章节。

### 1.3 变更契约

- `.zcode-plugin/plugin.json` 是插件清单的主入口；组件目录和 `.mcp.json` 是行为来源。
- 根目录 `marketplace.json` 是市场登记来源；插件清单与市场条目中的 `name`、`version` 必须一致。
- 只改仓库根目录文档时不需要 bump 插件版本；只要文件会进入插件安装包，就必须 bump 版本。
- 不把密钥、私有地址、客户数据、机器专属路径或不可复现的构建产物写进插件。

### 1.4 完成标准

在下面条件全部满足前，插件开发不算完成：

- 插件目录名唯一且为 kebab-case，清单可被校验器读取。
- 至少一个组件可被发现，README 能让人和 Agent 知道如何触发它。
- `marketplace.json` 登记项与清单的名称、版本、描述、分类一致。
- `python3 scripts/validate.py` 和 `python3 scripts/build_dist.py` 均成功。
- 已在 ZCode 中运行主要能力，或明确记录尚未完成的真实运行验证。

### 1.5 目录结构

插件就是一个文件夹，根目录放一份清单 `plugin.json`，再按需放各类组件目录（都可选）：

```text
my-plugin/
├── .zcode-plugin/
│   └── plugin.json    清单（唯一必需）
├── commands/          斜杠命令，每个一个 .md
├── skills/            技能，每个子目录含 SKILL.md
├── agents/            子智能体 .md
├── hooks/hooks.json   钩子
└── .mcp.json          MCP 服务声明
```

清单位置：`.zcode-plugin/plugin.json`（推荐）。

### 1.6 清单 plugin.json

最小清单只要一个 `name`；其余全部可选：

```json
{
  "name": "hello-world",
  "version": "0.1.0",
  "description": "我的第一个插件",
  "skills": "skills",
  "userConfig": {
    "api_key": { "title": "API 密钥", "type": "string", "required": true, "sensitive": true },
    "device": { "type": "string", "default": "iPhone 16" }
  }
}
```

`name` 须匹配小写字母/数字开头、含 `. _ -`，1–128 字符。组件字段 `commands/skills/hooks/mcpServers/agents` 可写目录名或内联。敏感配置（sensitive）值可在 MCP 里用 `${user_config.键}` 引用。

### 1.7 插件组件怎么写

| 组件 | 格式与位置 |
|-|-|
| **命令** | `commands/*.md`，YAML frontmatter + 正文；正文用 `$ARGUMENTS` 接收参数。 |
| **技能** | `skills/<名>/SKILL.md`，frontmatter 写清 `name`/`description`，描述越准越易被自动触发。 |
| **子智能体** | `agents/*.md`，frontmatter 必填 `name`/`description`，正文即其 system prompt。 |
| **Hooks** | `hooks/hooks.json`，可在 7 个内置时机执行；插件 Hook 随插件启停，详情见第 4 节。 |
| **MCP 服务** | 根目录 `.mcp.json` 或清单 `mcpServers`，接入外部工具，键名自动加命名空间避免冲突。 |
| **UI 面板** | 同一清单中可选的 `ui.surfaces`，每项关联已声明的 MCP 服务和 `ui://` 页面资源，沿用普通插件生命周期。 |

### 1.8 在客户端本地测试

普通插件和 UI 插件使用同一流程。UI 只是插件多提供一个页面，不需要另一套注册或安装方式。

1. 安装内容放在 `plugins/<name>`，登记到根 `marketplace.json`，保持市场、安装清单和源码包版本一致。需要编译的插件在 `ui-plugins/<name>/package.json` 声明 `scripts.build`；可选 `scripts.stage` 把额外运行资源复制到 `ZCODE_PLUGIN_INSTALL_DIR`。详见[构建约定](MCP_APP_BUILD.md)。
2. 执行 `pnpm install --frozen-lockfile`、`pnpm build`。构建自动发现已登记的源码包，并把根清单中的**全部条目**生成到 `dist/local-marketplace`。普通插件不需要源码包或构建脚本，新增自己的插件也不需要修改根脚本。
3. 在 ZCode **插件市场 → 新增**，填写 `dist/local-marketplace` 的绝对路径，再选择需要测试的插件安装、启用。本仓库生成的来源名称是 `zcode-plugins-local`；根清单使用官方保留名称，因此添加生成的本地副本。
4. 修改后重新构建、刷新该本地来源，再重新安装选中的插件。刷新来源只更新目录，已安装插件是单独的副本；重新安装也会复制开发过程中未改版本的内容。重启 ZCode 并打开新会话验证。正式发布仍必须升级版本。

也可以使用同一套 CLI 命令。在本仓库执行，并把 `my-plugin` 替换为清单中的插件名：

```sh
pnpm build
zcode plugins marketplace add "$PWD/dist/local-marketplace" --scope user
zcode plugins install my-plugin@zcode-plugins-local --scope user
zcode plugins enable my-plugin@zcode-plugins-local --scope user
zcode plugins list --json

# 修改后刷新目录，只重新安装选中的插件。
pnpm build
zcode plugins marketplace update zcode-plugins-local
zcode plugins install my-plugin@zcode-plugins-local --scope user
```

CLI 与桌面必须使用同一应用配置。使用主应用源码时，可用构建后的 `node apps/zcode-cli/packages/cli/dist/zcode.cjs` 替代 `zcode`，路径按所在仓库解析。`pnpm dev:desktop` 负责启动宿主，不负责注册、安装或启用插件。确认可用时要检查来源记录、安装记录、启用状态和实际会话。

生成器不修改用户配置或已安装插件。`pnpm marketplace:local` 可以只重新生成本地副本，不编译代码。已经登记其他名称或目录的本地来源时，用 `pnpm marketplace:local --name my-local-plugins --output dist/my-local-plugins` 保留原身份，后续刷新、安装也使用该名称。`zcode-mcp-app-dev` 只是可选开发说明，不是运行依赖，也不要求安装。

### 1.9 做一个市场分发给团队

把外部维护插件放进市场仓库的 `external_plugins/`，官方维护插件放进 `plugins/`，根目录写 `marketplace.json` 列出条目，推到 GitHub。队友在「插件市场 → 新增」填仓库地址即可获取目录，再自行选择安装哪些插件。源放官方市场或本地目录，Hooks 才会运行。

自带的官方插件是最好的范例（skill-creator 最简，ios-simulator/android-emulator 最完整）。从纯技能插件起步，跑通后再加命令、Hooks、MCP。

---

# 2. 字段速查（开发参考）

下面把示例里四类文件支持的字段逐一列清楚。带 **✅** 的为必填，其余可选。

## 2.1 marketplace.json（市场清单）

**顶层字段：**

| 字段 | 必填 | 含义 |
|-|-|-|
| `name` | ✅ | 市场名，规则同插件名（小写字母/数字开头，含 `. _ -`，1–128 字符）。 |
| `description` |  | 市场描述。 |
| `plugins` | ✅ | 插件条目数组（见下表）。 |
| `pluginRoot` |  | 解析各条目 source 时的基准目录，相对市场根目录。 |
| `allowCrossMarketplaceDependenciesOn` |  | 允许跨市场依赖的市场名数组。 |

**plugins[] 每个条目：**

| 字段 | 必填 | 含义 |
|-|-|-|
| `name` | ✅ | 插件名。 |
| `source` |  | 插件代码在哪。最常用是相对路径字符串，也可写对象（见下表）。 |
| `description` / `version` |  | 展示用描述与版本。 |
| `category` / `tags` |  | 分类（字符串）与标签（字符串数组），便于检索。 |
| `dependencies` |  | 依赖的其他插件，写 `name@market` 或同市场内裸 `name`。 |
| `strict` |  | 布尔；对该条目做更严格的校验。 |

**source 的几种写法：**

| 写法 | 含义 |
|-|-|
| `"./plugins/hello"` | 最常用。相对市场根目录的子目录（插件与市场同仓库）。 |
| `{ "source": "directory", "path": "/abs/path" }` | 本地绝对路径目录。 |
| `{ "source": "github", "repo": "owner/repo", "path": "subdir", "ref": "main" }` | 从 GitHub 仓库取，可指定子目录与分支。 |
| `{ "source": "git", "url": "https://...git", "path": "subdir", "ref": "..." }` | 从任意 Git 仓库取。 |
| `{ "source": "file", "path": "..." }` | 读取一个本地清单文件。 |
| `{ "source": "url", "url": "https://.../marketplace.json" }` | 指向一个 JSON 文件的 HTTP 地址，可带 `headers`。 |
| `{ "source": "npm", "package": "..." }` | 从 npm 包取。 |

## 2.2 plugin.json（插件清单）

| 字段 | 必填 | 含义 |
|-|-|-|
| `name` | ✅ | 插件名，须匹配 `^[a-z0-9][a-z0-9._-]{0,127}$`。 |
| `version` |  | 版本号，缺省 `0.0.0`，建议语义化版本。 |
| `description` |  | 一句话描述，显示在插件管理界面。 |
| `author` |  | 作者，可写字符串或对象 `{ name, email, url }`。 |
| `homepage` / `repository` |  | 主页与仓库地址。 |
| `license` |  | 许可证，如 `MIT`。 |
| `keywords` |  | 关键词数组。 |
| `commands` / `skills` / `hooks` / `mcpServers` / `agents` |  | 各类组件声明，可写目录路径字符串、路径数组或内联对象。 |
| `ui.surfaces` |  | 可选页面声明：唯一 `id`、多语言 `title`、已声明 MCP 服务的 `server`、以 `ui://` 开头的 `resourceUri`，以及可选 `icon` 和 `availability: "session"`。 |
| `dependencies` |  | 依赖的其他插件。 |
| `userConfig` |  | 用户可配置项（见下表）。 |

清单里写了 `channels` / `lspServers` / `outputStyles` / `settings` 这几个字段时，当前运行时**仅登记、不执行**，会给出诊断提示，不影响其它组件加载。

**userConfig 每个配置项：**

| 字段 | 含义 |
|-|-|
| `type` | 类型：`string` / `number` / `boolean` / `directory` / `file`。 |
| `title` | 界面上显示的标题。 |
| `description` | 配置项说明。 |
| `default` | 默认值。 |
| `required` | 布尔；是否必填，界面标「必填」。 |
| `sensitive` | 布尔；敏感值，界面打码且暂不支持在界面直接填写。 |

## 2.3 命令 .md（commands/\*.md 的 frontmatter）

| 字段 | 必填 | 含义 |
|-|-|-|
| `description` | ✅ | 命令描述（或正文非空即可）。 |
| `argument-hint` |  | 参数提示，如 `"[topic]"`。 |
| `allowed-tools` |  | 逗号分隔，限制该命令可用的工具。 |
| `model` |  | 覆盖默认模型。 |
| `skills` |  | 逗号分隔，自动挂载的技能。 |
| `disable-noninteractive` |  | 布尔；是否在非交互模式下禁用。 |

正文里 `$ARGUMENTS` 代表用户传入的全部参数，`$1` / `$2` 代表位置参数。命令名取自文件名，须匹配 `^[a-z0-9][a-z0-9_:-]{0,63}$`。

## 2.4 技能 SKILL.md（skills/<名>/SKILL.md 的 frontmatter）

| 字段 | 必填 | 含义 |
|-|-|-|
| `name` | ✅ | 技能名，缺省取所在目录名。 |
| `description` | ✅ | 触发说明，写清「什么时候用」；最长 1024 字符，越准越易被自动调用。 |
| `when_to_use` |  | 补充触发时机描述。 |
| `license` |  | 许可证。 |
| `metadata` |  | 对象，可放 `author` / `version` 等附加信息。 |

其余非白名单字段（如 `homepage`）会被忽略，不影响加载。

---

# 3. 完整 JSON 用例

## 3.1 plugin.json（插件清单，全字段）

```json
{
  "name": "ios-simulator",
  "version": "1.2.0",
  "description": "iOS 模拟器开发循环：技能 + 命令 + MCP + 钩子",
  "author": { "name": "你的名字", "email": "you@example.com", "url": "https://example.com" },
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
      "title": "API 密钥",
      "description": "访问第三方服务用",
      "type": "string",
      "required": true,
      "sensitive": true
    },
    "default_device": { "title": "默认设备", "type": "string", "default": "iPhone 16" },
    "max_retries": { "type": "number", "default": 3 },
    "verbose": { "type": "boolean", "default": false },
    "workspace_dir": { "type": "directory" },
    "config_file": { "type": "file" }
  }
}
```

说明：`commands` / `skills` / `hooks` / `mcpServers` / `agents` 三种写法均可——目录字符串（如 `"commands"`）、路径数组（如 `["skills", "extra-skills"]`）、或直接内联对象。上例分别演示了字符串、数组与文件路径。

## 3.2 marketplace.json（市场清单，全字段 + 所有 source 写法）

```json
{
  "name": "my-market",
  "description": "团队内部插件市场",
  "pluginRoot": "plugins",
  "allowCrossMarketplaceDependenciesOn": ["zcode-plugins-official"],
  "plugins": [
    {
      "name": "hello-world",
      "source": "./hello-world",
      "description": "打招呼插件",
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

说明：设了 `pluginRoot` 后，相对 `source`（如 `"./hello-world"`）以它为基准解析，即 `plugins/hello-world`。

## 3.3 hooks/hooks.json（钩子配置示例）

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
            "statusMessage": "初始化中…"
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
            "statusMessage": "校验命令…"
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

说明：当前支持 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PermissionRequest`、`PostToolUse`、`PostToolUseFailure`、`Stop`。每个事件下是 matcher 组数组；`process` 使用 argv 执行，`command` 使用 shell 字符串并支持 `async`。标准位置 `hooks/hooks.json` 会自动发现，不要再在 manifest 中重复指向同一文件。插件启用后 Hook 才进入新 session，完整语义见第 4 节。

## 3.4 .mcp.json（MCP 服务，stdio）

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

说明：`type` 可省略——有 `command` 默认 `stdio`，有 `url` 默认 `http`。可用模板变量：`${ZCODE_PLUGIN_ROOT}`（插件根目录）、`${ZCODE_PLUGIN_DATA}`（数据目录）、`${ZCODE_PROJECT_DIR}`（当前工作目录）、`${user_config.键}`（引用 userConfig 的值）。服务键名会自动加命名空间 `plugin:<插件名>:<服务名>` 避免冲突。

stdio 服务必须在 stdin/stdout 上使用换行分隔的 JSON-RPC（每行一条消息），不要使用 LSP 风格的 `Content-Length` 帧。可运行的参考实现见 `plugins/example-plugin/mcp/hello-server.mjs`。

---

# 4. Hooks 开发指南

**适用对象**：希望在会话、模型请求、工具调用和停止阶段自动执行检查、补充上下文或实施策略的插件开发者与项目维护者。本章以 ZCode 当前运行时契约为准，示例可直接改造成项目 Hook 或插件 Hook。
Hook 本质上是一个本地子进程协议：ZCode 向进程的 stdin 写入一行 JSON，进程通过退出码和 stdout JSON 返回结果。Hook 不会获得可直接调用 ZCode 模型的内部对象。

## 4.1 先理解执行顺序

```text
新 session → SessionStart
用户提交 → UserPromptSubmit → 主模型
主模型请求工具 → PreToolUse → 需要确认时 PermissionRequest → 执行工具
工具成功 → PostToolUse；工具失败 → PostToolUseFailure
主模型准备结束 → Stop → 结束，或注入反馈后继续主模型
```

| 事件 | matcher | 主要用途与效果 |
|-|-|-|
| `SessionStart` | 匹配 `source`，常见值为 `startup\|clear\|compact` | 首轮模型请求前初始化环境、注入项目约束或操作说明。 |
| `UserPromptSubmit` | 不参与过滤，即使填写也会执行 | 模型调用前补充上下文，或阻断本次用户请求；不能改写原始 prompt。 |
| `PreToolUse` | 匹配工具名 | 允许、询问或拒绝工具；可完整替换工具输入，替换后会重新校验 schema。 |
| `PermissionRequest` | 匹配工具名 | 只在权限结果需要询问时触发；可允许、拒绝、更新输入或权限规则。 |
| `PostToolUse` | 匹配工具名 | 工具成功后追加模型可见上下文；不能替换工具输出。 |
| `PostToolUseFailure` | 匹配工具名 | 工具失败后追加恢复建议、诊断或重试约束。 |
| `Stop` | 不参与过滤，即使填写也会执行 | 模型准备结束时检查结果；返回 block 可让现有主模型循环继续，最多连续 3 次。 |

## 4.2 选择配置来源

| 来源 | 适用场景 | 生效方式 |
|-|-|-|
| `~/.zcode/cli/config.json` | 当前用户的所有工作区 | 必须在该文件中设置 `hooks.enabled: true`。 |
| `<workspace>/.zcode/config.json` | 随项目版本管理的团队规则 | 必须在该文件中设置 `hooks.enabled: true`。 |
| 插件 `hooks/hooks.json` | 随插件安装和分发 | 标准位置自动发现，随插件启停；不需要再在 manifest 中重复声明同一文件。 |
| `.agents/settings.json` / 旧配置文件 | 迁移旧配置 | 只读展示，不直接执行；需在设置页显式导入到 `.zcode`。 |

执行顺序是 user Hook → workspace Hook → 已启用插件 Hook。同一来源内按数组顺序执行。user 与 workspace 配置是拼接，不是项目配置覆盖用户配置。

每个 session 启动时会捕获一份 Hook 配置快照。修改文件、在设置页保存或启停插件后，请新建 session 验证；已经启动的 session 不保证热更新。

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

## 4.3 五分钟做出第一个插件 Hook

下面的插件在新 session 启动时给模型补充一条团队约束。示例依赖系统 PATH 中可用的 `node`。

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
  "description": "在会话开始时注入团队开发约束"
}
```

`hooks/hooks.json` 是标准位置，会自动加载，因此上面的 manifest 不再写 `hooks` 字段。

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
    additionalContext: "本项目提交前必须运行类型检查和受影响测试。"
  }
}));
```

1. 在 **设置 → 插件管理 → 发现** 中添加本地市场或插件来源，安装并启用插件。
2. 到 **设置 → Hooks** 确认插件 Hook 以只读条目出现，事件、matcher、命令和来源路径正确。
3. 新建 session 并发起请求；首轮模型应能看到注入的团队约束。
4. 调试时把日志写到 stderr，stdout 只输出协议结果，避免诊断文字破坏 JSON。

## 4.4 执行器、超时与 matcher

| 类型 | 语义 | 建议 |
|-|-|-|
| `process` | `command + args[]`，直接按 argv 执行，不经过 shell；只支持同步。 | 参数边界清楚，跨平台更稳定，优先用于 Node、Python 或二进制脚本。 |
| `command` | 把完整字符串交给系统 shell；可设置 `shell`、`async`、`timeout`。 | 适合兼容现有 marketplace 插件；注意 Windows、macOS、Linux 的 shell 和引用差异。 |

- `timeoutMs` 单位是毫秒；兼容字段 `timeout` 单位是秒。两者同时存在时优先 `timeoutMs`。
- 根级默认超时是 60000 ms，默认 stdout 上限是 32768 bytes。
- 单条 Hook 可写 `enabled: false`；runtime 会真正跳过，不只是界面置灰。
- `command` 的 `async: true` 是 fire-and-forget：当前事件立即继续，后台 stdout 不能阻断、改输入或注入上下文；超时、取消、完成和失败仍记录生命周期。
- `statusMessage` 当前会保存并在设置页展示，但还不是运行时的实时状态提示。

**matcher 规则**：

- 缺省、空字符串或 `*`：匹配全部。
- 只含字母、数字、下划线和 `|`：按精确名称列表匹配，例如 `Write|Edit`。
- 包含其他字符：按 JavaScript 正则处理；非法正则不执行该 matcher，并产生诊断。
- 工具事件匹配实际工具名，并兼容 `Agent` / `Task` alias。
- `SessionStart` 匹配 `source`；`UserPromptSubmit` 和 `Stop` 不使用 matcher 过滤。

## 4.5 stdin 输入契约

ZCode 向每个 Hook 写入“一行 JSON + 换行”。同一份输入同时保留 ZCode camelCase 字段与 其他客户端 snake_case alias，旧插件可以继续读取 snake_case。

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

| 事件 | 重点字段 |
|-|-|
| `SessionStart` | `source`，可选 `agent_type`、`model` |
| `UserPromptSubmit` | `prompt` |
| `PreToolUse` | `tool_name`、`tool_input`、`tool_use_id` |
| `PermissionRequest` | `tool_name`、`tool_input`，有真实数据时包含 `permission_suggestions` |
| `PostToolUse` | 完整结构化 `tool_response`，以及工具名、输入和调用 ID |
| `PostToolUseFailure` | 字符串 `error`、`is_interrupt`，以及工具字段 |
| `Stop` | `stop_hook_active`、`last_assistant_message` |

`transcript_path` 指向本次 Hook 可读的临时 JSONL 文件。ZCode 会在 Hook 完成后清理临时目录，因此不要把它当作长期存储；插件持久化数据请写入 `ZCODE_PLUGIN_DATA`。

## 4.6 stdout、退出码与常用返回值

stdout 为空表示成功且无附加效果；非 JSON stdout 只作为诊断，不进入模型上下文。只有去除前导空白后以 `{` 开头的合法 JSON 才按协议解析。未知字段会忽略，已知字段类型错误或事件名不符会让当前 Hook 可恢复失败，不影响后续 Hook。

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "只修改与当前任务相关的文件。"
  }
}
```

也兼容顶层 `additionalContext` 和 `additional_context`。推荐使用上面的 `hookSpecificOutput`，事件归属最清楚。

### PreToolUse：修改或拒绝工具调用

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "已重定向到允许目录",
    "updatedInput": {
      "file_path": "generated/index.ts",
      "content": "..."
    },
    "additionalContext": "文件已被重定向到 generated 目录。"
  }
}
```

`updatedInput` 是完整替代对象，不是局部 patch；ZCode 会用工具 schema 重新校验。拒绝时返回 `permissionDecision: "deny"` 和 `permissionDecisionReason`。多个 Hook 聚合时，deny 优先于 ask，ask 优先于 allow。

### PermissionRequest：自动允许或拒绝权限询问

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "deny",
      "message": "生产目录只能在发布流程中修改"
    }
  }
}
```

允许时把 `behavior` 改为 `allow`，并可在 decision 中返回 `updatedInput`、`updatedPermissions`；历史字段 `permissionUpdates` 也兼容。显式 deny 规则、Plan 模式写入禁令和工具硬限制不能被 Hook allow 绕过。

### UserPromptSubmit：阻断本次模型请求

```json
{
  "continue": false,
  "reason": "请先提供工单号",
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "该请求被团队策略阻断。"
  }
}
```

### Stop：让主模型继续一轮

```json
{
  "decision": "block",
  "reason": "还没有给出测试命令和结果，请补齐后再结束。"
}
```

`decision: "block"` 需要带 reason 或 additionalContext 才会续跑。为兼容旧 ZCode 配置，也接受 `continue: true` 且带 additionalContext。连续续跑达到 3 次后会强制结束，防止无限循环。

**退出码**：

- `0`：成功，解析 stdout。
- `2`：阻断快捷方式；在可阻断事件中产生 block/deny，在 Stop 中产生继续一轮的反馈。
- 其他非零：当前 Hook 可恢复失败，记录诊断，turn 不会因此整体崩溃。

## 4.8 插件发现、变量与安全边界

- manifest 查找位置：`.zcode-plugin/plugin.json`。
- 标准 `hooks/hooks.json` 自动加载；manifest 的 `hooks` 还支持相对 JSON 路径、inline 对象或二者数组。不要让 manifest 再指向同一个标准文件，否则会记录重复诊断并跳过重复项。
- 插件进程可读取 `ZCODE_PLUGIN_ROOT`、`ZCODE_PLUGIN_DATA`、`ZCODE_PLUGIN_ID`、`ZCODE_PLUGIN_NAME`；兼容变量 `ZCODE_PLUGIN_ROOT`、`ZCODE_PLUGIN_DATA` 也会注入。
- 命令、参数里的插件路径变量会在执行前替换。长期数据写入 `ZCODE_PLUGIN_DATA`，不要写回安装目录。
- 插件 Hook 在设置页只读，启停跟随插件本身。

**启用插件就是授予代码执行信任。**安装前审查来源、Hook 配置和脚本。

## 4.9 在设置页创建和维护 Hook

1. 打开 **设置 → Hooks**。
2. 选择 user 或 workspace scope，新增事件、执行类型、matcher、命令/参数、超时、async 和状态文案。
3. 已有 `.zcode` Hook 支持查看、编辑、删除和单条启停。编辑时不能直接改变 scope；需要删除后在目标 scope 重建。

## 5. 面向人和 Agent 的写作约定

维护插件文档时，优先写能改变执行结果的信息：

- **先给路径，再给背景**：开头说明目标、读取顺序和最短路径；把字段表、完整 JSON 和 Hooks 协议留在后面的参考章节。
- **一步一个动作**：每一步只做一件可验证的事，并写出完成条件、命令或预期结果。
- **显式写分支**：缺少依赖、需要权限、存在敏感配置或验证失败时，写清下一步和停止条件。
- **保持单一事实来源**：目录结构、脚本命令和清单字段以仓库文件和校验器为准；文档只补充原因、约定和容易踩坑的地方。
- **优先可复制示例**：示例应能直接改名、运行或对照检查；示例中的版本、路径和分类必须与当前仓库一致。

这套组织方式参考了 Agent Skills 的渐进披露规范，以及面向 Agent 的指令写作建议：先加载短流程，再按任务读取详细参考；步骤要明确，边界情况和完成标准要可检查。

官方参考：

- [Agent Skills Specification](https://github.com/agentskills/agentskills/blob/main/docs/specification.mdx)：目录结构、参考文件和渐进披露。
- [A practical guide to building agents](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/)：清晰动作、拆分步骤、边界处理和安全护栏。
