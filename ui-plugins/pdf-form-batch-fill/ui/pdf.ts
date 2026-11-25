import * as pdfjs from "pdfjs-dist";
import * as pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs";
import { readBlob } from "./kit.ts";

// 沙箱页面不能另起 worker 文件：worker 在主线程运行。
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

const PREFIX = "ui://pdf-form-batch-fill/pdfjs";
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

/** 渲染一页到 canvas；scale = CSS 像素 / pt。 */
export async function renderPage(doc: PdfDoc, index: number, canvas: HTMLCanvasElement, scale: number) {
  const page = await doc.getPage(index + 1);
  const ratio = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale: scale * ratio });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
  canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
  // 不渲染表单控件本身，用我们自己的覆盖层标出字段位置。
  await page.render({ canvas, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
}
