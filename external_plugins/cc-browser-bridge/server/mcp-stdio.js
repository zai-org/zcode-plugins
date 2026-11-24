#!/usr/bin/env node
// Claude API Browser Bridge — MCP stdio 入口（Claude Desktop / 其他 stdio MCP 客户端用）
// 用法：node mcp-stdio.js  （需 bridge.js 已在运行；地址可用 BRIDGE_URL 环境变量覆盖）
// 协议：按行分隔的 JSON-RPC 2.0（MCP stdio transport）

const readline = require("readline");
const { randomUUID } = require("crypto");
const { INSTRUCTIONS, TOOLS } = require("./tools");
const launcher = require("./launcher");
const { parseEndpoint } = require("./endpoint");

// 统一端点（R3）：与 launcher 使用同一 parseEndpoint 规范结果；只设 BRIDGE_PORT 时 MCP 实际
// 请求地址与其完全一致；非法配置明确报错（不悄悄回退 8765）；远程/HTTPS 端点只连接、不 spawn 本地
const EP = parseEndpoint(process.env);
const BRIDGE_URL = EP.ok ? EP.url : "http://127.0.0.1:8765";
const BODY_LIMIT_BYTES = Number(process.env.MCP_BODY_LIMIT_BYTES || 64 * 1024 * 1024); // 截图等大响应的合理上限
const SERVER_INFO = { name: "cc-browser-bridge", version: require("./package.json").version };
const SUPPORTED_PROTOCOLS = ["2024-11-05", "2025-03-26", "2025-06-18"];
const clientId = randomUUID();
let hasTarget = false;

function write(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function err2stderr(e) {
  process.stderr.write("[mcp-stdio] " + (e && e.message ? e.message : String(e)) + "\n");
}

// 阶段 A 通用启动层：进程启动即后台准备桥接/稳定目录/首次引导（不阻塞 MCP 握手；本模块 stdout 恒为纯协议）
const AUTO_ENSURE = process.env.BB_AUTO_ENSURE !== "0";
if (!EP.ok) {
  err2stderr(new Error("[endpoint] " + EP.error + "；工具调用将失败，请修正 BRIDGE_URL/BRIDGE_PORT 后重启客户端"));
} else if (AUTO_ENSURE) {
  launcher.ensureReady()
    .then((r) => { if (!r.ok) err2stderr("[launcher] " + r.reason); })
    .catch((e) => err2stderr("[launcher] " + (e.message || e)));
}

// 有界响应读取：流式累积并检查体积上限（截图允许较大但仍必须有界），配合下面的绝对截止
async function readBodyBounded(res) {
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > BODY_LIMIT_BYTES) {
      try { await reader.cancel(); } catch (e) {}
      throw new Error("桥接响应体积超过上限 " + BODY_LIMIT_BYTES + " 字节");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function callOnce(name, args, timeoutMs = Number(process.env.MCP_CALL_TIMEOUT_MS || 65000)) {
  if (!EP.ok) throw new Error("桥接端点配置非法：" + EP.error);
  const res = await fetch(EP.url + "/tool/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool: name, arguments: args, client_id: clientId, require_target: hasTarget }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  // 老服务不会解析连接标识。避免把这些操作退回无作用域的旧入口。
  if (res.status === 404) {
    return { isError: true, content: [{ type: "text", text: "桥接服务仍是旧版。请退出旧的 Browser Bridge 客户端，停止旧桥接（或重启电脑），再打开新版。" }] };
  }
  let text;
  try { text = await readBodyBounded(res); } catch (e) { throw new Error("桥接响应读取失败（" + (e.message || e) + "）"); }
  let body = null;
  try { body = JSON.parse(text); } catch (e) {}
  if (body === null)
    throw new Error("桥接端口返回了非预期响应（HTTP " + res.status + "），可能被其他程序占用");
  if (!body.ok)
    return {
      isError: true,
      content: [{ type: "text", text: (body.result && body.result.content && body.result.content[0] && body.result.content[0].text) || body.error || ("HTTP " + res.status) }],
    };
  if (body.result?._meta?.target_tab_id != null) hasTarget = true;
  if (name === "browser_tabs" && args.action === "release") hasTarget = false;
  return body.result;
}

async function callBridge(name, args) {
  try {
    return await callOnce(name, args);
  } catch (e) {
    if (!EP.ok)
      return { isError: true, content: [{ type: "text", text: "桥接端点配置非法：" + EP.error }] };
    if (!AUTO_ENSURE || !EP.manageable)
      return {
        isError: true,
        content: [{
          type: "text",
          text: EP.manageable
            ? "无法连接桥接服务 " + EP.url + "：请先运行 node bridge.js（" + (e.message || e) + "）"
            : "无法连接桥接服务 " + EP.url + "（" + (EP.secure ? "HTTPS" : "远程") + "端点仅连接、不启动本地服务；" + (e.message || e) + "）；请确认该端点可达",
        }],
      };
    // 只有尚未连上的请求可安全重试。超时的点击或输入可能已经执行。
    if (e.cause?.code !== "ECONNREFUSED")
      return { isError: true, content: [{ type: "text", text: "桥接未确认操作结果（" + (e.message || e) + "），请先确认目标页状态再重试。" }] };
    const r = await launcher.ensureReady();
    if (!r.ok)
      return { isError: true, content: [{ type: "text", text: "桥接服务不可用：" + r.reason }] };
    try {
      return await callOnce(name, args);
    } catch (e2) {
      return {
        isError: true,
        content: [{ type: "text", text: "无法连接桥接服务 " + EP.url + "（" + (e2.message || e2) + "）；日志见 ~/.browser-bridge/logs/" }],
      };
    }
  }
}

async function handleMessage(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;
  const reply = (result) => { if (!isNotification) write({ jsonrpc: "2.0", id, result }); };
  const replyErr = (code, message) => { if (!isNotification) write({ jsonrpc: "2.0", id, error: { code, message } }); };

  switch (method) {
    case "initialize": {
      const want = params && params.protocolVersion;
      reply({
        protocolVersion: SUPPORTED_PROTOCOLS.includes(want) ? want : "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
      break;
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      break;
    case "ping":
      reply({});
      break;
    case "tools/list":
      reply({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
      break;
    case "tools/call": {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      if (!name) { replyErr(-32602, "params.name 必填"); break; }
      try { reply(await callBridge(name, args)); }
      catch (e) { replyErr(-32603, String(e.message || e)); }
      break;
    }
    case "resources/list":
      reply({ resources: [] });
      break;
    case "prompts/list":
      reply({ prompts: [] });
      break;
    default:
      replyErr(-32601, "Method not found: " + method);
  }
}

const rl = readline.createInterface({ input: process.stdin });
let inFlight = 0;
rl.on("line", (line) => {
  const s = line.trim();
  if (!s) return;
  let msg;
  try { msg = JSON.parse(s); } catch (e) { err2stderr(new Error("非 JSON 行已忽略")); return; }
  inFlight++;
  Promise.resolve(handleMessage(msg))
    .catch(err2stderr)
    .finally(() => { inFlight--; });
});
// stdin 关闭后等在途请求完成再退出（fetch 会保持事件循环）
rl.on("close", () => {
  const tryExit = async () => {
    if (inFlight > 0) { setTimeout(tryExit, 50); return; }
    if (hasTarget) {
      try { await callOnce("browser_tabs", { action: "release" }, 700); } catch (e) {}
    }
    process.exit(0);
  };
  tryExit();
});

err2stderr("stdio MCP 入口已就绪，桥接地址: " + (EP.ok ? EP.url : "（无效配置：" + EP.error + "）"));
