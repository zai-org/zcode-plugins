#!/usr/bin/env node
// KiCad plugin launcher. The MCP server itself is Python (FastMCP + the KiCad worker, see py/kicad_server.py); this file only finds an interpreter that
// has its three dependencies and hands over stdin/stdout, so the manifest looks like every other ZCode plugin (`node dist/server.mjs`). When no interpreter can be
// found or provisioned it answers the MCP handshake itself and tells the user what to install (serveFallback).
// Diagnostics go to stderr only: stdout belongs to the MCP protocol.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PY = join(HERE, "py");
const SERVER = join(PY, "kicad_server.py");
const REAL_HOME = os.userInfo().homedir; // not $HOME: a sandboxed or isolated profile may point HOME elsewhere
const DEPS = ["fastmcp>=4,<5", "pydantic>=2,<3", "numpy>=2,<3"];
const LIVE_DEPS = ["kicad-python>=0.8,<0.9"]; // optional: the live link to a running KiCad (IPC API); without it the plugin works as before and says so
const log = (msg) => process.stderr.write(`[kicad-plugin] ${msg}\n`);

function ok(command, args, timeout = 60000, env = {}) {
  const started = Date.now();
  const provisioning = args[0] === "run";
  if (provisioning) log(`Preparing Python dependencies (budget ${timeout / 1000}s)`);
  const r = spawnSync(command, args, { stdio: provisioning ? ["ignore", "ignore", "inherit"] : "ignore", timeout, env: { ...process.env, ...env } });
  if (provisioning) log(`Python dependency preparation ${r.status === 0 ? "completed" : "failed"} after ${Date.now() - started}ms${r.error ? ` (${r.error.code})` : ""}`);
  return r.status === 0;
}

function resolveRunner() {
  if (process.env.KICAD_PLUGIN_NO_RUNNER === "1") return { fallback: "No Python runner (KICAD_PLUGIN_NO_RUNNER=1, used by the tests)." };
  const configured = (process.env.ZCODE_KICAD_PYTHON || "").trim();
  if (configured) {
    if (ok(configured, ["-c", "import sys; assert sys.version_info >= (3, 11); import fastmcp, pydantic, numpy"])) return { command: configured, args: [SERVER], how: `configured python ${configured}` };
    log(`ZCODE_KICAD_PYTHON=${configured} cannot import fastmcp, pydantic and numpy; trying other options`);
  }
  for (const uv of ["uv", join(REAL_HOME, ".local/bin/uv"), "/opt/homebrew/bin/uv", "/usr/local/bin/uv"]) {
    if (uv.includes("/") && !existsSync(uv)) continue;
    if (!ok(uv, ["--version"])) continue;
    // `--python`: fastmcp 4 needs Python >= 3.10, but a sandboxed PATH may only offer macOS's /usr/bin/python3 (3.9.6); uv then picks an installed 3.11+ or fetches one
    const withDeps = (deps) => ["run", "--no-project", "--python", ">=3.11", ...deps.flatMap((d) => ["--with", d]), "python"];
    // kicad-python (+ pynng, protobuf) is fetched like the other dependencies; if it cannot be resolved (offline first start) the plugin starts without the live link instead of not at all
    // UV_NO_CONFIG: the server runs in the user's workspace, and uv would read a uv.toml / pyproject.toml found there (an `index-url` in a cloned repository could decide
    // which package is installed and executed here); only the plugin's own pins decide.
    const uvEnv = { UV_CACHE_DIR: process.env.UV_CACHE_DIR || join(REAL_HOME, ".cache/uv"), UV_NO_CONFIG: "1" };
    const live = ok(uv, [...withDeps([...DEPS, ...LIVE_DEPS]), "-c", "import fastmcp, pydantic, numpy, kipy"], 180000, uvEnv);
    if (!live) {
      if (!ok(uv, [...withDeps(DEPS), "-c", "import fastmcp, pydantic, numpy"], 180000, uvEnv)) {
        log(`uv (${uv}) could not provide fastmcp, pydantic and numpy (offline on the first start?)`);
        return { fallback: `uv (${uv}) could not install the plugin's Python packages (fastmcp, pydantic, numpy): offline on the first start, or the package index is unreachable.` };
      }
      log("kicad-python could not be installed: starting without the live link to KiCad (everything else works)");
    }
    const args = [...withDeps(live ? [...DEPS, ...LIVE_DEPS] : DEPS), SERVER];
    return { command: uv, args, how: `uv (${uv})`, env: uvEnv };
  }
  if (ok("python3", ["-c", "import sys; assert sys.version_info >= (3, 11); import fastmcp, pydantic, numpy"])) return { command: "python3", args: [SERVER], how: "python3 on PATH" };
  return { fallback: "No usable Python was found: neither uv nor a Python 3.11+ that has fastmcp, pydantic and numpy." };
}

