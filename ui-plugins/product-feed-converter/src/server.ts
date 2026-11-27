import { createApp, esc, toCsv, type AppDef, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders } from "./kit/columns.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { availabilityOf, handleOf, merchantXml, money, shopifyCsv, validate, wooCsv, type Options, type Product, type Target } from "./feed.ts";

export const NAME = "product-feed-converter";
export const VERSION = "0.1.0";

const s = (v: unknown) => String(v ?? "").trim();
const ALIASES: Record<string, string[]> = {
  id: ["sku", "货号", "商品编码", "variant sku", "id", "商家编码", "item code"],
  group: ["商品组", "款号", "spu", "group", "item group id", "parent", "handle", "父商品"],
  title: ["标题", "商品名称", "名称", "title", "name", "product name"],
  description: ["描述", "商品描述", "详情", "description", "body (html)", "body", "short description"],
  price: ["价格", "原价", "售价", "price", "regular price", "variant compare at price"],
  salePrice: ["促销价", "折扣价", "活动价", "sale price", "variant price"],
  currency: ["币种", "货币", "currency"],
  brand: ["品牌", "brand", "vendor", "brands"],
  category: ["分类", "类目", "品类", "category", "categories", "product type", "type"],
  images: ["图片", "图片链接", "主图", "images", "image", "image src", "image link", "image url"],
  link: ["链接", "商品链接", "网址", "link", "url", "product url"],
  stock: ["库存", "stock", "qty", "quantity", "inventory", "variant inventory qty"],
  availability: ["库存状态", "状态", "availability", "in stock?", "stock status"],
  condition: ["成色", "新旧", "condition"],
  gtin: ["条码", "条形码", "gtin", "ean", "upc", "barcode", "variant barcode"],
  mpn: ["型号", "mpn", "厂商型号", "model"],
  weight: ["重量", "weight", "variant grams", "weight (kg)"],
  color: ["颜色", "color", "colour"],
  size: ["尺码", "尺寸", "size"],
  material: ["材质", "material"],
  tags: ["标签", "tags", "关键词"],
  status: ["上架状态", "发布状态", "status", "published"],
};
const KEYS = Object.keys(ALIASES);
const optsOf = (p: Project): Options => ({ currency: s(p.settings.currency) || "CNY", brand: s(p.settings.brand), condition: s(p.settings.condition) || "new", baseUrl: s(p.settings.baseUrl), weightUnit: (["kg", "g", "lb"].includes(s(p.settings.weightUnit)) ? s(p.settings.weightUnit) : "kg") as Options["weightUnit"] });
const targetsOf = (p: Project): Target[] => (p.settings.check === "all" || !p.settings.check ? ["shopify", "woocommerce", "merchant"] : [p.settings.check as Target]);
const splitImages = (v: unknown) => s(v).split(/\s*[;|\n]\s*|,\s*(?=https?:\/\/)/).map((x) => x.trim()).filter(Boolean);

export function toProducts(rows: Row[]): Product[] {
  return rows.map((r, row) => {
    const num = (v: unknown) => { const n = money(v); return Number.isFinite(n) ? n : NaN; };
    return {
      row, id: s(r.id), group: s(r.group), title: s(r.title), description: s(r.description), price: num(r.price), salePrice: num(r.salePrice), currency: s(r.currency).toUpperCase(), brand: s(r.brand), category: s(r.category),
      images: splitImages(r.images), link: s(r.link), stock: s(r.stock) === "" ? NaN : num(r.stock), availability: s(r.availability), condition: s(r.condition), gtin: s(r.gtin).replace(/\s+/g, ""), mpn: s(r.mpn),
      weight: s(r.weight) === "" ? NaN : num(r.weight), color: s(r.color), size: s(r.size), material: s(r.material), tags: s(r.tags), status: /draft|草稿|下架|false|^0$/i.test(s(r.status)) ? "draft" : "",
    };
  });
}

