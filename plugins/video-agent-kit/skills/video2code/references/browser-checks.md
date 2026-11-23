# 页面检查：ZCode 内置浏览器

预览和参考站点的打开、读取、截图、交互、录像都走 **ZCode 内置浏览器**（Browser Use，IAB），由
`mcp__node_repl__js` 驱动，规则以官方 `control-browser` skill 为准（先加载它）。不要安装/启动
Playwright、Chrome/Chromium，不要用 shell `open`，不要在有内置浏览器时用 `browser_capture`。

## 1. 每次 JS 调用都要 bootstrap

每个 `js` 调用是新 kernel，变量不保留；每次都先执行：

```js
const browserPluginRoot = process.env.ZCODE_PLUGIN_ROOT;
if (!browserPluginRoot) throw new Error("Browser plugin root is unavailable in the node_repl host");
const { join } = await import("node:path");
const { pathToFileURL } = await import("node:url");
const { setupBrowserRuntime } = await import(
  pathToFileURL(join(browserPluginRoot, "scripts", "browser-client.mjs")).href);
await setupBrowserRuntime({ globals: globalThis });
const browser = await agent.browsers.get("iab");
```

第一次调用再加 `nodeRepl.write(await browser.documentation());`，完整读一遍 API 说明，之后不必重复。

## 2. 打开预览 / 参考站

```js
const tab = await browser.tabs.new();                 // 会把 IAB 面板带到前台
await tab.goto("http://localhost:PORT/");             // deploy_website 返回的 url，或参考站 URL
await tab.playwright.waitForLoadState({ state: "domcontentloaded" });
({ url: await tab.url(), title: await tab.title() });
```

之后的调用先 `await browser.tabs.list()` 让模型看到全部 tab，再在下一次调用里按核验过的 id
`browser.tabs.get(id)`，重新部署后 `await tab.reload()`。一个站点只开一个 tab。

## 3. 读结构、定位、字体

- `await tab.playwright.domSnapshot()` 读 ARIA 树；locator 只从 snapshot 事实构造
  (`getByRole/getByText/getByTestId`、`[data-testid="..."]`)，不猜选择器，不用 `:nth-child()`。
- 字体：`await tab.playwright.evaluate("document.fonts.check('16px Fira Sans')")`。
- 构建里可用的 `data-testid` 在 `deploy_website` 的回执里列出。

## 4. 截图（静态/终态）

```js
await tab.setViewportSize({ width: 1280, height: 800 });   // 需要响应式状态时
await tab.playwright.getByTestId("hero-cta").hover();       // 或 tab.cua.move({x, y})
await tab.playwright.waitForTimeout(300);                   // 等过渡结束再截
nodeRepl.emitImage(await tab.screenshot());
```

截图必须在同一个调用里 `nodeRepl.emitImage(...)`。要落盘做对照时，把返回的字节写到
`out/<name>.png`（API 若提供 `{ path }` 直接用）。静帧只证明终态，不证明速度。

## 5. 录像（动效、滚动/指针耦合）

```js
const job = await tab.recording.start({
  viewport: { width: 1280, height: 800 }, fps: 25, maxDurationMs: 12000,
  settleMs: 1000, showCursor: true,
  actions: [
    { type: "scrollTo", selector: "[data-testid=features]", durationMs: 800, delayAfterMs: 800 },
    { type: "scroll", deltaY: 600, durationMs: 700 },
    { type: "move", x: 300, y: 400, durationMs: 500 },
    { type: "hover", selector: "[data-testid=card-1]", durationMs: 500, delayAfterMs: 1200 },
  ],
});
job.id;
```

保存 `job.id`；在新的调用里恢复同一个 tab 后轮询，只有最后一次传 `outputPath`：

```js
await tab.recording.status(id, { outputPath: "out/rec/features.webm" });
```

`completed` 时记下 `artifact.path`、`durationMs`、`frameCount`。驱动输入（scroll/move/hover/click）
必须放在 `actions` 里；只有 `wait` 的录像不能当动效证据。先读回执里的动作轨迹（每步是否执行、目标是否
在视口内、`@t`），轨迹不合格就修动作重录，不要分析已被轨迹否定的帧。

ZCode 只输出 WebM。抽帧前先转 MP4（保留 `.webm` 作原始证据）：

```bash
ffmpeg -y -i out/rec/features.webm -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -r 25 -an out/rec/features.mp4
ffprobe -v error -show_entries format=duration -show_entries stream=codec_name,nb_frames -of default=noprint_wrappers=1 out/rec/features.mp4
```

然后用 `python3 <plugin_root>/skills/video2code/scripts/still.py` 抽帧、`composite.py` 拼 SRC|REP，
或 `video_observe` / `video_compare` 工具。帧时间以录像自身时间轴为准；墙钟不是源片时间。

## 6. 简单对照

```python
from PIL import Image
left, right = Image.open('out/source.png'), Image.open('out/check.png')
result = Image.new('RGB', (left.width + right.width, max(left.height, right.height)))
result.paste(left, (0, 0)); result.paste(right, (left.width, 0))
result.save('out/compare.png')
```

先确认双方是可比时间/状态和区域。控制台错误、失败请求和 HTTP 状态与画面差异分别记录。

## 附：托管运行时（仅 harness）

只有工作区存在 `.v2c/runtime/endpoint.json`（任务级托管服务）时，`runtime` MCP 才会提供
`preview_build` / `browser_capture`。那条路径的动作脚本是工作区内的 Python 文件
（`async def run(page)`），`browser_capture(kind='record', duration=..., interval=...)` 录像后再抽帧。
在 ZCode 桌面端这两个工具不会出现；缺失时如实报告，不要当作视觉结论。
