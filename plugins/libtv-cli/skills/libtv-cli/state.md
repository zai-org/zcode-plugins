# CLI 本地状态与目录绑定（`.libtv/project.json`）

> 本文件描述 CLI 的**本地状态**机制（`.libtv` + `use`/`unuse`）。范围与上下文的通用说明见 [concepts/context.md](./concepts/context.md)。

CLI 把"当前在操作哪个团队 / 工作区 / 画布 / 分组"持久化在**当前工作目录**的 `.libtv/project.json`。命令省略 `-t/-w/-p/-g` 时即读取这里的绑定值。

## 字段（可并存）

| 字段           | 含义       | 写入命令                                   |
| -------------- | ---------- | ------------------------------------------ |
| `projectUuid`  | 默认画布   | `project use`                              |
| `workspaceId`  | 所属工作区 | `workspace use`，或 `project use` 自动同步 |
| `teamId`       | 所属团队   | `workspace use` / `project use` 自动同步   |
| `groupNodeKey` | 默认分组   | `group use`                                |

## 画布绑定：`libtv project use` / `unuse`

- **`libtv project use <画布UUID>`**：先调接口校验可访问，再写入 `projectUuid`，并把该画布**实际所属的 `workspaceId` / `teamId` 一并同步写入**（画布不在任何工作区下时不写 `workspaceId`）；**清除**原有的 `groupNodeKey`。之后 `node` / `upload` / `group` 省略 `-p` 即用该画布。
- **`libtv project unuse`**：删除 `.libtv/project.json`（含 `groupNodeKey`）。

## 工作区绑定：`libtv workspace use` / `unuse`

- **`libtv workspace use <项目ID>`**：写 `workspaceId` + `teamId`，**不设置默认画布**（清除原 `projectUuid` / `groupNodeKey`）。之后 `project create` / `project list` 默认作用在该工作区下（等价于自动带 `-w <项目ID>`）；用 `-w` 显式覆盖，`-w 0` 回根目录。
- **`libtv workspace unuse`**：清除 `workspaceId` + `teamId`；若仍有画布绑定（`projectUuid`）则保留之，否则删除整个文件。

> `project use` 写画布并同步其所属工作区 / 团队；`workspace use` 写工作区 / 团队但不设默认画布——两者都写 `.libtv`，但**作用层级不同**。
>
> 因为 `workspace use` 会清掉 `projectUuid`，「刚才还能用的 `libtv node` 突然报缺少项目」多半是这个原因。用 [`libtv status`](./commands/status.md) 一次看清当前目录的全部绑定与登录态。

## 分组绑定：`libtv group use` / `unuse`

- **`libtv group use <分组>`**：把当前目录关联到画布上的**某个普通分组**（写 `groupNodeKey`）。之后 `libtv node …` 省略 `-g` 时，**列表 / 按名解析 / 更新 / 改边 / 连线**都只在该分组的 `childNodeIds` 范围内，**新建节点**也默认挂到该分组。临时换范围在命令上加 `-g <其他组>` 覆盖。
- **`libtv group unuse`**：清除 `groupNodeKey`，**保留** `projectUuid`。
- `group use` 需要**分组名 / id**（没有 stdin / `-r` 形式）。

## 示例

```bash
# 新建工作区 → 在其下建画布 → 绑定画布到当前目录
WS=$(libtv workspace create "我的短剧项目" | jq -r '.workspaceId')
libtv workspace use "$WS"
EP1=$(libtv project create "第一集" | jq -r '.uuid')   # 自动建到 $WS 下
libtv project use "$EP1"                                # 之后 node/upload/group 默认走它

# 绑定某个普通分组，后续 node 默认限定其内
libtv group use "首集分镜"
libtv node create "镜头-01" -t image      # 自动挂到「首集分镜」组下
libtv group unuse                          # 解除分组绑定（保留画布绑定）
```
