// Apache-2.0. macOS browser-open stub regressions; no real browser opens.
// 自动引导（--auto / session-start 钩子 / 完成状态）测试
// 覆盖：shouldAutoOpen 判定、首次静默打开、节流、复用既有服务、失败退避、
//       打开失败可观测（真实 open stub 退出 7）与恢复、真并发只开一次、
//       完成状态仅由 /api/done（用户点完成）写入、后台 tabs pass 不写、
//       钩子脚本行为、MCP 协议纯净
// 浏览器打开用 PATH 注入的 open stub 验证真实路径（不用 ONBOARD_SHELL_DISABLED 冒充成功）；
// 隔离端口 19220-19227 与 scratch 文件
const test = require("node:test");
const testMac = (name, fn) => test(name, { skip: process.platform !== "darwin" }, fn);
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const WebSocket = require(path.join(__dirname, "..", "server", "vendor", "ws"));

const ROOT = path.join(__dirname, "..");
const onboardMod = require(path.join(ROOT, "server", "onboard.js"));
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cc-auto-test-"));
const AUTO_PORT = 19220, BR_PORT = 19221, TABS_PORT = 19223, HOOK_PORT = 19224, CONC_PORT = 19226, FAIL_PORT = 19227;
const F = {
  sessA: path.join(DIR, "a-session.json"), stateA: path.join(DIR, "a-state.json"),
  sessB: path.join(DIR, "b-session.json"), stateB: path.join(DIR, "b-state.json"),
  sessC: path.join(DIR, "c-session.json"), stateC: path.join(DIR, "c-state.json"),
  sessD: path.join(DIR, "d-session.json"), stateD: path.join(DIR, "d-state.json"),
  sessE: path.join(DIR, "e-session.json"), stateE: path.join(DIR, "e-state.json"),
  sessF: path.join(DIR, "f-session.json"), stateF: path.join(DIR, "f-state.json"),
};

// open stub：记录每次调用；OPEN_STUB_FAIL=1 时 stderr + 退出 7（复现独立实测的失败形态）
const BIN_DIR = path.join(DIR, "bin");
const OPEN_RECORD = path.join(DIR, "open-record.txt");
fs.mkdirSync(BIN_DIR);
fs.writeFileSync(path.join(BIN_DIR, "open"),
  "#!/bin/bash\nprintf '%s\\n' \"$*\" >> \"${OPEN_RECORD}\"\nif [ \"${OPEN_STUB_FAIL:-0}\" = \"1\" ]; then echo \"stub open failure\" >&2; exit 7; fi\nexit 0\n");
fs.chmodSync(path.join(BIN_DIR, "open"), 0o755);
const stubEnv = (over = {}) => ({ PATH: BIN_DIR + ":" + process.env.PATH, OPEN_RECORD, ...over });
const recordLines = () => { try { return fs.readFileSync(OPEN_RECORD, "utf8").trim().split("\n").filter(Boolean); } catch (e) { return []; } };

const baseEnv = (sess, state, over = {}) => ({
  ...process.env,
  ONBOARD_PORT: String(over.port || AUTO_PORT),
  ONBOARD_BRIDGE_URL: "http://127.0.0.1:1",
  ONBOARD_SESSION_FILE: sess,
  ONBOARD_STATE_FILE: state,
  ONBOARD_AUTO_WAIT_MS: "8000",
  ...over.env,
});

function runAuto(env) {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ["server/onboard.js", "--auto"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    c.stdout.on("data", (d) => { out += String(d); });
    c.stderr.on("data", (d) => { err += String(d); });
    const timer = setTimeout(() => { try { c.kill("SIGKILL"); } catch (e) {} reject(new Error("--auto 超时未退出")); }, 20000);
    c.on("exit", (code) => { clearTimeout(timer); resolve({ code, out: out.replace(/t=[0-9a-f]{24,}/g, "t=REDACTED"), err }); });
  });
}
function request(method, urlPath, { headers = {}, body = null, port } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}
async function waitHealth(port, ms = 10000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const r = await request("GET", "/api/health", { port }).catch(() => null);
    if (r && r.status === 200) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return null; } };
const killPid = (pid) => { try { process.kill(pid, "SIGTERM"); } catch (e) {} };
const waitAttempt = async (file, ms = 6000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const a = readJson(file);
    if (a) return a;
    await new Promise((r) => setTimeout(r, 150));
  }
  return readJson(file);
};

