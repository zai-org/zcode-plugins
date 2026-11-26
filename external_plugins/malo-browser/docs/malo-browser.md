# malo-browser

malo-browser 是给 agent 用的 Web 执行层：一个常驻后台 daemon 向多个 agent 分发端口租约，
每个租约下可以创建多个互相隔离的浏览 session。它不是人类主浏览器，也不要求有可见窗口。
agent 用 27 个 session 工具操作页面，工具的契约见 [malo-tools.md](malo-tools.md)。

- 多 agent 各自拿到稳定端口，不互相抢
- 同一端口下多 session 的 cookies、页面、下载和日志互不串用
- 默认后台运行，不抢焦点、不抢屏、不切换 Space
- agent 能通过 HTTP 完成导航、观察、截图、iframe 内操作、登录交接与断言

## 启动

```bash
npm run build
npm run daemon
```

Python 客户端 `clients/python/malo_client.py` 会在 daemon 不在时自动拉起，多数使用方不需要手动启动。

默认监听：

- broker：`127.0.0.1:7410`
- lease 端口池：`7411-7499`
- 数据目录：`~/.malo-browser`

启动成功后会打印一行 JSON，并写入 `~/.malo-browser/broker.json`（权限 `0600`）：

```json
{
  "endpoint": "http://127.0.0.1:7410",
  "token": "<broker-token>",
  "pid": 1234,
  "version": "0.2.0",
  "features": ["observe.screenshot_clip", "lease.holder"]
}
```

常用参数：

```bash
electron . --mode=daemon \
  --daemon-port=7410 \
  --port-min=7411 \
  --port-max=7499 \
  --lease-ttl-seconds=300 \
  --session-idle-seconds=300 \
  --max-sessions=16 \
  --max-sessions-total=64 \
  --artifact-ttl-hours=168 \
  --visible-grace-seconds=1800 \
  --profile-cache-idle-hours=72 \
  --profile-ttl-days=0 \
  --idle-exit-seconds=1800 \
  --data-dir=~/.malo-browser
```

| 参数 | 默认 | 作用 |
|---|---|---|
| `--lease-ttl-seconds` | 300 | 租约多久没有请求或心跳就回收 |
| `--session-idle-seconds` | 300 | 空闲 session 回收秒数（有操作在进行、或窗口显示给人看的除外） |
| `--max-sessions` / `--max-sessions-total` | 16 / 64 | 每 lease、整个 daemon 的 session 上限 |
| `--artifact-ttl-hours` | 168 | 租约目录（下载、失败截图、run report、事件留档）保留小时数，启动时清理；0 = 不清 |
| `--visible-grace-seconds` | 1800 | 窗口显示给人的会话所属租约，客户端多久没活动就照常回收；0 = 不宽限 |
| `--profile-cache-idle-hours` | 72 | 启动时清掉多久没用过的 profile 的网页缓存；0 = 不清 |
| `--profile-ttl-days` | 0 | 启动时删掉多久没用过的 profile（连同登录态）；默认不删 |
| `--idle-exit-seconds` | 1800 | 无租约且无请求这么久就退出；0 = 不退出 |
| `--allow-focus` | 关 | 允许 `watch` / `login` 的 `focus: true` 把窗口带到前台 |
| `--proxy-server` | 无 | Chromium 代理，浏览器级，所有 session 生效 |
| `--data-dir` | `~/.malo-browser` | 数据目录 |

同一个数据目录只允许一个 daemon，由进程级单实例锁保证：几个 agent 同时冷启动时只有先到的
活下来，其余在碰任何存储之前就退出（客户端另有启动锁，正常情况下根本不会多拉起）。
已停止实例留下的 `broker.json` 会被识别为陈旧文件并覆盖。

