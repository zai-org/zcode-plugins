# SpexCode 图集

[English](./README.md)

这个插件给 ZCode 加一个 skill：`atlas`。它把代码仓库整理成 [SpexCode](https://spexcode.net) 规格树并画出架构。
结果是仓库里的一个 `.spec/` 目录：每个部分一个 `spec.md`，写明这部分做什么、管哪个文件；值得配图的节点旁边有一张图；
另外还有一个单文件 HTML 网页，展示整棵树和所有图，直接从磁盘打开即可。

由 SpexCode 作者维护，版本 0.1.0。

## 做什么

对整个仓库，skill 用 `CreateWorkflow` 提交一个动态工作流（`skills/atlas/atlas.dwf.ts`）。
agent 只改其中的语言和阶段名，别的不动。运行过程：

1. 通读仓库，规划各个部分；
2. 并行撰写各部分的规格；
3. 用 `spex spec lint` 把关（0 个错误、覆盖率 90%），不通过就修复；
4. 挑出值得配图的节点；
5. 并行画图，每张图都要通过 `spex diagram check`；
6. 由独立读者对照代码核查规格树的上层，每条发现再交给另一个子代理复核；
7. 提交 `.spec/`，把网页作为这次运行的 `atlas` 产物交出，附一份报告。

如果 ZCode 版本里没有 `CreateWorkflow`，skill 会逐步完成同样的工作，并告诉用户走的是这条路。
只画一个节点或一棵子树时，用 `spex diagram scaffold` 和 `spex diagram check`，每张图检查到通过为止。

## 用法

在仓库里这样说，例如：

- “给这个仓库做一份 SpexCode 图集。” / "Make a SpexCode atlas of this repository."
- “给 session 节点画一张图。”

## 依赖与副作用

- **需要 Node.js 22 或更高版本和 npm**。不做全局安装：每条 SpexCode 命令都以
  `npx -y -p spexcode@next spex <命令>` 运行，第一次使用时会从 npm 仓库把 `spexcode` 包下载进 npm 缓存。
  生成网页那一步还会下载 `@spexcode/spec-dashboard`。
- **网络：** 只访问 npm 仓库。没有 MCP server、没有 hook、没有远程服务、没有遥测。模型就是当前 ZCode 会话用的模型。
- **写入的文件：** 当前仓库的 `.spec/`（`spec.md`、`diagram.json` 和 `.spec/spexcode.json`），以 `.spec` 为唯一路径提交到 git；
  仓库根目录的 `spexcode-atlas.html`，不提交。`spex spec lint` 还会在 `~/.spexcode/projects/` 下留一份很小的历史缓存（约 8 KB）。
- **执行的命令：** 通过 npx 运行的 `spex` 子命令（`spec lint`、`diagram scaffold`、`diagram check`、
  `graph --public --html`、`guide`），`git add .spec` 和 `git commit`，以及对仓库的只读查看。
- **开销：** 工作流会并行运行很多子代理。在 psf/requests（19 个源文件）上用 GLM-5.2 跑了约两小时、4300 万 token；
  运行时会根据模型限流自动调低、调高并发。

## 来源与许可证

SpexCode 采用 MIT 许可证：<https://github.com/shuxueshuxue/spexcode>。图表渲染器（archify）随 `spexcode` npm 包一起发布。

启用或更新插件后，请开一个新的 ZCode 会话，让 Skill 列表刷新。
