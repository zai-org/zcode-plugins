# 节点连线（改边）

> 节点关系，索引见 [README.md](./README.md)。命令入口是 [`node`](../commands/node.md) / [`node create`](../commands/node.md) 的连线 flag。

画布上节点通过**入边（左侧上游）/ 出边（右侧下游）**连接。CLI 只提供**入边**入口：端点（`<node>` 与 `--left` 系列的值）按 id / 展示名解析，受 `-g` 范围约束。

> **出边 flag 已移除**（`--right` / `--right-add` / `--right-rm`）：任何一条边都能从**下游节点**的视角用 `--left` 系列表达，出边只是同一件事的第二种写法。想把 A 连到 B，写 `libtv node B --left A`。

## 确保模式 vs 增量模式

| flag                                     | 语义                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `--left <node>`                          | **确保模式**入边：无则建边、已有则不变；**不会**删除未在列表中的已有边。 |
| `--left-add <node>` / `--left-rm <node>` | **增量**追加 / 移除左侧入边。                                            |

- **互斥**：`--left` 不可与 `--left-add/--left-rm` 同用。
- `--x / --y` 可与建边联用指定坐标（默认 `0`；有分组时为组内相对坐标）。

## 上游 `nodeKey` 串联（可选输入）

无 `-s`/`--prompt`、无改边 flag 时，可接收上一步操作返回的 `nodeKey` / `newNodeKey` 列表，把这些上游节点**确保连到 `<node>` 左侧**（语义同 `--left`）。与 `--left` 合用：串联来的 key 在前，命令行名字在后，去重后参与；可与 `-r` 合用。串联的具体传递方式见[使用说明](../SKILL.md)。

> 改边与查询 / 更新 / `--run` 如何组合，见 [node.md](../commands/node.md) 的「行为组合」。

## 示例

```bash
# 确保入边（不删其它已有边）
libtv node "下游" --left 上游甲 --left 上游乙

# 增量加一条入边 / 移除一条入边
libtv node "下游" --left-add 新上游
libtv node "下游" --left-rm 旧上游

# 把多个上游 nodeKey 串联连到下游左侧（串联传递方式见使用说明）
libtv node "下游" --left 上游甲 --left 上游乙

# 改边与生成一条命令搞定
libtv node "剧情" --left 参考图 --run

# 想表达「A 连到 B」（原 `libtv node A --right B`）：换成从 B 的视角写
libtv node "B" --left-add A
```
