# `libtv node` — 画布节点

对已有画布项目里的节点做**查询 / 新建 / 更新 / 改边 / 触发生成**。目标画布由 **`-p` / `--project`** 指定（缺省来源见 [../concepts/context.md](../concepts/context.md)）；限定到某个普通分组时通过 **`-g` / `--group`** 指定（见 [group.md](./group.md)）。

## 子命令

| 子命令                          | 作用                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------- |
| **（默认）`libtv node <node>`** | **查询 / 更新 / 改边 / `--run`**；只操作已有节点，**不接受 `-t`**。               |
| **`libtv node create <node>`**  | **仅新建**；已存在同名 / 同 id 则报错；**`-t` 必填**；可配合 `--run` 新建后生成。 |
| **`libtv node list`**           | 列出画布节点（受 `-g` / 目录默认分组约束）。                                      |
| **`libtv node delete <node>`**  | 删除指定节点与其全部连线。                                                        |

## 公共参数

以下参数各子命令通用，下文不再逐条列出；省略时的缺省来源见 [../concepts/context.md](../concepts/context.md)。

| 参数                      | 说明                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `-p, --project <project>` | 目标画布 **UUID**。**勿与** [`libtv project list -p`](./project.md)（**页码**）混淆。 |
| `-g, --group <group>`     | 限定到某个普通分组（节点 id 或展示名），约束 `<node>` 与连线端点的解析范围。          |

### `libtv node <node>`（默认子命令）

用法骨架：`libtv node <node> [flags]`

**位置参数**

- **`<node>`**（必填）：目标**焦点节点**，可为节点 **id** 或**展示名**；**精确匹配**、**id 优先**，不是模糊搜索；要求**唯一**匹配，否则报错（交互式呈现差异见[使用说明](../SKILL.md)）。

**选项**（另支持公共参数 `-p` / `-g`）

| 选项                                           | 可重复 | 说明                                                                                                                                                                                  |
| ---------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--name <text>`                                | 否     | 改**展示名**（仅默认子命令）。语义见 [../node-types/README.md](../node-types/README.md)。                                                                                             |
| `--prompt <text>`                              | 否     | 写提示词（`-s prompt=` 的快捷写法）。语义见 [../node-types/README.md](../node-types/README.md)；`{{Node …}}` 见 [../node-relation/mention.md](../node-relation/mention.md)。          |
| `-s, --set <key=value>`                        | 是     | 改「**生成器参数**」（写 `data.params`）。写法、字段、`model` 取值等完整语义见 [../node-types/README.md](../node-types/README.md)。                                                   |
| `-u, --update <key=value>`                     | 是     | 改「**节点自身属性**」（写 `data` 顶层）。语义、`-s`/`-u` 对比、拒写键、各类型可写字段见 [../node-types/README.md](../node-types/README.md)。                                         |
| `--left` / `--left-add` / `--left-rm` `<node>` | 是     | 改入边连线（出边 flag 已移除，从下游节点用 `--left` 表达）。确保模式 vs 增量模式、互斥规则见 [../node-relation/connection.md](../node-relation/connection.md)。                       |
| `--attachment <fileOrUrl>`                     | 否     | 仅 `video`：给视频生成附一份**文档上下文**（本地文件自动上传，或 http(s) URL）；传 `none` 清除。与 `--link` 互斥。适用模型与限制见 [../node-types/video.md](../node-types/video.md)。 |
| `--link <url>`                                 | 否     | 仅 `video`：给视频生成附一个**链接上下文**（单个 http(s) 链接）；传 `none` 清除。与 `--attachment` 互斥。                                                                             |
| `--x <n>` / `--y <n>`                          | 否     | 把节点**移动**到该画布绝对坐标（像素）；只传一轴时另一轴不变。节点在分组内时自动换算为组内坐标，并重算分组外框。                                                                      |
| `-r, --run`                                    | 否     | 触发一次生成（同步等待终态）。详见下方「行为组合·**生成**」。                                                                                                                         |

**行为组合**

一条 `libtv node <node>` 按所带 flag 组合出以下行为，**可叠加**（如「修改 + 连线 + 生成」同条命令，先写后生成）：

| 行为     | 触发                                | 说明                                                                                                                                                        |
| -------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **查询** | 不带任何写参 / 改边                 | 拉取 `<node>` 的节点 JSON。                                                                                                                                 |
| **移动** | `--x` / `--y`                       | 改**已有**节点的画布坐标。                                                                                                                                  |
| **修改** | `--prompt` / `-s` / `-u` / `--name` | 在**已有**节点上改生成参数 / 属性 / 展示名；节点不存在则报错（新建用 `libtv node create`）。写参语义见 [../node-types/README.md](../node-types/README.md)。 |
| **连线** | `--left` 系列                       | 改入边。语义见 [../node-relation/connection.md](../node-relation/connection.md)。                                                                           |
| **生成** | `-r, --run`                         | 对 `<node>` 触发一次生成，并**同步阻塞等待终态 JSON 后返回**。可单独生成，也可与修改 / 连线同条命令。详见表下。                                             |

**关于 `--run`（生成）**：它是同步等待操作——系统内部会提交任务、轮询进度、更新任务状态、写回画布，完成后返回终态 JSON。调用方只需等待返回，切勿自行包装：

- **不要自行轮询**：系统已在内部轮询并写回，重复轮询多此一举，还可能读到尚未落库的中间态。
- **不要提前 kill 命令（或给它设 timeout）**：生成耗时不定（视频可达数分钟）；轮询与写回全靠该命令进程，提前杀掉它，任务状态就根本不会再被更新 / 写回，节点一直卡在「生成中」。
- **不要后台运行**：命令已阻塞到终态，后台化反而拿不到返回的终态 JSON。
- **不要因看到 taskId 就提前停止**：`[run] task=...` 只是中途进度日志、不是结果；提前停止同样会让任务状态无法更新，节点一直卡在「生成中」。

**终态与退出码**：终态 JSON 里的任务 `status` 取值如下，失败类终态会在 stderr 打印原因并以**非 0** 退出，脚本 / 管道可直接用退出码判断成败。

| `status` | 含义                                               | 退出码 |
| -------- | -------------------------------------------------- | ------ |
| `2`      | 成功                                               | `0`    |
| `3`      | 失败                                               | 非 `0` |
| `4`      | 超时（服务端判定生成超时，原因固定为「生成超时」） | 非 `0` |

视频模型若需 Seedance 合规校验，`--run` 会在提交前自动完成（见 [../node-types/video.md](../node-types/video.md) 的「合规校验」）；校验不通过时不提交生成、直接非 0 退出。

### `libtv node create <node>`

用法骨架：`libtv node create <node> [flags]`

**位置参数**

- **`<node>`**（必填）：新节点的**展示名**（画布上需唯一）。

**与默认子命令的差异**

| 条目         | 差异                                                                            |
| ------------ | ------------------------------------------------------------------------------- |
| 只新建       | 同名 / 同 id 已存在时**报错**；更新已有节点改用默认子命令 `libtv node <node>`。 |
| `-t, --type` | **必填**。**不能**创建画布 `group`（用 [`libtv group`](./group.md)）。          |
| `-r, --run`  | 新建成功后立即触发一次生成。                                                    |
| `--name`     | **不接受**；展示名由位置参数 `<node>` 承载。                                    |

**相同语义的选项**：`-p` / `-g` / `-t`（这里必填）/ `--prompt` / `-s` / `-u` / `--left` 系列 / `-r`，语义同默认子命令——写参见 [../node-types/README.md](../node-types/README.md)，连线见 [../node-relation/connection.md](../node-relation/connection.md)。`--x` / `--y` 为新节点落点（画布绝对坐标，缺省 `0`，有分组时自动换算为组内坐标），由父级 `node` 解析，须写在 `create` 前：`libtv node --x 720 --y 260 create <node> ...`。

### `libtv node list`

用法骨架：`libtv node list [flags]`

**位置参数**：无。

**选项**：公共参数 `-p` / `-g`；其中 `-g` 限定只列该分组 `childNodeIds` 内子节点，未传时列全画布。

**输出**：含 `scope` / `count` / `nodes` 等。

### `libtv node delete <node>`

用法骨架：`libtv node delete <node> [flags]`

**位置参数**

- **`<node>`**（必填）：节点 id 或展示名，**id 优先**、精确匹配（语义同默认子命令的 `<node>`）。

**选项**：公共参数 `-p` / `-g`；其中 `-g` 仅允许删组内子节点，跨组报错。

**副作用**：同时删除该节点的全部连线。

## 示例

```bash
# case 1: 查询单个节点（已设定画布上下文）
libtv node "剧情"

