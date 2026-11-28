import { readFile } from "node:fs/promises";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import * as fontkitModule from "fontkit";
import { readFile as readFont } from "node:fs/promises";
import { CJK_FONT_CANDIDATES, extractFace, findCjkFont } from "./fonts.ts";
import { KitError } from "./workspace.ts";

const fontkit: any = fontkitModule;

let wasmReady: Promise<void> | undefined;
/** resvg 的 wasm 随插件分发（dist/resvg.wasm）。 */
export function initRenderer(wasmPath: string) {
  wasmReady ??= readFile(wasmPath).then((bytes) => initWasm(bytes));
  return wasmReady;
}

export interface FontSet {
  path: string;
  family: string;
  boldFamily?: string;
  buffers: Uint8Array[];
  /** 文字宽度（px）。 */
  measure: (text: string, size: number, bold?: boolean) => number;
}

interface Face {
  familyName: string;
  subfamilyName: string;
  unitsPerEm: number;
  layout: (text: string) => { advanceWidth: number };
}

const faceCount = (data: Uint8Array) => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getUint32(0) === 0x74746366 ? view.getUint32(8) : 1;
};

/** 屏幕/图片渲染优先选带粗体的集合字体。 */
export const RENDER_FONT_CANDIDATES = [
  "/System/Library/Fonts/PingFang.ttc",
  "/System/Library/Fonts/Hiragino Sans GB.ttc",
  "/System/Library/Fonts/STHeiti Light.ttc",
  "/System/Library/Fonts/STHeiti Medium.ttc",
  "C:\\Windows\\Fonts\\msyh.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
  ...CJK_FONT_CANDIDATES,
];

/** 同目录下的粗体文件（Noto CJK、微软雅黑、华文黑体）。 */
const BOLD_SIBLINGS: [RegExp, string][] = [
  [/-Regular\.ttc$/, "-Bold.ttc"],
  [/msyh\.ttc$/i, "msyhbd.ttc"],
  [/STHeiti Light\.ttc$/, "STHeiti Medium.ttc"],
  [/simhei\.ttf$/i, "msyhbd.ttc"],
];

let cached: { key: string; fonts: FontSet } | undefined;

/** 载入中文字体（含同一集合里的粗体），供 SVG 渲染和排版测量使用。 */
export async function loadFonts(userPath?: string | null): Promise<FontSet> {
  const font = await findCjkFont(userPath, RENDER_FONT_CANDIDATES);
  if (cached?.key === font.path) return cached.fonts;
  const buffers: Uint8Array[] = [font.data];
  const faces: Face[] = [];
  const addFaces = (data: Uint8Array) => {
    for (let i = 0; i < Math.min(faceCount(data), 12); i++) {
      try {
        faces.push(fontkit.create(Buffer.from(extractFace(data, i))) as Face);
      } catch {
        // 跳过无法解析的字体
      }
    }
  };
  addFaces(font.data);
  for (const [pattern, replacement] of BOLD_SIBLINGS) {
    if (!pattern.test(font.path)) continue;
    try {
      const data = await readFont(font.path.replace(pattern, replacement));
      buffers.push(data);
      addFaces(data);
    } catch {
      // 没有粗体文件时用描边加粗
    }
    break;
  }
  if (!faces.length) throw new KitError("font_error", `Cannot read font ${font.path}`);
  // 集合里优先简体中文字形（如 Noto Sans CJK SC），否则用第一个。
  const regular = faces.find((f) => /\bSC\b|GB|Simplified/i.test(f.familyName) && !/bold|black|heavy|w[6-9]/i.test(f.subfamilyName)) ?? faces[0];
  const isBold = (f: Face) => f !== regular && /bold|semibold|black|heavy|w6|w7|w8/i.test(`${f.subfamilyName} ${f.familyName}`);
  const bold =
    faces.find((f) => isBold(f) && f.familyName === regular.familyName) ??
    faces.find((f) => isBold(f) && f.familyName.replace(/\s*W\d$/, "") === regular.familyName.replace(/\s*W\d$/, "")) ??
    faces.find((f) => isBold(f) && f.familyName.split(" ")[0] === regular.familyName.split(" ")[0]);
  const measureWith = (face: Face) => (text: string, size: number) => (face.layout(text).advanceWidth / face.unitsPerEm) * size;
  const regularMeasure = measureWith(regular);
  const boldMeasure = bold ? measureWith(bold) : (text: string, size: number) => regularMeasure(text, size) * 1.04;
  const fonts: FontSet = {
    path: font.path,
    family: regular.familyName,
    boldFamily: bold?.familyName,
    buffers,
    measure: (text, size, isBold) => (isBold ? boldMeasure(text, size) : regularMeasure(text, size)),
  };
  cached = { key: font.path, fonts };
  return fonts;
}

