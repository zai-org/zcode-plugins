#!/usr/bin/env node
/**
 * Overview aggregation for the zcode-context dashboard.
 *
 * Prints one JSON document:
 *   { ok, range, summary, series, heatmap, tools, commands, models, projects, sessions }
 *
 * Reads the local ZCode CLI database (read-only) and keeps everything in
 * local time so numbers match what the user sees elsewhere in the app.
 */
import {
  arg,
  num,
  openDb,
  clampText,
  workspaceLabel,
  finish,
} from "./lib/common.mjs";
import { costOfUsage, round2 } from "./lib/pricing.mjs";

function dayExpr(columnMs) {
  return `strftime('%Y-%m-%d', ${columnMs} / 1000, 'unixepoch', 'localtime')`;
}

function costOfUsageRow(row) {
  return costOfUsage({
    modelId: row.model_id,
    input: num(row.input_tokens),
    output: num(row.output_tokens),
    cacheRead: num(row.cache_read_input_tokens),
    cacheWrite: num(row.cache_creation_input_tokens),
  });
}

async function main() {
  const started = Date.now();
  const now = Date.now();
  const start = num(arg("--start"), now - 7 * 24 * 3600 * 1000);
  const end = num(arg("--end"), now);
  const directory = arg("--directory") || "";

  const opened = await openDb();
  if (opened.error) return opened;
  const db = opened.db;
  try {
    const rangeArgs = [start, end];
    let sessionFilter = "";
    if (directory) {
      sessionFilter = " and s.directory = ? ";
      rangeArgs.push(directory);
    }

    const usageRows = db
      .prepare(
        `select u.session_id, u.provider_id, u.model_id, u.query_source, u.status,
                u.duration_ms, u.time_to_first_token_ms, u.tool_call_count,
                u.input_tokens, u.output_tokens, u.reasoning_tokens,
                u.cache_creation_input_tokens, u.cache_read_input_tokens,
                u.computed_total_tokens, u.retry_count, u.started_at
           from model_usage u
           join session s on s.id = u.session_id
          where u.status = 'completed' and u.started_at >= ? and u.started_at < ?${sessionFilter}
          order by u.started_at asc`,
      )
      .all(...rangeArgs);

    // 耗时统计：模型等待 = Σduration（按 ttft 拆等待/生成，生成再按 reasoning
    // token 占比拆思考/回复）；工具执行 ≈ 相邻请求之间的空闲间隔（下限 0）。
    const timeStats = {
      modelWaitMs: 0,
      thinkMs: 0,
      replyMs: 0,
      toolMs: 0,
      otherMs: 0,
      spanMs: 0,
      outputSpeed: 0,
    };
    {
      let prevEnd = null;
      let prevSid = null;
      let ttftMs = 0;
      let reasoningAll = 0;
      let outputAll = 0;
      const sessionSpan = new Map();
      for (const row of usageRows) {
        const dur = num(row.duration_ms);
        ttftMs += Math.max(0, num(row.time_to_first_token_ms));
        reasoningAll += num(row.reasoning_tokens);
        outputAll += num(row.output_tokens);
        const st = num(row.started_at);
        const en = num(row.completed_at) || st + dur;
        const sid = row.session_id;
        const gap = prevEnd !== null && st > prevEnd ? st - prevEnd : 0;
        if (gap > 0 && gap <= 600 * 1000) timeStats.toolMs += gap;
        const span = sessionSpan.get(sid) || { span: 0, last: st, prev: null };
        if (span.prev !== null) {
          const g = st - span.prev;
          if (g <= 10 * 60 * 1000) span.span += g;
        }
        span.span += dur;
        span.prev = en;
        sessionSpan.set(sid, span);
        prevEnd = en;
        prevSid = sid;
      }
      for (const span of sessionSpan.values()) {
        timeStats.spanMs += span.span;
      }
      const genMs = Math.max(0, timeStats.modelWaitMs - ttftMs);
      const thinkShare = reasoningAll + outputAll > 0 ? reasoningAll / (reasoningAll + outputAll) : 0.2;
      timeStats.modelWaitMs = ttftMs;
      timeStats.thinkMs = Math.round(genMs * thinkShare);
      timeStats.replyMs = genMs - timeStats.thinkMs;
      timeStats.otherMs = Math.max(
        0,
        timeStats.spanMs - timeStats.modelWaitMs - genMs - timeStats.toolMs,
      );
    }

    // 命令执行 Top：取 Bash 命令的首词；同时统计总执行/失败次数。
    const commandMap = new Map();
    const commandStats = { exec: 0, failed: 0 };
    try {
      const cmdRows = db
        .prepare(
          `select json_extract(p.data, '$.state.input.command') as cmd,
                  json_extract(p.data, '$.state.status') as status
             from part p
             join session s on s.id = p.session_id
            where json_extract(p.data, '$.type') = 'tool'
              and json_extract(p.data, '$.tool') in ('Bash','PowerShell','pwsh')
              and p.time_created >= ? and p.time_created < ?${sessionFilter}
            limit 4000`,
        )
        .all(...rangeArgs);
      for (const r of cmdRows) {
        commandStats.exec += 1;
        if (String(r.status || "") === "error") commandStats.failed += 1;
        const first = String(r.cmd || "").trim().split(/\s+/)[0]?.replace(/^["']|["']$/g, "");
        if (!first) continue;
        commandMap.set(first, (commandMap.get(first) || 0) + 1);
      }
    } catch {
      // command breakdown is best-effort
    }
    const commands = [...commandMap.entries()]
      .map(([cmd, calls]) => ({ cmd, calls }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 10);

    const summary = {
      sessions: 0,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      cost: 0,
      cacheHitRate: 0,
      toolCalls: 0,
      commandExec: 0,
      activeMs: 0,
      outputSpeed: 0,
      unknownPriceRequests: 0,
    };
    const seriesMap = new Map();
    const modelMap = new Map();
    const projectMap = new Map();
    const sessionMap = new Map();
    let cacheReadTotal = 0;
    let inputTotal = 0;
    let outputTotal = 0;
    let outputMs = 0;

    const sessionStmt = db.prepare(
      "select id, title, directory, project_id, time_created, time_updated from session where id = ?",
    );
    const lastTextStmt = db.prepare(
      `select data from part
        where session_id = ? and json_extract(data, '$.type') = 'text'
        order by time_created desc limit 1`,
    );
    const dayStmt = db.prepare(
      "select strftime('%Y-%m-%d', ? / 1000, 'unixepoch', 'localtime') as d",
    );

    for (const row of usageRows) {
      const input = num(row.input_tokens);
      const output = num(row.output_tokens);
      const total = num(row.computed_total_tokens) || input + output;
      const cost = costOfUsageRow(row);
      const modelKey = row.model_id;

      summary.requests += 1;
      summary.inputTokens += input;
      summary.outputTokens += output;
      summary.reasoningTokens += num(row.reasoning_tokens);
      summary.cacheReadTokens += num(row.cache_read_input_tokens);
      summary.cacheWriteTokens += num(row.cache_creation_input_tokens);
      summary.totalTokens += total;
      summary.cost += cost;
      summary.toolCalls += num(row.tool_call_count);
      summary.activeMs += num(row.duration_ms);
      cacheReadTotal += num(row.cache_read_input_tokens);
      inputTotal += input;
      outputTotal += output;
      outputMs += num(row.duration_ms);

      const bucket = dayStmt.get(row.started_at).d;
      const seriesEntry = seriesMap.get(bucket) || {
        key: bucket,
        tokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        requests: 0,
      };
      seriesEntry.tokens += total;
      seriesEntry.inputTokens += input;
      seriesEntry.outputTokens += output;
      seriesEntry.cost += cost;
      seriesEntry.requests += 1;
      seriesMap.set(bucket, seriesEntry);

      const model = modelMap.get(modelKey) || {
        modelId: modelKey,
        providerId: String(row.provider_id || ""),
        tokens: 0,
        cost: 0,
        requests: 0,
        unknown: false,
      };
      model.tokens += total;
      model.cost += cost;
      model.requests += 1;
      modelMap.set(modelKey, model);

      const sess = sessionStmt.get(row.session_id);
      if (sess) {
        summary.sessions += sessionMap.has(sess.id) ? 0 : 1;
        const card = sessionMap.get(sess.id) || {
          id: sess.id,
          title: sess.title,
          directory: sess.directory,
          workspace: workspaceLabel(sess.directory, sess.project_id),
          startedAt: num(sess.time_created),
          lastActiveAt: num(sess.time_updated),
          tokens: 0,
          cost: 0,
          requests: 0,
          toolCalls: 0,
        };
        card.tokens += total;
        card.cost += cost;
        card.requests += 1;
        card.toolCalls += num(row.tool_call_count);
        card.lastActiveAt = Math.max(card.lastActiveAt, num(row.started_at));
        sessionMap.set(sess.id, card);
      }
    }

    summary.cost = round2(summary.cost);
    summary.cacheHitRate = inputTotal > 0 ? cacheReadTotal / inputTotal : 0;
    summary.outputSpeed = outputMs > 0 ? Math.round((outputTotal / outputMs) * 1000) : 0;
    timeStats.outputSpeed = summary.outputSpeed;

    // Tool/command rankings come from the part table (authoritative).
    const toolRows = db
      .prepare(
        `select json_extract(p.data, '$.tool') as tool, count(*) as calls
           from part p
           join session s on s.id = p.session_id
          where json_extract(p.data, '$.type') = 'tool'
            and p.time_created >= ? and p.time_created < ?${sessionFilter}
          group by tool
          order by calls desc
          limit 12`,
      )
      .all(...rangeArgs);
    const tools = toolRows.map((row) => ({
      tool: String(row.tool || "?"),
      calls: num(row.calls),
    }));
    summary.commandExec = num(
      (
        db
          .prepare(
            `select count(*) as c from part p join session s on s.id = p.session_id
              where json_extract(p.data, '$.type') = 'tool'
                and json_extract(p.data, '$.tool') in ('Bash','PowerShell','pwsh')
                and p.time_created >= ? and p.time_created < ?${sessionFilter}`,
          )
          .get(...rangeArgs) || {}
      ).c,
    );

    // Models aggregated without the probe rows used above.
    const models = [...modelMap.values()]
      .map((entry) => ({ ...entry, cost: round2(entry.cost) }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 10);

    // Projects
    const projectRows = db
      .prepare(
        `select s.directory, s.project_id,
                count(distinct s.id) as sessions,
                coalesce(sum(u.computed_total_tokens),0) as tokens
           from model_usage u
           join session s on s.id = u.session_id
          where u.status = 'completed' and u.started_at >= ? and u.started_at < ?${sessionFilter}
          group by s.directory, s.project_id
          order by tokens desc
          limit 12`,
      )
      .all(...rangeArgs);
    const projects = projectRows.map((row) => ({
      directory: String(row.directory || ""),
      workspace: workspaceLabel(row.directory, row.project_id),
      sessions: num(row.sessions),
      tokens: num(row.tokens),
    }));

    // Heatmap: per-day tokens + sessions for the trailing 8 weeks.
    const heatRows = db
      .prepare(
        `select ${dayExpr("u.started_at")} as day,
                count(distinct u.session_id) as sessions,
                coalesce(sum(u.computed_total_tokens),0) as tokens
           from model_usage u
           join session s on s.id = u.session_id
          where u.status = 'completed' and u.started_at >= ? and u.started_at < ?${sessionFilter}
          group by day`,
      )
      .all(start - 7 * 24 * 3600 * 1000, end, ...(directory ? [directory] : []));
    const heatmap = heatRows.map((row) => ({
      day: String(row.day || ""),
      sessions: num(row.sessions),
      tokens: num(row.tokens),
    }));

    const series = [...seriesMap.values()]
      .map((entry) => ({ ...entry, cost: round2(entry.cost) }))
      .sort((a, b) => (a.key < b.key ? -1 : 1));

    // 每会话工具列表（供排行行点击筛选会话卡）。
    const toolsBySession = new Map();
    try {
      const toolRows = db
        .prepare(
          `select p.session_id, json_extract(p.data, '$.tool') as tool, count(*) as calls
             from part p
             join session s on s.id = p.session_id
            where json_extract(p.data, '$.type') = 'tool'
              and p.time_created >= ? and p.time_created < ?${sessionFilter}
            group by p.session_id, tool`,
        )
        .all(start, end);
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
      // tool lists stay empty
    }

    // Session cards (top 24 by tokens) with a last-message snippet.
    const sessionCards = [...sessionMap.values()]
      .sort((a, b) => b.tokens - a.tokens || b.lastActiveAt - a.lastActiveAt)
      .slice(0, 24)
      .map((card) => {
        const last = lastTextStmt.get(card.id);
        let snippet = "";
        if (last) {
          try {
            snippet = clampText(JSON.parse(last.data).text || "");
          } catch {
            snippet = "";
          }
        }
        return { ...card, cost: round2(card.cost), lastMessage: snippet, tools: toolsBySession.get(card.id) || [] };
      });

    return finish(
      {
        ok: true,
        range: { start, end, directory: directory || "all" },
        summary,
        timeStats,
        commandStats,
        series,
        heatmap,
        tools,
        commands,
        models,
        projects,
        sessions: sessionCards,
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
      error: { code: "overview_failed", message: error?.message || String(error) },
    }),
  );
  process.exitCode = 1;
}
