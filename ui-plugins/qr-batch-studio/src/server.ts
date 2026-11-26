import { zipSync } from "fflate";
import { createApp, esc, toCsv, type AppDef, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders } from "./kit/columns.ts";
import { MM, newPdf, PAGE } from "./kit/pdf.ts";
import { readTable } from "./kit/table.ts";
import { KitError, safeFileName, type Workspace } from "./kit/workspace.ts";
import { contrast, guess, KINDS, loadLogo, matrix, payload, png, svg, type Style } from "./qr.ts";

export const NAME = "qr-batch-studio";
export const VERSION = "0.1.0";
const ALIASES = { label: ["名称", "标签", "标题", "说明", "name", "title", "label"], kind: ["类型", "种类", "type", "kind"], content: ["内容", "链接", "网址", "数据", "content", "url", "link", "data", "value", "text"] };
const styleOf = (p: Project): Style => ({ ecc: (p.settings.ecc as Style["ecc"]) ?? "M", fg: String(p.settings.fg ?? "#111111"), bg: String(p.settings.bg ?? "#ffffff"), margin: Number(p.settings.margin ?? 4), size: Number(p.settings.size ?? 800) });
const logoPath = (p: Project) => p.inputs.find((f) => /\.(png|jpe?g)$/i.test(f));
async function logo(ws: Workspace, p: Project) {
  const path = logoPath(p);
  return path ? loadLogo(await ws.read(path), path) : undefined;
}
function names(rows: Row[]) {
  const seen = new Map<string, number>();
  return rows.map((r, i) => {
    let n = safeFileName(String(r.label || `qr-${i + 1}`), `qr-${i + 1}`);
    const c = (seen.get(n) ?? 0) + 1; seen.set(n, c);
    if (c > 1) n += `-${c}`;
    return n;
  });
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "qr",
  title: ["二维码批量生成", "QR Batch Studio"],
  openDescription:
    "Make QR codes in bulk from a sheet (.xlsx/.csv; columns label/名称, type/类型, content/内容). Types: url, text, wifi (“network;password;WPA”), vcard (“name;phone;email;company;title;url”), email, phone, sms (“number;message”); type is guessed when empty. Optional second input: a logo image placed in the centre (use error correction H). Flags empty content, URLs without https://, content too long and low colour contrast.",
  inputs: { exts: [".xlsx", ".csv", ".png", ".jpg", ".jpeg"], min: 1, max: 2, label: ["选择二维码清单表格（可再选一个 Logo 图片）", "Pick the QR list sheet (optionally a logo image too)"] },
  settings: [
    { key: "ecc", label: ["容错级别", "Error correction"], type: "select", default: "M", options: [{ value: "L", label: ["L 7%", "L 7%"] }, { value: "M", label: ["M 15%", "M 15%"] }, { value: "Q", label: ["Q 25%", "Q 25%"] }, { value: "H", label: ["H 30%（加 Logo 用）", "H 30% (for logos)"] }] },
    { key: "fg", label: ["码颜色", "Code colour"], type: "color", default: "#111111" },
    { key: "bg", label: ["背景色", "Background"], type: "color", default: "#ffffff" },
    { key: "size", label: ["PNG 尺寸（像素）", "PNG size (px)"], type: "number", default: 800, min: 120, max: 4000 },
    { key: "margin", label: ["留白（格）", "Quiet zone (modules)"], type: "number", default: 4, min: 0, max: 10 },
    { key: "label", label: ["SVG/PDF 下方显示名称", "Show label under code"], type: "bool", default: true },
    { key: "cols", label: ["PDF 每行个数", "PDF codes per row"], type: "number", default: 3, min: 1, max: 6 },
  ],
  columns: () => [
    { key: "label", label: ["名称", "Label"] },
    { key: "kind", label: ["类型", "Type"], type: "select", options: ["", ...KINDS] },
    { key: "content", label: ["内容", "Content"], wide: true },
    { key: "_payload", label: ["编码内容", "Encoded"], readOnly: true },
    { key: "_size", label: ["版本", "Version"], readOnly: true },
  ],
  newRow: () => ({ label: "", kind: "url", content: "" }),
  async load({ ws, files }) {
    const sheet = files.find((f) => /\.(xlsx|csv)$/i.test(f));
    if (!sheet) throw new KitError("missing_input", "Pass a .xlsx/.csv list (columns: label, type, content).");
    const t = await readTable(ws, sheet);
    const m = mapHeaders(t.columns, ALIASES);
    const content = m.content ?? t.columns[t.columns.length - 1];
    return { rows: t.rows.map((r) => ({ label: m.label ? r[m.label] : "", kind: m.kind ? r[m.kind].toLowerCase() : "", content: r[content] ?? "" })) };
  },
  async compute(p) {
    const s = styleOf(p);
    const issues: Issue[] = [];
    if (contrast(s.fg, s.bg) < 4) issues.push({ level: "warn", key: "fg", message: `Low contrast between code and background (${contrast(s.fg, s.bg).toFixed(1)}:1); some phones may not scan it. Use a dark code on a light background.` });
    if (luminance(s.fg) > luminance(s.bg)) issues.push({ level: "warn", key: "fg", message: "Light code on a dark background (inverted) is not supported by every scanner." });
    if (logoPath(p) && s.ecc !== "H") issues.push({ level: "warn", key: "ecc", message: "A logo covers part of the code; set error correction to H." });
    const rows = p.rows.map((r, i) => {
      const content = String(r.content ?? "");
      if (!content.trim()) { issues.push({ level: "error", row: i, key: "content", message: "Empty content / 内容为空" }); return { ...r, _payload: "", _size: "" }; }
      const { text, warn } = payload(String(r.kind || guess(content)), content);
      if (warn) issues.push({ level: "warn", row: i, message: warn });
      try {
        const m = matrix(text, s.ecc);
        if (m.version > 15) issues.push({ level: "warn", row: i, message: `Dense code (version ${m.version}); print it at least 3 cm wide or shorten the content.` });
        return { ...r, _payload: text.replace(/\r\n/g, " ⏎ ").slice(0, 80), _size: `v${m.version} · ${m.size}×${m.size}` };
      } catch (e) {
        issues.push({ level: "error", row: i, key: "content", message: (e as Error).message });
        return { ...r, _payload: text.slice(0, 80), _size: "too long" };
      }
    });
    if (!p.rows.length) issues.push({ level: "error", message: "No rows." });
    const n = names(p.rows);
    const preview = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">${p.rows.slice(0, 12).map((r, i) => {
      try { return `<div style="text-align:center;font-size:11px">${svg(payload(String(r.kind || guess(String(r.content))), String(r.content)).text, s)}<div>${esc(n[i])}</div></div>`; } catch { return `<div class="muted">${esc(n[i])}: —</div>`; }
    }).join("")}</div>${p.rows.length > 12 ? `<p class="muted">+${p.rows.length - 12}</p>` : ""}`;
    return { rows, issues, summary: `${p.rows.length} QR code(s), error correction ${s.ecc}${logoPath(p) ? `, logo ${logoPath(p)}` : ""}. 共 ${p.rows.length} 个二维码。`, stats: { codes: p.rows.length, ecc: s.ecc }, preview };
  },
  exports: [
    {
      id: "png",
      label: ["PNG 图片", "PNG images"],
      description: "png/<label>.png for every code plus qr-png.zip",
      async run(ctx) {
        const p = ctx.project, s = styleOf(p);
        assertOk(ctx.computed.issues ?? []);
        const lg = await logo(ctx.ws, p);
        const n = names(p.rows);
        const zip: Record<string, Uint8Array> = {};
        const files: string[] = [];
        for (const [i, r] of p.rows.entries()) {
          const b = png(payload(String(r.kind || guess(String(r.content))), String(r.content)).text, s, lg);
          zip[`${n[i]}.png`] = b;
          files.push(await ctx.write(`png/${n[i]}.png`, b));
        }
        files.push(await ctx.write("qr-png.zip", zipSync(zip, { level: 0 })));
        return files;
      },
    },
    {
      id: "svg",
      label: ["SVG 矢量", "SVG vectors"],
      description: "svg/<label>.svg (print-ready vectors, no logo)",
      async run(ctx) {
        const p = ctx.project, s = styleOf(p);
        assertOk(ctx.computed.issues ?? []);
        const n = names(p.rows);
        const files: string[] = [];
        for (const [i, r] of p.rows.entries()) files.push(await ctx.write(`svg/${n[i]}.svg`, svg(payload(String(r.kind || guess(String(r.content))), String(r.content)).text, s, p.settings.label !== false ? String(r.label ?? "") : undefined)));
        files.push(await ctx.write("qr-list.csv", toCsv(["Label", "Type", "Content", "Encoded"], p.rows.map((r, i) => [n[i], r.kind || guess(String(r.content)), r.content, payload(String(r.kind || guess(String(r.content))), String(r.content)).text]))));
        return files;
      },
    },
    {
      id: "pdf",
      label: ["A4 打印页 PDF", "A4 print sheet (PDF)"],
      description: "qr-sheet.pdf: codes in a grid with labels, ready to print and cut",
      async run(ctx) {
        const p = ctx.project, s = styleOf(p);
        assertOk(ctx.computed.issues ?? []);
        const lg = await logo(ctx.ws, p);
        const k = await newPdf();
        const cols = Number(p.settings.cols ?? 3);
        const [W, H] = PAGE.A4, m = 12 * MM, cell = (W - 2 * m) / cols, code = cell - 10 * MM;
        const rowsPer = Math.max(1, Math.floor((H - 2 * m) / (code + 14 * MM)));
        const n = names(p.rows);
        let page = k.doc.addPage(PAGE.A4);
        for (const [i, r] of p.rows.entries()) {
          const slot = i % (cols * rowsPer);
          if (i && slot === 0) page = k.doc.addPage(PAGE.A4);
          const cx = m + (slot % cols) * cell + (cell - code) / 2;
          const cy = H - m - Math.floor(slot / cols) * (code + 14 * MM) - code;
          const img = await k.doc.embedPng(png(payload(String(r.kind || guess(String(r.content))), String(r.content)).text, { ...s, size: 600 }, lg));
          page.drawImage(img, { x: cx, y: cy, width: code, height: code });
          if (p.settings.label !== false) k.text(page, n[i], cx + code / 2, cy - 11, { size: 9, align: "center", maxWidth: cell - 4 });
        }
        return [await ctx.write("qr-sheet.pdf", await k.doc.save())];
      },
    },
  ],
};
const luminance = (hex: string) => { const v = parseInt(hex.replace("#", ""), 16); return ((v >> 16) & 255) * 0.299 + ((v >> 8) & 255) * 0.587 + (v & 255) * 0.114; };
function assertOk(issues: Issue[]) {
  const e = issues.filter((i) => i.level === "error");
  if (e.length) throw new KitError("has_errors", `Fix ${e.length} error(s) first: ${e.slice(0, 3).map((x) => `${x.row !== undefined ? `#${x.row} ` : ""}${x.message}`).join("; ")}`);
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
