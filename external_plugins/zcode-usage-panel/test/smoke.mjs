// 冒烟测试：用系统 Node 启动发布产物 server bundle，
// 走完整 MCP JSON-RPC 链路：initialize → list → read(ui + auto + pinned) → subscribe → updated → unsubscribe
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// NODE_BIN / SERVER_PATH 可覆盖运行时与产物路径：默认系统 node + payload/dist 下的发布产物。
const HELPER = process.env.NODE_BIN ?? "node"; // 需 Node.js >= 24（node:sqlite）
const SERVER = process.env.SERVER_PATH ? resolve(process.env.SERVER_PATH) : resolve(root, "payload/dist/server.mjs");

const child = spawn(HELPER, [SERVER], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_NO_WARNINGS: "1" },
  stdio: ["pipe", "pipe", "pipe"],
});
child.stderr.on("data", (d) => process.stderr.write(`[server-stderr] ${d}`));

let nextId = 1;
const pending = new Map();
const notifications = [];
let buf = "";
child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method) {
      notifications.push(msg);
    }
  }
});

function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`超时: ${method}`)), 15000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      if (msg.error) reject(new Error(`${method} 失败: ${JSON.stringify(msg.error)}`));
      else resolvePromise(msg.result);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

const assert = (cond, label) => {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${label}`);
  if (!cond) process.exitCode = 1;
};

try {
  const init = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: { resources: { subscribe: true } },
    clientInfo: { name: "smoke", version: "0.0.0" },
  });
  assert(init.serverInfo?.name === "zcode-usage-panel", `initialize 返回 serverInfo (${init.serverInfo?.name})`);
  assert(init.capabilities?.resources?.subscribe === true, "server 声明 resources.subscribe 能力");
  notify("notifications/initialized", {});

  const list = await rpc("resources/list", {});
  const uris = list.resources.map((r) => r.uri);
  assert(uris.includes("ui://zcode-usage-panel/index.html"), "resources/list 含面板 HTML");
  assert(uris.includes("usage://current"), "resources/list 含 usage://current");
  assert(list.resources.some((r) => r.uri === "usage://current" && r.mimeType === "application/json"), "mimeType 正确");

  const panel = await rpc("resources/read", { uri: "ui://zcode-usage-panel/index.html" });
  const html = panel.contents[0].text;
  assert(html.startsWith("<!DOCTYPE html>"), `面板 HTML 可读 (${(html.length / 1024).toFixed(0)}KB)`);
  assert(panel.contents[0].mimeType?.includes("text/html"), "面板 MIME 为 text/html;profile=mcp-app");

  const auto = await rpc("resources/read", { uri: "usage://current" });
  const snap = JSON.parse(auto.contents[0].text);
  assert(Array.isArray(snap.sessions) && snap.sessions.length > 0, `usage://current 返回 ${snap.sessions.length} 个会话`);
  assert(snap.totals !== null && typeof snap.totals.modelCalls === "number", `汇总字段在 (模型调用 ${snap.totals?.modelCalls})`);
  assert(snap.mode === "auto" && snap.session, `自动模式解析到会话 ${snap.session?.id?.slice(0, 18)}…`);
  console.log(`  · 会话「${snap.session?.title?.slice(0, 30)}」 总tokens=${snap.totals.totalTokens} 输出=${snap.totals.outputTokens} 工具种类=${snap.tools.length} 模型=${snap.models.length} 轮次=${snap.turns.length} TPS均值=${snap.totals.avgTpsGen?.toFixed(1)}`);

  const pinned = await rpc("resources/read", { uri: `usage://session/${snap.session.id}` });
  const snap2 = JSON.parse(pinned.contents[0].text);
  assert(snap2.mode === "pinned" && snap2.session?.id === snap.session.id, "usage://session/{id} 固定会话读取");

  const promptRes = await rpc("resources/read", { uri: `usage://prompt/${snap.session.id}` });
  const comp = JSON.parse(promptRes.contents[0].text);
  assert(Array.isArray(comp.skills) && comp.skills.length > 0, `提示词构成返回技能分组 (${comp.skills.length} 组)`);
  assert(comp.skillTotals.listChars > 0, `清单常驻估算有值 (≈${Math.round(comp.skillTotals.listChars / 3.2)} tok)`);
  console.log(`  · 技能合计 ${comp.skillTotals.injected} 个 / 清单常驻 ≈${Math.round(comp.skillTotals.listChars / 3.2)} tok / MCP ${comp.mcpServers.length} 个 / AGENTS.md ${comp.agentsMd.length} 个 / 真实注入记录 ${comp.injected ? "命中" : "无(已滚动)"}`);

  const sub = await rpc("resources/subscribe", { uri: "usage://current" });
  assert(sub && typeof sub === "object", "resources/subscribe 成功");

  // DB 正被当前 ZCode 会话持续写入，8s 内应能观察到 updated 通知（机会性断言）
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && !notifications.some((n) => n.method === "notifications/resources/updated")) {
    await new Promise((r) => setTimeout(r, 300));
  }
  const gotUpdated = notifications.some((n) => n.method === "notifications/resources/updated");
  console.log(`${gotUpdated ? "✓" : "⚠ 未触发(库静止，非失败)"} 收到 notifications/resources/updated`);

  const unsub = await rpc("resources/unsubscribe", { uri: "usage://current" });
  assert(unsub && typeof unsub === "object", "resources/unsubscribe 成功");
} catch (e) {
  console.error("✗ 冒烟测试异常:", e.message ?? e);
  process.exitCode = 1;
} finally {
  child.kill();
}

