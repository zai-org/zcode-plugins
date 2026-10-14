// 数据层：只读访问 ZCode 本地库 ~/.zcode/cli/db/db.sqlite
// schema 属 ZCode 内部结构（0.16.x），每个查询独立容错，缺表/缺列时降级为空数据并记录错误。
import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { existsSync } from "node:fs";

export const DEFAULT_DB_PATH = `${homedir()}/.zcode/cli/db/db.sqlite`;

export interface SessionBrief {
  id: string;
  title: string | null;
  directory: string | null;
  timeCreated: number | null;
  timeUpdated: number | null;
}

export interface ToolStat {
  kind: "builtin" | "mcp" | "skill";
  server: string | null;
  name: string;
  calls: number;
  errors: number;
  running: number;
  totalMs: number;
  avgMs: number | null;
  lastAt: number | null;
  outBytes: number;
}

export interface ModelStat {
  model: string;
  agent: string | null;
  source: string;
  calls: number;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  genSeconds: number;
  avgTpsGen: number | null;
}

export interface TpsPoint {
  t: number;
  output: number;
  tpsGen: number | null;
  tpsE2E: number | null;
  model: string;
  agent: string | null;
  source: string;
  status: string;
}

export interface TurnStat {
  id: string;
  startedAt: number | null;
  durationMs: number | null;
  outputTokens: number;
  totalTokens: number;
  modelRequests: number;
  toolCalls: number;
  status: string;
}

export interface UsageSnapshot {
  generatedAt: number;
  mode: "auto" | "pinned";
  session: SessionBrief | null;
  childSessionCount: number;
  sessions: SessionBrief[];
  totals: {
    modelCalls: number;
    completedCalls: number;
    errorCalls: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    activeSeconds: number;
    genSeconds: number;
    avgTpsGen: number | null;
    avgTpsE2E: number | null;
  };
  currentTpsGen: number | null;
  tools: ToolStat[];
  models: ModelStat[];
  series: TpsPoint[];
  turns: TurnStat[];
  runningTools: { tool: string; startedAt: number | null }[];
  errors: string[];
}

export class UsageDb {
  private db: DatabaseSync | null = null;
  readonly path: string;

  constructor(path: string = process.env.ZCODE_USAGE_DB_PATH || DEFAULT_DB_PATH) {
    this.path = path;
  }

