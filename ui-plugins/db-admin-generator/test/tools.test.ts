import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain JS runtime
import { introspect, validateRow } from "../src/runtime/schema.mjs";
import { createServer } from "../src/server.ts";

// 虚构样例数据库 “Harbor Bikes” 自行车租赁店（samples/db/make-db.mjs）：外键、UNIQUE、CHECK IN、布尔、日期、视图、无主键表。
const MAKE = process.env.DB_SAMPLE ?? "/workspace/zcode-new-plugins/samples/db/make-db.mjs";
let ws: string;
let call: (name: string, args: Record<string, unknown>) => Promise<any>;
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
beforeAll(async () => {
  ws = mkdtempSync(join(tmpdir(), "dbadm-"));
  mkdirSync(join(ws, "data"));
  execFileSync(process.execPath, ["--no-warnings", MAKE, join(ws, "data/harbor-bikes.db")]);
  const u = new DatabaseSync(join(ws, "data/accounts.sqlite"));
  u.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, api_token TEXT); CREATE TABLE knex_migrations (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO users (email, password_hash) VALUES ('a@example.com','x');");
  u.close();
  const server = createServer({ workspaceRoot: ws, assetRoot: join(import.meta.dirname, "../dist") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "t", version: "1" });
  await client.connect(b);
  call = async (name, args) => (await client.callTool({ name, arguments: args })) as any;
});

describe("schema runtime", () => {
  it("infers input kinds from the SQLite schema", () => {
    const t = introspect(new DatabaseSync(join(ws, "data/harbor-bikes.db"), { readOnly: true }));
    const col = (tb: string, c: string) => t.find((x: any) => x.name === tb).columns.find((x: any) => x.name === c);
    expect(col("bikes", "id")).toMatchObject({ kind: "integer", auto: true });
    expect(col("bikes", "category")).toMatchObject({ kind: "ref", fk: { table: "categories", column: "code" }, notNull: true });
    expect(col("bikes", "frame_size")).toMatchObject({ kind: "select", options: ["S", "M", "L", "XL"] });
    expect(col("bikes", "serial")).toMatchObject({ unique: true, maxLength: 20 });
    expect(col("bikes", "in_service").kind).toBe("boolean");
    expect(col("customers", "is_member").kind).toBe("boolean");
    expect(col("customers", "email").kind).toBe("email");
    expect(col("customers", "joined_at").kind).toBe("datetime");
    expect(col("rentals", "start_date").kind).toBe("date");
    expect(col("categories", "code")).toMatchObject({ notNull: true, unique: true });
    expect(t.find((x: any) => x.name === "audit_log")).toMatchObject({ rowid: true, pk: [] });
    expect(t.find((x: any) => x.name === "open_rentals").type).toBe("view");
    expect(t.find((x: any) => x.name === "bikes").refs).toEqual([{ table: "rentals", column: "bike_id" }]);
  });
  it("validates rows (zh messages, defaults left to SQLite)", () => {
    const t = introspect(new DatabaseSync(join(ws, "data/harbor-bikes.db"), { readOnly: true }));
    const bikes = t.find((x: any) => x.name === "bikes"), customers = t.find((x: any) => x.name === "customers");
    expect(validateRow(bikes, { serial: "x".repeat(21), model: " ", frame_size: "XXL", purchased_on: "2026/1/1", in_service: "maybe", category: "city" }, "create", "zh").errors)
      .toEqual({ serial: "最多 20 个字符", model: "必填", frame_size: "不在可选值里", purchased_on: "日期格式应为 YYYY-MM-DD", in_service: "需要 是/否" });
    expect(validateRow(customers, { full_name: "A", email: "a@b.co", joined_at: "", is_member: false }, "create").values).toEqual({ full_name: "A", email: "a@b.co", is_member: 0 });
    expect(validateRow(customers, { joined_at: "" }, "update").errors).toEqual({ joined_at: "Required" });
    expect(validateRow(customers, { joined_at: "2026-11-24T09:30" }, "update").values).toEqual({ joined_at: "2026-11-24 09:30:00" });
  });
});

