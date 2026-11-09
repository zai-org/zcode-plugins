# Craft 插件中文字体与默认语言验证

2026-10-12，本地版本 **0.2.2**。这份记录对应中文字体和默认语言改动；早期 0.1.0 的记录保留在 [原验证报告](craft-ui-validation.md)。

## 最终行为

9 个插件都内置未修改的 **LXGW WenKai Regular（霞鹜文楷）**，字体直接嵌入 WASM。界面字体栈重建后仍保留中文回退；具备独立文档字体数据库的 7 个应用也加载该字体。使用时不依赖系统字体或联网下载。

| 插件 | 首次使用的界面语言 | 中文验证 | 浏览器 / Electron 沙箱 |
| --- | --- | --- | --- |
| PhotoCraft | 简体中文 | Inter 缺字回退、指定霞鹜文楷、PSD 保存/重开/继续编辑、PNG 导出、语言和主题切换 | 通过 / 通过 |
| VectorCraft | 简体中文 | 默认字体缺字回退、文字对象和图片渲染 | 通过 / 通过 |
| PdfCraft | 简体中文 | 中文界面、文档名称及元数据 | 通过 / 通过 |
| DesignCraft | 简体中文 | 指定霞鹜文楷、启用字形回退两种路径；preflight 无缺字；页面渲染 | 通过 / 通过 |
| WordCraft | 简体中文 | DOCX 保存/重开、正文读取、render_page 中文图片 | 通过 / 通过 |
| GridCraft | 简体中文 | 单元格中文、XLSX 保存/重开 | 通过 / 通过 |
| DeckCraft | 保持上游英文界面 | 幻灯片中文标题、正文和图片渲染 | 通过 / 通过 |
| CADCraft | 保持上游英文界面 | 默认笔画字体的中文回退；汉字换序前后图片不同，排除相同缺字方块 | 通过 / 通过 |
| SoundCraft | 保持上游英文界面 | 中文会话名、界面文字 | 通过 / 通过 |

只有已有中文翻译的 6 个应用修改了 Web 初始语言。没有增加翻译条目，也没有增加宿主语言同步、localStorage 覆盖或自定义偏好保存逻辑。已有语言设置继续由上游加载；原来存储的 Auto/English 可能继续生效。

DesignCraft 默认关闭文档的 `glyphFallback`。中文正文应选择 `LXGW WenKai`，或启用应用自己的字形回退；原有排版规则保持不变。PdfCraft 的 `doc_create(from: text)` 和 `page_add_text` 仍只接受 WinAnsi，内置字体不改变这些 API 的限制。

## 来源与范围

字体使用 SIL OFL 1.1，来源、提交及原始文件 SHA-256 记录在 [字体来源](../ui-plugins/craft-runtime/fonts/provenance.json)。字体与许可文件哈希均已核对，许可及来源随每个插件放入 `dist/licenses/fonts/`。字体 cmap 含 46,490 个映射码点，覆盖基本 CJK 区全部 20,992 个字符；简繁中文、日文和韩文测试样本均有字形。这不代表覆盖所有 Unicode 字符或还原缺失专有字体的原始字形。

上游提交不变。语言与 CAD 文档字体筛选补丁、字体字节和共享构建覆盖代码都计入快照来源记录；原始上游 checkout 保持干净。9 个 WASM 均在本地重新编译，各插件的 manifest、市场条目、源码包版本及安装产物版本均为 0.2.2。

## 验证

- 9 个插件各自执行 `pnpm --filter @zcode/plugin-<name> build:web`；`pnpm build` 通过。
- `node ui-plugins/craft-runtime/browser-smoke.mjs`：9/9 通过。使用全新 Chrome 进程、复制后的独立插件、真实 WASM、英文宿主 locale、SDK AppBridge 与受 CSP 限制的 iframe。
- `ZCODE_SOURCE_ROOT=/path/to/z-code node ui-plugins/craft-runtime/electron-smoke.mjs`：9/9 通过。使用 ZCode 提交 `46f48380517db433f4ef701d9e43f2fdf01c5ab3` 的真实隔离沙箱注册、协议与 CSP 源码；相关源码文件无本地改动。每轮测试使用新测试 profile，避免旧偏好污染首次语言检查。
- 每套运行时验证都执行 152 次 MCP 调用，涵盖编辑、保存、重开和中文场景；334 个上游工具定义仍保持接入。并非逐一执行全部 334 个工具。
- `pnpm test`：99 项 JS/Node 测试通过；`pnpm typecheck` 通过。
- `pnpm lint`：0 错误，Blender fake engine 中保留 1 个已有警告。
- `python3 scripts/validate.py`：23 个插件通过。
- `python3 scripts/build_dist.py` 及 `python3 -m unittest discover -s tests`：12 项测试通过，包含 ZIP 确定性与路径安全。
- `pnpm marketplace:local` 后 `pnpm test:artifacts`：14 个 UI 插件独立安装产物均通过。ZIP 构建会重建 `dist/`，因此本地市场在 ZIP 验证之后重新生成。
- `git diff --check` 通过。

运行时 JSON 和截图位于 `.craft-cache/browser-results/`、`.craft-cache/electron-results/`；编译和校验日志位于 `.craft-cache/chinese-build/`。这些本地诊断产物不提交。

沙箱测试使用真实协议实现及独立测试壳，没有向用户正在运行的 ZCode 安装插件，也没有操作生产环境的原生“另存为”对话框。验证范围不包括全部文档格式、每个 Unicode 字符、全部语言条目、跨会话恢复或外部软件中的字体替代效果。