  private open(): DatabaseSync {
    if (!this.db) {
      if (!existsSync(this.path)) throw new Error(`数据库不存在: ${this.path}`);
      // mode=ro：绝不写入；timeout 为 busy 等待毫秒
      this.db = new DatabaseSync(`file:${this.path}?mode=ro`, {
        readOnly: true,
        timeout: 2000,
      });
    }
    return this.db;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  /** 单条会话基础信息（prompt 构成扫描用） */
  sessionInfo(sessionId: string): SessionBrief | null {
    try {
      const r = this
        .open()
        .prepare(`SELECT id, title, directory, time_created, time_updated FROM session WHERE id = ?`)
        .get(sessionId) as Record<string, unknown> | undefined;
      if (!r) return null;
      return {
        id: String(r.id),
        title: (r.title as string) ?? null,
        directory: (r.directory as string) ?? null,
        timeCreated: num(r.time_created),
        timeUpdated: num(r.time_updated),
      };
    } catch (e) {
      throw new Error(`读取会话失败: ${errMsg(e)}`);
    }
  }

  /** 会话范围内实际调用过的 MCP server 名（从 mcp__server__tool 前缀反查，含 App 内置注入的） */
  mcpServersUsed(mainId: string): string[] {
    try {
      const sids = this.sessionScope(mainId);
      const rows = this
        .open()
        .prepare(`SELECT DISTINCT tool_name FROM tool_usage WHERE ${UsageDb.in(sids)}`)
        .all(...sids) as { tool_name: string }[];
      const servers = new Set<string>();
      for (const r of rows) {
        if (r.tool_name.startsWith("mcp__")) {
          const server = r.tool_name.split("__")[1];
          if (server) servers.add(server);
        }
      }
      return [...servers].sort();
    } catch {
      return [];
    }
  }

  /** 主会话 + 其子代理会话（parent_id 挂靠），统计口径包含子会话 */
  private sessionScope(mainId: string): string[] {
    try {
      const rows = this.open().prepare("SELECT id FROM session WHERE parent_id = ?").all(mainId) as Record<
        string,
        unknown
      >[];
      return [mainId, ...rows.map((r) => String(r.id))];
    } catch {
      return [mainId];
    }
  }

  private static in(sids: string[], col = "session_id"): string {
    return `${col} IN (${sids.map(() => "?").join(",")})`;
  }

  /** 变化指纹：覆盖三张核心表的行数与状态聚合，1s 轮询用，必须便宜 */
  fingerprint(): string {
    const db = this.open();
    const r = db
      .prepare(
        `SELECT
          (SELECT count(*) FROM model_usage) AS mu_n,
          (SELECT coalesce(sum(duration_ms),0) FROM model_usage) AS mu_ms,
          (SELECT count(*) FROM tool_usage) AS tu_n,
          (SELECT coalesce(sum(duration_ms),0) FROM tool_usage) AS tu_ms,
          (SELECT count(*) FROM turn_usage) AS tu2_n,
          (SELECT coalesce(max(time_updated),0) FROM session) AS s_upd`,
      )
      .get() as Record<string, number | bigint>;
    return JSON.stringify(r);
  }

  listSessions(limit = 20): SessionBrief[] {
    try {
      const rows = this
        .open()
        .prepare(
          `SELECT id, title, directory, time_created, time_updated
           FROM session WHERE task_type = 'interactive'
           ORDER BY time_updated DESC LIMIT ?`,
        )
        .all(limit) as Record<string, unknown>[];
      return rows.map((r) => ({
        id: String(r.id),
        title: (r.title as string) ?? null,
        directory: (r.directory as string) ?? null,
        timeCreated: num(r.time_created),
        timeUpdated: num(r.time_updated),
      }));
    } catch (e) {
      throw new Error(`读取会话列表失败: ${errMsg(e)}`);
    }
  }

  buildSnapshot(mode: "auto" | "pinned", sessionId: string | null): UsageSnapshot {
    const snap: UsageSnapshot = {
      generatedAt: Date.now(),
      mode,
      session: null,
      childSessionCount: 0,
      sessions: [],
      totals: {
        modelCalls: 0, completedCalls: 0, errorCalls: 0,
        inputTokens: 0, outputTokens: 0, reasoningTokens: 0,
        cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0,
        activeSeconds: 0, genSeconds: 0,
        avgTpsGen: null, avgTpsE2E: null,
      },
      currentTpsGen: null,
      tools: [],
      models: [],
      series: [],
      turns: [],
      runningTools: [],
      errors: [],
    };

    try {
      snap.sessions = this.listSessions();
    } catch (e) {
      snap.errors.push(errMsg(e));
      return snap;
    }

    let sid = sessionId;
    if (mode === "auto" || !sid) {
      sid = snap.sessions[0]?.id ?? null;
    }
    if (!sid) return snap;

    const known = snap.sessions.find((s) => s.id === sid);
    snap.session =
      known ??
      (() => {
        try {
          const r = this
            .open()
            .prepare(
              `SELECT id, title, directory, time_created, time_updated FROM session WHERE id = ?`,
            )
            .get(sid) as Record<string, unknown> | undefined;
          if (!r) return null;
          return {
            id: String(r.id),
            title: (r.title as string) ?? null,
            directory: (r.directory as string) ?? null,
            timeCreated: num(r.time_created),
            timeUpdated: num(r.time_updated),
          };
        } catch {
          return null;
        }
      })();
    if (!snap.session) return snap;

    const sids = this.sessionScope(sid);
    snap.childSessionCount = sids.length - 1;

    this.fillTotals(snap, sids);
    this.fillSeries(snap, sids);
    this.fillTools(snap, sids);
    this.fillModels(snap, sids);
    this.fillTurns(snap, sids);
    try {
      snap.runningTools = (
        this
          .open()
          .prepare(
            `SELECT tool_name, started_at FROM tool_usage
             WHERE ${UsageDb.in(sids)} AND status = 'running'
             ORDER BY started_at DESC LIMIT 10`,
          )
          .all(...sids) as Record<string, unknown>[]
      ).map((r) => ({ tool: String(r.tool_name), startedAt: num(r.started_at) }));
    } catch (e) {
      snap.errors.push(`运行中工具: ${errMsg(e)}`);
    }

    return snap;
  }

  private fillTotals(snap: UsageSnapshot, sids: string[]): void {
    try {
      const r = this
        .open()
        .prepare(
          `SELECT
             count(*) AS calls,
             sum(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
             sum(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
             coalesce(sum(input_tokens), 0) AS input_tokens,
             coalesce(sum(output_tokens), 0) AS output_tokens,
             coalesce(sum(reasoning_tokens), 0) AS reasoning_tokens,
             coalesce(sum(cache_read_input_tokens), 0) AS cache_read,
             coalesce(sum(cache_creation_input_tokens), 0) AS cache_write,
             coalesce(sum(computed_total_tokens), 0) AS total_tokens,
             coalesce(sum(duration_ms), 0) AS active_ms,
             sum(CASE WHEN status = 'completed' AND duration_ms IS NOT NULL
                      AND time_to_first_token_ms IS NOT NULL
                      AND duration_ms > time_to_first_token_ms
                 THEN (duration_ms - time_to_first_token_ms) ELSE 0 END) AS gen_ms
           FROM model_usage WHERE ${UsageDb.in(sids)}`,
        )
        .get(...sids) as Record<string, number | bigint | null>;

      const out = Number(r.output_tokens ?? 0);
      const genS = Number(r.gen_ms ?? 0) / 1000;
      const activeS = Number(r.active_ms ?? 0) / 1000;
      snap.totals = {
        modelCalls: Number(r.calls ?? 0),
        completedCalls: Number(r.completed ?? 0),
        errorCalls: Number(r.errors ?? 0),
        inputTokens: Number(r.input_tokens ?? 0),
        outputTokens: out,
        reasoningTokens: Number(r.reasoning_tokens ?? 0),
        cacheReadTokens: Number(r.cache_read ?? 0),
        cacheWriteTokens: Number(r.cache_write ?? 0),
        totalTokens: Number(r.total_tokens ?? 0),
        activeSeconds: activeS,
        genSeconds: genS,
        avgTpsGen: genS > 0 ? out / genS : null,
        avgTpsE2E: activeS > 0 ? out / activeS : null,
      };
    } catch (e) {
      snap.errors.push(`模型汇总: ${errMsg(e)}`);
    }
  }

  private fillSeries(snap: UsageSnapshot, sids: string[]): void {
    try {
      const rows = this
        .open()
        .prepare(
          `SELECT started_at, duration_ms, time_to_first_token_ms, output_tokens,
                  model_id, agent, query_source, status
           FROM model_usage WHERE ${UsageDb.in(sids)}
           ORDER BY started_at DESC, id DESC LIMIT 40`,
        )
        .all(...sids) as Record<string, unknown>[];
      snap.series = rows
        .map((r) => {
          const dur = num(r.duration_ms);
          const ttft = num(r.time_to_first_token_ms);
          const out = Number(r.output_tokens ?? 0);
          const genMs = dur !== null && ttft !== null && dur > ttft ? dur - ttft : null;
          return {
            t: num(r.started_at) ?? 0,
            output: out,
            tpsGen: genMs && genMs > 0 ? out / (genMs / 1000) : null,
            tpsE2E: dur && dur > 0 ? out / (dur / 1000) : null,
            model: String(r.model_id ?? "?"),
            agent: (r.agent as string) ?? null,
            source: String(r.query_source ?? "?"),
            status: String(r.status ?? "?"),
          } satisfies TpsPoint;
        })
        .reverse();
      const last = [...snap.series].reverse().find((p) => p.tpsGen !== null);
      snap.currentTpsGen = last?.tpsGen ?? null;
    } catch (e) {
      snap.errors.push(`TPS 序列: ${errMsg(e)}`);
    }
  }

  private fillTools(snap: UsageSnapshot, sids: string[]): void {
    try {
      // skill 名不在 tool_usage 里，从 part 的调用入参（state.input.skill）反查
      const skillMap = new Map<string, string>();
      try {
        const rows = this
          .open()
          .prepare(
            `SELECT json_extract(data, '$.callID') AS cid,
                    json_extract(data, '$.state.input.skill') AS skill
             FROM part
             WHERE ${UsageDb.in(sids)}
               AND json_extract(data, '$.type') = 'tool'
               AND json_extract(data, '$.tool') = 'Skill'
               AND json_extract(data, '$.state.input.skill') IS NOT NULL`,
          )
          .all(...sids) as { cid: string; skill: string }[];
        for (const r of rows) skillMap.set(r.cid, r.skill);
      } catch {
        // part 结构变化时仅丢失 skill 细分，不影响计数
      }

      const rows = this
        .open()
        .prepare(
          `SELECT tool_name, tool_call_id, count(*) AS n,
                  sum(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
                  sum(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
                  coalesce(sum(duration_ms), 0) AS total_ms,
                  avg(duration_ms) AS avg_ms,
                  max(started_at) AS last_at,
                  coalesce(sum(output_bytes), 0) AS out_bytes
           FROM tool_usage WHERE ${UsageDb.in(sids)} GROUP BY tool_name`,
        )
        .all(...sids) as Record<string, unknown>[];

      const stats = new Map<string, ToolStat>();
      for (const r of rows) {
        const raw = String(r.tool_name);
        let kind: ToolStat["kind"] = "builtin";
        let server: string | null = null;
        let name = raw;
        if (raw.startsWith("mcp__")) {
          kind = "mcp";
          const parts = raw.split("__"); // mcp__<server>__<tool>
          server = parts[1] ?? "?";
          name = parts.slice(2).join("__") || raw;
        } else if (raw === "Skill") {
          kind = "skill";
        }
        if (kind === "skill") {
          // 一次聚合行代表全部 Skill 调用，按具体 skill 名再拆一层
          const perSkill = new Map<string, number>();
          try {
            const calls = this
              .open()
              .prepare(
                `SELECT tool_call_id FROM tool_usage
                 WHERE ${UsageDb.in(sids)} AND tool_name = 'Skill'`,
              )
              .all(...sids) as { tool_call_id: string }[];
            for (const c of calls) {
              const s = skillMap.get(c.tool_call_id);
              perSkill.set(s ?? "(未解析 skill)", (perSkill.get(s ?? "(未解析 skill)") ?? 0) + 1);
            }
          } catch {
            perSkill.set("(未解析 skill)", Number(r.n));
          }
          const n = Number(r.n);
          const totalMs = Number(r.total_ms);
          for (const [skillName, cnt] of perSkill) {
            stats.set(`skill:${skillName}`, {
              kind: "skill",
              server: null,
              name: skillName,
              calls: cnt,
              errors: Math.round((Number(r.errors) * cnt) / n),
              running: Math.round((Number(r.running) * cnt) / n),
              totalMs: Math.round((totalMs * cnt) / n),
              avgMs: r.avg_ms !== null ? Number(r.avg_ms) : null,
              lastAt: num(r.last_at),
              outBytes: Math.round((Number(r.out_bytes) * cnt) / n),
            });
          }
          continue;
        }
        stats.set(raw, {
          kind,
          server,
          name,
          calls: Number(r.n),
          errors: Number(r.errors),
          running: Number(r.running),
          totalMs: Number(r.total_ms),
          avgMs: r.avg_ms !== null ? Number(r.avg_ms) : null,
          lastAt: num(r.last_at),
          outBytes: Number(r.out_bytes),
        });
      }
      snap.tools = [...stats.values()].sort((a, b) => b.calls - a.calls);
    } catch (e) {
      snap.errors.push(`工具统计: ${errMsg(e)}`);
    }
  }

  private fillModels(snap: UsageSnapshot, sids: string[]): void {
    try {
      const rows = this
        .open()
        .prepare(
          `SELECT model_id, agent, query_source, count(*) AS calls,
                  coalesce(sum(input_tokens), 0) AS input_tokens,
                  coalesce(sum(output_tokens), 0) AS output_tokens,
                  coalesce(sum(reasoning_tokens), 0) AS reasoning_tokens,
                  coalesce(sum(cache_read_input_tokens), 0) AS cache_read,
                  coalesce(sum(cache_creation_input_tokens), 0) AS cache_write,
                  coalesce(sum(computed_total_tokens), 0) AS total_tokens,
                  sum(CASE WHEN status = 'completed' AND duration_ms IS NOT NULL
                       AND time_to_first_token_ms IS NOT NULL
                       AND duration_ms > time_to_first_token_ms
                      THEN (duration_ms - time_to_first_token_ms) ELSE 0 END) AS gen_ms
           FROM model_usage WHERE ${UsageDb.in(sids)}
           GROUP BY model_id, agent, query_source`,
        )
        .all(...sids) as Record<string, unknown>[];
      snap.models = rows.map((r) => {
        const out = Number(r.output_tokens);
        const genS = Number(r.gen_ms ?? 0) / 1000;
        return {
          model: String(r.model_id ?? "?"),
          agent: (r.agent as string) ?? null,
          source: String(r.query_source ?? "?"),
          calls: Number(r.calls),
          input: Number(r.input_tokens),
          output: out,
          reasoning: Number(r.reasoning_tokens),
          cacheRead: Number(r.cache_read),
          cacheWrite: Number(r.cache_write),
          total: Number(r.total_tokens),
          genSeconds: genS,
          avgTpsGen: genS > 0 ? out / genS : null,
        };
      }).sort((a, b) => b.total - a.total);
    } catch (e) {
      snap.errors.push(`模型统计: ${errMsg(e)}`);
    }
  }

  private fillTurns(snap: UsageSnapshot, sids: string[]): void {
    try {
      const rows = this
        .open()
        .prepare(
          `SELECT turn_id, status, started_at, duration_ms, output_tokens,
                  computed_total_tokens, model_request_count, tool_call_count
           FROM turn_usage WHERE ${UsageDb.in(sids)}
           ORDER BY started_at DESC LIMIT 30`,
        )
        .all(...sids) as Record<string, unknown>[];
      snap.turns = rows.map((r) => ({
        id: String(r.turn_id),
        startedAt: num(r.started_at),
        durationMs: num(r.duration_ms),
        outputTokens: Number(r.output_tokens ?? 0),
        totalTokens: Number(r.computed_total_tokens ?? 0),
        modelRequests: Number(r.model_request_count ?? 0),
        toolCalls: Number(r.tool_call_count ?? 0),
        status: String(r.status ?? "?"),
      }));
    } catch (e) {
      snap.errors.push(`轮次统计: ${errMsg(e)}`);
    }
  }
}

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
