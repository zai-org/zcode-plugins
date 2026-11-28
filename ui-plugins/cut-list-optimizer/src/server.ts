import { createApp, esc, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders, num } from "./kit/columns.ts";
import { hexRgb, newPdf } from "./kit/pdf.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { edgeOf, pack, type Sheet } from "./pack.ts";
import { s, yes } from "./util.ts";

export const NAME = "cut-list-optimizer";
export const VERSION = "0.1.0";

const PH = {
  name: ["名称", "零件", "零件名称", "板件", "part", "name", "label"],
  length: ["长", "长度", "长(mm)", "length", "l"],
  width: ["宽", "宽度", "宽(mm)", "width", "w"],
  qty: ["数量", "件数", "qty", "quantity", "count"],
  material: ["材料", "板材", "材质", "material", "board"],
  grain: ["纹理", "顺纹", "纹路", "grain"],
  edge: ["封边", "edge", "edging", "edge banding"],
  note: ["备注", "note", "notes"],
};
const SH = { material: ["材料", "板材", "material", "board"], length: ["长", "长度", "length"], width: ["宽", "宽度", "width"], price: ["单价", "价格", "price", "cost"] };

const norm = (m: string) => m.replace(/\s+/g, "").toLowerCase();
interface Stock { name: string; L: number; W: number; price: number }
export function parseStock(v: string): Stock[] {
  const out: Stock[] = [];
  for (const line of v.split(/[\n;；]+/)) { const m = /^(.*?)\s*[=:：]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)(?:\s*@\s*(\d+(?:\.\d+)?))?\s*$/i.exec(line.trim()); if (m) out.push({ name: m[1].trim(), L: Number(m[2]), W: Number(m[3]), price: Number(m[4] ?? 0) }); }
  return out;
}
function lev(a: string, b: string) { const d = Array.from({ length: b.length + 1 }, (_, j) => j); for (let i = 1; i <= a.length; i++) { let prev = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; } } return d[b.length]; }

interface Piece { row: number; n: number; name: string; L: number; W: number }
interface Plan { stock: Stock; sheets: Sheet[]; pieces: Map<number, Piece>; area: number; edgeMm: number }

