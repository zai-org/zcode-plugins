<p align="center"><img src="assets/malo-browser/icon.png" width="88" height="88" alt="Malo Browser 图标"></p>

<h1 align="center">Malo Browser</h1>

演示用浏览器。基于 Electron + Chromium，把网页演示拆成
Stage（给观众看）和 Recorder（固定规格录制），不 fork 浏览器内核；
演示流程用场景脚本编排，配 Director 控制台与本地控制 API。

当前仓库是 0.1.x 的可工作原型：无头录制、CDP 物理交互、覆盖层、1080p30 出片、
证据文件、最小 `.app`。它同时是 `malo-browser` agent 运行时：常驻 daemon 分发端口租约，
多个 agent 可以并行驱动相互隔离的浏览 session。

## 安装

### 环境要求

- Node 22 行的 22.12 及以上、24.x，或 26 及以上（`engines` 为
  `^22.12.0 || ^24.0.0 || >=26.0.0`，不含 23 与 25 行）。该范围已写进
  `package.json`，版本不满足时包管理器在安装阶段就给出明确提示（yarn 直接失败；
  npm / pnpm 默认打印 EBADENGINE 警告、`engine-strict` 下失败），不会拖到
  vite / vitest 深处才炸出难懂的错误。
- `PATH` 上有 ffmpeg 与 ffprobe（先查 `PATH`，再回退到 Homebrew / 本地安装目录）；
  缺失时以退出码 3 结束。
- macOS 是已验证路径：窗口模式与录制在 macOS 上实测，隐藏模式使用 accessory 激活策略。
- Python 3 仅用于起内置 fixture 静态服务（`python3 -m http.server`）。
- git。

### 从源码

```bash
git clone https://github.com/Lumos-789/malo-browser.git
cd malo-browser
npm install
npm run build
```

`npm run build` 用 tsc 编译主进程、用 vite 打包 fixture 与 director 控制台。
`npm run typecheck` 只做类型检查、不产物；`npm test` 跑 vitest 单元测试。

### 插件形态

仓库既是应用也是插件载体，不复制第二份源码。

- ZCode 插件：`.zcode-plugin/plugin.json`（名称 `malo-browser`，版本与主仓一致），
  技能 `skills/malo-browser/SKILL.md`（安装 / 配置 / 排障型，不复制产品逻辑），
  图标 `assets/malo-browser/icon.png`（512x512）。已注册 `dev-oss-projects` 市场时：
  `zcode plugins install malo-browser@dev-oss-projects -s user`。
- DSH bundle：`package.json` 声明 `dsh.bundle`（patch 指向仓根 `cordis.patch.yml`），
  `index.js` 用 `bundledSkillDir` 挂载 `skills/`。`engines.dsh` 与
  `@deepseek-ai/*` peerDependencies 也在 `package.json`；peer 声明为 optional，
  不影响本仓作为 Electron 应用的 `npm install`。

## 运行

先另开一个终端起 fixture 页面（默认演示目标）：

```bash
python3 -m http.server 4788 --bind 127.0.0.1 --directory out/fixture
```

默认：无头后台录制，10 秒。

```bash
npx electron . --mode=record --seconds=10 --out=evidence --label=hidden
```

默认录制不显示窗口、不抢焦点、不占 Dock（macOS 下 `setActivationPolicy('accessory')`），
可以一边录一边继续用电脑。

