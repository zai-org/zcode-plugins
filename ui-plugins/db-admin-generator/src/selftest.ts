import { spawn, execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { type Column, type Plan, type Table, inspect, isRequired, openDb } from "./generate.ts";

export interface Check { name: string; ok: boolean; detail?: string }
export interface SelfTest { ok: boolean; passed: number; failed: number; checks: Check[]; ms: number }

const run = promisify(execFile);
const nodeEnv = (extra: Record<string, string>) => ({ ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_NO_WARNINGS: "1", ...extra });

/** Start the generated admin against a temporary copy of the database and exercise it over HTTP. The real database is never written. */
export async function selfTest(outAbs: string, dbAbs: string, plan: Plan): Promise<SelfTest> {
  const t0 = Date.now();
  const checks: Check[] = [];
  const ok = (name: string, cond: boolean, detail?: string) => { checks.push({ name, ok: !!cond, detail: cond ? undefined : detail }); return cond; };
  const tmp = await mkdtemp(join(tmpdir(), "dbadmin-test-"));
  const dbCopy = join(tmp, "test.db");
  await copyFile(dbAbs, dbCopy);
  for (const s of ["-wal", "-shm"]) if (existsSync(dbAbs + s)) await copyFile(dbAbs + s, dbCopy + s);
  const env = nodeEnv({ ADMIN_DB: dbCopy, ADMIN_USERS: join(tmp, "users.json"), ADMIN_SECRET_FILE: join(tmp, "secret"), ADMIN_AUDIT: join(tmp, "audit.log"), PORT: "0", HOST: "127.0.0.1" });
  const pw: Record<string, string> = {};
  let child: ReturnType<typeof spawn> | undefined;
  try {
    for (const role of ["admin", "editor", "viewer"]) {
      pw[role] = randomBytes(9).toString("base64url");
      const r = await run(process.execPath, [join(outAbs, "server.mjs"), "user", "add", `test-${role}`, role], { env: { ...env, ADMIN_PASSWORD: pw[role] }, timeout: 20_000 }).catch((e) => ({ stdout: "", stderr: String(e.stderr || e.message) }));
      ok(`CLI: add ${role} user`, /added test-/.test(r.stdout), r.stderr);
    }
    child = spawn(process.execPath, [join(outAbs, "server.mjs")], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start in 20 s\n${err || out}`)), 20_000);
      child!.stdout!.on("data", (d) => { out += d; const m = /running at http:\/\/[^:]+:(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } });
      child!.stderr!.on("data", (d) => { err += d; });
      child!.on("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}): ${err || out}`)); });
    });
    ok("server starts", true);
    const base = `http://127.0.0.1:${port}`;
    const req = async (method: string, path: string, body?: unknown, cookie?: string, headers: Record<string, string> = { "X-Admin": "1" }) => {
      const r = await fetch(base + path, { method, headers: { ...(method === "GET" ? {} : { "Content-Type": "application/json", ...headers }), ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await r.text();
      let json: any; try { json = JSON.parse(text); } catch { json = text; }
      return { status: r.status, json, cookie: (r.headers.get("set-cookie") ?? "").split(";")[0] };
    };
    const home = await req("GET", "/");
    ok("serves the admin page", home.status === 200 && String(home.json).includes("/app.js"), `status ${home.status}`);
    ok("API needs sign-in", (await req("GET", "/api/meta")).status === 401);
    ok("wrong password rejected", (await req("POST", "/api/login", { user: "test-admin", password: "nope-nope" })).status === 401);
    ok("write without X-Admin header rejected", (await req("POST", "/api/login", { user: "test-admin", password: pw.admin }, undefined, {})).status === 403);
    const jar: Record<string, string> = {};
    for (const role of ["admin", "editor", "viewer"]) {
      const r = await req("POST", "/api/login", { user: `test-${role}`, password: pw[role] });
      if (ok(`sign in as ${role}`, r.status === 200 && !!r.cookie, `status ${r.status} ${JSON.stringify(r.json)}`)) jar[role] = r.cookie;
    }
    if (!jar.admin) throw new Error("admin sign-in failed");
    const meta = (await req("GET", "/api/meta", undefined, jar.admin)).json;
    const enabled = plan.tables.filter((t) => t.ops.length);
    ok(`meta lists ${enabled.length} table(s)`, meta.tables?.length === enabled.length, `got ${meta.tables?.length}`);
    const db = await openDb(dbCopy, true);
    const schema = inspect(db);
    const firstValue = (table: string, col: string) => (db.prepare(`SELECT "${col.replace(/"/g, '""')}" AS v FROM "${table.replace(/"/g, '""')}" WHERE "${col.replace(/"/g, '""')}" IS NOT NULL LIMIT 1`).get() as { v: unknown } | undefined)?.v;
    for (const tp of enabled) {
      const t = schema.find((x) => x.name === tp.name)!;
      const T = encodeURIComponent(t.name);
      const list = await req("GET", `/api/t/${T}?size=5`, undefined, jar.admin);
      ok(`${t.name}: list (${t.rows} rows)`, list.status === 200 && list.json.total === t.rows, `status ${list.status}, total ${list.json?.total}`);
      const sc = tp.search.find((c) => !tp.hidden.includes(c));
      const sv = sc ? firstValue(t.name, sc) : undefined;
      if (sc && sv != null) { const word = String(sv).slice(0, 6); const s = await req("GET", `/api/t/${T}?q=${encodeURIComponent(word)}`, undefined, jar.admin); ok(`${t.name}: search “${word}”`, s.status === 200 && s.json.total >= 1, `status ${s.status}, total ${s.json?.total}`); }
      const sortCol = tp.list[1] ?? tp.list[0];
      if (sortCol) { const s = await req("GET", `/api/t/${T}?sort=${encodeURIComponent(sortCol)}&dir=desc`, undefined, jar.admin); ok(`${t.name}: sort by ${sortCol}`, s.status === 200); }
      const evil = await req("GET", `/api/t/${T}?sort=${encodeURIComponent("1; DROP TABLE x--")}&q=${encodeURIComponent("' OR 1=1 --")}`, undefined, jar.admin);
      ok(`${t.name}: SQL injection in sort/search is harmless`, evil.status === 200 && (!tp.search.length || evil.json.total === 0), `status ${evil.status}, total ${evil.json?.total}`);
      ok(`${t.name}: unknown filter column rejected`, (await req("GET", `/api/t/${T}?f.nope=1`, undefined, jar.admin)).status === 400);
      for (const c of t.columns.filter((x) => x.fk && !tp.hidden.includes(x.name))) {
        const o = await req("GET", `/api/t/${T}/options/${encodeURIComponent(c.name)}`, undefined, jar.admin);
        ok(`${t.name}.${c.name}: reference options`, o.status === 200 && Array.isArray(o.json.options), `status ${o.status}`);
      }
      if (t.type !== "table") continue;
      const can = (role: keyof Plan["roles"], op: string) => tp.ops.includes(op as never) && plan.roles[role].includes(op as never);
      if (can("admin", "create")) {
        const req0 = t.columns.filter((c) => isRequired(c as Column) && !tp.hidden.includes(c.name));
        if (req0.length) { const e = await req("POST", `/api/t/${T}`, {}, jar.admin); ok(`${t.name}: empty form → required-field errors`, e.status === 400 && req0.every((c) => e.json.fields?.[c.name]), `status ${e.status} ${JSON.stringify(e.json.fields)}`); }
        const sample = sampleRow(t, schema, firstValue, tp.hidden);
        const c1 = await req("POST", `/api/t/${T}`, sample, jar.admin);
        if (ok(`${t.name}: create a record`, c1.status === 201 && !!c1.json.row?._key, `status ${c1.status} ${JSON.stringify(c1.json)}`)) {
          const key = encodeURIComponent(c1.json.row._key);
          const got = await req("GET", `/api/t/${T}/r/${key}`, undefined, jar.admin);
          ok(`${t.name}: read it back`, got.status === 200, `status ${got.status}`);
          const edit = t.columns.find((c) => !c.auto && !c.pk && !c.fk && !c.options && !tp.hidden.includes(c.name) && ["text", "longtext", "integer", "number"].includes(c.kind) && !c.unique);
          if (edit && can("admin", "update")) {
            const nv = edit.kind === "integer" || edit.kind === "number" ? 7 : "Self-test edit";
            const u = await req("PUT", `/api/t/${T}/r/${key}`, { [edit.name]: nv }, jar.admin);
            ok(`${t.name}: update ${edit.name}`, u.status === 200 && u.json.row?.[edit.name] == nv, `status ${u.status} ${JSON.stringify(u.json)}`);
            const bad = t.columns.find((c) => (c.kind === "integer" || c.kind === "number") && !c.auto && !c.fk && !tp.hidden.includes(c.name));
            if (bad) { const b = await req("PUT", `/api/t/${T}/r/${key}`, { [bad.name]: "abc" }, jar.admin); ok(`${t.name}: invalid ${bad.name} rejected`, b.status === 400 && !!b.json.fields?.[bad.name], `status ${b.status}`); }
          }
          const uq = t.columns.find((c) => c.unique && !c.auto && !tp.hidden.includes(c.name) && c.kind !== "boolean");
          if (uq) { const dup = await req("POST", `/api/t/${T}`, sample, jar.admin); ok(`${t.name}: duplicate ${uq.name} → 409`, dup.status === 409 && !!dup.json.fields?.[uq.name], `status ${dup.status} ${JSON.stringify(dup.json)}`); }
          if (jar.viewer && !can("viewer", "update")) ok(`${t.name}: viewer cannot edit`, (await req("PUT", `/api/t/${T}/r/${key}`, sample, jar.viewer)).status === 403 || !can("viewer", "read"));
          if (jar.editor && can("editor", "read") && !can("editor", "delete")) ok(`${t.name}: editor cannot delete`, (await req("DELETE", `/api/t/${T}/r/${key}`, undefined, jar.editor)).status === 403);
          if (can("admin", "delete")) { const d = await req("DELETE", `/api/t/${T}/r/${key}`, undefined, jar.admin); ok(`${t.name}: delete it`, d.status === 200, `status ${d.status} ${JSON.stringify(d.json)}`); }
        }
        if (jar.viewer && can("viewer", "read") && !can("viewer", "create")) ok(`${t.name}: viewer cannot create`, (await req("POST", `/api/t/${T}`, sample, jar.viewer)).status === 403);
      }
      if (t.refs.length && can("admin", "delete")) {
        const ref = t.refs.find((r) => { const c = schema.find((x) => x.name === r.table)?.columns.find((x) => x.name === r.column) as (Column & { fk?: { onDelete?: string } }) | undefined; return c && c.fk && !/CASCADE|SET NULL|SET DEFAULT/i.test((c.fk as { onDelete?: string }).onDelete ?? ""); });
        if (ref) {
          const fkc = schema.find((x) => x.name === ref.table)!.columns.find((x) => x.name === ref.column)!;
          const used = firstValue(ref.table, ref.column);
          if (used != null) {
            const pkCol = fkc.fk!.column;
            const keyRow = db.prepare(`SELECT ${t.rowid ? "rowid AS k" : t.pk.map((p, i) => `"${p}" AS k${i}`).join(", ")} FROM "${t.name}" WHERE "${pkCol}" = ?`).get(used as never) as Record<string, unknown> | undefined;
            if (keyRow && !t.rowid) { const d = await req("DELETE", `/api/t/${T}/r/${encodeURIComponent(JSON.stringify(t.pk.map((_, i) => keyRow[`k${i}`])))}`, undefined, jar.admin); ok(`${t.name}: deleting a record still used by ${ref.table} → 409`, d.status === 409, `status ${d.status} ${JSON.stringify(d.json)}`); }
          }
        }
      }
    }
    db.close();
    const auditText = await readFile(join(tmp, "audit.log"), "utf8").catch(() => "");
    if (checks.some((c) => /create a record/.test(c.name) && c.ok)) ok("changes written to audit.log", /\tcreate\t/.test(auditText));
    const out2 = await req("POST", "/api/logout", {}, jar.admin);
    ok("sign out", out2.status === 200);
  } catch (e) {
    ok("self-test ran to the end", false, (e as Error).message);
  } finally {
    child?.kill();
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
  const failed = checks.filter((c) => !c.ok).length;
  return { ok: failed === 0, passed: checks.length - failed, failed, checks, ms: Date.now() - t0 };
}

function sampleRow(t: Table, schema: Table[], firstValue: (t: string, c: string) => unknown, hidden: string[]) {
  const tag = randomBytes(3).toString("hex");
  const row: Record<string, unknown> = {};
  for (const c of t.columns) {
    if (c.auto || hidden.includes(c.name) || /^(created|updated)_at$/.test(c.name)) continue;
    let v: unknown;
    if (c.fk) v = firstValue(c.fk.table, c.fk.column);
    else if (c.options) v = c.options[0];
    else switch (c.kind) {
      case "boolean": v = true; break;
      case "integer": v = 3; break;
      case "number": v = 9.5; break;
      case "date": v = new Date().toISOString().slice(0, 10); break;
      case "datetime": v = new Date().toISOString().slice(0, 16).replace("T", " "); break;
      case "email": v = `selftest+${tag}@example.com`; break;
      case "url": v = `https://example.com/${tag}`; break;
      case "tel": v = "+1 555 0100"; break;
      case "longtext": v = "Created by the self-test"; break;
      default: v = c.unique || c.pk ? `st-${tag}` : `Self-test ${tag}`;
    }
    if (typeof v === "string" && c.maxLength) v = v.slice(0, c.maxLength);
    if (v !== undefined) row[c.name] = v;
  }
  void schema;
  return row;
}
