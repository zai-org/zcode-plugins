import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { inferType, literal, sqlName } from "../src/sql.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("sql", () => {
  it("infers types and escapes", () => {
    expect(inferType(["1", "2", ""]).type).toBe("INTEGER");
    expect(inferType(["13800001234", "13911112222"]).type).toBe("VARCHAR");
    expect(inferType(["56.50", "0", "8.8"]).type).toBe("DECIMAL");
    expect(inferType(["是", "否"]).type).toBe("BOOLEAN");
    expect(inferType(["2026-01-10", "2024-03-01"]).type).toBe("DATE");
    expect(inferType(["a\nb"]).type).toBe("TEXT");
    expect(sqlName("OrderDate (UTC)", 0)).toBe("order_date_utc");
    expect(sqlName("会员编号", 0)).toBe("会员编号");
    expect(literal("O'Brien", "VARCHAR", "sqlite")).toBe("'O''Brien'");
    expect(literal("a\\b", "VARCHAR", "mysql")).toBe("'a\\\\b'");
    expect(literal("多行\n备注", "TEXT", "postgres")).toBe("E'多行\\n备注'");
    expect(literal("是", "BOOLEAN", "postgres")).toBe("TRUE");
    expect(literal("", "INTEGER", "mysql")).toBe("NULL");
  });
});

describe("csvsql tools", () => {
  it("builds scripts and flags problems", async () => {
    const root = await mkdtemp(join(tmpdir(), "csvsql-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("csvsql_open", { inputs: ["会员名单.csv"], project: "m", settings: { dialect: "all" } });
    expect(o.data.settings.table).toBe("会员名单");
    expect(o.data.rows.map((r: { type: string }) => r.type)).toEqual(["VARCHAR", "VARCHAR", "VARCHAR", "DATE", "INTEGER", "DECIMAL", "BOOLEAN", "TEXT"]);
    expect(o.data.rows[0]).toMatchObject({ pk: true, nullable: false });
    expect(o.data.stats.errors).toBe(0);
    const bad = await c.call("csvsql_edit", { project: "m", set: [{ row: 2, values: { nullable: false } }, { row: 1, values: { type: "INTEGER" } }] });
    expect(bad.data.issues.map((i: { level: string }) => i.level)).toEqual(expect.arrayContaining(["error", "warn"]));
    await c.call("csvsql_edit", { project: "m", set: [{ row: 2, values: { nullable: true } }, { row: 1, values: { type: "VARCHAR", name: "name" } }, { row: 7, values: { include: false } }], settings: { table: "members" } });
    await c.call("csvsql_export", { project: "m" });
    const pg = await readFile(join(root, "csv-to-sql/m/members.postgres.sql"), "utf8");
    expect(pg).toMatch(/CREATE TABLE "members" \(\n  "会员编号" VARCHAR\(16\) NOT NULL,\n  "name" VARCHAR\(16\) NOT NULL,/);
    expect(pg).toMatch(/\('M0002', 'O''Brien', '13911112222', '2025-07-15', 0, 0, FALSE\)/);
    expect(pg).toMatch(/PRIMARY KEY \("会员编号"\)/);
    expect(pg).not.toMatch(/备注/);
    const my = await readFile(join(root, "csv-to-sql/m/members.mysql.sql"), "utf8");
    expect(my).toMatch(/`是否vip` TINYINT\(1\) NOT NULL/);
    expect(await readFile(join(root, "csv-to-sql/m/members.sqlite.sql"), "utf8")).toMatch(/BEGIN;[\s\S]*COMMIT;/);
  });
});