test.after(() => {
  for (const sess of [F.sessA, F.sessC, F.sessD, F.sessE, F.sessF]) {
    const s = readJson(sess);
    if (s && s.pid) killPid(s.pid);
  }
});

// ---------- 单元：shouldAutoOpen ----------

testMac("shouldAutoOpen：首开/完成跳过/升级不重开/展示不重开/失败退避阶梯", () => {
  const V = "9.9.9";
  const open = (reason) => ({ open: true, reason });
  assert.deepEqual(onboardMod.shouldAutoOpen({ state: null, attempt: null, version: V, now: 1000 }), open("first"));
  assert.deepEqual(onboardMod.shouldAutoOpen({ state: { completedAt: "x", version: V }, attempt: null, version: V, now: 1000 }), { open: false, reason: "completed" });
  assert.deepEqual(onboardMod.shouldAutoOpen({ state: { completedAt: "x", version: "0.0.1" }, attempt: null, version: V, now: 1000 }), { open: false, reason: "completed" });
  assert.deepEqual(onboardMod.shouldAutoOpen({ state: { autoOpenedAt: "x", version: "0.0.1" }, attempt: null, version: V, now: 1000 }), { open: false, reason: "shown" });
  const t0 = 1000000;
  assert.deepEqual(onboardMod.shouldAutoOpen({ state: null, attempt: { at: t0, failures: 0 }, version: V, now: t0 + 9 * 60 * 1000 }), { open: false, reason: "shown" });
  assert.equal(onboardMod.shouldAutoOpen({ state: null, attempt: { at: t0, failures: 0 }, version: V, now: t0 + 365 * 24 * 60 * 60 * 1000 }).open, false);
  assert.deepEqual(onboardMod.shouldAutoOpen({ state: null, attempt: { at: t0, failures: 1 }, version: V, now: t0 + 30 * 1000 }), { open: false, reason: "backoff" });
  assert.equal(onboardMod.shouldAutoOpen({ state: null, attempt: { at: t0, failures: 1 }, version: V, now: t0 + 61 * 1000 }).open, true);
  assert.equal(onboardMod.shouldAutoOpen({ state: null, attempt: { at: t0, failures: 2 }, version: V, now: t0 + 4 * 60 * 1000 }).open, false);
  assert.equal(onboardMod.shouldAutoOpen({ state: null, attempt: { at: t0, failures: 2 }, version: V, now: t0 + 6 * 60 * 1000 }).open, true);
  assert.equal(onboardMod.shouldAutoOpen({ state: null, attempt: { at: t0, failures: 9 }, version: V, now: t0 + 14 * 60 * 1000 }).open, false);
  assert.equal(onboardMod.shouldAutoOpen({ state: null, attempt: { at: t0, failures: 9 }, version: V, now: t0 + 16 * 60 * 1000 }).open, true);
});

// ---------- --auto 集成（真实 open stub） ----------

testMac("首次 --auto：静默（stdout 恒空）、真实调用 open 一次、不落完成状态", async () => {
  const r = await runAuto(baseEnv(F.sessA, F.stateA, { env: stubEnv() }));
  assert.equal(r.code, 0);
  assert.equal(r.out, "", "--auto 不得向 stdout 输出任何内容（含 URL/token）");
  assert.ok(await waitHealth(AUTO_PORT), "应拉起引导服务");
  assert.ok(readJson(F.sessA), "会话文件应写入");
  const attempt = await waitAttempt(F.sessA + ".auto-attempt.json");
  assert.equal(attempt.failures, 0);
  const lines = recordLines();
  assert.equal(lines.length, 1, "open 恰好被调用一次");
  assert.ok(lines[0].startsWith("http://127.0.0.1:" + AUTO_PORT + "/?t="), "打开的必须是本会话 URL");
  assert.ok(readJson(F.stateA).autoOpenedAt, "展示记录必须持久化");
  assert.equal(readJson(F.stateA).completedAt, undefined, "仅打开页面绝不等于引导完成");
});

