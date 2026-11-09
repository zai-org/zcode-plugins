# 节点类型：`audio` — 音频 / 语音生成节点

## 整体节点用途

**音频 / 语音生成节点**：按模型能力产出**配音、BGM、纯乐器**等音频。大部分音频模型 `schema` **没有** `modeType.items`，入边 / 媒体条数不由该结构表达，而由 `rules` 与画布连接规则决定。常见相邻节点：上游 `text`（作为文案）；下游 `video` / `video-clip`（合成驱动）。

**通用约定**：[README.md](./README.md)。**`schema` 各块含义**：[../model-schema/README.md](../model-schema/README.md)。

## 案例

见[示例](../SKILL.md)。

## 常见生成器参数（`-s / --set`）

写入 **`data.params`**。schema 里的可调字段一律 **`-s 字段名=值`** 写入，系统会自动归位。字段名用 schema 的逻辑名即可（如 `voice`）。

| 字段         | 说明                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`prompt`** | 文案或描述（按模型而定）。                                                                                                                                 |
| **`model`**  | 音频模型 **名字（`modelName`）**，如 `-s "model=Eelven V3"` / `-s "model=Mureka V8"`（用 `libtv model search --type audio` 查看；内部解析为 `modelKey`）。 |
| **`scene`**  | 业务场景 / 子模式字符串（`schema` 顶层 `scene` / `sceneName` 提示用途）。若模型默认带 `scene`，新建时按 schema 填初始值，更新时 `--set scene=…` 可覆盖。   |
| **`count`**  | 条数。                                                                                                                                                     |

其余可调字段随 `modelKey` 变化，以 `libtv model <modelKey>` 输出为准。

### 抽样：`vocal-v3`（`libtv model vocal-v3`）

| 字段        | `-s / --set` 写法   | 备注                                 |
| ----------- | ------------------- | ------------------------------------ |
| `voice`     | `-s voice=…`        | 也可写 `voice_id=…`。                |
| `stability` | `-s stability=0.5`  | `0 / 0.5 / 1`，默认 `0.5`。          |
| `duration`  | `-s duration=60000` | 也可写 `music_length_ms=…`（毫秒）。 |

### 抽样：`vocal-music`（`libtv model vocal-music`）

- **`duration`**：`-s duration=60000`（毫秒枚举如 **`30000`**、**`60000`**）。

### 抽样：`mureka-8`（`libtv model mureka-8`）

- **`instrumental`**（展示名「纯乐器」）：`-s instrumental=1`（switch，默认 **`1`**）。

## 常见属性参数（`-u / --update`）

`audio` 节点 `data` 顶层以**上传 / 任务链路**写入为主；`node-data.ts` 只定义了 `url`（`string[]`）等少量字段。日常需要人工改时，几乎都是：

| 想改的东西                                            | 正确入口                         |
| ----------------------------------------------------- | -------------------------------- |
| `prompt` / `model` / `voice` / `stability` 等生成相关 | `-s / --set`（写 `data.params`） |
| 展示名                                                | `--name`（不要用 `-u` 改名）     |

若确需手工改 `data.url` 等，先用 `libtv node "<名>"`（仅查询）打出节点 JSON 对照字段名再写（不违反 [README.md](./README.md) 的「`-u` 明确拒写的键」）。

## 特殊用法

- **列出 / 查询音频模型**：`libtv model search --type audio`、`libtv model <modelKey>`（见 [../commands/model.md](../commands/model.md)）。
- 音频模型通常用 `rules` 约束「至少要 `prompt`」或其它组合；能否生成以 `libtv model <modelKey>` 输出为准。
