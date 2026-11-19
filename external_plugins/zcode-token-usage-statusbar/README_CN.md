# ZCode Token Usage Statusbar（Token 用量状态栏）

在 ZCode 里查看模型速度、token 用量、上下文容量、套餐额度与 Git 状态。

> **重要提示：** 安装悬浮状态条会**修改 ZCode 桌面客户端的 `app.asar`**（注入加载器与浮层；补丁可移除且保留备份）。安装成功后必须**完全退出并重开 ZCode**，只关闭窗口不算退出。本地查询只读取用量数据库；显式开启可选移动端中继后，统计会经 ZCode 官方中继转发，范围见下文。如果只要查询工具、不要状态条，见[关闭或移除](#关闭或移除)。

## 你能得到什么

- 桌面悬浮状态条：生成速度（tok/s）、本轮 / 会话 / 今日 token 用量、缓存命中率、子代理明细、上下文容量、套餐额度 chip、Git 状态 chip。悬停看明细，⚙ 面板可调整显示项。
- 每条回答末尾自动追加逐问速率行：tok/s、首字延迟、输出 token、生成耗时、会话累计。
- `/usage` 命令（today / week / models / current）、`token_usage` MCP 工具，以及一个教会智能体查询用量的技能。
- 源码能力：宿主模型设置中的「⚡ 拉取模型」在确认保存前检测勾选模型，可提示路径修复、补齐有依据的模型配置和工具历史兼容性警告。检测会请求当前供应商、可能消耗额度；正式渠道可用范围及操作边界见[用户指南（中文）](https://github.com/ByteRax/zcode-token-usage-statusbar/blob/main/docs/user-guide.md#拉取模型与确认检测)。

## 环境要求

- Python **3.8+**，仅标准库，无需安装任何 pip 包。
- Hook 命令按 `python3` → `python` → `py -3` 自动回退（兼容 Windows）。stdio MCP 服务经 `node` 启动包内 `mcp-launch.cjs`（桌面 ZCode 3.17.1 起给 MCP 子进程 PATH 末尾追加 Electron Node 回退 shim；更旧桌面版或无此机制的宿主需本机装有 Node），由它按同一顺序实测探测解释器并透传 stdio 给 `usage_mcp.py`——任何平台都无需手工改 `.mcp.json`（issue #234）。MCP 工具是可选的，命令与 Hook 不依赖它。
- 以前用过独立安装器（`install.py`）？它可能把同一个 MCP 服务注册进了 `~/.zcode/cli/config.json`，导致每个会话各拉起两份 `usage_mcp.py`（以及各自的 `node` 启动器）。插件会在会话启动时移除这些遗留注册（历史名 `zcode-token-usage-statusbar` / `token-usage` / `zusage`），且仅当其指向本插件运行目录或插件目录内的 `usage_mcp.py`；带自定义键（如 `env`）的条目与其它条目一律保留。插件自己的 `.mcp.json` 继续提供 `token_usage` 工具；需要保留可把 `ZUSAGE_KEEP_LEGACY_MCP` 设为任意非空值（如 `1`）。

## 安装与首次运行

1. 从插件市场安装本插件并保持启用。
2. 新建或重新打开会话，插件会自动安装 / 修复状态条。**这一步会修改 `app.asar`，请确认信任此项目。**
3. **完全退出并重开 ZCode。**

自动安装始终开启（旧配置 `plugin_auto_install_overlay` 与环境变量 `ZUSAGE_PLUGIN_AUTO_INSTALL` 已不再读取）；`/uninstall-overlay` 会留下卸载豁免标记，是阻止自动重注入的唯一出口。待重启/有新版本时状态条 ⚙ 齿轮显示红点（点进 ⚙ 面板「插件更新」分区后消失），也可在该分区直接点「重启 ZCode」；不再注入会话内文字提醒（自动安装失败时的故障提示除外）。自动安装失败时执行 `/install-overlay` 按输出排查，成功后仍需完全重启。

## 手机远控页面（当前源码功能）

在桌面状态条 **⚙ → 维护 → 移动端远程控制** 独立分区开启「推送状态栏数据到远控页」。正式脚本链接在此分区单独提供，以只读输入框显示，开关关闭时仍可选择复制；面板不会自动安装或打开外链，请复制到手机浏览器的脚本管理器中安装。用支持脚本管理器的浏览器[安装正式版手机脚本](https://raw.githubusercontent.com/ByteRax/zcode-token-usage-statusbar/main/zusage-mobile.user.js)，再另行开启宿主官方「Web 远程控制」并打开 `https://zcode.z.ai/remote/`；安装脚本不会自动授权推送。此为当前源码功能，正式渠道是否支持以对应 Release 说明为准。

开关仅合并运行目录 `config.json` 的 `mobile_relay.enabled`，保留其他字段；仅对象内显式布尔 `true` 开启，缺字段、`false`、非布尔值或非对象配置均关闭。旧用户缺键时升级后关闭，已有显式 `true` 保留、显式 `false` 保持关闭。关闭停止插件握手公告、统计查询与快照推送，并丢弃在途结果，不影响宿主官方远控的正常消息；手机仍可能在既有能力有效期内上行显示偏好，桌面忽略、不应用、不回执，无需另行关闭手机上行。手机不能修改桌面开关。旧主进程不支持时，先更新安装副本并将匹配的冷文件 `inject-main.cjs` 安全部署到实际加载目录，再完全退出并重开 ZCode；仅更新浮层或仅重启不能替代部署。

## 工作原理与副作用

| 方面 | 行为 |
|---|---|
| Hook | `SessionStart` 同步运行文件、检查更新、未注入时自动安装，并清理 `~/.zcode/cli/config.json` 中独立安装遗留的 MCP 注册（仅限指向本插件 `usage_mcp.py` 的条目，改前在同目录留备份）；`PromptSubmit` 记录提问时间戳并追加逐问速率行。 |
| MCP 服务 | `.mcp.json` 以 stdio JSON-RPC 启动 `usage_mcp.py`，提供 `token_usage(scope)` 工具，只读本地用量数据库。 |
| 文件写入 | `~/.zcode/zcode-token-usage-statusbar/`（运行文件、配置、会话状态；凭据文件权限 `0600`）；ZCode 客户端目录内的补丁与备份（`app.asar`）；`~/.zcode/zusage3` 中的浮层设置；仅当存在独立安装遗留的 MCP 注册时改写 `~/.zcode/cli/config.json`（移除条目并在同目录留 `.zusage-mcp.bak` 改前备份，见上表 Hook 行）。卸载插件不删除个人配置。 |
| 网络 | 本地统计查询只读 SQLite，不主动上传用量；显式开启的移动端中继另见下一行。套餐额度 chip 默认开启（⚙ 面板可关）：在**内存中**解密宿主持有的 OAuth 凭据，直连 BigModel / Z.ai 用量端点展示套餐额度；凭据绝不写入配置、日志或诊断。预估费用在常驻进程内每 12 小时匿名同步公开模型单价（`models.dev`）与美元汇率（只下载不上传，设 `"pricing": {"fetch": false}` 可彻底关闭）。插件更新会从已配置来源下载代码（更新日志卡片从 GitHub/GitCode 接口拉取 Release 说明）。可选的 SSH/WSL 远端查询走你自行配置的连接通道；插件不解密复用宿主密码或私钥口令，也不自动部署。Git chip 只在本机只读执行 `git` 查询（不 fetch、不联网）。 |
| 移动端中继 | 默认关闭，仅显式布尔 `mobile_relay.enabled: true` 启用，经官方中继 `wss://zcode.z.ai/api/v1/remote/ws2` 推送，本项目不新增自有服务器。插件载荷无端到端加密，服务端可见；下行包括当前远控会话标识与数值统计、所属主机的今日及项目聚合（可能包含其他会话贡献），不含正文、工作区路径或凭据。手机上行仅含显示偏好与代际计数。此开关只控制插件扩展，不影响官方远控普通消息。 |
| 执行的命令 | 随插件分发的 Python 脚本；`git`（只读状态查询）；仅对你配置过的远端查询使用 `ssh`/`wsl.exe`。 |
| 第三方代码 | 不捆绑任何第三方代码——纯 Python 3.8 标准库 + 原生 JavaScript（Electron 主进程 CommonJS）。MIT 许可证；源码在 [ByteRax/zcode-token-usage-statusbar](https://github.com/ByteRax/zcode-token-usage-statusbar)。 |

SSH/WSL 远端会话需要在每台远端手工部署同版本 `zusage.py`；远端、额度源与多窗口的完整说明见[用户指南](https://github.com/ByteRax/zcode-token-usage-statusbar/blob/main/docs/user-guide.md)。

Web 远控状态条需在打开远控页的浏览器中，通过脚本管理器[安装接收脚本](https://raw.githubusercontent.com/ByteRax/zcode-token-usage-statusbar/main/zusage-mobile.user.js)；排障使用[调试版](https://raw.githubusercontent.com/ByteRax/zcode-token-usage-statusbar/main/zusage-mobile.debug.user.js)，两版只启用其中一版。链接跟随源码 `main`，可能领先正式插件 Release，请使用支持相同手机中继协议的桌面插件。脚本管理器负责检查更新，桌面插件升级不会替浏览器安装脚本。接收脚本内嵌同一桌面 overlay，本地与 WSL/SSH 共用状态条、tooltip 和设置，不再提供独立 chips 回退 UI。插件推送默认关闭，须在上述桌面独立分区显式开启；中继数据范围见上表。详见[远控页指南](https://github.com/ByteRax/zcode-token-usage-statusbar/blob/main/docs/user-guide.md#web-远程控制页面)。

## 关闭或移除

- `/uninstall-overlay`——移除状态条，保留卸载豁免标记，保留个人配置。
- `/uninstall-overlay` 之外没有关闭自动安装的开关（恒开）；只保留查询工具请用它。
- `"answer_rate_line": false`——关闭逐问速率行（下一问生效）。
- `"restart_notice": false`——关闭更新/待重启的红点提醒（状态条 ⚙ 与「插件更新」项；命令行输出与故障提示不受影响）。
- `"quota_enabled": false`——停止套餐额度查询并隐藏额度 chip（此后不再读取凭据）。
- `"auto_compact_patch": false`——关闭自动压缩上下文阈值注入（v188 起默认开；建议用 ⚙ 面板开关）。给客户端引擎打按版本白名单的补丁，使压缩触发点成为可配置的窗口百分比；关闭开关即还原引擎字节。只影响桌面客户端，终端 CLI 不受影响。
- `"plugin_auto_update": false`——关闭更新检查。
- `"mobile_relay": {"enabled": false}`——停止插件握手公告、统计查询及快照推送，默认关闭；不影响官方远控，无需另行关闭手机上行。
- 彻底移除：先关自动更新，执行 `/uninstall-overlay`，再在 ZCode 设置里卸载插件并完全重启。**只卸载插件不会移除状态条。**

## 配置

默认运行配置在 `~/.zcode/zcode-token-usage-statusbar/config.json`——只合并需要修改的字段。除上述开关外还覆盖远端目标、额度源与显示选项；见 [`config.example.json`](https://github.com/ByteRax/zcode-token-usage-statusbar/blob/main/config.example.json) 与[用户指南](https://github.com/ByteRax/zcode-token-usage-statusbar/blob/main/docs/user-guide.md)。

**WorkBuddy 数据源（可选）**：`"host": "workbuddy"`（或 `"auto"`）可让查询改读 `~/.workbuddy/workbuddy.db`（会话级上下文与 credit）与会话正文 `projects/*/*.jsonl`（逐请求 token / 缓存 / 思考 / credit / 工具调用）；文件在别处时用 `"hosts": {"workbuddy": {"db_path": "..."}}` 或环境变量 `ZUSAGE_WORKBUDDY_DB`，CLI/MCP 也可单次 `--host workbuddy` / `host: "workbuddy"` 覆盖。缺省仍是 `zcode`；WorkBuddy 没有 asar 链，状态条改走 CDP 注入输入卡。详见 [docs/hosts.md](https://github.com/ByteRax/zcode-token-usage-statusbar/blob/main/docs/hosts.md)。

## 源码与许可证

MIT — [ByteRax/zcode-token-usage-statusbar](https://github.com/ByteRax/zcode-token-usage-statusbar)。欢迎中英文 issue 与 PR。
