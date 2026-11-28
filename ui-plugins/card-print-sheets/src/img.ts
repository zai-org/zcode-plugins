/** 只读文件头拿到 PNG / JPEG 的像素尺寸。 */
export function imageSize(b: Uint8Array): { w: number; h: number; type: "png" | "jpg" } | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { w: v.getUint32(16), h: v.getUint32(20), type: "png" };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8], type: "jpg" };
      i += 2 + len;
    }
  }
  return null;
}

export const SIZES: Record<string, [number, number, string]> = {
  poker: [63, 88, "扑克 / 万智牌 63×88"], bridge: [57, 89, "桥牌 57×89"], tarot: [70, 120, "塔罗 70×120"], mini: [44, 63, "迷你 44×63"], business: [90, 54, "名片 90×54"], square: [70, 70, "方形 70×70"],
};
export function cardSize(key: string, custom: string): [number, number] | null {
  if (key !== "custom") return SIZES[key] ? [SIZES[key][0], SIZES[key][1]] : null;
  const m = /^(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)$/i.exec(custom.trim());
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** 在纸上放卡：返回列数、行数和左下角原点（mm）。 */
export function grid(pw: number, ph: number, sw: number, sh: number, gap: number, margin: number) {
  const cols = Math.max(0, Math.floor((pw - 2 * margin + gap) / (sw + gap))), rows = Math.max(0, Math.floor((ph - 2 * margin + gap) / (sh + gap)));
  const tw = cols * sw + (cols - 1) * gap, th = rows * sh + (rows - 1) * gap;
  return { cols, rows, x0: (pw - tw) / 2, y0: (ph - th) / 2, tw, th };
}