| 命令 | 作用 |
|---|---|
| `npm run build` | 编译主进程（tsc），打包 fixture 与 director（vite） |
| `npm run typecheck` | 主进程 + renderer 类型检查，不产物 |
| `npm test` | vitest 单元测试 |
| `npm start` | Director 控制台 + Stage；Stage 以 `inactive` 显示，不抢焦点 |
| `npm run start:control` | 同上，并启动本地控制 API（`http://127.0.0.1:7317`） |
| `npx electron . --mode=record --seconds=10` | 无头录制（默认） |
| `npx electron . --mode=record --window-mode=inactive --seconds=10` | 可见但不抢焦点录制 |
| `npx electron . --mode=record --plain --seconds=10` | 不做交互，只录静态页（对照用） |
| `npx electron . --mode=app --autorun=report-review --scenes=fixtures/scenes` | 无头跑完整场景并出片 |
| `npx electron . --mode=app --director-check` | 隐形校验 Director 与 preload 桥接 |
| `npx electron . --mode=app --headless=true --control-api=true` | 全无窗口后台实例，只留控制 API 与录制 |
| `npx electron . --mode=stage --window-mode=inactive` | 可见 Stage，手动体验页面 |
| `npm run daemon` | malo-browser 后台 broker，向多个 agent 分发隔离 session |
| `npm run smoke:malo -- <broker.json> <fixture-url>` | 跑 malo-browser 多 agent / 多 session 真实链路 |
| `npm run smoke:toolbar` | 无头校验人工接管窗口的工具条（preload、回车跳转、地址同步、后退、页面视口） |
| `npm run smoke:control -- report-review` | 对已启动的控制 API 跑一遍加载场景 → 录制 → 校验 evidence |
| `npm run package` | 打一个 `.app`（`dir` 目标，不生成安装包）到 `dist/`（Apple Silicon 为 `dist/mac-arm64/Malo Browser.app`） |
| `./scripts/run-phase0.sh` | 跑 Phase 0 主证据（hidden + inactive） |

`--mode=stage` 跟随 `--window-mode`，而它的默认值是 `hidden`；要真正看到 Stage，
请显式传 `--window-mode=inactive`（或 `focused`）。

常用参数：`--url`、`--width`、`--height`、`--out`、`--label`、`--keep-frames`、
`--window-mode=hidden|inactive|offscreen|ghost|focused`、`--focus-emulation=false`、
`--control-api=true`、`--control-port`、`--headless=true`、`--scenes`、`--autorun`、
`--plain`。参数拼错会直接报错退出；`--help` 打印完整说明，`--version` 打印版本号。

本地控制 API 只绑回环地址，启动时生成随机 token 并写到 `<out>/control.json`（0600）。
路由与 curl 示例见下文「应用控制 API」一节。

### 窗口与焦点模式

Phase 0 实测：

| 模式 | 行为 | 可录制 | 可交互 |
|---|---|---|---|
| `hidden`（默认） | 不显示窗口 | 是 | 是（带焦点仿真） |
| `hidden` + `--focus-emulation=false` | 不显示窗口 | 是 | 否，点击会被丢弃 |
| `inactive` | 显示窗口但不抢焦点 | 是 | 是 |
| `offscreen` | 显示到屏幕外 (-12000, -12000) | 是 | 是 |
| `ghost` | 显示但透明度 0 | 是 | 是 |
| `focused` | 显示窗口并抢焦点 | 是 | 是 |

无头模式必须配合 `Emulation.setFocusEmulationEnabled`（默认开启），否则 CDP 物理点击
不会生效。

### malo-browser（agent 运行时）

`malo-browser` 是给 agent 用的后台 Web 执行层：一个常驻 daemon 管理端口租约，每个
agent 拿一个稳定端口，同一端口下可以开多个相互隔离的 session。默认没有可见窗口，
不抢焦点、不抢屏、不切 Space；截图只在显式请求或动作失败取证时生成。

```bash
npm run daemon
# in another terminal
curl -s http://127.0.0.1:7410/health
cat ~/.malo-browser/broker.json
```

默认：broker `127.0.0.1:7410`，lease 端口池 `7411-7499`，数据目录 `~/.malo-browser`。
启动成功会打印一行 JSON，并写入 `~/.malo-browser/broker.json`（0600），内容为
`{endpoint, token, pid}`。同一个数据目录只允许一个 daemon：已有实例仍健康时，新进程
会明确报错；已停止实例留下的 `broker.json` 会被识别为陈旧文件并覆盖。

