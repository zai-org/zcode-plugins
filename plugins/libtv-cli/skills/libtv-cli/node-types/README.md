# 画布节点类型（`-t`）— 索引

本目录按 **画布节点 `type`** 拆成独立文件；每个文件只写**该类型特有**的说明（生成器参数、属性参数、特殊用法）。**写参通用约定**（`-s` / `-u` / `--prompt` / `--name`）**统一在本页维护**，[`commands/node`](../commands/node.md) 与各 type 文件都**链接**回来、不复读。连线见 [../node-relation/connection.md](../node-relation/connection.md)。

## 类型索引

| 类型             | 文档                             | `libtv node -t` 新建 | `libtv node` 更新 `params`         | `libtv node --run` |
| ---------------- | -------------------------------- | -------------------- | ---------------------------------- | ------------------ |
| **`text`**       | [text.md](./text.md)             | 是                   | 是                                 | 是                 |
| **`image`**      | [image.md](./image.md)           | 是                   | 是                                 | 是                 |
| **`video`**      | [video.md](./video.md)           | 是                   | 是                                 | 是                 |
| **`audio`**      | [audio.md](./audio.md)           | 是                   | 是                                 | 是                 |
| **`script`**     | [script.md](./script.md)         | 是                   | 是                                 | 是                 |
| **`storyboard`** | [storyboard.md](./storyboard.md) | 是                   | 是                                 | 是                 |
| **`video-clip`** | [video-clip.md](./video-clip.md) | 是                   | 是（浅合并，无生成器 schema 校验） | 是                 |

画布上仍可能存在但 **不支持**的类型：**`custom`** / **`group`** 等——创建 / 更新 / 运行均勿走 [`libtv node`](../commands/node.md)；分组改用 [`libtv group`](../commands/group.md)；[`libtv model search --type <type>`](../commands/model.md) 也只接受上表中**带生成模型**的六个类型（`text` / `image` / `video` / `audio` / `script` / `storyboard`）。

## 查模型与 schema

| 命令                                        | 用途                                                                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **`libtv model search --type <node-type>`** | 列出该类型当前环境可用的 **`modelKey`** 与展示名；无关键字即「列出全部」（详见 [commands/model.md](../commands/model.md)）。 |
| **`libtv model search <keyword>`**          | 按关键词检索（不分大小写子串匹配）；可叠加 `--type`。                                                                        |
| **`libtv model <modelKey>`**                | 对 `modelKey` / `modelName` **全等**匹配后输出完整 **`schema`** JSON，对照写 `-s/--set`。                                    |

**`schema` 各块释义**（`properties` / `config` / `rules` / `modeType`）：[../model-schema/README.md](../model-schema/README.md)。

## `-s/--set` vs `-u/--update`（权威对比）

> 两者都是 `key=value`（首个 `=` 拆分，值支持 `true/false/数字/JSON`），但**落地位置完全不同**，**不能互换**。**展示名永远走 [`--name`](../commands/node.md)**（请勿用 `-u` 改名；`-u label=…` 会被拒）。

| 维度         | **`-s, --set`**                                                                                                           | **`-u, --update`**                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 写入位置     | **`data.params.*`**                                                                                                       | **`data.*`**（**不含** `params`）                                                           |
| 语义         | **生成器参数** —— 模型这次**怎么生成**（`prompt` / `model` / `count` / `modeType` 等模型可调字段）                        | **节点自身属性** —— 节点本体承载的**内容**（`content` / `rows` / …），**不影响**模型参数    |
| schema 校验  | 严格：按当前 `modelKey` 的 `properties` / `config` / `rules` 校验；字段自动归位到 `params` 内对应位置；`count` 超范围报错 | 不走生成器 schema；**按节点类型白名单**收键并校验值的形状（见下），通过后浅写到 `data` 顶层 |
| 触发 `--run` | 是                                                                                                                        | 是                                                                                          |
| 典型写法     | `-s prompt=...` / `-s "model=LibNano Pro"`（只接受模型名字 modelName，含空格需引号） / `-s ratio=16:9` / `-s count=2`     | `-u content='["Hello"]'` / `-u rows='[{...}]'` / `-u title="..."`                           |

