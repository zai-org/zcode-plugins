# KiCad（ZCode UI 插件）

把 KiCad 10 嵌入对话。Agent 用 JSON 电路 spec 设计双层板——真实 KiCad 符号/封装库、自动布线、DRC、Gerber/BOM/贴片坐标——
侧栏 **KiCad 电路板** 面板显示 3D 渲染、DRC 结论、元件表和全部产物。

## 前提

* macOS 且已安装 **KiCad 10**（`/Applications/KiCad/KiCad.app`；或在插件设置里填「KiCad.app 路径」）。
* 推荐安装 **uv**（首次启动自动拉取依赖），或提供装有 `fastmcp>=4,<5`、`pydantic`、`numpy` 的 Python（设置项「带 fastmcp 的 Python」）。

## 使用

对 Agent 说：「用 KiCad 设计一块 555 LED 闪烁器的板子，检查 DRC、渲染并打开电路板面板。」示例是 NE555 无稳态闪烁电路（约 1 Hz、9 个元件、34 × 22 mm）；Agent 从 `pcb_spec_example` 开始，依次调用 `kicad_check_spec_file`、`pcb_build`、`pcb_render`、`pcb_export_fab`、`kicad_export_files`、`kicad_board_view`（见 `skills/kicad-board/SKILL.md`）。也可以随时在会话面板列表中手动打开该面板。

## 面板：与真实 KiCad 窗口并排的标签页

面板是 KiCad 自己窗口（PCB Editor、Schematic Editor）的"伴随面板"，不是嵌入式编辑器。各标签页显示 `kicad-cli` 对最新板子（你在 KiCad 里保存过的就是编辑后的那块）无界面导出的内容：

* **电路板**：3D 渲染（顶/底）、元件表。**实时**：正在运行的 PCB 编辑器此刻打开的内容，无需 ⌘S（见下）。**图层**：每层一张 SVG（铜、阻焊、丝印、钢网、Fab、庭院、板框），可开关各层，可镜像看底面。
* **3D**：预渲染视图（斜视、后斜视、顶、底、正、侧），不是可交互的查看器。
* **原理图**：显示编辑工程（`./kicad/edit/<名称>/`）里的 `.kicad_sch`，一次一页。插件按电路 spec 建板，不生成原理图：没有时该标签页会说明（在 KiCad 的原理图编辑器里画好并保存到该文件夹即可）。
* **检查**：DRC 及前若干条违规和位置（`kicad_checks`，Agent 也可调用）；有原理图时还有 ERC。
* **元件库**：搜索 KiCad 符号和封装（`pcb_search_parts`），查看其图形（符号单元 1、封装）和引脚。
* **产物**：这个工作区存下的全部产物。


## 与正在运行的 PCB 编辑器实时连接（KiCad API）

在 KiCad 自己的 **「Enable KiCad API」** 偏好设置打开后，面板和 Agent 可以不等 ⌘S 就和你已经打开的 PCB 编辑器通信：

* 面板顶部的**实时**指示和**实时**标签页：元件（位号、封装、值、x、y、角度、所在面）、网络和你当前的选择，标签页打开时每 1.5 秒从编辑器读取一次（板子没变时几乎没有开销）。未保存的移动会立刻显示，Δ 列显示自打开标签页以来的变化。坐标与 spec 相同：以板子左上角为原点的 mm。
* `kicad_live_status`（Agent 和面板）：API 是否可达、打开的是哪块板、是否是本会话的板子。不可用时用一句话说明原因并点出设置名；其他标签页和 ⌘S 往返照常工作。编辑器里打开的是另一个文件时，面板会明说，而不是把它当成会话的板子显示。
* `kicad_live_move_footprint`（仅 Agent）：在打开的编辑器里移动**一个**元件（可选同时设置角度），是 KiCad 里的一个可撤销步骤（⌘Z）。**不会保存任何东西**：你照常按 ⌘S，面板再导入并跑 DRC。只有当编辑器恰好打开的是本会话的板子时才会执行。有意不提供「保存」工具。

**安全。** KiCad API 是本机的 Unix socket（`/tmp/kicad/api.sock`，其他编辑器是 `api-<pid>.sock`）。KiCad 不要求密码或令牌；只有你的 macOS 用户能连接这个 socket 文件，但该用户的**任何**进程都可以：你的 shell、脚本，以及能运行 shell 或 Python 的 ZCode Agent——不管有没有这个插件。协议里有下列全部请求（本插件的测试只实际用过读取、一次移动、撤销和一个缩放动作）：这样的进程可以读取整块板子、修改或删除板上任何东西、把板子或副本保存到它能写入的任意路径（`save_as` 可覆盖）、撤销你未保存的编辑、改变选择、运行任意编辑器动作，以及（取决于客户端库）启动导出任务。只在需要时打开该偏好设置。本插件用它读取（文档、元件、走线、过孔、铜区、焊盘、网络、选择）和执行上述唯一的一次提交；它从不保存、还原、删除、改变选择、运行动作，也不启动或停止 KiCad，并且把 socket 路径和 KiCad 发放的令牌留在服务进程内：不会交给面板页面，也不会出现在工具结果或错误信息里。

