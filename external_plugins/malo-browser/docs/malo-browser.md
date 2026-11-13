# malo-browser

malo-browser 是给 agent 用的 Web 执行层：一个常驻后台 daemon 向多个 agent 分发端口租约，
每个租约下可以创建多个互相隔离的浏览 session。它不是人类主浏览器，也不要求有可见窗口。

当前版本是 v0.1，先验证四件事：

- 多 agent 各自拿到稳定端口，不互相抢
- 同一端口下多 session 的 cookies、页面、下载和日志互不串用
- 默认后台运行，不抢焦点、不抢屏、不切换 Space
- agent 能通过 HTTP 完成导航、轻量观察、按需截图和基础动作

## 启动

```bash
npm run build
npm run daemon
```

默认监听：

- broker：`127.0.0.1:7410`
- lease 端口池：`7411-7499`
- 数据目录：`~/.malo-browser`

启动成功后会打印一行 JSON，并写入 `~/.malo-browser/broker.json`（权限 `0600`）：

```json
{
  "endpoint": "http://127.0.0.1:7410",
  "token": "<broker-token>",
  "pid": 1234
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
  --max-sessions=4 \
  --data-dir=~/.malo-browser
```

同一个数据目录只允许一个 daemon。已有实例仍健康时，新进程会明确报错，不会抢占端口。
已停止实例留下的 `broker.json` 会被识别为陈旧文件并覆盖。

## 端口租约

Broker 管理端口池和租约表。每个 agent 申请一个租约：

```bash
curl -X POST http://127.0.0.1:7410/v1/leases \
  -H "x-malo-broker-token: $BROKER_TOKEN" \
  -H "content-type: application/json" \
  -d '{"agent_id":"agent-a"}'
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

- 同一 `agent_id` 在租约有效期内重复申请会复用原租约
- 每个 lease 有独立 token，端口只绑定 `127.0.0.1`
- 心跳续租：`POST /v1/leases/:id/heartbeat`
- 主动释放：`DELETE /v1/leases/:id`
- 过期租约由 daemon 自动回收，端口归还端口池
- 释放或过期会关闭该租约下所有 session

## Session

Lease endpoint 使用 lease token：

```bash
curl -X POST http://127.0.0.1:7411/v1/sessions \
  -H "x-malo-lease-token: $LEASE_TOKEN" \
  -H "content-type: application/json" \
  -d '{"name":"research","width":1280,"height":800,"profile":"work"}'
```

创建结果会返回一次 `session_token`。后续访问该 session 必须同时带 lease token 和
session token；拿 session A 的 token 访问 session B 会返回 401。

```bash
curl -X POST http://127.0.0.1:7411/v1/sessions/$SESSION_ID/navigate \
  -H "x-malo-lease-token: $LEASE_TOKEN" \
  -H "x-malo-session-token: $SESSION_TOKEN" \
  -H "content-type: application/json" \
  -d '{"url":"https://example.com","settle_ms":6000}'
```

默认每个 session 使用独立的 persistent partition、下载目录和产物目录；指定 `profile`
的 session 共用该 profile 的 partition（见下节）：

```text
<data-dir>/leases/<lease-id>/sessions/<session-id>/
  downloads/
  artifacts/
```

`width` / `height` 是页面视口尺寸：人工接管窗口顶部的工具条不占用这两个值，截图也是
`width` x `height`（乘以 DPR）。

## 登录态 profile

默认 session 是匿名的：关闭时清空 cookies 和 storage，下次要重新登录。
需要跨 session、跨 daemon 重启保留登录态时，创建 session 时显式指定 `profile`：

```json
{ "name": "research", "profile": "work" }
```

- profile 存在 `<data-dir>/chromium/Partitions/malo-profile-<name>`（Electron 分区的
  `persist:` 前缀不进入目录名），daemon 的 Chromium 用户数据整体落在 `<data-dir>/chromium`，
  一个目录管住全部状态
- 只接受小写字母、数字、点、下划线、短横线，最长 64 字符；最多 64 个 profile
- 同名 profile 会被多个 session 共享，因此并行 agent 各自用自己的名字，例如 `agent-a.work`
- 未指定 profile 的 session 行为不变：关闭即清空，不会继承任何登录态
- `login` 结果和 session summary 都带 `profile` 字段，agent 能确认这次登录是否可复用

查询与清理：

```bash
curl -H "x-malo-lease-token: $LEASE_TOKEN" http://127.0.0.1:7411/v1/profiles
curl -X DELETE -H "x-malo-lease-token: $LEASE_TOKEN" \
  http://127.0.0.1:7411/v1/profiles/work
