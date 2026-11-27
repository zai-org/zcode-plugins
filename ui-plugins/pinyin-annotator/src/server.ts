import { rgb, type PDFPage } from "pdf-lib";
import { createApp, esc, htmlPage, type AppDef, type Computed, type ExportCtx, type Issue, type Project } from "./kit/app.ts";
import { MM, newPdf, PAGE, type PdfKit } from "./kit/pdf.ts";
import { annotate, isSyllable, numToMark, style, type Tok } from "./py.ts";
import { s } from "./util.ts";

export const NAME = "pinyin-annotator";
export const VERSION = "0.1.0";

/** 拼音库常读错的搭配：命中时给出建议读音（只提示，不自动改）。 */
const HINTS: { re: RegExp; off: number; py: string }[] = [
  { re: /还(?=[书钱给回])|(?<=归|偿|退)还/g, off: 0, py: "huán" },
  { re: /朝(?=[阳霞气晖露])/g, off: 0, py: "zhāo" },
  { re: /数(?=[星一着数钱])/g, off: 0, py: "shǔ" },
  { re: /种(?=[花树菜地瓜豆田])/g, off: 0, py: "zhòng" },
  { re: /当(?=[老一个上什作成])/g, off: 0, py: "dāng" },
  { re: /(?<=[\u4e00-\u9fff]{2})地(?=[\u4e00-\u9fff])/g, off: 0, py: "de" },
];
const NOT_DE = /(土|大|田|草|场|本|外|各|天|基|陆|园|高|山|平|空|湿|盆|林|墓|产|圣|领|境|余|质|阵|工|目的|当|此|该|全|满|遍|落|就|原|实|特|心|种|耕)地$/;

/** 几乎总读一个音的字，不列出来（仍会注音）。 */
const LOW_RISK = new Set([..."的了们么子头上下里说什一不弟妈奶爸哥姐跑场大个么呢吗吧啊哪那这儿天去来是有在和"].filter((c) => c !== "和"));

interface State { toks: Tok[]; rows: { i: number; at: number; auto: string; final: string; hint?: string }[] }

function state(p: Project): State {
  const toks = annotate(s(p.meta.text), s(p.settings.custom));
  const text = toks.map((t) => (t.ch.length === 1 ? t.ch : "\u0000")).join("");
  const hint = new Map<number, string>();
  for (const h of HINTS) for (const m of text.matchAll(h.re)) {
    const at = m.index! + h.off;
    if (h.py === "de" && NOT_DE.test(text.slice(Math.max(0, at - 2), at + 1))) continue;
    if (toks[at] && toks[at].py !== h.py) hint.set(at, h.py);
  }
  const rows = p.rows.map((r, i) => {
    const at = Number(r.at), t = toks[at];
    const auto = t?.py ?? "", typed = s(r.reading) ? numToMark(s(r.reading)) : "";
    if (t && typed) t.py = typed;
    return { i, at, auto, final: t?.py ?? "", hint: typed ? undefined : hint.get(at) };
  });
  return { toks, rows };
}

const lineGroups = (toks: Tok[]) => { const out: Tok[][] = [[]]; for (const t of toks) { if (t.ch === "\n") out.push([]); else out[out.length - 1].push(t); } return out; };

function rubyHtml(p: Project) {
  const { toks } = state(p), tone = s(p.settings.tone) || "mark";
  const lines = lineGroups(toks).map((l, i) => `<p class="${i === 0 && yesTitle(p) ? "t" : ""}">${l.map((t) => (t.zh ? `<ruby>${esc(t.ch)}<rt>${esc(style(t.py, tone))}</rt></ruby>` : esc(t.ch))).join("")}</p>`).join("\n");
  return htmlPage(s(p.settings.title) || "拼音注音", lines, `body{font-size:${Number(p.settings.fontSize) || 26}px;line-height:2.4;font-family:"Kaiti SC","STKaiti","KaiTi","PingFang SC",serif}rt{font-size:.45em;color:#2563eb;font-family:"Helvetica Neue",Arial,sans-serif}p{margin:.2em 0}p.t{text-align:center;font-weight:700}`);
}
const yesTitle = (p: Project) => p.settings.firstLineTitle !== false;

