/* zcode-context panel loader (Electron main process).
 *
 * Loaded by the dynamic import line appended to app.asar's main entry.
 * It injects the "context insight" entry into ZCode's left sidebar and serves
 * dashboard data requests from the renderer through one-shot query scripts.
 *
 * Everything here is best-effort: any failure only writes a local log line and
 * must never prevent ZCode from starting or rendering.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { app, webContents } = require("electron");

const HERE = __dirname;
const RUNTIME = path.resolve(HERE, "..");
log("loader loaded; runtime:", RUNTIME);
const CONFIG = readJson(path.join(RUNTIME, "config.json"), {});
const QUERY_DIR = path.join(RUNTIME, "scripts");
// The loader may be loaded from panel/ or sidebar/ (older injection lines);
// resolve the widget from whichever directory actually has it.
const WIDGET = [path.join(HERE, "panel-widget.js"), path.join(HERE, "..", "panel", "panel-widget.js"), path.join(RUNTIME, "panel", "panel-widget.js")].find(
  (candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  },
);
const LOG_FILE = path.join(RUNTIME, "inject.log");
const QUICK_TIMEOUT_MS = 45 * 1000;
const DETAIL_TIMEOUT_MS = 90 * 1000;
const REQUEST_POLL_MS = 700;

let widgetSource = "";
try {
  widgetSource = fs.readFileSync(WIDGET, "utf8");
  new Function(widgetSource); // reject a partially written file before it reaches the renderer
} catch (error) {
  log("widget source unavailable:", error.message);
}

function log(...args) {
  try {
    const line = `[${new Date().toISOString()}] ${args
      .map((value) => (value instanceof Error ? value.stack || value.message : String(value)))
      .join(" ")}\n`;
    try {
      if (fs.statSync(LOG_FILE).size > 256 * 1024) fs.truncateSync(LOG_FILE, 0);
    } catch {
      // log file does not exist yet
    }
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // logging must never throw
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function pluginAvailable() {
  const root = CONFIG.pluginRoot;
  if (!root) return true;
  try {
    return fs.statSync(root).isDirectory();
  } catch {
    return false;
  }
}

function isMainWindowState(wc) {
  try {
    return wc.getType() === "window";
  } catch {
    return false;
  }
}

function isLocalHostPage(wc) {
  try {
    const url = wc.getURL();
    if (!url.startsWith("file:")) return false;
    const relative = path.relative(process.resourcesPath, require("url").fileURLToPath(url));
    return !relative.startsWith("..") && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* One-shot query runner (Electron in Node mode, PATH-node fallback)   */
/* ------------------------------------------------------------------ */

function runScriptGeneric(command, script, args, timeoutMs) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let child;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        child && child.kill();
      } catch {
        // ignore
      }
      finish({ ok: false, error: "script timeout" });
    }, timeoutMs);
    try {
      child = spawn(command, [...(command === process.execPath ? [] : ["--no-warnings"]), script, ...args], {
        cwd: RUNTIME,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: command === process.execPath ? "1" : process.env.ELECTRON_RUN_AS_NODE },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      finish({ ok: false, error: error.message });
      return;
    }
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => finish({ ok: false, error: error.message }));
    child.on("close", (code) => {
      const text = stdout.trim();
      if (!text) return finish({ ok: false, error: `script exited ${code}: ${stderr.slice(0, 300)}` });
      try {
        finish({ ok: true, data: JSON.parse(text) });
      } catch (error) {
        finish({ ok: false, error: `script returned invalid JSON: ${error.message}` });
      }
    });
  });
}

async function runQuery(scriptName, args, timeoutMs) {
  const script = path.join(QUERY_DIR, scriptName);
  let result = await runScriptGeneric(process.execPath, script, args, timeoutMs);
  if (!result.ok) {
    log(`electron run failed for ${scriptName}, retrying with node:`, result.error);
    result = await runScriptGeneric(process.env.ZCONTEXT_NODE || "node", script, args, timeoutMs);
  }
  return result;
}

