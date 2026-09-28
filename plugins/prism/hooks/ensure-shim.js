#!/usr/bin/env node
// Prism plugin — SessionStart hook.
// Quick mode (default): verify the ZCode desktop app carries the CURRENT
// renderer shim (matched by content hash, so any shim change re-applies); if
// missing/stale, relaunch self in a detached --apply child so the session
// never blocks. Apply mode: extract the current app.asar, strip any legacy
// zc-* shim envelope, inject the bundled renderer script, repack and swap in
// place (keeping one pristine backup of an unpatched app).
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const VERSION = "v11";
const INJECT_RE = /<script>\/\* zc-[a-z-]+[\s\S]*?<\/script>\n?/g;
const LEGACY_ENVELOPE_RE = /<script>\/\* zc-(?:project-tint|prism)\b/;
const STATE_FILE = path.join(os.homedir(), ".zcode", "prism-state.json");
const ASAR = "/Applications/ZCode.app/Contents/Resources/app.asar";
const RESOURCES = path.dirname(ASAR);
const APPLY_STALE_MS = 15 * 60 * 1000;

let asar;
try {
  asar = require("@electron/asar");
} catch (err) {
  process.exit(0);
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch (_) {
    return {};
  }
}
function writeState(patch) {
  try {
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(Object.assign(readState(), patch, { at: new Date().toISOString() })),
    );
  } catch (_) {}
}

function shimPath() {
  return path.join(__dirname, "..", "renderer", "prism.js");
}
function shimHash() {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(shimPath()))
    .digest("hex")
    .slice(0, 16);
}
// The manifest's userConfig fields (rendered by the client's plugin settings
// page) have no documented channel into hooks, so this is best-effort: probe
// every plausible source and keep only our known boolean keys. Whatever is
// found is baked into the injected envelope as window.__zcPrismConfig; the
// renderer treats it as the middle layer (localStorage overrides > config >
// defaults).
const CONFIG_KEYS = ["dimTitles", "brightenThinking", "autoColor", "groupRecency"];
function readPluginConfig() {
  const raw = {};
  try {
    for (const [k, v] of Object.entries(process.env)) {
      const m = /^(?:ZCODE_PLUGIN_CONFIG|USER_CONFIG)[_-](.+)$/.exec(k);
      if (m) raw[m[1].replace(/[_-](\w)/g, (_, c) => c.toUpperCase()).toLowerCase()] = v;
    }
  } catch (_) {}
  try {
    const dataDir = process.env.ZCODE_PLUGIN_DATA;
    const candidates = [];
    if (dataDir) candidates.push(path.join(dataDir, "user-config.json"), path.join(dataDir, "config.json"));
    if (process.env.ZCODE_PLUGIN_ROOT)
      candidates.push(path.join(process.env.ZCODE_PLUGIN_ROOT, "user-config.json"));
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        Object.assign(raw, JSON.parse(fs.readFileSync(p, "utf8")));
        break;
      }
    }
  } catch (_) {}
  const cfg = {};
  for (const k of CONFIG_KEYS) {
    if (k in raw) cfg[k] = raw[k] === true || raw[k] === "true";
  }
  return cfg;
}
function configSig(cfg) {
  return crypto.createHash("sha256").update(JSON.stringify(cfg)).digest("hex").slice(0, 8);
}
function envelopeOf(shim) {
  const cfg = readPluginConfig();
  const cfgLine = Object.keys(cfg).length
    ? "\nwindow.__zcPrismConfig=" + JSON.stringify(cfg) + ";\n"
    : "";
  return (
    "<script>/* zc-prism " +
    VERSION +
    " hash=" +
    shimHash() +
    " cfg=" +
    configSig(cfg) +
    " (Prism plugin for ZCode) */\n" +
    shim +
    cfgLine +
    "</script>\n"
  );
}

function isCurrent(html) {
  const m = html.match(/\/\* zc-prism v\d+ hash=([0-9a-f]{16}) cfg=([0-9a-f]{8})/);
  return Boolean(m && m[1] === shimHash() && m[2] === configSig(readPluginConfig()));
}
function readIndex(asarPath) {
  return asar.extractFile(asarPath, "out/renderer/index.html").toString("utf8");
}