testMac("展示过后：立即重启、跨十分钟、版本变化、attempt 丢失均不重开", async () => {
  const before = readJson(F.sessA + ".auto-attempt.json");
  const r = await runAuto(baseEnv(F.sessA, F.stateA, { env: stubEnv() }));
  assert.equal(r.code, 0);
  assert.equal(recordLines().length, 1, "节流窗内不得再次调用 open");
  assert.equal(readJson(F.sessA + ".auto-attempt.json").at, before.at);

  // 复现旧问题：十一分钟后仍未点完成，不能再打开。
  fs.writeFileSync(F.sessA + ".auto-attempt.json", JSON.stringify({ ...before, at: Date.now() - 11 * 60 * 1000 }));
  const pidBefore = readJson(F.sessA).pid;
  const r2 = await runAuto(baseEnv(F.sessA, F.stateA, { env: stubEnv() }));
  assert.equal(r2.code, 0);
  assert.equal(readJson(F.sessA).pid, pidBefore, "已有健康服务必须复用，不得重复拉起");
  assert.equal(recordLines().length, 1, "跨过原节流窗也不重开");
  assert.equal(readJson(F.sessA + ".auto-attempt.json").failures, 0);
  fs.unlinkSync(F.sessA + ".auto-attempt.json");
  fs.writeFileSync(F.stateA, JSON.stringify({ ...readJson(F.stateA), version: "0.0.1" }));
  await runAuto(baseEnv(F.sessA, F.stateA, { env: stubEnv() }));
  assert.equal(recordLines().length, 1, "持久展示记录跨版本/会话清理生效");
});

testMac("旧版成功记录迁移：即使已过十分钟，也不打开且不假报完成", async () => {
  const sess = path.join(DIR, "legacy-session.json"), state = path.join(DIR, "legacy-state.json");
  fs.writeFileSync(sess + ".auto-attempt.json", JSON.stringify({ at: Date.now() - 86400000, failures: 0 }));
  const before = recordLines().length;
  const r = await runAuto(baseEnv(sess, state, { env: stubEnv() }));
  assert.equal(r.code, 0);
  assert.equal(r.out, "");
  assert.equal(recordLines().length, before);
  assert.equal(readJson(sess), null, "不应启动引导服务");
  assert.ok(readJson(state).autoOpenedAt);
  assert.equal(readJson(state).completedAt, undefined);
});

testMac("已连接扩展：没有历史记录也不弹，不启动引导服务或写完成状态", async () => {
  const bridge = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, extension_connected: true }));
  });
  await new Promise((r) => bridge.listen(0, "127.0.0.1", r));
  const sess = path.join(DIR, "connected-session.json"), state = path.join(DIR, "connected-state.json");
  const before = recordLines().length;
  try {
    const r = await runAuto(baseEnv(sess, state, { env: { ...stubEnv(), ONBOARD_BRIDGE_URL: "http://127.0.0.1:" + bridge.address().port } }));
    assert.equal(r.code, 0);
    assert.equal(r.out, "");
    assert.equal(recordLines().length, before);
    assert.equal(readJson(sess), null);
    assert.equal(readJson(state), null);
  } finally { await new Promise((r) => bridge.close(r)); }
});

testMac("手动 --launch：展示过后仍可主动打开", async () => {
  const before = recordLines().length;
  const r = await new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ["server/onboard.js", "--launch"], {
      cwd: ROOT, env: baseEnv(F.sessA, F.stateA, { env: stubEnv() }), stdio: ["ignore", "ignore", "pipe"],
    });
    c.on("error", reject);
    c.on("exit", (code) => resolve(code));
  });
  assert.equal(r, 0);
  assert.equal(recordLines().length, before + 1);
  assert.equal(readJson(F.stateA).completedAt, undefined);
});

testMac("完成落盘（/api/done）：状态文件出现且版本正确；随后 --auto 秒退不再弹", async () => {
  const sess = readJson(F.sessA);
  const r = await request("POST", "/api/done", {
    port: AUTO_PORT,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + sess.token },
    body: "{}",
  });
  assert.equal(r.status, 200);
  for (let i = 0; i < 20; i++) { if (readJson(F.stateA)) break; await new Promise((r2) => setTimeout(r2, 100)); }
  const st = readJson(F.stateA);
  assert.ok(st && st.completedAt, "done 必须落完成状态");
  assert.equal(st.version, onboardMod.VERSION);
  for (let i = 0; i < 30; i++) {
    try { process.kill(sess.pid, 0); await new Promise((r2) => setTimeout(r2, 100)); }
    catch (e) { break; }
  }
  let alive = true;
  try { process.kill(sess.pid, 0); } catch (e) { alive = false; }
  assert.equal(alive, false, "done 后服务应已退出");

  const opensBefore = recordLines().length;
  const t0 = Date.now();
  const r2 = await runAuto(baseEnv(F.sessA, F.stateA, { env: stubEnv() }));
  assert.equal(r2.code, 0);
  assert.equal(r2.out, "");
  assert.ok(Date.now() - t0 < 5000, "完成后应直接跳过（无等待）");
  assert.equal(recordLines().length, opensBefore, "完成后不得再调用 open");
  assert.equal(await waitHealth(AUTO_PORT, 1200), false, "完成后不得再拉起服务");
});

