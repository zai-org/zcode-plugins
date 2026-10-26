import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { LIMITS, ZoteroError } from "#z/contract.ts";
import { buildPage, type PageText, type TextItem } from "#z/domain/text.ts";

// 在主线程运行 pdf.js 的 worker 部分（Node 中没有 Web Worker，打包后也没有独立 worker 文件）。
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

/**
 * pdf.js 的 CMap 与标准字体数据目录。打包后位于 dist/pdfjs；源码运行（测试）时取 node_modules。
 * 返回以路径分隔符结尾的目录，或 null（缺少时 CJK 等 CID 字体的文本可能无法提取）。
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

/**
 * getDocument 的 CMap 与标准字体地址。pdf.js 要求它们以 "/" 结尾，不接受 Windows 的 "\"；
 * Node 中 pdf.js 直接用 fs 读取 `地址 + 文件名`，Windows 也接受混用的分隔符。
 */
export function pdfjsFactoryUrls(dataDir: string) {
  return { cMapUrl: `${dataDir}cmaps/`, standardFontDataUrl: `${dataDir}standard_fonts/` };
}

export interface PdfText {
  pageCount: number;
  pages: PageText[];
  sha256: string;
  bytes: number;
}

export async function extractPdf(data: Uint8Array, dataDir: string | null): Promise<PdfText> {
  const sha256 = createHash("sha256").update(data).digest("hex");
  // pdf.js 会转移（detach）传入的缓冲区，所以传一份拷贝。
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    ...(dataDir ? { ...pdfjsFactoryUrls(dataDir), cMapPacked: true } : {}),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "PasswordException") throw new ZoteroError("not_pdf", "The PDF is password-protected.");
    throw new ZoteroError("not_pdf", `Could not read the PDF: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
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
    return { pageCount: doc.numPages, pages, sha256, bytes: data.length };
  } finally {
    await task.destroy();
  }
}

/** 已解析 PDF 的 LRU 缓存，按文件路径 + 修改时间 + 大小失效。 */
export class PdfStore {
  private cache = new Map<string, { stamp: string; text: Promise<PdfText>; bytes?: Uint8Array }>();

  constructor(
    private readonly dataDir: string | null,
    private readonly capacity: number = LIMITS.pdfCache,
  ) {}

  private async stamp(path: string) {
    const info = await stat(path).catch(() => {
      throw new ZoteroError("file_missing", `The attachment file is missing on disk (${path}). It may not have been synced or downloaded yet.`);
    });
    if (info.size > LIMITS.pdfBytes)
      throw new ZoteroError("not_pdf", `The PDF is too large (${Math.round(info.size / 1024 / 1024)} MB).`);
    return `${info.mtimeMs}:${info.size}`;
  }

  async bytes(path: string): Promise<Uint8Array> {
    const stamp = await this.stamp(path);
    const entry = this.cache.get(path);
    if (entry?.stamp === stamp && entry.bytes) return entry.bytes;
    const data = new Uint8Array(await readFile(path));
    if (!isPdf(data)) throw new ZoteroError("not_pdf", "The attachment file is not a PDF.");
    if (entry?.stamp === stamp) entry.bytes = data;
    else this.remember(path, { stamp, text: extractPdf(data, this.dataDir), bytes: data });
    return data;
  }

  async text(path: string): Promise<PdfText> {
    const stamp = await this.stamp(path);
    const entry = this.cache.get(path);
    if (entry?.stamp === stamp) {
      this.cache.delete(path);
      this.cache.set(path, entry);
      return entry.text;
    }
    const data = new Uint8Array(await readFile(path));
    if (!isPdf(data)) throw new ZoteroError("not_pdf", "The attachment file is not a PDF.");
    const text = extractPdf(data, this.dataDir);
    this.remember(path, { stamp, text, bytes: data });
    text.catch(() => this.cache.delete(path));
    return text;
  }

  private remember(path: string, entry: { stamp: string; text: Promise<PdfText>; bytes?: Uint8Array }) {
    entry.text.catch(() => undefined);
    this.cache.delete(path);
    this.cache.set(path, entry);
    while (this.cache.size > this.capacity) this.cache.delete(this.cache.keys().next().value!);
  }
}

export function isPdf(data: Uint8Array): boolean {
  // %PDF- 可能出现在文件开头 1 KB 内。
  const head = Buffer.from(data.subarray(0, 1024)).toString("latin1");
  return head.includes("%PDF-");
}
