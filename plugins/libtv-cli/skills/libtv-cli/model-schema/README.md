# 模型 Schema — 索引

[`libtv model <modelKey>`](../commands/model.md) 输出的单模型 `schema` 对象由四块组成。本目录每块一文件，只解释**字段含义**与**校验逻辑**。

## 四块概览

| 块                        | 回答的问题                                     | 详见                             |
| ------------------------- | ---------------------------------------------- | -------------------------------- |
| **`properties`**          | 有哪些可调参数、控件、默认值、合法取值         | [properties.md](./properties.md) |
| **`properties.modeType`** | 支持的生成模式，及各模式下媒体的入边数量上下限 | [mode-type.md](./mode-type.md)   |
| **`config`**              | 设置面板布局、任务映射（命令行无需关心布局）   | [config.md](./config.md)         |
| **`rules`**               | 参数校验规则：当前是否**允许发起一次生成**     | [rules.md](./rules.md)           |