testMac("服务启动失败退避：等待超时记 failures=1，立即二跑被退避跳过", async () => {
  const env = baseEnv(F.sessC, F.stateC, { port: 19225, env: { ...stubEnv(), ONBOARD_AUTO_WAIT_MS: "1" } });
  const r = await runAuto(env);
  assert.equal(r.code, 0);
  const a1 = readJson(F.sessC + ".auto-attempt.json");
  assert.equal(a1.failures, 1, "启动不健康必须记失败");
  assert.equal(readJson(F.stateC), null, "失败绝不落完成状态");
  const r2 = await runAuto(env);
  assert.equal(r2.code, 0);
  assert.equal(readJson(F.sessC + ".auto-attempt.json").at, a1.at, "退避窗内不得重试");
});

testMac("打开失败可观测（open 退出 7）：记失败进退避、不升级完成状态；恢复后成功重开", async () => {
  const env = (fail) => baseEnv(F.sessE, F.stateE, { port: FAIL_PORT, env: stubEnv({ OPEN_STUB_FAIL: fail ? "1" : "0" }) });
  const opens0 = recordLines().length;
  const r = await runAuto(env(true));
  assert.equal(r.code, 0);
  assert.equal(r.out, "", "失败也保持静默 stdout");
  assert.ok(await waitHealth(FAIL_PORT), "服务本身应已健康");
  const a1 = await waitAttempt(F.sessE + ".auto-attempt.json");
  assert.equal(a1.failures, 1, "open 失败必须记失败（不得当成功）");
  assert.equal(recordLines().length, opens0 + 1, "stub open 被真实调用过一次");
  assert.equal(readJson(F.stateE), null, "打开失败绝不升级完成状态");

  const r2 = await runAuto(env(true));
  assert.equal(r2.code, 0);
  assert.equal(readJson(F.sessE + ".auto-attempt.json").at, a1.at, "退避窗内不得重试");
  assert.equal(recordLines().length, opens0 + 1);

  // 跨过 1 分钟退避窗且 open 恢复：成功重开并清零 failures
  fs.writeFileSync(F.sessE + ".auto-attempt.json", JSON.stringify({ at: Date.now() - 61 * 1000, failures: 1 }));
  const r3 = await runAuto(env(false));
  assert.equal(r3.code, 0);
  const a3 = readJson(F.sessE + ".auto-attempt.json");
  assert.equal(a3.failures, 0, "恢复成功后退避计数清零");
  assert.equal(recordLines().length, opens0 + 2);
});

testMac("真并发：同时启动 4 个 --auto，open 动作恰好一次", async () => {
  const env = baseEnv(F.sessD, F.stateD, { port: CONC_PORT, env: stubEnv() });
  const opens0 = recordLines().length;
  const rs = await Promise.all([runAuto(env), runAuto(env), runAuto(env), runAuto(env)]);
  for (const r of rs) {
    assert.equal(r.code, 0);
    assert.equal(r.out, "", "所有并发实例 stdout 恒空");
  }
  assert.ok(await waitHealth(CONC_PORT), "应拉起唯一引导服务");
  const attempt = await waitAttempt(F.sessD + ".auto-attempt.json");
  assert.equal(attempt.failures, 0);
  assert.equal(recordLines().length, opens0 + 1, "并发下浏览器打开动作必须恰好一次（锁内重判生效）");
  assert.ok(readJson(F.stateD).autoOpenedAt);
  assert.equal(readJson(F.stateD).completedAt, undefined, "并发打开也不落完成状态");
});

// ---------- 完成语义：后台连接健康不等于用户完成 ----------

