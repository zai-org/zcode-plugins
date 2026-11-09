# ZCode Jupyter Notebook 插件

简体中文 | [English](README.md)

在会话侧栏和 Agent 一起使用 Jupyter Notebook。Agent 通过 MCP 工具新建、编辑、运行 cell；你在交互式面板里编辑和运行同一个 notebook，双方的修改实时可见。

Git 市场安装包已包含编译好的 MCP server 和面板，无需自行构建。需要 Node.js 24+、支持插件 UI 的 ZCode 桌面端本地工作区，以及一个 Jupyter Server：可以是你已经在运行的，也可以由插件用装有 `jupyter-server` 与 `ipykernel` 的 Python 启动。Web、手机和远程工作区只显示普通工具记录，不显示面板。

## 使用

安装并启用 `jupyter-notebook` 后，可以这样说：

- “新建一个 notebook，读取 data.csv 并画出每月合计。”
- “连接我的 JupyterLab http://127.0.0.1:8888/lab?token=…，打开 analysis.ipynb。”
- “从头重新运行这个 notebook，告诉我结果有什么变化。”

也可以从侧栏的“+”菜单打开面板。

### Server

- **已在运行的 server**：本机运行的 JupyterLab、Notebook 7 和 `jupyter server` 会被自动发现，无需 token 即可连接。其他 server（包括远程的）通过 URL 和 token 连接（`connect_server` 或面板中的表单）。token 只保存在插件进程内，不会出现在 Agent 或面板中。
- **为工作区启动 server**：`start_server`（或面板中的启动按钮）运行 `python -m jupyter_server`，只绑定 `127.0.0.1`，使用随机 token，根目录为工作区。按顺序使用第一个装有 `jupyter-server` 与 `ipykernel` 的 Python：插件设置“Python 解释器”、工作区 `.venv` / `venv`、当前激活的 virtualenv 或 conda 环境、PATH 中的 `python3`。插件不会自动安装任何东西；`start_server` 传 `useUv: true` 时改用 `uv run --with jupyter-server --with ipykernel` 运行。会话结束时 server 随之停止。
- 若同一 server 上的 JupyterLab 已打开该 notebook，面板会加入它的 kernel。

### 面板

- **安装引导**：没有运行中的 server、且工作区的 Python 缺少 `jupyter-server` 或 `ipykernel` 时，面板在你点“启动”之前就检查，并列出项目 Python（以及是否由 uv 管理）和每个包。**发给 Agent** 发出一条带正确安装命令的消息（uv 项目用 `uv add --dev …`，否则用 `pip`），由 Agent 安装并启动 server；*自己安装*给出命令以及“只在本次会话中使用 uv”。面板每隔几秒重新检查，包装好后自动进入下一步。通过 URL 连接已在运行的 server 不需要本机安装。
- 面板跟随 ZCode 主题：颜色、字体与浅色 / 深色模式都取自宿主。
- 头部只有一行：点 notebook 名称可切换已打开的 notebook、打开或新建 notebook；点 kernel 状态打开 kernel 菜单。
- 代码、Markdown、Raw cell，语法高亮；Markdown 支持 LaTeX 公式。
- 每个 cell 会注明 Agent 何时修改过它、是否正在运行它；左侧显示 cell 已运行、运行中、排队中或出错。
- 运行中的 cell，运行按钮变成转动圆环里的停止键；排队的 cell 标出先后。全部运行时 kernel 状态显示“正在运行 3 / 5”；运行中的 cell 不在视野内时，面板底部的提示条可以带你过去。
- 输出：带 ANSI 颜色的文本、HTML（如 pandas DataFrame 表格）、图片、SVG、Markdown、LaTeX、JSON。错误先显示异常和你的 cell 中出错的那一行，完整 traceback 点一下即可展开。HTML 经过清洗，输出中的脚本不会执行，因此交互式 JavaScript 输出（如 Plotly）和 ipywidgets 显示其静态替代内容。
- Jupyter 快捷键：Shift+Enter / Ctrl+Enter / Alt+Enter 运行；Esc 与 Enter 切换命令 / 编辑模式；A / B 插入，D D 删除，M / Y / R 切换类型，I I 中断，0 0 重启。
- Kernel 菜单：中断、重启、重启并全部运行、清除输出、更换 kernel。
- **在对话中引用**（@）把 cell 加入 Agent 上下文；出错的 cell 上 **让 Agent 修复** 会把错误发到对话。
- notebook 经 server 自动保存。若你有未保存的修改时文件在服务器上被改动（例如在 JupyterLab 中），面板会询问保留你的版本还是载入对方的。你正在输入的 cell 被 Agent 修改时，面板可以对比两个版本，由你选择。

### 工具

| 工具 | 用途 |
| --- | --- |
| `list_servers`、`connect_server`、`start_server`、`stop_server` | 发现、连接、启动、停止 Jupyter Server |
| `list_notebooks`、`open_notebook` | 浏览、打开或新建 notebook（打开面板） |
| `read_notebook`、`edit_notebook` | 读取 cell 与输出；插入、修改、移动、删除 cell 或切换类型 |
| `execute_cells` | 运行 cell 并返回输出，图表以图片返回；长时间运行会在后台继续 |
| `interrupt_kernel`、`restart_kernel`、`list_kernelspecs`、`set_kernel` | Kernel 控制 |
| `save_notebook` | 解决保存冲突 |

kernel 中运行的代码拥有 kernel 所属用户的全部权限；ZCode 按配置在工具调用前请求审批。

## 从源码构建

源码位于 `ui-plugins/jupyter-notebook`。在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm build
```

在插件商店中把 `dist/local-marketplace` 的绝对路径添加为本地市场，然后安装并启用 `jupyter-notebook`。源码修改后需重新构建、刷新来源、重新安装插件，并在新会话中测试。

测试（在 `ui-plugins/jupyter-notebook` 下运行；集成、冒烟和浏览器测试会用 `uv` 创建私有 Python 环境）：

```sh
pnpm test               # 单元测试
pnpm test:integration   # 真实 Jupyter Server
pnpm smoke              # 构建后的 MCP server（stdio）
pnpm test:e2e           # Chrome 中经官方 AppBridge 宿主运行面板
pnpm test:setup         # 在 Chrome 中用缺少依赖的真实 uv 环境测试安装引导
```
