# 工作流：一条命令建节点 + 连上游 + 触发生成

**覆盖**：`libtv node create` 把「建节点 / 改参数 / 连上游 / 触发生成」合并为一步，等价于顺序跑 [`create-and-run.md`](./create-and-run.md) 的 2–4 步。

**前置条件**：同 [README.md 的通用前置条件](../README.md#通用前置条件)；画布上已存在显示名为「参考图」的上游节点。

```bash
libtv node create "剧情" -t text \
  --prompt "根据参考图写一段分镜旁白" \
  --set "model=GVLM 3.1" \
  --left 参考图 \
  --run
```

关键点：

- 展示名由**位置参数** `<node>`（这里是 `"剧情"`）承载；`node create` **不接受** `--name`。
- `--left <上游>` 的值接受**显示名**或 `nodeKey`（只要在当前项目 / 分组范围内唯一）。
- `--run` 建完后立即触发生成；省略则仅建节点、不触发。
