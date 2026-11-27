import { createApp, esc, toCsv, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders } from "./kit/columns.ts";
import { hexRgb, newPdf, type PdfKit } from "./kit/pdf.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { mixedText, type Mixed } from "./fallback.ts";
import { backIndex, fit, GRIDS, MM, PAGES, plan, slots, tsvCell } from "./cards.ts";

export const NAME = "flashcard-maker";
export const VERSION = "0.1.0";
const s = (v: unknown) => String(v ?? "").trim();

interface Card { front: string; reading: string; back: string; example: string; tags: string; row: number }

function cardsOf(p: Pick<Project, "rows" | "settings">): Card[] {
  const rev = p.settings.reverse === true;
  return p.rows.map((r, i) => ({ r, i })).filter(({ r }) => r.include !== false && (s(r.front) || s(r.back))).map(({ r, i }) => ({
    front: rev ? s(r.back) : s(r.front), back: rev ? s(r.front) : s(r.back), reading: s(r.reading), example: s(r.example), tags: s(r.tags), row: i,
  }));
}

function drawFace(k: PdfKit, page: ReturnType<PdfKit["doc"]["addPage"]>, slot: { x: number; y: number; w: number; h: number }, c: Card, side: "front" | "back", o: { settings: Record<string, unknown>; n: number; mx: Mixed }) {
  const pad = Math.min(slot.w, slot.h) * 0.08;
  const showReading = s(o.settings.reading) || "front";
  const color = s(o.settings.color) || "#1d4ed8";
  if (o.settings.cutLines !== false) page.drawRectangle({ x: slot.x, y: slot.y, width: slot.w, height: slot.h, borderColor: hexRgb("#c7c7c7"), borderWidth: 0.4, borderDashArray: [3, 3] });
  if (o.settings.numbers !== false) k.text(page, String(o.n), side === "front" ? slot.x + slot.w - pad / 2 : slot.x + pad / 2, slot.y + pad / 2, { size: 6.5, color: "#9ca3af", align: side === "front" ? "right" : "left" });
  const wrap = (t: string, size: number, w: number) => k.wrap(t, size, w);
  const w = slot.w - 2 * pad;
  if (side === "front") {
    const sub = showReading === "front" ? c.reading : "";
    const subH = sub ? Math.min(slot.h * 0.2, 16) : 0;
    const f = fit(c.front, w, slot.h - 2 * pad - subH - 4, Number(o.settings.frontSize ?? 30), 7, wrap);
    const lh = f.size * 1.25, blockH = f.lines.length * lh + (sub ? subH + 4 : 0);
    let y = slot.y + slot.h / 2 + blockH / 2 - f.size;
    for (const line of f.lines) { o.mx.text(page, line, slot.x + slot.w / 2, y, { size: f.size, bold: true, align: "center", color: "#111827" }); y -= lh; }
    if (sub) o.mx.text(page, sub, slot.x + slot.w / 2, y + lh - subH - 7, { size: Math.min(11, subH * 0.8, (w / Math.max(1, o.mx.width(sub, 11))) * 11), align: "center", color: "#6b7280" });
    if (c.tags && o.settings.tagsOnFront !== false) k.text(page, c.tags, slot.x + pad / 2, slot.y + slot.h - pad / 2 - 6, { size: 6.5, color, maxWidth: w });
    return f.overflow;
  }
  const parts: { text: string; size: number; color: string; bold?: boolean }[] = [];
  if (showReading === "back" && c.reading) parts.push({ text: c.reading, size: 0.7, color: "#6b7280" });
  parts.push({ text: c.back, size: 1, color: "#111827", bold: true });
  if (o.settings.example !== false && c.example) parts.push({ text: c.example, size: 0.72, color: "#374151" });
  // 统一缩放：找最大的基准字号使全部内容放下
  const avail = slot.h - 2 * pad;
  let base = Number(o.settings.backSize ?? 16), laid: { lines: string[]; size: number; color: string; bold?: boolean }[] = [], overflow = false;
  for (; base >= 6; base -= 0.5) {
    laid = parts.map((pt) => ({ lines: wrap(pt.text, base * pt.size, w), size: base * pt.size, color: pt.color, bold: pt.bold }));
    const h = laid.reduce((a, l) => a + l.lines.length * l.size * 1.3, 0) + (laid.length - 1) * 6;
    if (h <= avail) break;
  }
  if (base < 6) { base = 6; overflow = true; laid = parts.map((pt) => ({ lines: wrap(pt.text, 6 * pt.size, w), size: 6 * pt.size, color: pt.color, bold: pt.bold })); }
  const total = laid.reduce((a, l) => a + l.lines.length * l.size * 1.3, 0) + (laid.length - 1) * 6;
  let y = slot.y + slot.h / 2 + Math.min(total, avail) / 2;
  for (const l of laid) {
    for (const line of l.lines) { y -= l.size * 1.3; if (y < slot.y + pad / 2) { overflow = true; break; } o.mx.text(page, line, slot.x + slot.w / 2, y + l.size * 0.25, { size: l.size, bold: l.bold, align: "center", color: l.color }); }
    y -= 6;
  }
  return overflow;
}

