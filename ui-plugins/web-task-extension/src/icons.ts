import { deflateSync } from "node:zlib";

// 不依赖图像库：圆角方块 + 白色"播放"三角，4x 超采样抗锯齿，输出 PNG。
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b: Buffer) => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
export function hexColor(c: string | undefined, seed: string): [number, number, number] {
  const m = (c ?? "").match(/^#?([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as [number, number, number];
  let h = 0; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360, s = 0.62, l = 0.46;
  const f = (n: number) => { const k = (n + hue / 30) % 12; return Math.round(255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
}
export function iconPng(size: number, rgb: [number, number, number]): Buffer {
  const S = 4, raw = Buffer.alloc((size * 4 + 1) * size);
  const r = size * 0.22, pad = size * 0.04;
  const inRound = (x: number, y: number) => {
    const a = pad, b = size - pad;
    if (x < a || x > b || y < a || y > b) return false;
    const cx = Math.min(Math.max(x, a + r), b - r), cy = Math.min(Math.max(y, a + r), b - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  // 三角形顶点
  const t = [[size * 0.38, size * 0.27], [size * 0.38, size * 0.73], [size * 0.75, size * 0.5]];
  const side = (p: number[], a: number[], b: number[]) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const inTri = (x: number, y: number) => { const p = [x, y]; const d1 = side(p, t[0], t[1]), d2 = side(p, t[1], t[2]), d3 = side(p, t[2], t[0]); return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)); };
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let bg = 0, fg = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) { const px = x + (sx + 0.5) / S, py = y + (sy + 0.5) / S; if (inRound(px, py)) { bg++; if (inTri(px, py)) fg++; } }
      const n = S * S, a = bg / n, w = bg ? fg / bg : 0;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      for (let k = 0; k < 3; k++) raw[o + k] = Math.round(rgb[k] * (1 - w) + 255 * w);
      raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
export function pngSize(b: Uint8Array): [number, number] | null {
  const B = Buffer.from(b);
  if (B.length < 24 || B.readUInt32BE(0) !== 0x89504e47 || B.toString("ascii", 12, 16) !== "IHDR") return null;
  return [B.readUInt32BE(16), B.readUInt32BE(20)];
}
