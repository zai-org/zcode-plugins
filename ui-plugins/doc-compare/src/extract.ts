import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { KitError } from "./kit/workspace.ts";

/** 一段文字及其在原文中的位置（PDF 页码 / DOCX 段号 / 文本行号）。 */
export interface Para { text: string; loc: string; heading?: number }

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unxml = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENT[e] ?? m)));
// PDF 字体常把常用字的字形登记成部首码位（如 ⻘ U+2ED8、⽅ U+2F45），这里还原成通用汉字：
// 部首补充区用 Unicode EquivalentUnifiedIdeograph.txt，康熙部首区用 NFKC（少数按简体字形修正）。
const RADICALS = new Map([..."⺁厂⺂乛⺃乚⺄乙⺅亻⺆冂⺇𠘨⺈刀⺉刂⺊卜⺋㔾⺎兀⺏尣⺐尢⺑𡯂⺒巳⺓幺⺔彑⺕𫜹⺖忄⺗心⺘扌⺙攵⺛旡⺜日⺝月⺞歺⺟母⺠民⺡氵⺢氺⺣灬⺦丬⺧牛⺨犭⺩王⺪𤴔⺫目⺬示⺭礻⺮𥫗⺯糹⺰纟⺱罓⺲罒⺳㓁⺴冗⺵𦉫⺶羊⺷𦍌⺸𦍋⺹耂⺺肀⺻聿⺼肉⺽𦥑⻁虎⻂衤⻃覀⻄西⻅见⻆角⻇𧢲⻈讠⻉贝⻊𧾷⻋车⻏邑⻐钅⻑長⻒镸⻓长⻔门⻕𨸏⻖阝⻗雨⻘青⻙韦⻚页⻛风⻜飞⻝食⻞𩙿⻟飠⻠饣⻡𩠐⻢马⻣骨⻤鬼⻥鱼⻦鸟⻧卤⻨麦⻩黄⻪黾⻫斉⻬齐⻭歯⻮齿⻯竜⻰龙⻱龜⻲亀⻳龟"].reduce<[string, string][]>((acc, c, i, all) => (i % 2 ? acc : [...acc, [c, all[i + 1]]]), []));
const KANGXI_SC: Record<string, string> = { "\u2f3e": "户", "\u2fad": "青" };
const radical = (c: string) => KANGXI_SC[c] ?? RADICALS.get(c) ?? c.normalize("NFKC");
// 中文与数字/英文之间的空格（排版自动加的“盘古之白”）不算内容，统一去掉。
const HAN = "[\\u3000-\\u303f\\u3400-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef]";
const CJK_SPACE = new RegExp(`(?<=${HAN}) +| +(?=${HAN})`, "g");
const tidy = (s: string) => s.replace(/[ \t\u00a0\u3000]+/g, " ").replace(/ *\n */g, "\n").replace(CJK_SPACE, "").replace(/[\u2e80-\u2fdf]/g, radical).trim();

/** DOCX：正文段落（含表格单元格），按“接受全部修订”后的文字；跳过已删除文字和域代码。 */
export function docxParas(buf: Uint8Array): Para[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buf, { filter: (f) => f.name === "word/document.xml" });
  } catch {
    throw new KitError("bad_docx", "This is not a readable .docx file (old .doc files: save as .docx first).");
  }
  const xml = files["word/document.xml"];
  if (!xml) throw new KitError("bad_docx", "This .docx has no word/document.xml.");
  const body = strFromU8(xml).replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, "").replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g, "");
  const out: Para[] = [];
  let n = 0;
  for (const m of body.matchAll(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g)) {
    n++;
    const p = m[0];
    let text = "";
    for (const t of p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>|<w:noBreakHyphen\/>/g)) {
      if (t[1] !== undefined) text += unxml(t[1]);
      else if (t[0] === "<w:tab/>") text += "\t";
      else if (t[0] === "<w:noBreakHyphen/>") text += "-";
      else text += "\n";
    }
    text = tidy(text);
    if (!text) continue;
    const style = p.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? "";
    const level = /^(heading|标题)\s*(\d)/i.exec(style)?.[2] ?? (/^Title$/i.test(style) ? "1" : undefined);
    out.push({ text, loc: `¶${n}`, heading: level ? Number(level) : undefined });
  }
  return out;
}

