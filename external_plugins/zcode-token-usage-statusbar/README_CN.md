# ZCode Token Usage Statusbar（Token 用量状态栏）

在 ZCode 里实时查看模型速度、token 用量、上下文容量、套餐额度与 Git 状态。

> **重要提示：** 安装悬浮状态条会**修改 ZCode 桌面客户端的 `app.asar`**（注入加载器与浮层；补丁可移除且保留备份）。安装成功后必须**完全退出并重开 ZCode**，只关闭窗口不算退出。用量统计只读取本地数据库，绝不上传。如果只要查询工具、不要状态条，见[关闭或移除](#关闭或移除)。

## 你能得到什么

- 桌面悬浮状态条：生成速度（tok/s）、本轮 / 会话 / 今日 token 用量、缓存命中率、子代理明细、上下文容量、套餐额度 chip、Git 状态 chip。悬停看明细，⚙ 面板可调整显示项。
- 每条回答末尾自动追加逐问速率行：tok/s、首字延迟、输出 token、生成耗时、会话累计。
- `/usage` 命令（today / week / models / current）、`token_usage` MCP 工具，以及一个教会智能体查询用量的技能。

## 环境要求

- Python **3.8+**，仅标准库，无需安装任何 pip 包。
- Hook 命令按 `python3` → `python` → `py -3` 自动回退（兼容 Windows）。stdio MCP 服务固定使用 `python3`；若机器 PATH 里没有 `python3`，可把安装副本 `.mcp.json` 的 `command` 改成可用解释器（MCP 工具是可选的，命令与 Hook 不依赖它）。

## 安装与首次运行

1. 从插件市场安装本插件并保持启用。
2. 新建或重新打开会话，插件会自动安装 / 修复状态条。**这一步会修改 `app.asar`，请确认信任此项目。**
3. **完全退出并重开 ZCode。**

自动安装默认开启（配置文件不存在或缺字段视为开启）。`~/.zcode/zcode-token-usage-statusbar/config.json` 中已有的显式 `"plugin_auto_install_overlay": false` 会保留；环境变量 `ZUSAGE_PLUGIN_AUTO_INSTALL=1/0` 优先于配置；`/uninstall-overlay` 会留下卸载豁免标记阻止自动重注入。未设置环境变量时，损坏配置或非布尔字段**不会**触发自动安装。自动安装失败时执行 `/install-overlay` 按输出排查，成功后仍需完全重启。

## 工作原理与副作用

| 方面 | 行为 |
|---|---|
| Hook | `SessionStart` 同步运行文件、检查更新、必要时给出重启提醒；`PromptSubmit` 记录提问时间戳并追加逐问速率行。 |
| MCP 服务 | `.mcp.json` 以 stdio JSON-RPC 启动 `usage_mcp.py`，提供 `token_usage(scope)` 工具，只读本地用量数据库。 |
| 文件写入 | `~/.zcode/zcode-token-usage-statusbar/`（运行文件、配置、会话状态；凭据文件权限 `0600`）；ZCode 客户端目录内的补丁与备份（`app.asar`）；`~/.zcode/zusage3` 中的浮层设置。卸载插件不删除个人配置。 |
| 网络 | 本地统计绝不出本机（只读 SQLite）。套餐额度 chip 在**内存中**解密宿主持有的 OAuth 凭据，直连 BigModel / Z.ai 用量端点展示套餐额度；凭据绝不写入配置、日志或诊断。插件更新会从已配置来源下载代码。可选的 SSH/WSL 远端查询走你自行配置的连接通道；插件不解密复用宿主密码或私钥口令，也不自动部署。Git chip 只在本机只读执行 `git` 查询（不 fetch、不联网）。 |
| 执行的命令 | 随插件分发的 Python 脚本；`git`（只读状态查询）；仅对你配置过的远端查询使用 `ssh`/`wsl.exe`。 |
| 第三方代码 | 不捆绑任何第三方代码——纯 Python 3.8 标准库 + 原生 JavaScript（Electron 主进程 CommonJS）。MIT 许可证；源码在 [ByteRax/zcode-token-usage-statusbar](https://github.com/ByteRax/zcode-token-usage-statusbar)。 |

SSH/WSL 远端会话需要在每台远端手工部署同版本 `zusage.py`；远端、额度源与多窗口的完整说明见[用户指南](https://github.com/ByteRax/zcode-token-usage-statusbar/blob/main/docs/user-guide.md)。

## 关闭或移除

- `/uninstall-overlay`——移除状态条，保留卸载豁免标记，保留个人配置。
- `"plugin_auto_install_overlay": false`——只保留查询工具。
- `"answer_rate_line": false`——关闭逐问速率行（下一问生效）。
- `"plugin_auto_update": false`——关闭更新检查。
- 彻底移除：先关自动更新，执行 `/uninstall-overlay`，再在 ZCode 设置里卸载插件并完全重启。**只卸载插件不会移除状态条。**

## 配置

默认运行配置在 `~/.zcode/zcode-token-usage-statusbar/config.json`——只合并需要修改的字段。除上述开关外还覆盖远端目标、额度源与显示选项；见 [`config.example.json`](https://github.com/ByteRax/zcode-token-usage-statusbar/blob/main/config.example.json) 与[用户指南](https://github.com/ByteRax/zcode-token-usage-statusbar/blob/main/docs/user-guide.md)。

## 源码与许可证

MIT — [ByteRax/zcode-token-usage-statusbar](https://github.com/ByteRax/zcode-token-usage-statusbar)。欢迎中英文 issue 与 PR。