function drawGrid(page: PDFPage, x: number, y: number, w: number) {
  const c = rgb(0.86, 0.42, 0.42);
  page.drawRectangle({ x, y, width: w, height: w, borderColor: c, borderWidth: 0.8 });
  for (const [a, b, d, e] of [[x, y + w / 2, x + w, y + w / 2], [x + w / 2, y, x + w / 2, y + w]]) page.drawLine({ start: { x: a, y: b }, end: { x: d, y: e }, color: c, thickness: 0.4, dashArray: [2, 2] });
}

async function lessonPdf(p: Project) {
  const k: PdfKit = await newPdf();
  const { toks } = state(p), tone = s(p.settings.tone) || "mark", grid = s(p.settings.layout) === "grid";
  const size = Number(p.settings.fontSize) || 26, pys = size * 0.42, [W, H] = PAGE.A4, M = 18 * MM;
  const cell = (t: Tok) => (t.zh ? Math.max(size * (grid ? 1.25 : 1.08), k.width(style(t.py, tone), pys) + 4) : k.width(t.ch, size) + (grid ? size * 0.25 : 0));
  const lineH = size * 2.25;
  let page = k.doc.addPage([W, H]), y = H - M - size * 0.6;
  const newline = () => { y -= lineH; if (y < M) { page = k.doc.addPage([W, H]); y = H - M - size * 0.6; } };
  lineGroups(toks).forEach((line, li) => {
    if (!line.length) { y -= lineH * 0.4; return; }
    const title = li === 0 && yesTitle(p);
    const wrapW = W - 2 * M;
    const chunks: Tok[][] = [[]];
    let w = 0;
    for (const t of line) { const cw = cell(t); if (w + cw > wrapW && chunks[chunks.length - 1].length) { chunks.push([]); w = 0; } chunks[chunks.length - 1].push(t); w += cw; }
    for (const ch of chunks) {
      const total = ch.reduce((a, t) => a + cell(t), 0);
      let x = title ? (W - total) / 2 : M;
      for (const t of ch) {
        const cw = cell(t);
        if (t.zh) {
          if (grid) drawGrid(page, x + (cw - size * 1.2) / 2, y - size * 0.25, size * 1.2);
          const py = style(t.py, tone);
          k.text(page, py, x + (cw - k.width(py, pys)) / 2, y + size * 1.15, { size: pys, color: "#2563eb" });
          k.text(page, t.ch, x + (cw - k.width(t.ch, size, title)) / 2, y, { size, bold: title });
        } else k.text(page, t.ch, x + (grid ? size * 0.12 : 0), y, { size });
        x += cw;
      }
      newline();
    }
  });
  return k.doc.save();
}

const segWords = (text: string) => [...new Intl.Segmenter("zh", { granularity: "word" }).segment(text)].filter((x) => x.isWordLike).map((x) => x.segment);

async function cardsPdf(p: Project, chars: string[]) {
  const k = await newPdf();
  const { toks } = state(p), tone = s(p.settings.tone) || "mark";
  const [W, H] = PAGE.A4, M = 12 * MM, cols = 3, rowsN = 4, cw = (W - 2 * M) / cols, ch = (H - 2 * M) / rowsN;
  const text = toks.map((t) => t.ch).join("");
  let page: PDFPage | null = null;
  chars.forEach((c, i) => {
    if (i % (cols * rowsN) === 0) page = k.doc.addPage([W, H]);
    const col = i % cols, row = Math.floor(i / cols) % rowsN, x = M + col * cw, y = H - M - (row + 1) * ch;
    page!.drawRectangle({ x: x + 4, y: y + 4, width: cw - 8, height: ch - 8, borderColor: rgb(0.8, 0.82, 0.86), borderWidth: 0.8, borderDashArray: [3, 3] });
    const at = toks.findIndex((t) => t.ch === c);
    const py = at >= 0 ? style(toks[at].py, tone) : "";
    k.text(page!, py, x + cw / 2, y + ch - 34, { size: 18, color: "#2563eb", align: "center" });
    drawGrid(page!, x + (cw - 86) / 2, y + ch - 136, 86);
    k.text(page!, c, x + cw / 2, y + ch - 118, { size: 64, align: "center" });
    const words = [...new Set(segWords(text).filter((w) => w.length > 1 && w.includes(c)))].slice(0, 3);
    if (!words.length) { const j = text.indexOf(c); const nx = text[j + 1] ?? "", pv = text[j - 1] ?? ""; if (/[\u4e00-\u9fff]/.test(nx)) words.push(c + nx); else if (/[\u4e00-\u9fff]/.test(pv)) words.push(pv + c); }
    k.text(page!, words.join("  "), x + cw / 2, y + 22, { size: 13, color: "#4b5563", align: "center" });
  });
  return k.doc.save();
}