/** 纯文本 / Markdown：空行分段；标题、列表项、表格行、引用各自成段。 */
export function textParas(src: string, markdown: boolean): Para[] {
  let lines = src.replace(/\r\n?/g, "\n").split("\n");
  let offset = 0;
  if (markdown && lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) { offset = end + 1; lines = lines.slice(end + 1); }
  }
  const out: Para[] = [];
  let buf: string[] = [];
  let start = 0;
  const flush = () => { if (buf.length) out.push({ text: tidy(buf.join(" ")), loc: `L${start + offset + 1}` }); buf = []; };
  lines.forEach((line, i) => {
    const s = line.trim();
    if (!s) return flush();
    if (markdown && /^\|[\s|:-]+\|$/.test(s)) return;
    const own = markdown ? /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>)/.test(s) : /^([-*•·]\s|\d+[.)、]\s?|[（(]?[一二三四五六七八九十]+[)）、.])/.test(s);
    if (own) flush();
    if (!buf.length) start = i;
    const h = markdown ? /^(#{1,6})\s/.exec(s) : null;
    buf.push(s);
    if (own) {
      // Markdown 的标题井号、无序列表符号和引用符号不算正文（有序编号保留，条款号可能有意义）。
      const text = tidy(buf.join(" ").replace(markdown ? /^(#{1,6}\s+|[-*+]\s+|>\s*)/ : /^$/, ""));
      out.push({ text, loc: `L${start + offset + 1}`, heading: h ? h[1].length : undefined });
      buf = [];
    }
  });
  flush();
  return out.filter((p) => p.text);
}

let pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs") | undefined;
async function loadPdfjs() {
  if (!pdfjs) {
    const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjs;
}

const CJK = /[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/;
interface Line { text: string; x: number; y: number; h: number; w: number; page: number; glyph?: boolean; font: string }

/** PDF：按页取文字行，去掉每页重复的页眉页脚和页码，再按行距、缩进、列表符号合并成段落。 */
export async function pdfParas(buf: Uint8Array, assetRoot: string): Promise<Para[]> {
  const lib = await loadPdfjs();
  let doc;
  const task = lib.getDocument({ data: new Uint8Array(buf), cMapUrl: join(assetRoot, "pdfjs/cmaps") + "/", cMapPacked: true, standardFontDataUrl: join(assetRoot, "pdfjs/standard_fonts") + "/", useSystemFonts: false, verbosity: 0 });
  try {
    doc = await task.promise;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new KitError(/password/i.test(msg) ? "pdf_password" : "bad_pdf", /password/i.test(msg) ? "This PDF is password-protected; remove the password first." : `Cannot read this PDF: ${msg}`);
  }
  const lines: Line[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let cur: Line | undefined;
    for (const it of content.items as { str: string; transform: number[]; width: number; height: number; hasEOL: boolean; fontName: string }[]) {
      if (!("str" in it)) continue;
      const [, , , d, x, y] = it.transform;
      const h = Math.abs(it.height || d) || 10;
      if (cur && Math.abs(cur.y - y) < h * 0.5 && x >= cur.x - 1) {
        const gap = x - (cur.x + cur.w);
        const sep = gap > h * 0.15 && !cur.text.endsWith(" ") && !it.str.startsWith(" ") && !(CJK.test(cur.text.slice(-1)) && CJK.test(it.str[0] ?? "")) ? " " : "";
        if (!cur.text.trim() && it.str.trim()) cur.font = it.fontName;
        cur.text += sep + it.str;
        cur.w = Math.max(cur.w, x + it.width - cur.x);
      } else if (it.str.trim() || (!cur && it.width > 0)) {
        // 以无法映射成文字的字形（常见于项目符号）开头的行，记下 glyph。
        if (cur) lines.push(cur);
        cur = { text: it.str.trim() ? it.str : "", x, y, h, w: it.width, page: p, font: it.fontName, glyph: !it.str.trim() || /^[\ue000-\uf8ff]/.test(it.str) };
      }
      if (it.hasEOL && cur) { lines.push(cur); cur = undefined; }
    }
    if (cur) lines.push(cur);
    for (let i = lines.length - 1; i >= 0 && lines[i].page === p; i--) lines[i].text = lines[i].text.replace(/^[\ue000-\uf8ff]\s*/, "");
    page.cleanup();
  }
  await task.destroy();
  for (let i = lines.length - 1; i >= 0; i--) if (!lines[i].text.trim()) lines.splice(i, 1);
  if (!lines.length) throw new KitError("no_text", "This PDF has no text layer (scanned?). OCR is not supported in v1.");
  // 页眉页脚：每页首/末行里，数字归一后在一半以上页面出现的；以及单独的页码。
  const pages = new Set(lines.map((l) => l.page)).size;
  const key = (t: string) => t.trim().replace(/\d+/g, "#");
  const count = new Map<string, number>();
  for (let p = 1; p <= pages; p++) {
    const on = lines.filter((l) => l.page === p);
    for (const l of [...on.slice(0, 2), ...on.slice(-2)]) count.set(key(l.text), (count.get(key(l.text)) ?? 0) + 1);
  }
  const noise = (l: Line, i: number, on: Line[]) => (i < 2 || i >= on.length - 2) && ((pages >= 3 && (count.get(key(l.text)) ?? 0) >= Math.max(3, pages / 2)) || /^\s*(-\s*)?(page\s*)?\d+(\s*(\/|of)\s*\d+)?(\s*-)?\s*$|^\s*第\s*\d+\s*页/i.test(l.text));
  const kept: Line[] = [];
  for (let p = 1; p <= pages; p++) {
    const on = lines.filter((l) => l.page === p);
    on.forEach((l, i) => { if (!noise(l, i, on)) kept.push(l); });
  }
  const width = Math.max(...kept.map((l) => l.x + l.w)) - Math.min(...kept.map((l) => l.x));
  const left = Math.min(...kept.map((l) => l.x));
  const out: Para[] = [];
  let para: Line[] = [];
  const flush = () => {
    if (!para.length) return;
    let text = "";
    for (const l of para) {
      const t = l.text.trim();
      if (!text) text = t;
      else if (/[A-Za-z]-$/.test(text) && /^[a-z]/.test(t)) text = text.slice(0, -1) + t;
      else if (CJK.test(text.slice(-1)) || CJK.test(t[0])) text += t;
      else text += " " + t;
    }
    out.push({ text: tidy(text), loc: `p.${para[0].page}` });
    para = [];
  };
  kept.forEach((l, i) => {
    const prev = kept[i - 1];
    const bullet = /^\s*([•·▪◦●○■□\-–—*]|\d+[.)、]|\(?[a-z]\)|[（(][一二三四五六七八九十\d]+[)）]|[一二三四五六七八九十]+、|第[一二三四五六七八九十\d]+[条章节])\s*/i.test(l.text);
    const short = prev && prev.x + prev.w < left + width * 0.7;
    const pageBreak = prev && prev.page !== l.page && !(!short && !/[.。:：!！?？;；]$/.test(prev.text.trim()) && !bullet && !l.glyph && Math.abs(l.h - prev.h) < 0.5);
    const newPara = !prev || pageBreak || (short && prev.font !== l.font) || (prev.page === l.page && Math.abs(prev.y - l.y) > Math.max(prev.h, l.h) * 1.75) || bullet || l.glyph || l.x < prev.x - 2 || (prev.x + prev.w < left + width * 0.7 && /[.。:：!！?？;；]$/.test(prev.text.trim())) || Math.abs(l.h - prev.h) > Math.min(l.h, prev.h) * 0.12;
    if (newPara) flush();
    para.push(l);
  });
  flush();
  return out.filter((p) => p.text);
}

export async function extract(name: string, buf: Uint8Array, assetRoot: string): Promise<Para[]> {
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "docx") return docxParas(buf);
  if (ext === "pdf") return pdfParas(buf, assetRoot);
  if (ext === "md" || ext === "markdown") return textParas(new TextDecoder().decode(buf), true);
  if (ext === "txt" || ext === "text") return textParas(new TextDecoder().decode(buf), false);
  throw new KitError("unsupported", `${name}: supported formats are .docx, .pdf, .md and .txt (save .doc / .pages / .rtf as .docx first).`);
}
