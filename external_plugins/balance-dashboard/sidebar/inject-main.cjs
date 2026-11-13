/* balance-dashboard sidebar loader (Electron main process).
 *
 * Loaded by the dynamic import line appended to app.asar's main entry.
 * It injects a compact balance widget into ZCode's left sidebar and keeps it
 * fed with data from a one-shot Node collector.
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
const CONFIG = readJson(path.join(RUNTIME, "config.json"), {});
const COLLECT = path.join(RUNTIME, "scripts", "collect-once.mjs");
const ANALYTICS = path.join(RUNTIME, "scripts", "query-analytics.mjs");
const OPTIONS_FILE = path.join(RUNTIME, "options.json");
const WIDGET = path.join(HERE, "sidebar-widget.js");
const LOG_FILE = path.join(RUNTIME, "inject.log");
const REFRESH_MS = 60 * 1000;
const COLLECT_TIMEOUT_MS = 45 * 1000;
const ANALYTICS_TIMEOUT_MS = 30 * 1000;
const REQUEST_POLL_MS = 700;
const MAX_VALUE_LENGTH = 8192;
const TEXT_SETTING_KEYS = new Set([
  "volc_access_key_id",
  "volc_region",
  "zcode_usage_db",
  "zcode_device_mid",
  "show_deepseek",
  "show_volcano",
  "show_zcode",
  "hide_unconfigured",
]);
const SECRET_SETTING_KEYS = new Set(["deepseek_api_key", "volc_secret_access_key", "zcode_jwt_token"]);
const ALL_SETTING_KEYS = new Set([...TEXT_SETTING_KEYS, ...SECRET_SETTING_KEYS]);

let widgetSource = "";
try {
  widgetSource = fs.readFileSync(WIDGET, "utf8");
  new Function(widgetSource); // reject a partially written file before it reaches the renderer
} catch (error) {
  log("widget source unavailable:", error.message);
}

let latest = null;
let collecting = false;
let lastCollectAt = 0;

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
  if (!root) return true; // older runtime config: do not disable
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

function runNodeScript(script, args, timeoutMs = COLLECT_TIMEOUT_MS) {
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
      child = spawn(process.execPath, [script, ...args], {
        cwd: RUNTIME,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", BALANCE_RUNTIME_DIR: RUNTIME },
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

async function runCollector() {
  // Prefer the Electron runtime in Node mode (no PATH dependency); fall back
  // to a system node when that runtime cannot load the sqlite builtin.
  let result = await runNodeScript(COLLECT, []);
  if (!result.ok) {
    log("electron collector failed, retrying with node:", result.error);
    result = await runCollectorWithNode(COLLECT, []);
  }
  return result;
}

function runCollectorWithNode(script, args) {
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
    }, COLLECT_TIMEOUT_MS);
    try {
      child = spawn(process.env.BALANCE_NODE || "node", ["--no-warnings", script, ...args], {
        cwd: RUNTIME,
        env: { ...process.env, BALANCE_RUNTIME_DIR: RUNTIME },
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

async function refresh() {
  if (collecting || !pluginAvailable()) return;
  collecting = true;
  try {
    const result = await runCollector();
    if (result.ok) {
      latest = result.data;
      lastCollectAt = Date.now();
      pushAll();
    } else {
      log("collect failed:", result.error);
      if (!latest) {
        latest = {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          error: { code: "collect_failed", message: result.error },
        };
        pushAll();
      }
    }
  } finally {
    collecting = false;
  }
}

function pushAll() {
  if (!latest) return;
  for (const wc of webContents.getAllWebContents()) push(wc);
}

function push(wc) {
  if (!latest || !isMainWindowState(wc) || wc.isDestroyed() || !isLocalHostPage(wc)) return;
  const json = JSON.stringify(latest).replace(/[\u2028\u2029]/g, (c) =>
    c === "\u2028" ? "\\u2028" : "\\u2029",
  );
  wc.executeJavaScript(`window.__balanceDashboardPush && window.__balanceDashboardPush(${json})`, true).catch(
    () => {},
  );
}

/* ------------------------------------------------------------------ */
/* Renderer requests: settings save + analytics query                  */
/* ------------------------------------------------------------------ */

function sanitizeSettings(values) {
  const out = {};
  if (!values || typeof values !== "object" || Array.isArray(values)) return out;
  for (const [key, raw] of Object.entries(values)) {
    if (!ALL_SETTING_KEYS.has(key)) continue;
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (value.length > MAX_VALUE_LENGTH) continue;
    if (!value && SECRET_SETTING_KEYS.has(key)) continue; // empty secret keeps the old value
    out[key] = value;
  }
  return out;
}