function analyse(p: Project) {
  const issues: Issue[] = [], kerf = Number(p.settings.kerf ?? 3), trim = Number(p.settings.trim ?? 10), rotate = p.settings.rotate !== false;
  const stocks = [...parseStock(s(p.settings.stock)), ...(((p.meta as { stock?: Stock[] }).stock) ?? [])];
  const byMat = new Map<string, Stock>(); for (const st of stocks) if (!byMat.has(norm(st.name))) byMat.set(norm(st.name), st);
  if (!stocks.length) issues.push({ level: "error", key: "stock", message: "No stock boards — set stock like “18mm 颗粒板=2440x1220@165” (length x width @ price)." });
  const groups = new Map<string, { st: Stock; parts: { id: number; w: number; h: number; canRotate: boolean }[]; pieces: Map<number, Piece>; edge: number }>();
  let id = 0;
  const names = new Map<string, number>();
  p.rows.forEach((r, i) => {
    if (r.include === false) return;
    const name = s(r.name) || `#${i}`, L = num(r.length), W = num(r.width), q = s(r.qty) ? num(r.qty) : 1, tag = `#${i} ${name}`;
    let ok = true;
    if (!Number.isFinite(L) || L <= 0) { issues.push({ level: "error", row: i, key: "length", message: `${tag}: can't read the length “${s(r.length)}” (mm).` }); ok = false; }
    if (!Number.isFinite(W) || W <= 0) { issues.push({ level: "error", row: i, key: "width", message: `${tag}: can't read the width “${s(r.width)}” (mm).` }); ok = false; }
    if (!Number.isFinite(q) || q < 1 || Math.round(q) !== q) { issues.push({ level: "error", row: i, key: "qty", message: `${tag}: quantity “${s(r.qty)}” must be a whole number ≥ 1.` }); ok = false; }
    const ed = edgeOf(s(r.edge));
    if (!ed) { issues.push({ level: "warn", row: i, key: "edge", message: `${tag}: can't read edge banding “${s(r.edge)}” — write 四边, 2长1短 or L2W1.` }); }
    const mat = s(r.material) || (stocks.length === 1 ? stocks[0].name : "");
    let st = byMat.get(norm(mat));
    if (!st) {
      const near = stocks.map((x) => [x, lev(norm(mat), norm(x.name))] as const).sort((a, b) => a[1] - b[1])[0];
      issues.push({ level: "error", row: i, key: "material", message: `${tag}: no stock board for material “${mat}”${near && near[1] <= 2 ? ` — did you mean “${near[0].name}”?` : " — add it to the stock setting"}.` }); ok = false;
    }
    if (names.has(name) && s(r.name)) issues.push({ level: "info", row: i, key: "name", message: `${tag}: another row (#${names.get(name)}) has the same name — fine if they're different sizes, otherwise merge the quantities.` });
    names.set(name, i);
    if (!ok || !st) return;
    const UL = st.L - 2 * trim + kerf, UW = st.W - 2 * trim + kerf, canRotate = rotate && !yes(r.grain);
    const fitsStraight = L + kerf <= UL && W + kerf <= UW, fitsRot = W + kerf <= UL && L + kerf <= UW;
    if (!fitsStraight && !(canRotate && fitsRot)) {
      issues.push({ level: "error", row: i, key: fitsRot ? "grain" : "length", message: fitsRot ? `${tag}: ${L}×${W} only fits across the board, but it's marked 顺纹 (grain must run along the ${st.L} side) — rotate the grain or change the size.` : `${tag}: ${L}×${W} is bigger than the usable ${st.name} board (${st.L}×${st.W} minus ${trim} mm trim each side) — split it into two parts or shorten it.` });
      return;
    }
    const g = groups.get(st.name) ?? { st, parts: [] as { id: number; w: number; h: number; canRotate: boolean }[], pieces: new Map<number, Piece>(), edge: 0 };
    for (let n = 0; n < q; n++) { g.parts.push({ id, w: L, h: W, canRotate }); g.pieces.set(id, { row: i, n: n + 1, name, L, W }); id++; }
    if (ed) g.edge += q * (ed.l * L + ed.w * W);
    groups.set(st.name, g);
  });
  const plans: Plan[] = [];
  for (const g of groups.values()) {
    const UL = g.st.L - 2 * trim + kerf, UW = g.st.W - 2 * trim + kerf;
    const { sheets } = pack(g.parts, UL, UW, kerf);
    const area = g.parts.reduce((a, x) => a + x.w * x.h, 0);
    plans.push({ stock: g.st, sheets, pieces: g.pieces, area, edgeMm: g.edge });
    const yieldPct = (area / (sheets.length * g.st.L * g.st.W)) * 100;
    const last = sheets.at(-1)!, lastPct = (last.placed.reduce((a, x) => a + x.w * x.h, 0) / (g.st.L * g.st.W)) * 100;
    if (sheets.length > 1 && lastPct < 15) issues.push({ level: "info", message: `${g.st.name}: the last board is only ${Math.round(lastPct)}% used (${last.placed.length} part(s)) — shrinking or moving those parts would save a whole board.` });
    if (yieldPct < 60) issues.push({ level: "info", message: `${g.st.name}: overall yield ${Math.round(yieldPct)}% — keep the offcuts.` });
  }
  return { issues, plans, kerf, trim };
}

const COLORS = ["#DBEAFE", "#FEF3C7", "#DCFCE7", "#FCE7F3", "#E0E7FF", "#FFEDD5", "#CCFBF1", "#F3E8FF"];
function sheetSvg(pl: Plan, k: number, trim: number, scale: number, x0 = 0, y0 = 0, family = "sans-serif") {
  const st = pl.stock, sh = pl.sheets[k], W = st.L * scale, H = st.W * scale, parts: string[] = [];
  parts.push(`<rect x="${x0}" y="${y0}" width="${W}" height="${H}" fill="#E5E7EB" stroke="#374151" stroke-width="1"/>`);
  for (const pc of sh.placed) {
    const q = pl.pieces.get(pc.id)!, x = x0 + (trim + pc.x) * scale, y = y0 + (trim + pc.y) * scale, w = pc.w * scale, h = pc.h * scale, fs = Math.max(7, Math.min(13, Math.min(w / 6, h / 2.6)));
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${COLORS[q.row % COLORS.length]}" stroke="#1F2937" stroke-width="0.8"/>`);
    if (w > 30 && h > 14) parts.push(`<text x="${x + w / 2}" y="${y + h / 2 - fs * 0.15}" font-size="${fs}" text-anchor="middle" font-family="${esc(family)}" fill="#111827">${esc(q.name)}${pc.rotated ? "（转）" : ""}</text><text x="${x + w / 2}" y="${y + h / 2 + fs * 1.0}" font-size="${fs * 0.85}" text-anchor="middle" font-family="${esc(family)}" fill="#4B5563">${q.L}×${q.W}</text>`);
  }
  return parts.join("");
}

