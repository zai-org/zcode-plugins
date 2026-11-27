import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync, deflateSync } from "node:zlib";

/** HarfBuzz hb-subset (harfbuzzjs 的 wasm)：打包后在 dist/ 旁边，开发/测试时从依赖里找。 */
type HB = Record<string, any>;
let hb: Promise<HB> | undefined;
export function harfbuzz(assetRoot: string) {
  hb ??= (async () => {
    let p = join(assetRoot, "hb-subset.wasm");
    if (!existsSync(p)) p = createRequire(import.meta.url).resolve("harfbuzzjs/dist/harfbuzz-subset.wasm");
    const { instance } = await WebAssembly.instantiate(await readFile(p));
    return instance.exports as HB;
  })();
  return hb;
}

const HB_SUBSET_FLAGS_NO_HINTING = 0x1;

/** 用 hb-subset 只保留给定码位的字形（连同 GSUB/GPOS 用到的变体、可变字体轴），返回 sfnt。 */
export async function subsetFont(assetRoot: string, font: Uint8Array, face: number, codepoints: Iterable<number>, opts: { dropHinting?: boolean } = {}): Promise<Uint8Array> {
  const e = await harfbuzz(assetRoot);
  const p = e.malloc(font.byteLength);
  new Uint8Array(e.memory.buffer).set(font, p);
  const blob = e.hb_blob_create(p, font.byteLength, 2, 0, 0);
  const hface = e.hb_face_create(blob, face);
  e.hb_blob_destroy(blob);
  const input = e.hb_subset_input_create_or_fail();
  try {
    if (!input) throw new Error("hb_subset_input_create_or_fail");
    const set = e.hb_subset_input_unicode_set(input);
    for (const cp of codepoints) e.hb_set_add(set, cp);
    if (opts.dropHinting) e.hb_subset_input_set_flags(input, HB_SUBSET_FLAGS_NO_HINTING);
    const sub = e.hb_subset_or_fail(hface, input);
    if (!sub) throw new Error("HarfBuzz could not subset this font.");
    const rb = e.hb_face_reference_blob(sub);
    const off = e.hb_blob_get_data(rb, 0), len = e.hb_blob_get_length(rb);
    const out = new Uint8Array(e.memory.buffer).slice(off, off + len);
    e.hb_blob_destroy(rb);
    e.hb_face_destroy(sub);
    if (!len) throw new Error("HarfBuzz returned an empty font.");
    return out;
  } finally {
    if (input) e.hb_subset_input_destroy(input);
    e.hb_face_destroy(hface);
    e.free(p);
  }
}

/* ---------- sfnt helpers ---------- */

export interface SfntTable { tag: string; checksum: number; offset: number; length: number }
export function faceOffsets(buf: Uint8Array): number[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (String.fromCharCode(...buf.subarray(0, 4)) !== "ttcf") return [0];
  const n = dv.getUint32(8);
  return Array.from({ length: n }, (_, i) => dv.getUint32(12 + i * 4));
}
export function tables(buf: Uint8Array, at = 0): SfntTable[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), n = dv.getUint16(at + 4), out: SfntTable[] = [];
  for (let i = 0; i < n; i++) {
    const o = at + 12 + i * 16;
    out.push({ tag: String.fromCharCode(...buf.subarray(o, o + 4)), checksum: dv.getUint32(o + 4), offset: dv.getUint32(o + 8), length: dv.getUint32(o + 12) });
  }
  return out;
}
/** OS/2 里的嵌入许可、字重、斜体。 */
export function os2(buf: Uint8Array, at = 0) {
  const t = tables(buf, at).find((x) => x.tag === "OS/2");
  if (!t) return { fsType: 0, weight: 400, italic: false };
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { fsType: dv.getUint16(t.offset + 8), weight: dv.getUint16(t.offset + 4), italic: (dv.getUint16(t.offset + 62) & 1) === 1 };
}
export const isVariable = (buf: Uint8Array, at = 0) => tables(buf, at).some((t) => t.tag === "fvar");
/** 嵌入许可：2 = Restricted（不得嵌入），4 = 仅预览打印，8 = 可编辑嵌入；0 = 可安装。 */
export function embedding(fsType: number): "installable" | "restricted" | "preview" | "editable" {
  if (fsType & 0x0002 && !(fsType & 0x000c)) return "restricted";
  if (fsType & 0x0008) return "editable";
  if (fsType & 0x0004) return "preview";
  return "installable";
}

/* ---------- WOFF 1.0 (zlib) ---------- */

