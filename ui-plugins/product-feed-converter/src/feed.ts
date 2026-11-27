// 商品数据：统一成一套字段，再按各平台的导入格式输出，并按各自的必填规则检查。
export interface Product {
  row: number; id: string; group: string; title: string; description: string; price: number; salePrice: number; currency: string; brand: string; category: string;
  images: string[]; link: string; stock: number; availability: string; condition: string; gtin: string; mpn: string; weight: number; color: string; size: string; material: string; tags: string; status: string;
}
export type Target = "shopify" | "woocommerce" | "merchant";
export interface FeedIssue { level: "error" | "warn" | "info"; row?: number; key?: string; target?: Target; message: string }
export interface Options { currency: string; brand: string; condition: string; baseUrl: string; weightUnit: "kg" | "g" | "lb" }

const s = (v: unknown) => String(v ?? "").trim();
export const money = (v: unknown) => { if (typeof v === "number") return v; const t = s(v).replace(/[¥￥$€£,，\s元]|RMB|CNY|USD|EUR|GBP/gi, ""); return t === "" ? NaN : Number(t); };

/** GTIN-8/12/13/14 校验位。 */
export function gtinValid(g: string) {
  if (!/^\d{8}$|^\d{12,14}$/.test(g)) return false;
  const d = [...g].map(Number), check = d.pop()!;
  const sum = d.reverse().reduce((a, x, i) => a + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** 句柄 / slug：英文转小写连字符；中文标题用 SKU。 */
export function handleOf(p: Pick<Product, "group" | "title" | "id">) {
  const base = p.group || p.title;
  const slug = base.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length >= 3 ? slug.slice(0, 80) : (p.group || p.id).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "product";
}

export function availabilityOf(p: Pick<Product, "availability" | "stock">) {
  const a = p.availability.toLowerCase();
  if (/pre-?order|预售|预定/.test(a)) return "preorder";
  if (/back-?order|缺货可订/.test(a)) return "backorder";
  if (/out|无货|缺货|售罄|sold|下架|0$/.test(a)) return "out_of_stock";
  if (/in|有货|现货|在售/.test(a)) return "in_stock";
  return Number.isFinite(p.stock) ? (p.stock > 0 ? "in_stock" : "out_of_stock") : "in_stock";
}

const isUrl = (u: string) => /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(u);

export function validate(products: Product[], o: Options, targets: Target[]): FeedIssue[] {
  const out: FeedIssue[] = [];
  const ids = new Map<string, number>();
  for (const p of products) {
    const e = (level: FeedIssue["level"], key: string, message: string, target?: Target) => out.push({ level, row: p.row, key, target, message: `${p.id || `#${p.row}`}: ${message}` });
    if (!p.id) e("error", "id", "no SKU / id — every platform needs one / 缺少货号");
    else if (ids.has(p.id)) e("error", "id", `SKU used twice (also row ${ids.get(p.id)}) / 货号重复`);
    else ids.set(p.id, p.row);
    if (!p.title) e("error", "title", "no title / 缺少标题");
    if (!Number.isFinite(p.price) || p.price <= 0) e("error", "price", `price “${Number.isFinite(p.price) ? p.price : ""}” must be a number above 0 / 价格无效`);
    if (Number.isFinite(p.salePrice) && Number.isFinite(p.price) && p.salePrice >= p.price) e("warn", "salePrice", `sale price ${p.salePrice} is not below the regular price ${p.price} — it will be ignored / 促销价不低于原价`);
    for (const u of p.images) if (!isUrl(u)) e("warn", "images", `image “${u.slice(0, 60)}” is not a full http(s) URL / 图片不是完整网址`);
    if (p.gtin && !gtinValid(p.gtin)) e("warn", "gtin", `GTIN ${p.gtin} has a wrong length or check digit / 条码校验位不对`);
    if (targets.includes("merchant")) {
      if (!p.description) e("error", "description", "description is required for a shopping feed / 购物广告需要描述", "merchant");
      if (!p.images.length) e("error", "images", "an image is required for a shopping feed / 购物广告需要图片", "merchant");
      if (!p.link && !o.baseUrl) e("error", "link", "no product page link (set a store URL in settings or fill link) / 缺少商品链接", "merchant");
      if (p.link && !isUrl(p.link)) e("error", "link", `link “${p.link}” is not a full http(s) URL / 链接无效`, "merchant");
      if (p.title.length > 150) e("warn", "title", `title is ${p.title.length} characters; shopping feeds allow 150 / 标题过长`, "merchant");
      if (p.description.length > 5000) e("warn", "description", "description over 5000 characters / 描述过长", "merchant");
      if (!p.brand && !o.brand && !p.gtin && !p.mpn) e("warn", "brand", "no brand, GTIN or MPN — shopping feeds want at least brand + one identifier / 缺少品牌和识别码", "merchant");
      if (p.group && !p.color && !p.size && !p.material) e("warn", "color", "variant in a group without colour/size/material — the feed can't tell variants apart / 同组变体缺少颜色尺码", "merchant");
    }
    if ((targets.includes("shopify") || targets.includes("woocommerce")) && p.group && !p.color && !p.size && !p.material) e("warn", "size", "variant without any option value (colour/size/material) / 变体没有规格", targets.includes("shopify") ? "shopify" : "woocommerce");
  }
  // 同一组里规格组合重复
  const seen = new Map<string, number>();
  for (const p of products.filter((x) => x.group)) {
    const k = `${p.group}\u0000${p.color}\u0000${p.size}\u0000${p.material}`;
    if (seen.has(k)) out.push({ level: "error", row: p.row, key: "size", message: `${p.id}: same options as row ${seen.get(k)} in group ${p.group} / 同组规格重复` });
    else seen.set(k, p.row);
  }
  return out;
}

const csvCell = (v: unknown) => { const t = v === undefined || v === null || (typeof v === "number" && !Number.isFinite(v)) ? "" : String(v); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
export const csv = (header: string[], rows: unknown[][]) => "\ufeff" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
const groups = (ps: Product[]) => { const m = new Map<string, Product[]>(); for (const p of ps) { const k = p.group || `\u0000${p.id || p.row}`; m.set(k, [...(m.get(k) ?? []), p]); } return [...m.values()]; };
const optionNames = (g: Product[]) => (["color", "size", "material"] as const).filter((k) => g.some((p) => p[k]));
const OPT_LABEL = { color: "Color", size: "Size", material: "Material" } as const;
const toKg = (w: number, u: Options["weightUnit"]) => (u === "g" ? w / 1000 : u === "lb" ? w * 0.45359237 : w);
const price2 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "");
const linkOf = (p: Product, o: Options) => p.link || (o.baseUrl ? `${o.baseUrl.replace(/\/+$/, "")}/products/${handleOf(p)}` : "");
const hasSale = (p: Product) => Number.isFinite(p.salePrice) && p.salePrice > 0 && p.salePrice < p.price;

/** Shopify 商品导入 CSV：同一句柄多行 = 变体；多余图片单独成行。 */
export function shopifyCsv(ps: Product[], o: Options) {
  const H = ["Handle", "Title", "Body (HTML)", "Vendor", "Product Category", "Type", "Tags", "Published", "Option1 Name", "Option1 Value", "Option2 Name", "Option2 Value", "Option3 Name", "Option3 Value", "Variant SKU", "Variant Grams", "Variant Inventory Tracker", "Variant Inventory Qty", "Variant Inventory Policy", "Variant Fulfillment Service", "Variant Price", "Variant Compare At Price", "Variant Requires Shipping", "Variant Taxable", "Variant Barcode", "Image Src", "Image Position", "Image Alt Text", "Gift Card", "Variant Image", "Variant Weight Unit", "Status"];
  const rows: unknown[][] = [];
  for (const g of groups(ps)) {
    const head = g[0], handle = handleOf(head), opts = optionNames(g);
    const imgs = [...new Set(g.flatMap((p) => p.images))];
    g.forEach((p, i) => {
      const r: Record<string, unknown> = { Handle: handle, "Variant SKU": p.id, "Variant Grams": Number.isFinite(p.weight) ? Math.round(toKg(p.weight, o.weightUnit) * 1000) : "", "Variant Inventory Tracker": Number.isFinite(p.stock) ? "shopify" : "", "Variant Inventory Qty": Number.isFinite(p.stock) ? p.stock : "", "Variant Inventory Policy": "deny", "Variant Fulfillment Service": "manual", "Variant Price": price2(hasSale(p) ? p.salePrice : p.price), "Variant Compare At Price": hasSale(p) ? price2(p.price) : "", "Variant Requires Shipping": "TRUE", "Variant Taxable": "TRUE", "Variant Barcode": p.gtin, "Variant Image": g.length > 1 ? p.images[0] ?? "" : "", "Variant Weight Unit": o.weightUnit === "lb" ? "lb" : "kg", "Gift Card": "FALSE" };
      opts.forEach((k, j) => { if (i === 0) r[`Option${j + 1} Name`] = OPT_LABEL[k]; r[`Option${j + 1} Value`] = p[k] || "-"; });
      if (!opts.length && i === 0) { r["Option1 Name"] = "Title"; r["Option1 Value"] = "Default Title"; }
      if (i === 0) Object.assign(r, { Title: head.title, "Body (HTML)": htmlBody(head.description), Vendor: head.brand || o.brand, Type: head.category, Tags: head.tags, Published: head.status === "draft" ? "FALSE" : "TRUE", Status: head.status === "draft" ? "draft" : "active", "Image Src": imgs[0] ?? "", "Image Position": imgs[0] ? 1 : "", "Image Alt Text": imgs[0] ? head.title : "" });
      else if (imgs[i]) Object.assign(r, { "Image Src": imgs[i], "Image Position": i + 1 });
      rows.push(H.map((h) => r[h] ?? ""));
    });
    for (let i = g.length; i < imgs.length; i++) rows.push(H.map((h) => (h === "Handle" ? handle : h === "Image Src" ? imgs[i] : h === "Image Position" ? i + 1 : "")));
  }
  return csv(H, rows);
}

/** WooCommerce 商品导入 CSV：单品 simple；有分组的先写 variable 父商品，再写 variation。 */
export function wooCsv(ps: Product[], o: Options) {
  const H = ["Type", "SKU", "Name", "Published", "Is featured?", "Visibility in catalog", "Short description", "Description", "In stock?", "Stock", "Backorders allowed?", "Sale price", "Regular price", "Categories", "Tags", "Images", "Parent", "Brands", "Weight (kg)", "Attribute 1 name", "Attribute 1 value(s)", "Attribute 1 visible", "Attribute 1 global", "Attribute 2 name", "Attribute 2 value(s)", "Attribute 2 visible", "Attribute 2 global", "Attribute 3 name", "Attribute 3 value(s)", "Attribute 3 visible", "Attribute 3 global"];
  const rows: unknown[][] = [];
  const base = (p: Product) => ({ Published: p.status === "draft" ? 0 : 1, "Is featured?": 0, "Visibility in catalog": "visible", "In stock?": availabilityOf(p) === "out_of_stock" ? 0 : 1, Stock: Number.isFinite(p.stock) ? p.stock : "", "Backorders allowed?": availabilityOf(p) === "backorder" ? 1 : 0, "Sale price": hasSale(p) ? price2(p.salePrice) : "", "Regular price": price2(p.price), "Weight (kg)": Number.isFinite(p.weight) ? +toKg(p.weight, o.weightUnit).toFixed(3) : "" });
  for (const g of groups(ps)) {
    const head = g[0];
    const common = { Name: head.title, "Short description": head.description.split(/\n/)[0].slice(0, 200), Description: head.description, Categories: head.category.replace(/\s*[/>›]\s*/g, " > "), Tags: head.tags, Brands: head.brand || o.brand };
    if (!head.group) { rows.push(H.map((h) => ({ Type: "simple", SKU: head.id, ...common, ...base(head), Images: head.images.join(", ") } as Record<string, unknown>)[h] ?? "")); continue; }
    const opts = optionNames(g);
    const parentSku = head.group;
    const parent: Record<string, unknown> = { Type: "variable", SKU: parentSku, ...common, Published: 1, "Is featured?": 0, "Visibility in catalog": "visible", "In stock?": 1, Images: [...new Set(g.flatMap((p) => p.images))].join(", ") };
    opts.forEach((k, j) => Object.assign(parent, { [`Attribute ${j + 1} name`]: OPT_LABEL[k], [`Attribute ${j + 1} value(s)`]: [...new Set(g.map((p) => p[k]).filter(Boolean))].join(", "), [`Attribute ${j + 1} visible`]: 1, [`Attribute ${j + 1} global`]: 1 }));
    rows.push(H.map((h) => parent[h] ?? ""));
    for (const p of g) {
      const v: Record<string, unknown> = { Type: "variation", SKU: p.id, Name: `${head.title} - ${opts.map((k) => p[k]).filter(Boolean).join(", ")}`, ...base(p), Images: p.images[0] ?? "", Parent: parentSku };
      opts.forEach((k, j) => Object.assign(v, { [`Attribute ${j + 1} name`]: OPT_LABEL[k], [`Attribute ${j + 1} value(s)`]: p[k], [`Attribute ${j + 1} global`]: 1 }));
      rows.push(H.map((h) => v[h] ?? ""));
    }
  }
  return csv(H, rows);
}

const xml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const htmlBody = (d: string) => (/<[a-z][^>]*>/i.test(d) ? d : d.split(/\n{2,}/).map((p) => `<p>${xml(p).replace(/\n/g, "<br>")}</p>`).join(""));

/** 购物广告商品 feed（RSS 2.0 + g: 命名空间）。 */
export function merchantXml(ps: Product[], o: Options, title: string) {
  const items = ps.map((p) => {
    const cur = p.currency || o.currency;
    const f: [string, string][] = [["g:id", p.id], ["g:title", p.title.slice(0, 150)], ["g:description", p.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 5000)], ["g:link", linkOf(p, o)], ["g:image_link", p.images[0] ?? ""],
      ...p.images.slice(1, 11).map((u) => ["g:additional_image_link", u] as [string, string]), ["g:availability", availabilityOf(p)], ["g:price", `${price2(p.price)} ${cur}`], ["g:sale_price", hasSale(p) ? `${price2(p.salePrice)} ${cur}` : ""],
      ["g:brand", p.brand || o.brand], ["g:gtin", p.gtin], ["g:mpn", p.mpn], ["g:identifier_exists", !p.gtin && !p.mpn ? "no" : ""], ["g:condition", (p.condition || o.condition || "new").toLowerCase().replace(/^(全新|新品)$/, "new").replace(/^(二手|旧)$/, "used").replace(/^(翻新)$/, "refurbished")],
      ["g:product_type", p.category], ["g:item_group_id", p.group], ["g:color", p.color], ["g:size", p.size], ["g:material", p.material], ["g:shipping_weight", Number.isFinite(p.weight) ? `${+toKg(p.weight, o.weightUnit).toFixed(3)} kg` : ""]];
    return `    <item>\n${f.filter(([, v]) => v !== "").map(([k, v]) => `      <${k}>${xml(v)}</${k}>`).join("\n")}\n    </item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n  <channel>\n    <title>${xml(title || "Products")}</title>\n    <link>${xml(o.baseUrl || "https://example.com")}</link>\n    <description>${xml(title || "Product feed")}</description>\n${items.join("\n")}\n  </channel>\n</rss>\n`;
}
