import { createApp, esc, toCsv, type AppDef, type Issue, type Project } from "./kit/app.ts";
import { mapHeaders, num } from "./kit/columns.ts";
import { rgb } from "pdf-lib";
import { MM, newPdf, PAGE } from "./kit/pdf.ts";
import { readTable } from "./kit/table.ts";
import { KitError, safeFileName } from "./kit/workspace.ts";
import { barcodeSvg, encode, totalModules, type Encoded, type Kind } from "./barcode.ts";

export const NAME = "barcode-label-maker";
export const VERSION = "0.1.0";
const ALIASES = { sku: ["货号", "编码", "sku", "item code", "code"], name: ["品名", "名称", "商品名称", "商品", "name", "product", "title"], price: ["售价", "价格", "单价", "price", "retail"], barcode: ["条码", "条形码", "ean", "upc", "gtin", "barcode"], qty: ["数量", "份数", "张数", "qty", "quantity", "copies"] };

// 常见 A4 / Letter 不干胶标签纸规格（mm）：列、行、标签宽高、页边距、间距
export const SHEETS: Record<string, { label: [string, string]; page: "A4" | "Letter"; cols: number; rows: number; w: number; h: number; left: number; top: number; gx: number; gy: number }> = {
  "a4-3x8": { label: ["A4 3×8（70×37 mm）", "A4 3×8 (70×37 mm)"], page: "A4", cols: 3, rows: 8, w: 70, h: 37, left: 0, top: 0.5, gx: 0, gy: 0 },
  "a4-4x10": { label: ["A4 4×10（52.5×29.7 mm）", "A4 4×10 (52.5×29.7 mm)"], page: "A4", cols: 4, rows: 10, w: 52.5, h: 29.7, left: 0, top: 0, gx: 0, gy: 0 },
  "a4-2x7": { label: ["A4 2×7（99.1×38.1 mm）", "A4 2×7 (99.1×38.1 mm)"], page: "A4", cols: 2, rows: 7, w: 99.1, h: 38.1, left: 4.65, top: 15.15, gx: 2.5, gy: 0 },
  "a4-5x13": { label: ["A4 5×13（38.1×21.2 mm）", "A4 5×13 (38.1×21.2 mm)"], page: "A4", cols: 5, rows: 13, w: 38.1, h: 21.2, left: 4.75, top: 10.7, gx: 2.5, gy: 0 },
  "letter-3x10": { label: ["Letter 3×10（66.7×25.4 mm）", "Letter 3×10 (66.7×25.4 mm)"], page: "Letter", cols: 3, rows: 10, w: 66.7, h: 25.4, left: 4.8, top: 12.7, gx: 3.2, gy: 0 },
};

