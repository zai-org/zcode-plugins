#!/usr/bin/env node
/**
 * Per-session detail for the zcode-context dashboard.
 *
 * Prints one JSON document:
 *   { ok, session, usage, turns, trend, composition, events, files, stats }
 *
 * The composition is estimated from the message/part tables (char counts and
 * the ~3.5 chars/token heuristic) and clearly marked as an estimate. Events
 * are capped so huge sessions stay responsive.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  arg,
  num,
  openDb,
  sizeOf,
  tokensOfBytes,
  clampText,
  workspaceLabel,
  finish,
} from "./lib/common.mjs";
import { costOfUsage, round2, windowOfModel } from "./lib/pricing.mjs";

const MAX_EVENTS = 400;
const MAX_TREND_POINTS = 400;

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
    const session = db
      .prepare("select * from session where id = ?")
      .get(sessionId);
    if (!session) {
      return {
        ok: false,
        error: { code: "session_missing", message: `会话不存在：${sessionId}` },
      };
    }

    const usage = db
      .prepare(
        `select started_at, completed_at, duration_ms, time_to_first_token_ms,
                provider_id, model_id, query_source, status, finish_reason,
                tool_call_count, input_tokens, output_tokens, reasoning_tokens,
                cache_creation_input_tokens, cache_read_input_tokens,
                computed_total_tokens, retry_count, error_message
           from model_usage
          where session_id = ? and status = 'completed'
          order by started_at asc`,
      )
      .all(sessionId);

    // Turn boundaries (visible user messages) for 轮次 aggregation.
    const turnBoundaries = [];
    try {
      const turnRows = db
        .prepare("select data, time_created from message where session_id = ? order by time_created asc")
        .all(sessionId);
      for (const row of turnRows) {
        try {
          const d = JSON.parse(row.data);
          if (d.role === "user" && !d.synthetic && d.visibility !== "hidden") {
            turnBoundaries.push(num(row.time_created));
          }
        } catch {
          // ignore malformed rows
        }
      }
    } catch {
      // turn boundaries stay empty
    }
    const turnIndexOf = (ts) => {
      let n = 0;
      for (const t of turnBoundaries) if (t <= ts) n += 1;
      return Math.max(1, n);
    };

    // --- Trend: per-request context size (input) and output. ---
    const step = Math.max(1, Math.ceil(usage.length / MAX_TREND_POINTS));
    const trend = [];
    for (let i = 0; i < usage.length; i += step) {
      const rows = usage.slice(i, i + step);
      const input = rows.reduce((acc, r) => acc + num(r.input_tokens), 0) / rows.length;
      const output = rows.reduce((acc, r) => acc + num(r.output_tokens), 0);
      const reasoning = rows.reduce((acc, r) => acc + num(r.reasoning_tokens), 0);
      const cacheRead = rows.reduce((acc, r) => acc + num(r.cache_read_input_tokens), 0);
      const cacheWrite = rows.reduce((acc, r) => acc + num(r.cache_creation_input_tokens), 0);
      trend.push({
        index: i,
        turn: turnIndexOf(num(rows[0].started_at)),
        startedAt: num(rows[0].started_at),
        inputTokens: Math.round(input),
        outputTokens: output,
        reasoningTokens: reasoning,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        cacheRate: input + cacheRead + cacheWrite > 0 ? cacheRead / (input + cacheRead + cacheWrite) : 0,
        durationMs: Math.round(rows.reduce((acc, r) => acc + num(r.duration_ms), 0) / rows.length),
        compact: rows.some((r) => String(r.query_source || "") === "compact"),
      });
    }

    // --- Current context composition (estimate from the last user message's
    // snapshot of system prompt + tools, plus part sizes up to the end). ---
    const snapshotEntry = db
      .prepare(
        `select data from session_entry
          where session_id = ? and type = 'runtime/prompt_snapshot'
          order by time_updated desc limit 1`,
      )
      .get(sessionId);
    const messageTools = db
      .prepare(
        `select data from message
          where session_id = ? and json_extract(data, '$.tools') is not null
          order by time_created desc limit 1`,
      )
      .get(sessionId);

    let systemTokens = 0;
    let toolDefTokens = 0;
    let promptPreview = "";
    let toolNames = [];
    try {
      if (snapshotEntry) {
        const snap = JSON.parse(snapshotEntry.data);
        const system = Array.isArray(snap.system) ? snap.system : [];
        systemTokens = tokensOfBytes(system.reduce((acc, m) => acc + sizeOf(m.content), 0));
        const sysText = system
          .map((m) => (typeof m.content === "string" ? m.content : ""))
          .filter(Boolean)
          .join("\n");
        promptPreview = clampText(sysText, 400);
      }
      if (messageTools) {
        const msg = JSON.parse(messageTools.data);
        toolDefTokens = tokensOfBytes(sizeOf(msg.tools || []));
        toolNames = (msg.tools || [])
          .map((t) => String(t && (t.name || t.function?.name) || ""))
          .filter(Boolean)
          .slice(0, 40);
      }
    } catch {
      // keep zeros; composition stays an estimate
    }

    const partRows = db
      .prepare(
        `select data, time_created from part where session_id = ? order by time_created asc`,
      )
      .all(sessionId);

    const composition = {
      systemPrompt: { tokens: systemTokens, items: systemTokens > 0 ? 1 : 0, estimate: true },
      toolDefs: { tokens: toolDefTokens, items: 0, estimate: true },
      userMessages: { tokens: 0, items: 0, estimate: true },
      assistantText: { tokens: 0, items: 0, estimate: true },
      reasoning: { tokens: 0, items: 0, estimate: true },
      toolResults: { tokens: 0, items: 0, estimate: true },
    };
    let toolDefsSeen = false;
    const events = [];
    const fileMap = new Map();
    const ioCounts = { user: 0, read: 0, write: 0, edit: 0, search: 0, bash: 0, tools: 0 };
    const commandStats = { exec: 0, failed: 0 };
    const toolCount = new Map();

    for (const row of partRows) {
      let part;
      try {
        part = JSON.parse(row.data);
      } catch {
        continue;
      }
      const type = String(part.type || "");
      if (type === "text") {
        const tokens = tokensOfBytes(sizeOf(part.text));
        // assistant text parts appear after a reasoning/tool part; user text
        // parts come directly after a step-start following a user turn — the
        // split below uses the part sequence heuristics from the local store.
        composition.userMessages.tokens += tokens;
        composition.userMessages.items += 1;
        events.push({ kind: "message", role: "user", at: num(row.time_created), text: clampText(part.text, 500) });
      } else if (type === "reasoning") {
        const tokens = tokensOfBytes(sizeOf(part.text));
        composition.reasoning.tokens += tokens;
        composition.reasoning.items += 1;
      } else if (type === "tool") {
        const input = part.state?.input || {};
        const output = part.state?.output;
        const tool = String(part.tool || "?");
        composition.toolResults.tokens += tokensOfBytes(sizeOf(output));
        composition.toolResults.items += 1;
        ioCounts.tools += 1;
        toolCount.set(tool, (toolCount.get(tool) || 0) + 1);
        if (tool === "Bash" || tool === "PowerShell" || tool === "pwsh") {
          ioCounts.bash += 1;
          commandStats.exec += 1;
          if (String(part.state?.status || "") === "error") commandStats.failed += 1;
        }
        if (["WebFetch", "WebSearch", "Grep", "Glob"].includes(tool)) ioCounts.search += 1;
        if (["Read", "Write", "Edit", "NotebookEdit"].includes(tool)) {
          if (tool === "Read") ioCounts.read += 1;
          if (tool === "Write") ioCounts.write += 1;
          if (tool === "Edit") ioCounts.edit += 1;
          const file = String(input.file_path || input.notebook_path || "");
          if (file) {
            const entry = fileMap.get(file) || { file, read: 0, write: 0, edit: 0, at: 0 };
            if (tool === "Read") entry.read += 1;
            if (tool === "Write") entry.write += 1;
            if (tool === "Edit") entry.edit += 1;
            entry.at = Math.max(entry.at, num(row.time_created));
            fileMap.set(file, entry);
          }
        }
        if (events.length < MAX_EVENTS) {
          events.push({
            kind: "tool",
            tool,
            at: num(row.time_created),
            status: String(part.state?.status || ""),
            text: clampText(
              input.command || input.description || input.file_path || input.query || "",
              500,
            ),
          });
        }
      } else if (type === "step-start" && !toolDefsSeen) {
        // nothing; tool defs are taken from the message snapshot above
      }
    }

    // Distinguish user vs assistant text: message roles from the message table.
    const msgRows = db
      .prepare("select data, time_created from message where session_id = ? order by time_created asc")
      .all(sessionId);
    const assistantMsgCount = msgRows.filter((m) => {
      try {
        return JSON.parse(m.data).role === "assistant";
      } catch {
        return false;
      }
    }).length;

    const turnCount = msgRows.filter((m) => {
      try {
        const d = JSON.parse(m.data);
        return d.role === "user" && !d.synthetic && d.visibility !== "hidden";
      } catch {
        return false;
      }
    }).length;

    // Move roughly half of text tokens to the assistant bucket (heuristic).
    const half = Math.round(composition.userMessages.tokens * 0.55);
    composition.assistantText.tokens = half;
    composition.assistantText.items = assistantMsgCount;
    composition.userMessages.tokens -= half;
    ioCounts.user = turnCount;

    // --- 费用构成估算：各类 token 按最近模型牌价折算为 CNY。 ---
    const compPartsForCost = [
      { label: "系统提示词", tokens: composition.systemPrompt.tokens },
      { label: "工具定义", tokens: composition.toolDefs.tokens },
      { label: "用户消息", tokens: composition.userMessages.tokens },
      { label: "助手回复", tokens: composition.assistantText.tokens },
      { label: "思考", tokens: composition.reasoning.tokens },
      { label: "工具结果", tokens: composition.toolResults.tokens },
    ];
    const lastModelForCost = usage.length ? String(usage[usage.length - 1].model_id || "") : "";
    const compCostTotal = compPartsForCost.reduce(
      (acc, g) =>
        acc + costOfUsage({ modelId: lastModelForCost, input: g.tokens, output: 0, cacheRead: 0, cacheWrite: 0 }),
      0,
    );
    const costComposition = {
      totalTokens: compPartsForCost.reduce((acc, g) => acc + g.tokens, 0),
      totalCost: Math.round(compCostTotal * 100000) / 100000,
      parts: compPartsForCost.map((g) => {
        const c =
          costOfUsage({ modelId: lastModelForCost, input: g.tokens, output: 0, cacheRead: 0, cacheWrite: 0 });
        return {
          label: g.label,
          cost: Math.round(c * 100000) / 100000,
          pct: compCostTotal > 0 ? c / compCostTotal : 0,
        };
      }),
    };

    // --- 工具调用 Top（当前会话）。 ---
    const toolTop = [...toolCount.entries()]
      .map(([tool, calls]) => ({ tool, calls }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 10);

    // --- Events: errors, compaction markers. ---
    for (const row of usage) {
      if (String(row.query_source || "") === "compact") {
        events.push({
          kind: "compact",
          at: num(row.started_at),
          text: "上下文压缩（compact）请求",
        });
      }
      if (row.error_message) {
        events.push({
          kind: "error",
          at: num(row.started_at),
          text: clampText(row.error_message, 120),
        });
      }
    }
    events.sort((a, b) => a.at - b.at);

    // --- Stats. ---
    const totalTokens = usage.reduce((acc, r) => acc + (num(r.computed_total_tokens) || 0), 0);
    const cost = usage.reduce(
      (acc, r) =>
        acc +
        costOfUsage({
          modelId: r.model_id,
          input: num(r.input_tokens),
          output: num(r.output_tokens),
          cacheRead: num(r.cache_read_input_tokens),
          cacheWrite: num(r.cache_creation_input_tokens),
        }),
      0,
    );
    const lastUsage = usage[usage.length - 1] || null;
    const lastModelId = lastUsage ? String(lastUsage.model_id) : "";
    const window = windowOfModel(lastModelId);
    const currentContextTokens = lastUsage ? num(lastUsage.input_tokens) : 0;

    // --- 耗时分解（对齐 dsh statsTiming）：模型等待=Σttft；生成时长拆思考/回复
    // （按 reasoning/output token 占比）；工具执行=相邻请求间隙（≤120s）；其他=span−上述。
    let modelWaitMs = 0;
    let genMs = 0;
    let reasoningTokensAll = 0;
    let outputTokensAll = 0;
    for (const r of usage) {
      const ttft = Math.max(0, num(r.time_to_first_token_ms));
      const dur = Math.max(0, num(r.duration_ms));
      modelWaitMs += ttft;
      genMs += Math.max(0, dur - ttft);
      reasoningTokensAll += num(r.reasoning_tokens);
      outputTokensAll += num(r.output_tokens);
    }
    const thinkShare =
      reasoningTokensAll + outputTokensAll > 0
        ? reasoningTokensAll / (reasoningTokensAll + outputTokensAll)
        : 0.2;
    const thinkMs = Math.round(genMs * thinkShare);
    const replyMs = genMs - thinkMs;
    let spanMs = 0;
    {
      let prev = null;
      for (const r of usage) {
        const st = num(r.started_at);
        const en = num(r.completed_at) || st + num(r.duration_ms);
        if (prev !== null && st > prev && st - prev <= 10 * 60 * 1000) spanMs += st - prev;
        spanMs += num(r.duration_ms);
        prev = en;
      }
    }
    let toolMs = 0;
    {
      let prevEnd = null;
      for (const r of usage) {
        const st = num(r.started_at);
        const en = num(r.completed_at) || st + num(r.duration_ms);
        if (prevEnd !== null && st > prevEnd && st - prevEnd <= 600 * 1000) toolMs += st - prevEnd;
        prevEnd = en;
      }
    }
    const timing = {
      modelWaitMs,
      thinkMs,
      replyMs,
      toolMs,
      otherMs: Math.max(0, spanMs - modelWaitMs - genMs - toolMs),
      spanMs,
    };

    const ttft = usage
      .map((r) => num(r.time_to_first_token_ms))
      .filter((v) => v > 0);
    const outputTokens = outputTokensAll;
    const modelMs = usage.reduce((acc, r) => acc + num(r.duration_ms), 0);

    const cacheReadTotal = usage.reduce((acc, r) => acc + num(r.cache_read_input_tokens), 0);
    const cacheWriteTotal = usage.reduce((acc, r) => acc + num(r.cache_creation_input_tokens), 0);
    const inputTotal = usage.reduce((acc, r) => acc + num(r.input_tokens), 0);

    const files = [...fileMap.values()]
      .sort((a, b) => b.read + b.write + b.edit - (a.read + a.write + a.edit))
      .slice(0, 400)
      .map((entry) => ({
        ...entry,
        file: entry.file.replace(/^.*[\\/]/, ""),
        full: entry.file,
      }));

    return finish(
      {
        ok: true,
        session: {
          id: session.id,
          title: session.title,
          directory: session.directory,
          workspace: workspaceLabel(session.directory, session.project_id),
          startedAt: num(session.time_created),
          lastActiveAt: num(session.time_updated),
          additions: num(session.summary_additions),
          deletions: num(session.summary_deletions),
          compacted: Boolean(session.time_compacting),
        },
        turns: turnCount,
        requests: usage.length,
        steps: usage.length,
        usage: usage.map((row) => ({
          startedAt: num(row.started_at),
          completedAt: num(row.completed_at),
          durationMs: num(row.duration_ms),
          ttftMs: num(row.time_to_first_token_ms),
          modelId: String(row.model_id),
          providerId: String(row.provider_id),
          querySource: String(row.query_source || ""),
          inputTokens: num(row.input_tokens),
          outputTokens: num(row.output_tokens),
          reasoningTokens: num(row.reasoning_tokens),
          cacheReadTokens: num(row.cache_read_input_tokens),
          toolCalls: num(row.tool_call_count),
          retryCount: num(row.retry_count),
        })),
        trend,
        composition,
        promptPreview,
        toolNames,
        costComposition,
        ioCounts,
        toolTop,
        events: events.slice(-MAX_EVENTS),
        files,
        stats: {
          totalTokens,
          cost: round2(cost),
          currentContextTokens,
          contextWindow: window,
          cacheReadTokens: cacheReadTotal,
          cacheWriteTokens: cacheWriteTotal,
          cacheRate: inputTotal + cacheReadTotal + cacheWriteTotal > 0
            ? cacheReadTotal / (inputTotal + cacheReadTotal + cacheWriteTotal)
            : 0,
          contextPct: window > 0 ? Math.min(1, currentContextTokens / window) : 0,
          lastModelId,
          modelMs,
          timing,
          commandStats,
          ttftAvgMs: ttft.length ? Math.round(ttft.reduce((a, b) => a + b, 0) / ttft.length) : 0,
          outputSpeed: modelMs > 0 ? Math.round((outputTokens / modelMs) * 1000) : 0,
          compositionTokens: Object.values(composition).reduce((acc, g) => acc + g.tokens, 0),
          estimate: true,
        },
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
      error: { code: "session_failed", message: error?.message || String(error) },
    }),
  );
  process.exitCode = 1;
}
