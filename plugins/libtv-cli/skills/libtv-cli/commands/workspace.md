# `libtv workspace` — 项目（工作区）

> 📌 **术语**：LibTV 里 **项目（workspace）= 工作区**，是装画布的容器；**画布（project）** 才是真正的画布文件（见 [project.md](./project.md)）。一个**项目**下可以放多张**画布**。
>
> 💡 **引导用户**：项目即网页端左侧的「项目（工作区）」。项目本身没有独立的画布链接，进入项目后选中某张画布再分享：`https://www.liblib.tv/canvas?spaceId=<项目ID>&projectId=<画布UUID>`。

创建、查询、更新远程**项目（工作区）**。目标工作区由 **`-w/--workspace`**（在 [`project`](./project.md) 命令里）或本命令的位置参数指定。

## 子命令

| 子命令                                      | 作用                       |
| ------------------------------------------- | -------------------------- |
| **`libtv workspace create <workspace>`**    | 新建一个空项目（工作区）   |
| **`libtv workspace list`**（别名 **`ls`**） | 分页列出当前账号下的项目   |
| **`libtv workspace update <workspaceId>`**  | 修改项目名称 / 简介 / 封面 |

## 公共参数

各子命令通用以下参数。

| 参数            | 说明                                                                                  |
| --------------- | ------------------------------------------------------------------------------------- |
| `--team-id <n>` | 团队空间：`create` 建到哪个团队、`list` 按团队过滤、`update` 限定范围；`0` 强制个人。 |

### `libtv workspace create <workspace>`

用法骨架：`libtv workspace create <workspace> [flags]`

**位置参数**

- **`<workspace>`**（必填）：项目名称（展示用）；含空格时用引号。

**选项**（另支持公共参数 `--team-id`）

| 选项                       | 必填 | 说明         |
| -------------------------- | ---- | ------------ |
| `-d, --description <text>` | 否   | 项目简介。   |
| `--cover-url <url>`        | 否   | 封面图 URL。 |

**输出**：含 `workspaceId`（即新项目的文件夹 id，可作为 `project -w` 的工作区范围）。

### `libtv workspace list`（别名 `ls`）

用法骨架：`libtv workspace list [flags]`

**位置参数**：无。

**选项**（另支持公共参数 `--team-id`）

| 选项                     | 默认              | 说明                                                                                      |
| ------------------------ | ----------------- | ----------------------------------------------------------------------------------------- |
| `-p, --page <n>`         | `1`               | **页码**（从 1 起）。⚠️ **不是项目 ID**。                                                 |
| `-s, --page-size <n>`    | `20`              | 每页条数。                                                                                |
| `-o, --order-by <field>` | `updated_at_desc` | 排序，须为：`updated_at_desc` / `updated_at_asc` / `created_at_desc` / `created_at_asc`。 |
| `--name <text>`          | —                 | 仅保留名称**包含**该关键字的项（子串匹配）。                                              |

**输出**：项目以 `folders` 数组返回，每项含 `id`（项目 ID）、`name` 等。

### `libtv workspace update <workspaceId>`

用法骨架：`libtv workspace update <workspaceId> [flags]`

**位置参数**

- **`<workspaceId>`**（必填）：项目（工作区）文件夹 id（正整数）。

**选项**：`-n, --name`、`-d, --description`、`--cover-url`（传空字符串可清空封面），另支持公共参数 `--team-id`。至少传入 `--name` / `--description` / `--cover-url` 中的一个。

**输出**：如 `{ "ok": true, "workspaceId": 42 }`。

## 示例

```bash
# case 1: 新建项目，拿到项目 ID
WS=$(libtv workspace create "我的短剧项目" -d "demo" | jq -r '.workspaceId')

# case 2: 翻页列出我的项目（项目 = 工作区）
libtv workspace list -p 1 -s 20

# case 3: 按名称子串过滤
libtv workspace list --name "短剧"

# case 4: 把新画布建到该项目下（-w 指定工作区范围，见 project.md）
libtv project create "第一集" -w "$WS"
libtv project list -w "$WS"

# case 5: 重命名项目
libtv workspace update "$WS" -n "改个名"
```
