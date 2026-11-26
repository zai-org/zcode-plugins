# malo 工具参考

agent 通过 lease endpoint 上的工具操作一个 session 的页面。本文是全部 27 个 session 工具的行为与契约；
daemon 的启动、租约、会话与档案见 [malo-browser.md](malo-browser.md)。

## 调用方式

`GET /v1/tools` 返回工具清单，每个工具带 JSON Schema，可直接映射到 function calling / MCP 工具定义。
统一调用入口 `POST /v1/sessions/:id/tools/<tool>`，同时带 lease token 与 session token：

```bash
curl -X POST http://127.0.0.1:7411/v1/sessions/$SESSION_ID/tools/snapshot \
  -H "x-malo-lease-token: $LEASE_TOKEN" \
  -H "x-malo-session-token: $SESSION_TOKEN" \
  -H "content-type: application/json" \
  -d '{"max_chars":8000,"max_items":120}'
```

成功返回 `{ "tool": "...", "result": ... }`。参数错误、未知工具、选择器找不到返回 400 与
`{ "ok": false, "error": { "code", "message", "details" } }`，服务内部异常为 5xx。两种情况**不是** HTTP 错误：

- 业务判决：`assert` 没通过、`run_steps` 有失败步骤都是 200，判决在 `result.ok`。
- 人发的信号：人点了「暂停」「停止」之后 agent 再动页面，返回 409，`error.code` 是
  `E_PAUSED_BY_HUMAN` 或 `E_STOPPED_BY_HUMAN`，`error.message` 写明了该等什么。

其余状态码：session 不存在 → 404；profile 被占用 → 409；session 超上限 → 429；导航失败 → 502
（`details.navigation` 带 `http_status`、`net_error`、`net_error_description`、`settle`）；步骤超时 → 504。

旧版 `x-pagehand-*` token 头仍被接受，新脚本请用 `x-malo-*`。

## 工具清单

| 类别 | 工具 |
|---|---|
| 导航 | `navigate`、`history` |
| 看页面 | `observe`、`snapshot`、`extract` |
| 操作页面 | `click`、`fill`、`type`、`press`、`hover`、`drag`、`select`、`focus`、`scroll`、`scroll_into_view`、`upload_file` |
| 等待与批量 | `wait_for`、`sleep`、`assert`、`run_steps` |
| 人工交接 | `watch`、`login` |
| 网络与事件 | `network_capture`、`responses`、`events` |
| 会话与档案 | `profiles`、`close` |

## 定位目标：选择器、文本、坐标、iframe

- **CSS 选择器**：`selector`。语法错误是 400 `E_BAD_REQUEST`；没有可见元素匹配是 400 `E_SELECTOR_NOT_FOUND`。
- **可见文本**：`click` 的 `text`（子串匹配，最内层可见元素优先，`nth` 选第几个）。给控件没有可用选择器时用，
  裸 `<span>编辑作品</span>` 也能点。`selector` 与 `text` 同给时，`selector` 是文本的搜索范围。
- **坐标**：`x` / `y`，顶层视口的 CSS 像素。`snapshot` 的 `interactive[].rect` 与 `extract mode=rect` 里
  `x` / `y` 都是元素**中心**，可以直接喂给 `click` / `drag`；`left` / `top` 是左上角。
- **iframe**：`frame` 是 `snapshot.frames` 的下标，在该 iframe 里操作；不给就是顶层页面。可加
  `frame_url`（该 iframe 的 URL 必须包含的片段）做保险：页面变了、序号对不上时直接报错而不是操作错框架。
  支持 `frame` 的工具：`click`、`fill`、`hover`、`select`、`focus`、`scroll`、`scroll_into_view`、
  `wait_for`、`upload_file`、`extract`、`assert`。键盘输入（`press` / `type`）落到当前聚焦的元素上，不需要也不能指定 frame。

## 看页面

`observe` 返回轻量状态（URL、标题、readyState、viewport、DOM 与可交互元素数量、正文摘要、失败请求与
控制台错误），`mode=screenshot` 时附 base64 PNG；`clip_selector` 只截指定元素并返回实际裁剪矩形。

`snapshot` 是 agent 看页面的主工具，返回可见正文、标题、链接、按钮、输入框、下拉框、表单、表格、
landmark、可交互元素（带选择器与矩形）、role 组件、iframe、dialog、alert/live region，以及 `truncated`
标记。它只列**看得见**的元素。

- `sections`：只采集点名的分区，没点名的返回空数组。分区名：`text`、`headings`、`links`、`buttons`、
  `inputs`、`selects`、`forms`、`tables`、`landmarks`、`interactive`、`widgets`、`frames`、`dialogs`、`messages`。
