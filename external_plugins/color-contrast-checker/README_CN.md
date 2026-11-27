# 配色无障碍检查

按 WCAG 对比度标准检查配色变量，修正看不清的组合。打开 CSS、SCSS 或 JSON 设计令牌，会根据 CSS 规则和变量名（包括深色主题覆盖和 var() 引用）找出文字和背景的组合，也可以自己列。每组显示对比度和 AA/AAA 结果，并给出最接近的达标颜色（色相不变，只调深浅）。接受修正或填自己的颜色，所有组合会重新检查，最后导出修正后的令牌文件和报告。在本地运行，不上传，无需 API 密钥。

## 功能

- **读取令牌**：CSS 自定义属性、SCSS $变量、LESS @变量、JSON（嵌套或 W3C $value），自动解析 var() 和 {引用}。
- **找出组合**：同时设置 color 和 background 的 CSS 规则；button-text/button-bg、on-primary/primary 这样的命名；所有文字色配主背景；也可以自己列。
- **主题**：.dark 等作用域用各自的覆盖值检查。
- **WCAG 2 等级**：AA 或 AAA，区分正文、大字和界面元素。
- **最接近的达标色**：色相饱和度不变，只调亮度；修改写到真正定义颜色的那个变量上。
- **一起复查**：同一个颜色被多组使用时，所有修正生效后再整体检查一遍。
- **输出**：修正后的文件副本（格式不变）和 Markdown + CSV 报告。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `color-contrast-checker/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “检查 tokens.css 是否满足 WCAG AA”
- “深色主题下哪些文字颜色对比度不够？”
- “修正不达标的颜色，但保持品牌色相”

## 工具

| 工具 | 作用 |
|---|---|
| `contrast_open` | 读取令牌文件，找出颜色组合并逐一检查，并打开面板 |
| `contrast_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `contrast_status` | 查看当前数据、问题和汇总 |
| `contrast_export` | 导出修正后的令牌文件和报告 |

导出文件写到工作区的 `color-contrast-checker/<项目>/` 文件夹。

## 范围（v0.1）

- 只计算 WCAG 2.x 对比度（不是 APCA）；带透明度的颜色按白底混合。
- 不读取写在 HTML 或 JS 里的颜色。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `color-contrast-checker/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/color-contrast-checker/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-color-contrast-checker test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
