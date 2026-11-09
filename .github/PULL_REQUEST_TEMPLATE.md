<!--
PR title must follow Conventional Commits / PR 标题必须符合 Conventional Commits：
  feat(<plugin-name>): <what changed>     新增或修改插件能力
  fix(<plugin-name>): <what changed>      修复插件问题
  docs: / chore(ci): / refactor: ...      仓库级改动
The PR title becomes the squash commit on main. / PR 标题会成为 main 上的最终提交信息。
-->

## Plugin type (required) / 插件类型（必填）

Select exactly one before requesting review. / 发起评审前必须且只能勾选一项。

- [ ] **UI Plugin / 是 UI 插件** — provides MCP Apps interactive pages / 提供 MCP Apps 交互页面
- [ ] **Standard plugin / 普通插件（非 UI）** — does not provide MCP Apps interactive pages / 不提供 MCP Apps 交互页面
- [ ] **Not applicable / 不适用** — repository-only changes; no plugin content changed / 仅仓库级改动，不涉及插件内容

Affected plugin name(s) / 涉及的插件名称：

<!-- Use the manifest name; write N/A only for repository-only changes.
     填写清单中的 name；仅仓库级改动时填写 N/A。 -->

Classify the affected plugin, even when only changing its docs or skills. Adding or removing an interactive page also counts as a UI Plugin change. For multiple plugins, list each name and type; select UI Plugin if any is affected.

按涉及的插件判断，即使本次只改它的文档或 skill 也须声明类型。新增或移除交互页面也属于 UI Plugin 改动。涉及多个插件时分别列出名称和类型，只要包含 UI Plugin 就选择 UI Plugin。

`ui.surfaces` panels and tool-result pages using `_meta.ui.resourceUri` both count. An MCP server or a skill that generates Gen UI alone does not. This declaration is separate from marketplace `category`.

`ui.surfaces` 面板和通过 `_meta.ui.resourceUri` 展示的工具结果页面都算 UI Plugin。仅有 MCP server 或生成 Gen UI 的 skill 不算。这项声明与市场 `category` 分类独立。

## What / 改动内容

<!-- What does this PR change, and why? / 这个 PR 改了什么，为什么？ -->

## Self-check / 自查清单

<!-- For plugin changes. Delete this section for repo-level changes (docs/ci).
     插件改动必填；纯仓库级改动（docs/ci）可删除本节。 -->

- [ ] Plugin name is unique kebab-case; new external plugin directory is `external_plugins/<name>/`; existing fixes retain ownership / 插件名唯一且 kebab-case，外部新增插件位于 `external_plugins/<name>/`，已有插件修复保留原归属
- [ ] Usage `category` is set independently of publisher ownership / 用途分类 `category` 已填写，与维护归属分开
- [ ] Plugin type and affected names are declared above / 已在上方声明插件类型与涉及的插件名称
- [ ] `version` bumped in BOTH `plugin.json` and `marketplace.json` (artifacts are immutable) / `plugin.json` 与 `marketplace.json` 两处版本号已同步升级（制品不可变）
- [ ] `README.md` (EN) and `README_CN.md` (中文) both updated and equivalent / 中英文 README 均已更新且语义一致
- [ ] `description_i18n` has both `en` and `zh-CN` / `description_i18n` 包含 `en` 与 `zh-CN`
- [ ] No secrets, machine-specific paths, or private dependencies / 不含密钥、机器专属路径或私有依赖
- [ ] Model/API/network dependencies documented / 模型、API、网络依赖已写明
- [ ] `python3 scripts/validate.py` and `python3 scripts/build_dist.py` pass locally / 本地校验与构建均通过