export async function renderPdf(p: Pick<Project, "rows" | "settings">) {
  const k = await newPdf();
  const mx = await mixedText(k);
  const cards = cardsOf(p), grid = GRIDS[s(p.settings.grid)] ?? GRIDS["2x4"];
  const size = PAGES[s(p.settings.paper) === "Letter" ? "Letter" : "A4"];
  const duplex = p.settings.duplex !== false, flip = s(p.settings.flip) === "short" ? "short" : "long";
  const sl = slots(size, grid, Number(p.settings.margin ?? 10));
  const overflow = new Set<number>();
  const pages = plan(cards.length, grid, duplex);
  for (const pg of pages) {
    const page = k.doc.addPage([size[0], size[1]]);
    pg.cards.forEach((ci, j) => {
      const slot = pg.side === "front" ? sl[j] : sl[backIndex(j, grid, flip)];
      if (drawFace(k, page, slot, cards[ci], pg.side, { settings: p.settings, n: ci + 1, mx })) overflow.add(cards[ci].row);
    });
    const deck = s(p.settings.deck);
    if (deck) k.text(page, `${deck} · ${pg.side === "front" ? "正面 front" : "背面 back"}`, size[0] / 2, 4 * MM, { size: 7, align: "center", color: "#9ca3af" });
  }
  // 单面模式：背面另起一组页，同样对齐
  if (!duplex) {
    for (const pg of plan(cards.length, grid, false)) {
      const page = k.doc.addPage([size[0], size[1]]);
      pg.cards.forEach((ci, j) => { if (drawFace(k, page, sl[j], cards[ci], "back", { settings: p.settings, n: ci + 1, mx })) overflow.add(cards[ci].row); });
    }
  }
  return { k, overflow, pages: k.doc.getPageCount(), cards: cards.length };
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "flashcards",
  title: ["单词卡制作", "Flashcard Maker"],
  openDescription:
    "Make printable double-sided flashcards and an import file for spaced-repetition apps from a word list (.xlsx/.csv/.tsv/.txt). Columns: front (单词/word/term/正面), back (释义/meaning/definition/背面), optional reading (音标/拼音/phonetic), example (例句/example) and tags (标签/tags); a .txt with “word<TAB>meaning” or “word - meaning” lines also works. Cards are laid out on a grid (2x4, 2x5, 3x3, 3x4, 3x6, 4x6) with fronts and backs on alternating pages, mirrored so they line up when printed double-sided (flip on long or short edge). Text shrinks to fit. Exports flashcards.pdf, anki.tsv (Anki import with tags) and cards.csv.",
  inputs: { exts: [".xlsx", ".csv", ".tsv", ".txt"], min: 1, max: 1, label: ["选择词表", "Pick a word list"] },
  settings: [
    { key: "deck", label: ["卡组名称", "Deck name"], type: "text", default: "" },
    { key: "grid", label: ["每页张数", "Cards per page"], type: "select", default: "2x4", options: Object.keys(GRIDS).map((g) => ({ value: g, label: [`${g}（${GRIDS[g].cols * GRIDS[g].rows} 张）`, `${g} (${GRIDS[g].cols * GRIDS[g].rows} cards)`] as [string, string] })) },
    { key: "paper", label: ["纸张", "Paper"], type: "select", default: "A4", options: [{ value: "A4", label: ["A4", "A4"] }, { value: "Letter", label: ["Letter", "US Letter"] }] },
    { key: "duplex", label: ["双面打印（正反面交替）", "Double-sided (fronts and backs alternate)"], type: "bool", default: true },
    { key: "flip", label: ["翻转方式", "Flip on"], type: "select", default: "long", options: [{ value: "long", label: ["长边翻转（常见）", "Long edge (usual)"] }, { value: "short", label: ["短边翻转", "Short edge"] }] },
    { key: "reading", label: ["音标 / 拼音放在", "Reading goes on"], type: "select", default: "front", options: [{ value: "front", label: ["正面", "Front"] }, { value: "back", label: ["背面", "Back"] }, { value: "none", label: ["不显示", "Hidden"] }] },
    { key: "example", label: ["背面显示例句", "Example on the back"], type: "bool", default: true },
    { key: "reverse", label: ["反向（释义在正面）", "Reverse (meaning on front)"], type: "bool", default: false },
    { key: "frontSize", label: ["正面最大字号", "Front max font size"], type: "number", default: 30, min: 8, max: 72 },
    { key: "cutLines", label: ["裁切虚线", "Cut lines"], type: "bool", default: true },
    { key: "numbers", label: ["卡片编号", "Card numbers"], type: "bool", default: true },
    { key: "color", label: ["标签颜色", "Tag colour"], type: "text", default: "#1d4ed8" },
  ],
  columns: () => [
    { key: "include", label: ["打印", "Print"], type: "bool" },
    { key: "front", label: ["正面", "Front"], wide: true },
    { key: "reading", label: ["音标/拼音", "Reading"] },
    { key: "back", label: ["背面", "Back"], wide: true },
    { key: "example", label: ["例句", "Example"], wide: true },
    { key: "tags", label: ["标签", "Tags"] },
  ] as Column[],
  async load({ ws, files }) {
    const f = files[0];
    let rows: Row[];
    if (/\.txt$/i.test(f)) {
      const text = (await ws.read(f, 20 * 1024 * 1024)).toString("utf8").replace(/^\uFEFF/, "");
      rows = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => {
        const m = l.split("\t").length > 1 ? l.split("\t") : (/^(.+?)\s+[-–—:：=]\s+(.+)$/.exec(l)?.slice(1) ?? [l, ""]);
        return { include: true, front: s(m[0]), back: s(m[1]), reading: "", example: s(m[2]), tags: s(m[3]) };
      });
    } else {
      const t = await readTable(ws, f);
      const m = mapHeaders(t.columns, { front: ["正面", "单词", "词语", "生词", "汉字", "word", "term", "question", "front", "问题", "vocabulary"], reading: ["音标", "拼音", "读音", "注音", "假名", "phonetic", "pronunciation", "reading", "pinyin", "ipa"], back: ["背面", "释义", "意思", "翻译", "中文", "解释", "meaning", "definition", "translation", "answer", "back", "答案"], example: ["例句", "例子", "example", "sentence", "usage"], tags: ["标签", "单元", "分类", "tags", "tag", "unit", "lesson", "deck"] });
      if (!m.front && t.columns.length >= 2) { m.front = t.columns[0]; m.back ??= t.columns[1]; }
      if (!m.front) throw new KitError("columns_not_found", `Need at least a word and a meaning column (单词 / 释义 / front / back). Columns: ${t.columns.join(", ")}`);
      rows = t.rows.map((r) => ({ include: true, front: s(r[m.front!]), reading: m.reading ? s(r[m.reading]) : "", back: m.back ? s(r[m.back]) : "", example: m.example ? s(r[m.example]) : "", tags: m.tags ? s(r[m.tags]) : "" }));
    }
    rows = rows.filter((r) => s(r.front) || s(r.back));
    if (!rows.length) throw new KitError("empty", "No cards found in the file.");
    return { rows, meta: { file: f } };
  },
  async compute(p): Promise<Computed> {
    const issues: Issue[] = [];
    const seen = new Map<string, number>();
    p.rows.forEach((r, i) => {
      if (r.include === false) return;
      if (!s(r.front)) issues.push({ level: "error", row: i, key: "front", message: `Card ${i + 1} has no front / 正面为空` });
      if (!s(r.back)) issues.push({ level: "warn", row: i, key: "back", message: `“${s(r.front)}” has no back / 背面为空` });
      const key = s(r.front).toLowerCase();
      if (key && seen.has(key)) issues.push({ level: "warn", row: i, key: "front", message: `“${s(r.front)}” is also card ${seen.get(key)! + 1} / 重复` });
      else if (key) seen.set(key, i);
    });
    const r = await renderPdf(p);
    for (const row of r.overflow) issues.push({ level: "warn", row, message: `Card ${row + 1} “${s(p.rows[row].front)}” is too long for the card even at the smallest size — shorten it or choose fewer cards per page / 内容太长` });
    const grid = GRIDS[s(p.settings.grid)] ?? GRIDS["2x4"];
    const shown = cardsOf(p).slice(0, 6);
    const preview = `<div style="display:grid;grid-template-columns:repeat(${Math.min(3, grid.cols)},1fr);gap:8px">${shown.map((c, i) => `<div style="border:1px dashed #cbd5e1;border-radius:6px;padding:10px;text-align:center;min-height:70px"><div style="font-size:18px;font-weight:700">${esc(c.front)}</div>${c.reading && s(p.settings.reading) !== "none" ? `<div class="muted">${esc(c.reading)}</div>` : ""}<hr style="border:none;border-top:1px solid #eee"><div>${esc(c.back)}</div>${c.example && p.settings.example !== false ? `<div class="muted" style="font-size:11px">${esc(c.example)}</div>` : ""}<div class="muted" style="font-size:10px;text-align:right">${i + 1}</div></div>`).join("")}</div>`;
    return {
      rows: p.rows,
      issues,
      summary: `${r.cards} cards on ${r.pages} page(s) (${grid.cols}×${grid.rows}${p.settings.duplex !== false ? `, double-sided, flip on ${s(p.settings.flip) === "short" ? "short" : "long"} edge` : ", fronts then backs"}). ${r.cards} 张卡。`,
      stats: { cards: r.cards, pages: r.pages, perPage: grid.cols * grid.rows },
      preview,
    };
  },
  exports: [
    {
      id: "pdf", label: ["打印 PDF", "Printable PDF"], description: "flashcards.pdf — fronts and backs on alternating pages, aligned for double-sided printing",
      async run({ project, write, computed }: ExportCtx) {
        if ((computed.issues ?? []).some((i) => i.level === "error")) throw new KitError("has_errors", "Fix the errors first (see the issue list).");
        const r = await renderPdf(project);
        return { files: [await write("flashcards.pdf", await r.k.doc.save())], note: r.k.cjk ? "Print double-sided at 100% (actual size)." : "No Chinese font was found on this computer; non-Latin text was replaced with ?." };
      },
    },
    {
      id: "anki", label: ["Anki 导入 TSV", "Anki import (TSV)"], description: "anki.tsv — Front, Back, Tags with Anki file headers (File ▸ Import)",
      async run({ project, write }: ExportCtx) {
        const cards = cardsOf(project), readingFront = (s(project.settings.reading) || "front") === "front";
        const lines = cards.map((c) => {
          const front = c.reading && readingFront ? `${c.front}<br><small>${c.reading}</small>` : c.front;
          const back = [c.reading && s(project.settings.reading) === "back" ? `<small>${c.reading}</small>` : "", c.back, c.example && project.settings.example !== false ? `<i>${c.example}</i>` : ""].filter(Boolean).join("<br>");
          return [front, back, c.tags.split(/[\s,，;；]+/).filter(Boolean).join(" ")].map(tsvCell).join("\t");
        });
        const deck = s(project.settings.deck);
        const head = ["#separator:tab", "#html:true", "#tags column:3", ...(deck ? [`#deck:${deck}`] : [])];
        return [await write("anki.tsv", [...head, ...lines].join("\n") + "\n")];
      },
    },
    {
      id: "csv", label: ["卡片 CSV", "Cards (CSV)"], description: "cards.csv — front, back, reading, example, tags (for Quizlet and other apps)",
      async run({ project, write }: ExportCtx) {
        return [await write("cards.csv", toCsv(["front", "back", "reading", "example", "tags"], cardsOf(project).map((c) => [c.front, c.back, c.reading, c.example, c.tags])))];
      },
    },
  ],
  describeRow: (r, i) => `#${i}${r.include === false ? " [off]" : ""} ${s(r.front)}${s(r.reading) ? ` [${s(r.reading)}]` : ""} → ${s(r.back)}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