- `widgets`：靠 role 表达语义的自定义组件（tab、option、menuitem、switch、checkbox、radio、link、treeitem、
  combobox、slider、spinbutton），带 `selected` / `checked` / `expanded` / `disabled`。
- `frames`：页面上所有看得见的 iframe（祖先也看得见才算），按文档顺序展平编号。每项带
  `index`、`parent`、`url`、`name` 和该 iframe 在顶层视口里的位置 `rect`；在 `frame_depth`（默认 1，0–3）与
  `max_frames`（默认 4，上限 50）之内，`content` 是这个 iframe 里的嵌套 snapshot。同源、跨域（独立进程）、
  多层嵌套的 iframe 都读得到。嵌套内容里的坐标相对于该 iframe 自己的视口；要顶层坐标用 `extract mode=rect` 加 `frame`。
  有 iframe 因为数量上限没读到时 `frames_truncated: true`；某个 iframe 的内容读不出来只在该项标 `content_error`；
  列表正在变化时 `frames: []` 且 `frames_error` 说明原因。

`extract` 做定向读取：`selector` 加 `mode`（`text` / `html` / `attributes` / `rect`），`all: false` 只取第一个
（默认取前 50 个），`attributes` 指定要读的属性。密码框的值永远读不到（`[redacted]`）。

## 验证

`assert` 的条件（`visible` / `hidden` / `text` / `value` / `url` / `count`）按 AND 组合，在 `timeout_ms`
内反复重试。断言没通过是业务判决：HTTP 200，`result.ok` 与 `result.passed` 为 `false`，
`result.checks` 与 `result.error.details.checks` 带每项 expected / actual，`result.screenshot` 指向
session `artifacts/` 下的失败截图，`result.error.code` 为 `E_ASSERTION_FAILED`。

`selector` 在 `assert` 里限定 `text` 的查找范围，或作为 `value` / `count` 的目标。对密码框做 `value`
断言直接返回 400（拿脱敏串比较只会假通过），改用 `visible` 或页面上的登录态断言。

`run_steps` 把一串工具调用交给 daemon 顺序执行，默认遇错即停（`stop_on_failure: false` 可继续），把每一步
的结果与错误写进 session `artifacts/` 下的 run report，返回 `{ ok, step_count, failed_step, steps, report_path }`。
`run_steps`、`watch`、`login`、`profiles`、`close`、`network_capture`、`responses` 不能嵌进 `run_steps`
（响应体永远不进 run report）。每一步都过人工信号的检查：人点了暂停，后面的步骤以 `E_PAUSED_BY_HUMAN` 失败。

## 操作页面

每个动作返回 `{ action, detail, observation, popup? }`：`detail` 是一句话结果，`observation` 是动作后的轻量
页面状态，`popup` 在这个动作触发了 `window.open` 时出现。动作失败时另在 `artifacts/` 落一张失败截图。

- `click`：按选择器、可见文本或坐标点击；`button`（左 / 中 / 右）、`click_count`（1–3）。
- `fill`：替换输入框内容并**回读校验**。页面吞掉合成输入时（受控组件常见）依次退到 JS 聚焦重打、原生
  setter 加 input / change 事件；三层之后值仍不符报 `E_FILL_NOT_LANDED` 并带实际值，绝不报假成功。
  `verify: false` 只用于页面会改写输入的情况。
- `type`：逐字符发按键事件（换行发回车），用于联想框、富文本这类监听 keydown 的组件；`fill` 是整段替换。
- `press`：单个字符，或 Enter、Tab、Escape、Backspace、Delete、Insert、Home、End、PageUp、PageDown、Space、
  方向键、F1–F12。`modifiers` 是位掩码：Alt=1、Ctrl=2、Meta/Cmd=4、Shift=8。Cmd+A/C/V/X/Z 映射到编辑命令，
  其他 Meta 组合返回 `E_UNSUPPORTED`（避免合成系统级按键）。
- `hover`、`focus`、`select`（按 `value` 或 `label`）、`scroll_into_view`。
- `drag`：`from` 按下、插值移动、`to` 释放，`steps` 控制步数；坐标是顶层坐标，iframe 里的元素先用 `extract mode=rect` 取中心点。
- `scroll`：鼠标滚轮。落点默认是视口中心（打在角落会滚到固定侧栏上），可用 `x` / `y` 指定；给了 `frame` 就落在该 iframe 的中心。
  返回时滚动位置已稳定，紧接着读到的就是滚完的位置。
- `upload_file`：把本机文件放到 `input[type=file]` 上（输入框可以不可见，页面需要时先点上传按钮）。
  同源 iframe 里可以传，跨域 iframe 明确拒绝（主页面碰不到它的文档）。
