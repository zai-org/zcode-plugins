import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { buildPage, type PageText, type TextItem } from "#t/domain/text.ts";

// 在主线程运行 pdf.js 的 worker 部分（Node 中没有 Web Worker，打包后也没有独立 worker 文件）。
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

/**
 * pdf.js 的 CMap 与标准字体数据目录。打包后位于 dist/pdfjs；源码运行（测试）时取 node_modules。
 * 返回以路径分隔符结尾的目录，或 null。
 */
export function pdfjsDataDir(hint?: string): string | null {
  const candidates: string[] = [];
  if (hint) candidates.push(hint);
  try {
    const require = createRequire(import.meta.url);
    candidates.push(dirname(require.resolve("pdfjs-dist/package.json")));
  } catch {
    // 打包后没有 node_modules。
  }
  for (const candidate of candidates) if (existsSync(join(candidate, "cmaps"))) return resolve(candidate) + sep;
  return null;
}

function open(data: Uint8Array, dataDir: string | null) {
  // pdf.js 会转移（detach）传入的缓冲区，所以传一份拷贝。
  return pdfjs.getDocument({
    data: new Uint8Array(data),
    ...(dataDir ? { cMapUrl: `${dataDir}cmaps${sep}`, cMapPacked: true, standardFontDataUrl: `${dataDir}standard_fonts${sep}` } : {}),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
}

export async function pageCount(data: Uint8Array): Promise<number> {
  const task = open(data, null);
  try {
    return (await task.promise).numPages;
  } finally {
    await task.destroy();
  }
}

/** 逐页文本与文本项几何（用于在预览中定位文字）。 */
export async function extractPages(data: Uint8Array, dataDir: string | null): Promise<PageText[]> {
  const task = open(data, dataDir);
  try {
    const doc = await task.promise;
    const labels = await doc.getPageLabels().catch(() => null);
    const pages: PageText[] = [];
    for (let index = 0; index < doc.numPages; index++) {
      const page = await doc.getPage(index + 1);
      const [x1, y1, x2, y2] = page.view as [number, number, number, number];
      const content = await page.getTextContent();
      pages.push(
        buildPage(content.items as TextItem[], {
          index,
          label: labels?.[index] || String(index + 1),
          width: x2 - x1,
          height: y2 - y1,
          originX: x1,
          originY: y1,
        }),
      );
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
