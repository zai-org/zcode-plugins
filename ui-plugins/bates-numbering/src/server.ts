import { PDFDocument } from "pdf-lib";
import { createApp, esc, toCsv, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { KitError } from "./kit/workspace.ts";
import { batesId, fileLabelFor, needsCjk, pageCount, POSITIONS, stampPdf, type Pos, type StampOpts } from "./stamp.ts";

export const NAME = "bates-numbering";
export const VERSION = "0.1.0";
const s = (v: unknown) => String(v ?? "").trim();
type Meta = { files: { path: string; pages: number; encrypted: boolean; error?: string }[] };
const POS_OPTS = POSITIONS.map((p) => ({ value: p, label: [({ "bottom-right": "右下", "bottom-center": "下中", "bottom-left": "左下", "top-right": "右上", "top-center": "上中", "top-left": "左上" } as Record<Pos, string>)[p], p] as [string, string] }));

type Plan = { i: number; row: Row; path: string; name: string; pages: number; first: number; last: number; firstId: string; lastId: string; label: string; out: string; error?: string };

function plan(p: Pick<Project, "rows" | "settings" | "meta">): Plan[] {
  const meta = p.meta as Meta;
  const prefix = s(p.settings.prefix), suffix = s(p.settings.suffix);
  const digits = Math.max(1, Math.min(12, Number(p.settings.digits ?? 6) || 6));
  let n = Math.max(0, Math.floor(Number(p.settings.start ?? 1) || 0));
  const order = p.rows.map((row, i) => ({ row, i })).filter((x) => x.row.include !== false).sort((a, b) => (Number(a.row.order) || 0) - (Number(b.row.order) || 0) || s(a.row.file).localeCompare(s(b.row.file), "en"));
  const naming = s(p.settings.naming) || "both";
  return order.map(({ row, i }, k) => {
    const f = meta.files.find((x) => x.path === s(row.file));
    const pages = f?.pages ?? 0;
    const name = s(row.file).split("/").pop()!.replace(/\.pdf$/i, "");
    const first = n, last = n + Math.max(pages, 1) - 1;
    n = last + 1;
    const firstId = batesId(prefix, first, digits, suffix), lastId = batesId(prefix, last, digits, suffix);
    const range = pages > 1 ? `${firstId}-${lastId}` : firstId;
    const out = naming === "original" ? `${name}.pdf` : naming === "bates" ? `${range}.pdf` : `${range} ${name}.pdf`;
    return { i, row, path: s(row.file), name, pages, first, last, firstId, lastId, label: fileLabelFor(s(row.label) || s(p.settings.fileLabel), k + 1, name), out: out.replace(/[\\/:*?"<>|]/g, "_"), error: f?.error ?? (f?.encrypted ? "encrypted — remove the password first" : undefined) };
  });
}

function opts(p: Pick<Project, "settings">, fileLabel: string): StampOpts {
  return { size: Number(p.settings.fontSize ?? 10) || 10, margin: Number(p.settings.margin ?? 20) || 20, color: s(p.settings.color) || "#000000", box: p.settings.box !== false, pos: (s(p.settings.position) || "bottom-right") as Pos, label: s(p.settings.label), labelPos: (s(p.settings.labelPosition) || "top-right") as Pos, fileLabel, fileLabelPos: (s(p.settings.fileLabelPosition) || "top-left") as Pos };
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "bates",
  title: ["文件编号盖章", "Bates Numbering"],
  openDescription:
    "Stamp consecutive Bates numbers on every page of a set of PDFs (e.g. exhibits or a document production), continuing from one file to the next, plus an optional label on every page (such as 副本 / COPY / CONFIDENTIAL) and an optional per-file label on each first page (such as 证据 {n} / Exhibit {A}). Stamps follow page rotation so they read upright, and sit on a small white box so they stay legible. One row per PDF: order (change it to reorder), include, file, pages, label (overrides settings.fileLabel for that file), and the resulting first/last number. Settings: prefix, suffix, start, digits, position (bottom-right…top-left), fontSize, margin, color, box, label + labelPosition, fileLabel ({n} number, {A}/{a} letter, {name} file name) + fileLabelPosition, naming of the output files (bates range + name, bates range only, original name), merged (also write one combined PDF). Flags encrypted or unreadable PDFs, numbers that overflow the digits and duplicate order values. Exports stamped/<name>.pdf, optionally combined.pdf, and index.csv (order, file, pages, first, last, label, output).",
  inputs: { exts: [".pdf"], min: 1, max: 2000, folders: true, label: ["选择要编号的 PDF 或文件夹", "Pick PDFs or a folder to number"] },
  settings: [
    { key: "prefix", label: ["前缀", "Prefix"], type: "text", default: "DOC-" },
    { key: "suffix", label: ["后缀", "Suffix"], type: "text", default: "" },
    { key: "start", label: ["起始编号", "Start number"], type: "number", default: 1, min: 0 },
    { key: "digits", label: ["位数", "Digits"], type: "number", default: 6, min: 1, max: 12 },
    { key: "position", label: ["编号位置", "Number position"], type: "select", default: "bottom-right", options: POS_OPTS },
    { key: "fontSize", label: ["字号", "Font size"], type: "number", default: 10, min: 5, max: 36 },
    { key: "margin", label: ["边距（pt）", "Margin (pt)"], type: "number", default: 20, min: 0, max: 144 },
    { key: "color", label: ["颜色", "Colour"], type: "color", default: "#000000" },
    { key: "box", label: ["白底衬框", "White box behind"], type: "bool", default: true },
    { key: "label", label: ["每页标签（如 副本 / CONFIDENTIAL）", "Label on every page (e.g. COPY / CONFIDENTIAL)"], type: "text", default: "" },
    { key: "labelPosition", label: ["标签位置", "Label position"], type: "select", default: "top-right", options: POS_OPTS },
    { key: "fileLabel", label: ["首页文件标签（{n} 序号、{A} 字母、{name} 文件名）", "First-page file label ({n}, {A}, {name})"], type: "text", default: "" },
    { key: "fileLabelPosition", label: ["文件标签位置", "File label position"], type: "select", default: "top-left", options: POS_OPTS },
    { key: "naming", label: ["输出文件名", "Output names"], type: "select", default: "both", options: [{ value: "both", label: ["编号范围 + 原名", "Bates range + name"] }, { value: "bates", label: ["只用编号范围", "Bates range only"] }, { value: "original", label: ["保持原名", "Original name"] }] },
    { key: "merged", label: ["另外合并成一个 PDF", "Also write one combined PDF"], type: "bool", default: false },
  ],
  columns: () => [
    { key: "order", label: ["顺序", "Order"], type: "number" },
    { key: "include", label: ["包含", "Include"], type: "bool" },
    { key: "file", label: ["文件", "File"], readOnly: true, wide: true },
    { key: "pages", label: ["页数", "Pages"], type: "number", readOnly: true },
    { key: "label", label: ["文件标签", "File label"] },
    { key: "first", label: ["起始编号", "First"], readOnly: true },
    { key: "last", label: ["结束编号", "Last"], readOnly: true },
    { key: "output", label: ["输出文件", "Output"], readOnly: true },
  ] as Column[],
  async load({ ws, files }) {
    const list: string[] = [];
    for (const f of files) {
      if (f.toLowerCase().endsWith(".pdf")) list.push(f);
      else for (const x of await ws.list({ dir: f, exts: [".pdf"], limit: 5000 })) list.push(x.path);
    }
    const uniq = [...new Set(list)].filter((f) => f.replace(/^\.?\/+/, "").split("/")[0] !== NAME).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    if (!uniq.length) throw new KitError("no_files", "No PDF files found.");
    const meta: Meta = { files: [] };
    const rows: Row[] = [];
    for (const [k, f] of uniq.entries()) {
      const info = await pageCount(new Uint8Array(await ws.read(f, 500 * 1024 * 1024)));
      meta.files.push({ path: f, ...info });
      rows.push({ order: (k + 1) * 10, include: true, file: f, pages: info.pages, label: "" });
    }
    return { rows, meta };
  },
  compute(p): Computed {
    const pl = plan(p);
    const issues: Issue[] = [];
    const digits = Math.max(1, Math.min(12, Number(p.settings.digits ?? 6) || 6));
    for (const x of pl) if (x.error) issues.push({ level: "error", row: x.i, message: `${x.path}: ${x.error} / 无法处理` });
    const total = pl.reduce((a, x) => a + x.pages, 0);
    const lastNo = pl.length ? pl[pl.length - 1].last : 0;
    if (String(lastNo).length > digits) issues.push({ level: "error", key: "digits", message: `The last number ${lastNo} needs more than ${digits} digits — raise digits / 位数不够` });
    const orders = new Map<number, number>();
    for (const x of pl) { const o = Number(x.row.order) || 0; if (orders.has(o)) issues.push({ level: "warn", row: x.i, key: "order", message: `Rows ${orders.get(o)} and ${x.i} share order ${o}; sorted by file name / 顺序号重复` }); orders.set(o, x.i); }
    if (needsCjk(`${s(p.settings.prefix)}${s(p.settings.suffix)}${s(p.settings.label)}${s(p.settings.fileLabel)}`)) issues.push({ level: "info", message: "Chinese text in the stamp uses a Chinese font found on this computer / 中文标签会嵌入本机中文字体" });
    const byIdx = new Map(pl.map((x) => [x.i, x]));
    const rows = p.rows.map((r, i) => { const x = byIdx.get(i); return { ...r, first: x ? x.firstId : "", last: x ? x.lastId : "", output: x ? x.out : "" }; });
    const pos = s(p.settings.position) || "bottom-right";
    const box = (x: Plan) => { const isTop = pos.startsWith("top"), al = pos.endsWith("left") ? "left" : pos.endsWith("right") ? "right" : "center"; return `<div style="width:84px;height:116px;border:1px solid #d1d5db;background:#fff;position:relative;font-size:7px;box-shadow:0 1px 2px #0001;flex:none"><div style="position:absolute;left:6px;right:6px;${isTop ? "top" : "bottom"}:4px;text-align:${al};font-family:Helvetica,Arial,sans-serif;font-weight:700;color:${esc(s(p.settings.color) || "#000")}">${esc(x.firstId)}</div>${s(p.settings.label) ? `<div style="position:absolute;left:6px;right:6px;${(s(p.settings.labelPosition) || "top-right").startsWith("top") ? "top" : "bottom"}:${pos.startsWith((s(p.settings.labelPosition) || "top-right").split("-")[0]) ? 12 : 4}px;text-align:${(s(p.settings.labelPosition) || "top-right").endsWith("left") ? "left" : (s(p.settings.labelPosition) || "top-right").endsWith("right") ? "right" : "center"};color:#b91c1c;font-weight:700">${esc(s(p.settings.label))}</div>` : ""}${x.label ? `<div style="position:absolute;left:6px;top:${s(p.settings.label) && (s(p.settings.labelPosition) || "top-right") === "top-left" ? 12 : 4}px;font-weight:700">${esc(x.label)}</div>` : ""}<div style="position:absolute;left:8px;right:8px;top:30px;display:grid;gap:4px">${"<div style='height:3px;background:#e5e7eb'></div>".repeat(6)}</div></div>`; };
    const preview = `<div style="display:flex;flex-direction:column;gap:10px">${pl.slice(0, 8).map((x) => `<div style="display:flex;gap:10px;align-items:center">${box(x)}<div style="font-size:12px"><div style="font-weight:600">${esc(x.name)}</div><div class="muted">${x.pages} page(s) · ${esc(x.firstId)}${x.pages > 1 ? ` – ${esc(x.lastId)}` : ""}</div>${x.label ? `<div>${esc(x.label)}</div>` : ""}<div class="muted" style="font-family:ui-monospace,monospace;font-size:11px">→ stamped/${esc(x.out)}</div></div></div>`).join("")}${pl.length > 8 ? `<p class="muted">… ${pl.length - 8} more</p>` : ""}</div>`;
    return {
      rows,
      issues,
      summary: pl.length ? `${pl.length} file(s), ${total} page(s): ${pl[0].firstId} – ${pl[pl.length - 1].lastId}. 共 ${pl.length} 个文件 ${total} 页。` : "No files included.",
      stats: { files: pl.length, pages: total, first: pl[0]?.firstId ?? "", last: pl.at(-1)?.lastId ?? "" },
      preview,
    };
  },
  exports: [
    {
      id: "pdf", label: ["盖章后的 PDF", "Stamped PDFs"], description: "stamped/<bates range> <name>.pdf — every page numbered; optional label and first-page file label; combined.pdf too when merged is on",
      async run({ project, write, ws }: ExportCtx) {
        const pl = plan(project);
        const bad = pl.filter((x) => x.error);
        if (bad.length) throw new KitError("bad_files", `Can't stamp: ${bad.map((x) => `${x.path} (${x.error})`).join("; ")}. Untick include to skip them.`);
        const digits = Math.max(1, Math.min(12, Number(project.settings.digits ?? 6) || 6));
        if (pl.length && String(pl[pl.length - 1].last).length > digits) throw new KitError("digits", "Not enough digits for the last number.");
        const prefix = s(project.settings.prefix), suffix = s(project.settings.suffix);
        const out: string[] = [];
        const merged = project.settings.merged === true ? await PDFDocument.create() : null;
        let cjkMissing = false;
        for (const x of pl) {
          const r = await stampPdf(new Uint8Array(await ws.read(x.path, 500 * 1024 * 1024)), x.first, (n) => batesId(prefix, n, digits, suffix), opts(project, x.label));
          cjkMissing ||= r.cjkMissing;
          out.push(await write(`stamped/${x.out}`, r.bytes));
          if (merged) { const src = await PDFDocument.load(r.bytes); for (const pg of await merged.copyPages(src, src.getPageIndices())) merged.addPage(pg); }
        }
        if (merged) out.push(await write("combined.pdf", await merged.save()));
        return { files: out, note: `${pl.reduce((a, x) => a + x.pages, 0)} page(s) numbered ${pl[0]?.firstId ?? ""} – ${pl.at(-1)?.lastId ?? ""}${cjkMissing ? "; no Chinese font found, Chinese characters were replaced with ?" : ""}` };
      },
    },
    {
      id: "index", label: ["编号索引 CSV", "Index (CSV)"], description: "index.csv — order, file, pages, first and last Bates number, label, output file",
      async run({ project, write }: ExportCtx) {
        const pl = plan(project);
        return [await write("index.csv", toCsv(["order", "file", "pages", "first", "last", "label", "output"], pl.map((x, k) => [k + 1, x.path, x.pages, x.firstId, x.lastId, x.label, `stamped/${x.out}`])))];
      },
    },
  ],
  describeRow: (r, i) => `#${i}${r.include === false ? " [excluded]" : ""} order=${s(r.order)} ${s(r.file)} (${s(r.pages)} p) ${s(r.first)}–${s(r.last)}${s(r.label) ? ` label=${s(r.label)}` : ""}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
