import { createApp, esc, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders, num } from "./kit/columns.ts";
import { newPdf, PAGE } from "./kit/pdf.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { fmt2, s } from "./util.ts";

export const NAME = "bom-costing";
export const VERSION = "0.1.0";

const IH = {
  code: ["物料编码", "编码", "料号", "物料号", "item", "part", "part no", "code", "sku"],
  name: ["名称", "物料名称", "品名", "description", "name"],
  type: ["类型", "来源", "自制/外购", "make/buy", "type", "source"],
  price: ["单价", "采购单价", "成本", "加工费", "price", "unit cost", "cost"],
  stock: ["库存", "现有库存", "在库", "stock", "on hand"],
  moq: ["最小起订量", "起订量", "moq", "min order"],
  pack: ["包装倍数", "整包数量", "包装数", "pack", "pack size", "multiple"],
  lead: ["交期", "交期天数", "采购周期", "lead time", "lead"],
  supplier: ["供应商", "supplier", "vendor"],
  unit: ["单位", "unit", "uom"],
};
const BH = {
  parent: ["父件", "父项", "上级", "成品", "parent", "assembly"],
  child: ["子件", "子项", "物料编码", "组件", "component", "child", "part"],
  qty: ["用量", "单位用量", "数量", "qty", "quantity", "qty per"],
  scrap: ["损耗率", "损耗", "报废率", "scrap", "scrap %", "loss"],
  note: ["备注", "位号", "note", "ref"],
};

interface Item { i: number; code: string; name: string; make: boolean; price: number; stock: number; moq: number; pack: number; lead: number; supplier: string; unit: string }
interface Line { i: number; parent: string; child: string; qty: number; scrap: number }

const scrapOf = (v: string) => { const t = v.replace(/%$/, "").trim(); if (!t) return 0; const n = Number(t); if (!Number.isFinite(n)) return NaN; return v.trim().endsWith("%") || n >= 1 ? n / 100 : n; };
function lev(a: string, b: string) { const d = Array.from({ length: b.length + 1 }, (_, j) => j); for (let i = 1; i <= a.length; i++) { let prev = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; } } return d[b.length]; }
const norm = (c: string) => c.toUpperCase().replace(/O/g, "0").replace(/[\s_]/g, "-");

export function parseBuild(v: string) { const out: { code: string; qty: number }[] = []; for (const part of v.split(/[,，;；\n]+/)) { const m = /^(.+?)\s*[=×x*：:]\s*(\d+(?:\.\d+)?)$/.exec(part.trim()); if (m) out.push({ code: m[1].trim(), qty: Number(m[2]) }); } return out; }

