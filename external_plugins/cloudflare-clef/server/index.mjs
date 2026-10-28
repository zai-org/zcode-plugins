#!/usr/bin/env node
// Cloudflare CLEF decision evaluation as a ZCode MCP tool.
// Ported from the OpenClaw cloudflare-clef decision provider: the OpenClaw host
// seams (registerDecisionProvider, secret store, guarded fetch) are replaced by
// a dependency-free stdio MCP server with credentials from environment variables.

import { encodeBatch, decodeResponse, UnsupportedInput, InvalidResponse } from "./protocol.mjs";

const SERVER_NAME = "cloudflare-clef";
const SERVER_VERSION = "0.1.0";
const ACCOUNT_PATTERN = /^[a-fA-F0-9]{32}$/;
const REQUEST_TIMEOUT_MS = 55_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

const TOOL = {
  name: "clef_evaluate",
  description:
    "Evaluate structured decision questions against supplied evidence using Cloudflare Workers AI CLEF " +
    "(stronger) or CLEF Flash (faster/cheaper). Returns per-question answers with calibrated probabilities " +
    "instead of free-text guesses. Use for triage/routing/severity judgments over a concrete state. " +
    "Question types: boolean (optional criteria {true,false}); choice (criteria map of 2-255 " +
    "label→description entries); score (criteria array of 2-10 ordered level names, rated 0..n-1). " +
    "state may be any JSON evidence and may embed up to 4 images as data:image/png|jpeg|webp;base64 URLs " +
    "or {content_type,base64} objects.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["questions"],
    properties: {
      model: {
        type: "string",
        enum: ["clef", "clef-flash"],
        default: "clef-flash",
        description: "CLEF model to run. Omit for clef-flash (faster, cheaper).",
      },
      state: {
        description:
          "The evidence to evaluate, as arbitrary JSON (string, array or object). May embed images " +
          "as data URLs or {content_type,base64} objects; total text budget is ~24k bytes.",
      },
      questions: {
        type: "object",
        minProperties: 1,
        maxProperties: 64,
        description:
          "Map of question id → question. Ids may be any string (Chinese, slashes OK) and are echoed " +
          "back in the answers. Example: {\"urgent\": {\"type\": \"boolean\", \"instructions\": \"Is this urgent?\"}}",
        additionalProperties: {
          type: "object",
          additionalProperties: true,
          required: ["type"],
          properties: {
            type: { type: "string", enum: ["boolean", "choice", "score"] },
            instructions: { type: "string", description: "Optional evaluation instruction; each type has a default." },
            criteria: {
              description:
                "boolean: optional {true, false} descriptions. choice: required map of 2-255 label→description. " +
                "score: required array of 2-10 ordered level names.",
            },
          },
        },
      },
    },
  },
};

function credentials() {
  const accountId = typeof process.env.CLOUDFLARE_ACCOUNT_ID === "string" ? process.env.CLOUDFLARE_ACCOUNT_ID : "";
  const apiToken = typeof process.env.CLOUDFLARE_API_TOKEN === "string" ? process.env.CLOUDFLARE_API_TOKEN : "";
  return { accountId, apiToken, ok: ACCOUNT_PATTERN.test(accountId) && apiToken.trim().length > 0 };
}

function errText(message) {
  return { isError: true, content: [{ type: "text", text: message }] };
}

function okText(text) {
  return { content: [{ type: "text", text }] };
}

function setupMessage() {
  return "cloudflare-clef is not configured: run the plugin's server/store-secret.ps1 once to store " +
    "DPAPI-encrypted credentials (or set CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN as user " +
    "environment variables), then fully restart ZCode.";
}

async function cancelBody(response) {
  try { await response.body?.cancel(); } catch {}
}

// Cap successful response bodies too; never log submitted evidence or raw error bodies.
async function readTextLimited(response, limit) {
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      try { await reader.cancel(); } catch {}
      throw new Error("Response body exceeds the adapter's read limit");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function evaluate(callId, args) {
  const { accountId, apiToken, ok } = credentials();
  if (!ok) return errText(setupMessage());

  const model = args?.model === "clef" ? "clef" : "clef-flash";
  let request;
  try {
    request = encodeBatch({ state: args?.state, questions: args?.questions }, model);
  } catch (e) {
    if (e instanceof UnsupportedInput) return errText(`unsupported-input: ${e.message}`);
    throw e;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  activeCalls.set(callId, controller);
  try {
    // Fixed api.cloudflare.com URL by construction: no user-controlled hosts, no redirects.
    const response = await fetch(
      "https://api.cloudflare.com/client/v4/accounts/" + accountId + "/ai/run/@cf/cloudflare/" + model,
      {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: { Authorization: "Bearer " + apiToken, "Content-Type": "application/json" },
        body: request.body,
      }
    );
    if (!response.ok) {
      await cancelBody(response);
      if ([401, 403].includes(response.status)) return errText(`authentication failed (HTTP ${response.status}): check the API token's Workers AI Run permission and account scope`);
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const suffix = Number.isFinite(retryAfter) && retryAfter >= 0 ? `; retry after up to ${Math.min(retryAfter, 60)}s` : "";
        return errText(`rate-limited (HTTP 429)${suffix}`);
      }
      if ([400, 413, 422].includes(response.status)) return errText(`unsupported-input: Cloudflare rejected the request (HTTP ${response.status})`);
      return errText(`transport: Cloudflare API returned HTTP ${response.status}`);
    }
    const text = await readTextLimited(response, MAX_RESPONSE_BYTES);
    let raw;
    try { raw = JSON.parse(text); } catch { return errText("invalid-response: response was not valid JSON"); }
    const result = decodeResponse(raw, request);
    return okText(JSON.stringify(result, null, 2));
  } catch (e) {
    if (e instanceof InvalidResponse) return errText("invalid-response: Cloudflare's decision payload failed validation");
    if (controller.signal.aborted) return errText("transport: request timed out or was cancelled");
    return errText(`transport: ${e && e.message ? e.message : "request failed"}`);
  } finally {
    clearTimeout(timer);
    activeCalls.delete(callId);
  }
}

// --- Minimal dependency-free MCP stdio server (newline-delimited JSON-RPC 2.0). ---

const activeCalls = new Map();

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function handleRequest(msg) {
  const { method, params, id } = msg;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: typeof params?.protocolVersion === "string" && params.protocolVersion ? params.protocolVersion : "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      },
    });
    return;
  }
  if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: [TOOL] } });
    return;
  }
  if (method === "tools/call") {
    if (params?.name !== TOOL.name) {
      send({ jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${String(params?.name)}` } });
      return;
    }
    evaluate(id, params.arguments ?? {}).then(
      (result) => send({ jsonrpc: "2.0", id, result }),
      (e) => send({ jsonrpc: "2.0", id, error: { code: -32603, message: e && e.message ? e.message : "Internal error" } })
    );
    return;
  }
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
}

function handleLine(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return;
  if (msg.id === undefined || msg.id === null) {
    if (msg.method === "notifications/cancelled") {
      // Cancellation is best-effort: only an in-flight fetch has an aborter wired.
      const controller = activeCalls.get(msg.params?.requestId);
      if (controller) controller.abort();
    }
    return;
  }
  handleRequest(msg);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line.trim()) handleLine(line);
  }
});
process.stdin.on("end", () => {
  // Drain in-flight tool calls before exiting; the per-call timeout is the backstop.
  const exitWhenIdle = () => { if (activeCalls.size === 0) process.exit(0); };
  exitWhenIdle();
  setInterval(exitWhenIdle, 100);
});
process.stdin.resume();