### `-u` 明确拒写的键

| 键                                                                       | 替代                                                                                                                                              |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`params`**                                                             | 用 **`-s / --set`** 或 **`--prompt`**                                                                                                             |
| **`label`**                                                              | 改展示名用 **`--name <text>`**（仅 [默认子命令 `libtv node <node>`](../commands/node.md) 生效；`-u label=…` 会被拒，`label` 同步时归一为 `name`） |
| **`type`**                                                               | 节点类型**不可**通过命令变更                                                                                                                      |
| **`action` / `taskInfo` / `prevTaskInfo` / `generatorType` / `isStale`** | 由画布 / 任务链路维护，**不可**手写                                                                                                               |

> 经验法则：**「会让模型输出不同结果的 → `-s`；只是改节点里放什么（文本 / 行等内容）→ `-u`」。展示名永远走 `--name`，不要用 `-u` 改名**。

### `-s` 写法

模型的可调字段一律 **`-s 字段名=值`** 逐键写入（如 **`-s ratio=16:9`**、**`-s quality=2K`**），系统会按 schema 自动归位到 `params` 内对应位置。字段名用 `libtv model <modelKey>` 输出里的逻辑名即可。

### `--prompt` 与 `--name`

- **`--prompt <text>`**：写 `data.params.prompt`，是 `-s prompt=…` 的快捷写法；两者同用时 **`--prompt` 后写入并覆盖**。文案里可用 `{{Node …}}` 引用已连线的上游媒体，见 [../node-relation/mention.md](../node-relation/mention.md)。
- **`--name <text>`**：改**展示名**的唯一入口（仅默认子命令 `libtv node <node>` 可用；`node create` 的展示名由位置参数承载）。**不要**用 `-u` 改名（`-u label=…` 会被拒）。

## 各类型 `-u` 可写字段（白名单）

`-u` **只接受**下表列出的键，并在写入前校验值的形状（如 `url` 必须是字符串数组、宽高必须是正数）；表外的键、或形状不对的值会在写入前报错，报错信息里带正确写法示例。由上传 / 任务回写 / 合规 / 连线重算维护的字段（如合规凭证、分镜行关联 UUID、配图组关联）**一律不可**用 `-u` 写。

| 类型                    | 可写 `-u` 键                                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `text`                  | **`content`**（`string[]`）、**`nodeWidth`**、**`nodeHeight`**                                                                                                                                                     |
| `image`                 | **`url`**、**`originalUrl`**、**`alt`**、**`showGenerator`**、**`rotateAngle`**、**`contentWidth`**、**`contentHeight`**                                                                                           |
| `video`                 | **`url`**、**`poster`**、**`contentWidth`**、**`contentHeight`**、**`transition`**（`{"type":"fade","duration":0.5}`）                                                                                             |
| `audio`                 | **`url`**                                                                                                                                                                                                          |
| `script` / `storyboard` | **`rows`**、**`title`**、**`viewMode`**（`table` \| `creative`）、**`shotColumns`**、**`views`**、**`activeViewId`**、**`sourceType`**、**`scriptModel`**、**`imageGenConfig`**、**`nodeWidth`**、**`nodeHeight`** |
| `video-clip`            | **`url`**、**`poster`**、**`cropRange`**、**`clipTimelineData`**、**`saveToNodeOnComplete`**、**`contentWidth`**、**`contentHeight`**、**`embedContentHeight`**                                                    |

## 文档内模型示例来源

下文中 **`modelKey`** 与 **`libtv model <modelKey>`** 输出抽样采自 **2026-04-14** 对默认环境执行 [`libtv model search --type …`](../commands/model.md) / `libtv model …` 的结果；线上列表会变更，以你本机实时命令为准。