daemon 参数：`--daemon-port=7410`、`--port-min=7411`、`--port-max=7499`、
`--lease-ttl-seconds=300`、`--session-idle-seconds=300`、`--max-sessions=4`、
`--data-dir=~/.malo-browser`。

新 session 需要同时带 lease token 和自己的 session token；拿 session A 的 token 访问
session B 会返回 401。`width` / `height` 是页面视口尺寸，人工接管窗口的工具条不占用
这两个值。不带 `profile` 的 session 是匿名的，关闭即清空；创建时带
`{"profile":"work"}` 的 session 共享该 profile 的 cookies 与 storage，跨 session、
跨 daemon 重启保留。profile 名只接受小写字母、数字、点、下划线、短横线，最长 64 字符。
数据落在 `<data-dir>/leases/<lease-id>/sessions/<session-id>/{downloads,artifacts}`，
profile 数据落在 `<data-dir>/chromium`。

`delivery-video` 只是视觉输出适配器，不决定 malo-browser 的内核边界。

### 验证脚本

- `npm run smoke:malo -- ~/.malo-browser/broker.json http://127.0.0.1:4788` 跑真实 daemon
  链路（详见 [docs/malo-browser.md](docs/malo-browser.md)）。
- `npm run smoke:toolbar` 先 build，再在隐藏窗口里驱动人工接管工具条。
- `npm run smoke:control -- report-review` 连已经在跑的控制 API；需要设
  `DEMO_CONTROL_URL`（默认 `http://127.0.0.1:7317`）与 `DEMO_CONTROL_TOKEN`
  （从 `<out>/control.json` 读）。

## 场景脚本

场景是 `fixtures/scenes/<id>/scene.yaml` 下的 YAML，通过 `demo://scene/<id>/...`
协议加载，只允许读写场景目录内的文件。字段契约见
[schemas/scene.schema.json](schemas/scene.schema.json)。

### 内置场景

- `report-review`：当前可用场景，7 步
  `wait_for -> highlight -> click -> fill -> assert -> spotlight -> annotate`；
  页面以 `demo://scene/report-review/index.html` 加载。
- `multi-a -> multi-b`：验证多场景切换：1280x720 切到 1600x900，同一路 screencast
  不断流，evidence 里记 `run.scene_ids`。
- `login-demo`：完整账号登录链路（见下）。

场景动作：`goto`、`login`、`wait`、`wait_for`、`wait_for_presenter`、`click`、
`fill`、`press`、`scroll`、`highlight`、`spotlight`、`annotate`、`mask`、`blackout`、
`assert`、`scene`、`set`、`note`、`screenshot`（共 19 个）。

### 目标解析

带目标的动作按固定顺序解析，先命中先用：

| 优先级 | 写法 | 解析为 |
|---|---|---|
| 1 | `data_demo_id: increment` | `[data-demo-id="increment"]` |
| 2 | `selector: ".btn-primary"` | 原样 CSS 选择器 |
| 3 | `text: 金额异常` | 文本匹配（规则见下） |
| 4 | `x: 640` + `y: 360` | 视口坐标点（无选择器，兜底用） |

文本匹配在页面内找**可见**（非隐藏且有尺寸）且文本**包含**目标串的最小元素，命中后
打上运行期属性供该步后续命令复用。找不到匹配、或四层目标都没写，都报
`E_SELECTOR_NOT_FOUND`（报错文案会区分「没有元素包含这段文本」与「步骤没有可解析的
点击或视觉目标」）。

三个特例里 `text` 不当目标用：

- `fill`：`text` 是要输入的内容；目标另写 `selector` / `data_demo_id` / 坐标，
  或用 `target_text` 指定要点的元素文本；
- `annotate`：`text` 是标注文案；目标必须是 `selector` / `data_demo_id` / 坐标；
- `wait_for`：`text` 是等待条件（等文本出现），不是点击目标。

### 账号登录

