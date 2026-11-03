# KiCad（ZCode UI 插件）

把 KiCad 10 嵌入对话。Agent 用 JSON 电路 spec 设计双层板——真实 KiCad 符号/封装库、自动布线、DRC、Gerber/BOM/贴片坐标——
侧栏 **KiCad 电路板** 面板显示 3D 渲染、DRC 结论、元件表和全部产物。

插件使用同一套 PCB 核心提供两个发行版本，并提供自动选择模式：

| 插件版本 | 对应发行版 | 额外就绪检查 |
| --- | --- | --- |
| `auto`（默认） | 自动发现的最新标准或华秋 KiCad 10 | 先根据安装内容解析发行版，再开放对应工具 |
| `standard` | 标准 KiCad 10 | CLI、pcbnew Python、符号库和封装库 |
| `huaqiu` | 华秋 KiCad 10 | 核心检查、内置华秋组件，以及公共器件库原生适配层 |

「KiCad.app 路径」留空时，`auto` 会搜索系统与用户 Applications 目录，不启动应用即可识别发行版，并选择最新安装。改选 `standard` 或 `huaqiu` 后，自动发现只会选择对应发行版。显式填写 app 路径后该路径始终优先，即使路径不存在也不会静默换用其他安装，而是明确报告配置错误。

## 前提

* macOS 且在系统/用户 Applications 目录安装了**标准 KiCad 10**或**华秋 KiCad 10**；也可在插件设置中填写精确的「KiCad.app 路径」。
* 推荐安装 **uv**（首次启动自动拉取依赖），或提供装有 `fastmcp>=4,<5`、`pydantic`、`numpy` 的 Python（设置项「带 fastmcp 的 Python」）。

## 使用

对 Agent 说：「用 KiCad 设计一块 555 LED 闪烁器的板子，检查 DRC、渲染并打开电路板面板。」示例是 NE555 无稳态闪烁电路（约 1 Hz、9 个元件、34 × 22 mm）；Agent 从 `pcb_spec_example` 开始，依次调用 `kicad_check_spec_file`、`pcb_build`、`pcb_render`、`pcb_export_fab`、`kicad_export_files`、`kicad_board_view`（见 `skills/kicad-board/SKILL.md`）。也可以随时在会话面板列表中手动打开该面板。

首次使用或切换 KiCad 发行版时先调用 `kicad_capabilities`，只有 `edition_ready=true` 才继续。它会只读报告自动/显式选择方式、全部检测候选、`requested_edition`、`resolved_edition`、标准/华秋发行版、匹配状态、KiCad 版本、CLI、库、pcbnew Python、实时 IPC、华秋内置 DSH 组件、当前可用工具和结构化缺失依赖；检测到的 DSH 只做诊断，插件不会启动第二套 Agent Harness。

### 华秋版：原生器件查询

`resolved_edition` 为 `huaqiu` 且已就绪时，以下只读 ZCode 工具会复用华秋 KiCad 内置、已做标准化的 `@huaqiu/part-search` 库：

* `search_hqsch_parts`：按 MPN、制造商、分类或关键词搜索，可要求结果具备符号、封装、3D、仿真或供应链数据。
* `get_hqsch_part`：读取器件详情、属性、文档、图片、生命周期和模型元数据。
* `get_hqsch_part_models`：读取符号、封装、3D、仿真模型的元数据和 URL（只返回元数据，不安装任何内容）。
* `get_hqsch_supply_chain`：批量读取最多 50 个器件的库存、MOQ、交期、分销链接、币种和阶梯价。
* `resolve_hqsch_part_for_kicad`：读取所选器件的标准化详情，搜索本机 KiCad 库，校验符号的封装过滤规则和同编号引脚/焊盘映射，再返回排序后的候选和 `spec_part_fields`。
* `compare_hqsch_models_with_kicad`：显式把所选器件的公共 `.kicad_sym` 和 `.kicad_mod` 下载到内存，与一个解析候选比较引脚名称/编号、带编号焊盘的几何及尺寸，以及 Courtyard 外形尺寸。

这些调用直接访问华秋无需登录的公共接口 `https://kiapi.eda.cn`。它们不会启动 DSH、加载 DSH skill、下单、安装模型或写入工程。只有显式比较工具会下载模型文本：仅接受 `file.eda.cn` / `file1.eda.cn` 的 HTTPS，拒绝重定向，单文件上限 2 MiB，在内存中按不可信数据解析，只返回哈希而不返回模型正文。模型一致是更强的结构证据，但解析和比较工具仍把电气引脚定义与精确物理封装确认标为必须对照 datasheet 复核。标准版会明确拒绝这些调用。

## 面板：与真实 KiCad 窗口并排的标签页

