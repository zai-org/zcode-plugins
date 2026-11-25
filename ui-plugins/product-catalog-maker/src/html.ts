import { formatPrice, groupByCategory, type PreparedImage, type Product, type Style } from "./catalog.ts";

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

/** 自包含 HTML 目录：图片内嵌，文字可直接在浏览器里改（contenteditable），可打印。 */
export function buildHtml(products: Product[], style: Style, images: Map<string, PreparedImage>, logo: PreparedImage | undefined, date: string, lang: "zh" | "en") {
  const none = lang === "zh" ? "未分类" : "Other";
  const cols = Number(style.grid.split("x")[0]);
  const src = (img: PreparedImage) => `data:image/jpeg;base64,${Buffer.from(img.jpeg).toString("base64")}`;
  const groups = groupByCategory(products, style.categoryOrder, none);
  const card = (p: Product) => {
    const img = p.image ? images.get(p.image) : undefined;
    const original = p.originalPrice !== null && p.price !== null && p.originalPrice > p.price ? `<s>${esc(formatPrice(p.originalPrice, style.currency))}</s>` : "";
    return `<article class="card"><div class="img">${img ? `<img src="${src(img)}" alt="${esc(p.name)}">` : `<span>${lang === "zh" ? "暂无图片" : "No image"}</span>`}</div>
<h3 contenteditable>${esc(p.name || p.sku)}</h3>${p.spec || p.desc ? `<p class="spec" contenteditable>${esc([p.spec, p.desc].filter(Boolean).join(" · "))}</p>` : ""}
<div class="row"><b class="price" contenteditable>${esc(formatPrice(p.price, style.currency, p.priceText))}${p.unit && p.price !== null ? ` /${esc(p.unit)}` : ""}</b>${original}${style.showSku && p.sku ? `<small>${esc(p.sku)}</small>` : ""}</div></article>`;
  };
  return `<!doctype html><html lang="${lang === "zh" ? "zh-CN" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(style.title)}</title><style>
:root{--p:${style.primary}}*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#111827;background:#f3f4f6}
.tip{background:#fffbeb;color:#92400e;padding:8px 16px;font-size:13px}.cover{background:var(--p);color:#fff;padding:56px 48px}.cover img{background:#fff;padding:8px;max-height:64px;margin-bottom:24px}
.cover h1{font-size:40px;margin:0 0 8px}.cover p{margin:4px 0;opacity:.9}main{max-width:1100px;margin:0 auto;padding:24px}
section h2{border-left:5px solid var(--p);background:color-mix(in srgb,var(--p) 10%,#fff);color:var(--p);padding:8px 14px;margin:28px 0 14px}
.grid{display:grid;grid-template-columns:repeat(${cols},1fr);gap:14px}.card{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:12px;display:flex;flex-direction:column}
.img{aspect-ratio:4/3;display:flex;align-items:center;justify-content:center;background:#f9fafb;margin-bottom:8px}.img img{max-width:100%;max-height:100%;object-fit:contain}.img span{color:#9ca3af;font-size:13px}
h3{font-size:15px;margin:0 0 4px}.spec{color:#6b7280;font-size:13px;margin:0 0 8px}.row{margin-top:auto;display:flex;align-items:baseline;gap:8px}.price{color:var(--p);font-size:18px}s{color:#9ca3af;font-size:12px}small{margin-left:auto;color:#9ca3af}
footer{color:#6b7280;font-size:12px;text-align:center;padding:24px}[contenteditable]:hover{outline:1px dashed #cbd5e1}
@media print{.tip{display:none}body{background:#fff}section{break-before:page}.card{break-inside:avoid}[contenteditable]:hover{outline:none}}
</style></head><body><div class="tip">${lang === "zh" ? "提示：可以直接点击文字修改，然后用浏览器“打印 → 另存为 PDF”。修改不会写回表格。" : "Tip: click any text to edit it, then use the browser's Print → Save as PDF. Edits are not written back to the spreadsheet."}</div>
<header class="cover">${logo ? `<img src="${src(logo)}" alt="logo">` : ""}<h1 contenteditable>${esc(style.title)}</h1>${style.subtitle ? `<p contenteditable>${esc(style.subtitle)}</p>` : ""}<p>${products.length} ${lang === "zh" ? "件商品 · 更新于" : "products · updated"} ${esc(date)}</p></header>
<main>${groups.map((g) => `<section><h2 contenteditable>${esc(g.name)}</h2><div class="grid">${g.items.map(card).join("\n")}</div></section>`).join("\n")}</main>
${style.footer ? `<footer contenteditable>${esc(style.footer)}</footer>` : ""}</body></html>
`;
}

export interface Snapshot {
  version: 1;
  date: string;
  products: { sku: string; name: string; price: number | null; priceText: string; category: string; image?: string; imageHash?: string }[];
}

/** 与上一版对比：新增、下架、改价、改名、换图、换分类。 */
export function diff(previous: Snapshot | undefined, current: Snapshot) {
  if (!previous) return undefined;
  const key = (p: Snapshot["products"][number]) => p.sku || `name:${p.name}`;
  const before = new Map(previous.products.map((p) => [key(p), p]));
  const after = new Map(current.products.map((p) => [key(p), p]));
  const added = current.products.filter((p) => !before.has(key(p)));
  const removed = previous.products.filter((p) => !after.has(key(p)));
  const changed: { sku: string; name: string; field: string; from: string; to: string }[] = [];
  for (const p of current.products) {
    const old = before.get(key(p));
    if (!old) continue;
    const show = (v: number | null, t: string) => (v === null ? t : String(v));
    if (old.price !== p.price || (p.price === null && old.priceText !== p.priceText)) changed.push({ sku: p.sku, name: p.name, field: "price", from: show(old.price, old.priceText), to: show(p.price, p.priceText) });
    if (old.name !== p.name) changed.push({ sku: p.sku, name: p.name, field: "name", from: old.name, to: p.name });
    if (old.category !== p.category) changed.push({ sku: p.sku, name: p.name, field: "category", from: old.category, to: p.category });
    if ((old.imageHash ?? "") !== (p.imageHash ?? "")) changed.push({ sku: p.sku, name: p.name, field: "image", from: old.image ?? "", to: p.image ?? "" });
  }
  return { since: previous.date, added, removed, changed };
}

export function changesMarkdown(d: NonNullable<ReturnType<typeof diff>>, lang: "zh" | "en") {
  const zh = lang === "zh";
  const label: Record<string, string> = zh ? { price: "价格", name: "名称", category: "分类", image: "图片" } : { price: "price", name: "name", category: "category", image: "image" };
  const lines = [zh ? `# 目录变更清单（对比 ${d.since} 版）` : `# Catalog changes (since ${d.since})`, ""];
  lines.push(zh ? `新增 ${d.added.length} · 下架 ${d.removed.length} · 修改 ${d.changed.length}` : `${d.added.length} added · ${d.removed.length} removed · ${d.changed.length} changed`, "");
  if (d.added.length) lines.push(zh ? "## 新增" : "## Added", ...d.added.map((p) => `- ${p.sku} ${p.name}`), "");
  if (d.removed.length) lines.push(zh ? "## 下架" : "## Removed", ...d.removed.map((p) => `- ${p.sku} ${p.name}`), "");
  if (d.changed.length) lines.push(zh ? "## 修改" : "## Changed", ...d.changed.map((c) => `- ${c.sku} ${c.name}：${label[c.field]} ${c.from || "—"} → ${c.to || "—"}`), "");
  return lines.join("\n");
}