每次启动先清扫上次运行的残留（此时还没有任何会话，不会误删在用的）：匿名会话遗留的 partition
目录一律清掉——会话关闭时 Chromium 仍握着文件，`rm` 之后它退出前又把目录写回来，所以只能在下次
启动时清；闲置 profile 的 `Cache` 与 `Code Cache`（只占盘，登录态不在这里面）清掉；配置了
`--profile-ttl-days` 时连过期的 profile 一起删；租约目录超过 `--artifact-ttl-hours` 的删掉。
磁盘上有分区目录、登记里却没有的 profile 只在日志里报告，不自动删（登记文件丢了的话，删掉的就是全部登录态）。
profile 的分区永不在运行期间触碰。

daemon 的日志走 stderr；经 Python 客户端拉起时追加到 `<data-dir>/daemon.log`。

### 握手：先问版本和能力，别等调用失败

`/health`（broker 与每个 lease 都有）、`broker.json`、以及 `POST /v1/leases` 的响应都带：

- `version`：包版本，例如 `0.2.0`
- `features`：能力清单，随工具 schema 自动推导（`observe.screenshot_clip`、`lease.holder`）
- `ttl_seconds`（仅租约响应）：本 daemon 的租约 TTL
- `debug_port`（仅 `/health`）：daemon 带 CDP 调试口启动时是端口号，否则 `null`

客户端应当在**拿到租约后、正式干活之前**比对 `features`，缺能力就立刻失败并提示升级，
不要跑到第 N 条任务才发现。注意 `broker.json` 里的是「谁先起来谁写」，等于当前活着的那个 daemon 的版本。

Python 客户端还会对账版本：本仓比运行中的 daemon 新、且 daemon 没有租约在用时停掉它重新拉起，让新代码
立刻生效；还有租约在用则拒绝重启并列出占用的 agent。

### 租约按活动续期

TTL 到期就回收（默认 300s）。**任何通过鉴权的 lease 请求都会刷新这个租约的 TTL**——
有活动就不该过期；`POST /v1/leases/:id/heartbeat` 是显式续期，Python 客户端默认按 TTL 的三分之一在后台发。
`/health` 不算活动（不需要鉴权，不能借它续命）。

单条请求跑得比 TTL 长也一样安全：租约上**还有请求在处理中**时到期不回收，而是续一期，
等这批请求回来再按常规回收（客户端活着在等结果，长批次、登录等待不该被腰斩）。
窗口正显示给人的会话同理宽限：人还在登录、核对，5 分钟没发请求是常态——但客户端超过
`--visible-grace-seconds` 还没动静就照常回收，免得客户端已经死了、窗口被人遗忘，租约永远收不回来。

### 空闲退出

`--idle-exit-seconds=<n>`（默认 1800，0＝不退出）：**没有任何租约**且连续 n 秒没有请求，
daemon 关闭自己并删掉 `broker.json`。好处是省内存，且下次启动会拉起新装的版本。

### 每个消费方用独立 data-dir

一个 data-dir 一个 daemon。开发调试、多版本共存、或「不想被别人正在跑的 daemon 绑架」时，
用独立数据目录和端口池，把两个 daemon 彻底隔开：

```bash
electron . --mode=daemon --data-dir=/tmp/malo-dev \
  --daemon-port=7530 --port-min=7800 --port-max=7899
```

`broker.json` 落在 data-dir 里，所以客户端按各自的 broker 文件找各自的 daemon，互不干扰
（Python 客户端传 `broker_file=`）。

### CDP 调试口

daemon 可以带 Chromium 的 `--remote-debugging-port=<n>` 启动，之后会话页就是普通的 CDP target，
Playwright `connect_over_cdp` 可以直连。**这个口没有鉴权**：开着的时候，本机任何进程连上都能操作这个
daemon 里的全部会话和已登录档案，经它做的点击、输入也不进会话事件。启动时 daemon 会在日志里告警，
`/health` 的 `debug_port` 如实暴露。多人多 agent 共用的 daemon 不应开调试口；确实需要 Playwright 直连时，
让这类负载用独立 data-dir 的另一个 daemon。