function rangeArgs(query) {
  const out = [];
  const start = Number(query && query.start);
  const end = Number(query && query.end);
  const now = Date.now();
  const safeStart = Number.isFinite(start) && start > 0 ? Math.round(start) : now - 7 * 24 * 3600 * 1000;
  const safeEnd = Number.isFinite(end) && end > safeStart ? Math.round(end) : now;
  out.push("--start", String(safeStart), "--end", String(safeEnd));
  if (typeof query.directory === "string" && query.directory) out.push("--directory", query.directory);
  if (typeof query.order === "string" && query.order) out.push("--order", query.order);
  if (Number.isFinite(Number(query.limit))) out.push("--limit", String(Math.round(Number(query.limit))));
  if (typeof query.sessionId === "string" && query.sessionId) out.push("--session-id", query.sessionId);
  return out;
}

const OPS = {
  overview: { script: "query-overview.mjs", timeout: QUICK_TIMEOUT_MS },
  sessions: { script: "query-sessions.mjs", timeout: QUICK_TIMEOUT_MS },
  session: { script: "query-session.mjs", timeout: DETAIL_TIMEOUT_MS },
  agents: { script: "query-agents.mjs", timeout: DETAIL_TIMEOUT_MS },
};

/* ------------------------------------------------------------------ */
/* Disk cache: instant open + stale-while-revalidate + prefetch       */
/* ------------------------------------------------------------------ */

const CACHE_DIR = path.join(RUNTIME, "cache");
const FRESH_MS = { overview: 90 * 1000, sessions: 90 * 1000, session: 30 * 1000, agents: 30 * 1000 };
const REFRESHING = new Set();

function cacheKeyArgs(op, args) {
  // Normalize time bounds so identical ranges hit the same cache file:
  // start buckets to the hour, end buckets to 10 minutes.
  const out = { ...(args || {}) };
  if (Number.isFinite(Number(out.start))) out.start = Math.floor(Number(out.start) / 3600000) * 3600000;
  if (Number.isFinite(Number(out.end))) out.end = Math.ceil(Number(out.end) / 600000) * 600000;
  return out;
}

function cacheFile(op, args) {
  const key = JSON.stringify(cacheKeyArgs(op, args));
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return path.join(CACHE_DIR, op + "-" + (h >>> 0).toString(36) + ".json");
}

function readCache(file) {
  try {
    const st = fs.statSync(file);
    return { data: JSON.parse(fs.readFileSync(file, "utf8")), age: Date.now() - st.mtimeMs };
  } catch {
    return null;
  }
}

function writeCache(file, data) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
  } catch {
    // cache write is best-effort
  }
}

function backgroundRefresh(op, args, file) {
  const opDef = OPS[op];
  if (!opDef || REFRESHING.has(file)) return;
  REFRESHING.add(file);
  runQuery(opDef.script, rangeArgs(args), opDef.timeout)
    .then((result) => {
      REFRESHING.delete(file);
      if (result.ok && result.data && result.data.ok !== false) writeCache(file, result.data);
    })
    .catch(() => REFRESHING.delete(file));
}

function prefetchCaches() {
  try {
    const now = Date.now();
    const base = { start: now - 7 * 24 * 3600 * 1000, end: now, order: "tokens" };
    backgroundRefresh("overview", base, cacheFile("overview", base));
    backgroundRefresh("sessions", { ...base, limit: 60 }, cacheFile("sessions", { ...base, limit: 60 }));
    log("prefetch scheduled");
  } catch (error) {
    log("prefetch failed:", error.message);
  }
}

async function handleRequest(req) {
  if (!req || typeof req !== "object" || typeof req.id !== "string") return null;
  log("handleRequest op:", req.op, "args:", JSON.stringify(req.args || {}));
  try {
    const op = OPS[req.op];
    if (!op) {
      return { id: req.id, result: { ok: false, error: { message: `未知操作：${String(req.op)}` } } };
    }
    if (req.op !== "overview" && req.op !== "sessions" && !req.args?.sessionId) {
      return { id: req.id, result: { ok: false, error: { message: "缺少 sessionId" } } };
    }
    const args = req.args || {};
    const file = cacheFile(req.op, args);
    const cached = readCache(file);
    if (cached && cached.age < (FRESH_MS[req.op] || 60000)) {
      log("cache hit", req.op, Math.round(cached.age / 1000) + "s old");
      return { id: req.id, result: cached.data };
    }
    if (cached) {
      // stale-while-revalidate: answer instantly, refresh for the next open
      log("cache stale", req.op, Math.round(cached.age / 1000) + "s old; refreshing");
      backgroundRefresh(req.op, args, file);
      return { id: req.id, result: cached.data };
    }
    const result = await runQuery(op.script, rangeArgs(args), op.timeout);
    log("runQuery", op.script, "ok:", result.ok, result.ok ? "" : result.error);
    if (!result.ok) {
      return { id: req.id, result: { ok: false, error: { message: result.error || "查询失败" } } };
    }
    if (result.data && result.data.ok !== false) writeCache(file, result.data);
    return { id: req.id, result: result.data };
  } catch (error) {
    return { id: req.id, result: { ok: false, error: { message: error.message || String(error) } } };
  }
}

