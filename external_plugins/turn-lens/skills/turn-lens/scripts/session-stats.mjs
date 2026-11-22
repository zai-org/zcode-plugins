#!/usr/bin/env node
/**
 * session-stats.mjs
 *
 * Read-only statistics for a ZCode session.
 *
 * Data source: the local ZCode session database (default ~/.zcode/cli/db/db.sqlite).
 * Tables used:
 *   turn_usage  - one row per finished turn (wall time, TTFT, tool count, tokens)
 *   tool_usage  - one row per tool call (start/end, duration, status)
 *   model_usage - one row per model request (TTFT, duration, output tokens, query source)
 *
 * Metrics:
 *   turns       distinct turn ids in the usage tables
 *   steps       tool calls (deduplicated by tool_call_id)
 *   model time  per-turn wall time minus the union of tool execution intervals
 *   tool time   union of tool execution intervals (parallel tools counted once)
 *   TTFT        mean time_to_first_token_ms over completed main-turn requests
 *   TPS         output tokens / (request duration - TTFT), summed per request
 *
 * Only query_source='main_turn' requests are counted; title generation,
 * compaction and subagent sessions are excluded.
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

const HELP = `session-stats - 展示 ZCode 会话统计

用法:
  node session-stats.mjs [选项]

选项:
  --session <id>       指定会话 ID（省略时选当前工作区最近更新的会话）
  --workspace <dir>    覆盖工作区目录（默认 $ZCODE_PROJECT_DIR 或当前目录）
  --db <path>          覆盖会话数据库路径
  --include-active     包含进行中的轮次（默认只统计已完成的轮次）
  --auto               自动展示模式：包含当前轮并把它视为刚完成（供 Stop hook 使用）
  --session-totals     显示整个会话的累计统计（默认显示最新一轮）
  --details            追加每轮明细表
  --json               输出 JSON 而不是 Markdown
  -h, --help           显示帮助
`;

const NUMBER_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  console.error("会话统计失败：当前 Node 运行时不支持 node:sqlite（需要 Node 22.5+）。请升级 Node 后重试。");
  process.exit(1);
}

let opts = { json: false };

try {
  opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
  } else {
    const result = collect(opts);
    console.log(opts.json ? JSON.stringify(result, null, 2) : renderMarkdown(result, opts));
  }
} catch (error) {
  const message = error?.userMessage || error?.message || String(error);
  if (opts.json) {
    console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  } else {
    console.error(`会话统计失败：${message}`);
  }
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Arguments and paths
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const parsed = {
    json: false,
    details: false,
    includeActive: false,
    sessionTotals: false,
    auto: false,
    help: false,
    session: null,
    workspace: null,
    db: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") parsed.json = true;
    else if (arg === "--details") parsed.details = true;
    else if (arg === "--include-active") parsed.includeActive = true;
    else if (arg === "--session-totals") parsed.sessionTotals = true;
    else if (arg === "--auto") {
      parsed.auto = true;
      parsed.includeActive = true;
    } else if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--session") parsed.session = takeValue(argv, (i += 1), "--session");
    else if (arg.startsWith("--session=")) parsed.session = arg.slice("--session=".length);
    else if (arg === "--workspace") parsed.workspace = takeValue(argv, (i += 1), "--workspace");
    else if (arg.startsWith("--workspace=")) parsed.workspace = arg.slice("--workspace=".length);
    else if (arg === "--db") parsed.db = takeValue(argv, (i += 1), "--db");
    else if (arg.startsWith("--db=")) parsed.db = arg.slice("--db=".length);
    else if (arg.startsWith("-")) fail(`未知参数：${arg}（用 --help 查看用法）`);
    else if (!parsed.session) parsed.session = arg;
    else fail(`多余参数：${arg}`);
  }

  return parsed;
}

function takeValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("-")) fail(`${flag} 需要一个值`);
  return value;
}

function fail(message) {
  const error = new Error(message);
  error.userMessage = message;
  throw error;
}

function resolveDbPath(opts) {
  if (opts.db) {
    const explicit = path.resolve(opts.db);
    if (!existsSync(explicit)) fail(`找不到会话数据库：${explicit}（--db）`);
    return explicit;
  }

  const envValue = (process.env.ZCODE_SESSION_DB_PATH || process.env.ZCODE_SESSION_DB || "").trim();
  if (envValue) {
    const fromEnv = path.resolve(envValue);
    if (!existsSync(fromEnv)) fail(`找不到会话数据库：${fromEnv}（ZCODE_SESSION_DB_PATH）`);
    return fromEnv;
  }

  const fallback = path.join(homedir(), ".zcode", "cli", "db", "db.sqlite");
  if (!existsSync(fallback)) {
    fail(`找不到会话数据库：${fallback}。可以用 --db <path> 指定。`);
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

function collect(opts) {
  const dbPath = resolveDbPath(opts);
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (error) {
    fail(`无法以只读方式打开会话数据库：${dbPath}\n${error.message}`);
  }

  try {
    requireTables(db);
    const workspace = path.resolve(opts.workspace || process.env.ZCODE_PROJECT_DIR || process.cwd());
    const { row: session, warnings } = pickSession(db, opts, workspace);
    const statistics = collectSession(db, session, opts);
    return {
      ok: true,
      generatedAt: formatClock(new Date()),
      dbPath,
      workspace,
      warnings,
      ...statistics,
    };
  } finally {
    db.close();
  }
}

function requireTables(db) {
  const required = ["session", "turn_usage", "tool_usage", "model_usage"];
  const present = new Set(
    db.prepare("select name from sqlite_master where type = 'table'").all().map((row) => row.name),
  );
  const missing = required.filter((name) => !present.has(name));
  if (missing.length > 0) {
    fail(`会话数据库缺少表：${missing.join("、")}。可能来自较旧的 ZCode 版本，请升级 ZCode 后重试。`);
  }
}

function pickSession(db, opts, workspace) {
  const columns = "id, title, directory, time_created, time_updated";

  if (opts.session) {
    let row = db
      .prepare(`select ${columns} from session where id = ? and coalesce(time_deleted, 0) = 0`)
      .get(opts.session);
    if (!row) {
      row = db
        .prepare(
          `select ${columns} from session
           where id like ? and coalesce(time_deleted, 0) = 0
           order by time_updated desc limit 1`,
        )
        .get(`${opts.session}%`);
    }
    if (!row) fail(`找不到会话：${opts.session}`);
    return { row, warnings: [] };
  }

  const rows = db
    .prepare(
      `select ${columns} from session
       where coalesce(time_deleted, 0) = 0
         and id not like 'sess_subagent_%'
       order by time_updated desc
       limit 200`,
    )
    .all();
  if (rows.length === 0) fail("会话数据库里没有可用会话。");

  const sameWorkspace = rows.filter((row) => sameDirectory(row.directory, workspace));
  const pool = sameWorkspace.length > 0 ? sameWorkspace : rows;
  const hasUsage = db.prepare("select 1 as ok from model_usage where session_id = ? limit 1");
  const row = pool.find((candidate) => Boolean(hasUsage.get(candidate.id))) || pool[0];

  const warnings = [];
  if (sameWorkspace.length === 0) {
    warnings.push(`当前工作区没有匹配的会话，已回退到最近更新的会话（${row.directory || "未知目录"}）`);
  }
  return { row, warnings };
}

function collectSession(db, session, opts) {
  const sessionId = session.id;
  const turnRows = db
    .prepare(
      `select turn_id, status, started_at, completed_at, duration_ms,
              time_to_first_token_ms, tool_call_count, model_request_count,
              input_tokens, output_tokens, tool_error_count, user_message_id
       from turn_usage where session_id = ?`,
    )
    .all(sessionId);
  const modelRows = db
    .prepare(
      `select turn_id, logical_request_id, status, started_at, completed_at,
              duration_ms, time_to_first_token_ms, input_tokens, output_tokens,
              reasoning_tokens, cache_read_input_tokens, cache_creation_input_tokens,
              parent_user_message_id
       from model_usage
       where session_id = ? and attempt_index = 0
         and coalesce(query_source, 'main_turn') not in ('session_title', 'compact')`,
    )
    .all(sessionId);
  const toolRows = db
    .prepare(
      `select turn_id, tool_call_id, tool_name, status, started_at, completed_at, duration_ms
       from tool_usage where session_id = ?`,
    )
    .all(sessionId);
  const guidedRows = loadGuidedInputs(db, sessionId);

  const finalTurns = new Map();
  for (const row of turnRows) {
    if (row.turn_id && isFinalStatus(row.status)) finalTurns.set(row.turn_id, row);
  }

  const modelsByTurn = groupByTurn(modelRows);
  const toolsByTurn = groupByTurn(toolRows);
  const userMessageIds = new Set();
  for (const row of turnRows) {
    if (row.user_message_id) userMessageIds.add(row.user_message_id);
  }
  for (const row of modelRows) {
    if (row.parent_user_message_id) userMessageIds.add(row.parent_user_message_id);
  }
  const userTextById = loadUserTexts(db, [...userMessageIds]);
  const allTurnIds = new Set([...finalTurns.keys(), ...modelsByTurn.keys(), ...toolsByTurn.keys()]);
  const activeTurnIds = [...allTurnIds].filter((turnId) => !finalTurns.has(turnId));
  const includedTurnIds = opts.includeActive
    ? [...allTurnIds]
    : [...allTurnIds].filter((turnId) => finalTurns.has(turnId));

  const turns = includedTurnIds
    .map((turnId) => {
      const turn = buildTurn(
        turnId,
        finalTurns.get(turnId),
        modelsByTurn.get(turnId) || [],
        toolsByTurn.get(turnId) || [],
      );
      const userMessageId =
        finalTurns.get(turnId)?.user_message_id ||
        modelsByTurn.get(turnId)?.[0]?.parent_user_message_id ||
        null;
      const userText = userMessageId ? userTextById.get(userMessageId) || "" : "";
      const usage = finalTurns.get(turnId);
      const turnEnd =
        finiteOrNull(usage?.completed_at) ?? turn.completedAt ?? Date.now();
      const guided = guidedRows.filter(
        (item) =>
          turn.startedAt !== null && item.at >= turn.startedAt && item.at <= turnEnd,
      );
      const guidedText = guided.map((item) => item.text).filter(Boolean).join("\n");
      const combinedText = [userText, guidedText].filter(Boolean).join("\n");
      const lastGuidedAt = guided.length > 0 ? guided[guided.length - 1].at : null;
      const lastSegmentMs =
        lastGuidedAt !== null && turnEnd >= lastGuidedAt ? turnEnd - lastGuidedAt : null;
      return {
        ...turn,
        userMessageId,
        userInputChars: combinedText ? Array.from(combinedText).length : 0,
        userInputTokens: combinedText ? estimateTokens(combinedText) : null,
        guidedInputs: guided.length,
        guidedInputTokens: guidedText ? estimateTokens(guidedText) : null,
        lastGuidedAt,
        // ZCode splits a turn at promoted guided inputs and shows the latest
        // segment's wall-clock work time. Keep that number separate from the
        // whole-turn model time.
        lastSegmentMs,
      };
    })
    .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
    .map((turn, index) => ({ index: index + 1, ...turn }));

  // Context delta compares the peak context of this turn with the previous
  // turn that actually had model usage. The first comparable turn keeps null.
  let previousContext = null;
  for (const turn of turns) {
    const contextTokens =
      Number.isFinite(turn.contextTokens) && turn.contextTokens > 0 ? turn.contextTokens : null;
    turn.contextDelta =
      previousContext !== null && contextTokens !== null ? contextTokens - previousContext : null;
    turn.compressed = turn.contextDelta !== null && turn.contextDelta < 0;
    if (contextTokens !== null) previousContext = contextTokens;
  }

  if (opts.auto) {
    // The Stop hook runs before turn_usage is finalized, so the current turn is
    // still "active". For display purposes, treat the latest active turn as the
    // turn that just finished.
    const latest = turns[turns.length - 1];
    if (latest?.active) {
      latest.active = false;
      latest.status = "completed";
      latest.completedAt = Date.now();
    }
  }

  const includedIdSet = new Set(includedTurnIds);
  const includedModels = modelRows.filter((row) => row.turn_id && includedIdSet.has(row.turn_id));
  const speed = computeSpeed(includedModels);
  const inputTokens = sumBy(includedModels, (row) => numberOrZero(row.input_tokens));
  const outputTokens = sumBy(includedModels, (row) => numberOrZero(row.output_tokens));
  const cacheReadTokens = sumBy(includedModels, (row) => numberOrZero(row.cache_read_input_tokens));
  const cacheHitRate =
    inputTokens > 0 ? Math.min(1, Math.max(0, cacheReadTokens / inputTokens)) : null;

  const totals = {
    turns: turns.length,
    steps: sumBy(turns, (turn) => turn.steps),
    modelMs: sumBy(turns, (turn) => turn.modelMs),
    toolMs: sumBy(turns, (turn) => turn.toolMs),
    wallMs: sumBy(turns, (turn) => turn.wallMs),
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cacheReadTokens,
    cacheHitRate,
    requests: includedModels.length,
    errors: sumBy(turns, (turn) => turn.errors),
    guidedInputs: sumBy(turns, (turn) => turn.guidedInputs || 0),
    avgTtftMs: speed.avgTtftMs,
    tps: speed.tps,
  };

  return {
    session: {
      id: session.id,
      title: session.title || null,
      directory: session.directory || null,
      timeCreated: toIso(session.time_created),
      timeUpdated: toIso(session.time_updated),
    },
    totals,
    turns,
    includeActive: Boolean(opts.includeActive),
    activeTurnCount: opts.auto
      ? Math.max(0, activeTurnIds.length - 1)
      : activeTurnIds.length,
    empty: turns.length === 0,
  };
}

function loadGuidedInputs(db, sessionId) {
  try {
    const rows = db
      .prepare(
        `select status, payload, time_created, time_updated
         from session_input
         where session_id = ? and delivery = 'guide'`,
      )
      .all(sessionId);
    const result = [];
    for (const row of rows) {
      // Only a promoted guide starts a new work segment in ZCode. A pending
      // guide has not affected the turn timeline yet.
      if (String(row.status) !== "promoted") continue;
      const at = finiteOrNull(row.time_updated) ?? finiteOrNull(row.time_created);
      if (at === null) continue;
      let payload = null;
      try {
        payload = JSON.parse(row.payload || "null");
      } catch {
        payload = null;
      }
      const text = typeof payload?.text === "string" ? payload.text : "";
      result.push({ at, text });
    }
    return result.sort((a, b) => a.at - b.at);
  } catch {
    // Older databases may not have session_input yet; guided inputs are then
    // simply unknown and the turn is treated as a single segment.
    return [];
  }
}

function loadUserTexts(db, ids) {
  const result = new Map();
  if (ids.length === 0) return result;
  const placeholders = ids.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `select message_id, data from part
       where message_id in (${placeholders})
       order by message_id, sequence`,
    )
    .all(...ids);
  for (const row of rows) {
    let data;
    try {
      data = JSON.parse(row.data);
    } catch {
      continue;
    }
    if (data?.type !== "text" || typeof data.text !== "string") continue;
    const previous = result.get(row.message_id) || "";
    result.set(row.message_id, previous ? `${previous}\n${data.text}` : data.text);
  }
  return result;
}

function estimateTokens(text) {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    if (/[\u3400-\u9fff\uf900-\ufaff]/.test(char)) cjk += 1;
    else other += 1;
  }
  return Math.max(1, Math.round(cjk + other / 4));
}

function buildTurn(turnId, usage, models, tools) {
  const starts = [];
  const ends = [];
  if (Number.isFinite(usage?.started_at)) starts.push(usage.started_at);
  if (Number.isFinite(usage?.completed_at)) ends.push(usage.completed_at);
  for (const model of models) {
    if (Number.isFinite(model.started_at)) starts.push(model.started_at);
    if (Number.isFinite(model.completed_at)) ends.push(model.completed_at);
  }
  for (const tool of tools) {
    if (Number.isFinite(tool.started_at)) starts.push(tool.started_at);
    if (Number.isFinite(tool.completed_at)) ends.push(tool.completed_at);
  }

  const startedAt = starts.length > 0 ? Math.min(...starts) : null;
  const completedAt = ends.length > 0 ? Math.max(...ends) : null;
  const active = !usage || !isFinalStatus(usage.status);
  const explicitWall = active ? null : finiteOrNull(usage?.duration_ms);
  let wallMs;
  if (explicitWall !== null) {
    wallMs = Math.max(0, explicitWall);
  } else if (startedAt != null) {
    const endMs = active ? Date.now() : completedAt;
    wallMs = Math.max(0, (endMs ?? Date.now()) - startedAt);
  } else {
    wallMs = 0;
  }

  const now = Date.now();
  const intervals = [];
  const modelIntervals = [];
  const toolIds = new Set();
  let anonymousTools = 0;
  let errors = 0;
  for (const model of models) {
    if (!Number.isFinite(model.started_at)) continue;
    const end = Number.isFinite(model.completed_at) ? model.completed_at : now;
    if (end > model.started_at) modelIntervals.push([model.started_at, end]);
  }
  for (const tool of tools) {
    if (tool.tool_call_id) toolIds.add(tool.tool_call_id);
    else anonymousTools += 1;
    if (String(tool.status) === "error") errors += 1;
    if (!Number.isFinite(tool.started_at)) continue;
    const end = Number.isFinite(tool.completed_at) ? tool.completed_at : now;
    if (end > tool.started_at) intervals.push([tool.started_at, end]);
  }

  const steps = toolIds.size + anonymousTools;
  const toolMs = unionLength(intervals);
  // Use the union of model request intervals, not wall time, so a turn left
  // open across idle periods does not report idle time as model time.
  const modelMs = modelIntervals.length > 0 ? unionLength(modelIntervals) : Math.max(0, wallMs - toolMs);
  const speed = computeSpeed(models);
  const inputTokens = sumBy(models, (row) => numberOrZero(row.input_tokens));
  const outputTokens = sumBy(models, (row) => numberOrZero(row.output_tokens));
  const cacheReadTokens = sumBy(models, (row) => numberOrZero(row.cache_read_input_tokens));
  const cacheCreationTokens = sumBy(models, (row) => numberOrZero(row.cache_creation_input_tokens));
  const contextTokens =
    models.reduce((max, row) => Math.max(max, numberOrZero(row.input_tokens)), 0) || null;
  const cacheHitRate =
    inputTokens > 0 ? Math.min(1, Math.max(0, cacheReadTokens / inputTokens)) : null;

  return {
    turnId,
    status: usage?.status || "running",
    active,
    startedAt,
    completedAt: active ? null : completedAt,
    steps,
    wallMs,
    modelMs,
    toolMs,
    requests: models.length,
    errors,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    cacheHitRate,
    contextTokens,
    avgTtftMs: speed.avgTtftMs,
    tps: speed.tps,
  };
}

function computeSpeed(models) {
  const completed = models.filter((row) => String(row.status || "completed") === "completed");
  const ttfts = completed
    .map((row) => finiteOrNull(row.time_to_first_token_ms))
    .filter((value) => value !== null && value >= 0);
  const avgTtftMs = ttfts.length > 0 ? ttfts.reduce((sum, value) => sum + value, 0) / ttfts.length : null;

  let generationMs = 0;
  let generationTokens = 0;
  for (const row of completed) {
    const duration = finiteOrNull(row.duration_ms);
    const ttft = finiteOrNull(row.time_to_first_token_ms);
    const output = numberOrZero(row.output_tokens);
    if (duration !== null && ttft !== null && output > 0 && duration > ttft) {
      generationMs += duration - ttft;
      generationTokens += output;
    }
  }
  const tps = generationMs > 0 ? (generationTokens / generationMs) * 1000 : null;
  return { avgTtftMs, tps, generationMs, generationTokens };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderMarkdown(result, opts) {
  if (result.empty) {
    const lines = [];
    if (result.activeTurnCount > 0) {
      lines.push(
        `> 当前会话还没有已完成的轮次。运行一轮后重试，或加 \`--include-active\` 查看进行中的第 ${result.activeTurnCount} 轮数据。`,
      );
    } else {
      lines.push("> 当前会话还没有可统计的轮次。");
    }
    for (const warning of result.warnings) lines.push(`> 提示：${warning}`);
    return lines.join("\n");
  }

  const { totals } = result;
  const sessionMode = Boolean(opts.sessionTotals);
  const latest = result.turns[result.turns.length - 1] || totals;
  const focus = sessionMode ? totals : latest;
  const headline = sessionMode
    ? `${formatCount(totals.turns)} 轮 ${formatCount(totals.steps)} 步`
    : `第 ${latest.index ?? 1} 轮 · ${formatCount(latest.steps)} 步`;
  const lines = [];
  lines.push(`| 📊 ${sessionMode ? "会话统计" : "单轮统计卡"} | **${headline}** |`);
  lines.push("| :--- | ---: |");
  lines.push(`| 模型用时 | ${formatDuration(focus.modelMs)} |`);
  lines.push(`| 工具调用用时 | ${formatDuration(focus.toolMs)} |`);
  lines.push(`| 首 token 平均（TTFT） | ${formatTtft(focus.avgTtftMs)} |`);
  lines.push(`| 输出速度（TPS） | ${formatTps(focus.tps)} |`);
  lines.push(`| 输入 tokens | ${formatTokens(focus.inputTokens)} |`);
  if (!sessionMode && Number.isFinite(latest.userInputTokens)) {
    lines.push(`| 用户输入（约） | 约 ${formatTokens(latest.userInputTokens)} tokens |`);
  }
  lines.push(`| 输出 tokens | ${formatTokens(focus.outputTokens)} |`);
  lines.push(`| 主轮请求 | ${formatCount(focus.requests)} 次 |`);
  lines.push(`| 工具错误 | ${formatCount(focus.errors)} 次 |`);

  let activeNote = "";
  if (!sessionMode && latest.active) {
    activeNote = `（第 ${latest.index ?? 1} 轮进行中，数据为当前值）`;
  } else if (sessionMode && result.activeTurnCount > 0) {
    activeNote = result.includeActive
      ? `（含 ${result.activeTurnCount} 个进行中的轮次）`
      : `（不含 ${result.activeTurnCount} 个进行中的轮次）`;
  }
  lines.push(`| 统计截至 | ${result.generatedAt}${activeNote} |`);
  for (const warning of result.warnings) lines.push(`| 提示 | ${warning} |`);

  if (opts.details) {
    lines.push("");
    lines.push("| 轮 | 状态 | 步 | 模型用时 | 工具用时 | 输出 tokens |");
    lines.push("| ---: | :--- | ---: | ---: | ---: | ---: |");
    for (const turn of result.turns) {
      lines.push(
        `| ${turn.index} | ${statusLabel(turn.status, turn.active)} | ${formatCount(turn.steps)} | ${formatDuration(turn.modelMs)} | ${formatDuration(turn.toolMs)} | ${formatTokens(turn.outputTokens)} |`,
      );
    }
  }

  return lines.join("\n");
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}分${seconds}秒`;
  const hours = Math.floor(minutes / 60);
  return `${hours}小时${minutes % 60}分`;
}

function formatTtft(ms) {
  if (!Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}毫秒`;
  return `${(ms / 1000).toFixed(1)}秒`;
}

function formatTps(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} tok/s`;
}

function formatTokens(value) {
  const number = numberOrZero(value);
  return formatCompactNumber(number);
}

function formatCount(value) {
  return NUMBER_FORMAT.format(Math.round(numberOrZero(value)));
}

function formatCompactNumber(value) {
  if (value >= 100_000_000) return `${NUMBER_FORMAT.format(value / 100_000_000)}亿`;
  if (value >= 10_000) return `${NUMBER_FORMAT.format(value / 10_000)}万`;
  return formatCount(value);
}

function statusLabel(status, active) {
  if (active) return "进行中";
  switch (String(status)) {
    case "completed":
      return "完成";
    case "error":
      return "出错";
    case "cancelled":
      return "取消";
    default:
      return status || "完成";
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function groupByTurn(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (!row.turn_id) continue;
    const list = grouped.get(row.turn_id);
    if (list) list.push(row);
    else grouped.set(row.turn_id, [row]);
  }
  return grouped;
}

function unionLength(intervals) {
  if (intervals.length === 0) return 0;
  const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
  let total = 0;
  let start = sorted[0][0];
  let end = sorted[0][1];
  for (let i = 1; i < sorted.length; i += 1) {
    const [nextStart, nextEnd] = sorted[i];
    if (nextStart <= end) {
      if (nextEnd > end) end = nextEnd;
    } else {
      total += end - start;
      start = nextStart;
      end = nextEnd;
    }
  }
  return total + (end - start);
}

function isFinalStatus(status) {
  return !["running", "pending"].includes(String(status || "").toLowerCase());
}

function sameDirectory(left, right) {
  return normalizeDirectory(left) === normalizeDirectory(right);
}

function normalizeDirectory(directory) {
  if (!directory) return "";
  let value = String(directory).trim();
  try {
    value = path.resolve(value);
  } catch {
    // keep the original string
  }
  value = value.replace(/[\\/]+$/, "");
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function sumBy(items, getValue) {
  return items.reduce((sum, item) => sum + numberOrZero(getValue(item)), 0);
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toIso(milliseconds) {
  return Number.isFinite(milliseconds) && milliseconds > 0 ? new Date(milliseconds).toISOString() : null;
}

function formatClock(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
