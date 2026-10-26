# `libtv logout` — 退出登录

退出服务端登录态，并清除本机上由 [`libtv login`](./login.md) 写入的凭据，以及当前进程中的内存凭据快照。

## 子命令

无子命令。

用法骨架：`libtv logout [flags]`

**位置参数**：无。

**选项**：无。

**输出**：含 `loggedOut: true`、`remoteLogout`。本机本无凭据时，仍会按「已登出」处理，`remoteLogout.attempted` 为 `false`，退出码为 0。

## 示例

```bash
# 退出登录
libtv logout
```