function analyse(p: Project) {
  const issues: Issue[] = [], items = new Map<string, Item>(), lines: Line[] = [];
  p.rows.forEach((r, i) => {
    if (r.kind !== "item" || r.include === false) return;
    const code = s(r.code);
    if (!code) { issues.push({ level: "error", row: i, key: "code", message: `#${i} ${s(r.name)}: no item code.` }); return; }
    if (items.has(code)) { issues.push({ level: "error", row: i, key: "code", message: `Item code ${code} is listed twice (#${items.get(code)!.i} and #${i}).` }); return; }
    const price = s(r.price) ? num(r.price) : NaN;
    items.set(code, { i, code, name: s(r.name), make: /自制|make|组装|半成品|成品|assembly/i.test(s(r.type)), price, stock: num(r.stock) || 0, moq: num(r.moq) || 0, pack: num(r.pack) || 0, lead: num(r.lead) || 0, supplier: s(r.supplier), unit: s(r.unit) });
  });
  const codes = [...items.keys()], seen = new Map<string, number>();
  p.rows.forEach((r, i) => {
    if (r.kind !== "bom" || r.include === false) return;
    const parent = s(r.parent), child = s(r.child), qty = num(r.qty), scrap = scrapOf(s(r.scrap)), tag = `BOM #${i} ${parent} → ${child}`;
    let ok = true;
    for (const [c, key] of [[parent, "parent"], [child, "child"]] as const) if (!items.has(c)) {
      const near = codes.map((x) => [x, lev(norm(c), norm(x))] as const).sort((a, b) => a[1] - b[1])[0];
      issues.push({ level: "error", row: i, key, message: `${tag}: ${key === "parent" ? "parent" : "component"} “${c}” isn't in the item list${near && near[1] <= 1 ? ` — did you mean ${near[0]} (${items.get(near[0])!.name})?` : ""}.` }); ok = false;
    }
    if (!Number.isFinite(qty) || qty <= 0) { issues.push({ level: "error", row: i, key: "qty", message: `${tag}: quantity “${s(r.qty)}” must be a number above 0.` }); ok = false; }
    if (!Number.isFinite(scrap) || scrap < 0) { issues.push({ level: "error", row: i, key: "scrap", message: `${tag}: can't read the scrap rate “${s(r.scrap)}” — write 3% or 0.03.` }); ok = false; }
    else if (scrap > 0.3) issues.push({ level: "warn", row: i, key: "scrap", message: `${tag}: scrap ${Math.round(scrap * 100)}% is unusually high — check the rate.` });
    const k = `${parent}|${child}`;
    if (seen.has(k)) issues.push({ level: "warn", row: i, message: `${tag} is listed twice (also BOM #${seen.get(k)}) — both are counted; merge them if that's not intended.` });
    seen.set(k, i);
    if (ok) lines.push({ i, parent, child, qty, scrap });
  });
  const kids = new Map<string, Line[]>();
  for (const l of lines) kids.set(l.parent, [...(kids.get(l.parent) ?? []), l]);
  // 环
  const state = new Map<string, number>(), cyc = new Set<string>();
  const visit = (c: string, path: string[]) => { if (state.get(c) === 1) { const loop = [...path.slice(path.indexOf(c)), c].join(" → "); if (!cyc.has(loop)) { cyc.add(loop); issues.push({ level: "error", message: `The BOM loops back on itself: ${loop} — an item can't contain itself.` }); } return; } if (state.get(c) === 2) return; state.set(c, 1); for (const l of kids.get(c) ?? []) visit(l.child, [...path, c]); state.set(c, 2); };
  for (const c of codes) visit(c, []);
  // 单位成本（自下而上）
  const cost = new Map<string, number>(), missing = new Set<string>();
  const unitCost = (c: string, depth = 0): number => {
    if (cost.has(c)) return cost.get(c)!;
    const it = items.get(c)!, ks = kids.get(c) ?? [];
    if (depth > 30 || cyc.size) return Number.isFinite(it.price) ? it.price : 0;
    let v = 0;
    if (ks.length) { v = (Number.isFinite(it.price) ? it.price : 0) + ks.reduce((a, l) => a + l.qty * (1 + l.scrap) * unitCost(l.child, depth + 1), 0); }
    else if (Number.isFinite(it.price) && it.price >= 0) v = it.price;
    else missing.add(c);
    cost.set(c, v); return v;
  };
  for (const c of codes) unitCost(c);
  for (const c of missing) { const it = items.get(c)!; const used = lines.filter((l) => l.child === c).map((l) => l.parent); issues.push({ level: "error", row: it.i, key: "price", message: `${c} ${it.name}: no price${s(p.rows[it.i].price) ? ` (“${s(p.rows[it.i].price)}”)` : ""}, so ${used.length ? used.join(", ") : "it"} can't be costed — fill in the unit price.` }); }
  for (const it of items.values()) {
    if (it.make && !kids.has(it.code)) issues.push({ level: "warn", row: it.i, message: `${it.code} ${it.name} is marked 自制 (made) but has no BOM lines.` });
    if (!lines.some((l) => l.child === it.code) && !kids.has(it.code)) issues.push({ level: "info", row: it.i, message: `${it.code} ${it.name} isn't used in any BOM.` });
  }
  // 需求展开
  const build = parseBuild(s(p.settings.build)).filter((b) => { if (!items.has(b.code)) { issues.push({ level: "error", key: "build", message: `Build plan: “${b.code}” isn't in the item list.` }); return false; } return true; });
  const useStock = p.settings.useStock !== false;
  const gross = new Map<string, number>(), net = new Map<string, number>(), avail = new Map(codes.map((c) => [c, useStock ? items.get(c)!.stock : 0]));
  // 按层级（最深层级）顺序展开，保证子件需求汇总后再计算净需求
  const level = new Map<string, number>();
  const lv = (c: string, d: number) => { if (d > 30) return; if ((level.get(c) ?? -1) >= d) return; level.set(c, d); for (const l of kids.get(c) ?? []) lv(l.child, d + 1); };
  if (!cyc.size) for (const b of build) lv(b.code, 0);
  for (const b of build) gross.set(b.code, (gross.get(b.code) ?? 0) + b.qty);
  if (!cyc.size) for (const c of [...level.keys()].sort((a, b) => level.get(a)! - level.get(b)!)) {
    const g = gross.get(c) ?? 0, isTop = build.some((b) => b.code === c), n = Math.max(0, g - (isTop ? 0 : avail.get(c) ?? 0));
    net.set(c, n);
    for (const l of kids.get(c) ?? []) gross.set(l.child, (gross.get(l.child) ?? 0) + n * l.qty * (1 + l.scrap));
  }
  const buy = [...net].filter(([c, n]) => n > 1e-9 && !kids.has(c)).map(([c, n]) => {
    const it = items.get(c)!, need = Math.ceil(n - 1e-9);
    let order = Math.max(need, it.moq); if (it.pack > 0) order = Math.ceil(order / it.pack) * it.pack;
    return { it, gross: gross.get(c) ?? 0, need, order, amount: order * (Number.isFinite(it.price) ? it.price : 0) };
  }).sort((a, b) => a.it.supplier.localeCompare(b.it.supplier, "zh") || a.it.code.localeCompare(b.it.code));
  const make = [...net].filter(([c, n]) => n > 1e-9 && kids.has(c)).map(([c, n]) => ({ it: items.get(c)!, gross: gross.get(c) ?? 0, net: Math.ceil(n - 1e-9) }));
  for (const b of buy) if (b.it.lead > Number(p.settings.leadWarn ?? 20)) issues.push({ level: "info", row: b.it.i, message: `${b.it.code} ${b.it.name}: lead time ${b.it.lead} days — order it first.` });
  return { issues, items, lines, kids, cost, build, gross, net, buy, make, cyc: cyc.size > 0, missing };
}

