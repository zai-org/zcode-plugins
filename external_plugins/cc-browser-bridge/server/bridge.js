// Claude API Browser Bridge — 本地桥接服务
// 职责：
//   1. WebSocket 服务端：接收 Chrome 扩展长连接，转发工具命令/结果
//   2. HTTP /tool：原生工具接口（自写脚本用）
//   3. HTTP /mcp：MCP streamable HTTP（Claude Code 等用，stateless 实现）
// 只监听 127.0.0.1，不暴露公网。

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("./vendor/ws");
const { TOOLS, planFor, shapeResult } = require("./tools");

const PORT = Number(process.env.PORT || 8765);
const HOST = "127.0.0.1";
const EXT_TIMEOUT_MS = 60000;

// ---------- 本机信任边界 ----------
// HTTP/WS 端点只服务本机进程（curl、MCP 客户端、stdio 转发），这类客户端：
//   - 不发送 Origin 头（浏览器才发）；带上 Origin（含 "null"）的一律视为网页来源，拒绝；
//   - Host 是 127.0.0.1/localhost + 当前端口，防止 DNS 重绑定（外部域名解析到 127.0.0.1 后
//     浏览器发的 Host 仍是该域名，不匹配即拒绝）；
//   - POST 正文只接受 application/json，拒绝 text/plain 等跨站简单请求可伪造的类型；
//   - 不返回任何 CORS 授权头，浏览器页面即使能访问端口也读不到响应。
// 需要放行额外本机 Host 时，用环境变量追加：BRIDGE_ALLOWED_HOSTS=foo.test:8765
const ALLOWED_HOSTS = new Set(
  [`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]
    .concat(PORT === 80 ? ["127.0.0.1", "localhost", "[::1]"] : [])
    .concat(String(process.env.BRIDGE_ALLOWED_HOSTS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))
);

function hostTrusted(req) {
  return ALLOWED_HOSTS.has(String(req.headers.host || "").toLowerCase());
}

function originTrusted(req) {
  const o = req.headers.origin;
  // 本机非浏览器客户端（curl/Node/Python）不发 Origin；浏览器来源（含 "null"）一律拒绝
  return o === undefined || String(o) === "";
}

function contentTypeJson(req) {
  const ct = String(req.headers["content-type"] || "").trim();
  if (ct === "") return true; // 不带 Content-Type 的本机裸 POST 仍允许
  return /^application\/json\b/i.test(ct);
}

function deny(res, status, msg) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ ok: false, error: msg }));
}
const SERVER_INFO = { name: "cc-browser-bridge", version: "0.1.0" };
const SUPPORTED_PROTOCOLS = ["2024-11-05", "2025-03-26", "2025-06-18"];
const INSTRUCTIONS =
  "通过这套工具可以查看和控制用户当前使用的 Chrome 浏览器（保留用户登录态）。" +
  "推荐流程：browser_tabs list → browser_navigate → browser_snapshot（拿 ref）→ browser_click/browser_type；" +
  "需要看视觉布局时用 browser_screenshot，其返回的截图坐标可直接用于 browser_click 的 x/y。";

// ---------- 扩展连接与命令路由 ----------
let extWs = null; // 当前扩展连接（只支持一个）
const pending = new Map(); // id -> {resolve, reject, timer}

function extConnected() {
  return !!(extWs && extWs.readyState === 1);
}

function extCall(tool, args) {
  return new Promise((resolve, reject) => {
    if (!extConnected()) {
      reject(new Error("Chrome 扩展未连接：请确认 ① server/bridge.js 已在运行 ② Chrome 扩展已加载并启用 ③ 扩展图标角标显示 ●（未连接时点开扩展 popup 查看原因）"));
      return;
    }
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("扩展执行超时（60s）：" + tool));
    }, EXT_TIMEOUT_MS);
    pending.set(id, {
      resolve: (r) => { clearTimeout(timer); resolve(r); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    extWs.send(JSON.stringify({ id, tool, args: args || {} }));
  });
}

function extDropPending(reason) {
  for (const [, p] of pending) p.reject(new Error(reason));
  pending.clear();
}

function initWs(server) {
  const wss = new WebSocketServer({ server, path: "/ws", host: HOST });
  wss.on("connection", (ws, req) => {
    if (!hostTrusted(req)) {
      ws.close(4003, "forbidden host");
      return;
    }
    const origin = String(req.headers.origin || "");
    // 只放行标准扩展来源 chrome-extension://<32位id>（不硬编码具体 id，未打包扩展也能连）：
    // 结构化校验排除网页（http/https/file 等）、空 Origin 和畸形值。
    // 注意这只是来源边界检查，不是扩展身份认证（本机任何扩展理论上都能连）。
    if (!/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {
      ws.close(4003, "forbidden origin");
      return;
    }
    if (extWs && extWs !== ws) {
      // 新连接顶替旧连接（扩展重载场景）；旧连接的在途命令不再可能有结果，直接拒绝让调用方重试
      try { extWs.close(4000, "replaced"); } catch (e) {}
      extDropPending("扩展连接已被新连接替换，请重试");
    }
    extWs = ws;
    log("扩展已连接 origin=" + origin);
    ws.on("message", (data) => {
      let msg;
      try { msg = JSON.parse(String(data)); } catch (e) { return; }
      if (msg.type === "hello") {
        log("扩展 hello version=" + msg.version);
        return;
      }
      if (msg.type === "ping") { ws.send(JSON.stringify({ type: "pong" })); return; }
      if (msg.type === "result" && msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(String(msg.error || "扩展执行失败")));
      }
    });
    ws.on("close", () => {
      // 只有当前连接断开才清空在途命令；被替换的旧连接关闭时不得误伤新连接的 pending
      if (extWs === ws) {
        extWs = null;
        extDropPending("扩展连接已断开，请检查 Chrome 扩展后重试");
        log("扩展已断开");
      }
    });
    ws.on("error", () => {});
  });
}

// ---------- 工具分发 ----------
async function dispatch(name, args) {
  if (!TOOLS.some((t) => t.name === name))
    return { isError: true, content: [{ type: "text", text: "未知工具: " + name }] };

  let plan;
  try { plan = planFor(name, args); }
  catch (e) { return { isError: true, content: [{ type: "text", text: String(e.message || e) }] }; }

  try {
    if (plan.sleep != null) {
      await new Promise((r) => setTimeout(r, plan.sleep));
      return { content: [{ type: "text", text: "已等待 " + plan.sleep + "ms" }] };
    }
    const r = await extCall(plan.ext, plan.args);
    return shapeResult(plan.ext, r);
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: String(e.message || e) }] };
  }
}

// ---------- HTTP ----------
function readBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = (req.url || "/").split("?")[0].replace(/\/{2,}/g, "/");

  if (!hostTrusted(req)) {
    deny(res, 403, "不可信的 Host（本服务仅限 127.0.0.1/localhost 本机调用，防 DNS 重绑定）");
    return;
  }
  if (!originTrusted(req)) {
    deny(res, 403, "不可信的 Origin（本服务仅限本机进程调用，不接受网页来源）");
    return;
  }

  if (req.method === "OPTIONS") {
    // 预检同样先过了上面的 Host/Origin 检查；从不返回 Access-Control-Allow-Origin
    // （本服务没有浏览器客户端，任何网页来源都读不到响应）
    res.writeHead(204, {
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && (url === "/" || url === "/status")) {
    sendJson(res, 200, {
      ok: true,
      service: SERVER_INFO,
      extension_connected: extConnected(),
      tools: TOOLS.map((t) => t.name),
    });
    return;
  }

  if (req.method === "POST" && url === "/tool") {
    try {
      if (!contentTypeJson(req)) { deny(res, 415, "Content-Type 必须是 application/json"); return; }
      const body = JSON.parse(await readBody(req) || "{}");
      const name = body.tool || body.name;
      const args = body.arguments || body.args || {};
      if (!name) { sendJson(res, 400, { ok: false, error: "缺少 tool 名称" }); return; }
      const result = await dispatch(name, args);
      sendJson(res, 200, { ok: !result.isError, result });
    } catch (e) {
      sendJson(res, 400, { ok: false, error: String(e.message || e) });
    }
    return;
  }

  if (req.method === "POST" && url === "/mcp") {
    try {
      if (!contentTypeJson(req)) { deny(res, 415, "Content-Type 必须是 application/json"); return; }
      const body = JSON.parse(await readBody(req) || "null");
      const out = await handleMcp(body, req);
      if (out === null) { res.writeHead(202); res.end(); return; } // 通知：无需响应
      sendJson(res, 200, out);
    } catch (e) {
      sendJson(res, 200, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error: " + (e.message || e) } });
    }
    return;
  }

  if (req.method === "GET" && url === "/crx/extension.crx") {
    log("CRX 分发：Chrome 拉取 extension.crx（UA: " + String(req.headers["user-agent"] || "?").slice(0, 60) + "）");
    const f = path.join(CRX_DIR, "extension.crx");
    fs.readFile(f, (err, data) => {
      if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("crx not packed"); return; }
      res.writeHead(200, { "Content-Type": "application/x-chrome-extension", "Content-Length": data.length });
      res.end(data);
    });
    return;
  }

  if (req.method === "GET" && url === "/crx/updates.xml") {
    log("CRX 分发：Chrome 拉取 updates.xml（UA: " + String(req.headers["user-agent"] || "?").slice(0, 60) + "）");
    if (!crxMeta) { res.writeHead(404); res.end("no crx meta"); return; }
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">\n' +
      '  <app appid="' + crxMeta.id + '">\n' +
      '    <updatecheck codebase="http://127.0.0.1:' + PORT + '/crx/extension.crx" version="' + crxMeta.version + '" />\n' +
      '  </app>\n' +
      '</gupdate>\n';
    res.writeHead(200, { "Content-Type": "application/xml" });
    res.end(xml);
    return;
  }

  if (url === "/mcp") {
    res.writeHead(405, { "Content-Type": "application/json", "Allow": "POST, OPTIONS" });
    res.end(JSON.stringify({ error: "MCP over HTTP 仅支持 POST（streamable, stateless）" }));
    return;
  }

  sendJson(res, 404, { ok: false, error: "not found" });
});

// ---------- MCP（最小 JSON-RPC 实现，stateless streamable HTTP） ----------
async function handleMcp(body, req) {
  if (Array.isArray(body)) {
    const results = [];
    for (const item of body) {
      const r = await handleMcp(item, req); // 逐个处理（无批量工具并发场景）
      if (r !== null) results.push(r);
    }
    return results.length ? results : null;
  }
  if (!body || typeof body !== "object" || body.jsonrpc !== "2.0")
    return { jsonrpc: "2.0", id: body && body.id != null ? body.id : null, error: { code: -32600, message: "Invalid Request" } };

  const { id, method, params } = body;
  const isNotification = id === undefined || id === null;
  const reply = (result) => (isNotification ? null : { jsonrpc: "2.0", id, result });
  const replyErr = (code, message) =>
    isNotification ? null : { jsonrpc: "2.0", id, error: { code, message } };

  switch (method) {
    case "initialize": {
      const want = params && params.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOLS.includes(want) ? want : "2025-06-18";
      return reply({
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "notifications/initialized":
    case "notifications/cancelled":
    case "notifications/roots/list_changed":
      return null;
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
    case "tools/call": {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      if (!name) return replyErr(-32602, "params.name 必填");
      const result = await dispatch(name, args);
      return reply(result);
    }
    case "resources/list":
      return reply({ resources: [] });
    case "prompts/list":
      return reply({ prompts: [] });
    default:
      return replyErr(-32601, "Method not found: " + method);
  }
}

// ---------- CRX 分发（企业策略 ExtensionInstallForcelist 静默安装用） ----------
const CRX_DIR = process.env.CRX_DIR || path.join(__dirname, "..", "crx");
const crxMeta = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(CRX_DIR, "meta.json"), "utf8")); }
  catch (e) { return null; }
})();

// ---------- 启动 ----------
initWs(server);
server.listen(PORT, HOST, () => {
  log(`桥接服务已启动: http://${HOST}:${PORT}  (MCP: /mcp, 工具: /tool, 扩展: ws://${HOST}:${PORT}/ws)`);
  log("等待 Chrome 扩展连接…");
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`端口 ${PORT} 已被占用：可能 bridge.js 已在运行，或修改 PORT 环境变量。`);
  } else console.error(e);
  process.exit(1);
});

function log(msg) {
  console.log("[" + new Date().toLocaleTimeString() + "] " + msg);
}