function saveSettings(values) {
  const patch = sanitizeSettings(values);
  if (!Object.keys(patch).length) {
    throw new Error("没有可保存的配置项");
  }
  let current = {};
  try {
    current = JSON.parse(fs.readFileSync(OPTIONS_FILE, "utf8"));
  } catch {
    current = {};
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) current = {};
  const next = { ...current, ...patch };
  fs.mkdirSync(RUNTIME, { recursive: true });
  const tmp = `${OPTIONS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(tmp, 0o600);
  } catch {
    // best effort on Windows
  }
  fs.renameSync(tmp, OPTIONS_FILE);
  return Object.keys(patch);
}

function analyticsArgs(args) {
  const out = [];
  const start = Number(args && args.start);
  const end = Number(args && args.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error("无效的时间范围");
  }
  out.push("--start", String(Math.round(start)), "--end", String(Math.round(end)));
  const bucket = ["hour", "day", "week"].includes(args.bucket) ? args.bucket : "day";
  out.push("--bucket", bucket);
  if (typeof args.projectId === "string" && args.projectId) out.push("--project-id", args.projectId);
  if (typeof args.directory === "string" && args.directory) out.push("--directory", args.directory);
  if (typeof args.sessionId === "string" && args.sessionId) out.push("--session-id", args.sessionId);
  if (typeof args.provider === "string" && args.provider) out.push("--provider", args.provider);
  return out;
}

async function runAnalytics(args) {
  const argv = analyticsArgs(args);
  let result = await runNodeScript(ANALYTICS, argv, ANALYTICS_TIMEOUT_MS);
  if (!result.ok) {
    log("electron analytics failed, retrying with node:", result.error);
    result = await runCollectorWithNode(ANALYTICS, argv);
  }
  if (!result.ok) throw new Error(result.error || "统计查询失败");
  return result.data;
}

async function handleRequest(req) {
  if (!req || typeof req !== "object" || typeof req.id !== "string") return null;
  try {
    if (req.op === "save-settings") {
      const saved = saveSettings(req.values);
      refreshSoon();
      return { id: req.id, result: { ok: true, data: { saved } } };
    }
    if (req.op === "analytics") {
      const data = await runAnalytics(req.args || {});
      return { id: req.id, result: { ok: true, data } };
    }
    return { id: req.id, result: { ok: false, error: { message: `未知操作：${String(req.op)}` } } };
  } catch (error) {
    return { id: req.id, result: { ok: false, error: { message: error.message || String(error) } } };
  }
}

let pumping = false;

function refreshSoon(attempt = 0) {
  if (!collecting) {
    refresh();
    return;
  }
  if (attempt >= 6) return;
  setTimeout(() => refreshSoon(attempt + 1), 2500);
}

async function pumpRequests() {
  if (pumping) return;
  pumping = true;
  try {
    for (const wc of webContents.getAllWebContents()) {
      if (!isMainWindowState(wc) || wc.isDestroyed() || !isLocalHostPage(wc)) continue;
      let raw;
      try {
        raw = await wc.executeJavaScript(
          "(function(){try{var q=window.__balanceDashboardRequests;if(!Array.isArray(q)||!q.length)return '';window.__balanceDashboardRequests=[];return JSON.stringify(q)}catch(e){return ''}})()",
          true,
        );
      } catch {
        continue;
      }
      if (!raw) continue;
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
          `window.__balanceDashboardRequestResult && window.__balanceDashboardRequestResult(${JSON.stringify(reply.id)}, ${json})`,
          true,
        ).catch(() => {});
      }
    }
  } finally {
    pumping = false;
  }
}

function inject(wc, reload) {
  if (!widgetSource || !isMainWindowState(wc) || wc.isDestroyed() || !isLocalHostPage(wc)) return;
  if (!pluginAvailable()) {
    log("plugin root missing; sidebar widget disabled");
    return;
  }
  const cleanup =
    "(function(){try{if(window.__balanceDashboardDispose)window.__balanceDashboardDispose()}catch(e){}})();";
  const config = {
    runtime: RUNTIME,
    pluginRoot: CONFIG.pluginRoot || "",
    version: CONFIG.version || "0.3.0",
    loaderVersion: 2,
  };
  const source = `${cleanup}window.__balanceDashboardConfig=${JSON.stringify(config)};\n${widgetSource}`;
  wc.executeJavaScript((reload ? cleanup : "") + source, true)
    .then(() => push(wc))
    .catch((error) => log("executeJavaScript failed:", error.message));
}

function hook(wc) {
  if (!isMainWindowState(wc)) return;
  wc.on("dom-ready", () => inject(wc));
  wc.on("did-finish-load", () => inject(wc));
  wc.on("destroyed", () => {});
  if (!wc.isLoading()) inject(wc);
}

app.on("web-contents-created", (_event, wc) => hook(wc));
for (const wc of webContents.getAllWebContents()) hook(wc);

app.whenReady()
  .then(() => {
    refresh();
    setInterval(refresh, REFRESH_MS);
    setInterval(pumpRequests, REQUEST_POLL_MS);
  })
  .catch((error) => log("whenReady failed:", error.message));

module.exports = {
  refresh,
  inject,
  pumpRequests,
  _state: () => ({ latest, collecting, lastCollectAt, runtime: RUNTIME }),
};