const DEF: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "pinyin",
  title: ["拼音标注", "Pinyin Annotator"],
  openDescription:
    "Add pinyin above Chinese text (a .txt or .md lesson, story or poem) for children's readers and character cards. Readings come from a word-aware dictionary; each row is one polyphonic character (多音字) with its context, the automatic reading, the possible readings and a hint when the dictionary is likely wrong (e.g. 还书 huán, 朝阳 zhāo, 数星星 shǔ, 种花 zhòng, adverbial 地 de). Fix a reading by setting `reading` (tone marks or numbers like huan2); or add whole-word fixes in the “custom” setting (`还书: huan2 shu1`, one per line). Tone marks, tone numbers or no tones; flowing text or 田字格 grid. Exports ruby HTML, an A4 PDF, character cards (PDF) for the characters in the “cards” setting and a plain pinyin text.",
  inputs: { exts: [".txt", ".md"], min: 0, max: 1, label: ["选择中文课文/文本", "Pick the Chinese text"] },
  settings: [
    { key: "title", label: ["文档标题", "Document title"], type: "text", default: "" },
    { key: "firstLineTitle", label: ["第一行是标题", "First line is a title"], type: "bool", default: true },
    { key: "tone", label: ["声调", "Tones"], type: "select", default: "mark", options: [{ value: "mark", label: ["声调符号 hǎo", "Marks (hǎo)"] }, { value: "num", label: ["数字 hao3", "Numbers (hao3)"] }, { value: "none", label: ["不标声调", "No tones"] }] },
    { key: "layout", label: ["PDF 版式", "PDF layout"], type: "select", default: "flow", options: [{ value: "flow", label: ["正文", "Flowing text"] }, { value: "grid", label: ["田字格", "Tianzige grid"] }] },
    { key: "fontSize", label: ["字号", "Font size"], type: "number", default: 26, min: 12, max: 60 },
    { key: "custom", label: ["自定义读音（词: 拼音，每行一个）", "Custom readings (word: pinyin, one per line)"], type: "textarea", default: "" },
    { key: "cards", label: ["生字卡的字", "Characters for cards"], type: "text", default: "" },
  ],
  columns: () => [
    { key: "ch", label: ["字", "Char"], readOnly: true },
    { key: "context", label: ["上下文", "Context"], readOnly: true, wide: true },
    { key: "_auto", label: ["自动读音", "Auto reading"], readOnly: true },
    { key: "reading", label: ["读音", "Reading"] },
    { key: "_options", label: ["可选读音", "Possible readings"], readOnly: true },
    { key: "_hint", label: ["建议", "Suggestion"], readOnly: true },
  ],
  async load({ ws, files }) {
    const raw = files.length ? await ws.readText(files[0]) : "春眠不觉晓";
    const text = raw.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/^#+\s*/gm, "").replace(/\*\*|__|`/g, "").replace(/\r/g, "").trim();
    const toks = annotate(text, "");
    const rows = toks.map((t, at) => ({ t, at })).filter(({ t }) => t.zh && t.alts.length > 1 && !LOW_RISK.has(t.ch)).map(({ t, at }) => {
      const flat = toks.map((x) => (x.ch === "\n" ? " " : x.ch));
      return { at, ch: t.ch, context: `${flat.slice(Math.max(0, at - 4), at).join("")}【${t.ch}】${flat.slice(at + 1, at + 5).join("")}`, reading: "" };
    });
    return { rows, meta: { text } };
  },
  compute(p): Computed {
    const st = state(p), issues: Issue[] = [];
    const opts = (at: number) => st.toks[at]?.alts ?? [];
    for (const r of st.rows) {
      const typed = s(p.rows[r.i].reading);
      if (typed) {
        const m = numToMark(typed);
        if (!isSyllable(m)) issues.push({ level: "error", row: r.i, key: "reading", message: `“${typed}” is not a pinyin syllable (write e.g. huán or huan2).` });
        else if (!opts(r.at).includes(m)) issues.push({ level: "warn", row: r.i, key: "reading", message: `${s(p.rows[r.i].ch)}: “${m}” is not one of its usual readings (${opts(r.at).join(", ")}).` });
      } else if (r.hint) issues.push({ level: "warn", row: r.i, key: "reading", message: `${s(p.rows[r.i].context)}: read as ${r.auto}, probably ${r.hint} — set reading to confirm.` });
    }
    const zh = st.toks.filter((t) => t.zh);
    const cards = [...s(p.settings.cards)].filter((c) => /[\u4e00-\u9fff]/.test(c));
    for (const c of cards) if (!zh.some((t) => t.ch === c)) issues.push({ level: "info", message: `Card character “${c}” is not in the text — its card has no example words.` });
    const fixed = st.rows.filter((r) => s(p.rows[r.i].reading)).length;
    return {
      rows: p.rows.map((r, i) => { const x = st.rows[i]; return { ...r, _auto: x.auto, _options: opts(x.at).join(" / "), _hint: x.hint ?? "" }; }),
      issues,
      summary: `${zh.length} Chinese character(s) on ${lineGroups(st.toks).length} line(s); ${st.rows.length} polyphonic, ${st.rows.filter((r) => r.hint).length} likely misread, ${fixed} fixed by hand.`,
      stats: { chars: zh.length, polyphones: st.rows.length, suspicious: st.rows.filter((r) => r.hint).length, fixed },
      preview: rubyHtml(p).replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, "").replace(/<p/g, `<p style="font-size:22px;line-height:2.3;margin:0"`),
    };
  },
  exports: [
    { id: "html", label: ["注音 HTML", "Ruby HTML"], description: "pinyin.html — pinyin above each character", async run({ project, write }: ExportCtx) { return [await write("pinyin.html", rubyHtml(project))]; } },
    { id: "pdf", label: ["注音 PDF", "Annotated PDF"], description: "pinyin.pdf — A4, flowing text or 田字格", async run({ project, write }: ExportCtx) { return [await write("pinyin.pdf", await lessonPdf(project))]; } },
    {
      id: "cards", label: ["生字卡 PDF", "Character cards (PDF)"], description: "cards.pdf — 12 cards per A4 page for the characters in the cards setting",
      async run({ project, write }: ExportCtx) {
        const chars = [...new Set([...s(project.settings.cards)].filter((c) => /[\u4e00-\u9fff]/.test(c)))];
        if (!chars.length) return { files: [], note: "No cards: put the characters to practise in the “cards” setting (e.g. 朝阳背还种数)." };
        return [await write("cards.pdf", await cardsPdf(project, chars))];
      },
    },
    { id: "txt", label: ["拼音文本", "Pinyin text"], description: "pinyin.txt — each line as pinyin under the Chinese", async run({ project, write }: ExportCtx) { const tone = s(project.settings.tone) || "mark"; return [await write("pinyin.txt", lineGroups(state(project).toks).map((l) => `${l.map((t) => t.ch).join("")}\n${l.map((t) => (t.zh ? style(t.py, tone) : t.ch.trim())).filter(Boolean).join(" ")}`).join("\n\n") + "\n")]; } },
  ],
  describeRow: (r, i) => `#${i} ${s(r.context)}${s(r.reading) ? ` reading=${s(r.reading)}` : ""}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(DEF, options).server;
}
