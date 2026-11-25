// 浏览器端到端测试：真实打包的 server + 官方 AppBridge 宿主 + 隔离 iframe 中的面板（读取规范 → 生成 SDK → 验证结果）；
// 然后在 Chrome 页面里直接 import 生成的 SDK（ESM），对随包附带的模拟服务器发请求，验证浏览器环境可用（含错误处理）。需要 Chrome。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHarness } from "./harness.mjs";

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "api-to-sdk-shots");
mkdirSync(shots, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), "a2s-e2e-"));
const S = process.env.API_SAMPLES ?? "/workspace/zcode-new-plugins/samples/api";
mkdirSync(join(workspace, "specs"));
copyFileSync(join(S, "harbor-bikes-api.yaml"), join(workspace, "specs/harbor-bikes-api.yaml"));
copyFileSync(join(S, "petstore3.json"), join(workspace, "specs/petstore3.json"));
const harness = await startHarness({ workspace });
const step = (t: string) => process.stdout.write(`• ${t}\n`);
let mock: ReturnType<typeof spawn> | undefined;
let web: ReturnType<typeof createServer> | undefined;
try {
  const { outer, frame, context } = await harness.open("?locale=zh-CN", { width: 1440, height: 1000 });
  step("panel: read the spec");
  await frame.locator("select.spec").selectOption("specs/harbor-bikes-api.yaml");
  await frame.locator("button.inspect").click();
  await frame.locator("tr[data-op='getReportsMonthlyCsv']", { hasText: "自动命名" }).waitFor({ timeout: 20_000 });
  step("panel: generate + verify");
  await frame.locator("input.cls").fill("HarborBikes");
  await frame.locator("button.gen").click();
  await frame.locator(".done", { hasText: "12/12" }).waitFor({ timeout: 120_000 });
  assert.equal(await frame.locator("td.res .ok").count(), 12);
  await frame.locator("pre.code", { hasText: "export class HarborBikes" }).waitFor();
  await outer.screenshot({ path: join(shots, "01-generated.png") });
  step("panel: second spec (real Petstore)");
  await frame.locator("select.spec").selectOption("specs/petstore3.json");
  await frame.locator("button.inspect").click();
  await frame.locator("tr[data-op='findPetsByStatus']").waitFor();
  await frame.locator("input.out").fill("sdk/petstore");
  await frame.locator("input.cls").fill("");
  await frame.locator("input.pkg").fill("");
  await frame.locator("button.gen").click();
  await frame.locator(".done", { hasText: "19/19" }).waitFor({ timeout: 120_000 });
  await outer.screenshot({ path: join(shots, "02-petstore.png") });

  step("browser: import the generated SDK and call the bundled mock");
  const sdk = join(workspace, "sdk/harbor-bikes-rental");
  mock = spawn(process.execPath, [join(sdk, "mock/server.mjs"), "0"], { stdio: ["ignore", "pipe", "pipe"] });
  const mockPort = await new Promise<number>((ok, fail) => { let o = ""; mock!.stdout!.on("data", (d) => { o += d; const m = /127\.0\.0\.1:(\d+)/.exec(o); if (m) ok(Number(m[1])); }); setTimeout(() => fail(new Error(o)), 10_000); });
  const page = `<!doctype html><meta charset="utf-8"><title>SDK demo</title><style>body{font:14px system-ui;margin:24px}li{margin:4px 0}.err{color:#b42318}</style><h1>Harbor Bikes SDK in the browser</h1><ul id="out"></ul>
<script type="module">
import { HarborBikes, ApiError } from "/dist/index.js";
const api = new HarborBikes({ baseUrl: "http://127.0.0.1:${mockPort}/v1", token: "demo-token" });
const out = document.getElementById("out"), li = (t, c) => { const e = document.createElement("li"); e.textContent = t; if (c) e.className = c; out.append(e); };
const page = await api.listBikes({ category: "ebike", tag: ["cargo"] });
for (const b of page.items) li(b.serial + " · " + b.model + " · " + b.frameSize);
li("next cursor: " + page.nextCursor);
const r = await api.createRental({ body: { bikeId: 7, startDate: "2026-11-24", customer: { kind: "new", fullName: "Mia Chen", email: "mia@example.com" } } });
li("rental " + r.id + " → " + r.status);
li("report: " + (await api.getReportsMonthlyCsv({ month: "2026-10" })).split("\\n")[0]);
try { await api.getBike({ bikeId: 999 }, { headers: { Prefer: "code=404" } }); } catch (e) { li((e instanceof ApiError ? "ApiError " + e.status + ": " + e.body.message : String(e)), "err"); }
document.title = "done";
</script>`;
  web = createServer((req, res) => {
    if (req.url === "/") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(page); }
    try { const body = readFileSync(join(sdk, req.url!.split("?")[0])); res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(body); } catch { res.writeHead(404); res.end(); }
  });
  const webPort = await new Promise<number>((ok) => web!.listen(0, "127.0.0.1", () => ok((web!.address() as { port: number }).port)));
  const p = await context.newPage();
  const errs: string[] = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  p.on("console", (m) => { if (m.type() === "error" && !/status of 404/.test(m.text())) errs.push(m.text()); });
  await p.setViewportSize({ width: 900, height: 420 });
  await p.goto(`http://127.0.0.1:${webPort}/`);
  await p.waitForFunction(() => document.title === "done", undefined, { timeout: 15_000 });
  await p.locator("li", { hasText: "HB-0007 · Volt Cargo" }).waitFor();
  await p.locator("li.err", { hasText: "ApiError 404: bike 999 not found" }).waitFor();
  await p.locator("li", { hasText: "report: category,rentals,revenue" }).waitFor();
  await p.screenshot({ path: join(shots, "03-sdk-in-browser.png") });
  assert.deepEqual(errs, []);
  assert.deepEqual(harness.errors, []);
  step(`ok — screenshots in ${shots}`);
} finally {
  mock?.kill();
  web?.close();
  await harness.close();
}