`login` 动作使用仓库外的 `0600` 账户文件：场景只写 `account_id`，密码在运行时从
`password_env` 读取，动作负责打开登录页、填写、提交并等待成功条件。
`fixtures/scenes/login-demo` 可验证完整链路。默认账户文件为
`~/.config/malo-browser/accounts.json`，可用 `MALO_BROWSER_ACCOUNTS` 覆盖。文件必须
位于 git worktree 之外、是普通 `0600` 文件、`origin` 与 `login_url` 同源，并至少配置
`success_selector` 或 `success_url`；带明文 `password` 字段会被拒绝。配置格式、安全
边界、运行示例和失败排查见 [docs/accounts.md](docs/accounts.md)。

### 场景变量

`vars` 存放场景内字符串，`${name}` 在动作字段里插值；`${env:SCENE_NAME}` 只读取
`SCENE_` 前缀的环境变量，其他名字一律拒绝——第三方提供的场景因此无法把云密钥或 token
拼进 URL 或表单。

### 校验

Scene 层校验一次报全所有错误；未知字段、越界时间、缺目标都会在加载前失败。

## 录制与证据

### 产物文件

一次 `--mode=record` 录制按 label 落：

```text
evidence/
  hidden.mp4
  hidden.evidence.json      # 版本、视口、DPR、帧数、时长、SHA256、步骤、自检结果
  hidden.overlay-frame.png  # 覆盖层校验帧（--plain 时不生成）
  hidden.overlay-before.png # 覆盖层出现前的对照帧（--plain 时不生成）
```

app 模式的 take（autorun 或控制 API）落在
`<out>/recordings/<timestamp>_<scene>/take-01.mp4` 与同名 `take-01.evidence.json`；
`assert` 失败会额外落一张 `<out>/errors/<scene>/step-<index>.png`（其他动作失败只带错误，
不截图）。

app 模式 evidence 与成片都以 0600 权限写入。文档记录 `status`、`app`、`scene`、`run`（多场景
take 含 `run.scene_ids`）、`capture`、`video`、`steps`、`checks`、`warnings`，失败时
还有 `error`。

### 自检

`--mode=record` 的 take 只有全部自检通过才返回 0：窗口无 Node、帧到达、时长误差
≤0.5s、30fps、1920x1080、黑帧占比 <50%、覆盖层真的进了视频（`--plain` 跳过）。

app 模式的 take 检查 `frames_arrived`、`steps_completed`、`steps_within_take`；步骤
失败或自检失败都会把 evidence 标成 `failed`，take 带 `video.partial`。自检失败抛
`E_EVIDENCE_MISMATCH`，并带上失败项 id。autorun 路径里步骤失败也会先停录制器，所以
take 仍保留视频与失败 evidence。

### 失败的 take

「失败也有证据」对所有入口成立：

- `--mode=record` 在视频编码之前抛错时，写 `<out>/<label>.evidence.json`，含
  `status: "failed"`、`video: null`、`error.code`、`error.message` 与失败步骤
  `error.step`；覆盖打开舞台（例如页面不可达，记为 `ERR_CONNECTION_REFUSED`）、采帧、
  步骤与编码失败。失败前已写出的部分产物列在 `artifacts` 里。
- app 模式（`--autorun`、控制 API、IPC）在录制器编码之前失败时，写该 take 的
  `take-01.evidence.json`，含 `status: "failed"`、`video: null`、`error.code` 与
  `error.message`——包括 0 帧的 `E_RECORDER_NO_FRAMES`——随后继续抛原始错误，所以退出码
  / 控制 API 错误行为不变。
- 录制器成功、但 run 里有失败步骤的 take 保留视频（`video.partial: true`），并记录
  步骤错误。
- `--keep-frames` 额外保留失败 take 的原始帧。

### 退出码

