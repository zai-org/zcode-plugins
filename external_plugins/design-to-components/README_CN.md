# 设计稿转组件库

把设计稿或截图做成 **React 组件库**。面板里维护设计变量和组件清单，Agent 编写 TSX 组件，插件负责类型检查，把每种状态渲染出来与设计稿并排对照，并生成可交互的组件目录页。

## 功能

- **设计变量**（`dc_tokens`）：颜色、字体、字号、圆角、间距、阴影都存在 `tokens.json` 里。插件据此生成 `tokens.css`（`--color-primary`、`--font-size-md`、`--radius-md`、`--space-4` 等）和带类型的 `tokens.ts`。面板里可以用取色器直接修改。
- **组件清单**（`dc_plan`）：列出每个组件需要的状态（例如 Button：primary、secondary、disabled、loading）。面板显示哪些已经写好、能否编译（✓ / ✗ / ○）。
- **组件**（`dc_write`）：`src/<名称>.tsx`（可配 `src/<名称>.css`）。每个文件导出组件本身和 `examples`，每种状态一个示例。文件都直接放在 `src/`；写成 `src/components/<名称>/<名称>.tsx` 也可以，会自动平铺。
- **每次写入都会检查**：
  - **TypeScript strict** 类型检查（使用 React 19 类型）。
  - 用 esbuild 打包：只能引用 `react` / `react-dom` 和组件库里的文件。
  - 渲染每个示例，渲染出错会直接显示。
  - 必须有同名导出；清单里每种状态都要有对应示例。
  - 提示应该改用设计变量的**写死颜色**。
- **预览**：每个示例都用真实 CSS 渲染，与设计稿并排显示。
- **组件目录页**：`catalog/index.html` 是一个自包含的交互页面（用 esbuild-wasm 把 React 和你的组件打包在一起），通过 `file://` 直接打开也能用。另外生成 `index.ts`，统一导出所有组件。

## 用法

在 ZCode Desktop 里对 Agent 说：

- “按这张设计稿做一套 React 组件”
- “把截图里的颜色和字号整理成设计变量”
- “给按钮加一个加载状态并检查能否编译”

在自己的项目（React 18/19）里使用：复制 `src/`、`tokens.css`、`tokens.ts` 和 `index.ts`，在入口处引入一次 `tokens.css`，CSS 文件交给打包工具（Vite、Next 等）处理。

## 工具

| 工具 | 作用 |
|---|---|
| `dc_new` | 新建组件库（生成设计变量文件和 README），关联设计稿 |
| `dc_tokens` | 设置或删除设计变量，重新生成 tokens.css / tokens.ts |
| `dc_plan` | 组件清单及每个组件需要的状态 |
| `dc_write` | 写入或删除组件文件，并重新构建 |
| `dc_build` | 类型检查、渲染示例、重新生成组件目录页 |

## 范围（v0.1）

- 只支持 React + TypeScript，样式用普通 CSS 文件；不支持 Vue，不接入 Figma，也不配置 Tailwind 或 CSS-in-JS。
- 组件只能引用 React 和组件库里的文件；第三方 UI 库在预览中不可用。
- 面板里的预览是静态的（每种状态单独写一个示例）。悬停、聚焦、输入等交互可以在 `catalog/index.html` 里试。

## 隐私、网络和文件

- 本地运行，不联网，不需要 API 密钥。esbuild（WebAssembly 版）、TypeScript 和 React 类型声明都随插件附带。
- 只写 `ui-kit/<名称>/` 和 `.design-to-components/project.json`。
