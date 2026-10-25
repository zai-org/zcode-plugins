# ZCode Herdr 状态桥接

[English](README.md)

这是 Linux 上显式启用的**普通插件（Standard plugin）**：在**当前 Herdr 窗格**显示 ZCode 的运行、权限等待或未知状态。不包含 MCP App、Web 服务、会话管理或 Ovis 补丁。Herdr、Ovis 是独立项目，本包不代表其官方认可。

## 前置条件与限制

- Linux（有 `/proc`）、Python 3.10+（仅标准库）、ZCode **3.16.3**（内部 CLI 0.17.0）、Herdr **0.9.5**。其他版本拒绝启动，这是首版有意收窄的兼容范围。
- 当前用户拥有的既有 Herdr 窗格，继承 `HERDR_ENV`、`HERDR_PANE_ID`、`HERDR_SOCKET_PATH`。不要从外部 shell 伪造这些变量；工作目录必须与窗格一致。
- 用 ZCode 插件管理器安装并启用本插件，然后在**新建且空闲的 shell 窗格**启动。普通 ZCode 会话不会自动接入；同一窗格不要启用其他状态桥接。
- 仅靠 Hooks 不能证明完成、取消或未发出终止 Hook 的 TUI 拒绝。`Stop` 之后模型可能继续迭代。默认模式将 `Stop` 标为 **unknown / Completion unverified（完成待核实）**，不会当作成功；未知不等于验收。
- 仅 Hooks 模式下，30 秒没有新 Hook 时，提示也会过期为 **unknown / Status unverified（状态待核实）**。这能覆盖缺失终止 Hook 的失败，但正常的长时间生成或权限等待也可能显示未知。只有新证据才刷新提示，不用轮询心跳伪造活动。
- 可选 `--experimental-db-status` 读取锁定版本的 ZCode 内部 SQLite 元数据，**不是公开 API**。仅投影精确绑定会话及当前用户消息父子关系下的 ID、时间、角色、完成/错误分类和工具生命周期，不返回正文、思考内容、工具参数或输出。数据库不可读、被替换或结构不兼容时显示未知；升级必须重新验证并发布兼容版本。
- 本插件不修复登录。此前独立试用出现过 `project_token_login_failed`，重新登录后恢复，但原因未查明，不能据此承诺无人值守可靠性。

## 安装与启动

从市场安装并启用 `zcode-herdr-status`。源码测试按仓库[本地市场流程](../../docs/PLUGIN_DEVELOPMENT.md#18-test-a-plugin-locally)执行。用 `zcode plugins list --json` 找到本插件已启用安装的 `rootPath`，将 `PLUGIN` 设置为该目录。在新的 Herdr shell 窗格中由用户执行：

```bash
python3 "$PLUGIN/hooks/bridge.py" doctor
python3 "$PLUGIN/hooks/bridge.py" run
```

启动器不覆盖 ZCode 的权限、模型、语言或工具策略。用户需要的原生命令参数放在 `--` 后；非默认二进制位置可用 `--herdr`、`--zcode` 显式指定。不要为通过试用而绕过确认或安全策略。

需要更精确的生命周期原因时，显式选择实验模式：

```bash
python3 "$PLUGIN/hooks/bridge.py" doctor --experimental-db-status
python3 "$PLUGIN/hooks/bridge.py" run --experimental-db-status
```

实验模式默认数据库为当前用户的 `$HOME/.zcode/cli/db/db.sqlite`；`--db` 可指定同一用户拥有的其他普通文件，不连接远程数据库，版本约束不变。doctor 成功仅证明本地安装、绑定及结构检查通过，**不验证模型登录或网络连通性**。

启动器会打印本次运行目录。`--state-dir` 可指定私有 0700 目录；默认使用已继承的 `ZCODE_PLUGIN_DATA`，否则使用 `$XDG_STATE_HOME/zcode-herdr-status`（未设置时为 `$HOME/.local/state/zcode-herdr-status`）。按 socket/窗格加锁，防止同一状态目录重复启动观察器；不要在同一窗格用不同状态目录启动竞争副本。

## 停用与回退

在同一用户的另一个终端中，使用启动时打印的精确目录：

```bash
python3 "$PLUGIN/hooks/bridge.py" stop "$RUN_DIR"
```

只停止观察器并释放自己的 Herdr 状态来源，原生 ZCode 继续运行。释放未确认会报错，不当作干净退出。通过 ZCode 停用插件也会被观察器的本地清单检查发现（通常五秒内，另加命令超时）。正常退出原生会话后卸载插件，即回到安装前状态；本插件从未改写其他插件设置或凭证，因此不恢复或替换它们。需要时保留私有运行证据；进程退出后仅清理属于自己的已打印运行目录。

观察器默认运行一小时，`--max-seconds` 可设为 1–86400。到期、父/原生进程退出、插件停用或 socket 被替换时停止，并尝试仅释放自身来源，不终止原生代理。Herdr 不可达时不能证明释放成功，应检查或重连，不把旧 UI 状态当成最新状态。外部 UI 的断线呈现不属于本插件能力。

## 副作用、隐私与来源

- 自动 `process` Hooks：SessionStart、UserPromptSubmit、PreToolUse、PermissionRequest、PostToolUse、PostToolUseFailure、Stop。使用 `python3`，stdout 不输出权限决策或上下文；未通过专用启动器接入时不做任何操作。Hook 输入仅临时解析，落盘只保留允许的生命周期元数据，不保存提示词或凭证。这是观察器，**不是沙箱或权限管理器**。
- 通过 argv 执行既有 ZCode/Herdr、本地插件清单命令及有时限的 Python 观察器。检查继承 socket 的 owner/inode 和 PID/启动时刻/UID 祖先关系，不依赖界面焦点选目标，不控制其他会话。不执行 shell 字符串、不注入输入、不审批权限、不安装服务、不下载运行时、不访问云。
- 在选定目录写入私有锁、绑定、序列号、事件和停止凭据。数据库访问可选且只读。日志可能含会话 ID 和本地路径，需私下保留，不上传客户工作原始日志/截图。
- 观察器自身无网络请求、遥测、模型调用、API Key 或新增收费。原生 ZCode 沿用现有模型、账号、网络及正常用量计费；Herdr 通过既有本地 Unix socket 通信。
- 本桥接源码按 Apache-2.0 发布（见 LICENSE），由内部观察原型整理而来。不打包 ZCode、Herdr、Ovis 的二进制或源码素材。ZCode/Herdr 是用户自行安装并受各自条款约束的外部依赖；Ovis 可选，不纳入运行版本检查。

## 验证

```bash
python3 -B -m unittest discover -s external_plugins/zcode-herdr-status/tests -v
python3 scripts/validate.py
python3 scripts/build_dist.py
git diff --check
```

先做合成/本地检查，再在独立配置中验证 doctor、新窗格、无害提示词、权限拒绝、取消、原生退出、原生存活时停止观察器、插件停用，并核对另一无关窗格未受影响。同时检查 UI、`transitions.jsonl` 与 `stopped.json`；传输 ACK 不等于业务/内容验收。默认 Hooks 与实验元数据模式应按各自不同合同验收。此前内部原型通过过短时真实任务试用，但不能代替当前可移植版本的兼容性与长期可靠性验证。
