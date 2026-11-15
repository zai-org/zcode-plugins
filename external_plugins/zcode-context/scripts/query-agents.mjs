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
import { costOfUsage, round2, windowOfModel } from "./lib/pricing.mjs";

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

/** Last assistant text part of a session — the agent's most recent reply. */
function lastReplyOf(db, sessionId, max = 1600) {
  try {
    const row = db
      .prepare(
        `select p.data, p.time_created from part p
           join message m on m.id = p.message_id and m.session_id = p.session_id
          where p.session_id = ? and json_extract(p.data, '$.type') = 'text'
            and json_extract(m.data, '$.role') = 'assistant'
          order by p.time_created desc limit 1`,
      )
      .get(sessionId);
    if (!row) return "";
    const text = String(JSON.parse(row.data).text || "");
    return text.length > max ? text.slice(0, max) + "…" : text;
  } catch {
    // fall back to the newest text part regardless of role
    try {
      const row = db
        .prepare(
          `select data from part where session_id = ? and json_extract(data, '$.type') = 'text'
           order by time_created desc limit 1`,
        )
        .get(sessionId);
      if (!row) return "";
      const text = String(JSON.parse(row.data).text || "");
      return text.length > max ? text.slice(0, max) + "…" : text;
    } catch {
      return "";
    }
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
        let usage = { tokens: 0, active_ms: 0, requests: 0, last_at: 0, cost: 0, context_pct: 0, last_model: "" };
        if (childId) {
          const rows = db
            .prepare(
              `select started_at, duration_ms, input_tokens, output_tokens, cache_read_input_tokens,
                      cache_creation_input_tokens, computed_total_tokens, model_id
                 from model_usage where session_id = ? and status = 'completed'
                order by started_at asc`,
            )
            .all(childId);
          let cost = 0;
          for (const r of rows) {
            cost += costOfUsage({
              modelId: r.model_id,
              input: num(r.input_tokens),
              output: num(r.output_tokens),
              cacheRead: num(r.cache_read_input_tokens),
              cacheWrite: num(r.cache_creation_input_tokens),
            });
          }
          const last = rows[rows.length - 1];
          const lastModel = last ? String(last.model_id || "") : "";
          const win = windowOfModel(lastModel);
          usage = {
            tokens: rows.reduce((a, r) => a + num(r.computed_total_tokens), 0),
            active_ms: rows.reduce((a, r) => a + num(r.duration_ms), 0),
            requests: rows.length,
            last_at: last ? num(last.started_at) : 0,
            cost: round2(cost),
            context_pct: last && win > 0 ? Math.min(1, num(last.input_tokens) / win) : 0,
            last_model: lastModel,
          };
        }
        agents.push({
          agentId: String(meta.agentId || name),
          childSessionId: childId,
          profileId: String(meta.profileId || ""),
          profileName: String(meta.profileSnapshot?.name || meta.profileId || ""),
          description: clampText(meta.description || "", 160),
          createdAt: num(Date.parse(meta.createdAt || "") || 0),
          parentToolUseId: String(meta.parentToolUseId || ""),
          tokens: num(usage.tokens),
          cost: num(usage.cost),
          contextPct: num(usage.context_pct),
          lastModel: usage.last_model,
          activeMs: num(usage.active_ms),
          requests: num(usage.requests),
          lastAt: num(usage.last_at),
          steps: num(usage.requests),
          output: readAgentOutput(dir),
          lastReply: childId ? lastReplyOf(db, childId) : "",
        });
      }
    }
    agents.sort((a, b) => a.createdAt - b.createdAt);

    // 主会话：Token / 费用 / 上下文占比 / 最近回复（用于泳道与"当前"节点卡）。
    const mainRows = db
      .prepare(
        `select started_at, input_tokens, output_tokens, cache_read_input_tokens,
                cache_creation_input_tokens, computed_total_tokens, duration_ms, model_id
           from model_usage where session_id = ? and status = 'completed'
          order by started_at asc`,
      )
      .all(sessionId);
    let mainCost = 0;
    for (const r of mainRows) {
      mainCost += costOfUsage({
        modelId: r.model_id,
        input: num(r.input_tokens),
        output: num(r.output_tokens),
        cacheRead: num(r.cache_read_input_tokens),
        cacheWrite: num(r.cache_creation_input_tokens),
      });
    }
    const lastMain = mainRows[mainRows.length - 1];
    const mainWin = lastMain ? windowOfModel(String(lastMain.model_id || "")) : 0;
    const main = {
      sessionId,
      title: session.title,
      tokens: mainRows.reduce((a, r) => a + num(r.computed_total_tokens), 0),
      cost: round2(mainCost),
      contextPct: lastMain && mainWin > 0 ? Math.min(1, num(lastMain.input_tokens) / mainWin) : 0,
      lastModel: lastMain ? String(lastMain.model_id || "") : "",
      steps: mainRows.length,
      activeMs: mainRows.reduce((a, r) => a + num(r.duration_ms), 0),
      lastReply: lastReplyOf(db, sessionId),
      lastAt: lastMain ? num(lastMain.started_at) : 0,
    };

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
        main,
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