describe("tools", () => {
  it("db_inspect: default plan hides secrets and leaves migration tables out", async () => {
    const r = await call("db_inspect", { db: "data/accounts.sqlite" });
    expect(r.isError).toBeFalsy();
    const users = r.structuredContent.plan.tables.find((t: any) => t.name === "users");
    expect(users.hidden).toEqual(["password_hash", "api_token"]);
    expect(r.structuredContent.plan.tables.find((t: any) => t.name === "knex_migrations").ops).toEqual([]);
    expect(r.content[0].text).toMatch(/email:email\* unique/);
  });

  it("db_generate: writes a dependency-free admin, self-test passes, database untouched", async () => {
    const before = sha(join(ws, "data/harbor-bikes.db"));
    const r = await call("db_generate", { db: "data/harbor-bikes.db", title: "Harbor Bikes 后台", lang: "zh", tables: [{ name: "audit_log", ops: ["read"] }, { name: "customers", hidden: ["phone"] }] });
    expect(r.isError).toBeFalsy();
    const { plan, saved } = r.structuredContent;
    expect(plan.out).toBe("harbor-bikes-admin");
    const failed = saved.test.checks.filter((c: any) => !c.ok);
    expect(failed).toEqual([]);
    const names = saved.test.checks.map((c: any) => c.name);
    for (const n of ["server starts", "API needs sign-in", "wrong password rejected", "write without X-Admin header rejected", "sign in as viewer", "bikes: list (24 rows)", "bikes: empty form → required-field errors", "bikes: create a record", "bikes: duplicate serial → 409", "bikes: editor cannot delete", "bikes: viewer cannot create", "bikes: delete it", "bikes: SQL injection in sort/search is harmless", "categories: deleting a record still used by bikes → 409", "rentals.bike_id: reference options", "changes written to audit.log"]) expect(names).toContain(n);
    expect(names.some((n: string) => n.startsWith("audit_log: create"))).toBe(false); // read-only table
    expect(sha(join(ws, "data/harbor-bikes.db"))).toBe(before);
    const out = join(ws, "harbor-bikes-admin");
    const cfg = JSON.parse(await readFile(join(out, "admin.config.json"), "utf8"));
    expect(cfg.db).toBe("../data/harbor-bikes.db");
    expect(cfg.tables.find((t: any) => t.name === "customers").hidden).toEqual(["phone"]);
    expect(await readFile(join(out, "README.md"), "utf8")).toContain("node server.mjs user add alice editor");
    expect(JSON.parse(await readFile(join(out, "package.json"), "utf8")).dependencies).toBeUndefined();
    expect(await readFile(join(out, ".gitignore"), "utf8")).toContain("users.json");
    expect(await readFile(join(out, "public/index.html"), "utf8")).not.toMatch(/<script>|onclick=/); // CSP: no inline script
  });

  it("the self-test catches a broken permission check", async () => {
    const f = join(ws, "harbor-bikes-admin/server.mjs");
    const good = readFileSync(f, "utf8");
    writeFileSync(f, good.replace('if (!can(m, "delete")) throw new HttpError(403, L.forbid);', ""));
    const r = await call("db_selftest", { out: "harbor-bikes-admin" });
    writeFileSync(f, good);
    expect(r.structuredContent.test.ok).toBe(false);
    expect(r.structuredContent.test.checks.filter((c: any) => !c.ok).map((c: any) => c.name)).toContain("bikes: editor cannot delete");
    expect((await call("db_selftest", { out: "harbor-bikes-admin" })).structuredContent.test.ok).toBe(true);
  });

  it("generated user CLI", () => {
    const dir = join(ws, "harbor-bikes-admin"), env = { ...process.env, NODE_NO_WARNINGS: "1", ADMIN_USERS: join(ws, "u.json") };
    const out1 = execFileSync(process.execPath, [join(dir, "server.mjs"), "user", "add", "mia", "editor"], { env, encoding: "utf8" });
    expect(out1).toMatch(/added mia \(editor\); password: \S{12,}/);
    expect(readFileSync(join(ws, "u.json"), "utf8")).toMatch(/"hash": "scrypt\$/);
    expect(execFileSync(process.execPath, [join(dir, "server.mjs"), "user", "list"], { env, encoding: "utf8" })).toBe("mia\teditor\n");
    expect(() => execFileSync(process.execPath, [join(dir, "server.mjs"), "user", "add", "x", "root"], { env, stdio: "pipe" })).toThrow(/role must be one of/);
  });

  it("clear errors", async () => {
    writeFileSync(join(ws, "fake.db"), "not a database");
    expect((await call("db_inspect", { db: "fake.db" })).content[0].text).toMatch(/not a SQLite database/);
    expect((await call("db_inspect", { db: "x.csv" })).content[0].text).toMatch(/Postgres and MySQL are not supported/);
    expect((await call("db_inspect", { db: "nope.db" })).content[0].text).toMatch(/not found/);
    expect((await call("db_generate", { db: "data/harbor-bikes.db", tables: [{ name: "bikes", list: ["nope"] }] })).content[0].text).toMatch(/no column “nope”/);
  });
});
