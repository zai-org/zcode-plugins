import { clip, endPath, popGraphicsState, pushGraphicsState, rectangle, rgb, type PDFImage, type PDFPage } from "pdf-lib";
import { createApp, esc, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders, num } from "./kit/columns.ts";
import { newPdf, PAGE } from "./kit/pdf.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { cardSize, grid, imageSize, SIZES } from "./img.ts";
import { s } from "./util.ts";

export const NAME = "card-print-sheets";
export const VERSION = "0.1.0";
const MM = 72 / 25.4;
const IMG = [".png", ".jpg", ".jpeg"];
type Info = { w: number; h: number; type: "png" | "jpg" } | null;
interface Meta { images: Record<string, Info>; folder: string }

const paperOf = (p: Project): [number, number] => { const k = s(p.settings.paper) || "A4"; const [w, h] = k === "A3" ? [297, 420] : k === "Letter" ? [215.9, 279.4] : [210, 297]; return s(p.settings.orientation) === "landscape" ? [h, w] : [w, h]; };
const base = (f: string) => f.split("/").pop()!;

function analyse(p: Project) {
  const m = p.meta as unknown as Meta, issues: Issue[] = [], bleed = Number(p.settings.bleed ?? 3), gap = Number(p.settings.gap ?? 0);
  const size = cardSize(s(p.settings.size) || "poker", s(p.settings.custom));
  if (!size) issues.push({ level: "error", key: "custom", message: `Custom card size “${s(p.settings.custom)}” — write it like 63x88 (mm).` });
  const [cw, ch] = size ?? [63, 88], sw = cw + 2 * bleed, sh = ch + 2 * bleed, [pw, ph] = paperOf(p), g = grid(pw, ph, sw, sh, gap, 5);
  if (!g.cols || !g.rows) issues.push({ level: "error", key: "size", message: `A ${cw}×${ch} mm card with ${bleed} mm bleed doesn't fit on ${s(p.settings.paper) || "A4"} — use a bigger paper or turn the page.` });
  const duplex = s(p.settings.duplex) || "none", defBack = s(p.settings.back);
  const find = (name: string) => Object.keys(m.images).find((k) => k === name || base(k) === name || base(k).replace(/\.[^.]+$/, "") === name.replace(/\.[^.]+$/, ""));
  const backFile = defBack ? find(defBack) : undefined;
  if (defBack && !backFile) issues.push({ level: "error", key: "back", message: `Back image “${defBack}” not found next to the cards.` });
  const slots: { row: number; file: string; back?: string }[] = [];
  const dpiOf = (info: NonNullable<Info>) => Math.min(info.w / (sw / 25.4), info.h / (sh / 25.4));
  const checkArt = (f: string, label: string, row?: number) => {
    const info = m.images[f];
    if (!info) { issues.push({ level: "error", row, message: `${label}: can't read ${base(f)} — use PNG or JPEG.` }); return false; }
    const dpi = dpiOf(info);
    if (dpi < 150) issues.push({ level: "warn", row, message: `${label}: ${base(f)} is ${info.w}×${info.h} px — only ${Math.round(dpi)} dpi at ${sw}×${sh} mm, it will print blurry (300 dpi wants ${Math.round((sw / 25.4) * 300)}×${Math.round((sh / 25.4) * 300)} px).` });
    else if (dpi < 250) issues.push({ level: "info", row, message: `${label}: ${base(f)} prints at ${Math.round(dpi)} dpi — fine for prototypes, 300 dpi is better.` });
    const ar = info.w / info.h, withB = sw / sh, noB = cw / ch;
    if (Math.abs(ar - withB) / withB > 0.02) {
      if (bleed > 0 && Math.abs(ar - noB) / noB <= 0.02) issues.push({ level: "info", row, message: `${label}: ${base(f)} looks like it has no bleed (${cw}:${ch}) — it's enlarged to fill the bleed, so ${bleed} mm of the art edge is cut off. Keep text away from the edges or add bleed to the art.` });
      else issues.push({ level: "warn", row, message: `${label}: ${base(f)} is ${info.w}×${info.h} px (${ar.toFixed(2)}) but the card with bleed is ${withB.toFixed(2)} — ${s(p.settings.fit) === "contain" ? "it will have empty bands" : "parts of it will be cropped"}.` });
    }
    return true;
  };
  if (backFile) checkArt(backFile, "Back");
  let total = 0;
  const seen = new Map<string, number>();
  p.rows.forEach((r, i) => {
    if (r.include === false) return;
    const name = s(r.file), cnt = s(r.count) ? num(r.count) : 1, f = find(name);
    if (!Number.isFinite(cnt) || cnt < 0 || Math.round(cnt) !== cnt) { issues.push({ level: "error", row: i, key: "count", message: `#${i} ${name}: count “${s(r.count)}” must be a whole number.` }); return; }
    if (!f) { issues.push({ level: "error", row: i, key: "file", message: `#${i}: card image “${name}” isn't in the folder — check the file name or drop the row.` }); return; }
    if (seen.has(f)) issues.push({ level: "warn", row: i, message: `#${i} ${name} is listed twice (also #${seen.get(f)}) — both counts are printed.` });
    seen.set(f, i);
    if (!checkArt(f, `#${i} ${s(r.title) || name}`, i)) return;
    let back = backFile;
    if (s(r.back)) { back = find(s(r.back)); if (!back) { issues.push({ level: "error", row: i, key: "back", message: `#${i} ${name}: back image “${s(r.back)}” not found.` }); return; } checkArt(back, `#${i} back`, i); }
    if (duplex !== "none" && !back) issues.push({ level: "error", row: i, key: "back", message: `#${i} ${name}: double-sided printing is on but this card has no back — set a default back image or this card's back.` });
    if (cnt === 0) return;
    for (let k = 0; k < cnt; k++) slots.push({ row: i, file: f, back });
    total += cnt;
  });
  const per = g.cols * g.rows, sheets = per ? Math.ceil(total / per) : 0, empty = sheets * per - total;
  if (per && empty && sheets) issues.push({ level: "info", message: `The last sheet has ${empty} empty slot(s) — add ${empty} more card(s) for free.` });
  return { issues, slots, cw, ch, sw, sh, bleed, gap, pw, ph, g, per, sheets, duplex, total };
}

