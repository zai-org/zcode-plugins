import { readFile } from "node:fs/promises";
import * as fontkitModule from "fontkit";
import { extractFace, findCjkFont } from "./fonts.ts";

const fontkit: any = fontkitModule;

const faceCount = (data: Uint8Array) => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getUint32(0) === 0x74746366 ? view.getUint32(8) : 1;
};

/** 在字体集合里挑一个字体：优先简体中文，然后按字重匹配。 */
function pickFace(data: Uint8Array, bold: boolean): Uint8Array | undefined {
  const faces: { face: Uint8Array; family: string; sub: string }[] = [];
  for (let i = 0; i < Math.min(faceCount(data), 16); i++) {
    try {
      const face = extractFace(data, i);
      const font = fontkit.create(Buffer.from(face));
      faces.push({ face, family: String(font.familyName ?? ""), sub: String(font.subfamilyName ?? "") });
    } catch {
      // 跳过
    }
  }
  const isBold = (f: { family: string; sub: string }) => /bold|semibold|w6|w7|w8|heavy|black|medium/i.test(`${f.sub} ${f.family}`);
  const pool = faces.filter((f) => isBold(f) === bold);
  const list = pool.length ? pool : bold ? [] : faces;
  return (list.find((f) => /\bSC\b|GB|Simplified/i.test(f.family)) ?? list[0])?.face;
}

const BOLD_CANDIDATES = [
  "/System/Library/Fonts/Hiragino Sans GB.ttc",
  "/System/Library/Fonts/STHeiti Medium.ttc",
  "C:\\Windows\\Fonts\\msyhbd.ttc",
  "C:\\Windows\\Fonts\\simhei.ttf",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
  "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc",
  "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Bold.ttc",
];

/** PDF 正文字体 + （能找到的话）粗体。用户指定字体时只用该字体。 */
export async function findPdfFonts(userPath?: string | null): Promise<{ path: string; regular: Uint8Array; bold?: Uint8Array; boldPath?: string }> {
  const font = await findCjkFont(userPath);
  const regular = pickFace(font.data, false) ?? extractFace(font.data, 0);
  const configured = userPath?.trim() && !userPath.includes("${");
  if (configured) return { path: font.path, regular };
  const same = pickFace(font.data, true);
  if (same) return { path: font.path, regular, bold: same, boldPath: font.path };
  for (const path of BOLD_CANDIDATES) {
    try {
      const data = await readFile(path);
      const bold = pickFace(data, true) ?? (/simhei/i.test(path) ? extractFace(data, 0) : undefined);
      if (bold) return { path: font.path, regular, bold, boldPath: path };
    } catch {
      // 继续
    }
  }
  return { path: font.path, regular };
}
