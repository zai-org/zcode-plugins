# Archify 侧栏画板（archify-panel）

<p align="center">
  <img src="assets/icon.png" alt="Archify 侧栏画板" width="120" />
</p>

[Archify](https://github.com/tt-a1i/archify) 的 ZCode 侧栏适配：本插件打包 Archify v3.2.0 图形引擎，把架构图、流程图、时序图、数据流、状态机、ERD、类图、树、时间线、瀑布图带进 ZCode 侧栏面板，支持完整交互与导出。

> 源仓库：[tt-a1i/archify](https://github.com/tt-a1i/archify) —— 上游图形引擎（Apache-2.0）。

> English documentation: [README.md](README.md)

## 功能

- Agent 出图：用自然语言描述，Agent 调用内置 Archify 运行时完成渲染
- 侧栏交互：渲染结果直接在 ZCode 侧栏面板中以完整交互模式打开
- 导出：从图形自带的导出菜单导出 PNG、SVG 与分享卡片，落盘到工作区

## 安装

在 ZCode 插件市场安装：**设置 → 插件 → 插件市场**，搜索 Archify 安装即可。

## 使用

安装后直接让 Agent 画图，例如：

- 「用架构图画出这个仓库的前后端结构」
- 「画一张登录请求的时序图」

Agent 会通过内置技能 `archify-panel` 完成渲染，产物自动在侧栏面板打开。

## 安全与副作用

- **MCP 服务**：注册本地 stdio MCP 服务 `archify`，提供图形渲染相关工具
- **文件写入**：渲染产物写入工作区 `.archify-panel/`（导出文件在 `exports/` 子目录）
- **浏览器调用**：渲染管线的测量环节会启动本机浏览器完成尺寸测量，数据不出本机
- **网络访问**：无。渲染完全在本地进行，不调用外部服务
- **遥测**：无

## 从源码构建

插件源码在本仓库 `ui-plugins/archify-panel/`，安装目录内容（`dist/` 与 `vendor/`）由仓库统一构建生成：

```bash
pnpm install --frozen-lockfile
pnpm build
```

构建产出 `dist/server.mjs` 与 `dist/ui/panel.html`，`vendor/` 由 stage 脚本复制进安装目录。

本地测试（需先构建）：

```bash
node ui-plugins/archify-panel/test/smoke.mjs /tmp/archify-smoke     # 服务端：出图、读产物
node ui-plugins/archify-panel/test/panel-run.mjs                   # 面板：模拟宿主下走一遍导出链路
```

### 本地开发（inline 加载）

不经过市场、直接开发调试时，可在 `~/.zcode/cli/config.json` 用 `plugins.dirs` 直接加载插件目录：

```json
{ "plugins": { "dirs": ["/绝对路径/archify-panel"] } }
```

- **路径必须写绝对路径**。桌面端能展开 `~/`，命令行工具不能。
- **`plugins.dirs` 的每一项本身就是一个插件根目录**（直接含 `.zcode-plugin/plugin.json`），不是包含多个插件的父目录。
- **不要同时从市场安装本插件。** 宿主的插件去重键是 `名称@市场`，`archify-panel@inline` 与 `archify-panel@某市场` 是两个不同的键，两份都会被加载 —— MCP 服务会起两个进程，侧栏面板注册两次，技能重名。

## 结构

```text
.zcode-plugin/plugin.json     插件清单：MCP 服务 + 侧栏面板声明
skills/archify-panel/SKILL.md Agent 写图与调用面板的说明
dist/                         构建产物：MCP 服务端与面板前端
vendor/archify/               打包的 Archify 运行时（Apache-2.0）
assets/icon.png               插件标识
```

源码（`src/`、`test/` 与构建脚本）位于本仓库 `ui-plugins/archify-panel/`。

## 工作原理

Agent 调用 `render_diagram`，服务端跑 Archify 的 `finalize`（校验、交付、静态检查、浏览器测量四道关卡），产物落盘到工作区 `.archify-panel/` 并登记为当前图。侧栏面板通过 MCP 资源读取产物 HTML，以完整交互模式塞进内层 iframe 的 `srcdoc`；面板薄壳不渲染任何工具栏，只保留底部状态栏。

导出走图形自带的「导出」菜单。沙箱 iframe 里浏览器会拦截原生下载，所以面板常驻一条导出桥接：截获产物导出产生的二进制，经 `save_export` 落到工作区 `.archify-panel/exports/`，并请求宿主弹出另存为。

## 上游与第三方组件

- 上游源仓库：[tt-a1i/archify](https://github.com/tt-a1i/archify)。打包运行时为 Archify v3.2.0，Apache-2.0（过渡前的历史 MIT 授权仍有效）。详见 [NOTICE.md](NOTICE.md)，含按 Apache-2.0 第 4(b) 条声明的修改。
- `@modelcontextprotocol/sdk` 与 `@modelcontextprotocol/ext-apps`（MIT）：构建期依赖，打包进 `dist/`。
- 图标为本插件原创生成，不使用 Archify 的商标与标识。

本插件与 Archify 官方无隶属关系，也未获其背书。

## 许可

Apache-2.0