// When there is no way to start the real server, the plugin still answers the MCP handshake: the panel opens and says what is missing, and the model gets one tool that
// explains it, instead of a server that silently fails to connect.
function serveFallback(why) {
  const version = (readFileSync(join(PY, "plugin_version.py"), "utf8").match(/VERSION = "([^"]+)"/) || [])[1] || "0.0.0";
  const UI_URI = "ui://kicad/board.html";
  const help = `${why}\n\nThe KiCad plugin's server is written in Python. Install uv (https://docs.astral.sh/uv/; the plugin then fetches fastmcp, pydantic and numpy on its first start, which needs network), `
    + "or set the plugin setting 'Python with fastmcp' to a Python 3.11+ that already has fastmcp>=4,<5, pydantic and numpy. KiCad 10 itself must be installed (/Applications/KiCad, or set 'KiCad.app path'). Then start a new session.";
  const missing = { ok: false, error: `The KiCad plugin cannot start its server. ${help}`, runtime_missing: true, artifacts: [] };
  const tools = [
    { name: "kicad_setup_help", description: "Why the KiCad plugin is not working and what to install. Only available while the plugin's Python server cannot start.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
    { name: "kicad_board_view", description: "Opens the KiCad panel (which says what is missing).", inputSchema: { type: "object", properties: { side: { type: "string" } } }, _meta: { ui: { resourceUri: UI_URI, surface: "board", visibility: ["model", "app"] } } },
  ];
  const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
  const fail = (id, code, message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
  createInterface({ input: process.stdin }).on("line", (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (m.id === undefined) return; // notifications need no answer
    switch (m.method) {
      case "initialize": return reply(m.id, { protocolVersion: m.params?.protocolVersion || "2025-06-18", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "kicad", version } });
      case "ping": return reply(m.id, {});
      case "tools/list": return reply(m.id, { tools });
      case "tools/call": {
        if (m.params?.name === "kicad_setup_help") return reply(m.id, { content: [{ type: "text", text: help }] });
        if (m.params?.name === "kicad_board_view") return reply(m.id, { content: [{ type: "text", text: JSON.stringify(missing) }], structuredContent: missing });
        return fail(m.id, -32602, `unknown tool ${m.params?.name}: the KiCad plugin's server is not running (${why})`);
      }
      case "resources/list": return reply(m.id, { resources: [{ uri: UI_URI, name: "KiCad board panel", mimeType: "text/html;profile=mcp-app" }] });
      case "resources/read": {
        if (m.params?.uri !== UI_URI) return fail(m.id, -32002, "resource not found");
        return reply(m.id, { contents: [{ uri: UI_URI, mimeType: "text/html;profile=mcp-app", text: readFileSync(join(HERE, "panel.html"), "utf8") }] });
      }
      default: return fail(m.id, -32601, `method not found: ${m.method}`);
    }
  }).on("close", () => process.exit(0));
}

function startRealServer(runner) {
  log(`starting with ${runner.how}`);
  // kicad-cli (Qt) misbehaves without HOME/USER; some hosts start MCP servers with a nearly empty environment, so fill in only what is missing.
  const base = { ...process.env };
  if (!base.HOME) base.HOME = REAL_HOME;
  if (!base.USER) base.USER = os.userInfo().username;
  if (!base.LANG) base.LANG = "en_US.UTF-8";
  const child = spawn(runner.command, runner.args, {
    stdio: "inherit",
    cwd: process.env.ZCODE_WORKSPACE_ROOT || process.cwd(),
    env: { ...base, ...runner.env, PYTHONPATH: PY, PYTHONDONTWRITEBYTECODE: "1", PYTHONUNBUFFERED: "1" },
  });
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => child.kill(sig));
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
  child.on("error", (e) => { log(`failed to start: ${e.message}`); process.exit(1); });
}

const runner = resolveRunner();
if (process.argv.includes("--prepare-runtime")) {
  // Populate the same uv caches before the MCP deadline starts. Do not return
  // sys.executable: uv may use an ephemeral interpreter that does not survive.
  if (runner.fallback) {
    log(runner.fallback);
    process.exitCode = 1;
  } else process.stdout.write("ready\n");
} else if (runner.fallback) {
  log(`${runner.fallback} Answering the MCP handshake only; see the kicad_setup_help tool.`);
  serveFallback(runner.fallback);
} else {
  startRealServer(runner);
}
