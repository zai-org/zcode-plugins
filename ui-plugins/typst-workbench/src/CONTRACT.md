# Typst 工作台：owner 与端口

插件 MCP server（Node）是本机 `typst` 命令行的唯一调用者：查找 typst、长期运行一个 `typst watch`、保存 PDF 快照与诊断、持有面板视图与 Agent 高亮。页面和模型都只经它读写；页面不接触文件系统，插件不修改任何 `.typ` 文件（编辑由 Agent 自己的文件工具完成）。

## 分层

- `typst/locate.ts`：查找 typst——插件设置 `typstPath` → `PATH` → 常见安装位置（Homebrew、cargo、~/.local/bin、Nix、Snap、WinGet、Scoop…）→ 用户的登录 shell（`$SHELL -lc` / `-ilc` `command -v typst`，为 mise、asdf 等版本管理器）。`typst --version` 解析版本，低于 `MIN_TYPST`（0.12，`--pages` 引入的版本）为 `too_old`。
- `host/facts.ts`：本机事实：系统、架构、包管理器（Homebrew、winget、Scoop、cargo…）与版本，供设置页与交给 Agent 的消息使用。只读探测，每一项失败只是缺省。
- `typst/diagnostics.ts`：纯函数。解析 human 诊断格式（short 格式不含 hint）：`error|warning: …`、`┌─ 文件:行:列`、`= hint: …`，`help:` 是前一条诊断的调用栈。`WatchLog` 逐块读取 `typst watch` 的 stderr：`[时间] compiling ...`、`compiled successfully|with warnings in N ms`、`compiled with errors`，诊断跟在后面，直到下一轮的 `watching …` 或输出静止 25 ms。`parseDeps` 读 `--deps`（0.14+，JSON）或 `--make-deps`（更早，Makefile）。
- `typst/watcher.ts`：一个 `typst watch <主文件> <构建目录>/preview.pdf --deps …`，工作目录为工作区根目录（与用户在终端里运行时相同：项目根为主文件所在目录，诊断路径相对工作区）。独立进程组，结束时连同进程组一起结束；server 退出（含异常）时同步结束。进程号记在构建目录的 `watch.pid`：server 被强制结束（SIGKILL）时，遗留的 watch 在下一次编译写 stderr 失败时自行退出，下一个会话启动时 `reapOrphans` 也会结束它（只结束命令行含该构建目录的进程）并删除目录。启动前删除旧的输出。事件按到达顺序串行处理；“编译结束”在读入新 PDF 之后才报告。PDF 是否更新以文件为准（修改时间 + 大小变化、`%%EOF` 表示写完），所以状态行格式变化时预览仍会更新。
- `typst/oneshot.ts`：一次性 `typst compile`：`render_pages`（`--pages`、`--ppi`，PNG 到构建目录再读回）与 `export_pdf`（写到工作区）。
- `pdf/extract.ts`：pdf.js（legacy 构建，worker 在主线程）读页数与逐页文本项（定位高亮）。
- `domain/text.ts`：取自 zotero 插件：PDF 文本拼接、引文匹配（NFKC、引号与连字符统一、断词合并、空白折叠）、文本项内按字宽插值的矩形。
- `domain/match.ts`：渲染文字 ↔ 源码。两边化为骨架（NFKC、小写、只留字母数字），短文本要求完全一致；长文本取 8 字符种子串，把位置一致（允许源码多出标记、渲染结果多出编号）的种子串成链，取覆盖最多的一条。`locateInSources` 先定位上下文（点击行的上下各一行），再在附近找点击的那一行。
- `domain/project.ts`：扫描工作区的 `.typ`（深度 4，跳过隐藏目录、node_modules、target）；选主文件：记住的选择 → 根目录 main.typ → 根目录唯一的 .typ → 最浅的唯一 main.typ → 全部只有一个。
- `domain/format.ts`：诊断的文字形式（工具结果与面板发到对话的消息共用）。
- `app/session.ts`：`TypstSession` 组合以上部分：启动（第一次调用工具或面板订阅 state 时）、设置页（本机事实、`recheck` 重新查找、`handoff`、面板订阅期间每 3 秒重新查找，每第 5 次连同登录 shell；找到可用的 Typst 后扫描文件并开始预览）、主文件（按工作区真实路径记在插件数据目录 `main-files.json`）、`check` 的等待、快照、高亮、视图与路径检查。
- `adapters/`：MCP 工具与资源；`console.ts` 必须最先导入（pdf.js 加载时用 console.log 输出警告，不能写进 stdout）。

## 一致性

- **check 的等待**：取 typst 报告的依赖（还没有时取主文件与全部 .typ）的最新修改时间 `inputs`。编译不在进行、且最近一次结束的编译开始于 `inputs` 之后时返回；否则等下一次编译结束。没有编译在进行、1.5 秒内也没有开始时，认为 watch 漏掉了修改，重启它一次（重启后的第一次编译读取全部文件）。watch 退出时重启一次，再退出则报告原因。
- **快照**：每次 PDF 内容（sha256）变化，`seq` 加一。内存中保留最近 3 份；页面按 `ui://typst-workbench/pdf/{seq}/{part}` 读取 2 MiB 分块，同一 `seq` 的字节不变，所以不会混读两次编译。编译失败时 typst 不写 PDF，预览保留最后一份成功的。
- **高亮**：位置用 PDF 用户空间矩形，带所在快照 `seq`。新快照后按高亮的原文重新定位；找不到时 `stale`（面板不显示）。面板只画 `seq` 与当前显示的快照相同的高亮。
- **视图**：`show` 写入 `view` 并递增 `viewSeq`；页面以 widget state 记住已处理的 `viewSeq` 与阅读偏好（缩放、大纲、问题面板、所在页），重建后不重复跳转。
- **状态通知**：state 变化后 30 ms 内向订阅者发送 `notifications/resources/updated`（`ui://typst-workbench/state.json`）。宿主不支持订阅时页面每秒轮询。
- **路径**：工具接受的路径按工作区真实路径（解析符号链接）检查，越界时拒绝。诊断路径相对工作区；包内文件保留 `@preview/…` 形式。

