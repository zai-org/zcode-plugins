import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findRecords, flatten, toObject } from "../src/convert.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("convert", () => {
  it("flattens and nests", () => {
    expect(findRecords({ meta: { n: 1 }, data: { list: [{ a: 1 }, { a: 2 }] }, x: [1, 2, 3] })).toBe("data.list");
    const cols = new Set<string>();
    expect(flatten({ a: { b: 1, c: [1, 2] }, d: [{ x: 1 }, { x: 2 }] }, { arrays: "join", explode: "d", sep: "; " }, cols)).toEqual([{ "a.b": "1", "a.c": "1; 2", "d.x": "1" }, { "a.b": "1", "a.c": "1; 2", "d.x": "2" }]);
    expect([...cols]).toEqual(["a.c"]);
    expect(toObject(["a.b", "a.c", "n", "ok", "id", "e"], ["x", "1; 2", "007", "true", "12", ""], { nest: true, types: true, empty: "omit", arrayCols: new Set(["a.c"]), sep: "; " })).toEqual({ a: { b: "x", c: [1, 2] }, n: "007", ok: true, id: 12 });
  });
});

describe("jsontable tools", () => {
  it("JSON → table → JSON round trip", async () => {
    const root = await mkdtemp(join(tmpdir(), "jsontable-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("jsontable_open", { inputs: ["orders-api.json"], project: "orders" });
    expect(o.data.stats).toEqual({ rows: 3, columns: 10, records: 3 });
    expect(o.data.issues.some((i: { message: string }) => /Explode.*items/.test(i.message))).toBe(true);
    const e = await c.call("jsontable_edit", { project: "orders", settings: { explode: "items" } });
    expect(e.data.stats.rows).toBe(4);
    await c.call("jsontable_export", { project: "orders" });
    const json = JSON.parse(await readFile(join(root, "json-table-converter/orders/data.json"), "utf8"));
    expect(json[0]).toMatchObject({ id: 1001, paid: true, customer: { name: "林小满", phone: "13800001234" }, items: { sku: "TEA-001", qty: 2 }, tags: ["老客户", "包邮"] });
    expect(json[2].tags).toBeUndefined();
    expect((await readFile(join(root, "json-table-converter/orders/data.jsonl"), "utf8")).trim().split("\n")).toHaveLength(4);
    const t = await c.call("jsontable_open", { inputs: ["产品表.csv"], project: "p", settings: { arrayCols: "tags" } });
    expect(t.data.stats.rows).toBe(3);
    await c.call("jsontable_export", { project: "p", formats: ["json"] });
    const p = JSON.parse(await readFile(join(root, "json-table-converter/p/data.json"), "utf8"));
    expect(p[0]).toEqual({ id: "TEA-001", name: "西湖龙井", price: 179, in_stock: true, spec: { weight: "250g", origin: "杭州" }, tags: ["绿茶", "明前"] });
    expect(p[2]).toEqual({ id: "CUP-010", name: "公道杯", price: 69.5, in_stock: true, spec: { origin: "景德镇" } });
    await writeFile(join(root, "log.jsonl"), '{"a":1}\n{"a":2,"b":{"c":3}}\n');
    expect((await c.call("jsontable_open", { inputs: ["log.jsonl"] })).data.stats).toMatchObject({ rows: 2, columns: 2 });
  });
});
