import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("jsontypes tools", () => {
  it("infers named types with optional and nullable fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "jsontypes-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("jsontypes_open", { inputs: ["orders-api.json"], project: "api", settings: { path: "data.orders", rootName: "order" } });
    expect(o.data.stats).toEqual({ types: 3, fields: 14, samples: 3 });
    const by = Object.fromEntries(o.data.rows.map((r: { path: string }) => [r.path, r]));
    expect(by["customer.phone"]).toMatchObject({ optional: true, kind: "string" });
    expect(by["coupon"]).toMatchObject({ optional: true, nullable: true, kind: "null" });
    expect(by["created_at"].format).toBe("date-time");
    expect(by["items[].qty"]).toMatchObject({ owner: "Item", kind: "integer" });
    const row = o.data.rows.findIndex((r: { path: string }) => r.path === "note");
    await c.call("jsontypes_edit", { project: "api", set: [{ row, values: { description: "发票备注" } }] });
    await c.call("jsontypes_export", { project: "api" });
    const tsOut = await readFile(join(root, "json-to-types/api/types.ts"), "utf8");
    expect(tsOut).toMatch(/export interface Order \{\n  id: number;\n  created_at: string;\n  paid: boolean;\n  customer: Customer;\n  items: Item\[\];\n  tags: string\[\];\n  coupon\?: null;\n  \/\*\* 发票备注 \*\/\n  note\?: string;\n\}/);
    expect(tsOut).toMatch(/export type OrderList = Order\[\];/);
    const z = await readFile(join(root, "json-to-types/api/schema.zod.ts"), "utf8");
    expect(z.indexOf("export const Customer")).toBeLessThan(z.indexOf("export const Order "));
    expect(z).toMatch(/created_at: z\.string\(\)\.datetime\(\{ offset: true \}\),/);
    const schema = JSON.parse(await readFile(join(root, "json-to-types/api/schema.json"), "utf8"));
    expect(schema.$defs.Order.required).toEqual(["id", "created_at", "paid", "customer", "items", "tags"]);
    expect(await readFile(join(root, "json-to-types/api/models.go"), "utf8")).toMatch(/CreatedAt time\.Time `json:"created_at"`/);
    const py = await readFile(join(root, "json-to-types/api/models.py"), "utf8");
    expect(py).toMatch(/class Order:\n    id_: int  # JSON key: "id"/);
    try {
      const f = join(root, "m.py");
      await writeFile(f, py + "\nOrder(id_=1, created_at='x', paid=True, customer=Customer(name='a', city='b'), items=[], tags=[])\nprint('ok')\n");
      expect(execFileSync("python3", [f]).toString().trim()).toBe("ok");
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  });
  it("only calls an array empty when it never has elements", async () => {
    const root = await mkdtemp(join(tmpdir(), "jsontypes-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    await writeFile(join(root, "empty.json"), JSON.stringify({ list: [], filled: [1, 2] }));
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const full = await c.call("jsontypes_open", { inputs: ["orders-api.json"], project: "full" });
    const msgs = (full.data.issues as { message: string }[]).map((i) => i.message);
    expect(msgs.filter((m) => m.includes("always an empty array"))).toEqual([]);
    const e = await c.call("jsontypes_open", { inputs: ["empty.json"], project: "empty" });
    const em = (e.data.issues as { message: string }[]).map((i) => i.message).filter((m) => m.includes("always an empty array"));
    expect(em).toEqual(["list is always an empty array; element type unknown."]);
  });
});