| 退出码 | 含义 |
|---|---|
| 0 | 成功：自检全过（`--mode=app --autorun` 成功时 stdout 另输出一行 JSON） |
| 2 | 参数错误或通用失败（页面加载失败、`E_SELECTOR_NOT_FOUND`、断言失败、CDP 附加失败、场景校验失败、端口被占用、evidence 自检失败） |
| 3 | ffmpeg/ffprobe 缺失或执行失败（`E_FFMPEG_MISSING` / `E_FFMPEG_FAILED`，先安装 ffmpeg） |
| 4 | 录制器失败（`E_RECORDER_NO_FRAMES` 等采帧/时间轴错误） |

## 控制 API

### 应用控制 API

用 `--control-api=true`（或 `npm run start:control`）启动，默认绑 `127.0.0.1:7317`，
命令走与 Director 相同的 `dispatchCommand` 通道：

```bash
curl http://127.0.0.1:$PORT/health
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:$PORT/state
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:$PORT/scenes
curl -X POST -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"cmd":"run.start","args":{"mode":"record"}}' http://127.0.0.1:$PORT/command
curl -N -H "Authorization: Bearer $TOKEN" http://127.0.0.1:$PORT/events
```

`x-demo-token: $TOKEN` 与 bearer 头等价。`POST /command` 成功返回 200 与
`{"ok":true,"result":...}`；`DemoError` 映射为 400，`E_PROFILE_LOCKED` /
`E_STEP_TIMEOUT` / `E_RECORDER_NO_FRAMES` 为 409，其余为 500。`/events` 是 SSE：先回
`: connected` 注释行，此后每 15 秒一行 `: ping`，`data:` 行是 `AppEvent` JSON。token
在 `<out>/control.json`（0600）里，内容为 `{url, token, pid}`，服务端用
`crypto.timingSafeEqual` 比较。接口不返回 CORS 头，跨源浏览器脚本无法直接调用，
只面向本机脚本。

### Agent 工具 API

lease endpoint 暴露 agent 工具。`GET /v1/tools` 返回带 JSON Schema 的工具清单，调用入口是
`POST /v1/sessions/:id/tools/<tool>`，需要同时带 lease token 与 session token：

```bash
curl -X POST http://127.0.0.1:7411/v1/sessions/$SESSION_ID/tools/snapshot \
  -H "x-malo-lease-token: $LEASE_TOKEN" \
  -H "x-malo-session-token: $SESSION_TOKEN" \
  -H "content-type: application/json" \
  -d '{"max_chars":8000,"max_items":120}'
```

工具：`navigate`、`history`、`events`、`observe`、`snapshot`、`extract`、`click`、
`fill`、`upload_file`、`press`、`hover`、`select`、`focus`、`scroll`、`scroll_into_view`、`wait_for`、
`sleep`、`assert`、`run_steps`、`network_capture`、`responses`、`watch`、`login`、
`profiles`、`close`。`snapshot` 返回正文、标题、链接、按钮、输入框、表单、表格、
landmark、iframe、dialog 和可交互元素的 selector；`extract` 做定向读取。
`network_capture` 为当前 session 订阅命中 URL 前缀的 XHR/fetch 响应体，`responses`
按 seq 取回，body 只留在 daemon 内存。`run_steps` 顺序执行一串工具（默认遇错即停），
把 run report 写进 session 的 `artifacts/run-<timestamp>.json`，返回
`{ ok, step_count, failed_step, steps, report_path }`；`run_steps`、`watch`、`login`、
`profiles` 与 `close` 自身不能再嵌进 `run_steps`；`network_capture`、`responses` 属于 session
控制，同样会被拒绝，捕获到的 body 不会进入 run report。

lease endpoint 状态码：参数错误、未知工具、选择器找不到、导航策略拒绝 → 400；session
不存在 → 404；profile 被占用 → 409；session 超上限 → 429；导航失败 → 502；步骤超时 →
504；服务内部异常 → 500。导航失败会在 `details.navigation` 中带 `http_status`、
`net_error`、`net_error_description` 和 `settle` 信息。

