import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generate, rng, value } from "../src/gen.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("generators", () => {
  it("is deterministic and well-formed", () => {
    const c = (type: never, arg = "") => ({ name: "x", type, arg, blank: 0 });
    const x = { r: rng(1), zh: true, row: 6 };
    expect(value(c("sequence" as never, "C{0000}"), x)).toBe("C0007");
    expect(value(c("phone" as never), x)).toMatch(/^1[35789]\d{9}$/);
    expect(value(c("email" as never), { ...x, zh: false, name: "Mary Smith" })).toMatch(/^mary\.smith\d+@(example|test)\./);
    expect(value(c("pattern" as never, "ORD-####-??"), x)).toMatch(/^ORD-\d{4}-[A-Z]{2}$/);
    expect(value(c("uuid" as never), x)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const d = value(c("date" as never, "2026-02-01..2026-02-28"), x);
    expect(d >= "2026-02-01" && d <= "2026-02-28").toBe(true);
    const cols = [{ name: "lvl", type: "choice" as const, arg: "A*9|B*1", blank: 0 }, { name: "n", type: "integer" as const, arg: "1..3", blank: 0 }];
    const a = generate(cols, 2000, 5, true, new Set());
    expect(a.rows).toEqual(generate(cols, 2000, 5, true, new Set()).rows);
    const share = a.rows.filter((r) => r[0] === "A").length / 2000;
    expect(share).toBeGreaterThan(0.85);
    expect(new Set(a.rows.map((r) => r[1]))).toEqual(new Set(["1", "2", "3"]));
    expect(generate(cols, 10, 5, true, new Set(["n"])).dupes).toEqual(["n"]);
  });
});

describe("fakedata tools", () => {
  it("uses a schema sheet and exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "fakedata-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const t = await c.call("fakedata_open", { inputs: [], project: "tpl" });
    expect(t.data.stats).toEqual({ rows: 100, columns: 9 });
    const o = await c.call("fakedata_open", { inputs: ["客户表结构.csv"], project: "kh", settings: { count: 50, seed: 7 } });
    expect(o.data.stats).toEqual({ rows: 50, columns: 10 });
    expect(o.data.rows[0]).toMatchObject({ name: "客户编号", type: "sequence", unique: true });
    expect(o.data.rows[0]._sample).toBe("C0001 · C0002 · C0003");
    const bad = await c.call("fakedata_edit", { project: "kh", set: [{ row: 6, values: { arg: "" } }] });
    expect(bad.data.issues[0]).toMatchObject({ level: "error", key: "arg" });
    await c.call("fakedata_edit", { project: "kh", set: [{ row: 6, values: { arg: "普通|VIP" } }, { row: 3, values: { blank: 0.2 } }] });
    await c.call("fakedata_export", { project: "kh" });
    const json = JSON.parse(await readFile(join(root, "test-data-generator/kh/test-data.json"), "utf8"));
    expect(json).toHaveLength(50);
    expect(typeof json[0]["积分"]).toBe("number");
    expect(typeof json[0]["是否订阅"]).toBe("boolean");
    expect(json.some((r: Record<string, unknown>) => r["邮箱"] === null)).toBe(true);
    expect(new Set(json.map((r: Record<string, unknown>) => r["会员等级"]))).toEqual(new Set(["普通", "VIP"]));
    const sql = await readFile(join(root, "test-data-generator/kh/test-data.sql"), "utf8");
    expect(sql).toMatch(/^INSERT INTO "test_data" \("客户编号", "姓名"/);
    const csv1 = await readFile(join(root, "test-data-generator/kh/test-data.csv"), "utf8");
    await c.call("fakedata_export", { project: "kh", formats: ["csv"] });
    expect(await readFile(join(root, "test-data-generator/kh/test-data.csv"), "utf8")).toBe(csv1);
  });
});