function enc(r: Record<string, unknown>, kind: Kind): { e?: Encoded; err?: string } {
  const v = String(r.barcode || r.sku || "");
  try { return { e: encode(v, kind) }; } catch (x) { return { err: (x as Error).message }; }
}
const copies = (r: Record<string, unknown>) => { const n = num(r.qty); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1; };

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "labels",
  title: ["条码标签打印", "Barcode Label Maker"],
  openDescription:
    "Make barcode labels from a product sheet (.xlsx/.csv; columns like sku/货号, name/品名, price/售价, barcode/条码, qty/数量 = copies). 13-digit numbers become EAN-13 (check digit verified), valid 12-digit UPC-A stays UPC-A, 12 digits otherwise get an EAN-13 check digit added, anything else (or an empty barcode → the SKU) becomes Code 128. Lays labels out on common A4/Letter label sheets.",
  inputs: { exts: [".xlsx", ".csv"], min: 1, max: 1, label: ["选择商品表格", "Pick the product sheet"] },
  settings: [
    { key: "sheet", label: ["标签纸", "Label sheet"], type: "select", default: "a4-3x8", options: Object.entries(SHEETS).map(([value, s]) => ({ value, label: s.label })) },
    { key: "kind", label: ["条码类型", "Barcode type"], type: "select", default: "auto", options: [{ value: "auto", label: ["自动", "Auto"] }, { value: "ean13", label: ["EAN-13", "EAN-13"] }, { value: "upca", label: ["UPC-A", "UPC-A"] }, { value: "code128", label: ["Code 128", "Code 128"] }] },
    { key: "showName", label: ["显示品名", "Show name"], type: "bool", default: true },
    { key: "showPrice", label: ["显示价格", "Show price"], type: "bool", default: true },
    { key: "skip", label: ["跳过已用的标签数", "Skip used labels"], type: "number", default: 0, min: 0, max: 200, help: ["半张用过的标签纸从第几个开始", "Start on a partly used sheet"] },
    { key: "outline", label: ["打印标签边框（试打用）", "Print label outlines (test print)"], type: "bool", default: false },
  ],
  columns: () => [
    { key: "sku", label: ["货号", "SKU"] },
    { key: "name", label: ["品名", "Name"], wide: true },
    { key: "price", label: ["价格", "Price"] },
    { key: "barcode", label: ["条码", "Barcode"] },
    { key: "qty", label: ["张数", "Copies"], type: "number" },
    { key: "_type", label: ["类型", "Type"], readOnly: true },
    { key: "_human", label: ["条码数字", "Encoded"], readOnly: true },
  ],
  newRow: () => ({ sku: "", name: "", price: "", barcode: "", qty: 1 }),
  async load({ ws, files }) {
    const t = await readTable(ws, files[0]);
    const m = mapHeaders(t.columns, ALIASES);
    if (!m.barcode && !m.sku) throw new KitError("columns_not_found", `Need a barcode (条码/EAN/UPC) or SKU (货号) column. Columns: ${t.columns.join(", ")}`);
    return { rows: t.rows.map((r) => Object.fromEntries(Object.keys(ALIASES).map((k) => [k, m[k] ? r[m[k]!] : k === "qty" ? 1 : ""]))) };
  },
  compute(p) {
    const kind = (p.settings.kind as Kind) ?? "auto";
    const issues: Issue[] = [];
    let total = 0;
    const rows = p.rows.map((r, i) => {
      const { e, err } = enc(r, kind);
      if (err) issues.push({ level: "error", row: i, key: "barcode", message: `${err === "empty" ? "No barcode or SKU / 没有条码或货号" : err}` });
      if (e?.warn) issues.push({ level: "warn", row: i, key: "barcode", message: e.warn });
      if (e && !r.barcode) issues.push({ level: "info", row: i, message: `No barcode; the SKU “${r.sku}” is printed as Code 128 / 没有条码，用货号生成 Code 128` });
      if (e && e.kind === "code128" && e.text.length > 20) issues.push({ level: "warn", row: i, message: "Long Code 128 values get very narrow bars on small labels." });
      total += e ? copies(r) : 0;
      return { ...r, _type: e?.kind.toUpperCase() ?? "", _human: e?.human ?? "" };
    });
    const sheet = SHEETS[String(p.settings.sheet)] ?? SHEETS["a4-3x8"];
    const per = sheet.cols * sheet.rows;
    const pages = Math.ceil((total + Number(p.settings.skip ?? 0)) / per);
    const preview = `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">${p.rows.slice(0, 8).map((r) => { const { e } = enc(r, kind); return `<div style="border:1px dashed #bbb;padding:6px;text-align:center;font-size:11px;background:#fff;color:#111">${p.settings.showName !== false ? `<div><b>${esc(r.name)}</b></div>` : ""}${e ? barcodeSvg(e, 40, 1.4).replace("<svg ", '<svg style="max-width:100%;height:auto" ') : "—"}${p.settings.showPrice !== false && r.price ? `<div>${esc(r.price)}</div>` : ""}</div>`; }).join("")}</div>`;
    return { rows, issues, summary: `${total} label(s) for ${p.rows.length} product(s) on ${pages} sheet(s) of ${sheet.label[1]}. 共 ${total} 张标签，需 ${pages} 张标签纸。`, stats: { labels: total, sheets: pages }, preview };
  },
  exports: [
    {
      id: "pdf",
      label: ["标签 PDF", "Label sheet PDF"],
      description: "labels.pdf laid out for the chosen label sheet (print at 100%, no scaling)",
      async run(ctx) {
        const p = ctx.project;
        const errors = (ctx.computed.issues ?? []).filter((i) => i.level === "error");
        if (errors.length) throw new KitError("has_errors", `Fix ${errors.length} barcode error(s) first.`);
        const sheet = SHEETS[String(p.settings.sheet)] ?? SHEETS["a4-3x8"];
        const k = await newPdf();
        const [W, H] = PAGE[sheet.page];
        const kind = (p.settings.kind as Kind) ?? "auto";
        const items = p.rows.flatMap((r) => Array.from({ length: copies(r) }, () => r));
        const per = sheet.cols * sheet.rows;
        let page = k.doc.addPage(PAGE[sheet.page]);
        const skip = Number(p.settings.skip ?? 0);
        items.forEach((r, n) => {
          const slot = (n + skip) % per;
          if (n && slot === 0) page = k.doc.addPage(PAGE[sheet.page]);
          const c = slot % sheet.cols, rr = Math.floor(slot / sheet.cols);
          const x = (sheet.left + c * (sheet.w + sheet.gx)) * MM, yTop = H - (sheet.top + rr * (sheet.h + sheet.gy)) * MM;
          const w = sheet.w * MM, h = sheet.h * MM;
          if (p.settings.outline) page.drawRectangle({ x, y: yTop - h, width: w, height: h, borderWidth: 0.3, borderColor: rgb(0.6, 0.6, 0.6), color: undefined });
          const pad = 2.2 * MM;
          let top = yTop - pad;
          const nameSize = Math.min(9, h / 5.5);
          if (p.settings.showName !== false && r.name) { top -= nameSize; k.text(page, String(r.name), x + w / 2, top, { size: nameSize, bold: true, align: "center", maxWidth: w - 2 * pad }); top -= 1.5; }
          const priceSize = Math.min(10, h / 5);
          const bottom = yTop - h + pad + (p.settings.showPrice !== false && r.price ? priceSize + 2 : 0);
          const { e } = enc(r, kind);
          if (!e) return;
          const humanSize = Math.min(7.5, h / 7);
          const barH = Math.max(6, top - bottom - humanSize - 2);
          const modules = totalModules(e) + 14;
          const mod = Math.min((w - 2 * pad) / modules, 0.495 * MM);
          let bx = x + (w - modules * mod) / 2 + 7 * mod;
          e.widths.forEach((bw, i) => { if (i % 2 === 0) page.drawRectangle({ x: bx, y: top - barH, width: bw * mod, height: barH }); bx += bw * mod; });
          k.text(page, e.human, x + w / 2, top - barH - humanSize - 0.5, { size: humanSize, align: "center" });
          if (p.settings.showPrice !== false && r.price) k.text(page, String(r.price), x + w / 2, yTop - h + pad, { size: priceSize, bold: true, align: "center" });
        });
        return [await ctx.write("labels.pdf", await k.doc.save())];
      },
    },
    {
      id: "svg",
      label: ["条码 SVG", "Barcode SVGs"],
      description: "svg/<sku>.svg for each product plus barcodes.csv",
      async run(ctx) {
        const p = ctx.project, kind = (p.settings.kind as Kind) ?? "auto";
        const files: string[] = [];
        const list: unknown[][] = [];
        for (const [i, r] of p.rows.entries()) {
          const { e } = enc(r, kind);
          if (!e) continue;
          files.push(await ctx.write(`svg/${safeFileName(String(r.sku || r.barcode || i + 1))}.svg`, barcodeSvg(e)));
          list.push([r.sku, r.name, e.kind, e.human]);
        }
        files.push(await ctx.write("barcodes.csv", toCsv(["SKU", "Name", "Type", "Barcode"], list)));
        return files;
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
