# `libtv status` — 查看当前生效状态（排障）

一次性输出 CLI 当前所有生效状态：登录态、活跃账户 / 团队、当前目录绑定的工作区 / 画布 / 分组，以及两个状态文件的位置与修改时间。用于回答「刚才还能用的命令为什么突然报缺少项目 / 未登录」——例如 [`workspace use`](./workspace.md) 会清掉当前目录的 `projectUuid` 和 `groupNodeKey`（见 [../state.md](../state.md)）。

只读，不发网络请求，不修改任何状态。

## 子命令

无子命令，无 flags。

用法骨架：`libtv status`

### 输出

| 字段                                                                                      | 说明                                                                                                          |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `cliVersion`                                                                              | CLI 版本。                                                                                                    |
| `nodeVersion`                                                                             | 运行 CLI 的 Node.js 版本。                                                                                    |
| `cwd`                                                                                     | 当前工作目录（目录绑定按它读取）。                                                                            |
| `debug`                                                                                   | 是否开启调试输出。                                                                                            |
| `apiHost` / `mediaApiHost`                                                                | 当前请求的服务地址。                                                                                          |
| `auth.loggedIn`                                                                           | 是否有可用凭据。                                                                                              |
| `auth.tokenSource`                                                                        | 凭据来源：`env:LIBTV_TOKEN`（环境变量优先）/ `file:credentials.json` / `null`（未登录）。                     |
| `auth.token`                                                                              | **脱敏**后的 token（只露首尾各 4 位），可放心贴进工单。                                                       |
| `auth.userUuid` / `auth.webid`                                                            | 当前登录用户标识。                                                                                            |
| `auth.activeAccountId` / `auth.activeTeamId`                                              | 当前活跃账户与团队（多账户切换见 [account.md](./account.md)）。                                               |
| `auth.savedAt`                                                                            | 凭据写入时间。                                                                                                |
| `auth.credentialsFile`                                                                    | 凭据文件 `path` / `exists` / `modifiedAt`。                                                                   |
| `binding.projectUuid` / `binding.groupNodeKey` / `binding.workspaceId` / `binding.teamId` | 当前目录 `.libtv/project.json` 里的绑定值，未绑定为 `null`。缺 `projectUuid` 时多数 `node` 命令会报缺少项目。 |
| `binding.stateFile`                                                                       | 目录状态文件 `path` / `exists` / `modifiedAt`；`modifiedAt` 可用来判断「是不是刚被别的命令改过」。            |

## 示例

```bash
# case 1: 看全部状态
libtv status

# case 2: 命令报「缺少项目」时，先看当前目录是否还绑着画布
libtv status | jq '.binding'

# case 3: 确认凭据来自环境变量还是登录文件（环境变量会覆盖 login 写入的凭据）
libtv status | jq -r '.auth.tokenSource'
```