## 工具

| 工具 | 调用方 | 说明 |
| --- | --- | --- |
| `status` | model, app | 工具链、主文件、其他 .typ、编译结果；打开侧栏 |
| `set_main` | model, app | 选择主文件并重启预览；打开侧栏 |
| `check` | model, app | 等最新修改编译完，返回诊断（文件:行:列、源码行、hint、调用栈） |
| `render_pages` | model, app | 一次性编译为 PNG（最多 4 页，36–300 ppi）；返回图片 |
| `show` | model, app | 滚动到页，或高亮引文 / 源码行（带注释）；打开侧栏 |
| `clear_highlights` | model, app | 移除高亮 |
| `export_pdf` | model, app | 一次性编译 PDF 到工作区（可选 `--pdf-standard`、`--pages`） |
| `locate_source` | app | 选中或点击的渲染文字 → 源码位置 |
| `panel_set_main` | app | 面板的主文件选择器（不等待编译） |
| `restart` | app | 重新查找 typst 并重启预览 |

所有工具带 `_meta.ui = { resourceUri: PANEL_URI, surface: "typst" }`。

## 资源

- `ui://typst-workbench/panel.html`：单文件页面，声明 `zcode/csp.wasmUnsafeEval`（pdf.js 的 wasm 解码器）。
- `ui://typst-workbench/state.json`：`SessionState`，可订阅；读取时（最多每 2 秒）重新扫描 .typ 文件，主文件被删除或新建时随之更新。
- `ui://typst-workbench/setup/{op}/{nonce}`：设置页操作，返回 `SessionState`。`check` 立即重新查找 Typst；`handoff` 记下已交给 Agent。
- `ui://typst-workbench/pdf/{seq}/{part}`：快照分块。
- `ui://typst-workbench/pdfjs/{kind}/{file}`：pdf.js 的 CMap、标准字体与 wasm。

## 设置页

缺少本机程序时，面板显示同一套设置页（三个插件共用 `ui/setup-kit.tsx` 与 `ui/setup-kit.css`，颜色经 `--su-*` 映射到各自的 token）：

- **要求清单**：每一项要求一行，状态为满足 / 缺少 / 等待上一步 / 正在检查 / 失败；未满足的行右侧总有一个词（不只靠颜色）。缺少时说明查找过的位置，页脚列出本机系统、架构与包管理器（`host/facts.ts`，只读探测）。
- **交给 Agent**：按检测到的事实生成一条消息（开头、灰色的事实、步骤、结尾），发送前完整可见；**发给 Agent** 用 `sendMessage` 以用户名义发到对话，**复制**同样的纯文本可交给任意 Agent。宿主不支持发消息时，复制是主要操作。
- **已交给 Agent**：发送后读取 `setup/handoff/{nonce}`，server 记下时间（`setup.handoffAt`）；所有页面（含对话卡片）据此显示“正在设置”，第一个未满足的要求显示为正在检查。要求满足或 30 分钟后清除。
- **自动前进**：面板订阅 `state.json` 期间 server 定时重新检查，满足后状态通知页面；“重新检查”读取 `setup/check/{nonce}` 立即检查。两者都是资源读取：宿主对页面发起的工具调用要求审批，读取资源不需要。

Typst 的要求：Typst 命令行（查找顺序见上）、版本不低于 `MIN_TYPST`。在这个页面里装好时，先短暂显示“已就绪”，再进入预览。

## 页面

- 只用官方 MCP Apps SDK，一个 App、一次连接，处理器先于连接注册。数据全部来自资源，可随时重建。
- 新快照加载完成后才替换旧的；每页在新画布上绘制，完成后替换旧画布，文字层同样处理，所以编辑时不闪烁。换快照、缩放或容器尺寸变化后按“视口顶部所在页 + 页内比例”恢复位置。程序滚动（跳页、跳到高亮）立即更新这个锚点。
- 选中文字：浮动工具条显示对应的源码位置；“加入对话”用 `updateModelContext`，“提问”用 `sendMessage`。⌘ / Ctrl + 点击一行：浮层显示源码位置与摘录。宿主没有“在编辑器中打开文件”的接口，所以位置只显示与发送到对话。
- 问题面板：有错误时自动展开（用户可收起），显示最后一次成功的版本（变暗）；“让 Agent 修复”发送全部诊断。

## 安全

- 插件只运行用户自己的 typst（或设置中指定的可执行文件）。插件本身不访问网络；typst 下载 `@preview` 包与在终端中运行时相同。
- 只在工作区内写文件（`export_pdf`）；预览与渲染的中间文件在插件数据目录（没有时为系统临时目录），关闭时删除；所属 server 已不存在或一天以前的构建目录在启动时清理。
