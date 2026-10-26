# `libtv video` — 视频节点后处理（高清 / 样片转正片）

对画布上**已生成成功的 `video` 节点**做后处理：在源节点右侧**新建**一个视频节点、自动从源节点连线，随后立即发起生成并**同步等待终态**。对应画布视频节点工具栏的「高清」与样片节点的「生成正片」入口。目标画布由 `-p` 指定，分组范围由 `-g` 指定（缺省来源均见 [../concepts/context.md](../concepts/context.md)）。

普通的视频生成（文生 / 图生 / 参考等）不走本命令，用 [`libtv node … --run`](./node.md)，参数见 [../node-types/video.md](../node-types/video.md)。

## 子命令

| 子命令                            | 作用                                                                 |
| --------------------------------- | -------------------------------------------------------------------- |
| **`libtv video hd list`**         | 列出可用的视频高清（超分）模型。                                     |
| **`libtv video hd -n <node>`**    | 对源视频节点做高清：右侧新建高清节点并生成。                         |
| **`libtv video final -n <node>`** | Seedance 2.5 样片转正片：右侧新建 1080P 正片节点并用原任务参数生成。 |

两个执行子命令都**不带 `-n` 时只打印帮助**、不执行。

## 公共参数

以下参数 `video hd`（执行模式）与 `video final` 通用。

| 选项                      | 必填 | 说明                                                                                                   |
| ------------------------- | ---- | ------------------------------------------------------------------------------------------------------ |
| `-n, --node <node>`       | 是   | 源视频节点 id 或展示名（精确匹配、id 优先，同 [`node`](./node.md) 的 `<node>`）；须为 `video` 节点。   |
| `-p, --project <project>` | 否   | 目标画布 **UUID**。                                                                                    |
| `-g, --group <group>`     | 否   | 父级普通分组：`-n` 只在该组子节点内解析，新节点也挂入该组。未传时若已 `group use` 则自动套用绑定分组。 |
| `--x <n>` / `--y <n>`     | 否   | 新节点的画布坐标（像素）；默认取源节点位置向右偏移、纵向对齐。                                         |

### `libtv video hd list`

用法骨架：`libtv video hd list`

**位置参数**：`list`（字面量）。

**输出**：`nodeType`、`generatorType`（固定 `enhance`）、`defaultModelKey`（缺省使用的高清模型）、`models`（每项含 `modelKey` / `modelName`）。

### `libtv video hd -n <node>`

用法骨架：`libtv video hd -n <node> [--model <modelName>] [flags]`

**前置条件**：源节点须已有可用视频。

**选项**（另支持上方公共参数）

| 选项              | 必填 | 说明                                                                                  |
| ----------------- | ---- | ------------------------------------------------------------------------------------- |
| `--model <model>` | 否   | 高清模型名字（`modelName`）；缺省取 `video hd list` 里的 `defaultModelKey` 对应模型。 |

**输出**：同 [`node --run`](./node.md) 的终态 JSON（作用对象是新建的高清节点）；失败终态退出码非 0。

### `libtv video final -n <node>`

用法骨架：`libtv video final -n <node> [flags]`

**前置条件**（任一不满足即报错退出，不新建节点）

| 条件                                             | 不满足时                                 |
| ------------------------------------------------ | ---------------------------------------- |
| 源节点是**生成成功**的 `video` 节点，带可用视频  | 报「源节点必须是生成成功的样片视频节点」 |
| 源节点当前任务是 **Seedance 2.5 样片**模型生成的 | 报「该节点的任务不是 Seedance 2.5 样片」 |
| 样片生成时间在 **7 天**以内                      | 报「样片已超过 7 天」，需重新生成样片    |

正片使用样片任务在服务端保存的原参数提交，**不接受** `-s` 改参；想换参数请重新生成样片。

**输出**：`ok`、`nodeKey`（新正片节点）、`name`、`sourceNodeKey`、`taskId`、`status`；成功时 `ok: true` 并带 `url`（`string[]`）。失败终态（`status` 为 `3` 失败 / `4` 超时）时 `ok: false`、带 `failedReason`（无 `url`），stderr 打印失败原因，退出码非 0——与 [`node --run`](./node.md) 的终态口径一致。

## 示例

```bash
# case 1: 先看有哪些高清模型
libtv video hd list

# case 2: 用默认高清模型对「镜头-01」做高清（阻塞到终态）
libtv video hd -n "镜头-01"

# case 3: 指定高清模型，并限定在某分组内解析源节点
libtv video hd -n "镜头-01" --model "<modelName>" -g "首集分镜"

# case 4: Seedance 2.5 样片满意后转正片（7 天内）
libtv video final -n "镜头-01-样片"

# case 5: 取出正片地址；失败 / 超时时退出码非 0，原因在 stderr
set -o pipefail
URL=$(libtv video final -n "镜头-01-样片" | jq -r '.url[0]') || echo "正片生成失败"
```