# case 2: 列出画布全部节点 / 仅列某个分组内
libtv node list
libtv node list -g "本镜资源组"

# case 3: 新建文本节点并一次性写好提示词与模型
libtv node create "剧情" -t text --prompt "写一段分镜旁白" -s "model=GVLM 3.1"

# case 4: 改已有节点参数（默认子命令不接受 -t，类型从画布推断）
libtv node "剧情" --set prompt="改后的提示全文" --set "model=GVLM 3.1"

# case 5: --prompt 会覆盖 -s prompt=…，最终 params.prompt=「最终版」
libtv node "剧情" -s prompt="旧版" --prompt "最终版"

# case 6: 仅改节点自身内容（不影响模型下次如何生成）
libtv node "剧情" -u content='["你好世界","第二段"]'

# case 7: 节点已存在、无改参时仅触发一次生成
libtv node "剧情" --run

# case 8: 按坐标新建视频节点并立即生成（--x/--y 写在 create 前）
libtv node --x 720 --y 260 create "镜头-01" -t video \
  -s "model=Seedance 2.0 VIP" -s modeType=text2video -s ratio=16:9 \
  --prompt "A cinematic 4-second shot of a futuristic city at sunrise." \
  --run

# case 9: 移动已有节点（只传一轴则另一轴不变）
libtv node "剧情" --x 20 --y 20
libtv node "剧情" --x 400

# case 10: 改名（仅默认子命令支持；node create 不接受 --name）
libtv node "旧名" --name "新名"

# 连线 / 改边示例见 ../node-relation/connection.md；{{Node}} 引用示例见 ../node-relation/mention.md

# case 12: 改边与生成一条命令搞定
libtv node "剧情" --left 参考图 --run

# case 13: prompt 里用 {{Node …}} 引用已连线的图片 / 视频（优先按节点名）
libtv node "改图" --left 原图 --left 参考猫 --left 参考动作 \
  --prompt "把 {{Node \"原图\"}} 中的小狗替换成 {{Node \"参考猫\"}} 中的小猫，动作参考 {{Node \"参考动作\"}}" \
  --run
```