面板是 KiCad 自己窗口（PCB Editor、Schematic Editor）的"伴随面板"，不是嵌入式编辑器。各标签页显示 `kicad-cli` 对最新板子（你在 KiCad 里保存过的就是编辑后的那块）无界面导出的内容：

* **电路板**：3D 渲染（顶/底）、元件表。**实时**：正在运行的 PCB 编辑器此刻打开的内容，无需 ⌘S（见下）。**图层**：每层一张 SVG（铜、阻焊、丝印、钢网、Fab、庭院、板框），可开关各层，可镜像看底面。
* **3D**：预渲染视图（斜视、后斜视、顶、底、正、侧），不是可交互的查看器。
* **原理图**：显示编辑工程（`./kicad/edit/<名称>/`）里的 `.kicad_sch`，一次一页。插件按电路 spec 建板，不生成原理图：没有时该标签页会说明（在 KiCad 的原理图编辑器里画好并保存到该文件夹即可）。
* **检查**：DRC 及前若干条违规和位置（`kicad_checks`，Agent 也可调用）；有原理图时还有 ERC。
* **元件库**：搜索 KiCad 符号和封装（`pcb_search_parts`），查看其图形（符号单元 1、封装）和引脚。
* **产物**：这个工作区存下的全部产物。


## 与正在运行的 PCB 编辑器实时连接（KiCad API）

在 KiCad 自己的 **「Enable KiCad API」** 偏好设置打开后，「在 KiCad 中编辑」会启动所选发行版的精确 PCB Editor 进程，并等待这个进程自己的 API socket。随后面板和 Agent 可以不等 ⌘S 就与它通信；再次打开已连接的会话会复用它，不会重复启动：

* 面板顶部的**实时**指示和**实时**标签页：元件（位号、封装、值、x、y、角度、所在面）、网络和你当前的选择，标签页打开时每 1.5 秒从编辑器读取一次（板子没变时几乎没有开销）。未保存的移动会立刻显示，Δ 列显示自打开标签页以来的变化。坐标与 spec 相同：以板子左上角为原点的 mm。
* `kicad_live_status`（Agent 和面板）：API 是否可达、打开的是哪块板、是否是本会话的板子。不可用时用一句话说明原因并点出设置名；其他标签页和 ⌘S 往返照常工作。编辑器里打开的是另一个文件时，面板会明说，而不是把它当成会话的板子显示。
* `kicad_live_snapshot`（Agent 和面板）：只读返回当前元件、网络、选择和数量。Agent 用它在调整前后读取位置，不再用“原地移动”污染 KiCad 的撤销历史。
* `kicad_live_move_footprint`（仅 Agent）：在打开的编辑器里移动**一个**元件（可选同时设置角度），是 KiCad 里的一个可撤销步骤（⌘Z）。**不会保存任何东西**：你照常按 ⌘S，面板再导入并跑 DRC。只有当编辑器恰好打开的是本会话的板子时才会执行。有意不提供「保存」工具。

**安全。** KiCad API 是本机的 Unix socket（`/tmp/kicad/api.sock`，其他编辑器是 `api-<pid>.sock`）。KiCad 不要求密码或令牌；只有你的 macOS 用户能连接这个 socket 文件，但该用户的**任何**进程都可以：你的 shell、脚本，以及能运行 shell 或 Python 的 ZCode Agent——不管有没有这个插件。协议里有下列全部请求（本插件的测试只实际用过读取和一次移动提交）：这样的进程可以读取整块板子、修改或删除板上任何东西、把板子或副本保存到它能写入的任意路径（`save_as` 可覆盖）、撤销你未保存的编辑、改变选择、运行任意编辑器动作，以及（取决于客户端库）启动导出任务。只在需要时打开该偏好设置。本插件用它读取（文档、元件、走线、过孔、铜区、焊盘、网络、选择）和执行上述唯一的一次提交；它从不保存、还原、删除、改变选择、运行动作或停止 KiCad。只有 `kicad_open_in_kicad` 会启动编辑器。socket 路径和 KiCad 发放的令牌留在服务进程内：不会交给面板页面，也不会出现在工具结果或错误信息里。

## 给其他工具用的 3D 模型

`pcb_export_glb` 把板子导出为带 KiCad 3D 模型的二进制 glTF（`.glb`），存为产物并复制到 `./kicad/out/<名称>.glb`，同时给出元件表：每个元件的位号、封装、位置、朝向、所在面、尺寸和包围盒（板坐标，单位 mm）。文件里每个元件节点就以位号命名（KiCad 10.0.6 上验证），所以 Blender 里看到的是 `U1`、`R3` 等对象；不打开文件也能从元件表得到同样信息。封装没有 3D 模型的元件不在文件里（列在 `parts_without_model`），模型来自 KiCad 库，高度为标称值。`include_copper` 会再加上平面的铜、焊盘、过孔、丝印和阻焊面。

