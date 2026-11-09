# `libtv image` — 图片节点快捷工具

把画布上**图片生成器 / 图片工具栏九宫格**里能通过 `/` 触发的**图片节点工具**搬到命令行。子命令 **`shortcut`**：列表或在指定图片节点上执行一项图片节点工具。

画布 / 分组范围与 [`node`](./node.md) 一致：**`-p`**、**`-g`**（缺省来源见 [../concepts/context.md](../concepts/context.md)）。

## 子命令

| 子命令                                              | 作用                                                                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **`libtv image shortcut list`**                     | 列出当前环境可用的图片节点工具（与画布图片工具栏九宫格、图片生成器 `/` 面板一致）。                        |
| **`libtv image shortcut <scene\|label> -n <node>`** | 在指定图片节点上执行一项图片节点工具：按 `gridType` 选择「原地改图」或「右侧新建节点」，随后触发一次生成。 |

### `libtv image shortcut list`

用法骨架：`libtv image shortcut list`

**位置参数**：无。

**选项**：无。

**输出**：含 `nodeType`（固定为 `"image"`）与 `items[]`；每项含：

| 字段       | 类型 / 取值                    | 说明                                                                        |
| ---------- | ------------------------------ | --------------------------------------------------------------------------- |
| `scene`    | `string`                       | 工具场景 id（稳定 key），执行时作为 `<scene\|label>` 的**首选**匹配。       |
| `label`    | `string`                       | 中文展示名（如「电影级光影校正」「多机位九宫格」）。                        |
| `explain`  | `string`                       | 说明文案（可能为空）。                                                      |
| `gridType` | `4` / `9` / `16` / `25` / 缺省 | 九宫格类指令尺寸；**命中 `4/9/16/25` 走「原地改图」**，其余走「新建节点」。 |

### `libtv image shortcut <scene|label> -n <node>`

用法骨架：`libtv image shortcut <scene|label> -n <node> [flags]`

**位置参数**

- **`<scene|label>`**（必填）：图片节点工具定位。解析优先级：**① `scene` 全等** → **② `label` 全等**（重名会报错并提示用 `scene`） → **③ `scene` 前缀唯一命中**；都不匹配时会建议先跑 `libtv image shortcut list`。

**选项**

| 选项                      | 必填 | 说明                                                                                                                                                |
| ------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-n, --node <node>`       | 是   | 图片节点的 id 或展示名（`id` 优先、精确匹配）；节点必须为 **`image`** 类型，且**具备参考图**（入边或本节点已有 `http(s)` 图），否则报错。           |
| `-p, --project <project>` | 否   | 画布项目 UUID；缺省来源见 [../concepts/context.md](../concepts/context.md)。                                                                        |
| `-g, --group <group>`     | 否   | 父级**普通分组**（节点 id 或展示名）：限定 `-n` 的解析范围只在该组 `childNodeIds` 内；缺省来源见 [../concepts/context.md](../concepts/context.md)。 |
| `--x <n>` / `--y <n>`     | 否   | **仅「新建节点」分支**生效的画布坐标（像素）。默认：X = 源节点绝对 X + 420；Y = 与源节点齐平。**「原地改图」分支忽略**。                            |

**执行分支**（由命中条目的 `gridType` 决定）

| `gridType`                  | 画布落点                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `4` / `9` / `16` / `25`     | **原地改图**：对 `-n` 的源节点直接改展示名为 `label`、合并工具参数（`prompt` 强制为 `/`），再对同一节点 run 一次。 |
| 其它（含未声明 `gridType`） | **右侧新建节点**：在源节点右侧偏移处新建一个 `image`，入边 = 源节点（replace 语义），合并工具参数后 run 新节点。   |

**输出**

| 流     | 内容                                                                           |
| ------ | ------------------------------------------------------------------------------ |
| stdout | 含 `nodeKey`、`data` 等，与 [`libtv node --run`](./node.md) 的最终成功帧同构。 |
| stderr | 运行进度前缀 `[run-node] …`；失败的校验 / 接口错误以非 0 退出码呈现。          |

## 示例

```bash
# case 1: 列出当前环境可用的图片节点工具（便于抄 scene / label）
libtv image shortcut list

# case 2: 列表 + jq 只留九宫格类（gridType=4/9/16/25）
libtv image shortcut list | jq '.items[] | select(.gridType)'

# case 3: 原地改图——2x2/3x3/4x4/5x5 九宫格（--x/--y 会被忽略）
libtv upload "参考图" -f ./refs/a.png
libtv image shortcut "多机位九宫格" -n "参考图"

# case 4: 右侧新建节点——非九宫格工具（默认在源节点右侧偏移 420px 新建）
libtv image shortcut cinematic_lighting_correction -n "参考图"

# case 5: 新建节点时覆盖落点坐标（仅 new-node 分支生效）
libtv image shortcut cinematic_lighting_correction -n "参考图" --x 1200 --y 240

# case 6: 常见错误自检
#   - 源节点不是 image 类型：报错提示「`-n` 必须解析到画布上的 `image` 类型节点」。
#   - 源节点没有参考图（无入边且自身无 http(s) 图）：报错提示需「参考图」。
#   - label 重名：改用 scene，如「多机位九宫格」的 scene（见 `libtv image shortcut list` 的 items[].scene）。
```