安全边界：只监听回环地址；`Host` 只接受 `127.0.0.1:<port>` 与 `localhost:<port>`（防
DNS rebinding）；只接受 JSON、请求体上限 1MB；broker / lease / session token 三层分离；
只允许 `http:` / `https:` 导航，拒绝 URL 内嵌 credentials；`window.open` 与权限请求默认
拒绝。旧版 `x-pagehand-*` token 头仍被接受，新脚本请用 `x-malo-*`。

### Profile 登录态导入

`POST /v1/profiles/:name/import` 从另一个 Chromium 的 DevTools 端点实时读取 cookie
并写进持久 profile：已登录的日常 Chrome 无需重新输入密码，就能把登录态交给一个 malo
profile：

```bash
curl -X POST http://127.0.0.1:7411/v1/profiles/work/import \
  -H "x-malo-lease-token: $LEASE_TOKEN" \
  -H "content-type: application/json" \
  -d '{"cdp_url":"http://127.0.0.1:9223"}'
```

请求体：`cdp_url`（必填，只允许回环 `http://`）、`domains`（可选白名单，如
`["example.com","example.org"]`——cookie 的域与条目相等、是其子域或父域即算匹配）、
`session_cookie_ttl_days`（默认 180；session cookie 会被改写成持久 cookie，让导入的
登录态活过 daemon 重启；`0` 表示保持 session-only）。daemon 连上源浏览器的
browser-level WebSocket 调 `Storage.getCookies`，把每条 cookie 经目标 profile 分区的
Electron cookie store 写入，返回
`{ profile, created, source, cookies_total, cookies_matched, cookies_written, cookies_failed, failed }`
（`failed` 最多列 20 条逐 cookie 写入错误，例如过不了 Chromium 前缀规则的 `__Host-`
cookie；`cookies_failed` 统计的是封顶后的列表，不是全部失败数）。导入只合并不清空
profile 已有状态；服务端已过期的登录仍然需要真实重新登录。源浏览器连不上 → 502
`E_IMPORT_SOURCE_UNREACHABLE`；域过滤后 0 条 → 400 `E_IMPORT_EMPTY`。只迁移 cookie，
localStorage、IndexedDB 与 HTTP cache 都留在源浏览器。

### assert 与 run_steps 判决

断言没通过是业务判决，不是服务坏了。`assert` 返回 **HTTP 200**，判决在 result 上：

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

通过时 `result.ok` 与 `result.passed` 为 `true`，`result.checks` 带全部检查项。所以
`assert` 与 `run_steps` 都统一读 `result.ok` 拿判决：`run_steps` 在批次跑完时同样是
200，`result.ok: false` 配 `failed_step` 与 `steps[].error`。非法参数仍是 4xx，真正的
服务内部异常仍是 5xx。

0.1.2 契约变更：`assert` 失败原先是 HTTP 500 加
`{"ok":false,"error":{"code":"E_ASSERTION_FAILED",...}}`。把 500 状态当成「断言失败」的
调用方必须改成读 HTTP 200 加 `result.ok`。这是 0.1.x 的契约变更，因此明确写出。

### 人工接管

登录、扫码和人机校验不该让 agent 硬碰。`watch` 与 `login` 把「人接手一次、agent 拿回
控制权」做成契约：窗口默认以 `showInactive` 出现（不抢键盘焦点、不切 Space），带原生
标题栏和一条浏览器工具条（后退、前进、刷新，地址栏只接受 http/https，回车跳转，地址随
页面同步）。只有显式 `focus: true` 才把窗口带到前台。凭据只存在于本次调用内存：不落盘、
不进事件、不回显；密码框固定读 `[redacted]`，且对密码框做 `assert value` 会被拒绝而不是
拿脱敏串比较。`login` 成功后窗口自动隐藏（`keep_visible:
true` 可留给人继续操作），agent 继续用同一个 session；`watch` 打开的窗口要显式关闭才
隐藏，超时的人工接管窗口也不会自动关闭。登录态只有指定 `profile` 时才保留。

