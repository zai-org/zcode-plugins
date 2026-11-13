#!/usr/bin/env node
/**
 * On-demand usage analytics query for the sidebar modal.
 *
 * Prints one JSON document to stdout:
 *   { ok, range, summary, series, providers, models, projects, tasks }
 *
 * Only reads the local ZCode usage database (read-only connection). Filtering
 * and bucketing happen in local time so the numbers match what the user sees
 * in the app's own usage views.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  bucketOfProvider,
  priceOfModel,
  DEFAULT_PRICE_USD,
  USD_TO_CNY,
} from "../server/data.mjs";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function dbPath() {
  return (
    (process.env.ZCODE_USAGE_DB && process.env.ZCODE_USAGE_DB.trim()) ||
    (process.env.BALANCE_USAGE_DB && process.env.BALANCE_USAGE_DB.trim()) ||
    path.join(os.homedir(), ".zcode", "cli", "db", "db.sqlite")
  );
}

function bucketExpr(bucket) {
  if (bucket === "hour") {
    return "strftime('%Y-%m-%d %H:00', u.started_at / 1000, 'unixepoch', 'localtime')";
  }
  if (bucket === "week") {
    // Monday date of the week, so the renderer can zero-fill by stepping 7 days.
    return "strftime('%Y-%m-%d', (u.started_at / 1000) - (((strftime('%w', u.started_at / 1000, 'unixepoch', 'localtime') + 6) % 7) * 86400), 'unixepoch', 'localtime')";
  }
  return "strftime('%Y-%m-%d', u.started_at / 1000, 'unixepoch', 'localtime')";
}

const PROVIDER_LABELS = {
  deepseek: "DeepSeek",
  volcanoCodingPlan: "火山 Coding Plan",
  volcanoAccount: "火山账户",
  zcode: "ZCode",
  other: "其他",
};

function costOfRow(row) {
  const rates = priceOfModel(row.modelId) || DEFAULT_PRICE_USD;
  const cachedWrite = num(row.cacheWriteTokens);
  const cachedRead = num(row.cacheReadTokens);
  const bareInput = Math.max(0, num(row.inputTokens) - cachedRead - cachedWrite);
  const usd =
    (bareInput * rates.input +
      cachedRead * rates.cacheRead +
      cachedWrite * rates.cacheWrite +
      num(row.outputTokens) * rates.output) /
    1_000_000;
  return usd * USD_TO_CNY;
}

function totalTokensOf(row) {
  return num(row.computedTotalTokens) || num(row.inputTokens) + num(row.outputTokens);
}

async function main() {
  const started = Date.now();
  const now = Date.now();  const start = num(arg("--start"), now - 24 * 3600 * 1000);
  const end = num(arg("--end"), now);
  const bucket = ["hour", "day", "week"].includes(arg("--bucket")) ? arg("--bucket") : "day";
  const projectId = arg("--project-id") || "";
  const directory = arg("--directory") || "";
  const sessionId = arg("--session-id") || "";
  const providerFilter = arg("--provider") || "";

  const file = dbPath();
  if (!fs.existsSync(file)) {
    return {
      ok: false,
      error: { code: "db_missing", message: `用量数据库不存在：${file}` },
    };
  }

  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    // Shared WHERE fragments. started_at is epoch ms, half-open [start, end).
    const rangeWhere = ["u.status = 'completed'", "u.started_at >= ?", "u.started_at < ?"];
    const rangeArgs = [start, end];
    if (projectId) {
      rangeWhere.push("s.project_id = ?");
      rangeArgs.push(projectId);
    }
    if (directory) {
      rangeWhere.push("s.directory = ?");
      rangeArgs.push(directory);
    }
    if (sessionId) {
      rangeWhere.push("u.session_id = ?");
      rangeArgs.push(sessionId);
    }

    const grouped = db
      .prepare(
        `select ${bucketExpr(bucket)} as bucket_key,
                s.project_id, s.directory, s.id as session_id, s.title as session_title,
                u.provider_id, u.model_id,
                count(*) as attempts,
                count(distinct u.logical_request_id) as requests,
                coalesce(sum(u.input_tokens),0) as input_tokens,
                coalesce(sum(u.output_tokens),0) as output_tokens,
                coalesce(sum(u.reasoning_tokens),0) as reasoning_tokens,
                coalesce(sum(u.cache_creation_input_tokens),0) as cache_write_tokens,
                coalesce(sum(u.cache_read_input_tokens),0) as cache_read_tokens,
                coalesce(sum(u.computed_total_tokens),0) as computed_total_tokens
           from model_usage u
           join session s on s.id = u.session_id
          where ${rangeWhere.join(" and ")}
          group by bucket_key, u.provider_id, u.model_id, s.id`,
      )
      .all(...rangeArgs)
      .map((row) => ({
        key: String(row.bucket_key || ""),
        projectId: String(row.project_id || ""),
        directory: String(row.directory || ""),
        sessionId: String(row.session_id || ""),
        sessionTitle: String(row.session_title || ""),
        providerId: String(row.provider_id || ""),
        modelId: String(row.model_id || ""),
        attempts: num(row.attempts),
        requests: num(row.requests),
        inputTokens: num(row.input_tokens),
        outputTokens: num(row.output_tokens),
        reasoningTokens: num(row.reasoning_tokens),
        cacheWriteTokens: num(row.cache_write_tokens),
        cacheReadTokens: num(row.cache_read_tokens),
        computedTotalTokens: num(row.computed_total_tokens),
      }))
      .map((row) => ({
        ...row,
        bucket: bucketOfProvider(row.providerId, row.modelId),
        totalTokens: totalTokensOf(row),
      }))
      .filter((row) => {
        if (!providerFilter) return true;
        if (row.bucket === providerFilter) return true;
        return providerFilter === "volcano" && row.bucket.startsWith("volcano");
      });

    const summary = {
      requests: 0,
      attempts: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      cost: 0,
      sessions: 0,
    };
    const seriesMap = new Map();
    const providerMap = new Map();
    const modelMap = new Map();
    const taskMap = new Map();
    const uniqueRequests = new Set();
    // Requests are only unique per (session, logical_request_id); group rows do
    // not carry the id, so the exact distinct count comes from a separate query
    // and per-bucket numbers use the grouped counts (attempt-level distinct).
    let costUSD = 0;

    for (const row of grouped) {
      const cost = costOfRow(row);
      costUSD += cost;
      summary.attempts += row.attempts;
      summary.requests += row.requests;
      summary.inputTokens += row.inputTokens;
      summary.outputTokens += row.outputTokens;
      summary.reasoningTokens += row.reasoningTokens;
      summary.cacheReadTokens += row.cacheReadTokens;
      summary.cacheWriteTokens += row.cacheWriteTokens;
      summary.totalTokens += row.totalTokens;

      const bucketEntry = seriesMap.get(row.key) || {
        key: row.key,
        totalTokens: 0,
        cost: 0,
        requests: 0,
        providers: {},
      };
      const bucketProvider = bucketEntry.providers[row.bucket] || { tokens: 0, cost: 0, requests: 0 };
      bucketProvider.tokens += row.totalTokens;
      bucketProvider.cost += cost;
      bucketProvider.requests += row.requests;
      bucketEntry.providers[row.bucket] = bucketProvider;
      bucketEntry.totalTokens += row.totalTokens;
      bucketEntry.cost += cost;
      bucketEntry.requests += row.requests;
      seriesMap.set(row.key, bucketEntry);

      const provider = providerMap.get(row.bucket) || {
        id: row.bucket,
        label: PROVIDER_LABELS[row.bucket] || row.bucket,
        tokens: 0,
        cost: 0,
        requests: 0,
        models: 0,
      };
      provider.tokens += row.totalTokens;
      provider.cost += cost;
      provider.requests += row.requests;
      providerMap.set(row.bucket, provider);

      const modelKey = `${row.providerId}\u0000${row.modelId}`;
      const model = modelMap.get(modelKey) || {
        providerId: row.providerId,
        modelId: row.modelId,
        bucket: row.bucket,
        tokens: 0,
        cost: 0,
        requests: 0,
      };
      model.tokens += row.totalTokens;
      model.cost += cost;
      model.requests += row.requests;
      modelMap.set(modelKey, model);

      if (row.sessionId) {
        uniqueRequests.add(row.sessionId);
        const task = taskMap.get(row.sessionId) || {
          id: row.sessionId,
          title: row.sessionTitle || row.sessionId,
          projectId: row.projectId,
          directory: row.directory,
          tokens: 0,
          cost: 0,
          requests: 0,
        };
        task.tokens += row.totalTokens;
        task.cost += cost;
        task.requests += row.requests;
        taskMap.set(row.sessionId, task);
      }
    }

    summary.sessions = uniqueRequests.size;
    summary.cost = round2(costUSD);

    const projectRows = db
      .prepare(
        `select s.project_id, s.directory,
                count(distinct s.id) as sessions,
                coalesce(sum(u.computed_total_tokens),0) as computed_total_tokens,
                coalesce(sum(u.input_tokens + u.output_tokens),0) as plain_tokens
           from model_usage u
           join session s on s.id = u.session_id
          where u.status = 'completed' and u.started_at >= ? and u.started_at < ?
          group by s.project_id, s.directory
          order by plain_tokens desc`,
      )
      .all(start, end);

    const projects = projectRows.map((row) => ({
      id: String(row.project_id || ""),
      directory: String(row.directory || ""),
      label: String(row.directory || row.project_id || "").split(/[\\/]/).filter(Boolean).pop() || String(row.project_id || ""),
      sessions: num(row.sessions),
      tokens: num(row.computed_total_tokens) || num(row.plain_tokens),
    }));

    const taskRows = db
      .prepare(
        `select s.id, s.title, s.project_id, s.directory,
                count(*) as attempts,
                coalesce(sum(u.computed_total_tokens),0) as computed_total_tokens,
                coalesce(sum(u.input_tokens + u.output_tokens),0) as plain_tokens
           from model_usage u
           join session s on s.id = u.session_id
          where u.status = 'completed' and u.started_at >= ? and u.started_at < ?
            and s.parent_id is null
            and s.id not like 'sess_subagent%'
            and s.id not like 'sess_dwf-%'
            ${projectId ? "and s.project_id = ?" : ""}
            ${directory ? "and s.directory = ?" : ""}
          group by s.id
          order by plain_tokens desc
          limit 50`,
      )
      .all(
        start,
        end,
        ...(projectId ? [projectId] : []),
        ...(directory ? [directory] : []),
      );

    const tasks = taskRows.map((row) => ({
      id: String(row.id || ""),
      title: String(row.title || row.id || ""),
      projectId: String(row.project_id || ""),
      directory: String(row.directory || ""),
      tokens: num(row.computed_total_tokens) || num(row.plain_tokens),
      attempts: num(row.attempts),
    }));

    const series = Array.from(seriesMap.values())
      .map((entry) => ({ ...entry, cost: round2(entry.cost) }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    const providers = Array.from(providerMap.values())
      .map((entry) => ({
        ...entry,
        cost: round2(entry.cost),
        share: summary.totalTokens > 0 ? entry.tokens / summary.totalTokens : 0,
      }))
      .sort((a, b) => b.tokens - a.tokens);

    const models = Array.from(modelMap.values())
      .map((entry) => ({ ...entry, cost: round2(entry.cost) }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 12);

    return {
      ok: true,
      range: { start, end, bucket, provider: providerFilter || "all" },
      filters: {
        projectId,
        directory,
        sessionId,
        provider: providerFilter || "all",
      },
      summary,
      series,
      providers,
      models,
      projects,
      tasks,
      elapsedMs: Date.now() - started,
    };
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
      error: { code: "analytics_failed", message: error?.message || String(error) },
    }),
  );
  process.exitCode = 1;
}
