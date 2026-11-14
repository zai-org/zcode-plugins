#!/usr/bin/env node
/**
 * Agent formation view for the zcode-context dashboard.
 *
 * Prints one JSON document:
 *   { ok, sessionId, agents: [...], events: [...] }
 *
 * Agents come from the per-agent metadata files stored under the agents dir
 * usage joined from the local database via the child session ids.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { arg, num, openDb, clampText, finish } from "./lib/common.mjs";
import { round2 } from "./lib/pricing.mjs";

function agentsDirOf(sessionId) {
  return path.join(os.homedir(), ".zcode", "cli", "agents", sessionId);
}

function readAgentMetadata(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "metadata.json"), "utf8"));
  } catch {
    return null;
  }
}

function readAgentOutput(dir, max = 4000) {
  for (const name of ["output.txt", "task.output"]) {
    try {
      const text = fs.readFileSync(path.join(dir, name), "utf8");
      if (text) return text.length > max ? `${text.slice(0, max)}…` : text;
    } catch {
      // try next
    }
  }
  return "";
}

async function main() {
  const started = Date.now();
  const sessionId = arg("--session-id") || "";
  if (!sessionId) {
    return { ok: false, error: { code: "bad_args", message: "缺少 --session-id" } };
  }

  const opened = await openDb();
  if (opened.error) return opened;
  const db = opened.db;
  try {
    const session = db.prepare("select * from session where id = ?").get(sessionId);
    if (!session) {
      return {
        ok: false,
        error: { code: "session_missing", message: `会话不存在：${sessionId}` },
      };
    }

    const root = agentsDirOf(sessionId);
    const agents = [];
    if (fs.existsSync(root)) {
      for (const name of fs.readdirSync(root)) {
        const dir = path.join(root, name);
        if (!fs.statSync(dir).isDirectory()) continue;
        const meta = readAgentMetadata(dir);
        if (!meta) continue;
        const childId = String(meta.childSessionId || "");
        const usage = childId
          ? db
              .prepare(
                `select coalesce(sum(computed_total_tokens),0) as tokens,
                        coalesce(sum(duration_ms),0) as active_ms,
                        count(*) as requests,
                        max(started_at) as last_at
                   from model_usage where session_id = ? and status = 'completed'`,
              )
              .get(childId)
          : { tokens: 0, active_ms: 0, requests: 0, last_at: 0 };
        agents.push({
          agentId: String(meta.agentId || name),
          childSessionId: childId,
          profileId: String(meta.profileId || ""),
          profileName: String(meta.profileSnapshot?.name || meta.profileId || ""),
          description: clampText(meta.description || "", 160),
          createdAt: num(Date.parse(meta.createdAt || "") || 0),
          parentToolUseId: String(meta.parentToolUseId || ""),
          tokens: num(usage.tokens),
          activeMs: num(usage.active_ms),
          requests: num(usage.requests),
          lastAt: num(usage.last_at),
          output: readAgentOutput(dir),
        });
      }
    }
    agents.sort((a, b) => a.createdAt - b.createdAt);

    // Cross-agent events: model_usage rows tagged with an agent column or the
    // child sessions' activity, capped for large formations.
    const events = db
      .prepare(
        `select u.started_at, u.model_id, u.session_id, u.agent, u.status,
                u.input_tokens, u.output_tokens
           from model_usage u
          where (u.session_id = ? or u.session_id in (
                   select id from session where parent_id = ?
                 ))
            and u.status in ('completed','error')
          order by u.started_at asc
          limit 400`,
      )
      .all(sessionId, sessionId)
      .map((row) => ({
        at: num(row.started_at),
        sessionId: String(row.session_id),
        agent: String(row.agent || ""),
        modelId: String(row.model_id || ""),
        status: String(row.status || ""),
        inputTokens: num(row.input_tokens),
        outputTokens: num(row.output_tokens),
      }));

    return finish(
      {
        ok: true,
        sessionId,
        sessionTitle: session.title,
        agents,
        events,
      },
      started,
    );
  } finally {
    db.close();
  }
}

try {
  const result = await main();
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      error: { code: "agents_failed", message: error?.message || String(error) },
    }),
  );
  process.exitCode = 1;
}
