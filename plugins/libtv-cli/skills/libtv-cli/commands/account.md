# `libtv account` — 多账户

查看当前登录用户、列出可切换账户，并切换当前生效账户（个人 / 团队）。

本命令调远端接口，需已登录，见 [`libtv login`](./login.md)。`account info` 与 `account use` 会顺手校准本机活跃账户作用域；后续 [`libtv workspace list`](./workspace.md) / [`libtv workspace create`](./workspace.md) 在未显式传 `--team-id` 时，会默认跟随当前生效账户的团队空间。传 `--team-id 0` 可强制走个人空间。

## 子命令

| 子命令                                | 作用                                                                |
| ------------------------------------- | ------------------------------------------------------------------- |
| **`libtv account info`**              | 输出登录用户 + 当前生效账户信息，并校准本机活跃账户作用域           |
| **`libtv account list`**（别名 `ls`） | 列出当前用户可切换到的全部账户（个人 + 团队），含 `isActive` 标识   |
| **`libtv account use <account>`**     | 切换当前生效账户；`<account>` 支持 `accountId` 或精确 `accountName` |

### `libtv account info`

用法骨架：`libtv account info`

**位置参数**：无。

**选项**：无。

**行为**：拉取账户列表，找出 `isActive: true` 的账户；同时读取登录用户基础信息（`uuid` / `id` / `nickname`），并刷新本机活跃账户作用域。

**输出**：包含 `user`、`activeAccount`、`teamId`、`accountsCount`。

### `libtv account list`（别名 `ls`）

用法骨架：`libtv account list`

**位置参数**：无。

**选项**：无。

**输出**：通常含 `accounts` 数组；每项为一个可切换账户（个人 / 团队），常用字段包括 `accountId`、`accountName`、`accountType`、`isActive`、`teamId` 等。

### `libtv account use <account>`

用法骨架：`libtv account use <account>`

**位置参数**

- **`<account>`**（必填）：目标账户。纯数字按 `accountId` 精确匹配；非数字按 `accountName` 精确匹配。若同名账户命中多个，会报错并要求改用 `accountId`。

**选项**：无。

**行为**：先拉取 `account list` 并解析目标账户；若目标不是当前生效账户，则调用账户激活接口切换。无论是否已经生效，都会刷新本机活跃账户作用域，让后续项目命令默认落到该账户对应空间。

**输出**：含 `ok`、`accountId`、`accountName`、`accountType`、`teamId`；目标本来就是活跃账户时会额外含 `alreadyActive: true`。

## 示例

```bash
# case 1: 查看当前登录用户、当前生效账户和默认 teamId
libtv account info

# case 2: 列出全部可切换账户，找 accountId / accountName
libtv account list
libtv account ls

# case 3: 按 accountId 切换到团队或个人账户
libtv account use 123456

# case 4: 按精确账户名称切换；名称重复时改用 accountId
libtv account use "我的团队"

# case 5: 切换账户后，工作区列表默认跟随当前账户作用域
libtv account use 123456
libtv workspace list
libtv workspace create "团队项目"

# case 6: 临时覆盖作用域：强制查个人空间
libtv workspace list --team-id 0
```
