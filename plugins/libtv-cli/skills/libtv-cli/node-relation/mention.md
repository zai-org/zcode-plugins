# prompt 占位符 `{{Node …}}`

> 节点关系，索引见 [README.md](./README.md)。用于 [`node`](../commands/node.md) 的 `--prompt` / `-s prompt=…` / [`node create`](../commands/node.md) 文案。

文案里用 `{{Node …}}` 引用**已连线到该节点**的上游图片 / 视频 / 音频（连线见 [connection.md](./connection.md)）。有两种写法：

- **`{{Node "节点名"}}`（手写 prompt 优先推荐）**：用**成对引号**包裹上游节点的**展示名**（与 `<node>` 定位用的名字一致）。写入时按整张画布精确匹配该名——**唯一**命中即自动解析为该节点；**画布内有多个同名**→整条写入中止并报错（错误里告知同名数量，请改用 `{{Node <nodeKey>}}` 精确指定）；找不到该名 / 该节点未连线到本节点→同样报错。不要写 `{{Node 节点名}}`，无引号会被当成 nodeKey。
- **`{{Node <nodeKey>}}`**：`<nodeKey>` 即查询输出里的 **`nodeKey`**，直接锚定节点身份。当节点同名、或想最稳妥时用它。系统**读取节点时一律把 prompt 占位符显示为 `{{Node <nodeKey>}}`**；若 `<nodeKey>` 未连线到本节点，则整条写入中止并报错。

> `{{Node …}}` 是命令与模型之间的占位符层，系统会按该节点当前入边自动落库，**不影响网页端展示**。

```bash
# 优先：按节点名引用（名字在画布内唯一时；带引号）
libtv node "改图" --left 原图 --left 参考猫 --left 参考动作 \
  --prompt "把 {{Node \"原图\"}} 中的小狗替换成 {{Node \"参考猫\"}} 中的小猫，动作参考 {{Node \"参考动作\"}}"

# 同名或求稳：按 nodeKey 引用（先查到上游 nodeKey，再写入）
libtv node "改图" --left 原图 --left 参考猫 --left 参考动作 \
  --prompt "把 {{Node <原图nodeKey>}} 中的小狗替换成 {{Node <参考猫nodeKey>}} 中的小猫，动作参考 {{Node <参考动作nodeKey>}}"

# 配合 --run 一步到位
libtv node "改图" --left 原图 --left 参考猫 --left 参考动作 \
  --prompt "把 {{Node \"原图\"}} 中的小狗替换成 {{Node \"参考猫\"}} 中的小猫，动作参考 {{Node \"参考动作\"}}" \
  --run
```
