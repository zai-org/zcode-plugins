# malo-browser 真实站点兼容性调研

日期：2026-11-03；范围：无头 session、单页顶层加载、每站一次、不重试、不登录、不处理验证码。

## 结论

- 12 个代表性站点（静态页、SPA、搜索、电商、视频、WebGL、地图库）中 9 个能正常加载并观察；
  1 个是登录墙，1 个是网络层不可达，1 个是站点侧 HTTP 403 + 人机校验。
- 异步页面必须等 DOM/网络稳定，不能只等 `load`；JS challenge 不一定是拦截，可能只是二次导航。
- 登录墙、滑块/验证码、IP 级反爬必须显式识别（`login-wall` / `challenge` / `network-error`），
  不能伪装成功。

## 复现

```bash
python3 -m http.server 4788 --bind 127.0.0.1 --directory out/fixture
npm run daemon

MALO_BROKER_FILE=~/.malo-browser/broker.json \
MALO_PROBE_INTERVAL_MS=8000 \
MALO_PROBE_TIMEOUT_MS=25000 \
node scripts/malo-web-probe.mjs
```

## 关键发现

### 1. “加载完成”不等于“页面稳定”

`document.readyState === "complete"` 只说明主文档和同步资源到了，不保证 SPA 的异步数据已渲染、
challenge 已二次跳转、地图/表格/列表已填充。malo-browser 同时看
`Page.lifecycleEvent` 的 `networkAlmostIdle`、URL 与 DOM 元素数的稳定采样、challenge URL 的额外
等待，以及最终 `navigation.settle` 诊断。

### 2. JS challenge 不是统一按“反爬失败”处理

Reddit 的 URL 带 `js_challenge=1` / `jsc_token`，等待后页面正常渲染；只看 URL 或首屏 DOM 会误判。
当前策略：challenge URL + DOM 仍很小则继续等到 `settle_ms`；DOM 已丰富按正常页面返回；超时仍无
内容按 partial/timeout 返回，不伪装成功。

### 3. 网络失败和站点反爬要分开

OpenStreetMap 的 `ERR_CONNECTION_TIMED_OUT` 是本机网络不可达，现放在
`error.details.navigation.net_error`；NYT 的 403 + 滑块是站点侧挑战。前者查出口/DNS/代理，后者
停止自动重试，转人工 `watch` / 登录态 session / 白名单站点。

UA 不写死：它随 Electron 版本变化，以真机 `observe` 的 `runtime.user_agent` / `webdriver` 为准；
malo-browser 不做 UA 伪装。

## 不做

- 不伪造 `navigator.webdriver`
- 不伪造 UA 绕过站点策略
- 不自动破解滑块、验证码或登录
- 不把挑战页、空白页或 403 当成成功
- 不对同一站点高频重试
