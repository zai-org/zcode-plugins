import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { KitError } from "./kit/workspace.ts";
import { detect, type DetectOptions } from "./detect.ts";
import type { Found } from "./formats.ts";
import { unradical } from "./cjk.ts";

let pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs") | undefined;
async function lib() {
  if (!pdfjs) {
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjs;
}

export interface Rect { page: number; x: number; y: number; w: number; h: number } // PDF 坐标（左下原点，pt）
export interface PdfFound extends Found { rects: Rect[] }
export interface PdfInfo { pages: { w: number; h: number }[]; text: number }

async function open(buf: Uint8Array, assetRoot: string) {
  const l = await lib();
  const task = l.getDocument({ data: new Uint8Array(buf), cMapUrl: join(assetRoot, "pdfjs/cmaps") + "/", cMapPacked: true, standardFontDataUrl: join(assetRoot, "pdfjs/standard_fonts") + "/", useSystemFonts: false, verbosity: 0 });
  try {
    return { task, doc: await task.promise };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new KitError(/password/i.test(msg) ? "pdf_password" : "bad_pdf", /password/i.test(msg) ? "This PDF is password-protected; remove the password first." : `Cannot read this PDF: ${msg}`);
  }
}

/** 估算字宽权重：全角字符 1，空格 0.3，其余 0.55。 */
export function charWeight(code: number): number {
  if (code === 32) return 0.3;
  if ((code >= 0x1100 && code <= 0x11ff) || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7af) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe4f) || (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6) || (code >= 0xd800 && code <= 0xdbff)) return 1;
  return 0.55;
}

type Item = { str: string; transform: number[]; width: number; height: number; hasEOL: boolean };

/** 每页文字拼成一串并记住每个字符来自哪个文字块，命中后按字符比例算出要涂黑的矩形。 */
export async function pdfFind(buf: Uint8Array, o: DetectOptions, assetRoot: string): Promise<{ found: PdfFound[]; info: PdfInfo }> {
  const { task, doc } = await open(buf, assetRoot);
  const found: PdfFound[] = [];
  const pages: PdfInfo["pages"] = [];
  let chars = 0;
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const [x0, y0, x1, y1] = page.view;
      pages.push({ w: x1 - x0, h: y1 - y0 });
      const items = (await page.getTextContent()).items as Item[];
      let text = "";
      const owner: number[] = [], index: number[] = [];
      // 行尾换行：数字在行末被折断（如 "+86 138-⏎1234-5678"）时不插换行，好让号码连起来识别。
      let eol = false;
      const strs = new Map<number, string>();
      items.forEach((it, i) => {
        if (!("str" in it)) return;
        const str = unradical(it.str);
        strs.set(i, str);
        if (eol && !(/[\d-]$/.test(text) && /^\d/.test(str))) { text += "\n"; owner.push(-1); index.push(0); }
        eol = false;
        for (let k = 0; k < str.length; k++) { owner.push(i); index.push(k); }
        text += str;
        if (it.hasEOL) eol = true;
      });
      chars += text.trim().length;
      for (const h of detect(text, o)) {
        const rects: Rect[] = [];
        const byItem = new Map<number, [number, number]>();
        for (let c = h.start; c < h.end; c++) {
          const i = owner[c];
          if (i < 0) continue;
          const r = byItem.get(i);
          byItem.set(i, r ? [Math.min(r[0], index[c]), Math.max(r[1], index[c] + 1)] : [index[c], index[c] + 1]);
        }
        for (const [i, [a, b]] of byItem) {
          const it = items[i];
          const [sa, sb, , sd, tx, ty] = it.transform;
          const size = Math.hypot(sb, sd) || it.height || 10;
          const len = strs.get(i)!.length || 1;
          const angle = Math.atan2(sb, sa);
          if (Math.abs(angle) > 0.01) {
            // 旋转文字：整块涂黑（宁多勿少）
            const w = it.width, hh = size * 1.25;
            const xs = [0, w].flatMap((dx) => [0, hh].map((dy) => tx + dx * Math.cos(angle) - (dy - size * 0.25) * Math.sin(angle)));
            const ys = [0, w].flatMap((dx) => [0, hh].map((dy) => ty + dx * Math.sin(angle) + (dy - size * 0.25) * Math.cos(angle)));
            rects.push({ page: p, x: Math.min(...xs) - 1, y: Math.min(...ys) - 1, w: Math.max(...xs) - Math.min(...xs) + 2, h: Math.max(...ys) - Math.min(...ys) + 2 });
            continue;
          }
          // 按字宽估算位置：全角（中日韩、全角标点）约 1em，其余约 0.55em，比等分更贴近实际
          const str = strs.get(i)!, ws = [...Array(len).keys()].map((k) => charWeight(str.charCodeAt(k)));
          const total = ws.reduce((x, y) => x + y, 0) || 1, before = ws.slice(0, a).reduce((x, y) => x + y, 0), span = ws.slice(a, b).reduce((x, y) => x + y, 0);
          // 字宽是估算的：命中在一段文字中间时，比例字体（如 Helvetica）的误差会累积，
          // 所以内侧边各多盖约 0.6em（宁多勿少），但不超出这段文字本身的范围。
          const padL = a > 0 ? size * 0.6 : 1.5, padR = b < len ? size * 0.6 : 1.5;
          const x0 = Math.max(tx - 1.5, tx + (it.width * before) / total - padL);
          const x1 = Math.min(tx + it.width + 1.5, tx + (it.width * (before + span)) / total + padR);
          rects.push({ page: p, x: x0, y: ty - size * 0.28, w: x1 - x0, h: size * 1.3 });
        }
        found.push({ ...h, loc: `p.${p}`, context: `${text.slice(Math.max(0, h.start - 18), h.start)}【${h.value}】${text.slice(h.end, h.end + 18)}`.replace(/\s+/g, " "), rects });
      }
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return { found, info: { pages, text: chars } };
}

/** 全文（自检用）。 */
export async function pdfText(buf: Uint8Array, assetRoot: string) {
  const { task, doc } = await open(buf, assetRoot);
  let pages = "", extra = "";
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      pages += ((await page.getTextContent()).items as Item[]).map((i) => i.str ?? "").join("") + "\n";
      const ann = await page.getAnnotations();
      extra += ann.map((a: { url?: string; contentsObj?: { str?: string } }) => `${a.url ?? ""} ${a.contentsObj?.str ?? ""}`).join("\n");
    }
    const meta = await doc.getMetadata();
    extra += JSON.stringify(meta.info ?? {}) + (meta.metadata ? JSON.stringify([...meta.metadata]) : "");
  } finally {
    await task.destroy();
  }
  return { pages, extra };
}

/** 由逐页图片（JPEG/PNG）组装只含图像的 PDF：没有文字层、链接、批注、附件或元数据。 */
export async function assemble(pages: { data: Uint8Array; w: number; h: number }[]) {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  for (const p of pages) {
    const img = p.data[0] === 0x89 ? await pdf.embedPng(p.data) : await pdf.embedJpg(p.data);
    const page = pdf.addPage([p.w, p.h]);
    page.drawImage(img, { x: 0, y: 0, width: p.w, height: p.h });
  }
  return pdf.save();
}
