---
name: cli
description: Create and edit Godot game projects using the official CLI and project files, open the original desktop editor to show iterations, and run games with visible feedback. Use for Godot scenes, GDScript, game development, debugging and exports.
---

# Godot CLI

使用官方 Godot 可执行文件和本地工程文件，不创建自定义 CLI、MCP 或常驻桥接。环境未知时先按 [setup](../setup/SKILL.md) 检查。参数以当前安装版本的 `--help` 为准；引擎 API 查询匹配版本的官方文档 https://docs.godotengine.org/ 。

## 开发与展示

- 一个任务固定一个包含 `project.godot` 的工程目录。直接编辑该目录内的 `.gd`、`.tscn`、`.tres` 和配置；后续迭代修改同一份文件，不重复创建项目副本。
- 启动前先识别已有实例：macOS/Linux 使用 `ps -ax -o pid=,args=`，Windows 使用 `Get-CimInstance Win32_Process` 的 ExecutablePath / CommandLine，核对实际 Godot 可执行文件、编辑器参数（`--editor` / `-e`）、规范化后的工程路径。相对 `--path` 必须结合进程工作目录解析，不能仅按进程名或标题认定同一工程。Finder/项目管理器启动、缺少路径或无法读取进程信息时，通过原生窗口信息核对；仍不能确定则先请用户确认已有工程窗口，不再盲目启动第二个实例。确认同工程后通过宿主窗口工具聚焦复用；CLI 本身没有聚焦已有窗口的命令。
- 默认打开原版桌面编辑器展示进展：`godot --editor --path "/absolute/project"`。需要打开具体场景时可用 `godot --editor --path "/absolute/project" "res://scenes/main.tscn"`。命令中的 godot 替换为已验证的可执行文件路径。
- 用宿主 shell 的进程管理非阻塞启动可见编辑器，记录自己启动的 PID、启动时间、可执行文件、工程路径及日志路径。不要让超时调用自动杀掉持久 GUI。已有同工程窗口则复用，不能每次编辑都新开窗口。
- 修改文件后让编辑器获得焦点，观察文件扫描/重新加载结果。若出现外部修改冲突，保留用户未保存内容并先协调，不能强制覆盖。不要声称 CLI 能读取当前选区、未保存场景或自动执行实时节点操作。
- 场景未刷新时，使用原生编辑器的重新加载交互；只有确认文件已保存、PID 仍属于本任务且没有未保存用户修改时，才正常关闭自己启动的窗口并重新打开同一工程。不使用 killall 或按进程名批量关闭，不关闭用户原有窗口。
- 将可编辑的关卡和主要场景结构尽量保存为 `.tscn`，避免所有物体仅在运行时生成而让编辑器显示空场景。需要程序化生成时明确区分编辑器内容和运行效果。
- 每轮有意义的修改后展示结果，按任务需要运行游戏：`godot --path "/absolute/project"`；指定场景可用 `godot --path "/absolute/project" "res://scenes/main.tscn"`。这是独立游戏窗口，不是操纵已打开编辑器里的运行按钮。记录本任务的游戏进程，避免重复实例。
- 用宿主截图/图片读取工具实际观察编辑器或游戏画面，再决定是否调整。日志无报错不等于视觉或玩法通过。未运行、未看图或未试玩时明确说明，不能用进程已启动代替验收。最终保留编辑器窗口，交付工程路径。

## 检查、脚本与导出

遵守用户当前开发阶段要求，只运行必要基础检查；不自动扩展到端到端测试、完整测试或导出。

- 需要导入资源时：`godot --headless --path "/absolute/project" --import`。它会写入导入缓存；避免和同工程编辑器同时写缓存，等待导入结束再打开窗口。
- 单脚本语法检查：`godot --headless --path "/absolute/project" --script "res://scripts/example.gd" --check-only`。检查退出码及错误日志；这不是整款游戏的功能验证。
- 独立 GDScript 工具可用 `--headless --path ... --script ...`，脚本需有受支持的入口（例如继承 SceneTree）并主动退出。不要将普通节点脚本直接当工具入口运行。
- 游戏运行不会必然退出；需要有界检查时先验证本版 `--quit-after` 参数，迭代数不是秒。不能因为超时退出就判断通过。
- 用户要求导出时才使用 `--headless --path ... --export-release "Preset Name" "/absolute/output"`，先确认匹配版本的导出模板和已有导出预设。不自行发布产物。

CLI 提供启动、文件导入、脚本执行与构建，不能无桥接读取正在运行的编辑器内部状态。这里承诺逐轮可见的结果，不承诺每次文件写入都会实时出现在界面上。
