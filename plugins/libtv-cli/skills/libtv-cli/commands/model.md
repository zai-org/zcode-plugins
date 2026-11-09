# `libtv model` — 查模型与 schema

检索可用生成模型、查看其完整 schema，便于写 [`node -s model=…`](./node.md)。

`schema` 各块含义见 [../model-schema/README.md](../model-schema/README.md)。

## 子命令

| 子命令                              | 作用                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| **`libtv model search [name...]`**  | 按关键词搜可用模型；可加 `--type` 限定节点类型（不给关键词时必须带 `--type`）。 |
| **（默认）`libtv model <name...>`** | 按模型名 / key 精确查一个模型，输出它的完整 schema。                            |

### `libtv model search [name...]`

按名字模糊搜模型。`[name...]` 是关键词（多词自动拼成一段，不区分大小写）。

- 只给关键词：在所有模型里搜。
- 加 **`-t, --type <类型>`**：只在该节点类型下搜，类型取 `text` / `image` / `video` / `audio` / `script` / `storyboard`（`script` / `storyboard` 会一并搜出对应的文本与配图模型）。
- 不给关键词时**必须**带 `--type`，相当于「列出该类型下所有模型」。

| 选项                     | 必填 | 说明                                                                                                        |
| ------------------------ | ---- | ----------------------------------------------------------------------------------------------------------- |
| `-t, --type <node-type>` | 否   | 限定节点类型；不给关键词时必填。取值见上。                                                                  |
| `--all`                  | 否   | 不按平台过滤。默认只列**网页端可见**的模型（与网页模型列表一致）；加上后列出全量，包含仅 App 端开放的模型。 |

**输出**：匹配到的模型列表（含模型名、key 等）。

### `libtv model <name...>`（默认子命令）

按**模型名或 key** 精确查一个模型（多词自动拼成一段；含空格用引号），输出它的完整 schema（字段、类型、可选值等）。名字对不上、或一个名字命中多个模型时会报错——后者改用唯一的 `modelKey`。

## 示例

```bash
# 按关键词搜（不区分大小写）
libtv model search seedance

# 只在 video 类型下搜
libtv model search --type video seedance

# 列出某类型下全部模型（不给关键词，必须带 --type）
libtv model search --type image
libtv model search --type script   # 同时覆盖文本与配图模型

# 默认只列网页端可见的模型；要连仅 App 端开放的一起看，加 --all
libtv model search --type video --all

# 精确查一个模型，拉出完整 schema（写 -s 前参考）
libtv model lib-image-2

# 名字含空格用引号
libtv model "Seedance 2.0 VIP"

# 配合 jq 速查可调字段
libtv model "Lib Navo Pro" | jq '.schema.properties | keys'
```
