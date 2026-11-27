import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { availabilityOf, gtinValid, handleOf } from "../src/feed.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const parseCsv = (t: string) => {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  t = t.replace(/^\ufeff/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; } else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; } else cell += c;
  }
  return rows;
};

describe("helpers", () => {
  it("checks GTINs, makes handles, reads availability", () => {
    expect(gtinValid("6901234567892")).toBe(true);
    expect(gtinValid("1234567890123")).toBe(false);
    expect(gtinValid("036000291452")).toBe(true);
    expect(gtinValid("96385074")).toBe(true);
    expect(handleOf({ group: "", title: "Linen Tea Apron – Café", id: "A" })).toBe("linen-tea-apron-cafe");
    expect(handleOf({ group: "", title: "明前龙井", id: "TEA-LJ-250" })).toBe("tea-lj-250");
    expect(availabilityOf({ availability: "", stock: 0 })).toBe("out_of_stock");
    expect(availabilityOf({ availability: "预售", stock: NaN })).toBe("preorder");
    expect(availabilityOf({ availability: "有货", stock: 0 })).toBe("in_stock");
  });
});

describe("tools", () => {
  it("checks the sample, exports all formats and reads its own Shopify CSV back", async () => {
    const root = await mkdtemp(join(tmpdir(), "feed-"));
    await cp(join(HERE, "samples"), join(root, "商品"), { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("feed_open", { inputs: ["商品/products.xlsx"], project: "shop", settings: { baseUrl: "https://example.com", feedTitle: "Penova Tea" } });
    expect(o.data.stats).toEqual({ rows: 10, products: 7, variants: 5, errors: 2, warnings: 4 });
    const iss = o.data.issues.map((i: { level: string; row?: number; key?: string }) => `${i.level}@${i.row}:${i.key}`);
    expect(iss).toEqual(expect.arrayContaining(["warn@2:salePrice", "error@3:description", "error@3:images", "warn@3:brand", "warn@8:images", "warn@9:gtin"]));
    await c.call("feed_edit", { project: "shop", set: [{ row: 8, values: { 图片链接: "https://example.com/img/apron-dark.jpg" } }] });
    await c.call("feed_export", { project: "shop" });
    const out = join(root, "product-feed-converter", "shop");
    const shop = parseCsv(String(await readFile(join(out, "products-shopify.csv"))));
    const H = shop[0];
    const col = (r: string[], h: string) => r[H.indexOf(h)];
    const apron = shop.filter((r) => r[0] === "apron");
    expect(apron.length).toBe(3);
    expect(apron.map((r) => [col(r, "Option1 Value"), col(r, "Option2 Value"), col(r, "Variant Price"), col(r, "Variant Compare At Price")])).toEqual([["Natural", "S/M", "99.00", "129.00"], ["Natural", "L/XL", "99.00", "129.00"], ["Charcoal", "L/XL", "99.00", "129.00"]]);
    expect(col(apron[0], "Option1 Name")).toBe("Color");
    expect(col(apron[1], "Title")).toBe("");
    expect(shop.find((r) => col(r, "Variant SKU") === "TEA-LJ-250")!.slice(0, 2)).toEqual(["west-lake-longjing-green-tea-250g-tin", "West Lake Longjing Green Tea 250g Tin"]);
    expect(shop.filter((r) => r[0] === "west-lake-longjing-green-tea-250g-tin").length).toBe(2); // 第二张图单独一行
    const woo = parseCsv(String(await readFile(join(out, "products-woocommerce.csv"))));
    expect(woo.slice(1).map((r) => r[0])).toEqual(["simple", "simple", "simple", "simple", "variable", "variation", "variation", "variable", "variation", "variation", "variation", "simple"]);
    const xml = String(await readFile(join(out, "product-feed.xml")));
    expect(xml.match(/<item>/g)!.length).toBe(9);
    expect(xml).toContain("<g:sale_price>99.00 CNY</g:sale_price>");
    expect(xml).toContain("<g:item_group_id>APRON</g:item_group_id>");
    expect(xml).toContain("<g:link>https://example.com/products/west-lake-longjing-green-tea-100g-pouch</g:link>");
    expect(xml).not.toContain("TEA-PE-357");
    const issues = String(await readFile(join(out, "issues.csv")));
    expect(issues).toContain("TEA-PE-357");
    // 读回自己导出的 Shopify CSV
    const back = await c.call("feed_open", { inputs: ["product-feed-converter/shop/products-shopify.csv"], project: "back", settings: { baseUrl: "https://example.com" } });
    expect(back.data.stats).toMatchObject({ rows: 10, products: 7, variants: 5 });
    const br = back.data.rows as Record<string, string>[];
    expect(br.find((r) => r.id === "APR-01-S")).toMatchObject({ price: "129.00", salePrice: "99.00", color: "Natural", size: "S/M", title: "Linen Tea Apron" });
    expect(br.find((r) => r.id === "TEA-LJ-250")!.images.split(" | ").length).toBe(2);
  }, 60_000);
});
