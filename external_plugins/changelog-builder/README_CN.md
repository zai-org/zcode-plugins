# 更新日志生成

不用再手动复制提交记录写发布说明：选一个 git 仓库，按版本和类型（新功能、问题修复、性能优化、不兼容变更……）生成 CHANGELOG.md，并为最新版本生成一份整洁的 HTML / Markdown 发布说明。支持 Conventional Commits、“新增/修复”这样的中文前缀，以及普通的 “Add…/Fix…” 提交信息。导出前可以在表格里改写说明、调整类型或去掉条目。在本地读取 git，无需 GitHub 令牌或 API 密钥。

## 功能

- **按标签分版本**：每个版本标签处切分，最新的在前；最后一个标签之后的改动放在“未发布”或你指定的版本号下。
- **智能分组**：识别 Conventional Commits 的类型和范围、`!` 与 BREAKING CHANGE、中文前缀（新增、修复、优化、文档……）以及普通英文 “Add/Fix/Bump…” 提交。
- **条目可改**：改类型、范围、措辞，标记不兼容，或去掉某条；合并提交自动跳过，chore/ci/test 默认隐藏。
- **链接**：提交哈希和 #123 问题编号自动链接到 GitHub 或 GitLab（读取 origin 远程地址，也可手动填写）。
- **两种输出**：中英文标题可选的 Keep a Changelog 风格 CHANGELOG.md，以及带样式的 release-notes.html 和可直接粘贴的 release-notes.md。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `changelog-builder/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “给 shop-app 生成更新日志，未发布的部分叫 v1.2.0”
- “只要最新一个版本，标题用英文”
- “生成可以直接贴到 GitHub Release 的发布说明”

## 工具

| 工具 | 作用 |
|---|---|
| `changelog_open` | 读取 git 历史，按版本和类型整理提交，并打开面板 |
| `changelog_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `changelog_status` | 查看当前数据、问题和汇总 |
| `changelog_export` | 导出 CHANGELOG.md、release-notes.html 和 release-notes.md |

导出文件写到工作区的 `changelog-builder/<项目>/` 文件夹。

## 范围（v0.1）

- 需要电脑上装有 git；只读取仓库，不做任何修改。
- 不调用 GitHub/GitLab API，所以不会获取 PR 标题和标签。
- 提交记录比较乱时，可能需要手动改写几条说明。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `changelog-builder/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/changelog-builder/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-changelog-builder test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