testMac("后台 tabs pass 不落完成状态；只有 /api/done（用户点完成）才写", async (t) => {
  const br = spawn(process.execPath, ["server/bridge.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(BR_PORT), CRX_DIR: "/nonexistent-crx-for-test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  br.stdout.on("data", () => {}); br.stderr.on("data", () => {});
  const onb = spawn(process.execPath, ["server/onboard.js"], {
    cwd: ROOT,
    env: { ...process.env, ONBOARD_PORT: String(TABS_PORT), ONBOARD_BRIDGE_URL: "http://127.0.0.1:" + BR_PORT, ONBOARD_SESSION_FILE: F.sessB, ONBOARD_STATE_FILE: F.stateB, ONBOARD_SHELL_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  onb.stdout.on("data", () => {}); onb.stderr.on("data", () => {});
  t.after(() => { br.kill("SIGTERM"); onb.kill("SIGTERM"); });
  const brReady = await (async () => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const r = await request("GET", "/status", { port: BR_PORT }).catch(() => null);
      if (r && r.status === 200) return true;
      await new Promise((r2) => setTimeout(r2, 150));
    }
    return false;
  })();
  assert.ok(brReady, "隔离 bridge 未启动");
  const ext = new WebSocket("ws://127.0.0.1:" + BR_PORT + "/ws", { origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  t.after(() => { try { ext.close(); } catch (e) {} });
  ext.on("message", (d) => {
    const msg = JSON.parse(String(d));
    if (msg.type !== "result" && msg.id != null)
      ext.send(JSON.stringify({ type: "result", id: msg.id, ok: true, result: { tabs: [{ tab_id: 1, title: "私密", url: "https://secret.example" }] } }));
  });
  await new Promise((res, rej) => { ext.on("open", res); ext.on("error", rej); });
  assert.ok(await waitHealth(TABS_PORT), "引导服务未启动");
  const sess = readJson(F.sessB);
  const r = await request("GET", "/api/status?fresh=1", { port: TABS_PORT, headers: { Authorization: "Bearer " + sess.token } });
  assert.equal(JSON.parse(r.body).tabs.state, "pass");
  await new Promise((r2) => setTimeout(r2, 400));
  assert.equal(readJson(F.stateB), null, "后台 tabs pass 不是用户引导完成，绝不写完成状态");

  const done = await request("POST", "/api/done", { port: TABS_PORT, headers: { "Content-Type": "application/json", Authorization: "Bearer " + sess.token }, body: "{}" });
  assert.equal(done.status, 200);
  for (let i = 0; i < 20; i++) { if (readJson(F.stateB)) break; await new Promise((r2) => setTimeout(r2, 100)); }
  const st = readJson(F.stateB);
  assert.ok(st && st.completedAt && st.version === onboardMod.VERSION, "只有用户明确完成（/api/done）才写完成状态");
});

// ---------- MCP 协议纯净 ----------

testMac("mcp-stdio 不受自动引导影响：stdout 每行均为合法 JSON-RPC，无引导/URL 噪声", async () => {
  const c = spawn(process.execPath, ["server/mcp-stdio.js"], {
    cwd: ROOT,
    env: { ...process.env, BRIDGE_URL: "http://127.0.0.1:1", BB_AUTO_ENSURE: "0" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "", err = "";
  c.stdout.on("data", (d) => { out += String(d); });
  c.stderr.on("data", (d) => { err += String(d); });
  await new Promise((r) => setTimeout(r, 300));
  c.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) + "\n");
  c.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  c.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
  await new Promise((r) => setTimeout(r, 600));
  c.stdin.end();
  const code = await Promise.race([
    new Promise((res) => c.on("exit", (cc) => res(cc))),
    new Promise((res) => setTimeout(() => res("timeout"), 4000)),
  ]);
  assert.equal(code, 0, "mcp-stdio 应正常退出");
  const lines = out.trim().split("\n").filter(Boolean);
  assert.ok(lines.length >= 2, "应收到 initialize 与 tools/list 响应");
  let init = null, tools = null;
  for (const l of lines) {
    const j = JSON.parse(l);
    assert.equal(j.jsonrpc, "2.0");
    if (j.id === 1) init = j;
    if (j.id === 2) tools = j;
  }
  assert.equal(init.result.serverInfo.name, "cc-browser-bridge");
  assert.ok(tools.result.tools.length > 0);
  assert.ok(!out.includes("onboard"), "stdout 不得混入引导噪声");
  assert.ok(!out.includes("http://127.0.0.1:87"), "stdout 不得混入 URL");
});
