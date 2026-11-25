import { readFile, stat } from "node:fs/promises";
import { KitError } from "./workspace.ts";

/** 常见系统中文字体。TrueType 优先（PDF 子集嵌入最稳定），然后是集合字体。 */
export const CJK_FONT_CANDIDATES = [
  // macOS
  "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
  "/Library/Fonts/Arial Unicode.ttf",
  "/System/Library/Fonts/Hiragino Sans GB.ttc",
  "/System/Library/Fonts/STHeiti Medium.ttc",
  "/System/Library/Fonts/STHeiti Light.ttc",
  "/System/Library/Fonts/PingFang.ttc",
  // Windows
  "C:\\Windows\\Fonts\\simhei.ttf",
  "C:\\Windows\\Fonts\\msyh.ttc",
  "C:\\Windows\\Fonts\\simsun.ttc",
  // Linux
  "/usr/share/fonts/truetype/arphic/uming.ttc",
  "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
];

export interface LoadedFont {
  path: string;
  /** 原始文件（可能是 .ttc 集合）。 */
  data: Buffer;
}

const cache = new Map<string, LoadedFont>();

/** 用户指定的字体优先，否则按候选列表找第一个存在的中文字体。 */
export async function findCjkFont(userPath?: string | null): Promise<LoadedFont> {
  const configured = userPath?.trim() && !userPath.includes("${") ? userPath.trim() : undefined;
  const list = configured ? [configured, ...CJK_FONT_CANDIDATES] : CJK_FONT_CANDIDATES;
  for (const path of list) {
    if (cache.has(path)) return cache.get(path)!;
    try {
      if (!(await stat(path)).isFile()) continue;
      const font = { path, data: await readFile(path) };
      cache.set(path, font);
      return font;
    } catch {
      // 继续查找
    }
  }
  throw new KitError(
    "font_not_found",
    "No Chinese-capable font was found. Set the plugin's fontPath setting to a .ttf/.otf/.ttc font file (for example Arial Unicode.ttf, Microsoft YaHei or Noto Sans CJK).",
  );
}

/** 从 .ttc 字体集合中取出第 index 个字体，组成独立的 sfnt 文件（pdf-lib 只能嵌入单个字体）。 */
export function extractFace(data: Uint8Array, index = 0): Uint8Array {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0) !== 0x74746366) return data; // 不是 'ttcf'
  const count = view.getUint32(8);
  if (index >= count) throw new KitError("font_error", `Font collection has ${count} faces.`);
  const offset = view.getUint32(12 + index * 4);
  const numTables = view.getUint16(offset + 4);
  const tables: { tag: number; checksum: number; start: number; length: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    const record = offset + 12 + i * 16;
    tables.push({ tag: view.getUint32(record), checksum: view.getUint32(record + 4), start: view.getUint32(record + 8), length: view.getUint32(record + 12) });
  }
  const headerSize = 12 + numTables * 16;
  let total = headerSize;
  for (const table of tables) total += (table.length + 3) & ~3;
  const out = new Uint8Array(total);
  const outView = new DataView(out.buffer);
  out.set(data.subarray(offset, offset + 12), 0);
  let cursor = headerSize;
  tables.forEach((table, i) => {
    const record = 12 + i * 16;
    outView.setUint32(record, table.tag);
    outView.setUint32(record + 4, table.checksum);
    outView.setUint32(record + 8, cursor);
    outView.setUint32(record + 12, table.length);
    out.set(data.subarray(table.start, table.start + table.length), cursor);
    cursor += (table.length + 3) & ~3;
  });
  return out;
}

/** PDF 用字体：单个字体（集合取第一个），配合 fontkit 2 子集化嵌入。 */
export async function findPdfFont(userPath?: string | null): Promise<{ path: string; face: Uint8Array; subset: boolean }> {
  const font = await findCjkFont(userPath);
  return { path: font.path, face: extractFace(font.data, 0), subset: true };
}