function drawCard(page: PDFPage, img: PDFImage, x: number, y: number, w: number, h: number, fit: string) {
  const ar = img.width / img.height, sr = w / h;
  let dw = w, dh = h;
  if (fit === "contain" ? ar > sr : ar < sr) { dw = w; dh = w / ar; } else { dh = h; dw = h * ar; }
  page.pushOperators(pushGraphicsState(), rectangle(x, y, w, h), clip(), endPath());
  page.drawImage(img, { x: x + (w - dw) / 2, y: y + (h - dh) / 2, width: dw, height: dh });
  page.pushOperators(popGraphicsState());
}

function marks(page: PDFPage, a: ReturnType<typeof analyse>, n: number, mirror: boolean) {
  const { g, sw, sh, gap, bleed, pw } = a, L = 5 * MM, xs = new Set<number>(), ys = new Set<number>();
  for (let k = 0; k < n; k++) {
    const c = k % g.cols, r = Math.floor(k / g.cols), cx = mirror ? g.cols - 1 - c : c;
    const x = g.x0 + cx * (sw + gap), yTop = a.ph - g.y0 - r * (sh + gap);
    xs.add(x + bleed); xs.add(x + sw - bleed); ys.add(yTop - bleed); ys.add(yTop - sh + bleed);
  }
  const top = (a.ph - g.y0) * MM, bot = (a.ph - g.y0 - g.th) * MM, left = g.x0 * MM, right = (g.x0 + g.tw) * MM;
  for (const x of xs) { page.drawLine({ start: { x: x * MM, y: top + 1 }, end: { x: x * MM, y: top + L }, thickness: 0.3, color: rgb(0, 0, 0) }); page.drawLine({ start: { x: x * MM, y: bot - 1 }, end: { x: x * MM, y: bot - L }, thickness: 0.3, color: rgb(0, 0, 0) }); }
  for (const y of ys) { page.drawLine({ start: { x: left - 1, y: y * MM }, end: { x: left - L, y: y * MM }, thickness: 0.3, color: rgb(0, 0, 0) }); page.drawLine({ start: { x: right + 1, y: y * MM }, end: { x: right + L, y: y * MM }, thickness: 0.3, color: rgb(0, 0, 0) }); }
  void pw;
}