let pumping = false;

async function pumpRequests() {
  if (pumping) return;
  pumping = true;
  try {
    for (const wc of webContents.getAllWebContents()) {
      if (!isMainWindowState(wc) || wc.isDestroyed() || !isLocalHostPage(wc)) continue;
      let raw;
      try {
        raw = await wc.executeJavaScript(
          "(function(){try{var q=window.__zcodeContextRequests;if(!Array.isArray(q)||!q.length)return '';window.__zcodeContextRequests=[];return JSON.stringify(q)}catch(e){return ''}})()",
          true,
        );
      } catch {
        continue;
      }
      if (!raw) continue;
      let pageUrl = "";
      try {
        pageUrl = String(wc.getURL() || "").slice(0, 80);
      } catch {
        // ignore
      }
      log("pump picked", raw.length, "chars from", pageUrl);
      try {
        const dbg = await wc.executeJavaScript(
          "window.__zcodeContextDebugInfo ? JSON.stringify(window.__zcodeContextDebugInfo()) : ''",
          true,
        );
        if (dbg) log("page debug:", dbg.slice(0, 800));
      } catch {
        // debug read is best-effort
      }
      let requests;
      try {
        requests = JSON.parse(raw);
      } catch {
        continue;
      }
      for (const req of Array.isArray(requests) ? requests : []) {
        const reply = await handleRequest(req);
        if (!reply) continue;
        const json = JSON.stringify(reply.result).replace(/[\u2028\u2029]/g, (c) =>
          c === "\u2028" ? "\\u2028" : "\\u2029",
        );
        if (wc.isDestroyed()) continue;
        wc.executeJavaScript(
          `window.__zcodeContextRequestResult && window.__zcodeContextRequestResult(${JSON.stringify(reply.id)}, ${json})`,
          true,
        )
          .then(() => log("delivered", reply.id))
          .catch((error) => log("deliver failed for", reply.id, ":", error.message));
      }
    }
  } finally {
    pumping = false;
  }
}

function inject(wc) {
  if (!widgetSource || !isMainWindowState(wc) || wc.isDestroyed() || !isLocalHostPage(wc)) return;
  if (!pluginAvailable()) {
    log("plugin root missing; panel disabled");
    return;
  }
  const cleanup =
    "(function(){try{if(window.__zcodeContextDispose)window.__zcodeContextDispose()}catch(e){}})();";
  const config = {
    runtime: RUNTIME,
    pluginRoot: CONFIG.pluginRoot || "",
    version: CONFIG.version || "0.1.0",
  };
  const source = `${cleanup}window.__zcodeContextConfig=${JSON.stringify(config)};\n${widgetSource}`;
  wc.executeJavaScript(source, true).catch((error) => log("executeJavaScript failed:", error.message));
}

function hook(wc) {
  if (!isMainWindowState(wc)) return;
  wc.on("dom-ready", () => inject(wc));
  wc.on("did-finish-load", () => inject(wc));
  if (!wc.isLoading()) inject(wc);
}

app.on("web-contents-created", (_event, wc) => hook(wc));
for (const wc of webContents.getAllWebContents()) hook(wc);

app.whenReady()
  .then(() => {
    setInterval(pumpRequests, REQUEST_POLL_MS);
    setTimeout(prefetchCaches, 6000);
  })
  .catch((error) => log("whenReady failed:", error.message));

module.exports = {
  inject,
  pumpRequests,
  _state: () => ({ runtime: RUNTIME, widgetReady: Boolean(widgetSource) }),
};
