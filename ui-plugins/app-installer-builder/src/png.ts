import { deflateSync } from "node:zlib";

/** PNG 宽高（读 IHDR）；不是 PNG 返回 undefined。 */
export function pngSize(buf: Uint8Array): { width: number; height: number } | undefined {
  if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return undefined;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Uint8Array) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, "ascii"); Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
const hex = (c: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(c); const n = parseInt(m ? m[1] : "2563eb", 16); return [n >> 16, (n >> 8) & 255, n & 255]; };

/**
 * 没有图标时生成默认图标：圆角方块 + 渐变 + 白色“窗口”图形，1024×1024 RGBA PNG。
 * electron-builder 会从 1024 PNG 生成 .icns / .ico。
 */
export function defaultIcon(color = "#2563eb", size = 1024): Buffer {
  const [r, g, b] = hex(color);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const R = size * 0.2, pad = size * 0.06;
  const inRound = (x: number, y: number, x0: number, y0: number, x1: number, y1: number, rad: number) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.min(Math.max(x, x0 + rad), x1 - rad), cy = Math.min(Math.max(y, y0 + rad), y1 - rad);
    return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
  };
  const w0 = size * 0.24, w1 = size * 0.76, h0 = size * 0.3, h1 = size * 0.72, bar = size * 0.4, t = size * 0.035;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const o = row + 1 + x * 4;
      if (!inRound(x + 0.5, y + 0.5, pad, pad, size - pad, size - pad, R)) continue;
      const k = 1.15 - (y / size) * 0.35;
      let px = [Math.min(255, r * k), Math.min(255, g * k), Math.min(255, b * k)];
      const frame = inRound(x, y, w0, h0, w1, h1, size * 0.05) && !inRound(x, y, w0 + t, bar, w1 - t, h1 - t, size * 0.02);
      const dot = [0.29, 0.34, 0.39].some((cx) => (x - cx * size) ** 2 + (y - (h0 + bar) / 2) ** 2 <= (size * 0.018) ** 2);
      if (frame && !dot) px = [255, 255, 255];
      raw[o] = px[0]; raw[o + 1] = px[1]; raw[o + 2] = px[2]; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 6 })), chunk("IEND", new Uint8Array())]);
}
