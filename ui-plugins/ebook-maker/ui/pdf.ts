import * as pdfjs from "pdfjs-dist";
import * as pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs";
import { readBlob } from "./kit.ts";

// 沙箱页面不能另起 worker 文件：worker 在主线程运行。
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

const PREFIX = "ui://ebook-maker/pdfjs";
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


/** 渲染一页；scale = 像素 / pt。返回 viewport，用来把 PDF 坐标换算到画布。 */
export async function renderPage(doc: PdfDoc, page: number, canvas: HTMLCanvasElement, scale: number, ratio = 1) {
  const p = await doc.getPage(page);
  const viewport = p.getViewport({ scale: scale * ratio });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await p.render({ canvas, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
  return viewport;
}