export interface RenderedPng {
  png: Uint8Array;
  width: number;
  height: number;
  pixels: Uint8Array;
}

/** SVG → PNG。width 指定输出像素宽度（按比例缩放）。 */
export async function renderSvg(svg: string, fonts: FontSet, width?: number): Promise<RenderedPng> {
  if (!wasmReady) throw new KitError("renderer", "Renderer not initialised.");
  await wasmReady;
  const resvg = new Resvg(svg, {
    font: { fontBuffers: fonts.buffers, defaultFontFamily: fonts.family, sansSerifFamily: fonts.family },
    fitTo: width ? { mode: "width", value: Math.round(width) } : { mode: "original" },
    shapeRendering: 2,
    textRendering: 1,
    imageRendering: 0,
  });
  try {
    const image = resvg.render();
    const result = { png: image.asPng(), width: image.width, height: image.height, pixels: image.pixels };
    image.free();
    return result;
  } finally {
    resvg.free();
  }
}

export function escapeXml(text: string) {
  return text.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** 按宽度断行：英文按词，中文按字；超过 maxLines 时末行加省略号并标记 overflow。 */
export function wrapLines(text: string, maxWidth: number, measure: (t: string) => number, maxLines = 99): { lines: string[]; overflow: boolean } {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const tokens = paragraph.match(/[A-Za-z0-9@._%+\-'’!?,;:)]+\s*|\s+|./gu) ?? [""];
    let line = "";
    for (const token of tokens) {
      const next = line + token;
      if (line && measure(next.trimEnd()) > maxWidth) {
        lines.push(line.trimEnd());
        line = token.trimStart();
        // 中文标点不放行首。
        if (/^[，。、；：！？）」』”’,.;:!?)]/.test(line) && lines.length) {
          lines[lines.length - 1] += line[0];
          line = line.slice(1);
        }
      } else line = next;
    }
    lines.push(line.trimEnd());
    // 避免最后一行只剩一个汉字。
    const n = lines.length;
    if (n >= 2 && [...lines[n - 1]].length === 1 && /\p{Script=Han}/u.test(lines[n - 1]) && [...lines[n - 2]].length > 3) {
      const prev = [...lines[n - 2]];
      const moved = prev.pop()!;
      if (/\p{Script=Han}/u.test(moved)) {
        lines[n - 2] = prev.join("").trimEnd();
        lines[n - 1] = moved + lines[n - 1];
      }
    }
  }
  if (lines.length <= maxLines) return { lines, overflow: false };
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last && measure(`${last}…`) > maxWidth) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last}…`;
  return { lines: kept, overflow: true };
}

/** 在框里放下文字的最大字号（不小于 minSize）。 */
export function fitTextBlock(text: string, box: { width: number; height: number }, options: { size: number; minSize: number; lineHeight?: number; maxLines?: number }, measure: (t: string, size: number) => number) {
  const lineHeight = options.lineHeight ?? 1.25;
  for (let size = options.size; size >= options.minSize; size -= Math.max(1, Math.round(size * 0.04))) {
    const { lines, overflow } = wrapLines(text, box.width, (t) => measure(t, size), options.maxLines);
    if (!overflow && lines.length * size * lineHeight <= box.height) return { size, lines, overflow: false };
  }
  const size = options.minSize;
  const maxLines = Math.max(1, Math.min(options.maxLines ?? 99, Math.floor(box.height / (size * lineHeight))));
  const { lines } = wrapLines(text, box.width, (t) => measure(t, size), maxLines);
  return { size, lines, overflow: true };
}

/** 生成多行 <text>：x 为对齐基准点，y 为第一行顶部。 */
export function textSvg(lines: string[], options: { x: number; y: number; size: number; color: string; family: string; weight?: number; anchor?: "start" | "middle" | "end"; lineHeight?: number; boldStroke?: boolean }) {
  const lineHeight = options.lineHeight ?? 1.25;
  const stroke = options.boldStroke ? ` stroke="${options.color}" stroke-width="${(options.size * 0.035).toFixed(2)}" stroke-linejoin="round"` : "";
  return lines
    .map((line, i) => {
      const baseline = options.y + options.size * (0.88 + i * lineHeight);
      return `<text x="${options.x.toFixed(1)}" y="${baseline.toFixed(1)}" font-family="${escapeXml(options.family)}" font-size="${options.size}" font-weight="${options.weight ?? 400}" fill="${options.color}" text-anchor="${options.anchor ?? "start"}"${stroke}>${escapeXml(line)}</text>`;
    })
    .join("");
}
