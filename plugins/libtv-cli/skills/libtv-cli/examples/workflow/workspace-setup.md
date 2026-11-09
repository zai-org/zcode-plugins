# 新建项目（工作区）→ 在其下建画布 → 目录绑定

> 术语：**项目（workspace）= 工作区**，是装画布的容器；**画布（project）** 才是真正的画布文件。详见 [commands/workspace.md](../../commands/workspace.md)、[commands/project.md](../../commands/project.md)。

**前置条件**：已登录（见 [commands/login.md](../../commands/login.md)）。

## case：把一批画布归到同一个项目

```bash
set -euo pipefail

# 1. 新建项目（工作区），拿到项目 ID（即文件夹 id）
WS=$(libtv workspace create "我的短剧项目" -d "第一季" | jq -r '.workspaceId')

# 2. 绑定项目：之后 project create / project list 自动作用在该项目下
libtv workspace use "$WS"

# 3. 在该项目下新建两张画布（无需带 -w，自动落到 $WS）
EP1=$(libtv project create "第一集" | jq -r '.uuid')
EP2=$(libtv project create "第二集" | jq -r '.uuid')

# 4. 列出画布：自动只列 $WS 项目下的画布
libtv project list

# 5. 改为绑定到第一集画布，后续 node/upload/group 默认走它；project use 会同步该画布所属项目
libtv project use "$EP1"
```

## case：绑定字段如何流转（projectUuid / workspaceId / teamId）

`.libtv/project.json` 同时记录画布、所属项目、所属团队三类字段：

```bash
# project use：把画布所属的项目 + 团队一并同步写入
libtv project use "$EP1"   # => { projectUuid: <EP1>, workspaceId: <$WS>, teamId: <团队?> }

# workspace use：写项目 + 团队，但不设默认画布（清掉 projectUuid / groupNodeKey）
libtv workspace use "$WS"  # => { workspaceId: <$WS>, teamId: <团队?> }

# workspace unuse：清掉 workspaceId + teamId（若仍有画布绑定则保留画布）
libtv workspace unuse
```

> `project use` 会按画布实际所属项目自动填 `workspaceId`；画布若不在任何项目下，则不写 `workspaceId`。