function tree(a: ReturnType<typeof analyse>, top: string) {
  const out: { level: number; code: string; name: string; qty: number; ext: number; unit: number; extCost: number; scrap: number }[] = [];
  const walk = (c: string, lvl: number, ext: number) => { if (lvl > 30) return; for (const l of a.kids.get(c) ?? []) { const it = a.items.get(l.child)!, e = ext * l.qty * (1 + l.scrap), u = a.cost.get(l.child) ?? 0; out.push({ level: lvl, code: l.child, name: it.name, qty: l.qty, ext: e, unit: u, extCost: l.qty * (1 + l.scrap) * u * ext, scrap: l.scrap }); walk(l.child, lvl + 1, e); } };
  if (!a.cyc) walk(top, 1, 1);
  return out;
}
const n4 = (n: number) => Math.round(n * 10000) / 10000;

function makeDef(): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "bom",
    title: ["物料清单核算", "BOM Costing"],
    openDescription:
      "Roll up a multi-level bill of materials into unit costs and work out what to buy for a production run. Pick a .xlsx with an item sheet (物料编码/code, 名称/name, 类型/type 自制 make or 外购 buy, 单价/price — for made items the price is the added labour/overhead per unit —, 库存/stock, 最小起订量/MOQ, 包装倍数/pack multiple, 交期/lead days, 供应商/supplier, 单位/unit) and a BOM sheet (父件/parent, 子件/component, 用量/qty per parent, 损耗率/scrap like 3% or 0.03), or two .csv files. Rows: item rows (kind item) then BOM rows (kind bom); edit prices, quantities, scrap or add lines. Settings: build (production plan like “LAMP-01=300, LAMP-02=150”), useStock (net off stock at every level, default on), leadWarn (days). Cost = own price + Σ qty × (1 + scrap) × component cost, bottom-up through all levels. Requirements are exploded level by level; sub-assemblies in stock are used before their parts are ordered; purchase quantities are rounded up to MOQ and pack multiples. Checks: components or parents missing from the item list (suggests the right code for typos like P-OO5), BOM loops, missing prices, bad quantities and scrap, very high scrap, duplicate BOM lines, made items without a BOM, unused items, unknown build items, long lead times. Exports costed-bom.xlsx (indented BOM with extended quantities and costs per product, cost summary, requirements, purchase list by supplier), purchase-list.csv and cost-sheets.pdf (one page per product with the indented cost breakdown).",
    inputs: { exts: [".xlsx", ".csv"], min: 1, max: 2, folders: true, label: ["选择 BOM 表", "Pick the BOM workbook"] },
    settings: [
      { key: "build", label: ["生产计划（编码=数量）", "Build plan (code=qty)"], type: "textarea", default: "" },
      { key: "useStock", label: ["扣减现有库存", "Use stock on hand"], type: "bool", default: true },
      { key: "leadWarn", label: ["交期提醒（天）", "Long lead time (days)"], type: "number", default: 20, min: 0, max: 365 },
      { key: "currency", label: ["币种符号", "Currency"], type: "text", default: "¥" },
    ],
    columns: () => [
      { key: "include", label: ["保留", "Keep"], type: "bool" },
      { key: "_type", label: ["行", "Row"], readOnly: true },
      { key: "code", label: ["物料编码", "Code"] },
      { key: "name", label: ["名称", "Name"], wide: true },
      { key: "type", label: ["类型", "Make/buy"], type: "select", options: ["自制", "外购"] },
      { key: "price", label: ["单价/加工费", "Price"], type: "number" },
      { key: "stock", label: ["库存", "Stock"], type: "number" },
      { key: "moq", label: ["起订量", "MOQ"], type: "number" },
      { key: "pack", label: ["包装倍数", "Pack"], type: "number" },
      { key: "supplier", label: ["供应商", "Supplier"] },
      { key: "parent", label: ["父件", "Parent"] },
      { key: "child", label: ["子件", "Component"] },
      { key: "qty", label: ["用量", "Qty per"], type: "number" },
      { key: "scrap", label: ["损耗率", "Scrap"] },
      { key: "_cost", label: ["单位成本", "Unit cost"], readOnly: true },
      { key: "_need", label: ["需求/采购", "Need / buy"], readOnly: true },
      { key: "note", label: ["备注", "Note"] },
    ] as Column[],
    newRow: () => ({ kind: "bom", include: true, code: "", name: "", type: "", price: "", stock: "", moq: "", pack: "", lead: "", supplier: "", unit: "", parent: "", child: "", qty: "", scrap: "", note: "" }),
    async load({ ws, files }) {
      const list: string[] = [];
      for (const f of files) { if (/\.(xlsx|csv)$/i.test(f)) list.push(f); else for (const x of await ws.list({ dir: f, exts: [".xlsx", ".csv"], limit: 20 })) list.push(x.path); }
      const blank = { code: "", name: "", type: "", price: "", stock: "", moq: "", pack: "", lead: "", supplier: "", unit: "", parent: "", child: "", qty: "", scrap: "", note: "" };
      const cell = (v: unknown) => s(v);
      const itemRows: Row[] = [], bomRows: Row[] = [];
      let plan = "";
      for (const f of [...new Set(list)].filter((x) => !x.startsWith(NAME + "/"))) {
        const first = await readTable(ws, f);
        const names = /\.xlsx$/i.test(f) && first.sheets?.length ? first.sheets : [undefined];
        for (const sh of names) {
          const t = sh === undefined ? first : await readTable(ws, f, sh);
          const bh = mapHeaders(t.columns, BH), ih = mapHeaders(t.columns, IH);
          if (bh.parent && bh.child && bh.qty) { for (const r of t.rows) if (cell(r[bh.parent]) || cell(r[bh.child])) bomRows.push({ ...blank, kind: "bom", include: true, ...Object.fromEntries(Object.entries(bh).filter(([, c]) => c).map(([k, c]) => [k, cell(r[c!])])) }); }
          else if (ih.code && (ih.price || ih.type)) { for (const r of t.rows) if (cell(r[ih.code])) itemRows.push({ ...blank, kind: "item", include: true, ...Object.fromEntries(Object.entries(ih).filter(([, c]) => c).map(([k, c]) => [k, cell(r[c!])])) }); }
          else { const ph = mapHeaders(t.columns, { code: ["成品", "产品", "物料编码", "编码", "product", "item", "code"], qty: ["生产数量", "计划数量", "数量", "qty", "quantity"] }); if (ph.code && ph.qty && /计划|plan|build|生产/i.test(`${sh ?? ""}${f}`)) plan = t.rows.filter((r) => cell(r[ph.code!])).map((r) => `${cell(r[ph.code!])}=${cell(r[ph.qty!])}`).join(", "); }
        }
      }
      if (!itemRows.length) throw new KitError("no_items", "No item list found (a sheet with 物料编码/code and 单价/price or 类型/type).");
      if (!bomRows.length) throw new KitError("no_bom", "No BOM lines found (a sheet with 父件/parent, 子件/component and 用量/qty).");
      return { rows: [...itemRows, ...bomRows], meta: { plan } };
    },
    compute(p): Computed {
      const a = analyse(p), cur = s(p.settings.currency) || "¥";
      if (!s(p.settings.build) && s((p.meta as { plan?: string }).plan)) a.issues.push({ level: "info", message: `The workbook has a build plan (${s((p.meta as { plan?: string }).plan)}) — put it in the build setting to use it.` });
      if (!a.build.length) a.issues.push({ level: "info", key: "build", message: "No build plan yet — set build (e.g. LAMP-01=300) to get requirements and a purchase list." });
      const buyBy = new Map(a.buy.map((b) => [b.it.code, b])), makeBy = new Map(a.make.map((m) => [m.it.code, m]));
      const rows = p.rows.map((r) => {
        if (r.kind === "item") { const c = s(r.code), b = buyBy.get(c), m = makeBy.get(c); return { ...r, _type: "物料", _cost: a.cost.has(c) && !a.missing.has(c) ? fmt2(a.cost.get(c)!) : "", _need: b ? `需 ${b.need}，买 ${b.order}` : m ? `需做 ${m.net}` : a.gross.get(c) ? "库存够" : "" }; }
        return { ...r, _type: "BOM", _cost: "", _need: "" };
      });
      const tops = [...new Set([...a.build.map((b) => b.code), ...[...a.kids.keys()].filter((c) => !a.lines.some((l) => l.child === c))])];
      const total = a.buy.reduce((x, b) => x + b.amount, 0);
      return {
        rows, issues: a.issues,
        summary: `${a.items.size} item(s), ${a.lines.length} BOM line(s). Unit cost: ${tops.map((c) => `${c} ${cur}${fmt2(a.cost.get(c) ?? 0)}`).join(", ") || "—"}.${a.build.length ? ` Build ${a.build.map((b) => `${b.code}×${b.qty}`).join(", ")}: ${a.buy.length} item(s) to buy, ${cur}${fmt2(total)}.` : ""}`,
        stats: { items: a.items.size, lines: a.lines.length, toBuy: a.buy.length, purchase: Math.round(total * 100) / 100 },
        preview: `<div style="font:12px system-ui,sans-serif">${tops.map((c) => `<div><b>${esc(c)}</b> ${esc(a.items.get(c)?.name ?? "")}：${esc(cur)}${fmt2(a.cost.get(c) ?? 0)}</div>`).join("")}${a.buy.length ? `<div style="margin-top:6px"><b>采购</b><ul style="margin:2px 0;padding-left:16px">${a.buy.map((b) => `<li>${esc(b.it.code)} ${esc(b.it.name)}：${b.order}${b.order !== b.need ? `（需 ${b.need}）` : ""} · ${esc(b.it.supplier)}</li>`).join("")}</ul></div>` : ""}</div>`,
      };
    },
    exports: [
      { id: "xlsx", label: ["成本核算 Excel", "Costed BOM (Excel)"], description: "costed-bom.xlsx", async run(ctx: ExportCtx) {
        const a = analyse(ctx.project), tops = [...new Set([...a.build.map((b) => b.code), ...[...a.kids.keys()].filter((c) => !a.lines.some((l) => l.child === c))])];
        const sheets = tops.map((t) => ({ name: `${t} 成本`, headers: ["层级", "物料编码", "名称", "单位用量", "损耗率", "累计用量", "单位成本", "成本"],
          rows: [[0, t, a.items.get(t)?.name ?? "", 1, "", 1, Math.round((a.cost.get(t) ?? 0) * 100) / 100, Math.round((a.cost.get(t) ?? 0) * 100) / 100], ...tree(a, t).map((x) => [x.level, `${"  ".repeat(x.level)}${x.code}`, x.name, x.qty, x.scrap ? `${Math.round(x.scrap * 1000) / 10}%` : "", n4(x.ext), Math.round(x.unit * 100) / 100, Math.round(x.extCost * 100) / 100])],
          numberFormat: { 6: "#,##0.00", 7: "#,##0.00" } }));
        return [await ctx.write("costed-bom.xlsx", await writeXlsx([
          { name: "成本汇总", headers: ["物料编码", "名称", "类型", "自身单价/加工费", "单位成本"], rows: [...a.items.values()].map((it) => [it.code, it.name, a.kids.has(it.code) ? "自制" : "外购", Number.isFinite(it.price) ? it.price : "", a.missing.has(it.code) ? "缺单价" : Math.round((a.cost.get(it.code) ?? 0) * 100) / 100]), numberFormat: { 3: "#,##0.00", 4: "#,##0.00" } },
          ...sheets,
          { name: "需求计算", headers: ["物料编码", "名称", "毛需求", "库存", "净需求", "类型"], rows: [...a.gross].map(([c, g]) => { const it = a.items.get(c)!; return [c, it.name, n4(g), it.stock, Math.ceil((a.net.get(c) ?? 0) - 1e-9), a.kids.has(c) ? "自制" : "外购"]; }) },
          { name: "采购清单", headers: ["供应商", "物料编码", "名称", "净需求", "起订量", "包装倍数", "采购数量", "单价", "金额", "交期（天）"], rows: a.buy.map((b) => [b.it.supplier, b.it.code, b.it.name, b.need, b.it.moq || "", b.it.pack || "", b.order, Number.isFinite(b.it.price) ? b.it.price : "", Math.round(b.amount * 100) / 100, b.it.lead || ""]), numberFormat: { 7: "#,##0.00", 8: "#,##0.00" } },
        ]))];
      } },
      { id: "csv", label: ["采购清单 CSV", "Purchase list (CSV)"], description: "purchase-list.csv", async run(ctx: ExportCtx) {
        const a = analyse(ctx.project), q = (v: unknown) => { const t = String(v ?? ""); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
        const txt = ["供应商,物料编码,名称,净需求,采购数量,单价,金额,交期天数", ...a.buy.map((b) => [b.it.supplier, b.it.code, b.it.name, b.need, b.order, Number.isFinite(b.it.price) ? b.it.price : "", fmt2(b.amount), b.it.lead || ""].map(q).join(","))].join("\r\n");
        return [await ctx.write("purchase-list.csv", "\uFEFF" + txt + "\r\n")];
      } },
      { id: "pdf", label: ["成本单 PDF", "Cost sheets (PDF)"], description: "cost-sheets.pdf", async run(ctx: ExportCtx) {
        const p = ctx.project, a = analyse(p), cur = s(p.settings.currency) || "¥", k = await newPdf(), [W, H] = PAGE.A4, M = 44;
        const tops = [...new Set([...a.build.map((b) => b.code), ...[...a.kids.keys()].filter((c) => !a.lines.some((l) => l.child === c))])];
        for (const t of tops) {
          let pg = k.doc.addPage([W, H]), y = H - 50;
          k.text(pg, `${t}  ${a.items.get(t)?.name ?? ""}`, M, y, { size: 16, bold: true }); y -= 20;
          k.text(pg, `单位成本 ${cur}${fmt2(a.cost.get(t) ?? 0)}${Number.isFinite(a.items.get(t)?.price ?? NaN) ? `（含组装/加工 ${cur}${fmt2(a.items.get(t)!.price)}）` : ""}`, M, y, { size: 11, color: "#1D4ED8" }); y -= 24;
          const head = ["物料", "用量", "损耗", "单位成本", "成本"], xs = [M, M + 280, M + 330, M + 390, W - M];
          head.forEach((h, j) => k.text(pg, h, xs[j], y, { size: 9, bold: true, color: "#6B7280", align: j ? "right" : "left" })); y -= 14;
          for (const x of tree(a, t)) {
            if (y < 50) { pg = k.doc.addPage([W, H]); y = H - 50; }
            k.text(pg, `${x.code}  ${x.name}`, M + (x.level - 1) * 14, y, { size: 9.5, bold: x.level === 1, maxWidth: 250 - (x.level - 1) * 14 });
            k.text(pg, String(n4(x.qty)), xs[1], y, { size: 9.5, align: "right" }); k.text(pg, x.scrap ? `${Math.round(x.scrap * 1000) / 10}%` : "", xs[2], y, { size: 9, align: "right", color: "#6B7280" });
            k.text(pg, fmt2(x.unit), xs[3], y, { size: 9.5, align: "right" }); k.text(pg, fmt2(x.extCost), xs[4], y, { size: 9.5, align: "right", bold: x.level === 1 }); y -= 15;
          }
        }
        if (!tops.length) k.doc.addPage([W, H]);
        return [await ctx.write("cost-sheets.pdf", await k.doc.save())];
      } },
    ],
    describeRow: (r, i) => r.kind === "item"
      ? `#${i} [item] ${s(r.code)} ${s(r.name)} ${s(r.type)} price ${s(r.price) || "?"} stock ${s(r.stock) || 0}${s(r.moq) ? ` MOQ ${s(r.moq)}` : ""}${s(r.pack) ? ` pack ${s(r.pack)}` : ""}${s(r.supplier) ? ` @${s(r.supplier)}` : ""}${s(r._cost) ? ` | cost ${s(r._cost)}` : ""}${s(r._need) ? ` | ${s(r._need)}` : ""}`
      : `#${i}${r.include === false ? " [dropped]" : ""} [bom] ${s(r.parent)} → ${s(r.child)} × ${s(r.qty)}${s(r.scrap) ? ` scrap ${s(r.scrap)}` : ""}`,
  };
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(), options).server;
}
