import { jpegSegments, parseTiff, readExif, type ExifInfo } from "./exif.ts";

export type Kind = "jpeg" | "png" | "webp" | "other";
export const kindOf = (b: Uint8Array): Kind =>
  b[0] === 0xff && b[1] === 0xd8 ? "jpeg" : b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e ? "png" : b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45 ? "webp" : "other";

const ascii = (b: Uint8Array, p: number, n: number) => String.fromCharCode(...b.subarray(p, p + n));
const u32be = (b: Uint8Array, p: number) => ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
const u32le = (b: Uint8Array, p: number) => b[p] + (b[p + 1] << 8) + (b[p + 2] << 16) + ((b[p + 3] << 24) >>> 0);

interface Chunk { type: string; start: number; end: number; data: number }
function pngChunks(b: Uint8Array): Chunk[] {
  const out: Chunk[] = [];
  for (let p = 8; p + 12 <= b.length; ) {
    const len = u32be(b, p), type = ascii(b, p + 4, 4);
    out.push({ type, start: p, end: p + 12 + len, data: p + 8 });
    p += 12 + len;
    if (type === "IEND") break;
  }
  return out;
}
function webpChunks(b: Uint8Array): Chunk[] {
  const out: Chunk[] = [];
  for (let p = 12; p + 8 <= b.length; ) {
    const len = u32le(b, p + 4), type = ascii(b, p, 4);
    out.push({ type, start: p, end: p + 8 + len + (len & 1), data: p + 8 });
    p += 8 + len + (len & 1);
  }
  return out;
}
const tiffStart = (b: Uint8Array, p: number) => (ascii(b, p, 6) === "Exif\0\0" ? p + 6 : p);

export interface Found extends ExifInfo { text: string[]; xmp: boolean; comment: boolean; kind: Kind }

export function inspect(b: Uint8Array): Found {
  const kind = kindOf(b);
  const f: Found = { tags: 0, text: [], xmp: false, comment: false, kind };
  if (kind === "jpeg") {
    Object.assign(f, readExif(b));
    for (const s of jpegSegments(b)) {
      if (s.marker === 0xfe) f.comment = true;
      if (s.marker === 0xe1 && ascii(b, s.start + 4, 28).startsWith("http://ns.adobe.com/xap/")) f.xmp = true;
      if (s.marker === 0xed) f.text.push("IPTC");
    }
  } else if (kind === "png") {
    for (const c of pngChunks(b)) {
      if (c.type === "eXIf") Object.assign(f, parseTiff(b.subarray(0, c.end - 4), c.data));
      if (["tEXt", "zTXt", "iTXt"].includes(c.type)) f.text.push(ascii(b, c.data, Math.min(40, c.end - 4 - c.data)).split("\0")[0]);
      if (c.type === "tIME") f.text.push("tIME");
    }
  } else if (kind === "webp") {
    for (const c of webpChunks(b)) {
      if (c.type === "EXIF") Object.assign(f, parseTiff(b.subarray(0, c.end), tiffStart(b, c.data)));
      if (c.type === "XMP ") f.xmp = true;
    }
  }
  f.text = [...new Set(f.text)];
  return f;
}

/** 就地抹掉 TIFF 里的 GPS IFD（长度不变）。 */
export function wipeGps(b: Uint8Array, start: number, end: number): boolean {
  const dv = new DataView(b.buffer, b.byteOffset + start, end - start);
  const le = dv.getUint16(0) === 0x4949;
  const u16 = (o: number) => dv.getUint16(o, le), u32 = (o: number) => dv.getUint32(o, le);
  const ifd0 = u32(4);
  const n = u16(ifd0);
  for (let i = 0; i < n; i++) {
    const e = ifd0 + 2 + i * 12;
    if (u16(e) !== 0x8825) continue;
    const g = u32(e + 8);
    if (g + 2 > dv.byteLength) return false;
    const gn = u16(g);
    const SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
    for (let k = 0; k < gn; k++) {
      const ge = g + 2 + k * 12;
      const size = (SIZE[u16(ge + 2)] ?? 1) * u32(ge + 4);
      if (size > 4) { const vo = u32(ge + 8); if (vo + size <= dv.byteLength) b.fill(0, start + vo, start + vo + size); }
      b.fill(0, start + ge, start + ge + 12);
    }
    dv.setUint16(g, 0, le);
    return true;
  }
  return false;
}

