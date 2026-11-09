# ZCode 插件贡献指南

[English](./CONTRIBUTING.md)

感谢你改进 ZCode 插件市场。功能建议和问题请提交 GitHub Issue；代码或文档改动请提交聚焦的 Pull Request。

## 开始前

- 先检查已有 Issue 和 Pull Request，避免重复工作。
- 新插件从 [`plugins/example-plugin/`](./plugins/example-plugin) 开始，并阅读[插件开发教程](./docs/PLUGIN_DEVELOPMENT_CN.md)（[English](./docs/PLUGIN_DEVELOPMENT.md)）。
- 一个 Pull Request 只处理一个插件或一个仓库主题。

## 插件契约

每个插件都必须：

- 外部团队、合作方和社区新增插件位于 `external_plugins/` 下唯一的 kebab-case 目录；`plugins/` 保留给官方维护插件；
- 包含 `.zcode-plugin/plugin.json`，并填写 `name`、`description`、`version` 和 `author`；
- 在根目录 [`marketplace.json`](./marketplace.json) 中注册，且 `name`、`version` 和描述保持一致；
- 至少提供一种有效组件：command、skill、hook、agent 或 MCP server；
- 提供语义一致的面向用户的 `README.md` 和 `README_CN.md`；
- 使用一种支持的分类：`developer-tools`、`productivity`、`utilities`、`finance`、`guides`、`template` 或 `other`。

插件 README 必须说明网络访问、模型/API/服务依赖、文件写入、命令执行、Hook、MCP server 和其他副作用，并标明第三方代码、素材和服务的来源及许可证。

禁止提交凭据、私有地址、客户数据、机器专属路径、缓存、构建产物、混淆源码或不必要的预编译二进制文件。

## 开发流程

1. Fork [`zai-org/zcode-plugins`](https://github.com/zai-org/zcode-plugins)，从最新 `main` 创建分支。
2. 复制示例插件，或在本次改动涉及的现有插件中修改：

   ```shell
   mkdir -p external_plugins
   cp -R plugins/example-plugin external_plugins/<你的插件名>
   ```

3. 更新插件清单、组件文件、两种语言的 README 和根目录市场条目，确保清单与市场条目的版本一致。
4. 在仓库根目录运行检查：

   ```shell
   python3 scripts/validate.py
   python3 scripts/build_dist.py
   git diff --check
   ```

5. 在 ZCode 中实际运行插件的主要能力，记录可复现步骤；涉及界面变化时附上截图或短录屏。

## Pull Request 自查清单

### 声明插件类型（必填）

每个 PR 在发起评审前都必须填写 [PR 模板](.github/PULL_REQUEST_TEMPLATE.md) 中的 **插件类型**，且只能勾选一项，同时列出涉及插件的清单 `name`：

- **UI Plugin**：涉及的插件提供 MCP Apps 交互页面，包括 `ui.surfaces` 面板或工具的 `_meta.ui.resourceUri` 页面。即使只改该插件的文档或 skill，或者本次新增、移除交互页面，也选择此项。
- **普通插件（非 UI）**：涉及的插件不提供 MCP Apps 交互页面。仅有 MCP 工具，或 skill 会生成 Gen UI，都不会使其成为 UI Plugin。
- **不适用**：仅修改仓库级文档、构建或 CI，不涉及可安装插件的内容。

涉及多个插件时，分别列出名称和类型，只要包含 UI Plugin 就选择 UI Plugin。这项声明不替代市场 `category` 分类，也不改变 Conventional Commits 标题要求。评审者批准前必须确认声明完整且准确。

Pull Request 描述中请写清：

- 改动解决的用户问题；
- 用户可见行为和测试方式；
- 版本变化和市场注册信息；
- 依赖、网络请求、权限和副作用；
- 第三方材料的来源与许可证。

发起评审前确认：

- [ ] 已勾选必填的插件类型，并列出涉及的插件名称；
- [ ] 插件名唯一且为 kebab-case；
- [ ] 必需文件和中英文 README 均已提供；
- [ ] 分类填写正确；
- [ ] 未提交密钥、私有数据或机器专属路径；
- [ ] `validate.py`、`build_dist.py` 和 `git diff --check` 均通过；
- [ ] 已在 Pull Request 中处理评审意见。

标题使用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 格式，例如 `feat(example-plugin): 新增问候语 skill` 或 `docs: 完善插件分类说明`。

## 版本与发布

插件安装内容一旦发布即不可变。只要安装内容发生变化，就要同时升级插件清单和 `marketplace.json` 对应条目的语义化版本；已经发布过的版本号不能重复使用。

维护者会审核功能、安全性、可维护性、兼容性、来源和许可证。通过审核的改动会进入官方发布流程，并在 Pull Request 中同步发布或后续处理状态。