## 在真实 KiCad 里继续编辑

面板里的「在 KiCad 中编辑」（或让 Agent 调用 `kicad_open_in_kicad`）会把当前板子导出到工作区 `./kicad/edit/<名称>/`（一个普通的 KiCad 工程，归你所有），并在所选标准版或华秋版 **KiCad PCB Editor** 的新进程中打开。它直接运行该发行版的精确 `pcbnew`，不会让 Launch Services 复用一个不相关、没有实时 API 的独立编辑器，然后分别校验进程 socket 与目标板是否真正打开。结果会区分 `launched` 和 `live_ready`：工程锁或恢复对话框可能让前者为真、后者为假，`launch_note` 会说明应检查什么。
你在 KiCad 里按 ⌘S，面板会自动导入这次保存（生成新的板子产物并跑 DRC），顶部显示「已在 KiCad 中编辑」；Agent 也可调用 `kicad_sync_edits`。重新打开时不会覆盖你已保存的内容。目前自动启动只支持 macOS。

## 已知问题 / 未证实

* **实时连接的限制：** API 没有「有未保存修改」的请求，也没有变化通知，所以实时标签页只能轮询，分不清已保存和未保存的编辑。它需要 `kicad-python`（首次启动时由 `uv` 拉取；没有它插件照样启动，只是没有实时连接）。已经在 macOS 上用临时板副本分别验证标准 KiCad 10.0.6 和华秋 KiCad 10.0.7 的进程/socket 选择、实时快照、移动 0.25 mm、立即回读和移回原位，整个过程未保存；没有用肉眼判断画布重绘。
* **不是嵌入式编辑器。** 标签页由 `kicad-cli` 渲染，不是 KiCad 自己的画布，并且与 PCB/原理图编辑器窗口彼此独立：编辑仍然经由文件（在 KiCad 里按 ⌘S，面板再导入这次保存）。标签页不会跟随你在 KiCad 里的光标或选择。
* **原理图标签页和 ERC 需要你自己画的原理图。** ERC 使用 KiCad 自带的库表和私有配置，不是你自己的库表：来自自定义库的符号会显示为库警告。多页原理图用下拉选择页面，只试过单页。
* **图层、原理图、元件库是 `kicad-cli` 导出的 SVG**，用 KiCad 默认配色而不是你的主题。较大的原理图每页约 1 MB SVG：猫粮机 rev A 原理图（0.9 MB）已在真实桌面沙箱测试（真实 Electron 宿主、CSP 和桥）里渲染成功；更大的设计没有试过，也没有在 ZCode Dev 窗口里手工试过。
* **GLB**：在示例板（9 个元件，位置/旋转/底面已与 pcbnew 对照）上测试过，元件表只描述有库 3D 模型的元件。网格名是封装名，位号在节点名里。
* **早期版本的设置问题。** 0.4.2 及之前，插件对你自己的 KiCad 设置运行 `kicad-cli version`，KiCad 随后会改写 `~/Library/Preferences/kicad/10.0/kicad_common.json` 里的一个值（文件对话框的起始文件夹）。0.5.0 起所有无界面的 KiCad 命令都使用私有配置；GUI 会有意保留你的设置，包括「Enable KiCad API」。

* **点「在 KiCad 中编辑」提示没有启动 KiCad / PCB Editor 一打开就崩溃（macOS）。** 下载来的 KiCad 可能仍带有 quarantine；macOS 可能阻止它，旧版通过 Launch Services 启动时也可能出现 App Translocation，导致找不到 `libkicommon.*.dylib`。插件会监视自己启动的精确进程；进程退出时显示崩溃原因和修复命令。修复需要你自己在终端执行（它会修改系统安全属性，插件不会代劳）：`xattr -dr com.apple.quarantine /Applications/KiCad`，然后重新点「在 KiCad 中编辑」。面板里的「正在 KiCad 中编辑」横幅只表示编辑会话已创建，请以标题下方的警告行为准。

## 说明

* 交互页面仅用于 ZCode Desktop 的本地工作区；其他入口保留普通工具记录。
* 产物按工作区保存在插件数据目录；导出的文件在工作区 `./kicad/out/`。
* KiCad 工作器（`server/kicad/`）是本插件的一部分，其配置不会读取 `.env` 文件。
* 限制：仅双层板、仅裸板、元件位置由 Agent 给出、不生成原理图文件；DRC 通过不代表电路正确。

## 依赖、网络与副作用

