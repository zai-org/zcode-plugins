/**
 * Shared helpers for zcode-context query scripts.
 *
 * Everything reads the local ZCode CLI database (read-only). Token estimates
 * for context composition use a chars-per-token heuristic (about 3.5 bytes per
 * token for mixed CJK/ASCII content), clearly marked as estimated in the UI.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function dbPath() {
  return (
    (process.env.ZCONTEXT_USAGE_DB && process.env.ZCONTEXT_USAGE_DB.trim()) ||
    path.join(os.homedir(), ".zcode", "cli", "db", "db.sqlite")
  );
}

export async function openDb() {
  const file = dbPath();
  if (!fs.existsSync(file)) {
    return { error: { code: "db_missing", message: `用量数据库不存在：${file}` } };
  }
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch (error) {
    return {
      error: {
        code: "sqlite_unavailable",
        message: `当前运行时不支持 node:sqlite（${error.message}）。`,
      },
    };
  }
  try {
    return { db: new DatabaseSync(file, { readOnly: true }) };
  } catch (error) {
    return { error: { code: "db_open_failed", message: error.message } };
  }
}

/** Rough token estimate from a UTF-16 string length. Purely heuristic. */
export function tokensOfBytes(chars) {
  return Math.round(chars / 3.5);
}

/** JSON byte size used consistently for composition estimates. */
export function sizeOf(value) {
  if (value === undefined || value === null) return 0;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text ? text.length : 0;
}

export function clampText(value, max = 160) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Role of a message row (message.data JSON has `role`; parts have `type`). */
export function roleOfMessage(data) {
  return String(data.role || "");
}

/** True for synthetic/injected user messages that should not count as turns. */
export function isSyntheticMessage(data) {
  return Boolean(data.synthetic) || data.visibility === "hidden";
}

/** Context-window lookup lives in pricing.mjs; re-export for callers. */
export { windowOfModel } from "./pricing.mjs";

export function workspaceLabel(directory, projectId) {
  const label =
    String(directory || projectId || "")
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() || String(projectId || "default");
  return label;
}

export function finish(result, startedAt) {
  if (result && result.ok === false) return result;
  return { ok: true, ...(result || {}), elapsedMs: Date.now() - startedAt };
}