async function apply() {
  const state = readState();
  if (state.applyingAt && Date.now() - state.applyingAt < APPLY_STALE_MS) return;
  writeState({ applyingAt: Date.now(), lastError: null });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zc-prism-"));
  try {
    asar.extractAll(ASAR, tmp);
    const indexPath = path.join(tmp, "out", "renderer", "index.html");
    let html = fs.readFileSync(indexPath, "utf8");
    const alreadyCurrent = isCurrent(html);
    // keep one pristine backup, but only of a truly unpatched app
    const pristine = path.join(RESOURCES, "app.asar.pristine-backup");
    if (!LEGACY_ENVELOPE_RE.test(html) && !fs.existsSync(pristine)) {
      try {
        fs.copyFileSync(ASAR, pristine);
      } catch (_) {}
    }
    if (alreadyCurrent) return;
    html = html.replace(INJECT_RE, ""); // strip any older shim envelope
    const shim = fs.readFileSync(shimPath(), "utf8");
    if (!html.includes("</body>")) throw new Error("index.html has no </body>");
    html = html.replace("</body>", envelopeOf(shim) + "</body>");
    fs.writeFileSync(indexPath, html);

    const incomingAsar = path.join(RESOURCES, ".zc-prism-incoming.asar");
    fs.rmSync(incomingAsar, { force: true });
    fs.rmSync(incomingAsar + ".unpacked", { recursive: true, force: true });
    await asar.createPackageWithOptions(tmp, incomingAsar, {
      unpack: "**/{*.node,spawn-helper}",
    });
    // sanity: the packaged index must carry the current shim before any swap
    if (!isCurrent(readIndex(incomingAsar))) throw new Error("packaged asar failed hash check");

    const prevAsar = path.join(RESOURCES, "app.asar.pre-prism");
    try {
      fs.renameSync(ASAR, prevAsar);
    } catch (_) {}
    fs.renameSync(incomingAsar, ASAR);
    // unpacked payload is byte-identical between builds of the same app
    // version, so an in-place overwrite is safe and leaves no gap where the
    // canonical app.asar.unpacked path is missing.
    fs.cpSync(incomingAsar + ".unpacked", path.join(RESOURCES, "app.asar.unpacked"), {
      recursive: true,
      force: true,
    });
    fs.rmSync(incomingAsar + ".unpacked", { recursive: true, force: true });
    try {
      fs.rmSync(prevAsar, { force: true });
    } catch (_) {}
    writeState({ applyingAt: null, lastApply: new Date().toISOString(), lastResult: "installed" });
  } catch (err) {
    writeState({ applyingAt: null, lastResult: "error", lastError: String(err && err.message) });
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (_) {}
  }
}

if (process.argv.includes("--apply")) {
  apply()
    .catch(() => {})
    .finally(() => process.exit(0));
} else {
  // quick check
  try {
    if (!fs.existsSync(ASAR)) process.exit(0);
    // one-shot diagnostics: which plugin variables does the host actually
    // give this hook, and does a readable config file exist anywhere —
    // recorded so the marketplace settings-page bridge can be tightened
    // (or dropped) based on facts instead of documentation
    const envKeys = Object.keys(process.env).filter((k) =>
      /^(ZCODE|USER_CONFIG|CLAUDE)/i.test(k),
    );
    writeState({
      configProbe: {
        at: new Date().toISOString(),
        env: envKeys.reduce((o, k) => ((o[k] = process.env[k] || ""), o), {}),
        argv: process.argv.slice(1),
        dataDir: process.env.ZCODE_PLUGIN_DATA || null,
        configFound: Object.keys(readPluginConfig()),
      },
    });
    if (isCurrent(readIndex(ASAR))) {
      writeState({ lastResult: "ok" });
      process.exit(0);
    }
    const state = readState();
    if (state.applyingAt && Date.now() - state.applyingAt < APPLY_STALE_MS) process.exit(0);
    const child = spawn(process.execPath, [__filename, "--apply"], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    writeState({ lastTrigger: new Date().toISOString() });
  } catch (_) {}
  process.exit(0);
}