- `history`：`back` / `forward` / `reload`。
- `wait_for`：等 `selector`（`state` 为 attached / visible / hidden）、`text`，或 `human: true`（见下文人工交接）。
- `sleep`：固定等待，0–120 秒。

### 弹窗

一个 session 只有一个页面，`window.open` 不开新窗口。默认拦下：事件里记
`navigation.popup_blocked`，触发它的动作结果带 `popup: { url, adopted: false }`，agent 拿到目标地址后自己决定
怎么走。创建 session 时给 `"popup": "adopt"`，弹窗地址直接在当前页面打开（`adopted: true`），等价于「点开了
新窗口的链接」。`about:blank#blocked` 这类没有地址的弹窗只拦不开。

## 人工交接

登录墙、扫码、人机校验不该让 agent 硬碰。`watch` 把真实页面显示给人（不抢焦点），工具条上的人机交接按钮
让人的结论能直接传回 agent，`login` 负责登录这一种交接。

```bash
# 把窗口显示给人；之后 agent 用 wait_for human 等人点「完成」
curl -X POST http://127.0.0.1:7411/v1/sessions/$SESSION_ID/tools/watch \
  -H "x-malo-lease-token: $LEASE_TOKEN" -H "x-malo-session-token: $SESSION_TOKEN" \
  -H "content-type: application/json" -d '{"show":true}'

curl -X POST http://127.0.0.1:7411/v1/sessions/$SESSION_ID/tools/wait_for \
  -H "x-malo-lease-token: $LEASE_TOKEN" -H "x-malo-session-token: $SESSION_TOKEN" \
  -H "content-type: application/json" -d '{"human":true,"timeout_ms":600000}'
```

### watch

窗口默认以 `showInactive` 出现：不抢键盘焦点、不切 Space；带原生标题栏，可拖动缩放。`focus: true`
被拒绝（400），除非 daemon 以 `--allow-focus` 启动——想看前台时人自己点窗口或 Dock 图标即可。
`width` / `height` 调整视口。`show: false` 收起。

人点红色关闭钮不结束会话：同一个页面视图换一个隐藏窗口接着托管，事件里记一条 `window.closed`，
下次 `watch` 原样弹回。窗口只在第一次显示时摆到工作区正中，之后位置归人管。

### 工具条

地址栏（只接受 http/https，回车跳转）、后退、前进、刷新，右侧是三个交接按钮：

| 按钮 | 含义 | 对 agent 的影响 |
|---|---|---|
| 完成 | 「我做完了，可以继续」 | `wait_for human` 与 `login(mode=watch)` 取走这个信号后返回；取走即清零，下一轮交接还能再点 |
| 暂停 / 继续 | 暂停期间先别动页面 | 暂停期间动作类工具返回 409 `E_PAUSED_BY_HUMAN`；观察、截图、读取类不受影响；点「继续」恢复 |
| 停止 | 到此为止 | 终态：之后动作类工具返回 409 `E_STOPPED_BY_HUMAN`，不再接受任何信号；agent 收尾并关闭会话 |

session 摘要带 `human: { done, paused, stopped }`，工具条随状态同步（按钮可用性、暂停与继续的切换）。
`navigate`、`actions`、`login` 与全部动作类工具都受暂停 / 停止约束；`wait_for` 与 `sleep` 不动页面，不受约束。

### login

```bash
# 账号密码：agent 提供一次性凭据
curl -X POST http://127.0.0.1:7411/v1/sessions/$SESSION_ID/tools/login \
  -H "x-malo-lease-token: $LEASE_TOKEN" -H "x-malo-session-token: $SESSION_TOKEN" \
  -H "content-type: application/json" -d '{"mode":"password","username":"demo","password":"secret"}'

# 人工接管：窗口拉给人看，人登录后点「完成」即算成功
curl -X POST http://127.0.0.1:7411/v1/sessions/$SESSION_ID/tools/login \
  -d '{"mode":"watch","timeout_ms":180000}'
```

- `password` 模式自动识别用户名、密码和提交按钮，可用 `username_selector`、`password_selector`、`submit_selector` 覆盖。
- `watch` 模式只把窗口显示给人，等结论。`reason` 为 `human_done` 表示人在工具条上点了「完成」——扫码、
  验证码这类页面没法自己判定的登录，由人给结论。
- 页面自己判定成功时 `reason=success`：给了 `success_selector` 就只看它，给了 `success_url_contains`
  就只看 URL，两者都没给才退回「密码框消失 / URL 变化 / 页面出现退出登录等文本」的启发式。
- 失败判定看 `error_selector` 或页面上的常见错误文案，返回 `reason=login_error` 而不是空转重试。
- 凭据只存在于本次调用内存：不落盘、不进事件、不回显；密码框在快照里 `value` 为空串并标记 `sensitive: true`。
- `login` 成功后窗口自动隐藏（`keep_visible: true` 可留给人继续操作）；超时的接管窗口不会自动关闭。
- 登录态只有指定 `profile` 时才保留。

