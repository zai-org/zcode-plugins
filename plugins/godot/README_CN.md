# Godot

[English](README.md)

使用官方 Godot CLI 开发游戏，在原版桌面编辑器中查看每轮结果。这个普通插件提供两个 Skill 和一个 `open` 命令，不打包引擎、MCP 服务、addon 或侧栏界面。

## 开始使用

让 Agent“使用 Godot 创建游戏并打开编辑器”，或调用 `open` 并指定项目目录。setup Skill 查找兼容的原生 Godot 4.x，缺失时在授权范围内从官方来源安装。C# 工程需要 .NET 版与 SDK。

| Skill | 用途 |
| --- | --- |
| setup | 检测/安装 Godot 并验证内置 CLI |
| cli | 修改工程文件、打开桌面编辑器、运行场景及按需导出 |

Agent 在包含 `project.godot` 的同一本地目录中修改脚本、场景和资源，使用 `godot --editor --path "/absolute/project"` 打开工程，保留现有窗口与未保存修改。外部文件变化可能需要让编辑器获得焦点或确认重新加载；CLI 不提供当前选区或未保存场景状态。展示窗口需要可见桌面，后台运行不能代替视觉验证。

## 依赖与迁移

唯一必需的运行时是 Godot。不需要 uv、Python 服务、MCP 凭据或独立模型 API 密钥，Agent 使用 ZCode 配置的模型。安装缺失引擎需要访问官方分发源。命令在用户授权范围内创建工程文件与导入缓存、执行项目代码、打开窗口及写入渲染/导出产物。

从 0.3.x 升级后重启会话，卸载旧 MCP 服务。本插件不再安装 addon；已有 `addons/godot_mcp`、autoload 和项目设置不会被自动删除，应先检查归属与依赖，再单独迁移工程。不删除用户修改，不停止其他编辑器进程。

## 验证与许可

已在 macOS、Godot 4.7.2 和 ZCode 的 DeepSeek Flash 会话中验证安装后的 0.4.0：两个 Skill 被加载，生成了工程文件、网格与材质资源，原生 Godot 输出了 PNG 渲染图并实际读取检查。这验证创作与渲染的功能链路，不代表产品模型精度验收。本轮未独立验证 Windows/Linux 安装和编辑器交互式重新加载。

Godot 及其图标遵循 MIT 许可，见仓库 `assets/godot/LICENSE.txt`。插件使用 Godot 官方可执行文件，不再打包 hybridindie 代码。

仍启用的旧 addon 会尝试连接已停用的 bridge，这类连接错误不属于游戏缺陷。检查启用项与 `.godot/zcode-mcp.json`，不输出 token。获得迁移授权后先保存/备份工程、禁用 addon，再移除确认不再使用的 addon、autoload 项和项目凭据。旧状态位于 `~/.zcode/plugin-data/godot-native/` 或 `ZCODE_GODOT_DATA_DIR`，清理须先核对项目归属和活跃客户端；仍被其他旧客户端使用的共享 Python 环境必须保留。

打包会拒绝无构建源码插件中的 `dist/`，包括 0.3.x 残留产物。请先检查并移除确认已废弃的生成目录，再重新构建，避免旧代码混入 CLI 包。
