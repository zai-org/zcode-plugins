#!/usr/bin/env node
/**
 * Session list for the zcode-context dashboard.
 *
 * Prints one JSON document: { ok, sessions: [...] } with per-session usage,
 * sub-agent counts, and last-context usage (estimated from the most recent
 * completed request's input tokens vs. the model window).
 */
import { arg, num, openDb, workspaceLabel, finish } from "./lib/common.mjs";
import { costOfUsage, round2, windowOfModel } from "./lib/pricing.mjs";

async function main() {
  const started = Date.now();
  const now = Date.now();
  const start = num(arg("--start"), now - 7 * 24 * 3600 * 1000);
  const end = num(arg("--end"), now);
  const directory = arg("--directory") || "";
  const order = arg("--order") || "tokens";
  const limit = Math.min(num(arg("--limit"), 60), 120);

  const opened = await openDb();
  if (opened.error) return opened;
  const db = opened.db;
  try {
    const args = [start, end];
    let dirFilter = "";
    if (directory) {
      dirFilter = " and s.directory = ? ";
      args.push(directory);
    }

    const rows = db
      .prepare(
        `select s.id, s.title, s.directory, s.project_id, s.parent_id,
                s.time_created, s.time_updated,
                count(u.id) as requests,
                coalesce(sum(u.computed_total_tokens), 0) as tokens,
                coalesce(sum(u.input_tokens), 0) as input_tokens,
                coalesce(sum(u.output_tokens), 0) as output_tokens,
                coalesce(sum(u.tool_call_count), 0) as tool_calls,
                coalesce(sum(u.duration_ms), 0) as duration_ms,
                coalesce(max(u.started_at), 0) as last_request_at
           from session s
           join model_usage u on u.session_id = s.id and u.status = 'completed'
                             and u.started_at >= ? and u.started_at < ?${dirFilter}
          where s.parent_id is null
            and s.id not like 'sess_subagent%'
            and s.time_deleted is null
          group by s.id`,
      )
      .all(...args);

    // 每会话工具调用列表（排行点击筛选会话卡用）：一次分组 SQL。
    const toolsBySession = new Map();
    try {
      const toolRows = db
        .prepare(
          `select p.session_id, json_extract(p.data, '$.tool') as tool, count(*) as calls
             from part p
             join session s on s.id = p.session_id
            where json_extract(p.data, '$.type') = 'tool'
              and p.time_created >= ? and p.time_created < ?${dirFilter}
            group by p.session_id, tool`,
        )
        .all(...args);
      for (const r of toolRows) {
        const sid = String(r.session_id || "");
        if (!sid) continue;
        const list = toolsBySession.get(sid) || [];
        list.push({ tool: String(r.tool || "?"), calls: num(r.calls) });
        toolsBySession.set(sid, list);
      }
      for (const list of toolsBySession.values()) {
        list.sort((a, b) => b.calls - a.calls);
        list.length = Math.min(list.length, 8);
      }
    } catch {
      // tool lists stay empty; filtering by tool then yields nothing
    }

    const sessions = rows.map((row) => {
      const last = db
        .prepare(
          `select model_id, input_tokens, completed_at
             from model_usage
            where session_id = ? and status = 'completed'
            order by started_at desc limit 1`,
        )
        .get(row.id);
      const children = db
        .prepare("select count(*) as c from session where parent_id = ?")
        .get(row.id).c;
      const modelId = last ? String(last.model_id) : "";
      const contextTokens = last ? num(last.input_tokens) : 0;
      const window = windowOfModel(modelId);
      return {
        id: String(row.id),
        title: String(row.title || row.id),
        directory: String(row.directory || ""),
        workspace: workspaceLabel(row.directory, row.project_id),
        startedAt: num(row.time_created),
        lastActiveAt: Math.max(num(row.time_updated), num(row.last_request_at)),
        requests: num(row.requests),
        steps: num(row.requests),
        tools: toolsBySession.get(String(row.id)) || [],
        tokens: num(row.tokens),
        cost: round2(
          costOfUsage({
            modelId: modelId,
            input: num(row.input_tokens),
            output: num(row.output_tokens),
          }),
        ),
        toolCalls: num(row.tool_calls),
        activeMs: num(row.duration_ms),
        subAgents: num(children.c ?? children),
        contextTokens,
        contextWindow: window,
        contextPct: window > 0 && last ? Math.min(1, contextTokens / window) : 0,
        lastModelId: modelId,
        compacted: Boolean(
          db
            .prepare("select time_compacting from session where id = ?")
            .get(row.id)?.time_compacting,
        ),
      };
    });

    sessions.sort((a, b) => {
      if (order === "recent") return b.lastActiveAt - a.lastActiveAt;
      if (order === "context") return b.contextPct - a.contextPct;
      return b.tokens - a.tokens;
    });

    return finish({ ok: true, sessions: sessions.slice(0, limit) }, started);
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
      error: { code: "sessions_failed", message: error?.message || String(error) },
    }),
  );
  process.exitCode = 1;
}