## 网络响应捕获（XHR / fetch）

`network_capture` 声明关心的 URL 前缀，`responses` 取回命中的响应体。时序是先订阅、再导航、再触发交互，
最后按 `seq` 轮询：

```bash
BASE=http://127.0.0.1:7411
SESSION=/v1/sessions/$SESSION_ID/tools
AUTH=(-H "x-malo-lease-token: $LEASE_TOKEN" -H "x-malo-session-token: $SESSION_TOKEN" -H "content-type: application/json")

curl -X POST "$BASE$SESSION/network_capture" "${AUTH[@]}" \
  -d '{"url_prefixes":["https://web-api.example.com/api/v1/action/"]}'
curl -X POST "$BASE/v1/sessions/$SESSION_ID/navigate" "${AUTH[@]}" -d '{"url":"https://example.com/action/2026-11-05"}'
curl -X POST "$BASE$SESSION/click" "${AUTH[@]}" -d '{"selector":"#tab-theme"}'
curl -X POST "$BASE$SESSION/responses" "${AUTH[@]}" \
  -d '{"url_prefix":"https://web-api.example.com/api/v1/action/","after":0,"limit":50}'
```

- `network_capture` 省略 `url_prefixes` 只返回当前订阅和已保留 body 的条数；`[]` 清空订阅并关闭 CDP 网络域。
- 首次设置非空前缀时才发 `Network.enable`，并带 `maxTotalBufferSize=64 MiB`、`maxResourceBufferSize=8 MiB`
  ——不带这两个值，大响应体会取不到。清空订阅时丢弃已缓存 body，元数据保留。
- 订阅是 session 私有的，关闭 session 即失效，不写 profile，不影响其他 session。
- `responses` 入参 `url_prefix`（结果过滤）、`after`（取 `seq` 大于它的记录）、`limit`（1–200，默认 50），
  返回 `{"responses":[record],"has_more":bool}`。`has_more` 表示还有未返回的匹配记录。

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

`body` 是原始文本；`body_truncated=true` 表示超过单条 **1 MiB** 上限、只保留前 1 MiB。`body_error` 只在
`body=null` 时出现，如实标注原因：

| 值 | 含义 |
|---|---|
| `not_subscribed` | 未命中订阅，只记元数据 |
| `no_body` | 204/304 或空响应体 |
| `evicted` | 被 200 条 captured 上限或 16 MiB 字节预算挤出 |
| `pending` | body 仍在串行队列里，稍后重试 |
| `binary` | 响应体是二进制（base64），不按 UTF-8 解码 |
| `getResponseBody_failed: <原因>` | CDP 取 body 失败（如导航离开后缓冲已清），不重试 |
| `too_large` | 契约保留值；当前实现对超限 body 截断，不会返回此值 |

内存模型：所有 resource type 都记元数据（最多 **500 条**）；body 只为订阅命中的响应保留，最多 **200 条**、
总字节预算 **16 MiB**。body 只存在于 daemon 内存与 `responses` 的返回值中，不写日志、事件、run report。

捕获子系统自身故障（`Network.enable` / `Network.disable` 被拒等）返回显式的 `E_CAPTURE_UNAVAILABLE`
（5xx），不会伪装成空列表。

限制：CDP session 附着在页面 target 上，跨进程 iframe（OOPIF）或 service worker 发出的请求抓不到。

## 事件

`GET /v1/sessions/:id/events?after=<seq>`（或工具 `events`）按序号读 session 事件，返回
`{ events, next_after, dropped }`：下一页用 `after=next_after`；`dropped` 是游标之后、被环形缓冲
（200 条）覆盖掉的事件数，不为 0 说明读慢了、有事件没拿到。

事件同时追加到 session 的 `artifacts/events.jsonl`（0600，创建 session 的响应里给出路径 `events_log`），
session 关闭后仍在，供事后审计；写满 5 MiB 后只补一条 `event_log.truncated`。事件里不含凭据。

常见事件：`session.created` / `session.closed` / `page.destroyed`（页面在会话之外被关掉）、
`window.closed`、`navigation.*`（含 `popup_blocked` / `popup_adopted`）、`page.loading` / `page.loaded`、
`console.error`、`renderer.gone`、`permission.granted` / `permission.denied`、`download.started` / `download.finished`、
`observe.snapshot` / `observe.extract` / `observe.screenshot`、`action.started` / `action.completed` / `action.failed`、
`assert.passed` / `assert.failed`、`run.finished`、`login.*`、`watch.shown` / `watch.hidden`、
`human.done` / `human.paused` / `human.resumed` / `human.stopped` / `human.done_taken`。