## 项目结构

```text
src/main/
  index.ts            # 启动、退出码、全局失败兜底
  cli.ts              # 参数
  app.ts              # app 模式装配：Scene 服务、Director、autorun、IPC
  app-controller.ts   # 状态快照、场景加载、运行、录制、evidence
  ipc.ts              # Director 通道与控制命令
  control-dispatch.ts # Director IPC 与本地 API 共用的命令分发
  control/            # 本地 HTTP 控制 API（回环 + token + SSE）
  stage-layout.ts     # 场景尺寸/安全策略/访问顺序的纯计算
  demo-protocol.ts    # demo:// 场景协议（按 session 注册）
  electron-page-driver.ts  # PageDriver 的 Electron 实现（CDP 物理事件）
  electron-overlay.ts      # OverlayPort：光标/高亮/聚光/标注/遮罩/黑屏
  malo/               # malo-browser daemon：端口池、租约、broker、session、HTTP
  scenes/             # Zod 校验、Scene 加载、变量插值、脚本 hash
  runner/             # 状态机、19 个动作、目标解析
  capture/            # screencast 抓帧、30fps 时间轴、ffmpeg、evidence
  security/           # 白名单、路径安全、权限与下载策略
  windows/            # Stage（BaseWindow+WebContentsView）、Director
  phase0.ts           # Phase 0 冒烟 / --mode=record 路径
src/renderer/director # 讲解人控制台（React + lucide）
src/preload/          # Director 桥接（沙箱可用）
src/fixture/          # React fixture：计数按钮、搜索、风险行、动画
fixtures/scenes/      # 可直接加载的场景（report-review、login-demo、multi-a、multi-b）
scripts/
  run-phase0.sh      # 主证据复现
  malo-smoke.mjs     # 多 agent / 多 session daemon 冒烟
  control-smoke.mjs  # 控制 API：加载 → 录制 → evidence
  toolbar-smoke.mjs  # 人工接管工具条（隐藏 StageWindow）
  malo-web-probe.mjs # 站点兼容性探针（抓帧 + 截图）
  compare.cjs        # 两段视频的 SSIM 对比
```

## 排障

- `EBADENGINE` 警告/失败 → Node 行不对；用 `engines` 允许的范围（22 行 ≥22.12、24.x，
  或 ≥26；不含 23/25）。
- 退出码 0、没有 stdout、`<out>` 里也没有文件 → 该 shell 里设了
  `ELECTRON_RUN_AS_NODE`（用 `echo $ELECTRON_RUN_AS_NODE` 确认），Electron 当普通 Node
  跑、应用根本没启动；改用 `env -u ELECTRON_RUN_AS_NODE npx electron ...`。
- 退出码 3 `E_FFMPEG_MISSING` → 安装 ffmpeg（例如 `brew install ffmpeg`）后重试。
- 退出码 4 / 录制失败 → 打开该 take 的 `.evidence.json`：即使没出视频它也存在
  （`video: null`、`error.code`）。`E_RECORDER_NO_FRAMES` 表示 screencast 没有送达任何
  帧；确认页面真的渲染了，以及窗口没有在录制中途被销毁。
- `EADDRINUSE` → 报错会指出该改哪个参数：控制 API 用 `--control-port`，broker 用
  `--daemon-port`，lease 端口池用 `--port-min`/`--port-max`。
- 控制 API 401 → 从 `<out>/control.json` 读 token，用 `Authorization: Bearer <token>`
  或 `x-demo-token: <token>` 发送。
- Director 显示 MOCK → preload 桥接缺失；用 `npm start` / `npm run start:control`
  启动，不要直接打开 HTML。
- `E_SELECTOR_NOT_FOUND` → 没有可见元素匹配；检查目标写法。`fill` 的 `text` 是输入
  内容，目标要写 `selector` / `data_demo_id` / 坐标（或用 `target_text`）；`annotate`
  的 `text` 是标注文案。
