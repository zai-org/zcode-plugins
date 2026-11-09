# `properties` — 参数定义（含控件与特殊键）

> 模型 schema 四块之一，索引见 [README.md](./README.md)。

`properties` 是 **`Record<string, PropertyLike>`**：每个 **key** 对应一类可调参数或一类能力描述；**value** 多为对象，描述如何展示、默认值、合法取值等。

## 常见「参数项」子字段（value 为对象时）

| 子字段                          | 含义                                                                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **`displayName`**               | 面板上展示的名称（如「比例」「清晰度」）。                                                                                          |
| **`default`**                   | 默认值；`switch` 上常见 `0` / `1`。                                                                                                 |
| **`enum`**                      | 可选值：字符串/数字，或 `{ value, displayName }[]`。                                                                                |
| **`component`**                 | 控件类型，如 `singleButton`、`switch`、`slider`、`input`。                                                                          |
| **`originalField`**             | 写入 `params` 时实际使用的**键名**（可能与 `properties` 的 key 不同）；不写则与 key 一致。命令行用逻辑 key 写即可，系统会按它归位。 |
| **`min` / `max` / `step`**      | 用于 `slider` 等数值范围。                                                                                                          |
| **`placeholder` / `maxLength`** | 常用于 **`prompt`** 等文本输入。                                                                                                    |
| **`tips`**                      | 辅助说明文案。                                                                                                                      |

## 与 `config` 的关系

- 部分 key 会被 [`config`](./config.md) 列入设置面板；**命令行无需关心面板布局**，一律 `-s key=value` 写入即可。
- **`prompt`、`count`、`modeType`** 等往往**不**出现在 `config` 里，而由生成器专用组件直接读 `properties` 里的同名定义。

## 常见 key（与生成模式相关）

| key                                                       | 含义摘要                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **`prompt`**                                              | 提示词输入的 UI 元数据；真实内容在节点 **`params.prompt`**。                                |
| **`count`**                                               | 批量条数，多为**数组**（如 `[1,2,4]`），表示可选张数/条数。                                 |
| **`modeType`**                                            | 见 [mode-type.md](./mode-type.md)：声明各**生成模式**及对应的 **`[min,max]`** 入边数量。    |
| **`magic` / `mention` / `portrait` / `cameraControl` 等** | 布尔或简单标记，表示是否开启某类交互或能力（与[参数校验规则](./rules.md) 无直接对应关系）。 |
| **`template` / `styles` / `lora` 等**                     | 风格、模板、LoRA 等：`maxCount`、选项等。                                                   |

## 嵌套的 `rules`（例如某 property 下的 `rules`）

部分 **`properties` 内部**会出现名为 **`rules`** 的数组（如营销、划线价条件），语义由**该 property / 业务模块**自行解释，**不是**[参数校验规则](./rules.md)（`schema.rules`），两者不要混用。
