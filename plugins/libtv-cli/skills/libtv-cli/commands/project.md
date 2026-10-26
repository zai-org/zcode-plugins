# `libtv project` — 画布

> 📌 **术语**：LibTV 里 **画布（project）** 是真正的画布文件；装画布的容器叫 **项目（工作区，workspace）**，见 [workspace.md](./workspace.md)。下文「画布 UUID」即 `projectUuid`。

> 💡 **引导用户**：涉及某张画布时，主动把它的网页链接告诉用户：`https://www.liblib.tv/canvas?projectId=<画布UUID>`（把 `<画布UUID>` 换成实际的 `projectUuid`）。

## 子命令

| 子命令                                    | 作用                                                          |
| ----------------------------------------- | ------------------------------------------------------------- |
| **`libtv project create <project>`**      | 新建空白画布                                                  |
| **`libtv project list`**（别名 **`ls`**） | 分页列出当前账号下的画布                                      |
| **`libtv project update <projectUuid>`**  | 修改画布名称 / 简介 / 封面 / 所属文件夹                       |
| **（默认）`libtv project [projectUuid]`** | 拉取画布详情并输出**精简 JSON**（节点、边、id、展示名、位置） |

## 公共参数

`project create` / `project list` 通用以下参数（`update` / 默认子命令不涉及）。

| 参数                  | 说明                                                                   |
| --------------------- | ---------------------------------------------------------------------- |
| `--team-id <n>`       | 团队空间：`create` 指定建到哪个团队、`list` 按团队过滤；`0` 强制个人。 |
| `-w, --workspace <n>` | 工作区：`create` 落地到该工作区、`list` 按工作区过滤；`0` = 根目录。   |

### `libtv project create <project>`

用法骨架：`libtv project create <project> [flags]`

**位置参数**

- **`<project>`**（必填）：画布名称（展示用）；含空格时用引号。

**选项**（另支持公共参数 `--team-id` / `-w`）

| 选项                       | 必填 | 说明         |
| -------------------------- | ---- | ------------ |
| `-d, --description <text>` | 否   | 画布简介。   |
| `--cover-url <url>`        | 否   | 封面图 URL。 |

**输出**：含新画布信息（可从中取 `uuid` 供后续子命令的 `-p` 使用）。

### `libtv project list`（别名 `ls`）

用法骨架：`libtv project list [flags]`

**位置参数**：无。

**选项**（另支持公共参数 `--team-id` / `-w`）

| 选项                     | 默认              | 说明                                                                               |
| ------------------------ | ----------------- | ---------------------------------------------------------------------------------- |
| `-p, --page <n>`         | `1`               | **页码**（从 1 起）。⚠️ **不是画布 UUID**，勿与 [`node -p`](./node.md) 混淆。      |
| `-s, --page-size <n>`    | `20`              | 每页条数。                                                                         |
| `-o, --order-by <field>` | `updated_at_desc` | 排序，须为接口约定值之一：`updated_at_desc` / `edit_time_desc` / `edit_time_asc`。 |
| `--name <text>`          | —                 | 仅保留名称**包含**该关键字的项（子串匹配）。                                       |

### `libtv project update <projectUuid>`

用法骨架：`libtv project update <projectUuid> [flags]`

**位置参数**

- **`<projectUuid>`**（必填）：画布 UUID。

**选项**

| 选项                       | 必填 | 说明                             |
| -------------------------- | ---- | -------------------------------- |
| `-n, --name <text>`        | 否   | 新画布名称。                     |
| `-d, --description <text>` | 否   | 新画布简介。                     |
| `--cover-url <url>`        | 否   | 新封面图 URL；传空字符串可清空。 |

至少传入 `--name` / `--description` / `--cover-url` 中的一个。

**输出**：如 `{ "ok": true, "projectUuid": "<画布UUID>" }`。

### `libtv project` / `libtv project <projectUuid>`（默认子命令）

用法骨架：`libtv project [projectUuid]`

**位置参数**

- **`[projectUuid]`**（可选）：画布 UUID；省略时使用当前画布上下文（来源见 [../concepts/context.md](../concepts/context.md)）；无上下文且未传参则报错。

**输出**：节点 id / 展示名 / 类型 / 位置；边的 id / source / target。便于快速查看画布结构，**不等价**于完整的画布元数据接口。

## 示例

```bash
# case 1: 新建画布，取出 uuid 供后续使用
NEW=$(libtv project create "测试画布" -d "demo" | jq -r '.uuid')

# case 2: 翻页列出我的画布（页码走 -p/--page，不是 UUID）
libtv project list -p 1 -s 20

# case 3: 按名称子串过滤
libtv project list --name "分镜"

# case 4: 修改画布名称
libtv project update "$NEW" -n "测试画布 v2"

# case 5: 仅需画布结构（节点 + 边）时的快速摘要
libtv project "$NEW"
```
