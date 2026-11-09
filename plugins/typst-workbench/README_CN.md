# Typst 工作台（ZCode 插件）

简体中文 | [English](README.md)

和 Agent 一起写 Typst 文档，在侧栏实时看到排版结果。插件使用**你电脑上安装的 Typst**——你的字体、已下载的包和你的 Typst 版本——所以预览与在终端里运行 `typst compile` 的结果一致。无论是你还是 Agent 保存了文件，预览都会在一瞬间更新。Agent 能拿到带文件、行号和提示的 Typst 错误，以图片查看渲染后的页面，在你的预览中标出位置，并导出 PDF。你可以在预览中选中文字，连同它对应的源码行一起发给 Agent。

Git 插件市场中的安装包已包含编译好的 MCP server 与面板，无需构建。需要：

- Node.js 24+，以及支持插件界面（Plugin UI）的 ZCode 桌面版和本地工作区（网页、手机和远程工作区只显示普通的工具调用记录，没有面板）；
- 同一台电脑上安装 **Typst 0.12 或更高版本**，例如 `brew install typst`（macOS）、`winget install --id Typst.Typst`（Windows）、`cargo install --locked typst-cli`，或从 <https://github.com/typst/typst/releases> 下载。

插件依次在 `PATH`、常见安装位置（Homebrew、Cargo、`~/.local/bin`、Nix、Snap、WinGet、Scoop）以及你的登录 shell（用于 mise、asdf 等版本管理器）中查找 `typst`。如果 Typst 装在其他位置，请在插件设置中填写 **Typst 路径**。

## 使用

安装并启用 `typst-workbench`，然后可以这样说：

- “用 Typst 新建一篇双栏论文，带标题区和摘要。”
- “修复我论文里的错误，并把改动的地方指给我看。”
- “第 3 页的表格超出版心了，让它放得下。”
- “把 `paper.pdf` 导出为 PDF/A-2b。”

也可以从侧栏的“+”菜单打开面板。

### 面板

- **安装引导**：Typst 未安装、版本过旧或无法运行时，面板列出检测结果（以及查找过的位置）、你的系统与包管理器，并准备好一条消息——**发给 Agent** 把它发到对话中，由 Agent 安装（**复制**可交给任意其他 Agent）。*自己安装*给出适合你系统的命令。面板每隔几秒重新检查，Typst 能运行后立即打开预览。
- **实时预览**主文件。每次保存都由 `typst watch` 增量编译，可见的页面原地重绘——不闪烁，滚动位置保持不变。支持缩放（适应宽度、适应页面或百分比）、页码框，以及按标题生成的**大纲**。
- **主文件**：自动选择（`main.typ`，或唯一的 `.typ` 文件）；可在工具栏的文件菜单中切换，选择会按工作区记住。有多个候选且无法判断时，面板会请你选择。
- **状态与问题**：工具栏显示“正在编译”、编译耗时，或错误与警告的数量。文档无法编译时，仍显示最后一次成功的版本（变暗），**问题**面板列出每个错误的位置、源码行、Typst 的提示与调用栈。**让 Agent 修复**把它们发给 Agent；**加入对话**把它们加入 Agent 的上下文。
- **选中文字 → 源码**：在预览中选中文字，弹出的工具条会显示它来自哪里（如 `sections/intro.typ:12`）。**加入对话**把这段文字和对应的源码行加入 Agent 的上下文；**提问**把你的问题连同它们一起发送。**⌘+点击**（Windows 与 Linux 上为 Ctrl+点击）一行文字，可查看它的源码位置与摘录。
- **Agent 高亮**（紫色，标有 ✦）显示 Agent 指出的地方；点击可查看说明或将其移除。
- 跟随 ZCode 的主题（浅色 / 深色）与语言（英文 / 简体中文）。

源码位置通过把渲染出的文字与 `.typ` 文件比对得到，因为 Typst 命令行不提供输出与源码之间的对应关系。对普通文字很可靠，对公式、编号、目录、参考文献和由函数生成的文字只是近似。ZCode 没有为面板提供在编辑器中打开文件的接口，所以位置只会显示并发送到对话中。

### 工具

| 工具 | 用途 |
| --- | --- |
| `status` | Typst 版本与路径、主文件、其他 `.typ` 文件、最近一次编译结果；打开面板 |
| `set_main` | 选择主 `.typ` 文件 |
| `check` | 等所有已保存的修改编译完成，报告错误与警告（位置、源码行、提示、调用栈） |
| `render_pages` | 把最多 4 页渲染为 PNG 图片供 Agent 查看 |
| `show` | 把预览滚动到某一页，或高亮渲染出的文字或某些源码行的输出，并附说明 |
| `clear_highlights` | 移除 Agent 的高亮 |
| `export_pdf` | 编译 PDF 到工作区（可选 PDF 标准与页面范围） |

### 权限、隐私与网络

- 插件以工作区为工作目录运行你的 `typst`（或 *Typst 路径* 中设置的文件），与你在终端中运行完全一样：项目根目录为主文件所在目录，ZCode 环境中的 `TYPST_ROOT`、`TYPST_FONT_PATHS` 与 `TYPST_PACKAGE_PATH` 同样生效。
- 插件从不修改 `.typ` 文件。只有 Agent 调用 `export_pdf` 时才写入工作区，且只写在工作区内。预览用的 PDF 与渲染的图片保存在插件的私有数据目录中，会话结束时删除。
- 插件本身不访问网络。Typst 第一次使用 `@preview` 包时会下载它们，与在终端中一样。
- ZCode 会按配置在调用工具前请求批准。

## 从源码构建

源码位于 `ui-plugins/typst-workbench`。在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm build
```

在插件商店中把 `dist/local-marketplace` 的绝对路径添加为本地市场，然后安装并启用 `typst-workbench`。修改源码后，重新构建、刷新来源、重新安装插件，并在新会话中测试。

测试（在 `ui-plugins/typst-workbench` 中运行）：

```sh
pnpm test        # 单元测试、用模拟的 typst 命令行测试每个工具，以及用本机 Typst 测试主要流程
pnpm test:e2e    # 在 Chrome 中通过官方 AppBridge 宿主测试打包后的 server 与面板（使用本机 Typst）
pnpm test:setup  # 在 Chrome 中测试安装引导：缺少 Typst、交给 Agent、Typst 出现（模拟）
TYPST_TEST_BINARY=/path/to/typst pnpm test   # 用另一个 Typst 版本运行真实 Typst 测试
```
