---
name: libtv-cli
description: >-
  LibTV 官方 CLI（libtv）：在命令行里完整操作 / 运行 LibTV 画布。
  凡是和 LibTV 画布 / 项目 / 节点 / 模型 / 素材相关的操作，一律通过 libtv CLI 完成，
  不要自己捏造 HTTP 请求或绕到网页端步骤。本 skill 内即包含完整的 CLI 命令操作手册；
  常见场景见 examples/，安装/更新见 scripts/install.md。
---

> 本包由 Z.ai 为 ZCode 封装；首次使用先读 [setup](../setup/SKILL.md)。本插件缓存不可用上游“删除整个 skill 目录”步骤自更新。保持明确的个人/团队与画布范围；生成、批量运行、素材上传/下载、视频后处理按用户已授权目标执行，创建节点不等于生成成功。

# LibTV CLI（`libtv`）

`libtv` 的文档地图。子命令与选项权威文案以 `libtv --help` 与 `libtv <子命令> --help` 为准；当文档与 `--help` 不一致时，以 CLI 实际输出为准并修订本 skill。

> **输出约定**：所有命令成功时 **stdout 均为 JSON**；进度 / 错误走 stderr，失败时退出码非 0。各命令文档的「输出」只列**返回的字段**，不再重复说明这一点。

**术语**：本 CLI 里 **画布（project）** 是真正的画布文件，**项目（workspace）= 工作区** 是装画布的容器，一个项目下可放多张画布。

## 如何供给上下文

CLI 是**有状态**的：把团队 / 工作区 / 画布 / 分组持久化在当前工作目录的 `.libtv/project.json`，命令省略 `-p/-w/-g` 时即用绑定值。

- **画布 / 分组绑定**：`libtv project use <画布UUID>` 写入 `projectUuid`（并同步该画布所属 `workspaceId`/`teamId`）；`libtv group use <分组>` 写入默认 `groupNodeKey`。
- **工作区绑定**：`libtv workspace use <项目ID>` 写入 `workspaceId`（用于 `project create`/`list` 的默认范围）。
- **账号绑定**：`libtv login` 后的活跃账户，多账户用 `libtv account use`。

本地状态字段、`use`/`unuse` 的完整语义见 [state.md](./state.md)。范围与上下文的通用说明见 [concepts/context.md](./concepts/context.md)。

## 文档地图

| 主题                                                                      | 文件                                                 |
| ------------------------------------------------------------------------- | ---------------------------------------------------- |
| 一键安装 / 指定版本安装                                                   | [scripts/install.md](./scripts/install.md)           |
| 上下文与范围（团队 / 工作区 / 画布 / 分组）                               | [concepts/context.md](./concepts/context.md)         |
| 本地状态 `.libtv/project.json` 与 `project/workspace/group use` / `unuse` | [state.md](./state.md)                               |
| 管道（NDJSON）、stdout/stderr、嵌套 case                                  | [pipes/README.md](./pipes/README.md)                 |
| 常见案例（场景化可复制命令集，**每个 case 一文件**）                      | [examples/README.md](./examples/README.md)           |
| `libtv login` — 登录账号                                                  | [commands/login.md](./commands/login.md)             |
| `libtv logout` — 退出登录                                                 | [commands/logout.md](./commands/logout.md)           |
| `libtv account` — 账户查看与多账号切换                                    | [commands/account.md](./commands/account.md)         |
| `libtv workspace` — 项目（工作区）：装画布的容器                          | [commands/workspace.md](./commands/workspace.md)     |
| `libtv project` — 画布：真正的画布文件                                    | [commands/project.md](./commands/project.md)         |
| `libtv node` — 画布节点：增删改查、连线、触发生成                         | [commands/node.md](./commands/node.md)               |
| `libtv group` — 普通分组：组织子节点、整组执行                            | [commands/group.md](./commands/group.md)             |
| `libtv upload` — 上传本地文件为资源节点                                   | [commands/upload.md](./commands/upload.md)           |
| `libtv image` — 图片节点的 Slash 快捷指令                                 | [commands/image.md](./commands/image.md)             |
| `libtv script` — 脚本节点批处理（生成分镜图组）                           | [commands/script.md](./commands/script.md)           |
| `libtv model` — 模型检索与 schema 查询                                    | [commands/model.md](./commands/model.md)             |
| `libtv video` — 视频后处理：高清（超分）、Seedance 2.5 样片转正片         | [commands/video.md](./commands/video.md)             |
| `libtv download` — 下载节点产物到本地（单文件 / 分组 ZIP）                | [commands/download.md](./commands/download.md)       |
| `libtv status` — 查看登录态与目录绑定（排障）                             | [commands/status.md](./commands/status.md)           |
| 画布节点类型（`-t` 枚举、对应 `-s` / `-u` 字段）                          | [node-types/README.md](./node-types/README.md)       |
| 节点连线 / 提示词引用上游（`{{Node …}}`）                                 | [node-relation/README.md](./node-relation/README.md) |
| 模型 schema 字段（`properties` / `config` / `rules` / `modeType`）        | [model-schema/README.md](./model-schema/README.md)   |