```

清理正在被 session 使用的 profile 会返回 409 `E_PROFILE_LOCKED`，先关闭这些 session。
工具调用里同样可用 `profiles`（`{"action":"list"}` / `{"action":"clear","name":"work"}`）。

从已登录的 Chromium 导入登录态：`POST /v1/profiles/:name/import` 连源浏览器回环
`cdp_url` 的 DevTools 端点实时拉 cookie，写进该 profile 的分区；可选 `domains` 白名单
与 `session_cookie_ttl_days`（默认 180）。导入只合并不清空已有状态，也只迁 cookie
（localStorage / IndexedDB 留在源浏览器）；源浏览器连不上 → 502
`E_IMPORT_SOURCE_UNREACHABLE`，域过滤后 0 条 → 400 `E_IMPORT_EMPTY`：

```bash
curl -X POST http://127.0.0.1:7411/v1/profiles/work/import \
  -H "x-malo-lease-token: $LEASE_TOKEN" \
  -H "content-type: application/json" \
  -d '{"cdp_url":"http://127.0.0.1:9223","domains":["example.com"]}'
```

## Agent 工具

Agent 不需要自己猜接口。lease endpoint 提供一份工具清单：

```bash
curl -H "x-malo-lease-token: $LEASE_TOKEN" \
  http://127.0.0.1:7411/v1/tools
```

每个工具带 JSON Schema，可直接映射到 function calling / MCP 工具定义。统一调用入口：

```bash
curl -X POST http://127.0.0.1:7411/v1/sessions/$SESSION_ID/tools/snapshot \
  -H "x-malo-lease-token: $LEASE_TOKEN" \
  -H "x-malo-session-token: $SESSION_TOKEN" \
  -H "content-type: application/json" \
  -d '{"max_chars":8000,"max_items":120}'
```

可用工具：

- `navigate`、`history`、`events`
- `observe`、`snapshot`、`extract`
- `click`、`fill`、`upload_file`、`press`、`hover`、`select`、`focus`
- `scroll`、`scroll_into_view`、`wait_for`、`sleep`
- `assert`（visible / hidden / text / value / url / count）
- `run_steps`（批量串行执行上面的工具，产出 run report 文件）
- `network_capture`（设置/查看 XHR/fetch 响应体捕获订阅）
- `responses`（按 seq 游标查询捕获到的响应）
- `watch`、`login`、`profiles`
- `close`

`snapshot` 是 agent 看页面的主工具，返回：

- 可见正文、标题、viewport 和滚动位置
- 标题、链接、按钮、输入框、下拉框、表单
- 表格、landmark、iframe、dialog、alert/live region
- 可交互元素及稳定的 CSS selector、坐标和尺寸
- `truncated` 标记，明确哪些内容被截断

`extract` 用于定向读取：

```bash
curl -X POST http://127.0.0.1:7411/v1/sessions/$SESSION_ID/tools/extract \
  -H "x-malo-lease-token: $LEASE_TOKEN" \
  -H "x-malo-session-token: $SESSION_TOKEN" \
  -H "content-type: application/json" \
  -d '{"selector":".price","mode":"text","max_chars":4000}'