/** 读入：通用表，或店铺导出的 CSV（Shopify 式多行变体、WooCommerce 式父子行）。 */
async function load(ws: Parameters<AppDef["load"]>[0]["ws"], file: string) {
  const t = await readTable(ws, file);
  const lower = t.columns.map((c) => c.toLowerCase());
  const shopify = lower.includes("handle") && lower.includes("variant sku");
  const woo = lower.includes("type") && lower.includes("regular price") && lower.includes("parent");
  const aliases = { ...ALIASES };
  if (shopify) Object.assign(aliases, { id: ["variant sku"], group: ["handle"], title: ["title"], description: ["body (html)"], price: ["variant compare at price"], salePrice: ["variant price"], brand: ["vendor"], category: ["type", "product category"], images: ["image src"], stock: ["variant inventory qty"], gtin: ["variant barcode"], weight: ["variant grams"], color: ["option1 value"], size: ["option2 value"], material: ["option3 value"], status: ["status", "published"] });
  if (woo) Object.assign(aliases, { id: ["sku"], group: ["parent"], title: ["name"], category: ["categories"], status: ["published"], color: ["attribute 1 value(s)"], size: ["attribute 2 value(s)"], material: ["attribute 3 value(s)"], weight: ["weight (kg)"], stock: ["stock"], availability: ["in stock?"] });
  const m = mapHeaders(t.columns, aliases);
  if (!m.id && !m.title) throw new KitError("columns_not_found", `Couldn't find a SKU or title column (货号/sku, 标题/title). Columns: ${t.columns.join(", ")}`);
  let rows: Row[] = t.rows.map((r) => Object.fromEntries(KEYS.map((k) => [k, m[k] ? s(r[m[k]!]) : ""])) as Row);
  let note = "";
  if (shopify) {
    // 同一句柄：后续行补上标题等；只有图片的行把图片并到该商品
    const byHandle = new Map<string, Row>();
    const out: Row[] = [];
    for (const r of rows) {
      const head = byHandle.get(s(r.group));
      if (!head) { byHandle.set(s(r.group), r); out.push(r); continue; }
      if (!s(r.id) && !s(r.salePrice) && !s(r.price)) { if (s(r.images)) head.images = [s(head.images), s(r.images)].filter(Boolean).join(" | "); continue; }
      for (const k of ["title", "description", "brand", "category", "tags", "status"]) if (!s(r[k])) r[k] = head[k];
      out.push(r);
    }
    // Shopify：Variant Price 是售价，Compare At 是原价；没有 Compare At 时售价就是价格
    for (const r of out) if (!s(r.price)) { r.price = r.salePrice; r.salePrice = ""; }
    // 只有一个变体且是 Default Title 的，不算分组
    for (const [h, head] of byHandle) if (out.filter((r) => r.group === h).length === 1) { head.group = ""; if (/^default title$/i.test(s(head.color))) head.color = ""; }
    for (const r of out) { if (s(r.weight)) r.weight = String(Number(r.weight) / 1000); }
    rows = out;
    note = "shopify";
  } else if (woo) {
    const typeCol = t.columns[lower.indexOf("type")];
    const parents = new Map<string, Row>();
    t.rows.forEach((r, i) => { if (/variable/i.test(s(r[typeCol]))) parents.set(s(rows[i].id), rows[i]); });
    rows = rows.filter((_, i) => !/variable/i.test(s(t.rows[i][typeCol])));
    for (const r of rows) {
      const p = parents.get(s(r.group).replace(/^id:/, ""));
      if (p) for (const k of ["description", "brand", "category", "tags", "images"]) if (!s(r[k])) r[k] = p[k];
      if (p && s(r.title).startsWith(s(p.title))) r.title = s(p.title);
      r.availability = s(r.availability) === "0" ? "out of stock" : s(r.availability) === "1" ? "in stock" : s(r.availability);
    }
    note = "woocommerce";
  }
  return { rows, meta: { source: note || "generic", columns: m } };
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "feed",
  title: ["商品数据格式转换", "Product Feed Converter"],
  openDescription:
    "Convert a product sheet (.xlsx/.csv; one row per product or variant: sku, title, description, price, sale price, brand, category, image URLs, link, stock, GTIN/MPN, weight, colour/size/material, group = parent for variants) into a Shopify-style product import CSV, a WooCommerce-style product import CSV and a shopping-ads product feed (RSS 2.0 XML with g: fields). Also reads those CSV exports back in. Checks required fields per target: missing SKU/title/price, duplicate SKUs, sale price not below price, bad image or link URLs, GTIN check digits, missing description/image/link/brand for the feed, variants without option values or with duplicate options.",
  inputs: { exts: [".xlsx", ".csv", ".tsv"], min: 1, max: 1, label: ["选择商品表", "Pick the product sheet"] },
  settings: [
    { key: "check", label: ["检查哪个格式的必填项", "Check required fields for"], type: "select", default: "all", options: [{ value: "all", label: ["全部", "All formats"] }, { value: "shopify", label: ["Shopify 导入 CSV", "Shopify import CSV"] }, { value: "woocommerce", label: ["WooCommerce 导入 CSV", "WooCommerce import CSV"] }, { value: "merchant", label: ["购物广告 feed XML", "Shopping feed XML"] }] },
    { key: "baseUrl", label: ["店铺网址", "Store URL"], type: "text", default: "", help: ["没有商品链接时用 网址/products/句柄", "Used for links as URL/products/handle when a row has none"] },
    { key: "currency", label: ["币种代码", "Currency code"], type: "text", default: "CNY" },
    { key: "brand", label: ["默认品牌", "Default brand"], type: "text", default: "" },
    { key: "condition", label: ["默认成色", "Default condition"], type: "select", default: "new", options: [{ value: "new", label: ["全新", "New"] }, { value: "used", label: ["二手", "Used"] }, { value: "refurbished", label: ["翻新", "Refurbished"] }] },
    { key: "weightUnit", label: ["重量单位", "Weight unit"], type: "select", default: "kg", options: [{ value: "kg", label: ["千克", "kg"] }, { value: "g", label: ["克", "g"] }, { value: "lb", label: ["磅", "lb"] }] },
    { key: "feedTitle", label: ["Feed 标题", "Feed title"], type: "text", default: "" },
  ],
  columns: () => [
    { key: "id", label: ["货号", "SKU"] },
    { key: "group", label: ["商品组", "Group / parent"] },
    { key: "title", label: ["标题", "Title"], wide: true },
    { key: "price", label: ["价格", "Price"], type: "number" },
    { key: "salePrice", label: ["促销价", "Sale price"], type: "number" },
    { key: "color", label: ["颜色", "Colour"] },
    { key: "size", label: ["尺码", "Size"] },
    { key: "material", label: ["材质", "Material"] },
    { key: "stock", label: ["库存", "Stock"], type: "number" },
    { key: "availability", label: ["库存状态", "Availability"] },
    { key: "brand", label: ["品牌", "Brand"] },
    { key: "category", label: ["分类", "Category"] },
    { key: "gtin", label: ["条码 GTIN", "GTIN"] },
    { key: "mpn", label: ["型号 MPN", "MPN"] },
    { key: "weight", label: ["重量", "Weight"], type: "number" },
    { key: "images", label: ["图片链接", "Image URLs"], wide: true },
    { key: "link", label: ["商品链接", "Link"], wide: true },
    { key: "description", label: ["描述", "Description"], wide: true },
    { key: "currency", label: ["币种", "Currency"] },
    { key: "condition", label: ["成色", "Condition"] },
    { key: "tags", label: ["标签", "Tags"] },
    { key: "status", label: ["上架状态", "Status"] },
    { key: "_handle", label: ["句柄", "Handle"], readOnly: true },
  ],
  newRow: () => Object.fromEntries(KEYS.map((k) => [k, ""])),
  load: ({ ws, files }) => load(ws, files[0]),
  compute(p): Computed {
    const products = toProducts(p.rows);
    const o = optsOf(p);
    const fi = validate(products, o, targetsOf(p));
    const issues: Issue[] = fi.map((i) => ({ level: i.level, row: i.row, key: i.key, message: i.target ? `[${i.target}] ${i.message}` : i.message }));
    const source = s((p.meta as { source?: string }).source);
    if (source && source !== "generic") issues.push({ level: "info", message: `Read as a ${source === "shopify" ? "Shopify" : "WooCommerce"} export (variants and images merged) / 已按 ${source} 导出格式读取` });
    const groups = new Set(products.filter((x) => x.group).map((x) => x.group));
    const errors = fi.filter((i) => i.level === "error").length;
    const sample = products.slice(0, 6).map((x) => `<tr><td>${esc(x.id)}</td><td>${esc(x.title)}${x.color || x.size ? ` <span class="muted">${esc([x.color, x.size, x.material].filter(Boolean).join(" / "))}</span>` : ""}</td><td class="num">${Number.isFinite(x.price) ? x.price.toFixed(2) : "—"}</td><td>${esc(availabilityOf(x))}</td><td>${x.images.length}</td></tr>`).join("");
    return {
      rows: p.rows.map((r, i) => ({ ...r, _handle: handleOf(products[i]) })),
      issues,
      summary: `${products.length} row(s): ${products.filter((x) => !x.group).length} single product(s) and ${groups.size} product(s) with variants; ${errors} error(s) to fix. 共 ${products.length} 行，${errors} 个错误。`,
      stats: { rows: products.length, products: products.filter((x) => !x.group).length + groups.size, variants: products.filter((x) => x.group).length, errors, warnings: fi.filter((i) => i.level === "warn").length },
      preview: `<div style="font-size:12px"><table class="data"><thead><tr><th>SKU</th><th>Title</th><th>Price</th><th>Availability</th><th>Images</th></tr></thead><tbody>${sample}</tbody></table>${products.length > 6 ? `<p class="muted">… ${products.length - 6} more</p>` : ""}</div>`,
    };
  },
  exports: [
    {
      id: "shopify", label: ["Shopify 导入 CSV", "Shopify import CSV"], description: "products-shopify.csv in the Shopify product import layout",
      async run({ project, write }: ExportCtx) {
        const ps = toProducts(project.rows);
        return [await write("products-shopify.csv", shopifyCsv(ps, optsOf(project)))];
      },
    },
    {
      id: "woocommerce", label: ["WooCommerce 导入 CSV", "WooCommerce import CSV"], description: "products-woocommerce.csv in the WooCommerce product importer layout",
      async run({ project, write }: ExportCtx) {
        return [await write("products-woocommerce.csv", wooCsv(toProducts(project.rows), optsOf(project)))];
      },
    },
    {
      id: "merchant", label: ["购物广告 feed XML", "Shopping feed XML"], description: "product-feed.xml (RSS 2.0 with g: fields) for shopping-ads product feeds",
      async run({ project, write }: ExportCtx) {
        const ps = toProducts(project.rows), o = optsOf(project);
        const errors = validate(ps, o, ["merchant"]).filter((i) => i.level === "error");
        const bad = new Set(errors.map((e) => e.row));
        const ok = ps.filter((p) => !bad.has(p.row));
        return { files: [await write("product-feed.xml", merchantXml(ok, o, s(project.settings.feedTitle)))], note: bad.size ? `${bad.size} row(s) with feed errors were left out of the XML; see issues.csv.` : undefined };
      },
    },
    {
      id: "issues", label: ["问题清单 CSV", "Issue list (CSV)"], description: "issues.csv — every error and warning with row, SKU, field and target",
      async run({ project, write }: ExportCtx) {
        const ps = toProducts(project.rows);
        const fi = validate(ps, optsOf(project), ["shopify", "woocommerce", "merchant"]);
        return [await write("issues.csv", toCsv(["level", "row", "sku", "field", "target", "message"], fi.map((i) => [i.level, i.row ?? "", i.row !== undefined ? ps[i.row].id : "", i.key ?? "", i.target ?? "all", i.message])))];
      },
    },
  ],
  describeRow: (r, i) => `#${i} ${s(r.id)}${s(r.group) ? ` (group ${s(r.group)})` : ""} ${s(r.title)} ${[s(r.color), s(r.size), s(r.material)].filter(Boolean).join("/")} · ${s(r.price)}${s(r.salePrice) ? ` → ${s(r.salePrice)}` : ""} · stock ${s(r.stock)} · ${splitImages(r.images).length} image(s)`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
