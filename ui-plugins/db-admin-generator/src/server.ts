import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { createKitServer } from "./kit/server-kit.ts";
import { KitError, Workspace } from "./kit/workspace.ts";
import { OPS, type Plan, type Table, applyPatch, defaultPlan, emit, inspect, openDb } from "./generate.ts";
import { type SelfTest, selfTest } from "./selftest.ts";

export const NAME = "db-admin-generator";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
const STORE = ".db-admin-generator/plans.json";
const DB_EXT = [".db", ".sqlite", ".sqlite3", ".db3"];

export interface ServerOptions { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }
interface Saved { plan: Plan; generatedAt?: string; test?: SelfTest }

export function createServer(options: ServerOptions) {
  const ws = new Workspace(options.workspaceRoot);
  const { server, tool } = createKitServer({ name: NAME, version: VERSION, panelUri: PANEL_URI, surface: "editor", panelHtml: () => readFile(join(options.assetRoot, "ui/panel.html"), "utf8"), log: options.log });
  const runtime = join(options.assetRoot, "runtime");
  const load = async (): Promise<Record<string, Saved>> => ((await ws.exists(STORE)) ? JSON.parse(await ws.readText(STORE)).plans ?? {} : {});
  const save = async (all: Record<string, Saved>) => ws.write(STORE, JSON.stringify({ version: 1, plans: all }, null, 1) + "\n");

  async function schemaOf(dbRel: string) {
    if (!DB_EXT.some((e) => dbRel.toLowerCase().endsWith(e))) throw new KitError("unsupported", `Use a SQLite database file (${DB_EXT.join(", ")}). Postgres and MySQL are not supported in this version.`);
    if (!(await ws.exists(dbRel))) throw new KitError("not_found", `${dbRel} not found.`);
    const fh = await open(ws.resolve(dbRel), "r");
    const buf = Buffer.alloc(16);
    try { await fh.read(buf, 0, 16, 0); } finally { await fh.close(); }
    const head = buf.toString("latin1");
    if (!head.startsWith("SQLite format 3")) throw new KitError("not_sqlite", `${dbRel} is not a SQLite database.`);
    let db;
    try { db = await openDb(ws.resolve(dbRel), true); } catch (e) { throw new KitError("open_failed", (e as Error).message); }
    try { return inspect(db); } finally { db.close(); }
  }
  const describeSchema = (dbRel: string, tables: Table[]) => [
    `${dbRel}: ${tables.filter((t) => t.type === "table").length} table(s), ${tables.filter((t) => t.type === "view").length} view(s).`,
    ...tables.map((t) => `  ${t.type === "view" ? "view " : ""}${t.name} (${t.rows} rows; key: ${t.pk.join(", ") || (t.type === "view" ? "—" : "rowid")})${t.refs.length ? ` ← referenced by ${t.refs.map((r) => `${r.table}.${r.column}`).join(", ")}` : ""}\n    ${t.columns.map((c) => `${c.name}:${c.kind}${c.notNull && c.default === null && !c.auto ? "*" : ""}${c.fk ? `→${c.fk.table}` : ""}${c.unique && !c.pk ? " unique" : ""}${c.options ? `[${c.options.join("|")}]` : ""}`).join(", ")}`),
    `(* = required)`,
  ].join("\n");
  const describeTest = (t: SelfTest) => `Self-test against a temporary copy of the database: ${t.passed}/${t.passed + t.failed} checks passed in ${(t.ms / 1000).toFixed(1)} s.${t.failed ? `\nFailed:\n${t.checks.filter((c) => !c.ok).map((c) => `  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ""}`).join("\n")}` : ""}`;

  tool("db_inspect", {
    description: "Read a SQLite database's structure without changing it: tables, views, columns with inferred input types (text, number, date, boolean, select from CHECK IN, reference from foreign keys, email…), primary keys, required/unique columns, row counts and which tables reference which. Also returns the default admin plan (all tables, password-like columns hidden).",
    input: { db: z.string().describe("Workspace path of the SQLite file (.db / .sqlite / .sqlite3)") }, readOnly: true, openPanel: true,
  }, async (i) => {
    const tables = await schemaOf(i.db);
    const all = await load();
    const existing = Object.values(all).find((s) => s.plan.db === i.db);
    const plan = existing?.plan ?? defaultPlan(i.db, tables);
    return { text: describeSchema(i.db, tables), structured: { kind: "plan", plan, tables, saved: existing ?? null } };
  });

  const tableInput = z.object({
    name: z.string(), label: z.string().optional(),
    ops: z.array(z.enum(OPS as [string, ...string[]])).optional().describe("Allowed operations: read, create, update, delete ([] = leave the table out)"),
    list: z.array(z.string()).optional().describe("Columns shown in the list"), search: z.array(z.string()).optional().describe("Columns searched by the search box"),
    hidden: z.array(z.string()).optional().describe("Columns never sent to the browser (password hashes etc.)"), labelColumn: z.string().optional().describe("Column shown when other tables refer to a row"),
  });
  tool("db_generate", {
    description: "Generate a dependency-free admin panel for a SQLite database: a Node.js server (node:http + node:sqlite) plus a browser UI with sign-in, roles (admin / editor / viewer), a list per table with search, filters (options, yes/no, references), sorting and paging, and add/edit/delete forms validated against the schema (required, types, CHECK IN options, max length, unique, foreign keys). Writes <out>/ (server.mjs, public/, admin.config.json, README.md), then starts it against a temporary copy of the database and runs a self-test over HTTP. The database itself is never modified.",
    input: {
      db: z.string().describe("Workspace path of the SQLite file"),
      out: z.string().optional().describe("Output folder (default <db name>-admin)"),
      title: z.string().optional(), lang: z.enum(["zh", "en"]).optional().describe("Admin UI language"),
      port: z.number().int().min(1).max(65535).optional(), pageSize: z.number().int().min(5).max(200).optional(),
      only: z.array(z.string()).optional().describe("Only include these tables"),
      tables: z.array(tableInput).optional().describe("Per-table settings"),
      roles: z.object({ editor: z.array(z.enum(OPS as [string, ...string[]])).optional(), viewer: z.array(z.enum(OPS as [string, ...string[]])).optional() }).optional().describe("Operations each role may use (admin always has all)"),
      selfTest: z.boolean().optional().describe("Run the self-test after generating (default true)"),
    },
    openPanel: true, timeoutMs: 180_000,
  }, async (i) => {
    const tables = await schemaOf(i.db);
    const all = await load();
    const prevKey = Object.keys(all).find((k) => all[k].plan.db === i.db && (!i.out || k === i.out.replace(/\/+$/, "")));
    let plan: Plan = prevKey ? structuredClone(all[prevKey].plan) : defaultPlan(i.db, tables);
    // tables added to the database since the last run
    for (const t of defaultPlan(i.db, tables).tables) if (!plan.tables.find((x) => x.name === t.name)) plan.tables.push(t);
    plan.tables = plan.tables.filter((x) => tables.some((t) => t.name === x.name));
    try { plan = applyPatch(plan, tables, i as never); } catch (e) { throw new KitError("bad_plan", (e as Error).message); }
    if (plan.out === "." || plan.out.startsWith("..") || plan.out.startsWith("/")) throw new KitError("bad_out", "Choose an output folder inside the workspace.");
    const files = await emit(plan, runtime, options.workspaceRoot);
    for (const [p, c] of Object.entries(files)) await ws.write(`${plan.out}/${p}`, c);
    const saved: Saved = { plan, generatedAt: new Date().toISOString() };
    if (i.selfTest !== false) saved.test = await selfTest(ws.resolve(plan.out), ws.resolve(plan.db), plan);
    if (prevKey && prevKey !== plan.out) delete all[prevKey];
    all[plan.out] = saved; await save(all);
    const enabled = plan.tables.filter((t) => t.ops.length);
    const text = [
      `Generated ${plan.out}/ — “${plan.title}” for ${plan.db}: ${enabled.length} table(s): ${enabled.map((t) => `${t.name} [${t.ops.join(",")}]${t.hidden.length ? ` (hidden: ${t.hidden.join(", ")})` : ""}`).join("; ")}.`,
      `Roles: ${Object.entries(plan.roles).map(([r, o]) => `${r}=${o.join("/")}`).join(", ")}.`,
      saved.test ? describeTest(saved.test) : "Self-test skipped.",
      `Run it: cd ${plan.out} && node server.mjs (Node ≥ 22.13), then open http://127.0.0.1:${plan.port}. The first start creates user “admin” and prints its password; add more with node server.mjs user add <name> <role>.`,
    ].join("\n");
    return { text, structured: { kind: "plan", plan, tables, saved } };
  });

  tool("db_selftest", {
    description: "Start a generated admin against a temporary copy of its database and check it over HTTP: sign-in per role, listing, search, sorting, SQL-injection attempts, required-field and type validation, create/read/update/delete, unique and foreign-key conflicts, and role permissions. The real database is not modified.",
    input: { out: z.string().describe("Generated admin folder") }, readOnly: true, timeoutMs: 180_000,
  }, async (i) => {
    const all = await load();
    const s = all[i.out.replace(/\/+$/, "")];
    if (!s) throw new KitError("not_found", `No generated admin at ${i.out}. Known: ${Object.keys(all).join(", ") || "none"}`);
    if (!(await ws.exists(`${s.plan.out}/server.mjs`))) throw new KitError("not_found", `${s.plan.out}/server.mjs is missing; run db_generate again.`);
    s.test = await selfTest(ws.resolve(s.plan.out), ws.resolve(s.plan.db), s.plan);
    await save(all);
    return { text: describeTest(s.test), structured: { kind: "test", out: s.plan.out, test: s.test } };
  });

  tool("db_state", { description: "Panel state.", input: {}, visibility: ["app"], readOnly: true }, async () => {
    const all = Object.values(await load()).sort((a, b) => (b.generatedAt ?? "").localeCompare(a.generatedAt ?? ""));
    const files = (await ws.list({ exts: DB_EXT })).map((f) => f.path);
    if (!all[0]) return { text: "", structured: { kind: "none", files } };
    const tables = await schemaOf(all[0].plan.db).catch(() => []);
    return { text: "", structured: { kind: "plan", plan: all[0].plan, tables, saved: all[0], files } };
  });
  tool("db_files", { description: "SQLite files in the workspace.", input: {}, visibility: ["app"], readOnly: true }, async () => ({ text: "", structured: { files: (await ws.list({ exts: DB_EXT })).map((f) => f.path) } }));
  return server;
}
