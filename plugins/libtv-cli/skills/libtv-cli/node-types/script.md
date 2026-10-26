# 节点类型：`script` — 脚本（剧情 / 结构化文本工作流）节点

## 整体节点用途

**脚本节点**：承载**剧情 / 结构化文本工作流**，节点本体是一张「分镜表」（`data.rows`、列元数据、视图模式等），也可按所选模型直接生成一张或多张结构化行。与 [`storyboard`](./storyboard.md) **共用同一套生成器数据结构**（`data.type` 恒为 `script`，React Flow `type` 区分）。

**通用约定**：[README.md](./README.md)。**`schema` 各块含义**：[../model-schema/README.md](../model-schema/README.md)（文本侧同 [text.md](./text.md)，配图侧同 [image.md](./image.md)）。

## 案例

见[示例](../SKILL.md)。

## 常见生成器参数（`-s / --set`）

写入 **`data.params`**，走所选 `modelKey` 的 schema 校验。`-s model=` 只接受**模型名字（`modelName`）**（如 `-s "model=GVLM 3.1"`，含空格需引号；内部解析为 `modelKey`），且必须是 **`scriptText`** 维度 support 列表中的模型；若改图片配图侧使用，则用 `scriptImage` 维度的图片模型名字。

| 字段         | 说明                                                                             |
| ------------ | -------------------------------------------------------------------------------- |
| **`prompt`** | 主提示。                                                                         |
| **`model`**  | `scriptText` 侧**模型名字（`modelName`）**（剧情 / 结构化文本）；配图侧见下。    |
| **`count`**  | 生成次数 / 条数，须在模型允许范围内。                                            |
| **`scene`**  | 脚本业务场景；新建默认常为 **`script-generate`**；其它取值以 schema / 产品为准。 |

其余可调字段随 `modelKey` 变化，一律 `-s 字段名=值` 写入，以 `libtv model <modelKey>` 输出为准。

### `scriptText` 模型（如 `aurora-3-prime`）

`libtv model aurora-3-prime` 抽样：主要为 `properties.modeType`（多模态槽位）与 `rules`（常要求 `prompt`）。`--set modeType=…` 等与 [text.md](./text.md) 相同思路。

### `scriptImage` 模型（如 `nebula-ultra`）

[`libtv model search --type script`](../commands/model.md) 里 `scriptImage` 下列出的实为**图片**模型；可调字段与 [image.md](./image.md) 中 `nebula-ultra` 表一致（`quality`、`ratio`、`searchable` 等）。

## 常见属性参数（`-u / --update`）

写入 **`data`** 顶层，**不**经生成器 schema 校验——这是改「分镜表数据」的主要入口。

| 键                       | 类型                 | 说明                                                                  |
| ------------------------ | -------------------- | --------------------------------------------------------------------- |
| **`rows`**               | `StoryboardRowCli[]` | 分镜表行数据；逐行逐列改分镜内容的主入口。**字段见下表。**            |
| **`title`**              | `string`             | 脚本 / 分镜标题（后端返回，**只读**，勿手设）。                       |
| **`linkedImageGroupId`** | `string`             | 关联的分镜图组节点 id（跑分镜图时由画布自动写入，**只读**，勿手设）。 |

> 生成参数（`prompt` / `model` / `count` / `scene`）请用 `-s`；展示名用 `--name`。`-u` 用户实际只需改 `rows`；表头列标题由服务端 `shotColumns` 决定，缺省时画布自动用默认中文表头，无需手设。

### `rows[*]` 字段（`StoryboardRowCli`）

每一行 = 一个镜头（对齐分镜表 Shots 字段规范）。整列改值时按行重写整个 `rows` 数组传入；除 `shotNumber` 外其余字段均可编辑。

| 字段                        | 类型                          | 说明                                                                             |
| --------------------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| `id`                        | `string`                      | 行唯一标识，用于与分镜图组 item 关联；新增行可省略由后端补。                     |
| `shotNumber`                | `number`                      | 镜号，从 1 递增（展示用，**不建议手改**，画布会按行序自动重排）。                |
| `durationSeconds`           | `number`                      | 单镜时长（秒），范围约 1.0–15.0。                                                |
| `plotDescription`           | `string`                      | 情节 / 画面描述。                                                                |
| `characters`                | `StoryboardCharacterCli[]`    | 角色信息数组，**结构见下**；画布按各行 `characters` 的最大数量动态加「角色」列。 |
| `videoReference`            | `StoryboardVideoReferenceCli` | **视频参考图**（该镜头的参考帧图片，非参考视频片段）；可选，**结构见下**。       |
| `shotSize`                  | `string`                      | 景别（特写 / 近景 / 中景 / 全景 / 远景）。                                       |
| `characterAction`           | `string`                      | 角色动作 / 表演定位。                                                            |
| `emotion`                   | `string`                      | 微表情及心理状态。                                                               |
| `sceneTags`                 | `string`                      | 场景环境描述标签。                                                               |
| `lightingAndAtmosphere`     | `string`                      | 灯光布局与环境氛围。                                                             |
| `audioEffects`              | `string`                      | 音效 / 环境音 / 背景音乐。                                                       |
| `dialogue`                  | `string`                      | 角色台词及语气。                                                                 |
| **`imageGenerationPrompt`** | `string`                      | **核心**：分镜画面（配图）生成提示词；`libtv script storyboard` 逐张生成即读它。 |
| **`videoMotionPrompt`**     | `string`                      | **核心**：视频运动生成提示词。                                                   |
| `hiddenUuid`                | `string`                      | 前端生成的隐藏 UUID，用于关联分镜图等后续功能；一般无需手设。                    |

#### `characters[*]` 字段（`StoryboardCharacterCli`）

| 字段                   | 类型     | 说明                               |
| ---------------------- | -------- | ---------------------------------- |
| `characterName`        | `string` | 角色名称。                         |
| `characterDescription` | `string` | 外貌、服装、发型、妆造及配饰描述。 |
| `characterImageUrl`    | `string` | 角色参考图链接（可为空）。         |

#### `videoReference` 字段（`StoryboardVideoReferenceCli`）

> 这一列在画布上就是「视频参考图」——一张图片，**指该镜头的参考帧图，不是参考视频**。只需填 `referenceFrameImage`。

| 字段                      | 类型     | 说明                                      |
| ------------------------- | -------- | ----------------------------------------- |
| **`referenceFrameImage`** | `string` | 参考帧图片 URL；表格/创意视图按图片展示。 |

## 特殊用法

- **上游为参考图**：把 `image` 资源节点连到 `script` 节点左侧后 `--run`，可用作分镜生成的参考素材（上游类型与条数约束见 `scriptText` 侧 schema）。
- **生成分镜图组**：脚本节点已有分镜行后，用 [`libtv script storyboard <脚本>`](../commands/script.md) 对齐画布「生成分镜」——在右侧新建分镜图组、按行派生 `image` 子节点并逐张 run。分镜图模型 / 参数取自脚本节点 `imageGenConfig`，可用 `-s` 覆盖（如 `-s "model=Seedream 4.0" -s aspectRatio=16:9`）。
- **列出 / 查询脚本模型**：`libtv model search --type script`（同时返回 `scriptText` 与 `scriptImage` 两套）；`libtv model <modelKey>`。详见 [../commands/model.md](../commands/model.md)。
- 分镜行批量写入的典型流水线：见[示例](../SKILL.md)。
