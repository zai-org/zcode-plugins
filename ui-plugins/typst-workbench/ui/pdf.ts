import * as pdfjs from "pdfjs-dist";
import * as pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { URIS, type Rect, type SnapshotInfo } from "#t/contract.ts";
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
export type PDFPageProxy = Awaited<ReturnType<PDFDocumentProxy["getPage"]>>;
export type PageViewport = ReturnType<PDFPageProxy["getViewport"]>;
export const { TextLayer } = pdfjs;

export interface PageSize {
  width: number;
  height: number;
}

export interface LoadedPreview {
  seq: number;
  doc: PDFDocumentProxy;
  sizes: PageSize[];
  destroy: () => Promise<void>;
}

/** 读取一份快照：分块并行读取，打开文档并量出每页尺寸。 */
export async function loadPreview(info: SnapshotInfo): Promise<LoadedPreview> {
  const chunks = await Promise.all(Array.from({ length: info.parts }, (_, part) => host.readBlob(URIS.pdfPart(info.seq, part))));
  const data = new Uint8Array(info.bytes);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  if (offset !== info.bytes) throw new Error(`Received ${offset} of ${info.bytes} bytes.`);
  const task = pdfjs.getDocument({
    data,
    BinaryDataFactory: ResourceDataFactory,
    useWorkerFetch: false,
    cMapUrl: "typst:cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "typst:standard_fonts/",
    wasmUrl: "typst:wasm/",
    // 不按 URL 加载系统字体（面板 CSP 禁止）；Typst 的 PDF 内嵌全部字体。
    useSystemFonts: false,
    enableXfa: false,
    verbosity: 0,
  } as Parameters<typeof pdfjs.getDocument>[0]);
  const doc = await task.promise;
  const sizes: PageSize[] = [];
  for (let index = 1; index <= doc.numPages; index++) {
    const page = await doc.getPage(index);
    const viewport = page.getViewport({ scale: 1 });
    sizes.push({ width: viewport.width, height: viewport.height });
  }
  return { seq: info.seq, doc, sizes, destroy: () => task.destroy() };
}

export interface OutlineEntry {
  title: string;
  depth: number;
  pageIndex: number;
  /** 距页顶（scale 1，pt）。 */
  top?: number;
}

/** PDF 书签（Typst 为标题生成）展开为带层级的列表。 */
export async function loadOutline(preview: LoadedPreview): Promise<OutlineEntry[]> {
  const outline = await preview.doc.getOutline().catch(() => null);
  if (!outline) return [];
  const entries: OutlineEntry[] = [];
  const walk = async (items: typeof outline, depth: number) => {
    for (const item of items) {
      try {
        const dest = typeof item.dest === "string" ? await preview.doc.getDestination(item.dest) : item.dest;
        if (Array.isArray(dest) && dest[0]) {
          const pageIndex = typeof dest[0] === "number" ? dest[0] : await preview.doc.getPageIndex(dest[0]);
          const size = preview.sizes[pageIndex];
          // [ref, {name: "XYZ"}, left, top, zoom]：top 为 PDF 坐标（原点左下）。
          const y = (dest[1] as { name?: string } | undefined)?.name === "XYZ" && typeof dest[3] === "number" ? dest[3] : undefined;
          entries.push({ title: item.title, depth, pageIndex, top: size && y !== undefined ? Math.max(0, size.height - y) : undefined });
        }
      } catch {
        // 无法解析的书签跳过。
      }
      if (item.items?.length) await walk(item.items, depth + 1);
    }
  };
  await walk(outline, 0);
  return entries;
}

/** PDF 用户空间矩形到视口 CSS 像素矩形。 */
export function toViewport(viewport: { convertToViewportPoint: (x: number, y: number) => number[] }, rect: Rect) {
  const [x1, y1] = viewport.convertToViewportPoint(rect[0], rect[1]) as [number, number];
  const [x2, y2] = viewport.convertToViewportPoint(rect[2], rect[3]) as [number, number];
  return { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}