function makeDef(): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "cards",
    title: ["卡牌打印排版", "Card Print Sheets"],
    openDescription:
      "Lay out card images (board game, tarot, flash or business cards) on print sheets with bleed and crop marks, with backs for double-sided printing. Pick the folder of card images (PNG/JPEG; a back image such as back.png can sit next to them) and optionally a counts sheet (.csv/.xlsx: 文件/file, 数量/count, 背面/back). Rows: one per card face: file, title, count (copies), back (this card's back image; blank = default back), include. Settings: size (poker 63×88, bridge 57×89, tarot 70×120, mini 44×63, business 90×54, square 70×70, custom with custom “WxH” mm), bleed (mm added on every side, default 3), gap (mm between cards, 0 = cards touch and share cut lines), paper (A4 / Letter / A3), orientation, fit (cover = fill and crop, contain = whole image), cropMarks, duplex (none / long = flip on long edge / short = flip on short edge; backs are mirrored so they line up), back (default back image file name). Checks: images missing from the folder, unreadable images, low resolution (dpi at print size), art with the wrong shape or without bleed, double-sided without backs, bad counts, cards listed twice, a card size that doesn't fit the paper, empty slots on the last sheet. Exports print-sheets.pdf (fronts, and with duplex a mirrored back page after every front page), backs.pdf (back pages alone, to print separately when duplex is off) and card-list.csv (cards, copies and which sheet they're on).",
    inputs: { exts: [...IMG, ".csv", ".xlsx"], min: 1, max: 3, folders: true, label: ["选择卡牌图片文件夹", "Pick the card images folder"] },
    settings: [
      { key: "title", label: ["项目名称", "Project"], type: "text", default: "" },
      { key: "size", label: ["卡牌尺寸", "Card size"], type: "select", default: "poker", options: [...Object.entries(SIZES).map(([k, v]) => ({ value: k, label: [v[2], v[2]] as [string, string] })), { value: "custom", label: ["自定义", "Custom"] }], },
      { key: "custom", label: ["自定义尺寸（宽x高 mm）", "Custom size (WxH mm)"], type: "text", default: "" },
      { key: "bleed", label: ["出血（mm）", "Bleed (mm)"], type: "number", default: 3, min: 0, max: 10 },
      { key: "gap", label: ["卡间距（mm）", "Gap (mm)"], type: "number", default: 0, min: 0, max: 20 },
      { key: "paper", label: ["纸张", "Paper"], type: "select", default: "A4", options: [{ value: "A4", label: ["A4", "A4"] }, { value: "Letter", label: ["Letter", "Letter"] }, { value: "A3", label: ["A3", "A3"] }] },
      { key: "orientation", label: ["方向", "Orientation"], type: "select", default: "portrait", options: [{ value: "portrait", label: ["纵向", "Portrait"] }, { value: "landscape", label: ["横向", "Landscape"] }] },
      { key: "fit", label: ["图片适配", "Fit"], type: "select", default: "cover", options: [{ value: "cover", label: ["铺满（裁边）", "Cover"] }, { value: "contain", label: ["完整显示", "Contain"] }] },
      { key: "cropMarks", label: ["裁切线", "Crop marks"], type: "bool", default: true },
      { key: "duplex", label: ["双面打印", "Double-sided"], type: "select", default: "none", options: [{ value: "none", label: ["单面（背面另打）", "Off"] }, { value: "long", label: ["长边翻转", "Flip on long edge"] }, { value: "short", label: ["短边翻转", "Flip on short edge"] }] },
      { key: "back", label: ["默认背面图片", "Default back image"], type: "text", default: "" },
    ],
    columns: () => [
      { key: "include", label: ["保留", "Keep"], type: "bool" },
      { key: "file", label: ["图片", "Image"], wide: true },
      { key: "title", label: ["名称", "Title"] },
      { key: "count", label: ["数量", "Copies"], type: "number" },
      { key: "back", label: ["背面", "Back"] },
      { key: "_info", label: ["像素 / dpi", "Pixels / dpi"], readOnly: true },
      { key: "_sheets", label: ["在第几页", "Sheet"], readOnly: true },
    ] as Column[],
    newRow: () => ({ include: true, file: "", title: "", count: 1, back: "" }),
    async load({ ws, files }) {
      const imgs: string[] = [], tables: string[] = [];
      for (const f of files) {
        if (IMG.some((e) => f.toLowerCase().endsWith(e))) imgs.push(f);
        else if (/\.(csv|xlsx)$/i.test(f)) tables.push(f);
        else for (const x of await ws.list({ dir: f, exts: [...IMG, ".csv", ".xlsx"], limit: 500 })) (/\.(csv|xlsx)$/i.test(x.path) ? tables : imgs).push(x.path);
      }
      const all = [...new Set(imgs)].filter((x) => !x.startsWith(NAME + "/")).sort();
      if (!all.length) throw new KitError("no_images", "No PNG/JPEG card images found.");
      const images: Record<string, Info> = {};
      for (const f of all) images[f] = imageSize(new Uint8Array(await ws.read(f, 60 * 1024 * 1024)));
      const isBack = (f: string) => /(^|[\/_\- ])(back|背面|卡背)[^\/]*$/i.test(f);
      let rows: Row[] = all.filter((f) => !isBack(f)).map((f) => ({ include: true, file: base(f), title: base(f).replace(/\.[^.]+$/, "").replace(/^\d+[-_ .]*/, ""), count: 1, back: "" }));
      for (const tf of tables.filter((x) => !x.startsWith(NAME + "/"))) {
        const t = await readTable(ws, tf), h = mapHeaders(t.columns, { file: ["文件", "图片", "文件名", "file", "image"], count: ["数量", "张数", "份数", "count", "copies", "qty"], back: ["背面", "卡背", "back"], title: ["名称", "卡名", "title", "name"] });
        if (!h.file) continue;
        const listed = new Map(rows.map((r) => [s(r.file), r]));
        const out: Row[] = [];
        for (const r of t.rows) { const f = s(r[h.file]); if (!f) continue; const ex = listed.get(f); out.push({ include: true, file: f, title: s(h.title && r[h.title]) || (ex ? s(ex.title) : f.replace(/\.[^.]+$/, "").replace(/^\d+[-_ .]*/, "")), count: s(h.count && r[h.count]) || "1", back: s(h.back && r[h.back]) }); listed.delete(f); }
        rows = [...out, ...[...listed.values()]];
        break;
      }
      const back = all.find(isBack);
      return { rows, meta: { images, folder: files[0], defaultBack: back ? base(back) : "" } as unknown as Record<string, unknown> };
    },
    compute(p): Computed {
      const a = analyse(p), m = p.meta as unknown as Meta & { defaultBack?: string };
      if (!s(p.settings.back) && m.defaultBack) a.issues.push({ level: "info", key: "back", message: `Found a back image ${m.defaultBack} — set back: "${m.defaultBack}" to use it.` });
      const pages = new Map<number, Set<number>>();
      a.slots.forEach((x, k) => pages.set(x.row, (pages.get(x.row) ?? new Set()).add(Math.floor(k / Math.max(1, a.per)) + 1)));
      const rows = p.rows.map((r, i) => { const f = Object.keys(m.images).find((k) => base(k) === s(r.file)), info = f ? m.images[f] : null; return { ...r, _info: info ? `${info.w}×${info.h} · ${Math.round(Math.min(info.w / (a.sw / 25.4), info.h / (a.sh / 25.4)))} dpi` : "", _sheets: [...(pages.get(i) ?? [])].join(", ") }; });
      return {
        rows, issues: a.issues,
        summary: `${a.total} card(s) of ${a.cw}×${a.ch} mm (+${a.bleed} mm bleed) on ${a.sheets} ${s(p.settings.paper) || "A4"} sheet(s), ${a.g.cols}×${a.g.rows} per sheet${a.duplex !== "none" ? `, double-sided (${a.duplex} edge)` : ""}.`,
        stats: { cards: a.total, sheets: a.sheets, perSheet: a.per },
        preview: `<svg xmlns="http://www.w3.org/2000/svg" style="max-width:240px;height:auto" viewBox="0 0 ${a.pw} ${a.ph}" width="${a.pw * 1.1}" height="${a.ph * 1.1}"><rect width="${a.pw}" height="${a.ph}" fill="#fff" stroke="#999"/>${Array.from({ length: Math.min(a.per, a.total) }, (_, k) => { const c = k % a.g.cols, r = Math.floor(k / a.g.cols); return `<rect x="${a.g.x0 + c * (a.sw + a.gap)}" y="${a.g.y0 + r * (a.sh + a.gap)}" width="${a.sw}" height="${a.sh}" fill="#DBEAFE" stroke="#60A5FA" stroke-width="0.4"/><text x="${a.g.x0 + c * (a.sw + a.gap) + a.sw / 2}" y="${a.g.y0 + r * (a.sh + a.gap) + a.sh / 2}" font-size="5" text-anchor="middle">${esc(s(p.rows[a.slots[k].row].title))}</text>`; }).join("")}</svg>`,
      };
    },
    exports: [
      { id: "pdf", label: ["打印页 PDF", "Print sheets (PDF)"], description: "print-sheets.pdf", async run(ctx: ExportCtx) {
        const p = ctx.project, a = analyse(p), m = p.meta as unknown as Meta, k = await newPdf(), cache = new Map<string, PDFImage>();
        const img = async (f: string) => { if (!cache.has(f)) { const b = await ctx.ws.read(f, 60 * 1024 * 1024); cache.set(f, m.images[f]?.type === "png" ? await k.doc.embedPng(b) : await k.doc.embedJpg(b)); } return cache.get(f)!; };
        const fit = s(p.settings.fit) || "cover", cm = p.settings.cropMarks !== false;
        for (let sh = 0; sh < a.sheets; sh++) {
          const batch = a.slots.slice(sh * a.per, (sh + 1) * a.per);
          for (const side of a.duplex === "none" ? ["front"] : ["front", "back"]) {
            const pg = k.doc.addPage([a.pw * MM, a.ph * MM]), mirrorX = side === "back" && a.duplex === "long" ? !(a.pw > a.ph) : side === "back" && a.duplex === "short" ? a.pw > a.ph : false, mirrorY = side === "back" && !mirrorX;
            for (let n = 0; n < batch.length; n++) {
              const c = n % a.g.cols, r = Math.floor(n / a.g.cols), cx = mirrorX ? a.g.cols - 1 - c : c, ry = mirrorY ? a.g.rows - 1 - r : r;
              const x = (a.g.x0 + cx * (a.sw + a.gap)) * MM, y = (a.ph - a.g.y0 - ry * (a.sh + a.gap) - a.sh) * MM;
              const f = side === "front" ? batch[n].file : batch[n].back; if (!f) continue;
              drawCard(pg, await img(f), x, y, a.sw * MM, a.sh * MM, fit);
            }
            if (cm && side === "front") marks(pg, a, batch.length, false);
            k.text(pg, `${s(p.settings.title) || "Cards"} · ${sh + 1}/${a.sheets} · ${side === "front" ? "正面" : "背面"} · ${a.cw}×${a.ch} mm +${a.bleed} mm 出血`, 8 * MM, 3.5 * MM, { size: 6, color: "#9CA3AF" });
          }
        }
        if (!a.sheets) k.doc.addPage([a.pw * MM, a.ph * MM]);
        return [await ctx.write("print-sheets.pdf", await k.doc.save())];
      } },
      { id: "backs", label: ["背面 PDF", "Backs (PDF)"], description: "backs.pdf", async run(ctx: ExportCtx) {
        const p = ctx.project, a = analyse(p), m = p.meta as unknown as Meta, k = await newPdf(), cache = new Map<string, PDFImage>();
        const img = async (f: string) => { if (!cache.has(f)) { const b = await ctx.ws.read(f, 60 * 1024 * 1024); cache.set(f, m.images[f]?.type === "png" ? await k.doc.embedPng(b) : await k.doc.embedJpg(b)); } return cache.get(f)!; };
        for (let sh = 0; sh < a.sheets; sh++) {
          const batch = a.slots.slice(sh * a.per, (sh + 1) * a.per), pg = k.doc.addPage([a.pw * MM, a.ph * MM]);
          for (let n = 0; n < batch.length; n++) {
            const f = batch[n].back; if (!f) continue;
            const c = n % a.g.cols, r = Math.floor(n / a.g.cols), cx = a.g.cols - 1 - c;
            drawCard(pg, await img(f), (a.g.x0 + cx * (a.sw + a.gap)) * MM, (a.ph - a.g.y0 - r * (a.sh + a.gap) - a.sh) * MM, a.sw * MM, a.sh * MM, s(p.settings.fit) || "cover");
          }
          k.text(pg, `背面 ${sh + 1}/${a.sheets}（已左右镜像，打印在正面页的反面）`, 8 * MM, 3.5 * MM, { size: 6, color: "#9CA3AF" });
        }
        if (!a.sheets) k.doc.addPage([a.pw * MM, a.ph * MM]);
        return [await ctx.write("backs.pdf", await k.doc.save())];
      } },
      { id: "csv", label: ["卡牌清单 CSV", "Card list (CSV)"], description: "card-list.csv", async run(ctx: ExportCtx) {
        const c = ctx.computed, q = (v: unknown) => { const t = String(v ?? ""); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
        const rows = (c.rows ?? []).filter((r) => r.include !== false);
        return [await ctx.write("card-list.csv", "\uFEFF" + ["图片,名称,数量,背面,像素/dpi,所在页", ...rows.map((r) => [s(r.file), s(r.title), s(r.count) || 1, s(r.back) || s(ctx.project.settings.back), s(r._info), s(r._sheets)].map(q).join(","))].join("\r\n") + "\r\n")];
      } },
    ],
    describeRow: (r, i) => `#${i}${r.include === false ? " [dropped]" : ""} ${s(r.file)} “${s(r.title)}” ×${s(r.count) || 1}${s(r.back) ? ` back ${s(r.back)}` : ""}${s(r._info) ? ` (${s(r._info)})` : ""}${s(r._sheets) ? ` sheet ${s(r._sheets)}` : ""}`,
  };
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(), options).server;
}