- `E_ACCOUNT_NOT_FOUND` → 账户文件或 `account_id` 缺失；检查 `MALO_BROWSER_ACCOUNTS`
  以及报错里列出的可用 id。
- `E_ACCOUNT_INVALID` 带 `0600` 或 `outside a git worktree` → 把账户文件移出仓库并
  `chmod 600 <accounts.json>`。
- `E_ACCOUNT_INVALID` 带 `environment variable` → 在启动 Electron 的那个 shell 里
  export 该 profile 的 `password_env`；永远不要把密码写进场景 YAML。
- 录制时窗口抢焦点 → 传了会抢焦点的 `--window-mode`；默认的 `hidden`/`inactive`
  都不会抢焦点。
- `assert` 返回 HTTP 200 且 `result.ok: false` → 这是判决而不是服务坏了；读
  `result.error.details.checks` 和失败截图。
- malo session 401 → 必须同时带 lease token 与 session token；用别的 session 的 token
  会被拒绝。长时间空闲后 404 → session 已被回收，新建一个。
- daemon 起不来 → 另一个 daemon 占着这个数据目录；停掉它，或换 `--data-dir`。

## 副作用

- 在 `--out`（默认 `./evidence`）下写 evidence 与录制产物：mp4、evidence JSON、覆盖层
  校验帧、app 模式的 take（`recordings/`）、失败步骤截图（`errors/<scene>/`），开控制
  API 时还有 `control.json`（0600）。
- 编码与自检时启动 ffmpeg/ffprobe 子进程；录制期间采帧本身也占 CPU。
- 只绑回环端口：控制 API `7317`、broker `7410`、lease 端口池 `7411-7499`（都可改）。
  不在外部网卡上监听。
- 按模式决定是否开窗：record / autorun / headless 默认不开；`npm start` 开一个可见但
  不抢焦点的 Stage；`watch`/`login` 开人工接管窗口。macOS 非交互模式切到 accessory
  激活策略并隐藏 Dock 图标；有可见窗口期间 Dock 会亮出图标（被挡住的窗口点 Dock
  即可调回最前），窗口全部收起后图标自动消失。
- malo daemon 会一直运行到被停止，写 `~/.malo-browser`（broker.json 0600、Chromium
  profile 数据、每 session 的 downloads/artifacts），匿名 session 关闭时删除自己的
  partition。
- 登录态只在指定 `profile` 的 session 上保留，直到 `DELETE /v1/profiles/:name`。
- 权限与 `window.open` 默认拒绝。下载允许，但只能落进当前 session 自己的 `downloads/`
  目录（文件名已消毒）；演示端（Stage）另按场景策略决定是否放行下载。

## 限制

- 只在 macOS 上验证过；其他平台未测。
- 录制上限 1920x1080、30fps 时间轴，evidence 自检按这个规格校验。
- 不是通用浏览器：没有标签页、书签或多标签 UI；人工接管窗口只有地址栏加
  后退/前进/刷新。
- 只做回环：不支持远程访问、多用户服务化，也没有审批流或远程部署。
- 隐藏模式依赖焦点仿真；`--focus-emulation=false` 时物理点击会被丢弃。
- agent 运行时一个数据目录只跑一个 daemon，每 lease 默认 4 个 session，空闲 300 秒
  回收；不做连续视频推流。
- 登录处理是自动识别加 selector 覆盖，不是按站点配置的适配层。
- 站点可能在网络层 / 人机校验层拦自动化或无头浏览器，见
  [docs/malo-web-compat.md](docs/malo-web-compat.md)。`network_capture` 只覆盖页面
  target：OOPIF（跨进程 iframe）与 Service Worker 发出的请求抓不到。
- 0.1.x 契约变更：`assert` 失败是 HTTP 200 加 `result.ok: false`，不再是 HTTP 500；
  按 500 判断的调用方必须改。

## 许可

MIT（见 [LICENSE](LICENSE)）。