// ---------- 阶段 2：隔离假库，确定性验证 updated 通知链路 ----------
try {
  const { DatabaseSync } = await import("node:sqlite");
  const { rmSync } = await import("node:fs");
  const fake = resolve(root, "test/.tmp-fake.sqlite");
  rmSync(fake, { force: true });
  const fdb = new DatabaseSync(fake);
  fdb.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER, task_type TEXT, parent_id TEXT);
    CREATE TABLE model_usage (id INTEGER PRIMARY KEY, session_id TEXT, status TEXT, duration_ms INTEGER, time_to_first_token_ms INTEGER, started_at INTEGER,
      input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER, cache_read_input_tokens INTEGER, cache_creation_input_tokens INTEGER, computed_total_tokens INTEGER,
      model_id TEXT, agent TEXT, query_source TEXT);
    CREATE TABLE tool_usage (id INTEGER PRIMARY KEY, session_id TEXT, tool_name TEXT, tool_call_id TEXT, status TEXT, duration_ms INTEGER, started_at INTEGER, output_bytes INTEGER);
    CREATE TABLE turn_usage (session_id TEXT, turn_id TEXT, status TEXT, started_at INTEGER, duration_ms INTEGER, output_tokens INTEGER, computed_total_tokens INTEGER, model_request_count INTEGER, tool_call_count INTEGER);
    INSERT INTO session VALUES ('sess_fake', '假会话', '/tmp', 1, 2, 'interactive', NULL);
    INSERT INTO session VALUES ('sess_fake_child', '子代理', '/tmp', 1, 2, 'subagent_child', 'sess_fake');
    INSERT INTO model_usage (session_id, status, duration_ms, time_to_first_token_ms, started_at, output_tokens, computed_total_tokens, model_id, query_source)
      VALUES ('sess_fake', 'completed', 1000, 100, 1, 50, 500, 'FAKE', 'main_turn');
    INSERT INTO model_usage (session_id, status, duration_ms, time_to_first_token_ms, started_at, output_tokens, computed_total_tokens, model_id, agent, query_source)
      VALUES ('sess_fake_child', 'completed', 900, 90, 2, 40, 400, 'FAKE', 'zcode-Explore', 'subagent');
  `);
  fdb.close();

  const child2 = spawn(HELPER, [SERVER], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_NO_WARNINGS: "1", ZCODE_USAGE_DB_PATH: fake },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const pending2 = new Map();
  const notifications2 = [];
  let buf2 = "";
  let id2 = 100;
  child2.stdout.on("data", (chunk) => {
    buf2 += chunk.toString("utf8");
    let idx;
    while ((idx = buf2.indexOf("\n")) >= 0) {
      const line = buf2.slice(0, idx).trim();
      buf2 = buf2.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending2.has(msg.id)) {
        pending2.get(msg.id)(msg);
        pending2.delete(msg.id);
      } else if (msg.method) notifications2.push(msg);
    }
  });
  const rpc2 = (method, params) =>
    new Promise((res, rej) => {
      const id = id2++;
      const t = setTimeout(() => rej(new Error(`超时: ${method}`)), 10000);
      pending2.set(id, (msg) => {
        clearTimeout(t);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      });
      child2.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });

  await rpc2("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke2", version: "0.0.0" },
  });
  child2.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  await rpc2("resources/subscribe", { uri: "usage://current" });
  await new Promise((r) => setTimeout(r, 1600)); // 等 watcher 建立基线

  const wdb = new DatabaseSync(fake);
  wdb.exec(`INSERT INTO model_usage (session_id, status, duration_ms, time_to_first_token_ms, started_at, output_tokens, computed_total_tokens, model_id, query_source)
            VALUES ('sess_fake', 'completed', 900, 90, 2, 40, 400, 'FAKE', 'main_turn')`);
  wdb.close();

  const deadline2 = Date.now() + 3500;
  while (Date.now() < deadline2 && !notifications2.some((n) => n.method === "notifications/resources/updated")) {
    await new Promise((r) => setTimeout(r, 200));
  }
  const upd = notifications2.find((n) => n.method === "notifications/resources/updated");
  assert(Boolean(upd) && upd.params.uri === "usage://current", "DB 变更 → 收到 notifications/resources/updated（确定性）");

  const snapAfter = await rpc2("resources/read", { uri: "usage://current" });
  const s2 = JSON.parse(snapAfter.contents[0].text);
  // 初始 2 次（主+子）+ 新插入 1 次 = 3，验证子会话(parent_id)并入统计
  assert(s2.totals?.modelCalls === 3, `子会话并入统计 (模型调用=${s2.totals?.modelCalls}，应为 3)`);
  assert(s2.childSessionCount === 1, `子会话数标记 (${s2.childSessionCount})`);
  assert(s2.models.some((m) => m.source === "subagent" && m.calls >= 1), "模型明细含子代理来源行");

  child2.kill();
  rmSync(fake, { force: true });
} catch (e) {
  console.error("✗ 阶段2异常:", e.message ?? e);
  process.exitCode = 1;
}

process.on("exit", () => child.kill());
