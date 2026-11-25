// 极简 WebM（Matroska）封装：一条 VP8/VP9 视频轨，供 WebCodecs 逐帧编码的输出使用。
type Part = Uint8Array;
const enc = new TextEncoder();
function id(n: number): Part { const b: number[] = []; while (n > 0) { b.unshift(n & 0xff); n = Math.floor(n / 256); } return Uint8Array.from(b); }
function size(n: number): Part { const b = new Uint8Array(8); b[0] = 0x01; for (let i = 7; i > 0; i--) { b[i] = n & 0xff; n = Math.floor(n / 256); } return b; }
function uint(n: number): Part { const b: number[] = []; do { b.unshift(n & 0xff); n = Math.floor(n / 256); } while (n > 0); return Uint8Array.from(b); }
function float(n: number): Part { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, n); return b; }
function cat(parts: Part[]): Part { const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
const el = (tag: number, ...body: Part[]) => { const b = cat(body); return cat([id(tag), size(b.length), b]); };

export interface Frame { data: Uint8Array; ms: number; key: boolean }

export function muxWebm(frames: Frame[], width: number, height: number, codec: "V_VP8" | "V_VP9", durationMs: number): Uint8Array {
  const header = el(0x1a45dfa3, el(0x4286, uint(1)), el(0x42f7, uint(1)), el(0x42f2, uint(4)), el(0x42f3, uint(8)), el(0x4282, enc.encode("webm")), el(0x4287, uint(4)), el(0x4285, uint(2)));
  const info = el(0x1549a966, el(0x2ad7b1, uint(1_000_000)), el(0x4489, float(durationMs)), el(0x4d80, enc.encode("product-3d-showcase")), el(0x5741, enc.encode("product-3d-showcase")));
  const tracks = el(0x1654ae6b, el(0xae, el(0xd7, uint(1)), el(0x73c5, uint(1)), el(0x83, uint(1)), el(0x86, enc.encode(codec)), el(0xe0, el(0xb0, uint(width)), el(0xba, uint(height)))));
  const clusters: Part[] = [];
  let i = 0;
  while (i < frames.length) {
    const base = frames[i].ms;
    const blocks: Part[] = [];
    do {
      const f = frames[i];
      const head = new Uint8Array(4);
      head[0] = 0x81;
      new DataView(head.buffer).setInt16(1, Math.round(f.ms - base));
      head[3] = f.key ? 0x80 : 0;
      blocks.push(el(0xa3, head, f.data));
      i++;
    } while (i < frames.length && !frames[i].key && frames[i].ms - base < 30_000);
    clusters.push(el(0x1f43b675, el(0xe7, uint(Math.round(base))), ...blocks));
  }
  return cat([header, el(0x18538067, info, tracks, ...clusters)]);
}
