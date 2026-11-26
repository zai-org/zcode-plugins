import { decodeImage, encodeJpeg, resize } from "./kit/raster.ts";
import { esc } from "./kit/app.ts";
import { newPdf, type PdfKit } from "./kit/pdf.ts";
import { KitError } from "./kit/workspace.ts";

export interface Box { template: string; x: number; y: number; size: number; color: string; align: "left" | "center" | "right"; bold: boolean; maxWidth: number; line: number }

export const DEFAULT_LAYOUT = `# 文字 | 横向位置% | 纵向位置% | 字号 | 颜色 | 对齐 left/center/right | bold | 最大宽度%
# text | x% | y% | size | colour | align | bold | max width %
荣誉证书 CERTIFICATE | 50 | 12.5 | 34 | #8a6d3b | center | bold | 70
{姓名} | 50 | 40 | 44 | #1f2937 | center | bold | 70
在 2026 年度工作中表现突出，荣获 | 50 | 52 | 16 | #4b5563 | center | | 80
{奖项} | 50 | 61 | 26 | #b91c1c | center | bold | 75
{日期} | 82 | 88 | 12 | #6b7280 | right | | 30`;

export function parseLayout(text: string) {
  const boxes: Box[] = [];
  const bad: string[] = [];
  String(text ?? "").split(/\r?\n/).forEach((raw, line) => {
    const t = raw.trim();
    if (!t || t.startsWith("#")) return;
    const p = t.split("|").map((s) => s.trim());
    const x = Number(p[1]), y = Number(p[2]), size = Number(p[3] || 16);
    if (p.length < 3 || !p[0] || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(size)) { bad.push(t); return; }
    const align = (["left", "center", "right"].includes(p[5]) ? p[5] : "center") as Box["align"];
    boxes.push({ template: p[0], x, y, size, color: /^#[0-9a-f]{6}$/i.test(p[4] ?? "") ? p[4] : "#111827", align, bold: /bold|粗/i.test(p[6] ?? ""), maxWidth: Number(p[7]) || 80, line: line + 1 });
  });
  return { boxes, bad };
}

export const fields = (boxes: Box[]) => [...new Set(boxes.flatMap((b) => [...b.template.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1].trim())))];
export const fill = (t: string, row: Record<string, unknown>) => t.replace(/\{([^{}]+)\}/g, (_, k: string) => String(row[k.trim()] ?? ""));

export function pageSize(img: { width: number; height: number }) {
  const landscape = img.width >= img.height;
  const w = landscape ? 841.89 : 595.28;
  return { w, h: (w * img.height) / img.width };
}

let measureKit: Promise<PdfKit> | undefined;
export function measurer() {
  return (measureKit ??= newPdf());
}

/** 文字太长时缩小字号，直到放进最大宽度（最小缩到 45%）。 */
export function fitSize(k: PdfKit, text: string, box: Box, pageW: number) {
  const max = (pageW * box.maxWidth) / 100;
  let size = box.size;
  while (size > box.size * 0.45 && k.width(text, size, box.bold) > max) size -= 0.5;
  return { size, overflow: k.width(text, size, box.bold) > max };
}

export function readBackground(bytes: Uint8Array, name: string) {
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!isPng && !isJpg) throw new KitError("bad_image", `${name}: use a PNG or JPG background.`);
  const img = decodeImage(bytes, name);
  return { img, kind: isPng ? ("png" as const) : ("jpg" as const) };
}

export function previewSvg(bg: Uint8Array, name: string, boxes: Box[], row: Record<string, unknown>, k: PdfKit) {
  const { img } = readBackground(bg, name);
  const { w, h } = pageSize(img);
  const small = resize(img, 900, Math.round((900 * img.height) / img.width));
  const data = `data:image/jpeg;base64,${encodeJpeg(small, 80).toString("base64")}`;
  const texts = boxes.map((b) => {
    const t = fill(b.template, row);
    const { size } = fitSize(k, t, b, w);
    const x = (w * b.x) / 100, y = (h * b.y) / 100;
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" fill="${b.color}" font-weight="${b.bold ? 700 : 400}" text-anchor="${b.align === "center" ? "middle" : b.align === "right" ? "end" : "start"}" dominant-baseline="middle" font-family="'PingFang SC','Noto Sans CJK SC','Microsoft YaHei',sans-serif">${esc(t)}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(1)} ${h.toFixed(1)}" style="width:100%;border:1px solid #ddd"><image href="${data}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"/>${texts.join("")}</svg>`;
}

export async function renderPdf(bg: Uint8Array, name: string, boxes: Box[], rows: Record<string, unknown>[]) {
  const { img, kind } = readBackground(bg, name);
  const { w, h } = pageSize(img);
  const k = await newPdf();
  const image = kind === "png" ? await k.doc.embedPng(bg) : await k.doc.embedJpg(bg);
  for (const row of rows) {
    const page = k.doc.addPage([w, h]);
    page.drawImage(image, { x: 0, y: 0, width: w, height: h });
    for (const b of boxes) {
      const t = fill(b.template, row);
      const { size } = fitSize(k, t, b, w);
      // 与预览一致：y 是文字垂直中线的位置
      k.text(page, t, (w * b.x) / 100, h - (h * b.y) / 100 - size * 0.35, { size, bold: b.bold, color: b.color, align: b.align });
    }
  }
  return { bytes: await k.doc.save(), cjk: k.cjk };
}
