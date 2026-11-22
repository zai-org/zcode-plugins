#!/usr/bin/env node
/**
 * Minimal MCP stdio server for the Session Stats side panel.
 *
 * Supports the methods the plugin UI host needs:
 *   initialize, ping, tools/list, tools/call, resources/list, resources/read
 *
 * The panel is an MCP App; the host proxies its `tools/call` requests here.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PANEL_URI = "ui://turn-lens/panel.html";
const HTML_MIME = "text/html;profile=mcp-app";
const TOOL_NAME = "session_stats";
const AUTO_TOOL_NAME = "set_auto_display";
const OPEN_TOOL_NAME = "open_session_stats";
const VERSION = "0.11.0";
const WORKSPACE =
  process.env.ZCODE_WORKSPACE_ROOT || process.env.ZCODE_PROJECT_DIR || process.cwd();
const STATS_SCRIPT = path.join(ROOT, "skills", "turn-lens", "scripts", "session-stats.mjs");
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const AUTO_OFF_FILE = path.join(WORKSPACE, ".zcode", "session-stats.auto-off");
const PLUGIN_DATA = process.env.ZCODE_PLUGIN_DATA || process.env.CLAUDE_PLUGIN_DATA || "";
const PLUGIN_AUTO_OFF_FILE = PLUGIN_DATA
  ? path.join(PLUGIN_DATA, "auto-display.disabled")
  : "";
// A stable, workspace-independent preference shared by the panel and the Stop
// hook. Keep the name fixed so both processes agree even when the plugin data
// directory carries a marketplace suffix or the plugin is renamed.
const GLOBAL_STATE_DIR = path.join(homedir(), ".zcode", "cli", "plugins", "data", "turn-lens");
const GLOBAL_STATE_FILE = path.join(GLOBAL_STATE_DIR, "auto-display.json");

let cached = null;
let cachedAt = 0;

function log(message) {
  process.stderr.write(`[session-stats] ${message}\n`);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function readPanel() {
  // Read on every request so a rebuilt panel shows up when the tab is reopened.
  return readFileSync(path.join(ROOT, "dist", "ui", "panel.html"), "utf8");
}

function pluginVersion() {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(ROOT, ".zcode-plugin", "plugin.json"), "utf8"),
    );
    return typeof manifest.version === "string" ? manifest.version : VERSION;
  } catch {
    return VERSION;
  }
}

function readGlobalPreference() {
  try {
    const state = JSON.parse(readFileSync(GLOBAL_STATE_FILE, "utf8"));
    return typeof state.enabled === "boolean" ? state.enabled : null;
  } catch {
    return null;
  }
}

function autoDisplayState() {
  if (process.env.SESSION_STATS_AUTO_DISABLED === "1") {
    return { enabled: false, reason: "env" };
  }
  const preference = readGlobalPreference();
  if (preference === false) return { enabled: false, reason: "global" };
  if (preference === true) return { enabled: true, reason: null };
  if (PLUGIN_AUTO_OFF_FILE && existsSync(PLUGIN_AUTO_OFF_FILE)) {
    return { enabled: false, reason: "plugin" };
  }
  if (existsSync(AUTO_OFF_FILE)) {
    return { enabled: false, reason: "project" };
  }
  return { enabled: true, reason: null };
}

function setAutoDisplay(enabled) {
  if (enabled && process.env.SESSION_STATS_AUTO_DISABLED === "1") {
    const state = autoDisplayState();
    return {
      ok: false,
      autoDisplayEnabled: false,
      autoDisplayReason: state.reason,
      error: "环境变量 SESSION_STATS_AUTO_DISABLED=1 已禁用自动统计卡",
    };
  }

  mkdirSync(GLOBAL_STATE_DIR, { recursive: true });
  writeFileSync(
    GLOBAL_STATE_FILE,
    `${JSON.stringify({ enabled, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );

  if (enabled) {
    // Clear legacy per-workspace / plugin-data markers so an old opt-out does
    // not override the user's explicit choice.
    rmSync(AUTO_OFF_FILE, { force: true });
    if (PLUGIN_AUTO_OFF_FILE) rmSync(PLUGIN_AUTO_OFF_FILE, { force: true });
  } else {
    // Keep the legacy marker for older hook versions that predate the global
    // preference file.
    mkdirSync(path.dirname(AUTO_OFF_FILE), { recursive: true });
    writeFileSync(AUTO_OFF_FILE, "disabled by TurnLens panel\n", "utf8");
  }

  const state = autoDisplayState();
  return {
    ok: true,
    autoDisplayEnabled: state.enabled,
    autoDisplayReason: state.reason,
  };
}

function sessionStats(args) {
  const now = Date.now();
  const key = JSON.stringify(args || {});
  if (cached && cached.key === key && now - cachedAt < 750) return cached.value;

  const cli = [STATS_SCRIPT, "--json", "--session-totals"];
  if (args?.sessionId) cli.push("--session", String(args.sessionId));
  if (args?.includeActive !== false) cli.push("--include-active");

  const result = spawnSync(process.execPath, cli, {
    cwd: WORKSPACE,
    encoding: "utf8",
    timeout: 15000,
    windowsHide: true,
    env: { ...process.env, ZCODE_PROJECT_DIR: WORKSPACE },
  });

  if (result.error) throw new Error(result.error.message);
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || "").trim();
    throw new Error(message || `session-stats exited with code ${result.status}`);
  }

  const data = JSON.parse(result.stdout);
  data.pluginVersion = pluginVersion();
  const auto = autoDisplayState();
  data.autoDisplayEnabled = auto.enabled;
  data.autoDisplayReason = auto.reason;
  const value = {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
  };
  cached = { key, value };
  cachedAt = now;
  return value;
}

function toolsList() {
  return {
    tools: [
      {
        name: TOOL_NAME,
        title: "Session statistics",
        description: "Return session totals and per-turn statistics for the current ZCode session.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description: "Optional session id; defaults to the most recent session in this workspace.",
            },
            includeActive: {
              type: "boolean",
              description: "Include the in-progress turn (default true).",
            },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        _meta: {
          ui: {
            resourceUri: PANEL_URI,
            surface: "turn-lens",
            visibility: ["app"],
          },
        },
      },
      {
        name: AUTO_TOOL_NAME,
        title: "Automatic stats card",
        description:
          "Enable or disable the automatic TurnLens stats card after each turn for all sessions.",
        inputSchema: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
              description: "True to show the card after each turn; false to disable it.",
            },
          },
          required: ["enabled"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
        _meta: {
          ui: {
            visibility: ["app"],
          },
        },
      },
      {
        name: OPEN_TOOL_NAME,
        title: "Open TurnLens panel",
        description:
          "Open the TurnLens side panel. Use only when the user asks to open the session statistics panel.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        _meta: {
          ui: {
            resourceUri: PANEL_URI,
            surface: "turn-lens",
            visibility: ["model"],
            preferredDisplayMode: "fullscreen",
          },
        },
      },
    ],
  };
}

function resourcesList() {
  return {
    resources: [
      {
        uri: PANEL_URI,
        name: "TurnLens Panel",
        mimeType: HTML_MIME,
        _meta: { "zcode/csp": {} },
      },
    ],
  };
}

function handleRequest(message) {
  const { id, method, params } = message;

  switch (method) {
    case "initialize": {
      const protocolVersion = params?.protocolVersion || DEFAULT_PROTOCOL_VERSION;
      reply(id, {
        protocolVersion,
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
        },
        serverInfo: { name: "turn-lens", version: VERSION },
      });
      return;
    }
    case "ping":
      reply(id, {});
      return;
    case "tools/list":
      reply(id, toolsList());
      return;
    case "tools/call": {
      const name = params?.name;
      if (name === AUTO_TOOL_NAME) {
        try {
          const result = setAutoDisplay(params?.arguments?.enabled === true);
          cached = null;
          reply(id, {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result,
            isError: result.ok === false,
          });
        } catch (error) {
          reply(id, {
            content: [{ type: "text", text: JSON.stringify({ ok: false, error: error.message }) }],
            isError: true,
          });
        }
        return;
      }
      if (name === OPEN_TOOL_NAME) {
        reply(id, {
          content: [{ type: "text", text: "TurnLens panel is open." }],
          structuredContent: { ok: true },
        });
        return;
      }
      if (name !== TOOL_NAME) {
        fail(id, -32602, `Unknown tool: ${String(name)}`);
        return;
      }
      try {
        reply(id, sessionStats(params?.arguments));
      } catch (error) {
        reply(id, {
          content: [{ type: "text", text: JSON.stringify({ ok: false, error: error.message }) }],
          isError: true,
        });
      }
      return;
    }
    case "resources/list":
      reply(id, resourcesList());
      return;
    case "resources/templates/list":
      reply(id, { resourceTemplates: [] });
      return;
    case "resources/read": {
      const uri = params?.uri;
      if (uri !== PANEL_URI) {
        fail(id, -32602, `Unknown resource: ${String(uri)}`);
        return;
      }
      try {
        reply(id, {
          contents: [
            {
              uri: PANEL_URI,
              mimeType: HTML_MIME,
              text: readPanel(),
              _meta: { "zcode/csp": {} },
            },
          ],
        });
      } catch (error) {
        fail(id, -32603, `Unable to read panel: ${error.message}`);
      }
      return;
    }
    case "logging/setLevel":
      reply(id, {});
      return;
    case "prompts/list":
      reply(id, { prompts: [] });
      return;
    default:
      fail(id, -32601, `Method not found: ${String(method)}`);
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      log(`Invalid JSON: ${error.message}`);
      continue;
    }
    if (!message || message.jsonrpc !== "2.0") continue;
    if (message.id === undefined || message.id === null) continue; // notification
    try {
      handleRequest(message);
    } catch (error) {
      log(`Request failed: ${error.message}`);
      fail(message.id, -32603, error.message);
    }
  }
});

process.stdin.on("end", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