## 端口租约

Broker 管理端口池和租约表。每个 agent 申请一个租约：

```bash
curl -X POST http://127.0.0.1:7410/v1/leases \
  -H "x-malo-broker-token: $BROKER_TOKEN" \
  -H "content-type: application/json" \
  -d '{"agent_id":"agent-a","holder":"process-7f3a"}'
```

```json
{
  "lease_id": "lease-...",
  "agent_id": "agent-a",
  "endpoint": "http://127.0.0.1:7411",
  "token": "<lease-token>",
  "expires_at": "2026-11-03T10:00:00.000Z"
}
```

规则：

- **租约按持有者发**：请求里带 `holder`（1-128 字符的持有者标识）时，只有「同 `agent_id` + 同
  `holder`」才复用原租约。Python 客户端自动带进程级唯一标识，所以同一个 agent 名的多个
  进程各拿各的租约，谁的 `release` 都放不掉并行兄弟的会话；同一进程里重复申请照旧复用
- 不带 `holder` 的请求（旧客户端、手写 curl）沿用老规则：同 `agent_id` 复用
- 每个 lease 有独立 token，端口只绑定 `127.0.0.1`
- 心跳续租：`POST /v1/leases/:id/heartbeat`
- 主动释放：`DELETE /v1/leases/:id`
- 过期租约由 daemon 自动回收，端口归还端口池
- 释放或过期会关闭该租约下所有 session

`GET /v1/state` 汇总全部租约、它们的会话、端口池占用与全局会话名额 `session_budget`。

## Session

Lease endpoint 使用 lease token：

```bash
curl -X POST http://127.0.0.1:7411/v1/sessions \
  -H "x-malo-lease-token: $LEASE_TOKEN" \
  -H "content-type: application/json" \
  -d '{"name":"research","width":1280,"height":800,"profile":"work"}'
```

创建结果返回一次 `session_token`，以及该会话的 `downloads_dir`、`artifacts_dir`、`events_log`。
后续访问该 session 必须同时带 lease token 和 session token；拿 session A 的 token 访问 session B 会返回 401。

创建时可给：

| 字段 | 作用 |
|---|---|
| `profile` | 共享该档案的 cookies 与 storage，跨会话、跨 daemon 重启保留登录态 |
| `popup` | `"deny"`（默认）拦下 `window.open` 并回报目标地址；`"adopt"` 在当前页面打开 |
| `permissions` | 放开的页面权限数组，可选值见下文；不点名的默认拒绝 |

```text
<data-dir>/leases/<lease-id>/sessions/<session-id>/
  downloads/
  artifacts/     # 失败截图、run report、events.jsonl
```

`width` / `height` 是页面视口尺寸：人工接管窗口顶部的工具条不占用这两个值，截图也是
`width` x `height`（乘以 DPR）。

`GET /v1/sessions` 列出本租约的会话，每条带 `visible`（窗口此刻是否显示在屏幕上）、
`human`（人在面板上发过的信号）与 `permissions`。关闭 session 时进行中的操作立刻以
`E_SESSION_NOT_FOUND` 失败；页面在会话之外被关掉（典型：经调试口关掉页面目标）时会话自行结束，
之后访问它得到 404 并说明原因。

## 登录态 profile

默认 session 是匿名的：关闭时清空 cookies 和 storage，下次要重新登录。
需要跨 session、跨 daemon 重启保留登录态时，创建 session 时显式指定 `profile`：

```json
{ "name": "research", "profile": "work" }
```

- profile 存在 `<data-dir>/chromium/Partitions/malo-profile-<name>`（Electron 分区的
  `persist:` 前缀不进入目录名），daemon 的 Chromium 用户数据整体落在 `<data-dir>/chromium`
