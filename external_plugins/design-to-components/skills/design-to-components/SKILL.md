---
name: design-to-components
description: 按设计稿/截图做 React 组件库：整理设计变量（tokens.css / tokens.ts）、列组件清单与状态、写 TSX 组件，插件做 TypeScript 检查、渲染每个状态与设计稿对照、生成可交互目录页。用户提到“设计稿转组件 / 组件库 / design system / 设计变量 / React 组件”时使用。
---

# 设计稿转组件库（React + TSX）

1. 看设计稿，整理出：
   - 颜色（主色、主色上的文字色、背景、次级背景、文字、次要文字、边框，以及危险、成功、警告等状态色）。
   - 字体、字号阶梯、圆角、间距和阴影。
2. 用 `dc_new(name, design, tokens)` 新建组件库，或用 `dc_tokens({tokens})` 补全设计变量。变量名只用小写字母、数字和短横线。
3. 用 `dc_plan({components})` 列出组件，每个组件写出需要的状态，例如 Button：primary、secondary、disabled、loading。
4. 用 `dc_write({files})` 写组件，可以一次写多个。文件都平铺在 `src/`（如 `src/Button.tsx`、`src/Button.css`）；写成 `src/components/Button/Button.tsx` 也会被自动平铺到 `src/Button.tsx` 并修正导入：
   - `Name.tsx`：`export function Name(props)`。props 要有类型，并按需扩展原生属性，例如 `ButtonHTMLAttributes<HTMLButtonElement>`。
   - 同一个文件里写 `export const examples = [{ name: "Primary", render: () => <Name …/> }, …]`。每种计划中的状态都要有一个示例，示例名里要包含状态名。
   - `Name.css`：类名加前缀（例如 `fn-button`）。颜色、字号、圆角、间距一律用 `var(--color-…)`、`var(--font-size-…)`、`var(--radius-…)`、`var(--space-…)`，不要写死颜色。
   - 只能引用 `react` 和组件库里的文件（例如 `./Button`、`../tokens`）。
   - 注意无障碍：`label` 关联 `input`，出错时设置 `aria-invalid`，加载中设置 `aria-busy`，按钮用 `<button>`。
5. 看 `dc_write` 返回的问题：TypeScript 错误和渲染错误必须修完，提醒（写死的颜色、缺少的状态示例）也要处理。用户在面板里对照设计稿检查。
6. 完成后告诉用户：`ui-kit/<名称>/catalog/index.html` 在浏览器里可以交互查看；要用到自己的项目里，复制 `src/`、`tokens.css`、`tokens.ts` 和 `index.ts`。
