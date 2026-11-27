import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseDdl, splitTop } from "../src/ddl.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("ddl", () => {
  it("splits on top-level commas only", () => {
    expect(splitTop("a INT, b DECIMAL(10,2), c ENUM('x,y')")).toEqual(["a INT", "b DECIMAL(10,2)", "c ENUM('x,y')"]);
  });
  it("parses tables, keys, foreign keys and comments", async () => {
    const { tables, warnings } = parseDdl(await readFile(join(HERE, "samples/shop-schema.sql"), "utf8"));
    expect(tables.map((t) => t.name)).toEqual(["customers", "products", "categories", "orders", "order_items"]);
    const cu = tables[0];
    expect(cu.comment).toBe("客户");
    expect(cu.cols[0]).toMatchObject({ name: "id", type: "BIGINT", pk: true, nullable: false, comment: "客户编号" });
    expect(cu.cols[2]).toMatchObject({ name: "phone", unique: true, nullable: true });
    expect(tables[1].cols[2]).toMatchObject({ type: "DECIMAL(10,2)", def: "0" });
    expect(tables[3].cols[1].fk).toBe("customers.id");
    const items = tables[4];
    expect(items.cols.filter((c) => c.pk).map((c) => c.name)).toEqual(["order_id", "sku"]);
    expect(items.cols[0].fk).toBe("orders.id");
    expect(items.cols[1].fk).toBe("products.sku");
    expect(warnings).toEqual(["Foreign key on unknown column orders.coupon_id"]);
  });
  it("reads PostgreSQL COMMENT ON", () => {
    const { tables } = parseDdl(`CREATE TABLE public.users (id serial PRIMARY KEY, email text NOT NULL);\nCOMMENT ON TABLE public.users IS '用户';\nCOMMENT ON COLUMN public.users.email IS 'login e-mail';`);
    expect(tables[0]).toMatchObject({ name: "users", comment: "用户" });
    expect(tables[0].cols[1].comment).toBe("login e-mail");
  });
});

describe("tools", () => {
  it("opens, adds a relationship and exports diagram and dictionary", async () => {
    const root = await mkdtemp(join(tmpdir(), "erd-"));
    await cp(join(HERE, "samples"), join(root, "db"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("erd_open", { inputs: ["db/shop-schema.sql"], project: "shop" });
    expect(o.data.stats).toMatchObject({ tables: 5, relationships: 3 });
    expect(o.data.issues.some((i: { message: string }) => /coupon_id/.test(i.message))).toBe(true);
    const row = (o.data.rows as Record<string, unknown>[]).findIndex((r) => r.column === "category_id");
    const e = await c.call("erd_edit", { project: "shop", set: [{ row, values: { fk: "categories.id" } }, { row: 3, values: { 说明: "所在城市" } }] });
    expect(e.data.stats.relationships).toBe(4);
    await c.call("erd_export", { project: "shop" });
    const svg = await readFile(join(root, "sql-er-diagram/shop/er-diagram.svg"), "utf8");
    expect(svg).toContain("order_items");
    expect((svg.match(/stroke-linejoin="round"/g) ?? []).length).toBe(4);
    const png = await readFile(join(root, "sql-er-diagram/shop/er-diagram.png"));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(root, "sql-er-diagram/shop/data-dictionary.xlsx"));
    expect(wb.getWorksheet("Columns 字段")!.getRow(5).getCell(7).value).toBe("所在城市");
    const md = await readFile(join(root, "sql-er-diagram/shop/data-dictionary.md"), "utf8");
    expect(md).toContain("## orders — 订单");
    expect(md).toContain("FK → customers.id");
  }, 60_000);
});
