/** 极简 EXIF 读取：JPEG APP1 / TIFF / 在 HEIC 等容器里按 "Exif\0\0" 搜索。 */
export interface ExifInfo {
  dateTaken?: string; // "YYYY-MM-DD HH:MM:SS"（相机本地时间）
  created?: string;
  modified?: string;
  make?: string;
  model?: string;
  software?: string;
  orientation?: number;
  gps?: { lat: number; lon: number };
  tags: number; // 读到的标签总数
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

export function parseTiff(b: Uint8Array, start = 0): ExifInfo {
  const dv = new DataView(b.buffer, b.byteOffset + start, b.byteLength - start);
  const le = dv.getUint16(0) === 0x4949;
  if (!le && dv.getUint16(0) !== 0x4d4d) return { tags: 0 };
  const u16 = (o: number) => dv.getUint16(o, le);
  const u32 = (o: number) => dv.getUint32(o, le);
  const info: ExifInfo = { tags: 0 };
  const seen = new Set<number>();
  const readIfd = (off: number, kind: "0" | "exif" | "gps") => {
    if (!off || seen.has(off) || off + 2 > dv.byteLength) return;
    seen.add(off);
    const n = u16(off);
    const gps: Record<number, unknown> = {};
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      if (e + 12 > dv.byteLength) break;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      const size = (TYPE_SIZE[type] ?? 1) * count;
      const vo = size <= 4 ? e + 8 : u32(e + 8);
      if (vo + size > dv.byteLength) continue;
      info.tags++;
      const str = () => new TextDecoder().decode(new Uint8Array(dv.buffer, dv.byteOffset + vo, count)).replace(/\0+$/, "").trim();
      const rats = () => Array.from({ length: count }, (_, k) => u32(vo + k * 8) / (u32(vo + k * 8 + 4) || 1));
      if (kind === "gps") { gps[tag] = type === 2 ? str() : type === 5 ? rats() : undefined; continue; }
      if (tag === 0x8769) readIfd(u32(e + 8), "exif");
      else if (tag === 0x8825) readIfd(u32(e + 8), "gps");
      else if (type === 2) {
        const s = str();
        if (tag === 0x9003) info.dateTaken = exifDate(s);
        else if (tag === 0x9004) info.created = exifDate(s);
        else if (tag === 0x0132) info.modified = exifDate(s);
        else if (tag === 0x010f) info.make = s;
        else if (tag === 0x0110) info.model = s;
        else if (tag === 0x0131) info.software = s;
      } else if (tag === 0x0112 && type === 3) info.orientation = u16(vo);
    }
    if (kind === "gps" && Array.isArray(gps[2]) && Array.isArray(gps[4])) {
      const dms = (a: number[]) => a[0] + (a[1] ?? 0) / 60 + (a[2] ?? 0) / 3600;
      info.gps = { lat: dms(gps[2] as number[]) * (gps[1] === "S" ? -1 : 1), lon: dms(gps[4] as number[]) * (gps[3] === "W" ? -1 : 1) };
    }
  };
  readIfd(u32(4), "0");
  return info;
}

function exifDate(s: string): string | undefined {
  const m = s.match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m || m[1] === "0000") return undefined;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
}

/** JPEG 段列表。 */
export function jpegSegments(b: Uint8Array): { marker: number; start: number; end: number }[] {
  const out: { marker: number; start: number; end: number }[] = [];
  if (b[0] !== 0xff || b[1] !== 0xd8) return out;
  let p = 2;
  while (p + 4 <= b.length && b[p] === 0xff) {
    const marker = b[p + 1];
    if (marker === 0xd9 || marker === 0xda) { out.push({ marker, start: p, end: b.length }); break; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue; }
    const len = (b[p + 2] << 8) | b[p + 3];
    out.push({ marker, start: p, end: p + 2 + len });
    p += 2 + len;
  }
  return out;
}

const EXIF_HDR = [0x45, 0x78, 0x69, 0x66, 0, 0];
const at = (b: Uint8Array, p: number, sig: number[]) => sig.every((v, i) => b[p + i] === v);

export function readExif(b: Uint8Array): ExifInfo {
  try {
    if (b[0] === 0xff && b[1] === 0xd8) {
      for (const s of jpegSegments(b)) if (s.marker === 0xe1 && at(b, s.start + 4, EXIF_HDR)) return parseTiff(b.subarray(0, s.end), s.start + 10);
      return { tags: 0 };
    }
    if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 0x2a)) return parseTiff(b);
    for (let p = 0; p + 10 < b.length; p++) if (b[p] === 0x45 && at(b, p, EXIF_HDR) && (b[p + 6] === 0x49 || b[p + 6] === 0x4d)) return parseTiff(b, p + 6);
  } catch { /* 损坏的 EXIF 当作没有 */ }
  return { tags: 0 };
}

/** MP4/MOV 的 mvhd 创建时间（UTC 秒，自 1904 年）。 */
export function mp4Created(b: Uint8Array): Date | undefined {
  for (let p = 4; p + 24 < b.length; p++) {
    if (b[p] === 0x6d && b[p + 1] === 0x76 && b[p + 2] === 0x68 && b[p + 3] === 0x64) {
      const dv = new DataView(b.buffer, b.byteOffset + p + 4);
      const secs = dv.getUint8(0) === 1 ? Number(dv.getBigUint64(4)) : dv.getUint32(4);
      if (secs <= 0) return undefined;
      const d = new Date((secs - 2082844800) * 1000);
      return d.getFullYear() > 1990 ? d : undefined;
    }
  }
  return undefined;
}
