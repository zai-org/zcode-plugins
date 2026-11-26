---
name: changelog-builder
description: 不用再手动复制提交记录写发布说明：选一个 git 仓库，按版本和类型（新功能、问题修复、性能优化、不兼容变更……）生成 CHANGELOG.md，并为最新版本生成一份整洁的 HTML / Markdown 发布说明。支持 Conventional Commits、“新增/修复”这样的中文前缀，以及普通的 “Add…/Fix…” 提交信息。导出前可以在表格里改写说明、调整类型或去掉条目。在本地读取 git，无需 GitHub 令牌或 API 密钥。 用户提到“更新日志 / CHANGELOG / 发布说明 / release notes / 根据提交记录生成版本说明”时使用。
---

# 更新日志生成

1. `changelog_open(inputs, settings?, project?)`：读取 git 历史，按版本和类型整理提交。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 是仓库文件夹（工作区根目录用 "."）；settings: {next: "v1.2.0", lang: "zh", range: "all", chores: false, authors: false}；range 可为 all/unreleased/latest/two。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `changelog_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 每行是一个提交：`set: [{row, values: {include, type, scope, summary, breaking}}]`；type 取 feat/fix/perf/refactor/docs/security/deps/other/chore/test/ci/build/style/revert。
4. `changelog_export(project, formats?)`：导出 CHANGELOG.md、release-notes.html 和 release-notes.md。把文件路径告诉用户。
5. git 没装或文件夹不是仓库时会报 git_failed，请如实告诉用户。