* 需要已安装 **KiCad 10**。默认会在系统/用户 Applications 目录发现标准与华秋版本，并选择符合请求发行版的最新应用；显式填写「KiCad.app 路径」后不会回退。插件调用所选应用的 `kicad-cli`、自带 Python（pcbnew 脚本）并读取其符号/封装库；不打包、不修改 KiCad。
* **Python**：推荐 `uv`，或装有 `fastmcp`、`pydantic`、`numpy` 的 Python ≥ 3.11（实时连接另需可选的 `kicad-python`）。**如果既没有 uv、也没有这样的 Python，或 uv 取不到依赖（首次启动时离线），插件仍会启动：面板能打开并说明缺什么，模型会得到一个工具 `kicad_setup_help`。** uv 以 `UV_NO_CONFIG=1` 运行，所以工作区里的 `uv.toml` 或 `pyproject.toml` 无法改变依赖来源。**网络**：首次启动时 `uv` 会下载这些依赖（加上 kicad-python 及 pynng、protobuf、jsonschema）（本机没有 ≥ 3.11 的 Python 时还会下载 Python）。华秋版中，上述华秋器件数据、解析和模型比较工具会访问 `https://kiapi.eda.cn`，搜索词及请求的制造商/MPN 标识会发送到该接口；比较工具还会从白名单内的华秋文件域名读取所选的两个公共文本模型；没有遥测。
CI 会先准备 Python 运行环境，再开始 60 秒的 MCP 握手。依赖准备日志写入 stderr；运行环境不可用时，产物检查会失败，不会把缺依赖的帮助面板当作正常服务。也可以在已安装插件目录运行 `node dist/server.mjs --prepare-runtime`，成功时 stdout 返回 `ready`。产物检查使用同一个隔离 HOME 和缓存的 Python 环境，以离线模式完成握手。

* **执行的命令**：`kicad-cli`（DRC、渲染、SVG/GLB/STEP/Gerber 导出、`sch erc`、符号/封装 SVG）、KiCad 自带 Python、`uv`；只有当你点「在 KiCad 中编辑」或 Agent 调用 `kicad_open_in_kicad` 时，才会执行所选发行版的 `PCB Editor.app/Contents/MacOS/pcbnew <板子>`（macOS）。启动器会监视这个精确子进程及其 `api-<pid>.sock`；启动失败后可能只读地执行 `xattr -p com.apple.quarantine` 并查看 `~/Library/Logs/DiagnosticReports/pcbnew-*.ips`。插件本身不会修改隔离标记。
* **读取的文件**：除你的板子和 KiCad 库外，只读地读取 `~/Library/Preferences/kicad/*/kicad_common.json` 里「Enable KiCad API」的值（用来告诉你 API 是否打开）。**Socket**：只有当面板打开且显示着一块板子时，它每 3 秒问一次 KiCad 的 API 是否应答（一次 ping 和已打开文档列表，不含板子数据）来画实时指示，实时标签页每 1.5 秒读一次板子；Agent 的 `kicad_live_*` 调用连接的是同一个本机 socket（见上面的安全说明）。面板关闭、也没有 Agent 调用时，不会连接。
* **写入的文件**：工作区的 `./kicad/`（spec、导出文件含 `kicad/out/<名称>.glb`、`kicad/edit/<名称>/` KiCad 工程）和插件数据目录（产物库、标签页视图缓存、KiCad 私有配置）。文件类工具（`pcb_spec_example`、`kicad_check_spec_file`、`kicad_export_files`、GLB 导出）只使用工作区内的路径（符号链接会被解析，越出工作区的路径被拒绝）；`pcb_spec_example` 不会替换与示例不同的 spec，除非 `overwrite=true`；`kicad_open_in_kicad` 从不覆盖 `kicad/edit/` 里已有的板子，而是在旁边新建 `<名称>-r2`、`-r3`……随包的工作器不读取 `.env` 或其他配置文件。没有 Hook。

## 第三方

KiCad（GPL-3.0-or-later；其库为 CC-BY-SA-4.0 并带例外条款）使用你本机的安装，不随包分发。华秋版会就地使用华秋 KiCad 安装内的 `@huaqiu/part-search`（Apache-2.0），本插件不再分发该库。`uv` 在运行时拉取：fastmcp（Apache-2.0）、pydantic（MIT）、numpy（BSD-3-Clause 等）、kicad-python（MIT）及 pynng（MIT）、protobuf（BSD-3-Clause）、jsonschema（MIT）。面板打包了 MCP Apps SDK 相关包，其许可证随构建产物放在 `dist/THIRD_PARTY_NOTICES.txt`。
本插件独立于 KiCad 项目，与其无隶属或背书关系；「KiCad」仅用于说明兼容性。
