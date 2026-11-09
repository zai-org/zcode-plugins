# 工作流：修改已有节点的生成参数

**覆盖**：用 `-s/--set` 打生成参数补丁（`data.params.*`），用 `-u/--update` 调整非生成属性（`data.*` 顶层），以及两者混合时的顺序。`-s` vs `-u` 的完整定义见 [../../node-types/README.md](../../node-types/README.md)。

**前置条件**：同 [README.md 的通用前置条件](../README.md#通用前置条件)；画布上已有名为「剧情」的文本节点、「主镜头」的视频节点。

```bash
# case A: 改生成参数 —— 影响下次生成
libtv node "剧情" --set prompt="换一种叙事口吻" \
                 --set "model=GVLM 3.1" \
                 --run

# case B: 改节点属性 —— 不影响生成（此处仅改节点内容；改展示名走 --name）
libtv node "剧情" -u content='["开场旁白改写版"]'

# case C: 混合（改名 + 参数 + 触发生成）
libtv node "主镜头" --name "主镜头-最终" \
                   --set ratio=16:9 --set duration=5 \
                   --run
```

关键点：

- `--set a.b=1` 会被**展开到 `data.params.a.b`**（深合并到已有 `params`）。
- 改展示名走 `--name`（不要用 `-u` 改名）；`-u params=…` 会被拒绝（请改用 `--set`）。
- 同命令里 `-s` 与 `-u` 都在**一次提交**里生效，顺序不重要。