- 只接受小写字母、数字、点、下划线、短横线，最长 64 字符；最多 256 个 profile
- 同名 profile 会被多个 session 共享，因此并行 agent 各自用自己的名字，例如 `agent-a.work`
- 未指定 profile 的 session 行为不变：关闭即清空，不会继承任何登录态
- `login` 结果和 session summary 都带 `profile` 字段，agent 能确认这次登录是否可复用

查询、预览与清理：

```bash
AUTH=(-H "x-malo-lease-token: $LEASE_TOKEN" -H "content-type: application/json")
curl -H "x-malo-lease-token: $LEASE_TOKEN" http://127.0.0.1:7411/v1/profiles
# 预览：列出超过 14 天没用过、此刻没人在用的 profile
curl -X POST "${AUTH[@]}" http://127.0.0.1:7411/v1/profiles/prune -d '{"min_idle_days":14}'
# 确认后再真删（apply=true），返回真正删掉的 profile
curl -X POST "${AUTH[@]}" http://127.0.0.1:7411/v1/profiles/prune -d '{"min_idle_days":14,"apply":true}'
curl -X DELETE -H "x-malo-lease-token: $LEASE_TOKEN" http://127.0.0.1:7411/v1/profiles/work
```

清理正在被 session 使用（含正在创建）的 profile 会返回 409 `E_PROFILE_LOCKED`，先关闭这些 session；
分区目录删不干净时返回 `E_PROFILE_CLEAR_FAILED`，登记保留。工具调用里同样可用 `profiles`
（`{"action":"list"}` / `{"action":"clear","name":"work"}` / `{"action":"prune",...}`）。

从已登录的 Chromium 导入登录态：`POST /v1/profiles/:name/import` 连源浏览器回环
`cdp_url` 的 DevTools 端点实时拉 cookie，写进该 profile 的分区。`domains` 是**必填**的域白名单
——不限定范围就等于把源浏览器里所有站点的登录态整包搬进来。`session_cookie_ttl_days`
（默认 180）把 session cookie 改写成持久 cookie，让导入的登录活过 daemon 重启。导入只合并不清空
已有状态，也只迁 cookie（localStorage / IndexedDB 留在源浏览器）；源浏览器连不上 → 502
`E_IMPORT_SOURCE_UNREACHABLE`，域过滤后 0 条 → 400 `E_IMPORT_EMPTY`：

```bash
curl -X POST http://127.0.0.1:7411/v1/profiles/work/import \
  -H "x-malo-lease-token: $LEASE_TOKEN" \
  -H "content-type: application/json" \
  -d '{"cdp_url":"http://127.0.0.1:9223","domains":["example.com"]}'
```

## 安全与资源边界

- 只监听回环地址
- `Host` 只接受 `127.0.0.1:<port>` 和 `localhost:<port>`，防 DNS rebinding
- broker token、lease token、session token 三层分离
- 只允许 `http:` / `https:` 导航，拒绝 URL 内嵌 credentials
- `window.open` 不开新窗口：拦下并回报目标地址，或按会话配置在当前页面打开
- 页面权限默认全部拒绝。创建 session 时可用 `permissions` 逐项放开这 11 项：
  `clipboard-read`、`clipboard-sanitized-write`、`fullscreen`、`geolocation`、`idle-detection`、`media`、
  `midi`、`midiSysex`、`notifications`、`pointerLock`、`speaker-selection`。能打开外部应用、读写文件系统、
  抓屏、碰硬件的权限不在此列
- 请求体上限 1MB，只接受 `application/json`
- 每 lease 默认最多 16 个 session，整个 daemon 默认最多 64 个（`--max-sessions` /
  `--max-sessions-total`）；任一超限都返回 429，报错点名是哪个上限
- 空闲 session 默认 300 秒回收；有操作正在进行、或窗口正显示给人看的 session 不回收
- 不同 session 的 cookies、storage、下载、页面和事件互不共享；共享 profile 的多个
  session 之间，下载仍按发起它的 webContents 归属到各自 session 的 `downloads/`