## 给其他工具用的 3D 模型

`pcb_export_glb` 把板子导出为带 KiCad 3D 模型的二进制 glTF（`.glb`），存为产物并复制到 `./kicad/out/<名称>.glb`，同时给出元件表：每个元件的位号、封装、位置、朝向、所在面、尺寸和包围盒（板坐标，单位 mm）。文件里每个元件节点就以位号命名（KiCad 10.0.6 上验证），所以 Blender 里看到的是 `U1`、`R3` 等对象；不打开文件也能从元件表得到同样信息。封装没有 3D 模型的元件不在文件里（列在 `parts_without_model`），模型来自 KiCad 库，高度为标称值。`include_copper` 会再加上平面的铜、焊盘、过孔、丝印和阻焊面。

## 在真实 KiCad 里继续编辑

面板里的「在 KiCad 中编辑」（或让 Agent 调用 `kicad_open_in_kicad`）会把当前板子导出到工作区 `./kicad/edit/<名称>/`（一个普通的 KiCad 工程，归你所有），并用本机的 **KiCad PCB Editor** 打开。
你在 KiCad 里按 ⌘S，面板会自动导入这次保存（生成新的板子产物并跑 DRC），顶部显示「已在 KiCad 中编辑」；Agent 也可调用 `kicad_sync_edits`。重新打开时不会覆盖你已保存的内容。目前自动启动只支持 macOS。

## 已知问题 / 未证实

* **实时连接，未证实：** `kicad_live_move_footprint` 之后 KiCad 画布是否立刻重绘没有亲眼看到（编辑器自己的回读显示了新位置，⌘Z 能恢复旧位置，这是在一个独立的 KiCad 实例上测的，不是你的）。API 没有「有未保存修改」的请求，也没有变化通知，所以实时标签页只能轮询，分不清已保存和未保存的编辑。它需要 `kicad-python`（首次启动时由 `uv` 拉取；没有它插件照样启动，只是没有实时连接），只在 macOS 上的 KiCad 10.0.6 试过。写入只在独立 KiCad 进程里的一份临时板子副本上试过。
* **不是嵌入式编辑器。** 标签页由 `kicad-cli` 渲染，不是 KiCad 自己的画布，并且与 PCB/原理图编辑器窗口彼此独立：编辑仍然经由文件（在 KiCad 里按 ⌘S，面板再导入这次保存）。标签页不会跟随你在 KiCad 里的光标或选择。
* **原理图标签页和 ERC 需要你自己画的原理图。** ERC 使用 KiCad 自带的库表和私有配置，不是你自己的库表：来自自定义库的符号会显示为库警告。多页原理图用下拉选择页面，只试过单页。
* **图层、原理图、元件库是 `kicad-cli` 导出的 SVG**，用 KiCad 默认配色而不是你的主题。较大的原理图每页约 1 MB SVG：猫粮机 rev A 原理图（0.9 MB）已在真实桌面沙箱测试（真实 Electron 宿主、CSP 和桥）里渲染成功；更大的设计没有试过，也没有在 ZCode Dev 窗口里手工试过。
* **GLB**：在示例板（9 个元件，位置/旋转/底面已与 pcbnew 对照）上测试过，元件表只描述有库 3D 模型的元件。网格名是封装名，位号在节点名里。
* **早期版本的设置问题。** 0.4.2 及之前，插件对你自己的 KiCad 设置运行 `kicad-cli version`，KiCad 随后会改写 `~/Library/Preferences/kicad/10.0/kicad_common.json` 里的一个值（文件对话框的起始文件夹）。0.5.0 起插件启动的所有 KiCad 程序都使用私有配置；对该调用的一次测试里只有这一个值发生了变化；你自己打开的 GUI 保持你的设置。

* **点「在 KiCad 中编辑」提示没有启动 KiCad / PCB Editor 一打开就崩溃（macOS）。** 手动拷贝或下载到 `/Applications` 的 KiCad 带有下载隔离标记（quarantine），macOS 会只把内层的 `pcbnew.app` 单独放到临时副本里运行（App Translocation），那里找不到 `libkicommon.*.dylib`（崩溃报告里是 “Library not loaded”）。插件会等待 `pcbnew` 保持运行；没有的话会显示原因和修复命令。修复需要你自己在终端执行（它会修改系统安全属性，插件不会代劳）：`xattr -dr com.apple.quarantine /Applications/KiCad`，然后重新点「在 KiCad 中编辑」。面板里的「正在 KiCad 中编辑」横幅只表示编辑会话已创建，请以标题下方的警告行为准。

