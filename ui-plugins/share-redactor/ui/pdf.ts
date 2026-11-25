import * as pdfjs from "pdfjs-dist";
import * as pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs";
import { readBlob } from "./kit.ts";

// 沙箱页面不能另起 worker 文件：worker 在主线程运行。
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

const PREFIX = "ui://share-redactor/pdfjs";
class ResourceDataFactory {
  constructor(_options: unknown) {}
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    return readBlob(`${PREFIX}/${kind}/${filename}`);
  }
}

export type PdfDoc = Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;

export async function openPdf(data: Uint8Array): Promise<PdfDoc> {
  const task = pdfjs.getDocument({
    data,
    BinaryDataFactory: ResourceDataFactory,
    useWorkerFetch: false,
    cMapUrl: "pdf:cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "pdf:fonts/",
    wasmUrl: "pdf:wasm/",
    useSystemFonts: false,
    enableXfa: false,
    verbosity: 0,
  } as Parameters<typeof pdfjs.getDocument>[0]);
  return task.promise;
}

export interface Box { x: number; y: number; w: number; h: number } // PDF 坐标（左下原点）

/** 渲染一页；scale = 像素 / pt。返回 viewport，用来把 PDF 坐标换算到画布。 */
export async function renderPage(doc: PdfDoc, page: number, canvas: HTMLCanvasElement, scale: number, ratio = 1) {
  const p = await doc.getPage(page);
  const viewport = p.getViewport({ scale: scale * ratio });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  // 表单控件和批注也画进页面（它们本身也可能含个人信息，导出后都只剩像素）
  await p.render({ canvas, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS }).promise;
  return viewport;
}

/** PDF 矩形 → 画布像素矩形（考虑页面旋转）。 */
export function toCanvas(viewport: { convertToViewportPoint(x: number, y: number): number[] }, b: Box) {
  const [a, c] = viewport.convertToViewportPoint(b.x, b.y);
  const [d, e] = viewport.convertToViewportPoint(b.x + b.w, b.y + b.h);
  return { x: Math.min(a, d), y: Math.min(c, e), w: Math.abs(d - a), h: Math.abs(e - c) };
}
export function toPdf(viewport: { convertToPdfPoint(x: number, y: number): number[] }, r: { x: number; y: number; w: number; h: number }): Box {
  const [x0, y0] = viewport.convertToPdfPoint(r.x, r.y);
  const [x1, y1] = viewport.convertToPdfPoint(r.x + r.w, r.y + r.h);
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}