- 数据目录与 session 目录按 0700 建立，`broker.json` / `profiles.json` / 失败截图 /
  run report / `events.jsonl` 一律 0600
- `profile` 是显式共享单元：同名 profile 的 session 共用 cookies，名字由调用方自己隔离。
  档案没有归属：任何租约都能用任何已登录的档案——它面向单人单机，不是多用户隔离
- profile 数据只落在 `<data-dir>/chromium`，清理走 `DELETE /v1/profiles/:name`
- 会话关闭时页面随之销毁，渲染进程立刻释放；匿名 session 关闭时清空 storage 并删除自己的
  partition 目录
- daemon 不会因为某个会话里的未捕获异常整体退出：异常连同完整栈记进日志，其余 agent 的会话不受影响
- CDP 调试口没有鉴权（见上文），共用的 daemon 不应开启

## 焦点与窗口

daemon 在 macOS 使用 `accessory` 激活策略并隐藏 Dock，不创建可见窗口，不编程激活应用、
不切换 Space。session 的 `WebContentsView` 放在隐藏 `BaseWindow` 中。人眼可见的窗口
（`watch` / `login` 接管窗口）出现期间，Dock 会临时亮出图标，被别的应用挡住的窗口点 Dock
图标即可调回最前——这是唯一的前台切换，且由用户点击触发；窗口全部收起后图标自动隐藏。

需要给人看的时候才进入 `watch` / `login`，其余时间只有隐藏窗口和按需截图。
所有会出现在屏幕上的窗口一律带原生标题栏（可拖动、可缩放）；人工接管窗口顶部有一条浏览器
工具条——后退、前进、刷新、地址栏，以及给 agent 发信号的「完成 / 暂停 / 停止」（见
[malo-tools.md](malo-tools.md#人工交接)）。工具条到窗口第一次给人看时才建：agent 驱动的隐藏会话
不为它多养一个渲染进程。录制（`hidden` 模式）与截图产物只取页面内容，窗口是否有框不影响画面。

隐藏页面不启用后台节流（`backgroundThrottling: false`）：无头录制与离屏交互要靠它保持定时器与动画
照常运行，所以隐藏会话里的页面是按前台速度跑的。

## 验证

```bash
npm run typecheck
npm test              # vitest 单元测试
npm run test:client   # Python 客户端的离线用例

# 工具条的真实 Electron 行为（隐藏窗口即可跑完）
npm run smoke:toolbar

# daemon 全链路 smoke：默认自己起一个临时数据目录的隔离 daemon，跑完即停
# 先起 fixture 静态服务
python3 -m http.server 4788 --bind 127.0.0.1 --directory out/fixture
npm run smoke:malo
```

`smoke:malo` 显式给 broker.json 路径时才连现成的 daemon：
`npm run smoke:malo -- ~/.malo-browser/broker.json http://127.0.0.1:4788`（那个 daemon 不会被停）。

smoke 覆盖两个 agent、三个 session、导航隔离、轻量观察、截图、工具清单、snapshot / extract、
fill 落地链、click text、drag、focus / hover / scroll、history、session token 越权拒绝、
账号密码登录与错误凭据、人工接管登录、密码不回显、profile 登录态恢复与匿名隔离、
role 组件、snapshot 裁剪、坐标口径、逐字键入与按键码、弹窗拦截与放行、事件留档、
滚轮落点、同源 / 跨域 / 嵌套 iframe 的读取与操作、session 关闭、lease 释放和端口归还。
多进程并行、长操作不被回收、启动清扫、人工信号、权限白名单这些走单元测试与工具条 smoke。

## 不做

- 把整个仓库或包名改成 malo-browser
- delivery-video adapter 拆分
- 新的 1080p capture 实现
- 把登录页做成可定制的站点适配层
- 远程访问、跨用户服务化
- 书签、标签栏、多标签页等人类浏览器功能（一个 session 一个页面；人工接管窗口只有地址栏与后退/前进/刷新）
