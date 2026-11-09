import * as pdfjs from "pdfjs-dist";
import * as pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { URIS, type LibraryId, type PdfInfo, type Rect } from "#z/contract.ts";
import { host } from "#ui/bridge.ts";

// 面板运行在沙箱 iframe 中，不能另起 worker 文件：worker 部分在主线程运行。
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

/** CMap、标准字体与 wasm 经插件资源读取（面板没有网络）。 */
class ResourceDataFactory {
  constructor(_options: unknown) {}
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    return host.readBlob(URIS.pdfjsData(kind, filename));
  }
}

export type { PDFDocumentProxy };
export const { TextLayer } = pdfjs;

export interface LoadedPdf {
  info: PdfInfo;
  doc: PDFDocumentProxy;
  /** 页面标签（印刷页码）；没有时为 null。 */
  labels: string[] | null;
  destroy: () => Promise<void>;
}

/** 已打开文档的小缓存：返回上一页或在条目间来回时不重新传输。 */
const cache = new Map<string, Promise<LoadedPdf>>();

export function loadPdf(library: LibraryId, attachmentKey: string, onProgress: (done: number, total: number) => void): Promise<LoadedPdf> {
  const id = `${library}/${attachmentKey}`;
  const cached = cache.get(id);
  if (cached) return cached;
  const promise = (async () => {
    const info = await host.readJson<PdfInfo>(URIS.pdfInfo(library, attachmentKey));
    const data = new Uint8Array(info.bytes);
    let offset = 0;
    onProgress(0, info.parts);
    for (let part = 0; part < info.parts; part++) {
      const chunk = await host.readBlob(URIS.pdfPart(library, attachmentKey, part));
      data.set(chunk, offset);
      offset += chunk.length;
      onProgress(part + 1, info.parts);
    }
    if (offset !== info.bytes) throw new Error(`Received ${offset} of ${info.bytes} bytes.`);
    const task = pdfjs.getDocument({
      data,
      BinaryDataFactory: ResourceDataFactory,
      useWorkerFetch: false,
      cMapUrl: "zotero:cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "zotero:standard_fonts/",
      wasmUrl: "zotero:wasm/",
      // 不按 URL 加载系统字体（面板 CSP 禁止）；标准字体数据经资源读取后以二进制 FontFace 加载。
      useSystemFonts: false,
      enableXfa: false,
      verbosity: 0,
    } as Parameters<typeof pdfjs.getDocument>[0]);
    const doc = await task.promise;
    const labels = await doc.getPageLabels().catch(() => null);
    return { info, doc, labels, destroy: () => task.destroy() };
  })();
  cache.set(id, promise);
  promise.catch(() => cache.delete(id));
  while (cache.size > 3) {
    const oldest = cache.keys().next().value!;
    const entry = cache.get(oldest);
    cache.delete(oldest);
    void entry?.then((loaded) => loaded.destroy()).catch(() => undefined);
  }
  return promise;
}

/** PDF 用户空间矩形到视口 CSS 像素矩形。 */
export function toViewport(viewport: { convertToViewportPoint: (x: number, y: number) => number[] }, rect: Rect) {
  const [x1, y1] = viewport.convertToViewportPoint(rect[0], rect[1]) as [number, number];
  const [x2, y2] = viewport.convertToViewportPoint(rect[2], rect[3]) as [number, number];
  return { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}