export function isWoff(buf: Uint8Array) { return String.fromCharCode(...buf.subarray(0, 4)) === "wOFF"; }
export function isWoff2(buf: Uint8Array) { return String.fromCharCode(...buf.subarray(0, 4)) === "wOF2"; }

const pad4 = (n: number) => (n + 3) & ~3;

/** WOFF 1.0 → sfnt。 */
export function woffToSfnt(buf: Uint8Array): Uint8Array {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const flavor = dv.getUint32(4), n = dv.getUint16(12);
  const items: { tag: Uint8Array; data: Uint8Array; checksum: number }[] = [];
  for (let i = 0; i < n; i++) {
    const o = 44 + i * 20, off = dv.getUint32(o + 4), comp = dv.getUint32(o + 8), orig = dv.getUint32(o + 12);
    const raw = buf.subarray(off, off + comp);
    items.push({ tag: buf.subarray(o, o + 4), data: comp < orig ? new Uint8Array(inflateSync(raw)) : raw, checksum: dv.getUint32(o + 16) });
  }
  return buildSfnt(flavor, items);
}

function buildSfnt(flavor: number, items: { tag: Uint8Array; data: Uint8Array; checksum: number }[]) {
  const n = items.length, head = 12 + n * 16;
  const size = head + items.reduce((a, t) => a + pad4(t.data.length), 0);
  const out = new Uint8Array(size), dv = new DataView(out.buffer);
  let es = 0; while (1 << (es + 1) <= n) es++;
  dv.setUint32(0, flavor); dv.setUint16(4, n); dv.setUint16(6, (1 << es) * 16); dv.setUint16(8, es); dv.setUint16(10, n * 16 - (1 << es) * 16);
  let off = head;
  items.forEach((t, i) => {
    const o = 12 + i * 16;
    out.set(t.tag, o); dv.setUint32(o + 4, t.checksum); dv.setUint32(o + 8, off); dv.setUint32(o + 12, t.data.length);
    out.set(t.data, off); off += pad4(t.data.length);
  });
  return out;
}

/** sfnt → WOFF 1.0：每张表单独 zlib 压缩（变大就存原样）。 */
export function sfntToWoff(sfnt: Uint8Array): Uint8Array {
  const dv = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const ts = tables(sfnt).sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const parts = ts.map((t) => {
    const raw = sfnt.subarray(t.offset, t.offset + t.length), z = new Uint8Array(deflateSync(raw, { level: 9 }));
    return { t, data: z.length < raw.length ? z : raw };
  });
  const head = 44 + ts.length * 20;
  const total = head + parts.reduce((a, x) => a + pad4(x.data.length), 0);
  const out = new Uint8Array(total), w = new DataView(out.buffer);
  out.set([0x77, 0x4f, 0x46, 0x46]);
  w.setUint32(4, dv.getUint32(0)); w.setUint32(8, total); w.setUint16(12, ts.length);
  w.setUint32(16, 12 + ts.length * 16 + ts.reduce((a, t) => a + pad4(t.length), 0));
  let off = head;
  parts.forEach(({ t, data }, i) => {
    const o = 44 + i * 20;
    out.set([...t.tag].map((c) => c.charCodeAt(0)), o);
    w.setUint32(o + 4, off); w.setUint32(o + 8, data.length); w.setUint32(o + 12, t.length); w.setUint32(o + 16, t.checksum);
    out.set(data, off); off += pad4(data.length);
  });
  return out;
}

/* ---------- WOFF2 (Google woff2 via wawoff2, wasm 内嵌在 JS 里) ---------- */

/** wawoff2 是 Emscripten 生成的 CommonJS：打包成 ESM 后没有 __dirname，这里补上（wasm 已内嵌，只用来拼路径）。 */
function cjsGlobals() {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.__dirname !== "string") g.__dirname = dirname(fileURLToPath(import.meta.url));
  if (typeof g.__filename !== "string") g.__filename = fileURLToPath(import.meta.url);
}
type Fn = (buf: Uint8Array) => Promise<Uint8Array>;
const pick = (m: unknown): Fn => {
  const x = m as { default?: unknown };
  const d = x.default as { default?: unknown } | undefined;
  return (typeof d === "function" ? d : typeof d?.default === "function" ? d.default : x) as Fn;
};
export async function toWoff2(sfnt: Uint8Array): Promise<Uint8Array> {
  cjsGlobals();
  return new Uint8Array(await pick(await import("wawoff2/compress.js"))(sfnt));
}
export async function fromWoff2(buf: Uint8Array): Promise<Uint8Array> {
  cjsGlobals();
  return new Uint8Array(await pick(await import("wawoff2/decompress.js"))(buf));
}
