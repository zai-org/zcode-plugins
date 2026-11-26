import { createApp, type AppDef, type Issue, type Project } from "./kit/app.ts";
import { readTable } from "./kit/table.ts";
import { KitError, safeFileName } from "./kit/workspace.ts";
import { DEFAULT_LAYOUT, fields, fill, fitSize, measurer, pageSize, parseLayout, previewSvg, readBackground, renderPdf } from "./cert.ts";

export const NAME = "certificate-maker";
export const VERSION = "0.1.0";
const bgOf = (p: Project) => p.inputs.find((f) => /\.(png|jpe?g)$/i.test(f))!;

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "certificate",
  title: ["证书奖状批量", "Certificate Maker"],
  openDescription:
    "Make certificates in bulk: pass a background image (.png/.jpg, e.g. a designed certificate without names) and a sheet of recipients (.xlsx/.csv). Text lines are placed by a layout (text with {column} placeholders, x%/y% position, size, colour, alignment, bold, max width %); long names shrink to fit. Reports layout fields missing from the sheet, empty values and text that still does not fit.",
  inputs: { exts: [".png", ".jpg", ".jpeg", ".xlsx", ".csv"], min: 2, max: 2, label: ["选择证书底图（PNG/JPG）和名单表格", "Pick the background image (PNG/JPG) and the recipient sheet"] },
  settings: [
    { key: "layout", label: ["文字排版（每行一段文字）", "Text layout (one text per line)"], type: "textarea", default: DEFAULT_LAYOUT },
    { key: "fileName", label: ["单张文件名", "File name per person"], type: "text", default: "{n}-{姓名}", help: ["{列名}，{n} 为序号", "{column}; {n} = number"] },
    { key: "perPerson", label: ["每人单独一个 PDF", "Also one PDF per person"], type: "bool", default: true },
  ],
  columns: (p) => [...((p.meta.columns as string[]) ?? []).map((c) => ({ key: c, label: [c, c] as [string, string], wide: true })), { key: "_fit", label: ["排版", "Fit"], readOnly: true }],
  newRow: (p) => Object.fromEntries(((p.meta.columns as string[]) ?? []).map((c) => [c, ""])),
  async load({ ws, files }) {
    const bg = files.find((f) => /\.(png|jpe?g)$/i.test(f));
    const sheet = files.find((f) => /\.(xlsx|csv)$/i.test(f));
    if (!bg || !sheet) throw new KitError("missing_input", "Pass one background image (.png/.jpg) and one recipient sheet (.xlsx/.csv).");
    const { img } = readBackground(await ws.read(bg), bg);
    const t = await readTable(ws, sheet);
    return { rows: t.rows, meta: { columns: t.columns, width: img.width, height: img.height } };
  },
  async compute(p, { ws }) {
    const { boxes, bad } = parseLayout(String(p.settings.layout ?? ""));
    const cols = (p.meta.columns as string[]) ?? [];
    const issues: Issue[] = bad.map((b) => ({ level: "error" as const, key: "layout", message: `Layout line not understood (text | x% | y% | size …): ${b}` }));
    const need = fields(boxes);
    for (const f of need.filter((f) => !cols.includes(f) && f !== "n")) issues.push({ level: "error", key: f, message: `Layout uses {${f}} but the sheet has no such column. Columns: ${cols.join(", ")}` });
    if ((p.meta.width as number) < 1200) issues.push({ level: "warn", message: `Background is only ${p.meta.width}px wide; prints may look soft (2000px+ recommended).` });
    const k = await measurer();
    const { w } = pageSize({ width: p.meta.width as number, height: p.meta.height as number });
    const rows = p.rows.map((r, i) => {
      const empty = need.filter((f) => cols.includes(f) && !String(r[f] ?? "").trim());
      if (empty.length) issues.push({ level: "error", row: i, message: `Empty: ${empty.join(", ")} / 字段为空` });
      const notes: string[] = [];
      for (const b of boxes) {
        const fit = fitSize(k, fill(b.template, { ...r, n: i + 1 }), b, w);
        if (fit.overflow) { notes.push("too long"); issues.push({ level: "warn", row: i, message: `“${fill(b.template, r)}” is too long even at ${fit.size}pt (layout line ${b.line}) / 文字过长` }); }
        else if (fit.size < b.size) notes.push(`${b.template.slice(0, 8)} → ${fit.size}pt`);
      }
      return { ...r, _fit: notes.join("; ") || "ok" };
    });
    let preview = "";
    if (p.rows.length) preview = previewSvg(await ws.read(bgOf(p)), bgOf(p), boxes, { ...p.rows[0], n: 1 }, k);
    return { rows, issues, summary: `${p.rows.length} certificate(s) on ${bgOf(p)} (${p.meta.width}×${p.meta.height}px); ${boxes.length} text line(s). 共 ${p.rows.length} 张证书。`, stats: { certificates: p.rows.length, texts: boxes.length }, preview };
  },
  exports: [
    {
      id: "pdf",
      label: ["生成 PDF", "Make PDF"],
      description: "certificates.pdf (one page each) plus one PDF per person when enabled",
      async run(ctx) {
        const p = ctx.project;
        if ((ctx.computed.issues ?? []).some((i) => i.level === "error")) throw new KitError("has_errors", "Fix the errors first (empty names or layout fields without a column).");
        const { boxes } = parseLayout(String(p.settings.layout ?? ""));
        const bg = await ctx.ws.read(bgOf(p));
        const rows = p.rows.map((r, i) => ({ ...r, n: i + 1 }));
        const all = await renderPdf(bg, bgOf(p), boxes, rows);
        const files = [await ctx.write("certificates.pdf", all.bytes)];
        if (p.settings.perPerson !== false)
          for (const r of rows) files.push(await ctx.write(`each/${safeFileName(fill(String(p.settings.fileName || "{n}"), r), `certificate-${r.n}`)}.pdf`, (await renderPdf(bg, bgOf(p), boxes, [r])).bytes));
        return { files, note: all.cjk ? undefined : "No Chinese font found on this computer; non-Latin text was replaced with ?." };
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