function orientationApp1(o: number): Uint8Array {
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0];
  return Uint8Array.from([0xff, 0xe1, 0, body.length + 2, ...body]);
}

const join = (parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

export interface CleanOptions { mode: "all" | "gps"; keepOrientation: boolean }

/** 返回清理后的新字节（不修改输入）。 */
export function clean(input: Uint8Array, opt: CleanOptions): { data: Uint8Array; removed: string[] } {
  const b = Uint8Array.from(input);
  const kind = kindOf(b);
  const removed: string[] = [];
  if (kind === "jpeg") {
    const parts: Uint8Array[] = [b.subarray(0, 2)];
    const info = readExif(b);
    let inserted = false;
    for (const s of jpegSegments(b)) {
      const seg = b.subarray(s.start, s.end);
      const isExif = s.marker === 0xe1 && ascii(b, s.start + 4, 6) === "Exif\0\0";
      const isXmp = s.marker === 0xe1 && !isExif;
      if (opt.mode === "gps") {
        if (isExif && wipeGps(b, s.start + 10, s.end)) removed.push("GPS");
        if (isXmp) { removed.push("XMP"); continue; }
        parts.push(seg);
        continue;
      }
      const keepIcc = s.marker === 0xe2 && ascii(b, s.start + 4, 11) === "ICC_PROFILE";
      const keepAdobe = s.marker === 0xee;
      if ((s.marker >= 0xe1 && s.marker <= 0xef && !keepIcc && !keepAdobe) || s.marker === 0xfe) {
        removed.push(isExif ? "EXIF" : isXmp ? "XMP" : s.marker === 0xfe ? "comment" : s.marker === 0xed ? "IPTC" : `APP${s.marker - 0xe0}`);
        continue;
      }
      if (!inserted && s.marker !== 0xe0 && opt.keepOrientation && (info.orientation ?? 1) > 1) { parts.push(orientationApp1(info.orientation!)); inserted = true; }
      parts.push(seg);
    }
    return { data: join(parts), removed: [...new Set(removed)] };
  }
  if (kind === "png") {
    const parts: Uint8Array[] = [b.subarray(0, 8)];
    for (const c of pngChunks(b)) {
      if (opt.mode === "all" && ["eXIf", "tEXt", "zTXt", "iTXt", "tIME"].includes(c.type)) { removed.push(c.type === "eXIf" ? "EXIF" : c.type === "tIME" ? "time" : "text"); continue; }
      if (opt.mode === "gps" && c.type === "eXIf") {
        if (wipeGps(b, c.data, c.end - 4)) {
          removed.push("GPS");
          const crc = crc32(b.subarray(c.start + 4, c.end - 4));
          new DataView(b.buffer).setUint32(c.end - 4, crc);
        }
      }
      parts.push(b.subarray(c.start, c.end));
    }
    return { data: join(parts), removed: [...new Set(removed)] };
  }
  if (kind === "webp") {
    const parts: Uint8Array[] = [];
    for (const c of webpChunks(b)) {
      if (opt.mode === "all" && (c.type === "EXIF" || c.type === "XMP ")) { removed.push(c.type.trim()); continue; }
      if (opt.mode === "gps" && c.type === "EXIF" && wipeGps(b, tiffStart(b, c.data), c.end)) removed.push("GPS");
      if (opt.mode === "gps" && c.type === "XMP ") { removed.push("XMP"); continue; }
      parts.push(b.subarray(c.start, c.end));
    }
    const body = join(parts);
    const chunks = webpChunks(join([new Uint8Array(12), body]));
    const vp8x = chunks.find((c) => c.type === "VP8X");
    if (vp8x) {
      const has = (t: string) => chunks.some((c) => c.type === t);
      let flags = body[vp8x.data - 12] & ~(0x08 | 0x04);
      if (has("EXIF")) flags |= 0x08;
      if (has("XMP ")) flags |= 0x04;
      body[vp8x.data - 12] = flags;
    }
    const head = Uint8Array.from(b.subarray(0, 12));
    new DataView(head.buffer).setUint32(4, body.length + 4, true);
    return { data: join([head, body]), removed: [...new Set(removed)] };
  }
  return { data: b, removed };
}

let TABLE: Uint32Array | undefined;
function crc32(d: Uint8Array) {
  TABLE ??= Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  let c = 0xffffffff;
  for (const x of d) c = TABLE[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