function makeDef(): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "cut",
    title: ["板材开料优化", "Cut List Optimizer"],
    openDescription:
      "Lay furniture or cabinet parts onto stock boards and get cutting diagrams, a board count and edge-banding totals. Pick a parts .csv/.xlsx (or a folder that may also hold a stock sheet with 材料/material, 长/length, 宽/width, 单价/price): 名称/name, 长/length and 宽/width in mm, 数量/qty, 材料/material, 纹理/grain (yes = grain must run along the board's length, so the part isn't rotated), 封边/edge banding (四边, 2长1短, L2W1, 长边 …), 备注/note. Settings: stock (one board per line: “18mm 颗粒板=2440x1220@165” = length x width @ price per board; blank material uses the only board), kerf (saw blade, default 3 mm), trim (edge trim per side, default 10 mm), rotate (allow turning parts without grain). Packing is guillotine-style (every cut goes right across), biggest parts first, best fit. Checks: parts larger than the board (or that fit only across the grain), unknown materials (with a suggestion for near matches), unreadable sizes, quantities and edge banding, same-named rows, a nearly empty last board, low yield. Exports cutting-diagrams.pdf (one page per board with labelled parts and sizes), cutting-diagrams.svg, and cut-list.xlsx (parts with their boards, placements with x/y, material summary with boards, yield, cost and edge-banding metres).",
    inputs: { exts: [".csv", ".xlsx"], min: 1, max: 2, folders: true, label: ["选择零件清单", "Pick the parts list"] },
    settings: [
      { key: "title", label: ["项目名称", "Project"], type: "text", default: "" },
      { key: "stock", label: ["板材（名称=长x宽@单价，一行一种）", "Stock boards"], type: "textarea", default: "" },
      { key: "kerf", label: ["锯缝（mm）", "Kerf (mm)"], type: "number", default: 3, min: 0, max: 10 },
      { key: "trim", label: ["每边修边（mm）", "Edge trim per side (mm)"], type: "number", default: 10, min: 0, max: 50 },
      { key: "rotate", label: ["无纹理零件可旋转", "Rotate parts without grain"], type: "bool", default: true },
    ],
    columns: () => [
      { key: "include", label: ["保留", "Keep"], type: "bool" },
      { key: "name", label: ["名称", "Part"], wide: true },
      { key: "length", label: ["长", "Length"], type: "number" },
      { key: "width", label: ["宽", "Width"], type: "number" },
      { key: "qty", label: ["数量", "Qty"], type: "number" },
      { key: "material", label: ["材料", "Material"] },
      { key: "grain", label: ["顺纹", "Grain"], type: "bool" },
      { key: "edge", label: ["封边", "Edge banding"] },
      { key: "_where", label: ["在第几张板", "On board"], readOnly: true },
      { key: "note", label: ["备注", "Note"], wide: true },
    ] as Column[],
    newRow: () => ({ include: true, name: "", length: "", width: "", qty: 1, material: "", grain: false, edge: "", note: "" }),
    async load({ ws, files }) {
      const list: string[] = [];
      for (const f of files) { if (/\.(csv|xlsx)$/i.test(f)) list.push(f); else for (const x of await ws.list({ dir: f, exts: [".csv", ".xlsx"], limit: 20 })) list.push(x.path); }
      let rows: Row[] = []; const stock: Stock[] = [];
      for (const f of [...new Set(list)].filter((x) => !x.startsWith(NAME + "/"))) {
        const t = await readTable(ws, f), h = mapHeaders(t.columns, PH), sh = mapHeaders(t.columns, SH);
        if (h.length && h.width && (h.qty || h.name) && !rows.length) rows = t.rows.filter((r) => s(r[h.length!]) || s(h.name && r[h.name])).map((r) => ({ include: true, name: s(h.name && r[h.name]), length: s(r[h.length!]), width: s(r[h.width!]), qty: s(h.qty && r[h.qty]) || "1", material: s(h.material && r[h.material]), grain: yes(h.grain && r[h.grain]), edge: s(h.edge && r[h.edge]), note: s(h.note && r[h.note]) }));
        else if (sh.material && sh.length && sh.width) for (const r of t.rows) if (s(r[sh.material])) stock.push({ name: s(r[sh.material]), L: num(r[sh.length]), W: num(r[sh.width]), price: num(sh.price ? r[sh.price] : 0) || 0 });
      }
      if (!rows.length) throw new KitError("no_parts", "No parts list found (.csv/.xlsx with 长/length and 宽/width columns).");
      return { rows, meta: { stock } };
    },
    compute(p): Computed {
      const { issues, plans, trim } = analyse(p);
      const where = new Map<number, Set<string>>();
      for (const pl of plans) pl.sheets.forEach((sh, k) => { for (const pc of sh.placed) { const q = pl.pieces.get(pc.id)!; where.set(q.row, (where.get(q.row) ?? new Set()).add(`${plans.length > 1 ? `${pl.stock.name} ` : ""}#${k + 1}`)); } });
      const rows = p.rows.map((r, i) => ({ ...r, _where: [...(where.get(i) ?? [])].join(", ") }));
      const scale = 300 / Math.max(1, ...plans.map((x) => x.stock.L));
      let y = 0; const svgs: string[] = [];
      for (const pl of plans) pl.sheets.forEach((_, k) => { svgs.push(`<text x="0" y="${y + 12}" font-size="11" fill="#374151">${esc(pl.stock.name)} #${k + 1}</text>${sheetSvg(pl, k, trim, scale, 0, y + 16)}`); y += pl.stock.W * scale + 28; });
      const total = plans.reduce((a, x) => a + x.sheets.length, 0), cost = plans.reduce((a, x) => a + x.sheets.length * x.stock.price, 0);
      return {
        rows, issues,
        summary: `${plans.reduce((a, x) => a + x.pieces.size, 0)} part(s) on ${total} board(s): ${plans.map((x) => `${x.stock.name} ×${x.sheets.length} (yield ${Math.round((x.area / (x.sheets.length * x.stock.L * x.stock.W)) * 100)}%)`).join(", ") || "—"}${cost ? `; boards ¥${cost.toFixed(2)}` : ""}; edge banding ${(plans.reduce((a, x) => a + x.edgeMm, 0) / 1000).toFixed(1)} m.`,
        stats: { boards: total, parts: plans.reduce((a, x) => a + x.pieces.size, 0) },
        preview: svgs.length ? `<svg xmlns="http://www.w3.org/2000/svg" style="max-width:100%;height:auto" width="310" height="${y}" viewBox="0 0 310 ${y}">${svgs.join("")}</svg>` : "",
      };
    },
    exports: [
      { id: "pdf", label: ["开料图 PDF", "Cutting diagrams (PDF)"], description: "cutting-diagrams.pdf", async run(ctx: ExportCtx) {
        const p = ctx.project, { plans, trim, kerf } = analyse(p), k = await newPdf(), W = 841.89, H = 595.28, M = 36;
        for (const pl of plans) pl.sheets.forEach((sh, n) => {
          const pg = k.doc.addPage([W, H]), st = pl.stock, sc = Math.min((W - 2 * M) / st.L, (H - 2 * M - 60) / st.W), ox = M, oy = H - M - 50;
          const used = sh.placed.reduce((a, x) => a + x.w * x.h, 0);
          k.text(pg, `${s(p.settings.title) || "开料图"} · ${st.name} · 第 ${n + 1}/${pl.sheets.length} 张`, M, H - M - 8, { size: 14, bold: true });
          k.text(pg, `${st.L}×${st.W} mm · 锯缝 ${kerf} · 修边 ${trim} · ${sh.placed.length} 件 · 利用率 ${Math.round((used / (st.L * st.W)) * 100)}%`, M, H - M - 26, { size: 10, color: "#4B5563" });
          pg.drawRectangle({ x: ox, y: oy - st.W * sc, width: st.L * sc, height: st.W * sc, color: hexRgb("#E5E7EB"), borderColor: hexRgb("#374151"), borderWidth: 1 });
          for (const pc of sh.placed) {
            const q = pl.pieces.get(pc.id)!, x = ox + (trim + pc.x) * sc, top = oy - (trim + pc.y) * sc, w = pc.w * sc, h = pc.h * sc;
            pg.drawRectangle({ x, y: top - h, width: w, height: h, color: hexRgb(COLORS[q.row % COLORS.length]), borderColor: hexRgb("#1F2937"), borderWidth: 0.6 });
            const fs = Math.max(6, Math.min(11, w / 8, h / 2.8));
            if (w > 24 && h > 12) { k.text(pg, `${q.name}${pc.rotated ? "（转）" : ""}`, x + w / 2, top - h / 2 + fs * 0.25, { size: fs, align: "center", maxWidth: w - 4 }); k.text(pg, `${q.L}×${q.W}`, x + w / 2, top - h / 2 - fs * 0.95, { size: fs * 0.85, align: "center", color: "#4B5563", maxWidth: w - 4 }); }
          }
        });
        if (!plans.length) k.doc.addPage([W, H]);
        return [await ctx.write("cutting-diagrams.pdf", await k.doc.save())];
      } },
      { id: "svg", label: ["开料图 SVG", "Cutting diagrams (SVG)"], description: "cutting-diagrams.svg", async run(ctx: ExportCtx) {
        const { plans, trim } = analyse(ctx.project), sc = 1000 / Math.max(1, ...plans.map((x) => x.stock.L));
        let y = 0; const parts: string[] = [];
        for (const pl of plans) pl.sheets.forEach((_, k) => { parts.push(`<text x="0" y="${y + 20}" font-size="18" font-weight="700">${esc(pl.stock.name)} 第 ${k + 1}/${pl.sheets.length} 张</text>${sheetSvg(pl, k, trim, sc, 0, y + 30)}`); y += pl.stock.W * sc + 60; });
        return [await ctx.write("cutting-diagrams.svg", `<svg xmlns="http://www.w3.org/2000/svg" width="1010" height="${Math.max(y, 10)}" viewBox="0 0 1010 ${Math.max(y, 10)}" font-family="sans-serif"><rect width="100%" height="100%" fill="#fff"/>${parts.join("")}</svg>`)];
      } },
      { id: "xlsx", label: ["开料单 Excel", "Cut list (Excel)"], description: "cut-list.xlsx", async run(ctx: ExportCtx) {
        const p = ctx.project, { plans, trim } = analyse(p), comp = ctx.computed;
        const place = plans.flatMap((pl) => pl.sheets.flatMap((sh, k) => sh.placed.map((pc) => { const q = pl.pieces.get(pc.id)!; return [pl.stock.name, k + 1, q.name, q.n, q.L, q.W, pc.x + trim, pc.y + trim, pc.rotated ? "是" : ""]; })));
        return [await ctx.write("cut-list.xlsx", await writeXlsx([
          { name: "零件", headers: ["名称", "材料", "长", "宽", "数量", "顺纹", "封边", "所在板", "备注"], rows: p.rows.filter((r) => r.include !== false).map((r) => [s(r.name), s(r.material), num(r.length), num(r.width), num(r.qty) || 1, yes(r.grain) ? "是" : "", s(r.edge), s((comp.rows?.[p.rows.indexOf(r)] as Row | undefined)?._where), s(r.note)]) },
          { name: "排版", headers: ["材料", "板号", "零件", "第几件", "长", "宽", "X（mm）", "Y（mm）", "旋转"], rows: place },
          { name: "用料汇总", headers: ["材料", "板材尺寸", "张数", "零件面积 m²", "板材面积 m²", "利用率", "单价", "金额", "封边 m"], rows: plans.map((pl) => [pl.stock.name, `${pl.stock.L}×${pl.stock.W}`, pl.sheets.length, Math.round(pl.area / 1e4) / 100, Math.round((pl.sheets.length * pl.stock.L * pl.stock.W) / 1e4) / 100, `${Math.round((pl.area / (pl.sheets.length * pl.stock.L * pl.stock.W)) * 100)}%`, pl.stock.price || "", pl.stock.price ? pl.stock.price * pl.sheets.length : "", Math.round(pl.edgeMm / 100) / 10]) },
        ]))];
      } },
    ],
    describeRow: (r, i) => `#${i}${r.include === false ? " [dropped]" : ""} ${s(r.name)} ${s(r.length)}×${s(r.width)} ×${s(r.qty) || 1} [${s(r.material) || "default board"}]${yes(r.grain) ? " grain" : ""}${s(r.edge) ? ` edge ${s(r.edge)}` : ""}${s(r._where) ? ` → board ${s(r._where)}` : ""}`,
  };
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(), options).server;
}