```

`assert` 用于验证，所有条件按 AND 组合，并在 `timeout_ms` 内反复重试。断言没通过是业务
判决而不是服务故障：HTTP 状态仍是 **200**，判决在 `result.ok` 上——通过时 `result.ok`
与 `result.passed` 为 `true`；失败时两者为 `false`，`result.checks` 与
`result.error.details.checks` 带每项 expected/actual，`result.screenshot` /
`result.error.details.screenshotPath` 指向 session `artifacts/` 下的失败截图，
`result.error.code` 为 `E_ASSERTION_FAILED`。参数错误仍是 4xx，服务内部异常仍是 5xx
（0.1.2 起；此前 assert 失败返回 500）：

```bash
curl -X POST http://127.0.0.1:7411/v1/sessions/$SESSION_ID/tools/assert \
  -H "x-malo-lease-token: $LEASE_TOKEN" \
  -H "x-malo-session-token: $SESSION_TOKEN" \
  -H "content-type: application/json" \
  -d '{"visible":"#done","hidden":"#spinner","text":"保存成功","url":"/done","timeout_ms":5000}'
```

```json
{
  "tool": "assert",
  "result": {
    "ok": false,
    "passed": false,
    "checks": [{ "kind": "visible", "expected": true, "actual": false, "ok": false }],
    "url": "https://example.com/done",
    "waited_ms": 5001,
    "screenshot": "<artifacts>/failure-<ms>.png",
    "error": {
      "code": "E_ASSERTION_FAILED",
      "message": "E_ASSERTION_FAILED: 断言失败：visible expected true, got false",
      "details": {
        "checks": [{ "kind": "visible", "expected": true, "actual": false, "ok": false }],
        "waited_ms": 5001,
        "screenshotPath": "<artifacts>/failure-<ms>.png"
      }
    }
  }
}
```

`selector` 在 `assert` 里有两个用途：给 `text` 限定查找范围，或作为 `value` / `count`
的目标。对密码输入框做 `value` 断言会直接返回 400（密码值永远读不到，拿脱敏串比较只会
假通过），改用 `visible` 或页面上的登录态断言。

`run_steps` 把一串工具调用交给 daemon 顺序执行，默认遇错即停（`stop_on_failure:false`
可继续），最后把每一步的结果与错误写进 session `artifacts/` 下的 run report，
返回 `{ ok, step_count, failed_step, steps, report_path }`。`run_steps`、`watch`、`login`、
`profiles`、`close`、`network_capture`、`responses` 都不能再嵌进 `run_steps`（响应体永远
不进 run report）。

```bash
curl -X POST http://127.0.0.1:7411/v1/sessions/$SESSION_ID/tools/run_steps \
  -H "x-malo-lease-token: $LEASE_TOKEN" \
  -H "x-malo-session-token: $SESSION_TOKEN" \
  -H "content-type: application/json" \
  -d '{"steps":[{"type":"click","selector":"#save"},{"type":"assert","text":"保存成功"}]}'
```

工具调用返回 `{ "tool": "...", "result": ... }`；协议/参数错误返回
`{ "ok": false, "error": { "code", "message", "details" } }`，服务内部异常为 5xx。
业务判决失败（`assert` 未通过、`run_steps` 有失败步骤）仍是 200，读 `result.ok`。
导航失败会在 `details.navigation` 中带 `http_status`、`net_error`、`net_error_description` 和 `settle` 信息。

旧版 `x-pagehand-*` token 头仍被接受一段时间，新脚本请使用 `x-malo-*`。

### 网络响应捕获（XHR / fetch）

`network_capture` 声明关心的 URL 前缀，`responses` 取回命中的响应体。文档化的时序是
先订阅、再导航、再触发交互，最后按 `seq` 轮询：

```bash
BASE=http://127.0.0.1:7411
SESSION=/v1/sessions/$SESSION_ID/tools
AUTH=(-H "x-malo-lease-token: $LEASE_TOKEN" -H "x-malo-session-token: $SESSION_TOKEN" -H "content-type: application/json")

# 1) 订阅（替换式；空数组=清空，省略=只查看）
curl -X POST "$BASE$SESSION/network_capture" "${AUTH[@]}" \
  -d '{"url_prefixes":["https://web-api.example.com/api/v1/action/"]}'