## 说明

* 交互页面仅用于 ZCode Desktop 的本地工作区；其他入口保留普通工具记录。
* 产物按工作区保存在插件数据目录；导出的文件在工作区 `./kicad/out/`。
* KiCad 工作器（`server/kicad/`）是本插件的一部分，其配置不会读取 `.env` 文件。
* 限制：仅双层板、仅裸板、元件位置由 Agent 给出、不生成原理图文件；DRC 通过不代表电路正确。

## 依赖、网络与副作用

* 需要已安装 **KiCad 10**（`/Applications/KiCad/KiCad.app`，或设置「KiCad.app 路径」）。插件调用其中的 `kicad-cli`、自带 Python（pcbnew 脚本）并读取其符号/封装库；不打包、不修改 KiCad。
* **Python**：推荐 `uv`，或装有 `fastmcp`、`pydantic`、`numpy` 的 Python ≥ 3.11（实时连接另需可选的 `kicad-python`）。**如果既没有 uv、也没有这样的 Python，或 uv 取不到依赖（首次启动时离线），插件仍会启动：面板能打开并说明缺什么，模型会得到一个工具 `kicad_setup_help`。** uv 以 `UV_NO_CONFIG=1` 运行，所以工作区里的 `uv.toml` 或 `pyproject.toml` 无法改变依赖来源。**网络**：首次启动时 `uv` 会下载这些依赖（加上 kicad-python 及 pynng、protobuf、jsonschema）（本机没有 ≥ 3.11 的 Python 时还会下载 Python）。除此之外不使用网络，没有遥测。
CI 会先准备 Python 运行环境，再开始 60 秒的 MCP 握手。依赖准备日志写入 stderr；运行环境不可用时，产物检查会失败，不会把缺依赖的帮助面板当作正常服务。也可以在已安装插件目录运行 `node dist/server.mjs --prepare-runtime`，成功时 stdout 返回 `ready`。产物检查使用同一个隔离 HOME 和缓存的 Python 环境，以离线模式完成握手。

* **执行的命令**：`kicad-cli`（DRC、渲染、SVG/GLB/STEP/Gerber 导出、`sch erc`、符号/封装 SVG）、KiCad 自带 Python、`uv`；只有当你点「在 KiCad 中编辑」或 Agent 调用 `kicad_open_in_kicad` 时，才会执行 `open -a "PCB Editor.app"`（macOS），随后只读地检查它是否保持运行：`pgrep -x pcbnew`，启动失败后再执行 `xattr -p com.apple.quarantine` 并查看 `~/Library/Logs/DiagnosticReports/pcbnew-*.ips`。插件本身不会修改隔离标记。
* **读取的文件**：除你的板子和 KiCad 库外，只读地读取 `~/Library/Preferences/kicad/*/kicad_common.json` 里「Enable KiCad API」的值（用来告诉你 API 是否打开）。**Socket**：只有当面板打开且显示着一块板子时，它每 3 秒问一次 KiCad 的 API 是否应答（一次 ping 和已打开文档列表，不含板子数据）来画实时指示，实时标签页每 1.5 秒读一次板子；Agent 的 `kicad_live_*` 调用连接的是同一个本机 socket（见上面的安全说明）。面板关闭、也没有 Agent 调用时，不会连接。
* **写入的文件**：工作区的 `./kicad/`（spec、导出文件含 `kicad/out/<名称>.glb`、`kicad/edit/<名称>/` KiCad 工程）和插件数据目录（产物库、标签页视图缓存、KiCad 私有配置）。文件类工具（`pcb_spec_example`、`kicad_check_spec_file`、`kicad_export_files`、GLB 导出）只使用工作区内的路径（符号链接会被解析，越出工作区的路径被拒绝）；`pcb_spec_example` 不会替换与示例不同的 spec，除非 `overwrite=true`；`kicad_open_in_kicad` 从不覆盖 `kicad/edit/` 里已有的板子，而是在旁边新建 `<名称>-r2`、`-r3`……随包的工作器不读取 `.env` 或其他配置文件。没有 Hook。

## 第三方

KiCad（GPL-3.0-or-later；其库为 CC-BY-SA-4.0 并带例外条款）使用你本机的安装，不随包分发。`uv` 在运行时拉取：fastmcp（Apache-2.0）、pydantic（MIT）、numpy（BSD-3-Clause 等）、kicad-python（MIT）及 pynng（MIT）、protobuf（BSD-3-Clause）、jsonschema（MIT）。面板打包了 MCP Apps SDK 相关包，其许可证随构建产物放在 `dist/THIRD_PARTY_NOTICES.txt`。
本插件独立于 KiCad 项目，与其无隶属或背书关系；「KiCad」仅用于说明兼容性。