# 2) 导航
curl -X POST "$BASE/v1/sessions/$SESSION_ID/navigate" \
  -H "x-malo-lease-token: $LEASE_TOKEN" -H "x-malo-session-token: $SESSION_TOKEN" \
  -H "content-type: application/json" -d '{"url":"https://example.com/action/2026-11-05"}'

# 3) 触发请求（标签、按钮等）
curl -X POST "$BASE$SESSION/click" "${AUTH[@]}" -d '{"selector":"#tab-theme"}'

# 4) 轮询；body_error=pending 表示 body 还在串行队列里，稍后再查
curl -X POST "$BASE$SESSION/responses" "${AUTH[@]}" \
  -d '{"url_prefix":"https://web-api.example.com/api/v1/action/","after":0,"limit":50}'
```

订阅语义：

- `network_capture` 省略 `url_prefixes` 只返回当前订阅和已保留 body 的条数
  （`{"url_prefixes":[],"captured":0}`）；`[]` 清空订阅并关闭 CDP 网络域。
- 首次设置非空前缀时才发 `Network.enable`，并带 `maxTotalBufferSize=64 MiB`、
  `maxResourceBufferSize=8 MiB`——不带这两个值，大响应体会取不到，看起来像页面把缓冲
  淘汰了。清空订阅时发 `Network.disable`，丢弃已缓存 body，元数据保留。
- 订阅是 session 私有的，关闭 session 即失效，不写 profile，不影响其他 session。
- 捕获复用 `ElectronPageDriver` 已有的 debugger 附着，不会二次 attach，也不引入任何
  窗口/焦点行为。

`responses` 入参 `url_prefix`（结果过滤）、`after`（取 `seq` 大于它的记录）、`limit`
（1–200，默认 50），返回 `{"responses":[record],"has_more":bool}`。`has_more` 表示还有
未返回的匹配记录——故意不叫 `truncated`，避免和单条 body 的 `body_truncated` 混淆。
record 形态：

```json
{
  "seq": 12,
  "url": "https://web-api.example.com/api/v1/action/field?x=1",
  "status": 200,
  "mime_type": "application/json",
  "resource_type": "XHR",
  "body": "{\"errCode\":\"0\"}",
  "body_truncated": false,
  "body_error": null
}
```

`body` 是原始文本，不替调用方解析 JSON；`body_truncated=true` 表示超过单条 **1 MiB**
上限、只保留前 1 MiB。`body_error` 只在 `body=null` 时出现，如实标注原因，绝不造空成功：

| 值 | 含义 |
|---|---|
| `not_subscribed` | 未命中订阅，只记元数据 |
| `no_body` | 204/304 或空响应体（合法态） |
| `evicted` | 被 200 条 captured 上限或 16 MiB 字节预算挤出 |
| `pending` | body 仍在串行队列里；调用方稍后重试 `responses` |
| `binary` | `Network.getResponseBody` 返回 base64（二进制），不按 UTF-8 解码 |
| `getResponseBody_failed: <原因>` | CDP 取 body 失败（如导航离开后缓冲已清），不重试 |
| `too_large` | 契约保留值；当前实现对超限 body 截断，不会返回此值 |

内存模型：所有 resource type 都记元数据，可见列表最多 **500 条**（一页图片不会把后来的
JSON 元数据挤掉）；body 只为订阅命中的响应保留，最多 **200 条**且总字节预算 **16 MiB**，
超限时最老的 body 先丢、元数据保留并标 `body_error="evicted"`。`responses` 的 `limit`
仍是 1–200。body 只存在于 daemon 内存和 `responses` 的返回值中，不写日志、
`evidence/*.json`、trace 或 run report，也不进 `MaloNetworkInfo`。

捕获子系统自身故障（`Network.enable` / `Network.disable` 被拒等）会让
`network_capture` / `responses` 返回显式的 `E_CAPTURE_UNAVAILABLE` 错误（HTTP 5xx、
`ok:false`），不会伪装成空列表；空列表只表示真的没有匹配记录。

限制：CDP session 附着在页面 target 上，所以请求由跨进程 iframe（OOPIF）或 service
worker 发出时不会被捕获。这是刻意划定的范围，不是 bug；需要时改用页面主 frame 发起
等价请求。

## 观察

默认只取轻量状态，不生成截图：

```bash
GET /v1/sessions/:id/observe?mode=light&max_chars=2000
```

返回 URL、title、readyState、viewport、DOM 元素数量、可交互元素数量和正文摘要。

需要视觉证据时显式请求截图：

```bash
GET /v1/sessions/:id/observe?mode=screenshot&max_chars=200
```

截图是 base64 PNG。动作失败时同时会在 session 的 `artifacts/` 下落一张失败截图。
malo-browser 不默认连续推流，也不默认每步截图。

导航默认会等待 DOM 和网络稳定，`settle_ms` 是等待上限。Reddit 的 JS challenge、
Three.js 的异步列表这类页面不能只等 `load` 事件；`navigation.settle` 会明确记录等待时长、
最终 DOM 元素数和稳定采样数。站点兼容性实测见
[malo-web-compat.md](malo-web-compat.md)。

## 动作

```bash
curl -X POST http://127.0.0.1:7411/v1/sessions/$SESSION_ID/actions \
  -H "x-malo-lease-token: $LEASE_TOKEN" \
  -H "x-malo-session-token: $SESSION_TOKEN" \
  -H "content-type: application/json" \
  -d '{"action":{"type":"fill","selector":"#q","text":"hello"}}'
```

v0.1 支持：

- `click`：`selector` 或 `x`/`y`
- `fill`：`selector`、`text`、可选 `clear`
- `press`：`key` 和可选 `modifiers`
- `scroll`：`dx`、`dy`
- `hover`：`selector` 或 `x`/`y`
- `select`：`selector` + `value` 或 `label`
- `focus`：`selector`
- `scroll_into_view`：`selector`
- `history`：`back` / `forward` / `reload`
- `wait_for`：`selector` 或 `text`，可选 `state`、`timeout_ms`
- `sleep`：`ms`

Meta/Command 快捷键中的 `Cmd+A/C/V/X/Z` 会映射到 Electron 的编辑命令，避免合成系统级按键；
其他 Meta 组合会明确返回 `E_UNSUPPORTED`。

动作和页面事件可以从 `GET /v1/sessions/:id/events?after=<seq>` 读取。

## 登录交接

登录墙、扫码和人机校验不该让 agent 硬碰。malo 把「人接手一次、agent 拿回控制权」做成契约：

```bash
# 账号密码：agent 提供一次性凭据
curl -X POST http://127.0.0.1:7411/v1/sessions/$SESSION_ID/tools/login \
  -H "x-malo-lease-token: $LEASE_TOKEN" \
  -H "x-malo-session-token: $SESSION_TOKEN" \
  -H "content-type: application/json" \
  -d '{"mode":"password","username":"demo","password":"secret"}'

# 人工接管：窗口拉给人看，扫码或点确认后自动收回
curl -X POST http://127.0.0.1:7411/v1/sessions/$SESSION_ID/tools/watch \
  -H "x-malo-lease-token: $LEASE_TOKEN" \
  -H "x-malo-session-token: $SESSION_TOKEN" \
  -H "content-type: application/json" \
  -d '{"show":true,"focus":false}'

curl -X POST http://127.0.0.1:7411/v1/sessions/$SESSION_ID/tools/login \
  -d '{"mode":"watch","timeout_ms":180000}'
```

规则：

- 默认 `focus=false`，窗口用 `showInactive` 出现：不抢键盘焦点、不切换 Space；只有显式 `focus:true` 才上前台
- `password` 模式自动识别用户名、密码和提交按钮，可用 `username_selector`、`password_selector`、`submit_selector` 覆盖
- 成功判定是**互斥**的：给了 `success_selector` 就只看它，给了 `success_url_contains` 就只看 URL；
  两者都没给才退回「密码框消失 / URL 变化 / 页面出现退出登录等文本」的启发式
- 失败判定看 `error_selector` 或页面上的常见错误文案，返回 `reason=login_error` 而不是空转重试
- 凭据只存在于本次调用内存：不落盘、不进事件、不回显；快照里密码框的 `value` 固定为空串并标记 `sensitive: true`（`[redacted]` 只出现在 `interactive[].text`）
- 登录态只有指定 `profile` 时才保留，未指定就随 session 一起清掉
- `login` 成功后窗口自动隐藏，agent 继续用同一个 session；`keep_visible: true` 可留给人继续操作；`watch` 打开的窗口保持可见，显式再调 `watch`（`show:false`）才收起
- 超时的人工接管窗口不会自动关闭，人处理完再调 `watch` 收起

## 安全与资源边界

- 只监听回环地址
- `Host` 只接受 `127.0.0.1:<port>` 和 `localhost:<port>`，防 DNS rebinding
- broker token、lease token、session token 三层分离
- 只允许 `http:` / `https:` 导航，拒绝 URL 内嵌 credentials
- `window.open` 默认拒绝，权限请求默认拒绝
- 请求体上限 1MB，只接受 `application/json`
- 每 lease 默认最多 4 个 session；超出返回 429
- 空闲 session 默认 300 秒回收
- 不同 session 的 cookies、storage、下载、页面和事件互不共享；共享 profile 的多个
  session 之间，下载仍按发起它的 webContents 归属到各自 session 的 `downloads/`
- 数据目录与 session 目录按 0700 建立，`broker.json` / `profiles.json` / 失败截图 /
  run report 一律 0600；录制成片同样 0600
- `profile` 是显式共享单元：同名 profile 的 session 共用 cookies，名字由调用方自己隔离
- profile 数据只落在 `<data-dir>/chromium`，清理走 `DELETE /v1/profiles/:name`
- 匿名 session 关闭时会清空 storage 并删除自己的 partition 目录，不留在磁盘上

## 焦点与窗口

daemon 在 macOS 使用 `accessory` 激活策略并隐藏 Dock，不创建可见窗口，不编程激活应用、
不切换 Space。session 的 `WebContentsView` 放在隐藏 `BaseWindow` 中，系统窗口列表中
`onscreen=false`。人眼可见的窗口（`watch` / `login` 接管窗口）出现期间，Dock 会临时亮出
图标，被别的应用挡住的窗口点 Dock 图标即可调回最前——这是唯一的前台切换，且由用户点击
触发；窗口全部收起后图标自动隐藏，纯后台期间仍然无图标。

需要给人看的时候才进入 `watch` / `login`，其余时间只有隐藏窗口和按需截图。
人工接管窗口带原生标题栏，可以拖动和缩放，顶部还有一条浏览器工具条：后退、前进、
刷新和地址栏（只接受 `http` / `https`，回车跳转，地址随页面同步）；录制与演示舞台
仍然是无边框窗口，也没有这条工具条。

## 验证

```bash
npm run typecheck
npm test

# 先起 fixture 静态服务
python3 -m http.server 4788 --bind 127.0.0.1 --directory out/fixture

# 另一个终端起 daemon，然后跑完整链路 smoke
#（smoke 会自己起一个临时登录测试页，不依赖仓库里的 HTML）
npm run smoke:malo -- ~/.malo-browser/broker.json http://127.0.0.1:4788
```

smoke 覆盖两个 agent、三个 session、导航隔离、轻量观察、截图、工具清单、
snapshot/extract、fill/click/hover/focus/history、session token 越权拒绝、
账号密码登录与错误凭据、人工接管登录、密码不回显/不入事件、
profile 登录态恢复与匿名 session 隔离、
session 关闭、lease 释放和端口归还。

## v0.1 不做

- 把整个仓库或包名改成 malo-browser
- delivery-video adapter 拆分
- 新的 1080p capture 实现
- 把登录页做成可定制的站点适配层
- 审批流、远程访问、跨用户服务化
- 书签、标签栏、多标签页等人类浏览器功能（人工接管窗口只有地址栏与后退/前进/刷新）
